import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {CACHE} from '../server/config.mjs';
import {TikTokClient,TikTokDrafts} from '../server/tiktok.mjs';

function fixture(t,{size=31}={}){
 const root=fs.mkdtempSync(path.join(CACHE,'tiktok-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'portrait.mp4');
 fs.writeFileSync(file,Buffer.alloc(1));
 fs.truncateSync(file,size);
 const post={id:randomUUID(),file,media:{width:1080,height:1920,duration:22,fps:30,videoCodec:'h264'},
  metadata:{title:'A close race #Shorts',description:'Source: Streamer name\n#Gaming #Shorts',tags:['gaming','Final lap']}};
 return {root,post};
}

test('TikTok desktop OAuth binds the callback, rotates tokens, and clears credentials on revoke',async t=>{
 const {root}=fixture(t);
 let allowedScope='video.upload,user.info.basic';
 const client=new TikTokClient({folder:root,fetchImpl:async(url,init)=>{
  const body=init.body;
  if(url.endsWith('/token/')){
   assert.equal(body.get('client_secret'),'secret');
   if(body.get('grant_type')==='refresh_token')assert.equal(body.get('refresh_token'),'refresh-1');
   else{
    assert.equal(body.get('redirect_uri'),redirect);
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('hex'),consent.searchParams.get('code_challenge'));
   }
   const renewed=body.get('grant_type')==='refresh_token';
   return Response.json({access_token:renewed?'access-2':'access-1',refresh_token:renewed?'refresh-2':'refresh-1',
    open_id:'account',scope:allowedScope,expires_in:renewed?7200:1,refresh_expires_in:1000});
  }
  if(url.endsWith('/revoke/')){
   assert.equal(body.get('token'),'access-2');
   return new Response(null,{status:200});
  }
  assert.ok(url.includes('/user/info/'));
  return Response.json({data:{user:{open_id:'account',display_name:'Clip creator'}},error:{code:'ok'}});
 }});
 assert.deepEqual(client.configure({clientKey:'test-key',clientSecret:'secret'}),{configured:true,connected:false,displayName:'',accountId:null});
 const redirect='http://localhost:5173/api/tiktok/callback';
 assert.throws(()=>client.authorizeUrl('http://example.com:5173/api/tiktok/callback'),/local desktop/i);
 let consent=new URL(client.authorizeUrl(redirect));
 assert.equal(consent.searchParams.get('code_challenge_method'),'S256');
 assert.equal(consent.searchParams.get('scope'),'user.info.basic,video.upload');
 await assert.rejects(client.callback({state:'altered',code:'mock'}),/expired/i);
 allowedScope='user.info.basic';
 await assert.rejects(client.callback({state:consent.searchParams.get('state'),code:'mock'}),/permissions/i);
 allowedScope='user.info.basic,video.upload';
 consent=new URL(client.authorizeUrl(redirect));
 assert.deepEqual(await client.callback({state:consent.searchParams.get('state'),code:'mock'}),{configured:true,connected:true,displayName:'Clip creator',accountId:'account'});
 await assert.rejects(client.callback({state:consent.searchParams.get('state'),code:'mock'}),/expired/i);
 assert.throws(()=>client.configure({clientKey:'other',clientSecret:'secret'}),/disconnect/i);
 const [a,b]=await Promise.all([client.account(),client.account()]);
 assert.equal(a.accessToken,'access-2');
 assert.equal(b.refreshToken,'refresh-2');
 assert.equal((await client.disconnect()).connected,false);
 assert.equal(fs.existsSync(client.tokenFile),false);
});

test('TikTok resumes an interrupted file transfer and keeps the local caption out of the inbox request',async t=>{
 const size=65_000_031,{root,post}=fixture(t,{size});
 let remoteState='PROCESSING_UPLOAD',sentBytes=0,failSecondChunk=true,initializations=0,accountId='account';
 const client={
  account:async()=>({openId:accountId}),
  post:async(endpoint,account,body)=>{
   if(endpoint==='status/fetch'){
    assert.equal(body.publish_id,'inbox-id');
    return {status:remoteState,uploaded_bytes:sentBytes};
   }
   assert.equal(endpoint,'inbox/video/init');
   initializations++;
   assert.deepEqual(body,{source_info:{source:'FILE_UPLOAD',video_size:size,chunk_size:10_000_000,total_chunk_count:6}});
   return {publish_id:'inbox-id',upload_url:'https://open-upload.tiktokapis.com/video/?upload_token=test-secret'};
  },
  fetch:async(url,init)=>{
   const [start,end]=init.headers['Content-Range'].match(/\d+/g).map(Number);
   assert.equal(start,sentBytes);
   assert.equal(init.body.length,end-start+1);
   if(start===10_000_000&&failSecondChunk){
    failSecondChunk=false;
    sentBytes=end+1;
    throw new Error('Network connection dropped after TikTok received the chunk');
   }
   sentBytes=end+1;
   return new Response(null,{status:sentBytes===size?201:206});
  },
 };
 const drafts=new TikTokDrafts({root,client});
 assert.equal(drafts.get(post).caption,'A close race\n\nSource: Streamer name\n\n#Gaming #Finallap');
 drafts.edit(post,'Race recap #Gaming #FinalLap');
 await assert.rejects(drafts.send(post,false),/confirm/i);
 await assert.rejects(drafts.send({...post,media:{...post.media,width:1920,height:1080}},true,'account'),/portrait/i);
 await assert.rejects(drafts.send(post,true,'wrong-account'),/account changed/i);
 await assert.rejects(drafts.send(post,true,'account'),/dropped/i);
 assert.equal(initializations,1);
 const restored=new TikTokDrafts({root,client});
 assert.deepEqual(restored.view(restored.get(post)),{caption:'Race recap #Gaming #FinalLap',state:'processing',error:'',checkable:true,resumable:true});
 assert.equal((await restored.send(post,true,'account')).resumable,false);
 assert.equal(sentBytes,size);
 remoteState='SEND_TO_USER_INBOX';
 assert.equal((await restored.check(post)).state,'inbox');
 assert.equal((await restored.send(post,true,'account')).state,'inbox');
 assert.equal(initializations,1);
 accountId='another-account';
 await assert.rejects(restored.check(post),/reconnect/i);
 assert.ok(!JSON.stringify(restored.view(restored.get(post))).includes('test-secret'));
});

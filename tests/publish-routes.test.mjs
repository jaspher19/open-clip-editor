import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import express from 'express';
import {registerPublishRoutes} from '../server/publish-routes.mjs';import {PostingQueue} from '../server/posting.mjs';import {CACHE} from '../server/config.mjs';import {run} from '../server/process.mjs';

async function serve(t,options){const app=express();app.use(express.json());registerPublishRoutes(app,options);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
 return (url,init={})=>fetch(base+url,{...init,headers:{'Content-Type':'application/json'},...(init.body?{body:JSON.stringify(init.body)}:{})}).then(async r=>({status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.arrayBuffer()}));}

function project(){const root=fs.mkdtempSync(path.join(CACHE,'tmp/publish-')),folder=path.join(root,'job');fs.mkdirSync(folder,{recursive:true});
 const words='bro what is in my pocket oh my god'.split(' ').map((text,i)=>({text,start:10+i*.5,end:10.4+i*.5}));fs.writeFileSync(path.join(folder,'transcript.json'),JSON.stringify({words}));
 const job={id:'job',title:'AMP HALLOWEEN PARTY',options:{},source:{url:'https://youtu.be/abc'},clips:[{id:'c1',start:9,end:30,title:'Kai Cenat Finds a Surprise',category:'funny'}]};
 fs.writeFileSync(path.join(folder,'source.info.json'),JSON.stringify({uploader:'Kai Cenat',channel:'Kai Cenat'}));
 return {root,store:{get:id=>{if(id!=='job')throw Object.assign(new Error('Job not found'),{status:404});return job;},folder:()=>folder}};}

test('a fresh hook and title options for one clip, without saving; clear errors with no key or a failing AI',async t=>{
 const {root,store}=project();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const content=JSON.stringify({clips:[{index:0,hook:'"what is in my pocket"',title:'Kai Cenat Finds Something in His Pocket',altTitles:['Kai Cenat Cannot Believe His Pocket'],youtubeTitle:'Kai Cenat Finds Something in His Pocket at the Party',description:'d',hashtags:[],tags:[]}]});
 let ok=true;const fetchImpl=async()=>ok?{ok:true,status:200,json:async()=>({model:'m',choices:[{message:{content}}]})}:{ok:false,status:401,json:async()=>({})};
 const call=await serve(t,{store,posting:{},env:{GROQ_API_KEY:'g'},fetchImpl});
 const r=await call('/api/jobs/job/clips/c1/hook/ai',{method:'POST'});assert.equal(r.status,200);
 assert.match(r.body.hook,/^Kai /,'quote hooks fall back to a who-did-what line');assert.deepEqual(r.body.titleOptions,['Kai Cenat Finds a Surprise','Kai Cenat Finds Something in His Pocket','Kai Cenat Cannot Believe His Pocket']);
 assert.equal(store.get('job').clips[0].title,'Kai Cenat Finds a Surprise','nothing is saved');
 ok=false;assert.equal((await call('/api/jobs/job/clips/c1/hook/ai',{method:'POST'})).status,502);
 assert.equal((await call('/api/jobs/job/clips/nope/hook/ai',{method:'POST'})).status,404);
 const none=await serve(t,{store,posting:{},env:{}});const r2=await none('/api/jobs/job/clips/c1/hook/ai',{method:'POST'});assert.equal(r2.status,400);assert.match(r2.body.error,/Gemini or Groq/);
});

test('main-video posts get a rendered 1280x720 thumbnail; Shorts and locked posts are refused',async t=>{
 const root=fs.mkdtempSync(path.join(CACHE,'tmp/publish-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const video=path.join(root,'wide.mp4'),tall=path.join(root,'tall.mp4');
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=2','-pix_fmt','yuv420p',video]);await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=360x640:rate=30:duration=2','-pix_fmt','yuv420p',tall]);
 const posting=new PostingQueue({root:path.join(root,'posts'),youtube:{status:()=>({connected:false})}}),input={metadata:{title:'Stream best moments',description:'',tags:[]},settings:{privacy:'private',madeForKids:false},timeZone:'Asia/Manila'};
 const main=posting.create(video,{width:640,height:360,duration:2},{...input,format:'video'}),short=posting.create(tall,{width:360,height:640,duration:2},{...input,format:'shorts'});
 const call=await serve(t,{store:{},posting});
 const r=await call(`/api/posting/${main.id}/thumbnail`,{method:'POST',body:{time:1,text:'Kai loses it at the party'}});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.thumbnail.text,'Kai loses it at the party');
 const jpg=await call(`/api/posting/${main.id}/thumbnail`);assert.equal(jpg.status,200);const bytes=Buffer.from(jpg.body);assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);
 const size=bytes.indexOf(Buffer.from([0xff,0xc0]));assert.equal(bytes.readUInt16BE(size+7),1280);assert.equal(bytes.readUInt16BE(size+5),720);
 assert.equal((await call(`/api/posting/${main.id}/thumbnail`,{method:'POST',body:{time:1,text:'x'.repeat(41)}})).status,400);
 assert.match((await call(`/api/posting/${short.id}/thumbnail`,{method:'POST',body:{time:1}})).body.error,/mobile app/);
 assert.equal((await call(`/api/posting/${main.id}/thumbnail`,{method:'DELETE'})).status,200);assert.equal((await call(`/api/posting/${main.id}/thumbnail`)).status,404);
 posting.save({...posting.get(main.id),state:'uploading'});assert.equal((await call(`/api/posting/${main.id}/thumbnail`,{method:'POST',body:{time:1}})).status,409);
});

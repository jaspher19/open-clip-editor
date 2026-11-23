import fs from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {CACHE} from './config.mjs';
import {writeJsonAtomic} from './atomic.mjs';

const API='https://open.tiktokapis.com';
const SCOPES=['user.info.basic','video.upload'];
const UPLOAD_WINDOW=60*60*1000;
const CHUNK=10_000_000;

function read(file){
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(error){
  if(error.code==='ENOENT')return null;
  throw new Error('A local TikTok settings file could not be read.');
 }
}
function save(file,data){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 writeJsonAtomic(file,data,{mode:0o600});
 return data;
}
function conflict(message){return Object.assign(new Error(message),{status:409});}
function safeCode(code){
 return typeof code==='string'&&/^[a-z0-9_]{1,80}$/i.test(code)?code:'unknown_error';
}

export class TikTokClient {
 constructor({folder=path.join(CACHE,'tiktok'),fetchImpl=fetch}={}){
  this.credentialsFile=path.join(folder,'client.json');
  this.tokenFile=path.join(folder,'tokens.json');
  this.fetch=fetchImpl;
  this.pending=new Map();
 }

 status(){
  const token=read(this.tokenFile);
  const connected=!!token?.refreshToken&&token.refreshExpiresAt>Date.now();
  return {configured:!!read(this.credentialsFile),connected,
   displayName:connected?token.displayName:'',accountId:connected?token.openId:null};
 }

 configure({clientKey,clientSecret}={}){
  if(typeof clientKey!=='string'||typeof clientSecret!=='string'||![clientKey,clientSecret].every(value=>/^\w[\w.-]{0,255}$/.test(value.trim())))throw new Error('Enter the Client key and Client secret from TikTok for Developers.');
  if(this.status().connected||this.changing||this.transferring)throw conflict('Disconnect TikTok before replacing its credentials.');
  save(this.credentialsFile,{clientKey:clientKey.trim(),clientSecret:clientSecret.trim()});
  fs.rmSync(this.tokenFile,{force:true});
  this.pending.clear();
  return this.status();
 }

 authorizeUrl(redirect){
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/tiktok\/callback$/.test(redirect))throw new Error('TikTok requires a local desktop callback.');
  const credentials=read(this.credentialsFile);
  if(!credentials)throw new Error('Save your TikTok developer credentials first.');
  if(this.status().connected||this.changing||this.transferring)throw conflict('Disconnect TikTok before connecting another account.');
  const state=randomBytes(24).toString('hex');
  const verifier=randomBytes(48).toString('base64url');
  this.pending.clear();
  this.pending.set(state,{verifier,redirect,expiresAt:Date.now()+600_000});
  const destination=new URL('https://www.tiktok.com/v2/auth/authorize/');
  destination.search=new URLSearchParams({
   client_key:credentials.clientKey,scope:SCOPES.join(','),response_type:'code',state,redirect_uri:redirect,
   code_challenge:createHash('sha256').update(verifier).digest('hex'),code_challenge_method:'S256',
  });
  return destination.href;
 }

 async request(endpoint,init={},allowEmpty=false){
  const response=await this.fetch(API+endpoint,{...init,signal:AbortSignal.timeout(30_000),redirect:'error'});
  const body=await response.text();
  if(response.ok&&allowEmpty&&!body.trim())return {};
  let data;
  try{data=JSON.parse(body||'null');}catch{throw new Error(`TikTok returned an unreadable response (HTTP ${response.status}).`);}
  const error=typeof data?.error==='string'?data.error:data?.error?.code;
  if(!response.ok||!data||(error&&error!=='ok')){
   const code=safeCode(error);
   throw Object.assign(new Error(`TikTok returned ${code} (HTTP ${response.status}).`),{code});
  }
  return data.data??data;
 }

 oauth(endpoint,fields){
  const credentials=read(this.credentialsFile);
  if(!credentials)throw new Error('Save your TikTok developer credentials first.');
  return this.request(`/v2/oauth/${endpoint}/`,{method:'POST',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_key:credentials.clientKey,client_secret:credentials.clientSecret,...fields}),
  },endpoint==='revoke');
 }

 tokenData(data){
  if(!data.access_token||!data.refresh_token||!data.open_id||!(data.expires_in>0)||!(data.refresh_expires_in>0))throw new Error('TikTok returned incomplete account credentials.');
  return {openId:data.open_id,accessToken:data.access_token,refreshToken:data.refresh_token,
   expiresAt:Date.now()+data.expires_in*1000,refreshExpiresAt:Date.now()+data.refresh_expires_in*1000};
 }

 async callback({state,code,error}){
  const pending=this.pending.get(state);
  this.pending.delete(state);
  if(!pending||pending.expiresAt<Date.now()||this.changing)throw new Error('The TikTok sign-in session expired. Start Connect TikTok again.');
  if(error||typeof code!=='string'||!code)throw new Error('TikTok access was declined. Connect again and allow video uploads.');
  this.changing=true;
  try{
   const data=await this.oauth('token',{grant_type:'authorization_code',code,redirect_uri:pending.redirect,code_verifier:pending.verifier});
   const scopes=new Set(String(data.scope||'').split(','));
   if(!SCOPES.every(scope=>scopes.has(scope)))throw new Error('TikTok did not grant the account and video upload permissions.');
   const token=this.tokenData(data);
   const profile=await this.request('/v2/user/info/?fields=open_id,display_name',{headers:{Authorization:`Bearer ${token.accessToken}`}});
   if(profile.user?.open_id!==token.openId||!profile.user.display_name)throw new Error('Could not verify the TikTok account.');
   save(this.tokenFile,{...token,displayName:profile.user.display_name});
   return this.status();
  }finally{this.changing=false;}
 }

 async account(){
  const token=read(this.tokenFile);
  if(!token||token.refreshExpiresAt<=Date.now())throw new Error('Connect TikTok in Automation before sending a video.');
  if(token.expiresAt>Date.now()+60_000)return token;
  if(!this.refreshing){
   this.refreshing=(async()=>{
    const renewed=this.tokenData(await this.oauth('token',{grant_type:'refresh_token',refresh_token:token.refreshToken}));
    if(renewed.openId!==token.openId)throw new Error('TikTok returned a different account. Reconnect and try again.');
    return save(this.tokenFile,{...renewed,displayName:token.displayName});
   })().finally(()=>{this.refreshing=null;});
  }
  return this.refreshing;
 }

 async disconnect(){
  if(this.changing||this.transferring||this.refreshing)throw conflict('Wait for the current TikTok request to finish.');
  this.pending.clear();
  const token=read(this.tokenFile);
  if(!token)return this.status();
  this.changing=true;
  try{
   if(token.refreshExpiresAt>Date.now()){
    try{
     const account=await this.account();
     await this.oauth('revoke',{token:account.accessToken});
    }catch(error){
     if(!['invalid_grant','access_token_invalid','invalid_token'].includes(error.code))throw error;
    }
   }
   fs.rmSync(this.tokenFile,{force:true});
   return this.status();
  }finally{this.changing=false;}
 }

 post(endpoint,token,body){
  return this.request(`/v2/post/publish/${endpoint}/`,{method:'POST',
   headers:{Authorization:`Bearer ${token.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 }
}

export function tiktokVideoError(media){
 if(!media||!Number.isFinite(media.width)||!Number.isFinite(media.height)||!Number.isFinite(media.duration))return 'Add a finished portrait MP4 to the calendar.';
 if(media.width>=media.height)return 'Export this clip in Portrait 9:16 before sending it to TikTok.';
 if(media.width<360||media.height>4096||media.duration<=0||media.duration>600)return 'TikTok needs portrait video between 360 and 4096 pixels per side, up to 10 minutes.';
 if(!(media.fps>=23&&media.fps<=60)||!['h264','hevc','vp8','vp9'].includes(media.videoCodec))return 'Re-export as a 23–60 fps H.264 MP4 for TikTok.';
 return '';
}

function defaultCaption(metadata){
 const tags=[...(metadata.description?.match(/#[\p{L}\p{N}_]+/gu)||[]),...(metadata.tags||[]).map(tag=>`#${tag.replace(/[^\p{L}\p{N}_]/gu,'')}`)];
 const topicTags=new Map();
 for(const tag of tags){
  const key=tag.toLowerCase();
  if(tag.length>1&&!['#shorts','#youtubeshorts','#youtube'].includes(key)&&!topicTags.has(key))topicTags.set(key,tag);
 }
 const title=String(metadata.title||'').replace(/#(?:youtubeshorts|shorts|youtube)\b/gi,'').trim();
 const source=metadata.description?.match(/^Source:[ \t]*[^\r\n]+/mi)?.[0];
 return [title,source,[...topicTags.values()].slice(0,5).join(' ')].filter(Boolean).join('\n\n').slice(0,2200);
}

const REMOTE_STATE={
 PROCESSING_UPLOAD:'processing',PROCESSING_DOWNLOAD:'processing',
 SEND_TO_USER_INBOX:'inbox',PUBLISH_COMPLETE:'published',FAILED:'failed',
};
export class TikTokDrafts {
 constructor({root,client}){this.root=root;this.client=client;}
 file(post){return path.join(this.root,`${post.id}.json`);}
 get(post){return read(this.file(post))||{caption:defaultCaption(post.metadata),state:'draft'};}
 view(draft){
  const {caption,state,error}=draft;
  return {caption,state,error:error||'',checkable:!!draft.publishId,
   resumable:state==='processing'&&!!draft.transfer&&draft.transfer.expiresAt>Date.now()};
 }
 edit(post,caption){
  if(this.client.transferring)throw conflict('Wait for the current TikTok request to finish.');
  if(typeof caption!=='string'||caption.length>2200)throw new Error('Use a TikTok caption of up to 2,200 characters.');
  return this.view(save(this.file(post),{...this.get(post),caption}));
 }
 async refresh(post,draft,account){
  if(account.openId!==draft.openId)throw conflict('Reconnect the TikTok account that received this video to check its status.');
  const result=await this.client.post('status/fetch',account,{publish_id:draft.publishId});
  if(!Object.hasOwn(REMOTE_STATE,result.status))throw new Error('TikTok returned an unknown upload status.');
  const state=REMOTE_STATE[result.status];
  let transfer=state==='processing'?draft.transfer:undefined;
  if(transfer&&Number.isInteger(result.uploaded_bytes)&&result.uploaded_bytes>=transfer.offset&&result.uploaded_bytes<=transfer.size){
   transfer=result.uploaded_bytes===transfer.size?undefined:{...transfer,offset:result.uploaded_bytes};
  }
  const error=state==='failed'?`TikTok could not process the video (${safeCode(result.fail_reason)}).`:
   transfer&&transfer.expiresAt<Date.now()?'The transfer expired. Check TikTok status again before retrying.':undefined;
  return save(this.file(post),{...draft,state,transfer,error});
 }
 async check(post){
  const draft=this.get(post);
  if(!draft.publishId)return this.view(draft);
  return this.lock(async()=>this.view(await this.refresh(post,draft,await this.client.account())));
 }
 async lock(task){
  if(this.client.transferring||this.client.changing)throw conflict('Wait for the current TikTok request to finish.');
  this.client.transferring=true;
  try{return await task();}finally{this.client.transferring=false;}
 }
 async send(post,consent,accountId){
  if(consent!==true||typeof accountId!=='string'||!accountId)throw new Error('Confirm that you want to send this video to the connected TikTok account.');
  const problem=tiktokVideoError(post.media);
  if(problem)throw new Error(problem);
  return this.lock(async()=>{
   const account=await this.client.account();
   if(account.openId!==accountId)throw conflict('The TikTok account changed. Reopen this post and review the connected account.');
   let draft=this.get(post);
   if(draft.publishId&&draft.state!=='failed')draft=await this.refresh(post,draft,account);
   if(!['draft','failed'].includes(draft.state)&&!this.view(draft).resumable)return this.view(draft);
   const file=await open(post.file,'r');
   try{
    const {size,mtimeMs}=await file.stat();
    if(!size||size>4_000_000_000)throw new Error('TikTok videos must be no larger than 4 GB.');
    if(!draft.transfer){
     const chunkSize=size<=64_000_000?size:CHUNK;
     const data=await this.client.post('inbox/video/init',account,{source_info:{
      source:'FILE_UPLOAD',video_size:size,chunk_size:chunkSize,total_chunk_count:Math.floor(size/chunkSize),
     }});
     if(typeof data.publish_id!=='string'||!data.publish_id)throw new Error('TikTok did not return an upload ID.');
     draft=save(this.file(post),{caption:draft.caption,state:'processing',publishId:data.publish_id,openId:account.openId,
      transfer:{url:data.upload_url,size,mtimeMs,chunkSize,offset:0,expiresAt:Date.now()+UPLOAD_WINDOW}});
    }
    const transfer=draft.transfer;
    if(transfer.size!==size||transfer.mtimeMs!==mtimeMs)throw conflict('The calendar video changed. Add the updated export as a new calendar post to send it.');
    const uploadUrl=new URL(transfer.url);
    if(uploadUrl.protocol!=='https:'||!uploadUrl.hostname.endsWith('.tiktokapis.com')||uploadUrl.username||uploadUrl.password||uploadUrl.port)throw new Error('TikTok returned an invalid upload destination.');
    const {chunkSize,offset}=transfer;
    const count=Math.floor(size/chunkSize);
    if(offset%chunkSize||offset/chunkSize>=count)throw conflict('TikTok reported an unexpected upload position. Check whether it received the video.');
    for(let i=offset/chunkSize;i<count;i++){
     const start=i*chunkSize,end=i===count-1?size-1:start+chunkSize-1;
     const chunk=Buffer.alloc(end-start+1);
     let filled=0;
     while(filled<chunk.length){
      const {bytesRead}=await file.read(chunk,filled,chunk.length-filled,start+filled);
      if(!bytesRead)throw new Error('The calendar video changed during upload.');
      filled+=bytesRead;
     }
     const response=await this.client.fetch(uploadUrl,{method:'PUT',body:chunk,redirect:'error',signal:AbortSignal.timeout(300_000),
      headers:{'Content-Type':'video/mp4','Content-Length':String(chunk.length),'Content-Range':`bytes ${start}-${end}/${size}`}});
     await response.body?.cancel();
     if(response.status!==(i===count-1?201:206))throw new Error(`TikTok video transfer returned HTTP ${response.status}. Check the upload status before trying again.`);
     draft=save(this.file(post),{...draft,transfer:end+1===size?undefined:{...transfer,offset:end+1}});
    }
    return this.view(draft);
   }finally{await file.close();}
  });
 }
}

export function registerTikTokRoutes(app,{client,drafts,posting,tiktokExports}){
 const redirect=req=>`${req.headers.origin||`http://localhost:${req.socket.localPort}`}/api/tiktok/callback`;
 const getPost=req=>{const id=req.params.id;if(tiktokExports&&fs.existsSync(path.join(tiktokExports.folder(id),'post.json')))return tiktokExports.get(id);return posting.get(id);};
 app.get('/api/tiktok/status',(req,res)=>res.json(client.status()));
 app.post('/api/tiktok/configure',(req,res)=>res.json(client.configure(req.body||{})));
 app.post('/api/tiktok/connect',(req,res)=>res.json({url:client.authorizeUrl(redirect(req))}));
 app.get('/api/tiktok/callback',async(req,res)=>{
  await client.callback(req.query);
  res.set('Cache-Control','no-store').type('html').send('<!doctype html><title>TikTok connected</title><h1>TikTok connected</h1><p>Close this window or <a href="/">return to OpenClip</a>.</p>');
 });
 app.post('/api/tiktok/disconnect',async(req,res)=>res.json(await client.disconnect()));
 app.get('/api/posting/:id/tiktok',(req,res)=>{
  const post=getPost(req);
  res.json({...drafts.view(drafts.get(post)),videoError:tiktokVideoError(post.media)});
 });
 app.get('/api/posting/:id/tiktok/video',(req,res)=>res.sendFile(getPost(req).file,{dotfiles:'allow'}));
 app.put('/api/posting/:id/tiktok',(req,res)=>res.json(drafts.edit(getPost(req),req.body?.caption)));
 app.post('/api/posting/:id/tiktok',async(req,res)=>res.json(await drafts.send(getPost(req),req.body?.consent,req.body?.accountId)));
 app.post('/api/posting/:id/tiktok/check',async(req,res)=>res.json(await drafts.check(getPost(req))));
}

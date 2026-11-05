import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {uploadBody} from './youtube.mjs';
import {writeJsonAtomic} from './atomic.mjs';
const complete=p=>!!p.videoId;
const pad=n=>String(n).padStart(2,'0');
/** Spread posts over release slots: each day gets the given clock times (local to the UTC offset), skipping slots in the past. */
// Daily batches: each post uploads a few hours before its release, on its own day, so one day never spends more than its share of YouTube's upload quota.
export const AUTO_LEAD_HOURS=3;
export const uploadTime=(publishAt,now=Date.now())=>new Date(Math.max(now,Date.parse(publishAt)-AUTO_LEAD_HOURS*3600000)).toISOString();
export function planSchedule(count,{start,times,offset='+08:00',now=Date.now(),lead=15*60000}={}){
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(start||'')))throw new Error('Choose the first release day');
 const clock=[...new Set((times||[]).map(String))].filter(t=>/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)).sort();
 if(!clock.length||clock.length>6)throw new Error('Choose 1–6 release times per day');if(!/^[+-][0-9]{2}:[0-9]{2}$/.test(offset))throw new Error('Invalid time zone offset');
 if(!Number.isInteger(count)||count<1||count>50)throw new Error('Choose 1–50 posts to schedule');
 const out=[];const day=new Date(`${start}T00:00:00Z`);
 for(let d=0;out.length<count&&d<400;d++){const date=new Date(day.getTime()+d*86400000),ymd=`${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
  for(const t of clock){const at=Date.parse(`${ymd}T${t}:00${offset}`);if(at>=now+lead)out.push(new Date(at).toISOString());if(out.length===count)break;}}
 return out;
}
export function validatePost(input,media,{existing=false}={}){
 // 'auto' follows YouTube's own rule: square or vertical and at most 3 minutes is a Short.
 const format=input.format==='auto'?(media.width<=media.height&&media.duration<=180?'shorts':'video'):input.format||'shorts',timeZone=input.timeZone||'Asia/Manila';
 if(!['shorts','video'].includes(format))throw new Error('Choose Shorts or regular video');
 if(!media?.width||!media.height||!Number.isFinite(media.duration)||media.duration<=0)throw new Error('Video metadata is missing');
 if(format==='shorts'&&(media.width>media.height||media.duration>180))throw new Error('Shorts need square or vertical footage, at most 3 minutes');
 if(format==='video'&&media.width<=media.height&&media.duration<=180)throw new Error('Use a horizontal edit for a regular video under 3 minutes; YouTube classifies square/vertical uploads as Shorts');
 try{new Intl.DateTimeFormat('en',{timeZone}).format();}catch{throw new Error('Invalid time zone');}
 const settings={privacy:'private',madeForKids:false,...input.settings};const body=uploadBody(input.metadata||{},settings,{existing});
 return {format,timeZone,metadata:body.snippet,settings:{...settings,publishAt:body.status.publishAt},label:String(input.label||body.snippet.title).slice(0,150)};
}
export class PostingQueue{
 constructor({root,youtube}){this.root=root;this.youtube=youtube;this.active=false;this.controller=null;fs.mkdirSync(root,{recursive:true});for(const p of this.list())if(p.state==='uploading')this.save({...p,state:'needs-retry',error:'App stopped during upload. Retry reconciles the saved session.'});}
 folder(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid post ID');return path.join(this.root,id);}
 get(id){return JSON.parse(fs.readFileSync(path.join(this.folder(id),'post.json'),'utf8'));}
 list(){return fs.readdirSync(this.root).filter(n=>/^[a-f0-9-]{36}$/.test(n)&&fs.existsSync(path.join(this.root,n,'post.json'))).map(n=>this.get(n)).sort((a,b)=>(a.settings.publishAt||a.createdAt).localeCompare(b.settings.publishAt||b.createdAt));}
 save(p){const file=path.join(this.folder(p.id),'post.json');writeJsonAtomic(file,{...p,updatedAt:new Date().toISOString()});return this.get(p.id);}
 public(p){const {file,...safe}=p;return {...safe,locked:fs.existsSync(path.join(this.folder(p.id),'upload.json'))||p.state==='uploading'||complete(p)};}
 create(file,media,input){const data=validatePost(input,media);const source=input.source&&typeof input.source.jobId==='string'&&typeof input.source.clipId==='string'?{jobId:input.source.jobId,clipId:input.source.clipId,videoMtime:fs.statSync(file).mtimeMs}:undefined;const id=randomUUID();fs.mkdirSync(this.folder(id));const snapshot=path.join(this.folder(id),'video.mp4');try{const disk=fs.statfsSync(this.root);if(disk.bavail*disk.bsize<fs.statSync(file).size+512*1024**2)throw new Error('Not enough free space for a finished-video snapshot');fs.copyFileSync(file,snapshot);return this.save({id,...data,...(source?{source}:{}),file:snapshot,media,state:'draft',createdAt:new Date().toISOString()});}catch(error){fs.rmSync(this.folder(id),{recursive:true,force:true});throw error;}}
 thumbnailFile(id){return path.join(this.folder(id),'thumbnail.jpg');}
 // The JPEG is rendered by thumbnails.mjs; the post only records where in the video it came from.
 setThumbnail(id,{time,text='',file}){const p=this.get(id);if(this.public(p).locked)throw new Error('This post already started uploading; set the thumbnail in YouTube Studio');if(file){fs.copyFileSync(file,this.thumbnailFile(id));}return this.save({...p,thumbnail:{time,text,updatedAt:new Date().toISOString()},thumbnailError:''});}
 clearThumbnail(id){const p=this.get(id);if(this.public(p).locked)throw new Error('This post already started uploading; change the thumbnail in YouTube Studio');fs.rmSync(this.thumbnailFile(id),{force:true});const {thumbnail:_,...rest}=p;return this.save({...rest,thumbnailError:''});}
 link(id,source){return this.save({...this.get(id),source});}
 edit(id,input){const p=this.get(id);if(this.public(p).locked)throw new Error('Upload settings are locked after transfer begins. Retry the original session.');const data=validatePost(input,p.media);return this.save({...p,...data,autoUpload:p.autoUpload&&data.settings.privacy==='schedule'?{at:uploadTime(data.settings.publishAt)}:undefined,state:'draft',error:''});}
 /** Swap a draft's video for a newer export (e.g. after fixing burned-in captions), keeping its title, description and schedule. */
 replaceVideo(id,file,media){const p=this.get(id);if(this.public(p).locked)throw new Error('This post already started uploading, so its video cannot be replaced');const data=validatePost(p,media,{existing:true});const temp=path.join(this.folder(id),'video.next.mp4');fs.copyFileSync(file,temp);fs.rmSync(p.file,{force:true});fs.renameSync(temp,p.file);return this.save({...p,...data,media,fingerprint:undefined,source:p.source&&{...p.source,videoMtime:fs.statSync(file).mtimeMs},state:'draft',error:''});}
 /** Give each chosen draft a public release slot (YouTube publishes it at that time after upload). */
 schedule(ids,plan){const posts=ids.map(id=>this.get(id));if(posts.some(p=>this.public(p).locked))throw new Error('Some selected posts already started uploading; deselect them first');const slots=planSchedule(posts.length,plan);if(slots.length<posts.length)throw new Error('Not enough future release slots');return posts.map((p,i)=>this.save({...p,...validatePost({...p,settings:{...p.settings,privacy:'schedule',publishAt:slots[i]}},p.media),autoUpload:plan.daily?{at:uploadTime(slots[i],plan.now)}:undefined,state:'draft',error:''}));}
 remove(id){const p=this.get(id);if(this.public(p).locked)throw new Error('Uploaded posts and saved upload sessions cannot be removed here');fs.rmSync(this.folder(id),{recursive:true,force:true});}
 /** The post already on YouTube (or mid-upload) for the same clip, if any. */
 postedTwin(p,list=this.list()){const same=o=>o.id!==p.id&&(complete(o)||this.public(o).locked)&&!!(p.source&&o.source)&&o.source.jobId===p.source.jobId&&o.source.clipId===p.source.clipId;return list.find(same)||null;}
 due(now=Date.now()){return this.list().filter(p=>p.autoUpload&&p.state==='draft'&&!this.public(p).locked&&Date.parse(p.autoUpload.at)<=now);}
 async tick(now=Date.now()){if(this.active||!this.youtube.status?.().connected)return [];const lock=path.join(this.root,'.auto-upload.lock');
  // Another OpenClip server on this folder may be ticking too; only one uploads.
  try{if(fs.existsSync(lock)&&Date.now()-fs.statSync(lock).mtimeMs>3*3600000)fs.rmSync(lock,{force:true});fs.writeFileSync(lock,String(process.pid),{flag:'wx'});}catch{return [];}
  try{const ready=[];for(const p of this.due(now)){if(Date.parse(p.settings.publishAt)<now+10*60000)this.save({...p,autoUpload:undefined,state:'missed',error:'The app was off when this post was due to upload. Pick a new release time.'});else ready.push(p.id);}
   if(ready.length)await this.run(ready);return ready;}finally{fs.rmSync(lock,{force:true});}}
 startAuto(every=60000){if(this.autoTimer)return;const go=()=>this.tick().catch(()=>{});this.autoTimer=setInterval(go,every);this.autoTimer.unref?.();setTimeout(go,5000).unref?.();}
 async fingerprint(p){const hash=createHash('sha256');for await(const part of fs.createReadStream(p.file))hash.update(part);return hash.digest('hex');}
 async run(ids,{allowRepeat=false}={}){if(this.active)throw new Error('A posting batch is already uploading');if(!this.youtube.status().connected)throw new Error('Connect YouTube in Automation before uploading');if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw new Error('Choose 1–50 distinct posts');for(const id of ids)this.get(id);this.active=true;this.controller=new AbortController();try{for(const id of ids){if(this.controller.signal.aborted)break;let p=this.get(id);if(complete(p))continue;const twin=!allowRepeat&&this.postedTwin(p);if(twin){this.save({...p,state:'already-posted',error:`Skipped: this clip is already on YouTube${twin.url?` (${twin.url})`:''}.`});continue;}try{const existing=fs.existsSync(path.join(this.folder(id),'upload.json'));validatePost(p,p.media,{existing});const fingerprint=await this.fingerprint(p);const duplicate=this.list().find(other=>other.id!==id&&other.fingerprint===fingerprint&&(allowRepeat?!complete(other)&&this.public(other).locked:complete(other)||this.public(other).locked));if(duplicate)throw new Error('This exact edited video already has an upload or saved session in the posting calendar');p=this.save({...p,fingerprint,repeatOf:undefined,state:'uploading',error:''});const result=await this.youtube.upload({file:p.file,sessionFile:path.join(this.folder(id),'upload.json'),metadata:p.metadata,settings:p.settings,signal:this.controller.signal,source:p.source,fingerprint,allowRepeat,via:'calendar'});this.save({...p,...result,state:result.lockedPrivate?'uploaded-private-locked':p.settings.privacy==='schedule'?'scheduled':`uploaded-${p.settings.privacy}`,uploadCompletedAt:new Date().toISOString(),thumbnailError:await this.uploadThumbnail(id,result.videoId),error:result.lockedPrivate?'YouTube uploaded this video but kept it private. Uploads from an unaudited Google Cloud project are locked private; request a YouTube API compliance audit, or publish it from YouTube Studio.':''});}catch(error){const repeat=error.code==='REPEAT_UPLOAD'?error.repeat:null;this.save({...this.get(id),state:repeat?'already-posted':'needs-retry',repeatOf:repeat?{videoId:repeat.entry.videoId,url:repeat.entry.url||'',title:repeat.entry.title||'',reason:repeat.reason}:undefined,error:error.message});}}}finally{this.active=false;this.controller=null;}}
 async uploadThumbnail(id,videoId){const file=this.thumbnailFile(id);if(!fs.existsSync(file)||!this.youtube.setThumbnail)return '';try{await this.youtube.setThumbnail(videoId,file);return '';}catch(error){return error.message;}}
 stop(){this.controller?.abort();}
}

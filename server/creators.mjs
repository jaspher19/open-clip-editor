// Creator photos for the project list: who streamed the video (from the public channel details yt-dlp saved), and
// their profile picture, read once from the public channel page's og:image tag and kept in work/creators/.
// No sign-in, no cookies, no private API. A photo the owner uploads replaces it; without either the list shows initials.
import fs from 'node:fs';import path from 'node:path';import multer from 'multer';import {WORK} from './config.mjs';
import {writeJsonAtomic} from './atomic.mjs';

export const CREATORS_DIR=path.join(WORK,'creators');
const RETRY_MS=24*3600e3,PAGE_MAX=2_500_000,PHOTO_MAX=3*1024*1024;
// Hosts the three platforms serve profile pictures from; anything else in og:image is ignored.
const IMAGE_HOSTS=/(^|\.)(googleusercontent\.com|ggpht\.com|ytimg\.com|jtvnw\.net|kick\.com)$/i;
const TYPES=[['image/jpeg',b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff],['image/png',b=>b.subarray(0,4).toString('hex')==='89504e47'],['image/webp',b=>b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'],['image/gif',b=>b.subarray(0,3).toString()==='GIF']];
export const imageType=buf=>Buffer.isBuffer(buf)&&buf.length>12?TYPES.find(([,test])=>test(buf))?.[0]||'':'';
const tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
// Channel names carry "Live", "TV", "Clips"…; the list shows the person ("Kai Cenat Live" → "Kai Cenat").
const personName=s=>tidy(String(s||'').replace(/\b(?:live|clips?|official|vods?|streams?|archive|highlights?)\b/gi,'')).replace(/^[\s|·:-]+|[\s|·:-]+$/g,'')||tidy(s);

/** Who made this project's video: {key, name, platform, handle, page}. key is null for local uploads. */
export function creatorOf(job){
 const info=job.sourceInfo||{},src=job.source||{},platform=info.platform||src.type||'upload';
 let handle='',page='';
 try{
  if(platform==='youtube'){const id=tidy(info.uploaderId);if(/^@[\w.-]{1,100}$/.test(id)){handle=id;page=`https://www.youtube.com/${id}`;}else if(/^UC[\w-]{22}$/.test(id)){handle=id;page=`https://www.youtube.com/channel/${id}`;}}
  else if(platform==='twitch'){const login=(/^[a-z0-9_]{2,25}$/i.test(info.uploaderId||'')?info.uploaderId:src.kind==='channel'?src.id:'')||'';if(login){handle=login.toLowerCase();page=`https://www.twitch.tv/${handle}`;}}
  else if(platform==='kick'){const slug=src.url?new URL(src.url).pathname.split('/').filter(Boolean)[0]:'';const s=/^[\w-]{2,40}$/.test(slug||'')?slug:/^[\w-]{2,40}$/.test(info.uploaderId||'')?info.uploaderId:'';if(s){handle=s.toLowerCase();page=`https://kick.com/${handle}`;}}
 }catch{/* odd URL: no page */}
 const raw=info.uploader||info.channel||job.host?.name||'';
 const name=raw?personName(raw):platform==='upload'?'':handle.replace(/^@/,'');
 const key=handle?`${platform}-${handle.replace(/^@/,'').toLowerCase()}`.replace(/[^a-z0-9_.-]/g,'_'):null;
 return {key,name:name.slice(0,60),platform,handle,page};
}
/** Photo key for a project: its creator's key, or the project itself for a local upload. */
export const photoKey=job=>creatorOf(job).key||`project-${job.id}`;

/** Find the profile picture URL in a public channel page (og:image), or ''. */
export function ogImage(html){
 for(const tag of String(html).match(/<meta\b[^>]*>/gi)||[]){
  if(!/(?:property|name)\s*=\s*["']og:image["']/i.test(tag))continue;
  const m=tag.match(/content\s*=\s*["']([^"']+)["']/i);if(!m)continue;
  const url=m[1].replace(/&amp;/g,'&');try{const u=new URL(url);if(u.protocol==='https:'&&IMAGE_HOSTS.test(u.hostname))return u.href;}catch{}
 }
 return '';
}
async function readCapped(response,max){
 const reader=response.body?.getReader?.();if(!reader)return Buffer.from(await response.arrayBuffer()).subarray(0,max);
 const parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;parts.push(Buffer.from(value));size+=value.length;if(size>=max){reader.cancel().catch(()=>{});break;}}
 return Buffer.concat(parts).subarray(0,max);
}

export class CreatorPhotos{
 constructor({root=CREATORS_DIR,fetchImpl=globalThis.fetch,now=Date.now}={}){this.root=root;this.fetch=fetchImpl;this.now=now;this.inflight=new Map();fs.mkdirSync(root,{recursive:true});}
 file(key,kind){if(!/^[a-z0-9_.-]{1,140}$/.test(key))throw new Error('Invalid creator');return path.join(this.root,`${key}.${kind}`);}
 meta(key){try{return JSON.parse(fs.readFileSync(this.file(key,'json'),'utf8'));}catch{return {};}}
 /** {file, type} of the photo to show, custom first, or null. */
 current(key){for(const kind of ['custom','auto']){const f=this.file(key,kind);if(fs.existsSync(f)){const type=imageType(fs.readFileSync(f).subarray(0,16));if(type)return {file:f,type,custom:kind==='custom'};}}return null;}
 /** The photo for `job`, fetching the creator's public profile picture the first time (once a day after a miss). */
 async photo(job){
  const key=photoKey(job),have=this.current(key);if(have)return have;
  const c=creatorOf(job);if(!c.page)return null;
  const m=this.meta(key);if(m.failedAt&&this.now()-Date.parse(m.failedAt)<RETRY_MS)return null;
  if(!this.inflight.has(key))this.inflight.set(key,this.download(key,c.page).finally(()=>this.inflight.delete(key)));
  await this.inflight.get(key);return this.current(key);
 }
 async download(key,page){
  const headers={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenClip','accept-language':'en'};
  try{
   const r=await this.fetch(page,{headers,redirect:'follow',signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`page ${r.status}`);
   const url=ogImage((await readCapped(r,PAGE_MAX)).toString('utf8'));if(!url)throw new Error('no profile picture on the page');
   const img=await this.fetch(url,{headers,signal:AbortSignal.timeout(12000)});if(!img.ok)throw new Error(`image ${img.status}`);
   const buf=await readCapped(img,PHOTO_MAX+1);if(buf.length>PHOTO_MAX||!imageType(buf))throw new Error('not an image');
   fs.writeFileSync(this.file(key,'auto'),buf);writeJsonAtomic(this.file(key,'json'),{page,image:url,fetchedAt:new Date(this.now()).toISOString()});
  }catch(e){writeJsonAtomic(this.file(key,'json'),{page,failedAt:new Date(this.now()).toISOString(),error:String(e.message||e).slice(0,200)});}
 }
 setCustom(key,buf){if(!imageType(buf))throw new Error('Choose a JPG, PNG, WebP or GIF picture');if(buf.length>PHOTO_MAX)throw new Error('Pictures can be up to 3 MB');fs.writeFileSync(this.file(key,'custom'),buf);}
 clearCustom(key){fs.rmSync(this.file(key,'custom'),{force:true});}
}

export function registerCreatorRoutes(app,{store,photos=new CreatorPhotos(),fail}){
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:PHOTO_MAX,files:1,fields:0}});
 const job=req=>{try{return store.get(req.params.id);}catch{throw fail('Project not found',404);}};
 app.get('/api/jobs/:id/creator/photo',async(req,res)=>{const p=await photos.photo(job(req));if(!p)return res.status(204).set('Cache-Control','no-cache').end();res.set({'Cache-Control':'no-cache','Content-Type':p.type,'X-Content-Type-Options':'nosniff'}).send(fs.readFileSync(p.file));});
 app.post('/api/jobs/:id/creator/photo',upload.single('photo'),(req,res)=>{const j=job(req);if(!req.file)throw fail('Choose a picture');try{photos.setCustom(photoKey(j),req.file.buffer);}catch(e){throw fail(e.message);}res.json({ok:true,custom:true});});
 app.delete('/api/jobs/:id/creator/photo',(req,res)=>{photos.clearCustom(photoKey(job(req)));res.json({ok:true,custom:false});});
 return photos;
}

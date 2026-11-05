import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import multer from 'multer';import {run} from './process.mjs';
// Reusable background tracks for every project, kept in work/music-library/ (inside the project folder, never on C:).
export const MUSIC_TYPES=['.mp3','.wav','.m4a','.ogg','.flac'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const safeName=original=>{const ext=path.extname(original).toLowerCase(),base=path.basename(original,path.extname(original)).normalize('NFKD').replace(/[^\w .()-]/g,'').replace(/\s+/g,' ').trim().slice(0,60)||'track';return {base,ext};};

export class MusicLibrary{
 constructor(root){this.root=root;fs.mkdirSync(root,{recursive:true});this.indexFile=path.join(root,'index.json');}
 index(){try{return JSON.parse(fs.readFileSync(this.indexFile,'utf8'));}catch{return {};}}
 /** Library tracks, newest first, with durations cached by name + mtime. */
 async list(){
  const index=this.index(),out=[];let changed=false;
  for(const name of fs.readdirSync(this.root)){if(!MUSIC_TYPES.includes(path.extname(name).toLowerCase()))continue;const stat=fs.statSync(path.join(this.root,name)),key=`${stat.mtimeMs}:${stat.size}`;
   if(index[name]?.key!==key){const duration=await this.duration(path.join(this.root,name)).catch(()=>null);index[name]={key,duration};changed=true;}
   out.push({name,duration:index[name].duration,bytes:stat.size,addedAt:stat.mtime.toISOString()});}
  if(changed)fs.writeFileSync(this.indexFile,JSON.stringify(index));
  return out.sort((a,b)=>b.addedAt.localeCompare(a.addedAt));
 }
 async duration(file){const data=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]);const meta=JSON.parse(data.stdout);if(!meta.streams?.some(s=>s.codec_type==='audio'))throw fail('This file does not contain a readable audio track');const d=Number(meta.format?.duration);if(!Number.isFinite(d))throw fail('This file does not contain a readable audio track');return +d.toFixed(2);}
 /** Absolute path of a library track, or null; names are checked so nothing outside the library is reachable. */
 file(name){if(typeof name!=='string'||!name||name!==path.basename(name)||!MUSIC_TYPES.includes(path.extname(name).toLowerCase()))return null;const file=path.join(this.root,name);return fs.existsSync(file)?file:null;}
 upload(){return multer({storage:multer.diskStorage({destination:(req,file,cb)=>cb(null,this.root),filename:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();if(!MUSIC_TYPES.includes(ext))return cb(fail('Choose an MP3, WAV, M4A, OGG or FLAC music file'));cb(null,`incoming-${randomUUID()}${ext}`);}}),limits:{fileSize:200*1024**2,files:1,fields:2}});}
 /** Check an uploaded file and give it a readable, unique name in the library. */
 async accept(upload){
  try{const duration=await this.duration(upload.path);const {base,ext}=safeName(upload.originalname);let name=`${base}${ext}`,n=2;while(fs.existsSync(path.join(this.root,name)))name=`${base} (${n++})${ext}`;fs.renameSync(upload.path,path.join(this.root,name));return {name,duration,bytes:fs.statSync(path.join(this.root,name)).size};}
  catch(e){fs.rmSync(upload.path,{force:true});throw e;}
 }
}

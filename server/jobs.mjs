import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {EventEmitter} from 'node:events';import {WORK} from './config.mjs';import {validateOptions} from './options.mjs';
import {writeJsonAtomic,replaceFile} from './atomic.mjs';import {EDIT_TEMPLATES} from './templates.mjs';
// Moment shapes of the templates that pick their own kind of moment, so the web app checks lengths the same way.
const MOMENTS=Object.fromEntries(EDIT_TEMPLATES.filter(t=>t.moment).map(t=>[t.id,t.moment]));
export class JobStore extends EventEmitter{
 constructor(root=WORK){super();this.root=root;fs.mkdirSync(root,{recursive:true});this.purgeDeleted();}
 folder(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid job ID');return path.join(this.root,id);}
 create(source,options={}){const now=new Date().toISOString();const job={id:randomUUID(),source,options:validateOptions(options),status:'queued',stage:'queued',progress:0,message:'Waiting to start',createdAt:now,updatedAt:now,clips:[],exports:[],log:[]};fs.mkdirSync(this.folder(job.id),{recursive:true});this.save(job);return job;}
 get(id){const f=path.join(this.folder(id),'job.json');if(!fs.existsSync(f))throw new Error('Job not found');return JSON.parse(fs.readFileSync(f,'utf8'));}
 save(job){job.updatedAt=new Date().toISOString();const f=path.join(this.folder(job.id),'job.json');writeJsonAtomic(f,job);this.emit('update',job);return job;}
 update(id,patch){return this.save({...this.get(id),...patch});}
 exists(id){try{return fs.existsSync(path.join(this.folder(id),'job.json'));}catch{return false;}}
 /** Delete the project folder (source video, transcript, exports) from disk. The folder is first moved aside in one step,
  so a file Windows still has open fails the delete cleanly instead of leaving half a project; leftovers are purged on start. */
 remove(id){const folder=this.folder(id);this.get(id);const trash=path.join(this.root,`.deleted-${id}-${Date.now()}`);
  try{replaceFile(folder,trash);}catch(error){if(['EPERM','EACCES','EBUSY'].includes(error.code))throw new Error('Some project files are still in use. Close any player showing this project and try again.');throw error;}
  this.emit('remove',id);this.purgeDeleted();}
 purgeDeleted(){for(const f of fs.readdirSync(this.root))if(f.startsWith('.deleted-'))try{fs.rmSync(path.join(this.root,f),{recursive:true,force:true,maxRetries:8,retryDelay:150});}catch{}}
 list(){return fs.readdirSync(this.root,{withFileTypes:true}).filter(f=>f.isDirectory()&&/^[a-f0-9-]{36}$/.test(f.name)).flatMap(f=>{try{return [this.get(f.name)];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 recover(){for(const j of this.list())if(['running','queued','exporting'].includes(j.status))this.update(j.id,{status:'interrupted',message:'Processing was interrupted. Retry to continue from saved work.'});}
}
export function publicJob(job){const {sourcePath,musicPath,source,...safe}=job;return {...safe,source:{type:source.type,name:source.name||'',url:source.url||'',section:source.section||null},sourceUrl:sourcePath?`/api/jobs/${job.id}/source`:null,moments:MOMENTS};}

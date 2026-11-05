import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {writeJsonAtomic} from './atomic.mjs';
// Every finished YouTube upload, from the posting calendar or an automation, kept in one file so a clip never goes up twice by accident.
// The log outlives the posts themselves: deleting a draft folder or a whole project does not forget what is already on the channel.
const titleKey=t=>String(t||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const videoKey=url=>{const m=String(url||'').match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/);return m?m[1]:String(url||'');};
/** Seconds two source ranges share, as a share of the shorter one. */
const overlap=(a,b)=>{const shared=Math.min(a.end,b.end)-Math.max(a.start,b.start),shorter=Math.min(a.end-a.start,b.end-b.start);return shared>0&&shorter>0?shared/shorter:0;};
export const REPEAT_OVERLAP=.5;
export async function fileFingerprint(file){const hash=createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);return hash.digest('hex');}
export class UploadLog{
 constructor(file){this.file=file;fs.mkdirSync(path.dirname(file),{recursive:true});}
 list(){try{const data=JSON.parse(fs.readFileSync(this.file,'utf8'));return Array.isArray(data.uploads)?data.uploads:[];}catch{return [];}}
 /** Add one finished upload; a videoId already logged is updated in place, so backfills and retries never double-count. */
 record(entry){if(!entry?.videoId)return null;const list=this.list(),i=list.findIndex(e=>e.videoId===entry.videoId),row={...list[i],...entry,source:entry.source&&{...entry.source,video:videoKey(entry.source.video)},uploadedAt:entry.uploadedAt||list[i]?.uploadedAt||new Date().toISOString()};if(i>=0)list[i]=row;else list.push(row);writeJsonAtomic(this.file,{uploads:list});return row;}
 /** The earlier upload this one would repeat, and why: the exact same file, the same clip, most of the same stream moment, or the same title. */
 findRepeat({fingerprint,source,title}={}){const list=this.list(),name=titleKey(title),video=source&&videoKey(source.video),span=source&&Number.isFinite(source.start)&&Number.isFinite(source.end)&&source.end>source.start;
  for(const e of list){if(fingerprint&&e.fingerprint===fingerprint)return {entry:e,reason:'the exact same video file'};}
  for(const e of list){if(source?.jobId&&source.clipId&&e.source?.jobId===source.jobId&&e.source.clipId===source.clipId)return {entry:e,reason:'the same clip'};}
  for(const e of list){const s=e.source;if(!span||!s||!Number.isFinite(s.start)||!Number.isFinite(s.end))continue;const same=(video&&s.video===video)||(source.jobId&&s.jobId===source.jobId);const share=same?overlap(source,s):0;if(share>=REPEAT_OVERLAP)return {entry:e,reason:`${Math.round(share*100)}% of the same stream moment`};}
  for(const e of list){if(name&&titleKey(e.title)===name)return {entry:e,reason:'the same title'};}
  return null;}
}
export const repeatMessage=({entry,reason})=>`Skipped: this repeats ${reason} already uploaded${entry.uploadedAt?` on ${entry.uploadedAt.slice(0,10)}`:''}${entry.url?` (${entry.url})`:''}. Use “Upload anyway” if you really want a second copy.`;
/**
 * Wrap a YouTube client so every upload is checked against the log first and recorded once it finishes.
 * `describe(source)` fills in the clip's stream range and source link from the project, when it still exists.
 */
export function guardUploads(youtube,log,describe=()=>({})){
 const upload=async({source,allowRepeat=false,via='calendar',...args})=>{
  const fingerprint=args.fingerprint||await fileFingerprint(args.file),info=source?{...source,...describe(source)}:undefined;
  if(!allowRepeat){const hit=log.findRepeat({fingerprint,source:info,title:args.metadata?.title});if(hit)throw Object.assign(new Error(repeatMessage(hit)),{code:'REPEAT_UPLOAD',repeat:hit});}
  const {fingerprint:_,...rest}=args;const result=await youtube.upload(rest);
  log.record({videoId:result.videoId,url:result.url,title:args.metadata?.title||'',format:info?.format,via,privacy:args.settings?.privacy,publishAt:args.settings?.publishAt,fingerprint,source:info&&{jobId:info.jobId,clipId:info.clipId,video:info.video,start:info.start,end:info.end},repeatAllowed:allowRepeat||undefined});
  return result;};
 return new Proxy(youtube,{get(target,key){if(key==='upload')return upload;if(key==='uploadLog')return log;const value=target[key];return typeof value==='function'?value.bind(target):value;}});
}

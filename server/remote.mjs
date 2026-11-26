// Importing YouTube, Twitch and Kick links, and fetching full-quality sections of long streams on demand.
//
// Long streams are not downloaded whole: a 10-hour Twitch VOD is about 33 GB at 1080p60 but about 2.5 GB
// at 360p with the same audio. Streams longer than PROXY_AFTER are imported as a light copy that drives
// transcription, moment picking and the editor preview. When a clip is rendered, only the source windows it
// uses are downloaded at up to 1080p (`ensureSection`). Stream-copied HLS/DASH sections start near, not
// exactly at, the requested time, so each section's true start is measured by matching its audio against
// the light copy's audio (workers/align.py); captions and cuts then land on the same frames as before.
import fs from 'node:fs';import path from 'node:path';
import {run,probe} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';import {writeJsonAtomic} from './atomic.mjs';
import {importYouTube,FORMAT as YOUTUBE_FULL} from './ingest.mjs';import {explainRefusal,updateMayHelp,updateDownloader} from './ytdlp.mjs';import {prepareAudio} from './audio.mjs';import {PLATFORMS} from './sources.mjs';

const num=(v,d)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:d;};
export const PROXY_AFTER=num(process.env.SOURCE_PROXY_AFTER_MINUTES,90)*60;
export const PROXY_HEIGHT=Math.round(Math.min(720,Math.max(160,num(process.env.SOURCE_PROXY_HEIGHT,360))));
export const MAX_SOURCE_HOURS=30;
/** Seconds of extra footage kept on each side of a downloaded section, so an alignment shift still covers the clip. */
export const SECTION_PAD=8;
const MIN_CONFIDENCE=.35,MAX_SHIFT=SECTION_PAD-1;

const BASE=()=>['-m','yt_dlp','--no-playlist','--no-cache-dir','--js-runtimes',`node:${process.execPath}`,'--socket-timeout','20','--retries','3','--extractor-retries','2','--fragment-retries','10'];
// Twitch and Kick serve muxed HLS renditions (160p … 1080p60); YouTube serves separate video and audio.
/**
 * yt-dlp format selector. Quality limits apply to the short side: a vertical stream's 1080p is 1080×1920, so with
 * `portrait` the limits move from height to width (otherwise 1080p vertical lost to 608×1080, and the light copy to 202×360).
 */
export function formatFor(platform,mode,height=PROXY_HEIGHT,{portrait=false,section=1080}={}){const sel=selector(platform,mode,height,section);return portrait?sel.replace(/\[height(?=[<>=?])/g,'[width'):sel;}
function selector(platform,mode,height,section=1080){
 if(platform==='youtube'){
  if(mode==='full')return YOUTUBE_FULL;
  if(mode==='proxy')return `bv*[vcodec^=avc1][height<=${height}]+ba[acodec^=mp4a]/bv*[height<=${height}]+ba/b[height<=${height}]/wv*+ba/w`;
  // Sections: YouTube throttles ffmpeg's many small range requests on a plain file (a 12 s section took over 4 min),
  // while its HLS formats come in small segments (75 s of 1080p in 9 s), so HLS first.
  const prefer4k=section===2160?'bv*[protocol^=m3u8][height=2160]+ba[protocol^=m3u8]/b[protocol^=m3u8][height=2160]/bv*[height=2160]+ba/b[height=2160]/bv*[height>1080][height<2160]+ba/b[height>1080][height<2160]/':'';
  return `${prefer4k}bv*[protocol^=m3u8][vcodec^=avc1][height<=${section}]+ba[protocol^=m3u8]/bv*[protocol^=m3u8][height<=${section}]+ba[protocol^=m3u8]/b[protocol^=m3u8][height<=${section}]/bv*[vcodec^=avc1][height<=${section}]+ba[acodec^=mp4a]/bv*[height<=${section}]+ba/b[height<=${section}]`;
 }
 if(mode==='proxy')return `b[height<=${height}][vcodec!=none]/w[vcodec!=none]`;
 // Twitch clips also offer vertical 'portrait-*' crops (we frame our own) and 1440p; Kick clips list one stream with no height or codec.
 return `b[height<=${section}][vcodec!=none][format_id!*=portrait]/b[height<=?${section}][vcodec!=?none][format_id!*=portrait]/b[vcodec!=?none]`;
}
/** Pick how to import: a light copy for long streams, the whole file otherwise. Clip links are always downloaded whole. */
export function importMode(source,duration){return source.kind!=='clip'&&duration>PROXY_AFTER?'proxy':'full';}
/** Rough bytes on disk, for the free-space check: light copies run ~0.7 Mb/s, full 1080p60 up to ~9.5 Mb/s, plus 16 kHz speech audio. */
export function estimateBytes(mode,duration){return duration*((mode==='proxy'?720_000:9_500_000)/8+32_000);}

function liveReason(info){
 const status=info.live_status||'';
 if(info.is_live||status==='is_live')return 'This stream is still live. Wait for it to end, then paste the past-broadcast link.';
 if(status==='is_upcoming')return 'This stream has not started yet.';
 if(status==='post_live')return 'This stream just ended and is still being processed. Try again in a few minutes.';
 return '';
}
export function sourceInfoFrom(info,source){
 const chapters=(info.chapters||[]).filter(c=>Number.isFinite(c.start_time)&&Number.isFinite(c.end_time)&&c.end_time>c.start_time).slice(0,200).map(c=>({start:c.start_time,end:c.end_time,title:String(c.title||'').slice(0,120)}));
 return {platform:source.type,kind:source.kind||'video',uploader:info.uploader||info.channel||info.creator||'',channel:info.channel||info.uploader||'',uploaderId:info.uploader_id||info.channel_id||'',tags:(info.tags||[]).slice(0,20),categories:(info.categories||[]).slice(0,5).map(String),chapters,timestamp:Number.isFinite(info.timestamp)?info.timestamp:null,webpageUrl:info.webpage_url||source.url};
}
function freeBytes(folder){try{const s=fs.statfsSync(folder);return Number(s.bavail)*Number(s.bsize);}catch{return Infinity;}}

export async function inspectSource(source,{signal,runCommand=run,update=updateDownloader}={}){
 const ask=()=>runCommand(PYTHON,[...BASE(),'--skip-download','--dump-single-json',source.url],{signal,timeout:180000,maxOutput:40_000_000});
 let r;
 try{r=await ask();}
 catch(e){
  if(signal?.aborted)throw new Error('Job cancelled');
  // A refusal a newer yt-dlp often fixes (bot check, site change): update it once and try again.
  const updated=updateMayHelp(e.message)&&await update();
  if(!updated)throw new Error(explainRefusal(PLATFORMS[source.type],e.message));
  try{r=await ask();}catch(again){if(signal?.aborted)throw new Error('Job cancelled');throw new Error(explainRefusal(PLATFORMS[source.type],again.message,{updated:true}));}
 }
 return JSON.parse(r.stdout);
}

// ---- Streams that are still live ------------------------------------------------------------------------
// YouTube keeps a live stream's past as numbered fragments and Twitch records it into a growing past broadcast, so
// "the stream so far" can be imported like a finished VOD: a light copy from the start to now, and full-quality
// sections later (workers/live_grab.py). Kick only shares the last few seconds while live.
/** A plain reason when the platform no longer serves the video at all. */
export function gone(message=''){
 if(/private video/i.test(message))return 'The streamer made this video private, so its full-quality footage can no longer be downloaded.';
 if(/video (is )?unavailable|has been removed|no longer available/i.test(message))return 'This video was removed, so its full-quality footage can no longer be downloaded.';
 return null;
}
/** True when the project's source is taller than wide (the light copy keeps the stream's shape). */
export const portraitJob=job=>Number(job.metadata?.height)>Number(job.metadata?.width);
export const LIVE_PLATFORMS=['youtube','twitch'];
// YouTube streams that just ended ("post_live", still processing) keep the same fragments, so they import the same way.
const isLiveNow=info=>!!info.is_live||info.live_status==='is_live'||info.live_status==='post_live';

/** Run workers/live_grab.py. Returns {start, duration, elapsed}, or null when the stream is not live anymore. */
export async function grabLive(remote,file,{from=null,to=null,height=1080,threads=8,signal,runCommand=run,logFile,onProgress,infoFile}={}){
 file=path.resolve(file);
 let done=null,error=null;
 const args=[path.join(ROOT,'workers','live_grab.py'),remote.url,file,'--platform',remote.platform,'--height',String(height),'--threads',String(threads),'--node',process.execPath,...(from!==null?['--from',String(from)]:[]),...(to!==null?['--to',String(to)]:[]),...(infoFile?['--info',infoFile]:[])];
 try{await runCommand(PYTHON,args,{cwd:path.dirname(file),signal,timeout:8*3600*1000,idleTimeout:10*60*1000,logFile,onLine:line=>{let e;try{e=JSON.parse(line);}catch{return;}if(e.done)done=e;else if(e.error)error=e.error;else if(Number.isFinite(e.progress))onProgress?.(e.progress);}});}
 catch(e){if(signal?.aborted)throw new Error('Job cancelled');if(error==='not-live')return null;throw new Error(gone(error||e.message)||`${PLATFORMS[remote.platform]} live download failed: ${error||e.message}`);}
 if(error==='not-live')return null;if(!done)throw new Error('The live download stopped before it finished');return done;
}

/** A Twitch channel's in-progress past broadcast: {source, info}. Explains offline channels and channels that keep no broadcasts. */
export async function currentBroadcast(channel,{signal,runCommand=run,inspect=inspectSource}={}){
 const name=channel.id;let vod=null;
 try{const r=await runCommand(PYTHON,[...BASE(),'--flat-playlist','-I','1','--print','url',`https://www.twitch.tv/${name}/videos?filter=archives&sort=time`],{signal,timeout:120000});vod=String(r.stdout).match(/twitch\.tv\/videos\/(\d{6,14})/)?.[1]||null;}
 catch(e){if(signal?.aborted)throw new Error('Job cancelled');}
 if(vod){const source={type:'twitch',kind:'video',id:vod,url:`https://www.twitch.tv/videos/${vod}`,channel:name};const info=await inspect(source,{signal,runCommand});if(isLiveNow(info))return {source,info};}
 let liveNow=false;try{liveNow=isLiveNow(await inspect({type:'twitch',url:channel.url},{signal,runCommand}));}catch(e){if(signal?.aborted)throw e;}
 throw new Error(liveNow?`${name} is live, but the channel does not save past broadcasts, so the stream so far cannot be downloaded. Paste a clip instead.`:`${name} is not live right now. Paste one of their past broadcasts (twitch.tv/videos/…) or a clip.`);
}

async function importLive(source,folder,info,{signal,onProgress,runCommand,probeFile}){
 const started=Number(info.release_timestamp||info.timestamp)||0,elapsed=Number(info.duration)||(started?Date.now()/1000-started:0);
 if(elapsed>MAX_SOURCE_HOURS*3600)throw new Error(`This stream has been live for over ${MAX_SOURCE_HOURS} hours. Paste a shorter broadcast.`);
 const need=estimateBytes('proxy',elapsed||36000)*1.2+2e9,free=freeBytes(folder);
 if(free<need)throw new Error(`Not enough free disk space: this import needs about ${(need/1e9).toFixed(1)} GB and ${(free/1e9).toFixed(1)} GB is free.`);
 writeJsonAtomic(path.join(folder,'source.info.json'),{...info,formats:undefined,requested_formats:undefined,thumbnails:undefined,automatic_captions:undefined,subtitles:undefined,heatmap:undefined});
 const file=path.join(folder,'source.mp4');let shown=0;
 const got=await grabLive({platform:source.type,url:source.url},file,{height:PROXY_HEIGHT,threads:16,signal,runCommand,logFile:path.join(folder,'download.log'),onProgress:p=>{if(p>shown){shown=p;onProgress?.(p,'live');}}});
 if(!got)throw new Error('This stream just ended. Wait a few minutes for the past broadcast, then paste the link again.');
 await zeroStart(file,{signal,runCommand});const meta=await probeFile(file,{signal}),at=new Date().toISOString();
 const title=String(info.title||info.fulltitle||`${PLATFORMS[source.type]} stream`).replace(/\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,'').slice(0,200);
 const remote={platform:source.type,url:source.url,proxy:true,live:true,liveAt:at,proxyHeight:meta.height||PROXY_HEIGHT,duration:meta.duration||got.duration,sourceHeight:Number(info.height)||null,...(started?{startedAt:started}:{}),...(source.type==='twitch'&&(source.channel||info.uploader_id)?{channel:source.channel||info.uploader_id}:{})};
 return {path:file,title,duration:meta.duration||got.duration,sourceInfo:{...sourceInfoFrom(info,source),live:{at,seconds:Math.round(meta.duration||got.duration)}},remote,...(source.type==='youtube'?{youtubeId:source.id}:{})};
}

/**
 * Import a YouTube, Twitch or Kick link into `folder`. Returns {path,title,sourceInfo,remote,duration};
 * `remote` is set when only a light copy was downloaded and renders must fetch full-quality sections.
 */
export async function importSource(source,folder,{signal,onProgress,runCommand=run,inspect=inspectSource,probeFile=probe}={}){
 // Recorded-stream sections from automations keep the original YouTube path.
 if(source.type==='youtube'&&source.section){const r=await importYouTube(source.url,folder,{signal,onProgress,section:source.section});return {...r,remote:null,sourceInfo:{platform:'youtube',kind:'video',...r.sourceInfo}};}
 fs.mkdirSync(folder,{recursive:true});
 // A Twitch channel link: follow it to the broadcast it is recording now.
 let resolved=null,info;
 if(source.kind==='channel'){({source:resolved,info}=await currentBroadcast(source,{signal,runCommand,inspect}));source=resolved;}
 else info=await inspect(source,{signal,runCommand});
 // Still live on YouTube or Twitch: import everything streamed so far.
 if(isLiveNow(info)&&LIVE_PLATFORMS.includes(source.type))return {...await importLive(source,folder,info,{signal,onProgress,runCommand,probeFile}),resolved};
 const live=liveReason(info);if(live)throw new Error(live);
 const duration=Number(info.duration)||0;if(!duration)throw new Error(`${PLATFORMS[source.type]} did not report how long this video is, so it cannot be imported safely.`);
 if(duration>MAX_SOURCE_HOURS*3600)throw new Error(`This video is over ${MAX_SOURCE_HOURS} hours long. Paste a shorter broadcast.`);
 const mode=importMode(source,duration),need=estimateBytes(mode,duration)*1.15+2e9,free=freeBytes(folder);
 if(free<need)throw new Error(`Not enough free disk space: this import needs about ${(need/1e9).toFixed(1)} GB and ${(free/1e9).toFixed(1)} GB is free.`);
 writeJsonAtomic(path.join(folder,'source.info.json'),{...info,formats:undefined,requested_formats:undefined,thumbnails:undefined,automatic_captions:undefined,subtitles:undefined,heatmap:undefined});
 const args=[...BASE(),'--newline','--progress-template','download:download:%(progress._percent_str)s','--concurrent-fragments','8','-f',formatFor(source.type,mode,PROXY_HEIGHT,{portrait:Number(info.height)>Number(info.width)}),'--merge-output-format','mp4','--windows-filenames','-o',path.join(folder,'source.%(ext)s')];
 if(mode==='full'&&source.type==='youtube')args.push('--max-filesize','4G');
 // Parallel fragments report out of order; progress only moves forward.
 let shown=0;
 await runCommand(PYTHON,[...args,source.url],{cwd:folder,signal,timeout:6*3600*1000,idleTimeout:10*60*1000,logFile:path.join(folder,'download.log'),onLine:line=>{const m=line.match(/download:\s*([\d.]+)%/);if(m&&Number(m[1])/100>shown){shown=Number(m[1])/100;onProgress?.(shown,mode);}}}).catch(e=>{if(signal?.aborted)throw new Error('Job cancelled');throw new Error(`${PLATFORMS[source.type]} download failed. The video may be unavailable, or the platform refused the request; a local upload still works. ${e.message}`);});
 const filename=fs.readdirSync(folder).find(f=>/^source\.(mp4|mkv|webm|mov)$/.test(f));
 if(!filename){for(const f of fs.readdirSync(folder))if(/^source\.f[\w-]+\./.test(f))fs.rmSync(path.join(folder,f),{force:true});throw new Error(mode==='full'&&source.type==='youtube'?'This video is over 4 GB. Import a section of it or upload a local file.':`${PLATFORMS[source.type]} did not return a supported video file`);}
 const file=path.join(folder,filename);await zeroStart(file,{signal,runCommand});const meta=await probeFile(file,{signal});
 const title=String(info.title||info.fulltitle||`${PLATFORMS[source.type]} video`).slice(0,200);
 const remote=mode==='proxy'?{platform:source.type,url:source.url,proxy:true,proxyHeight:meta.height||PROXY_HEIGHT,duration:meta.duration||duration,sourceHeight:Number(info.height)||null}:null;
 return {path:file,title,duration:meta.duration||duration,sourceInfo:sourceInfoFrom(info,source),remote,...(source.type==='youtube'?{youtubeId:source.id}:{})};
}

/**
 * Twitch VOD copies can start at a timestamp other than zero (62.0 s on a real 5 h VOD): the MP4 then reports
 * start + length as its duration, while the extracted speech audio holds only the real length. A stream copy
 * (no re-encode) rewrites the timeline to start at zero, so the transcript, the probe, the browser preview and
 * render seeks all share one clock. Returns the offset that was removed.
 */
export async function zeroStart(file,{signal,runCommand=run}={}){
 let offset=0;try{const r=await runCommand('ffprobe',['-v','error','-show_entries','format=start_time','-of','csv=p=0',file],{signal});offset=Number(String(r.stdout).trim());}catch(e){if(signal?.aborted)throw e;return 0;}
 if(!Number.isFinite(offset)||Math.abs(offset)<.05)return 0;
 const temp=file.replace(/(\.\w+)$/,'.zero$1');
 try{await runCommand('ffmpeg',['-v','error','-nostdin','-y','-i',file,'-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',temp],{signal,timeout:2*3600*1000});fs.renameSync(temp,file);}
 finally{if(fs.existsSync(temp))fs.rmSync(temp,{force:true});}
 return offset;
}

// ---- Full-quality sections -------------------------------------------------------------------------------

const indexFile=folder=>path.join(folder,'hires','sections.json');
export function readSections(folder){try{const list=JSON.parse(fs.readFileSync(indexFile(folder),'utf8'));return Array.isArray(list)?list.filter(s=>s&&typeof s.file==='string'&&fs.existsSync(path.join(folder,'hires',s.file))):[];}catch{return [];}}
/** A section well below the stream's own quality (short side under 720p, or under the source when that is lower). */
export const lowQuality=(job,s)=>{const want=Math.min(720,Number(job.remote?.sourceHeight)||720),side=Math.min(Number(s.width)||0,Number(s.height)||0);return side>0&&side<want;};
const covers=(s,start,end)=>s.start<=start+1e-3&&s.end>=end-1e-3;
// At the very start of a stream, an aligned section begins a few frames in (seen: 0.1 s): nothing exists before
// that, so a section starting within half a second covers a moment that starts at 0.
export const sectionCovers=(s,start,end)=>covers(s,start,end)||(start<.5&&s.start<=.5&&s.end>=end-1e-3);
/** Downloads in flight, per job folder, so a prefetch and a render never fetch the same window twice. */
const inflight=new Map();let writeChain=Promise.resolve();
function forget(folder,file){writeChain=writeChain.then(()=>writeJsonAtomic(indexFile(folder),readSections(folder).filter(s=>s.file!==file)));return writeChain;}
function remember(folder,entry){writeChain=writeChain.then(()=>{const list=readSections(folder).filter(s=>s.file!==entry.file);list.push(entry);writeJsonAtomic(indexFile(folder),list.sort((a,b)=>a.start-b.start));});return writeChain;}

/** Measure where a downloaded section starts in source time. Falls back to the requested start when the audio is too quiet to match (for example a muted stretch). */
export async function alignSection({folder,file,expected,runCommand=run,signal}){
 try{const r=await runCommand(PYTHON,['-I',path.join(ROOT,'workers/align.py'),path.join(folder,'audio.wav'),file,String(expected),'--radius',String(SECTION_PAD+4)],{signal,timeout:180000});const out=JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  if(Number.isFinite(out.start)&&out.confidence>=MIN_CONFIDENCE&&Math.abs(out.shift)<=MAX_SHIFT)return {start:out.start,confidence:out.confidence,aligned:true};
  return {start:expected,confidence:Number(out.confidence)||0,aligned:false};}
 catch(e){if(signal?.aborted)throw e;return {start:expected,confidence:0,aligned:false};}
}

/**
 * Make sure a full-quality file covers source time [start,end] and return {file, start, end}: `start` is the source time of
 * the file's time zero, so input seek = sourceTime - start. Reuses cached and in-flight sections.
 */
// Near the very end of a stream the full-quality copy can run a little shorter than the light copy, so the last second is not required.
/**
 * Video frames ffmpeg actually reads from `file` versus frames stored in it. A wrong edit list (seen in YouTube live
 * sections) hides most frames: the file plays its sound over a missing picture and renders fail. Null when unknown.
 */
export async function sectionFrames(file,{signal}={}){
 const count=async extra=>{const r=await run('ffprobe',['-v','error',...extra,'-select_streams','v:0','-count_packets','-show_entries','stream=nb_read_packets','-of','csv=p=0',file],{signal,timeout:3*60*1000});const n=Number(String(r.stdout).trim());if(!Number.isFinite(n))throw new Error('unreadable');return n;};
 try{return {read:await count([]),stored:await count(['-ignore_editlist','1'])};}catch(e){if(signal?.aborted)throw e;return null;}
}
/** Rewrite a section whose frames are hidden into `<name>.fixed.mp4` (the original is kept). Returns the new name or null. */
async function fixSection(folder,name,{signal,frames=sectionFrames}={}){
 const n=await frames(path.join(folder,'hires',name),{signal});if(!n||n.read>=n.stored*.9||n.stored<1)return null;
 // Hidden frames are often a legitimate trim (HLS parts start on a segment boundary and the edit list skips the
 // lead-in). Only repair when the frames that do play fall clearly short of the sound; otherwise the "repair" would
 // expose the lead-in and push the picture out of sync (28 s of picture over 22 s of sound, then rejected).
 const meta=await probe(path.join(folder,'hires',name),{signal}).catch(()=>null);
 if(meta?.fps>0&&n.read/meta.fps>=(meta.audioDuration||meta.duration)*.9)return null;
 const fixed=name.replace(/(\.fixed)?\.[^.]+$/,'')+'.fixed.mp4',src=path.join(folder,'hires',name),out=path.join(folder,'hires',fixed),temp=out+'.partial.mp4';
 await run('ffmpeg',['-v','error','-nostdin','-y','-ignore_editlist','1','-i',src,'-map','0:v:0','-map','0:a:0?','-c','copy','-bsf:v','setts=pts=PTS-STARTDTS:dts=DTS-STARTDTS','-movflags','+faststart','-f','mp4',temp],{signal,timeout:10*60*1000});
 const after=await frames(temp,{signal});if(!after||after.read<n.stored*.9){fs.rmSync(temp,{force:true});throw new Error(`The full-quality part of the stream (${name}) has a broken picture and could not be repaired`);}
 fs.renameSync(temp,out);return fixed;
}
/** Facecam searches run on a section without a picture found nothing; drop them so they run again. */
function forgetBlindFacecams(folder,sec){
 const dir=path.join(folder,'clips');let names=[];try{names=fs.readdirSync(dir).filter(f=>f.endsWith('.facecam.json'));}catch{return;}
 for(const f of names)try{const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));if(!r.found&&r.start<sec.end&&r.end>sec.start)fs.rmSync(path.join(dir,f),{force:true});}catch{}
}
/** `height`: the most the section may have, measured on the short side. Defaults to 1080. */
export async function ensureSection(job,folder,start,end,{signal,height=1080,runCommand=run,align=alignSection,probeFile=probe,frames=sectionFrames}={}){
 const remote=job.remote;if(!remote?.proxy)throw new Error('This project has the full-quality source already');
 const total=remote.duration||Infinity;end=Math.min(end,total-1);start=Math.max(0,Math.min(start,end-.5));
 // A cached section well below the stream's quality (fetched while YouTube listed only 144p–480p) is fetched again once.
 for(const low of readSections(folder).filter(s=>covers(s,start,end)&&lowQuality(job,s)&&!s.lowAccepted)){await forget(folder,low.file);fs.rmSync(path.join(folder,'hires',low.file),{force:true});}
 // Above 1080p only a section that is that sharp (or was already asked for at that height) will do.
 const sharp=s=>height<=1080||Math.min(Number(s.width)||0,Number(s.height)||0)>=Math.min(height,Number(remote.sourceHeight)||height)-8||(s.requestedHeight||1080)>=height;
 let hit=readSections(folder).filter(s=>sectionCovers(s,start,end)&&sharp(s)).sort((x,y)=>Math.min(y.width||0,y.height||0)-Math.min(x.width||0,x.height||0))[0];
 // Sections cached before the picture check get it once.
 if(hit&&!hit.framesChecked){const fixed=await fixSection(folder,hit.file,{signal,frames});hit={...hit,file:fixed||hit.file,framesChecked:true,...(fixed?{repairedFrom:hit.file}:{})};if(fixed){await forget(folder,hit.repairedFrom);forgetBlindFacecams(folder,hit);}await remember(folder,hit);}
 if(hit)return {...hit,file:path.join(folder,'hires',hit.file)};
 const pending=inflight.get(folder)||[];for(const p of pending)if((p.h||1080)>=height&&covers({start:p.a+MAX_SHIFT,end:p.b-MAX_SHIFT},start,end)){const got=await p.promise;if(sectionCovers(got,start,end))return got;}
 const a=Math.max(0,Math.floor(start-SECTION_PAD)),b=Math.min(Math.ceil(total),Math.ceil(end+SECTION_PAD));
 if(!(b>a))throw new Error('Invalid source section');
 const grab=()=>downloadSection(job,folder,a,b,{signal,height,runCommand,align,probeFile,frames});
 // YouTube's live listing sometimes offers only low qualities for a moment: one more try, then keep what came back.
 const promise=grab().then(async got=>{if(!lowQuality(job,got))return got;const again=await grab();if(!lowQuality(job,again))return again;
  const kept={...again,lowAccepted:true};await remember(folder,{...kept,file:path.basename(kept.file)});return kept;});const entry={a,b,h:height,promise};inflight.set(folder,[...pending,entry]);
 try{const got=await promise;if(!sectionCovers(got,start,end))throw new Error(`The downloaded section (${got.start.toFixed(1)}–${got.end.toFixed(1)} s) does not cover ${start.toFixed(1)}–${end.toFixed(1)} s`);return got;}
 finally{inflight.set(folder,(inflight.get(folder)||[]).filter(x=>x!==entry));}
}
async function downloadSection(job,folder,a,b,{signal,height=1080,runCommand,align,probeFile,frames}){
 const dir=path.join(folder,'hires');fs.mkdirSync(dir,{recursive:true});const base=`s-${a}-${b}${height>1080?`-${height}`:''}`;
 for(const f of fs.readdirSync(dir))if(f.startsWith(base+'.'))fs.rmSync(path.join(dir,f),{force:true});
 // The light copy's 16 kHz audio is the timing reference; rebuild it if it was cleaned up.
 if(!fs.existsSync(path.join(folder,'audio.wav'))){const m=await probe(job.sourcePath,{signal});await prepareAudio({sourcePath:job.sourcePath,audioPath:path.join(folder,'audio.wav'),sourceDuration:m.audioDuration||m.duration,signal});}
 // Taken from a live stream: fetch the fragments directly while it is still live (their timestamps give the true start).
 let expected=a;const live=job.remote.live?await grabLive(job.remote,path.join(dir,`${base}.mp4`),{from:a,to:b,height,signal,runCommand,logFile:path.join(dir,`${base}.log`)}):null;
 if(live)expected=live.start;
 else await runCommand(PYTHON,[...BASE(),'--concurrent-fragments','4','-f',formatFor(job.remote.platform,'section',PROXY_HEIGHT,{portrait:portraitJob(job),section:height}),'--download-sections',`*${a}-${b}`,'--merge-output-format','mp4','--windows-filenames','-o',path.join(dir,`${base}.%(ext)s`),job.remote.url],{cwd:dir,signal,timeout:30*60*1000,idleTimeout:5*60*1000,logFile:path.join(dir,`${base}.log`)}).catch(e=>{if(signal?.aborted)throw new Error('Job cancelled');throw new Error(gone(e.message)||`Could not download the full-quality part of the stream (${a}–${b} s): ${e.message}`);});
 let name=fs.readdirSync(dir).find(f=>f.startsWith(base+'.')&&/\.(mp4|mkv|webm)$/.test(f)&&!f.includes('.part'));if(!name)throw new Error(`The platform returned no video for ${a}–${b} s of the stream`);
 name=await fixSection(folder,name,{signal,frames})||name;
 const file=path.join(dir,name),meta=await probeFile(file,{signal});// A post-processing stream can hand back a few seconds instead of the window; never cache that.
 // A section with missing or cut-short sound would render silent clips.
 if(meta.duration&&Number.isFinite(meta.audioDuration)&&meta.audioDuration<meta.duration*.9)throw new Error(`The full-quality part of the stream (${a}–${b} s) came back without its full sound`);
 if(!meta.duration||meta.duration<(b-a)*.8)throw new Error(`The full-quality part of the stream (${a}–${b} s) came back incomplete`);
 const at=await align({folder,file,expected,runCommand,signal});
 const entry={file:name,requested:[a,b],start:at.start,end:at.start+meta.duration,confidence:at.confidence,aligned:at.aligned,width:meta.width,height:meta.height,fps:meta.fps||null,framesChecked:true,...(height>1080?{requestedHeight:height}:{})};
 await remember(folder,entry);return {...entry,file};
}
/** Start fetching sections for upcoming renders, a couple at a time; failures surface later when that clip renders. */
export function prefetchSections(job,folder,ranges,{signal,concurrency=2,ensure=ensureSection}={}){
 if(!job.remote?.proxy||!ranges.length)return Promise.resolve();const queue=[...ranges];
 const worker=async()=>{while(queue.length&&!signal?.aborted){const r=queue.shift();try{await ensure(job,folder,r.start,r.end,{signal});}catch{/* reported by the render */}}};
 return Promise.all(Array.from({length:Math.min(concurrency,queue.length)},worker));
}

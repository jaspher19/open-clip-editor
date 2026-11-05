import {fitPlayed} from './edl.mjs';
import fs from 'node:fs';import path from 'node:path';import {run,probe} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';import {importYouTube} from './ingest.mjs';import {pickClips,clipCount,momentShape} from './selection.mjs';import {titleClips} from './titles.mjs';import {streamPeople} from './people.mjs';import {renderClip} from './render.mjs';
import {pickWithProvider} from './providers.mjs';import {judgeMoments,judgeReady} from './meme-judge.mjs';
import {enrichClip} from './context.mjs';import {prepareAudio} from './audio.mjs';
export async function runPipeline(store,id,{signal,render=true}={}){
 const folder=store.folder(id);let job=store.get(id);
 const update=(stage,progress,message,patch={})=>{job=store.update(id,{status:'running',stage,progress,message,...patch});};
 try{
  update('import',.01,'Importing source',{compilation:null,error:null,transcription:null});
  if(!job.sourcePath||!fs.existsSync(job.sourcePath)){
   if(job.source.type==='youtube'){const imported=await importYouTube(job.source.url,folder,{signal,section:job.source.section,onProgress:p=>update('import',.02+p*.13,`Downloading video · ${Math.round(p*100)}%`)});update('probe',.15,'Reading video details',{sourcePath:imported.path,title:imported.title,sourceInfo:imported.sourceInfo});}
   else{const ext=path.extname(job.source.path||'').toLowerCase();if(!['.mp4','.mov','.mkv','.webm','.m4v'].includes(ext))throw new Error('Upload an MP4, MOV, MKV, WebM or M4V video');const target=path.join(folder,'source'+ext);if(path.resolve(job.source.path)!==path.resolve(target))fs.copyFileSync(job.source.path,target);update('probe',.15,'Reading video details',{sourcePath:target,title:job.source.name||path.basename(job.source.path)});}
  }
  const metadata=await probe(job.sourcePath,{signal});update('audio',.17,'Preparing local speech audio',{metadata});
  const audio=path.join(folder,'audio.wav');await prepareAudio({sourcePath:job.sourcePath,audioPath:audio,sourceDuration:metadata.audioDuration||metadata.duration,signal});
  const transcriptFile=path.join(folder,'transcript.json');
  if(!fs.existsSync(transcriptFile)){
   update('transcribe',.2,'Loading local transcription model');
   // CPU inference on a multi-hour recording can legitimately exceed an hour.
   // Keep a stall guard, but let a worker that reports progress keep running.
   await run(PYTHON,[path.join(ROOT,'workers/transcribe.py'),audio,transcriptFile,'--model',job.options.model,'--language',job.options.language],{signal,timeout:0,idleTimeout:15*60*1000,logFile:path.join(folder,'transcribe.log'),onLine:line=>{let e;try{e=JSON.parse(line);}catch{return;}if(e.stage==='transcribe'){const progress=Number.isFinite(e.progress)?Math.max(0,Math.min(1,e.progress)):0;const patch=Number.isFinite(e.processedSeconds)?{transcription:{processedSeconds:e.processedSeconds,totalSeconds:e.totalSeconds,wordCount:e.wordCount,checkpointSeconds:e.checkpointSeconds,resumedFromSeconds:e.resumedFromSeconds||0,lastProgressAt:new Date().toISOString()}}:{};update('transcribe',.2+.35*progress,e.message,patch);}}});
  }
  const transcript=JSON.parse(fs.readFileSync(transcriptFile,'utf8'));if(!transcript.words?.length)throw new Error('No usable speech transcript was found');
  update('select',.56,momentShape(job.options)?`Finding ${momentShape(job.options).label.toLowerCase()}s`:'Finding the best moments');
  const reused=!!job.clips?.length,count=clipCount(job.options.count,metadata.duration),picking={...job.options,count};
  // Meme templates: the AI judges a pool of format-shaped candidates and keeps the ones that actually work as that meme.
  let clips;
  if(!reused&&judgeReady(picking)){update('select',.565,`AI is choosing the best ${momentShape(picking).label.toLowerCase()}s`);const judged=await judgeMoments({...transcript,duration:metadata.duration},picking,{people:streamPeople(job,{folder})});clips=judged.clips;job=store.update(id,{aiMoments:judged.status});}
  else clips=reused?job.clips:job.options.picker==='heuristic'?pickClips({...transcript,duration:metadata.duration},picking,{people:streamPeople(job,{folder})}):await pickWithProvider(transcript,picking,{signal});if(!clips.length)throw new Error('Not enough speech for a 20–60 second clip. Try a longer speech-based video.');
  // Whichever picker chose them, finished clips play for at most a minute.
  if(!reused)clips=clips.map(c=>fitPlayed(transcript.words,c,job.options));
  // Hooks and titles: one batched AI call (free providers first) or local who-did-what titles; a retry keeps finished ones.
  let aiTitles=job.aiTitles;
  if(!reused||aiTitles?.status!=='done'){update('titles',.57,'Writing hooks and titles');({clips,aiTitles}=await titleClips(job,clips,transcript,{folder}));}
  clips=clips.map(c=>enrichClip(c,transcript,job));
  fs.writeFileSync(path.join(folder,'clips.json'),JSON.stringify(clips,null,2));
  const quiet=await run('ffmpeg',['-hide_banner','-nostats','-i',audio,'-af','silencedetect=noise=-35dB:d=0.3','-f','null','-'],{signal});let silenceStart=0;const silences=[];for(const line of quiet.stderr.split('\n')){let m=line.match(/silence_start: ([\d.]+)/);if(m)silenceStart=Number(m[1]);m=line.match(/silence_end: ([\d.]+)/);if(m)silences.push({start:silenceStart,end:Number(m[1])});}
  const host=streamPeople(job,{folder}).host;
  update('render',.6,`${clips.length} moments found`,{clips,aiTitles,host:host?{name:host.name,short:host.short}:null,transcriptSummary:{language:transcript.language,wordCount:transcript.words.length,model:transcript.model},silences});
  // Auto-ready: edit every kept clip with its template now. One clip failing records its error and the rest continue.
  const kept=clips.filter(c=>c.kept!==false),auto=render&&job.options.autoExport!==false;let failed=0;
  if(auto){let exports=job.exports||[];for(let i=0;i<kept.length;i++){const label=`Editing clip ${i+1} of ${kept.length}`;update('render',.6+.39*i/kept.length,label);
   try{const output=await renderClip(job,kept[i],transcript,{folder,signal,onProgress:p=>update('render',.6+.39*(i+p)/kept.length,`${label} · ${Math.round(p*100)}%`)});exports=[...exports.filter(e=>e.clipId!==kept[i].id),output];job=store.update(id,{exports,clips:store.get(id).clips.map(c=>{if(c.id!==kept[i].id)return c;const {exportError:_,...rest}=c;return {...rest,dirty:false};})});}
   catch(error){if(signal?.aborted)throw error;failed++;job=store.update(id,{clips:store.get(id).clips.map(c=>c.id===kept[i].id?{...c,exportError:error.message}:c)});}}}
  const ready=auto?kept.length-failed:0;
  return store.update(id,{status:'complete',stage:'complete',progress:1,message:ready?`${ready} clip${ready>1?'s':''} edited and ready to post${failed?` · ${failed} failed, retry from the clip`:''}`:failed?'Editing failed for every clip. Open a clip to retry.':'Clips are ready to review',finishedAt:new Date().toISOString()});
 }catch(e){const saved=store.get(id).transcription?.checkpointSeconds;if(saved>0)e.message+=` Saved transcript through ${Math.floor(saved/60)}m ${Math.floor(saved%60)}s; Retry resumes from that checkpoint.`;store.update(id,{status:signal?.aborted?'cancelled':'failed',stage:'error',message:e.message,error:e.message});throw e;}
}

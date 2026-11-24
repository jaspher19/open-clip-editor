import {fitPlayed} from './edl.mjs';
import fs from 'node:fs';import path from 'node:path';import {run,probe} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';import {importYouTube} from './ingest.mjs';import {pickClips,clipCount,momentShape} from './selection.mjs';import {titleClips} from './titles.mjs';import {streamPeople} from './people.mjs';import {renderClip} from './render.mjs';
import {pickWithProvider} from './providers.mjs';import {ensureSignals} from './signals.mjs';import {followLiveChat,jobChat} from './twitch-chat.mjs';import {loadLessons} from './learning.mjs';import {judgeMoments,judgeReady} from './meme-judge.mjs';
import {enrichClip,publicationMetadata} from './context.mjs';import {fetchYouTubeChat} from './youtube-chat.mjs';import {playedLength} from './edl.mjs';import {campaignReady,readCampaign,campaignBrief,campaignOptions,campaignPlayMax,applyCampaignMeta} from './campaign.mjs';import {importSource,prefetchSections} from './remote.mjs';import {isRemote,PLATFORMS} from './sources.mjs';import {sourceClip} from './source-clip.mjs';import {collectCrowd,loadCrowd} from './twitch-clips.mjs';import {scanMode,fastScan} from './scan.mjs';import {prepareAudio} from './audio.mjs';import {rawTranscript,rawMoments,rawClip} from './raw.mjs';
export async function runPipeline(store,id,{signal,render=true}={}){
 const folder=store.folder(id);let job=store.get(id);
 const update=(stage,progress,message,patch={})=>{job=store.update(id,{status:'running',stage,progress,message,...patch});};
 try{
  update('import',.01,'Importing source',{compilation:null,error:null,transcription:null});
  if(!job.sourcePath||!fs.existsSync(job.sourcePath)){
   if(isRemote(job.source)){const name=PLATFORMS[job.source.type];update('import',.02,`Checking the ${name} link`);const imported=await importSource(job.source,folder,{signal,onProgress:(p,mode)=>update('import',.02+p*.13,mode==='live'?`Live stream: downloading everything streamed so far · ${Math.round(p*100)}%`:mode==='proxy'?`Long stream: downloading a light copy to find moments · ${Math.round(p*100)}%`:`Downloading video · ${Math.round(p*100)}%`)});
    // A channel link resolves to the broadcast it was recording; a retry then imports that broadcast.
    update('probe',.15,imported.remote?.live?`Imported ${Math.round(imported.duration/60)} min of the live stream`:'Reading video details',{sourcePath:imported.path,title:imported.title,sourceInfo:imported.sourceInfo,remote:imported.remote,...(imported.resolved?{source:{...job.source,...imported.resolved}}:{})});}
   else{const ext=path.extname(job.source.path||'').toLowerCase();if(!['.mp4','.mov','.mkv','.webm','.m4v'].includes(ext))throw new Error('Upload an MP4, MOV, MKV, WebM or M4V video');const target=path.join(folder,'source'+ext);if(path.resolve(job.source.path)!==path.resolve(target))fs.copyFileSync(job.source.path,target);update('probe',.15,'Reading video details',{sourcePath:target,title:job.source.name||path.basename(job.source.path)});}
  }
  // Live Twitch streams: record chat from now on, so a later import of the same broadcast can use its spikes.
  try{followLiveChat(job);}catch{}
  // Twitch VODs: viewers' clips of the broadcast, when the owner added a Twitch app key. Optional and never fatal.
  if(job.source?.type==='twitch'&&job.source.kind==='video'&&!job.crowd){update('probe',.155,'Checking which moments viewers clipped');const crowd=await collectCrowd(job,folder);if(crowd)update('probe',.16,crowd.status==='done'?`Viewers made ${crowd.clips} clips of this stream`:'Reading video details',{crowd});}
  const metadata=await probe(job.sourcePath,{signal});
  // YouTube streams: fetch the chat replay alongside audio and transcription (where chat went wild is a strong signal).
  const chatTask=fetchYouTubeChat(job,folder,{signal}).catch(()=>null);update('audio',.17,'Preparing local speech audio',{metadata});
  const audio=path.join(folder,'audio.wav');await prepareAudio({sourcePath:job.sourcePath,audioPath:audio,sourceDuration:metadata.audioDuration||metadata.duration,signal});
  const transcriptFile=path.join(folder,'transcript.json');
  // Raw Clip template: no transcription. A word-free transcript carries the loudness the moment finder and timeline use.
  if(job.options.rawClip&&!fs.existsSync(transcriptFile)){update('transcribe',.2,'Raw clips: measuring loudness (no transcription)');fs.writeFileSync(transcriptFile,JSON.stringify(rawTranscript(audio,metadata.audioDuration||metadata.duration)));}
  // Long streams: a quick draft of the whole stream finds the likely moments, and only those are transcribed properly.
  if(!fs.existsSync(transcriptFile)&&job.source?.kind!=='clip'&&scanMode(job.options,metadata.audioDuration||metadata.duration)==='fast'){
   const scan=await fastScan(job,folder,{audio,duration:metadata.audioDuration||metadata.duration,signal,update:(p,message)=>update('transcribe',.2+.35*p,message)});job=store.update(id,{scan});
  }
  if(!fs.existsSync(transcriptFile)){
   update('transcribe',.2,'Loading local transcription model');
   // CPU inference on a multi-hour recording can legitimately exceed an hour.
   // Keep a stall guard, but let a worker that reports progress keep running.
   await run(PYTHON,[path.join(ROOT,'workers/transcribe.py'),audio,transcriptFile,'--model',job.options.model,'--language',job.options.language,...(job.source?.kind==='clip'?['--min-words','0']:[])],{signal,timeout:0,idleTimeout:15*60*1000,logFile:path.join(folder,'transcribe.log'),onLine:line=>{let e;try{e=JSON.parse(line);}catch{return;}if(e.stage==='transcribe'){const progress=Number.isFinite(e.progress)?Math.max(0,Math.min(1,e.progress)):0;const patch=Number.isFinite(e.processedSeconds)?{transcription:{processedSeconds:e.processedSeconds,totalSeconds:e.totalSeconds,wordCount:e.wordCount,checkpointSeconds:e.checkpointSeconds,resumedFromSeconds:e.resumedFromSeconds||0,lastProgressAt:new Date().toISOString()}}:{};update('transcribe',.2+.35*progress,e.message,patch);}}});
  }
  const transcript=JSON.parse(fs.readFileSync(transcriptFile,'utf8'));transcript.words||=[];const linkClip=job.source?.kind==='clip',raw=!!transcript.raw;if(!linkClip&&!raw&&!transcript.words.length)throw new Error('No usable speech transcript was found');
  const reused=!!job.clips?.length,count=clipCount(job.options.count,metadata.duration),basePicking={...job.options,count};
  if(!reused&&!linkClip){const waiting=setTimeout(()=>update('select',.555,'Reading the live chat replay'),1500);// A 6-hour stream's chat replay took 25 minutes to download: wait at most 3 more minutes, then go on without it
   // (it keeps downloading for the timeline and later picks).
   const n=await Promise.race([chatTask,new Promise(r=>setTimeout(()=>r(null),3*60e3))]);clearTimeout(waiting);if(n)job=store.update(id,{chatReplay:{messages:n}});}
  // Campaign requirements (AI only): read the brief once into rules that steer picking, lengths, shape and upload details.
  if(!reused&&!linkClip&&!raw&&String(job.options.campaign||'').trim()){let campaign=job.campaign||null;
   if(!campaignReady())campaign={status:'skipped',error:'Set up an AI provider in .env (Gemini, Groq, Ollama or Claude) to use campaign requirements.'};
   else if(campaign?.text!==job.options.campaign||!campaign?.rules){update('select',.555,'Reading the campaign requirements');try{const r=await readCampaign(job.options.campaign);campaign={status:'done',text:job.options.campaign,rules:r.rules,provider:r.provider,model:r.model};}catch(e){campaign={status:'failed',error:String(e.message||e).slice(0,200)};}}
   if(campaign?.rules){const {options,applied}=campaignOptions(job.options,campaign.rules);job=store.update(id,{options,campaign:{...campaign,applied}});}else job=store.update(id,{campaign});}
  const rules=job.campaign?.rules||null,picking={...basePicking,...job.options,count,...(rules?{campaignBrief:campaignBrief(rules),aiJudge:true}:{})};
  // Game signals: on-screen action, so a chase or fight the streamer watches in silence still counts.
  const signals=!reused&&!linkClip?await ensureSignals(job,folder,{audio,signal,onProgress:(p,message)=>update('select',.555+.005*p,message||'Measuring game action')}):null;
  update('select',.56,raw?'Finding the loudest and busiest moments':momentShape(job.options)?`Finding ${momentShape(job.options).label.toLowerCase()}s`:'Finding the best moments');
  // With an AI key, the AI judges a pool of local candidates and keeps the ones that work (meme templates: as that meme).
  let clips;
  if(!reused&&linkClip)clips=[sourceClip(job,metadata,transcript)];
  else if(!reused&&raw)clips=rawMoments({energy:transcript.energy,action:signals?.action,duration:metadata.duration,count}).map(m=>rawClip(job,m));
  else if(!reused&&judgeReady(picking)){update('select',.565,`AI is choosing the best ${(momentShape(picking)?.label||'moment').toLowerCase()}s`);const judged=await judgeMoments({...transcript,duration:metadata.duration},picking,{people:streamPeople(job,{folder}),crowd:loadCrowd(folder),signals,chat:jobChat(job,folder),lessons:loadLessons(store.root)});clips=judged.clips;job=store.update(id,{aiMoments:judged.status});}
  else clips=reused?job.clips:job.options.picker==='heuristic'?pickClips({...transcript,duration:metadata.duration},picking,{people:streamPeople(job,{folder}),crowd:loadCrowd(folder),signals,chat:jobChat(job,folder),lessons:loadLessons(store.root)}):await pickWithProvider(transcript,picking,{signal});if(!clips.length)throw new Error('Not enough speech for a 20–60 second clip. Try a longer speech-based video.');
  // Whichever picker chose them, finished clips play for at most a minute.
  if(!reused&&!linkClip&&!raw)clips=clips.map(c=>fitPlayed(transcript.words,c,job.options,rules?campaignPlayMax(rules,job.options.outputFormat!=='video'):60));
  // Strong opening: when a standard clip's payoff comes late, it opens on the payoff for a moment (cold open) and then
  // plays from the setup, so the first seconds hold viewers. Meme templates have their own shape; off with autoHook:false.
  if(!reused&&!linkClip&&!raw&&job.options.autoHook!==false&&!momentShape(job.options))clips=clips.map(c=>{if(!Number.isFinite(c.peakAt)||c.settings?.coldOpen)return c;
   const late=playedLength(transcript.words.filter(w=>w.end>c.start&&w.start<c.start+c.peakAt),{start:c.start,end:c.start+c.peakAt},job.options);
   return late>=25?{...c,settings:{...(c.settings||{}),coldOpen:true},reasons:[...(c.reasons||[]),`Opens on the payoff first: it comes ${Math.round(late)} s in`]}:c;});
  // Hooks and titles: one batched AI call (free providers first) or local who-did-what titles; a retry keeps finished ones.
  let aiTitles=job.aiTitles;
  // Clip links with real speech get written titles like any moment; near-silent ones keep the platform title or streamer and game.
  if(raw||(linkClip&&transcript.words.length<8))aiTitles=aiTitles||{status:'skipped'};else if(!reused||aiTitles?.status!=='done'){update('titles',.57,'Writing hooks and titles');({clips,aiTitles}=await titleClips(rules?{...job,options:{...job.options,contextText:[job.options.contextText,campaignBrief(rules)].filter(Boolean).join('\n')}}:job,clips,transcript,{folder}));}
  clips=clips.map(c=>enrichClip(c,transcript,job));
  // The campaign's required hashtags and mentions go into every clip's upload details, whatever the titles say.
  if(rules)clips=clips.map(c=>({...c,metadata:applyCampaignMeta(c.metadata||publicationMetadata(c,job),rules)}));
  fs.writeFileSync(path.join(folder,'clips.json'),JSON.stringify(clips,null,2));
  const quiet=await run('ffmpeg',['-hide_banner','-nostats','-i',audio,'-af','silencedetect=noise=-35dB:d=0.3','-f','null','-'],{signal});let silenceStart=0;const silences=[];for(const line of quiet.stderr.split('\n')){let m=line.match(/silence_start: ([\d.]+)/);if(m)silenceStart=Number(m[1]);m=line.match(/silence_end: ([\d.]+)/);if(m)silences.push({start:silenceStart,end:Number(m[1])});}
  const host=streamPeople(job,{folder}).host;
  update('render',.6,`${clips.length} moments found`,{clips,aiTitles,host:host?{name:host.name,short:host.short}:null,transcriptSummary:{language:transcript.language,wordCount:transcript.words.length,model:transcript.model},silences});
  // Auto-ready: edit every kept clip with its template now. One clip failing records its error and the rest continue.
  const kept=clips.filter(c=>c.kept!==false),auto=render&&job.options.autoExport!==false;let failed=0;
  if(auto){let exports=job.exports||[];if(job.remote?.proxy)prefetchSections(job,folder,kept.map(c=>({start:c.start-.1,end:c.end+.3})),{signal});for(let i=0;i<kept.length;i++){const label=`Editing clip ${i+1} of ${kept.length}`;update('render',.6+.39*i/kept.length,label);
   try{const output=await renderClip(job,kept[i],transcript,{folder,signal,onProgress:p=>update('render',.6+.39*(i+p)/kept.length,`${label} · ${Math.round(p*100)}%`)});exports=[...exports.filter(e=>e.clipId!==kept[i].id),output];job=store.update(id,{exports,clips:store.get(id).clips.map(c=>{if(c.id!==kept[i].id)return c;const {exportError:_,...rest}=c;return {...rest,dirty:false};})});}
   catch(error){if(signal?.aborted)throw error;failed++;job=store.update(id,{clips:store.get(id).clips.map(c=>c.id===kept[i].id?{...c,exportError:error.message}:c)});}}}
  const ready=auto?kept.length-failed:0;
  return store.update(id,{status:'complete',stage:'complete',progress:1,message:ready?`${ready} clip${ready>1?'s':''} edited and ready to post${failed?` · ${failed} failed, retry from the clip`:''}`:failed?'Editing failed for every clip. Open a clip to retry.':'Clips are ready to review',finishedAt:new Date().toISOString()});
 }catch(e){const saved=store.get(id).transcription?.checkpointSeconds;if(saved>0)e.message+=` Saved transcript through ${Math.floor(saved/60)}m ${Math.floor(saved%60)}s; Retry resumes from that checkpoint.`;store.update(id,{status:signal?.aborted?'cancelled':'failed',stage:'error',message:e.message,error:e.message});throw e;}
}

// Fast scan for long streams: transcribe only where clips can come from.
//
// Full transcription runs ~7x real time on a mid-range CPU (a 10 h stream takes ~1.5 h). A fast scan instead
//  1. drafts the whole stream with a small model, no word alignment, greedy decoding (~35x real time);
//  2. runs the normal moment picker on that draft (plus viewers' clips) for up to 30 candidates, and adds the
//     loudest / busiest stretches from workers/hotspots.py so quiet-but-wild gameplay is not missed;
//  3. transcribes only those windows with the chosen model, for titles and captions.
// The transcript records `coverage`; a moment added by hand outside it is transcribed on demand (ensureTranscribed).
import fs from 'node:fs';import path from 'node:path';
import {run} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';import {writeJsonAtomic} from './atomic.mjs';
import {pickClips} from './selection.mjs';import {streamPeople} from './people.mjs';import {loadCrowd,crowdFile} from './twitch-clips.mjs';

const num=(v,d)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:d;};
export const FAST_AFTER=num(process.env.SCAN_FAST_AFTER_MINUTES,120)*60;
/** Seconds of context kept around each candidate: setup before, reaction after, and room to trim. */
export const PAD_BEFORE=25,PAD_AFTER=15;

/** 'fast' or 'full'. `scan` option: auto (fast for streams over 2 h), full, or fast. */
export function scanMode(options={},duration=0){const s=options.scan||'auto';return s==='full'?'full':s==='fast'||duration>FAST_AFTER?'fast':'full';}
/** The draft model: base.en for English, base otherwise. */
export function draftModel(options={}){return options.language==='en'||String(options.model||'').endsWith('.en')?'base.en':'base';}
/** Extra loud/busy stretches on top of the candidates: about 5% of the stream, 5–20 minutes. */
export const hotBudget=duration=>Math.min(1200,Math.max(300,duration*.05));

export function mergeRanges(list,{gap=1,duration=Infinity}={}){
 const out=[];for(const r of [...list].map(r=>({start:Math.max(0,r.start),end:Math.min(duration,r.end)})).filter(r=>r.end-r.start>=.5).sort((a,b)=>a.start-b.start)){
  const last=out.at(-1);if(last&&r.start<=last.end+gap)last.end=Math.max(last.end,r.end);else out.push({...r});}
 return out;
}
/** Windows to transcribe properly: every draft candidate with padding, plus the scan's hot spots. */
export function scanRegions(draft,options,{people,crowd=[],hot=[],duration}){
 const candidates=pickClips({...draft,duration},{...options,count:30},{people,crowd});
 return {candidates,regions:mergeRanges([...candidates.map(c=>({start:c.start-PAD_BEFORE,end:c.end+PAD_AFTER})),...hot],{duration})};
}
const covered=r=>r.reduce((n,x)=>n+x.end-x.start,0);

const worker=(name,args,opts)=>run(PYTHON,[path.join(ROOT,'workers',name),...args],{timeout:0,idleTimeout:15*60*1000,...opts});
function progressLine(onProgress){return line=>{let e;try{e=JSON.parse(line);}catch{return;}if(Number.isFinite(e.progress))onProgress?.(Math.max(0,Math.min(1,e.progress)),e);};}

/** The draft runs the batched decoder in one process (see workers/transcribe.py --draft). */
async function draftPass({audio,draftFile,folder,model,options,duration,signal,update,runWorker}){
 await runWorker('transcribe.py',[audio,draftFile,'--model',model,'--language',options.language,'--draft','--threads','6','--min-words','0'],{signal,logFile:path.join(folder,'draft.log'),onLine:progressLine((p,e)=>update(.6*p,Number.isFinite(e.processedSeconds)?`Quick pass over the whole stream · ${Math.round(e.processedSeconds/60)} of ${Math.round(duration/60)} min`:'Quick pass over the whole stream'))});
}

/**
 * Split windows into groups of about equal length. One Whisper process does not use this CPU well:
 * measured with small.en on three 10-minute stretches, three processes of 4 threads took 267 s against 361 s for one.
 */
export const FINAL_PARTS=3;
export function balancedGroups(regions,parts=FINAL_PARTS){
 if(parts<=1||covered(regions)<600)return [regions];const groups=Array.from({length:parts},()=>[]),load=new Array(parts).fill(0);
 // Longest window first, into the least loaded group; each group then runs in stream order.
 for(const r of [...regions].sort((a,b)=>(b.end-b.start)-(a.end-a.start))){const k=load.indexOf(Math.min(...load));groups[k].push(r);load[k]+=r.end-r.start;}
 return groups.filter(g=>g.length).map(g=>g.sort((a,b)=>a.start-b.start));
}
/** Transcribe the chosen windows with the job's model, a group per process, and join them into transcript.json. */
async function finalPass({audio,transcriptFile,folder,options,regions,total,duration,signal,update,runWorker}){
 const groups=balancedGroups(regions),done=new Array(groups.length).fill(0),threads=groups.length>1?'4':'6';
 const report=()=>{const sum=done.reduce((a,b)=>a+b,0);update(.65+.35*Math.min(1,sum/total),`Transcribing likely moments · ${Math.round(sum/60)} of ${Math.round(total/60)} min`);};
 const outputs=await Promise.all(groups.map(async(group,k)=>{
  const out=path.join(folder,`transcript-part-${k+1}.json`),file=path.join(folder,`scan-regions-${k+1}.json`);
  // A finished part is reused only for the same windows.
  let saved=null;try{saved=JSON.parse(fs.readFileSync(out,'utf8'));}catch{}
  if(saved&&JSON.stringify(saved.coverage)===JSON.stringify(group.map(r=>[r.start,r.end])))return saved;
  writeJsonAtomic(file,group);
  await runWorker('transcribe.py',[audio,out,'--model',options.model,'--language',options.language,'--regions',file,'--threads',threads,'--min-words','0'],{signal,logFile:path.join(folder,`transcribe-${k+1}.log`),onLine:progressLine((p,e)=>{if(Number.isFinite(e.processedSeconds)){done[k]=e.processedSeconds;report();}})});
  return JSON.parse(fs.readFileSync(out,'utf8'));
 }));
 const byStart=(a,b)=>a.start-b.start,coverage=regions.map(r=>[r.start,r.end]),words=clampToCoverage(outputs.flatMap(o=>o.words||[]),coverage).sort(byStart);
 if(words.length<8)throw new Error('Not enough spoken words found in the likely moments. Try "Full transcript" under Long streams.');
 writeJsonAtomic(transcriptFile,{...outputs[0],words,segments:clampToCoverage(outputs.flatMap(o=>o.segments||[]),coverage).sort(byStart),coverage,duration});
 for(let k=1;k<=groups.length;k++)for(const f of [`transcript-part-${k}.json`,`transcript-part-${k}.checkpoint.json`,`scan-regions-${k}.json`])fs.rmSync(path.join(folder,f),{force:true});
}

/**
 * Run the fast scan for a job and write transcript.json (covering only the chosen windows).
 * `update(progress 0-1, message)` reports the whole scan.
 */
export async function fastScan(job,folder,{audio,duration,signal,update=()=>{},runWorker=worker}){
 const draftFile=path.join(folder,'draft.json'),hotFile=path.join(folder,'hotspots.json'),regionsFile=path.join(folder,'scan-regions.json'),transcriptFile=path.join(folder,'transcript.json');
 const options=job.options,model=draftModel(options);
 if(!fs.existsSync(draftFile))await draftPass({audio,draftFile,folder,model,options,duration,signal,update,runWorker});
 update(.6,'Looking for loud and busy stretches');
 if(!fs.existsSync(hotFile))await runWorker('hotspots.py',[audio,job.sourcePath,hotFile,'--budget',String(hotBudget(duration)),...(fs.existsSync(crowdFile(folder))?['--crowd',crowdFile(folder)]:[])],{signal,logFile:path.join(folder,'hotspots.log')});
 const draft=JSON.parse(fs.readFileSync(draftFile,'utf8')),hot=JSON.parse(fs.readFileSync(hotFile,'utf8')).regions||[];
 const {candidates,regions}=scanRegions(draft,options,{people:streamPeople(job,{folder}),crowd:loadCrowd(folder),hot,duration});
 if(!regions.length)throw new Error('The quick pass found no speech or action in this stream');
 writeJsonAtomic(regionsFile,regions);
 const total=covered(regions);update(.65,`Transcribing ${regions.length} likely moments (${Math.round(total/60)} of ${Math.round(duration/60)} min)`);
 await finalPass({audio,transcriptFile,folder,options,regions,total,duration,signal,update,runWorker});
 return {mode:'fast',draftModel:model,candidates:candidates.length,regions:regions.length,coveredSeconds:Math.round(total),duration:Math.round(duration),hotSpots:hot.length};
}

/**
 * Keep every word and segment inside the coverage window its start falls in. Older transcriber versions mapped a
 * window's last word, when its end ran past the silence between windows, through the next window, so one word could
 * span thousands of seconds (seen on real streams). Items starting outside every window are dropped.
 */
export function clampToCoverage(items,coverage){
 if(!Array.isArray(coverage))return items;const out=[];
 for(const w of items||[]){const r=coverage.find(([a,b])=>w.start>=a-1e-6&&w.start<b);if(!r)continue;const end=Math.min(w.end,r[1]);if(end>w.start)out.push(end===w.end?w:{...w,end:+end.toFixed(4)});}
 return out;
}
/** Parts of [start,end] the transcript does not cover yet (none for a full transcript). */
export function uncovered(transcript,start,end){
 // Raw projects (no transcription at import) start with nothing covered; a full transcript has no coverage list.
 const coverage=Array.isArray(transcript.coverage)?transcript.coverage:transcript.raw?[]:null;
 if(!coverage)return [];let gaps=[{start,end}];
 for(const [a,b] of coverage)gaps=gaps.flatMap(g=>b<=g.start||a>=g.end?[g]:[{start:g.start,end:a},{start:b,end:g.end}]).filter(g=>g.end-g.start>=.5);
 return gaps;
}
export function mergeTranscript(base,extra){
 const inside=w=>extra.coverage.some(([a,b])=>w.start>=a&&w.end<=b),byStart=(a,b)=>a.start-b.start;
 const baseCoverage=base.coverage||[],coverage=mergeRanges([...baseCoverage,...extra.coverage].map(([a,b])=>({start:a,end:b})),{gap:0}).map(r=>[r.start,r.end]),own=(list,c)=>clampToCoverage(list,c);
 return {...base,words:[...own(base.words,baseCoverage).filter(w=>!inside(w)),...own(extra.words,extra.coverage)].sort(byStart),segments:[...own(base.segments||[],baseCoverage).filter(s=>!inside(s)),...own(extra.segments||[],extra.coverage)].sort(byStart),coverage};
}
const chains=new Map();
/** Make sure the transcript covers [start,end] (with some context), transcribing the missing parts now. Returns true if it changed. */
export async function ensureTranscribed(job,folder,start,end,{signal,runWorker=worker}={}){
 const file=path.join(folder,'transcript.json');
 const task=(chains.get(folder)||Promise.resolve()).then(async()=>{
  const transcript=JSON.parse(fs.readFileSync(file,'utf8')),duration=transcript.duration||job.metadata?.duration||end;
  const gaps=mergeRanges(uncovered(transcript,Math.max(0,start-PAD_BEFORE),Math.min(duration,end+PAD_AFTER)),{duration});if(!gaps.length)return false;
  const regionsFile=path.join(folder,'extra-regions.json'),out=path.join(folder,'transcript.extra.json');writeJsonAtomic(regionsFile,gaps);
  try{await runWorker('transcribe.py',[path.join(folder,'audio.wav'),out,'--model',job.options.model,'--language',job.options.language,'--regions',regionsFile,'--min-words','0'],{signal,logFile:path.join(folder,'transcribe.log')});
   const extra=JSON.parse(fs.readFileSync(out,'utf8'));writeJsonAtomic(file,mergeTranscript(JSON.parse(fs.readFileSync(file,'utf8')),extra));return true;}
  finally{for(const f of [out,regionsFile,out.replace(/\.json$/,'.checkpoint.json')])fs.rmSync(f,{force:true});}
 });
 chains.set(folder,task.catch(()=>{}));return task;
}

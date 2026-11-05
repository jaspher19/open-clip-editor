import fs from 'node:fs';import path from 'node:path';
import {laugh,strong,clipCue,loudness} from './moments.mjs';import {pickClips,momentShape} from './selection.mjs';import {streamPeople} from './people.mjs';
// Whole-stream view for choosing moments by hand: activity per bucket plus the picker's ranked moments.
const overlaps=(a,b)=>Math.min(a.end,b.end)-Math.max(a.start,b.start)>Math.min(3,(a.end-a.start)*.1);

export function streamActivity(transcript,{bucket=5}={}){
 const words=transcript.words||[],duration=transcript.duration||words.at(-1)?.end||0,loud=loudness(transcript),n=Math.max(1,Math.ceil(duration/bucket));
 const buckets=Array.from({length:n},(_,k)=>{const t=k*bucket,{ratio,peak}=loud.at(t,Math.min(duration,t+bucket));return {t,loud:+ratio.toFixed(2),peak:+peak.toFixed(2),laugh:0,hype:0,cue:0,words:0};});
 words.forEach((w,i)=>{const b=buckets[Math.min(n-1,Math.floor(w.start/bucket))],t=w.text||'',pair=`${words[i-1]?.text||''} ${t}`;if(!b)return;b.words++;if(laugh.test(t))b.laugh++;if(strong.test(t)||strong.test(pair))b.hype++;if(clipCue.test(pair))b.cue++;});
 return {duration,bucket,buckets};
}

/** Ranked moments across the whole stream (up to 30, non-overlapping). */
export function streamCandidates(job,transcript,{folder}={}){
 const duration=transcript.duration||job.metadata?.duration||transcript.words?.at(-1)?.end||0;
 return pickClips({...transcript,duration},{...job.options,count:30,minDuration:20,maxDuration:90},{people:streamPeople(job,{folder})}).map(c=>({start:c.start,end:c.end,score:c.score,category:c.category,title:c.title,hook:c.hook,peakAt:c.peakAt,reasons:c.reasons}));
}

/** Timeline for a job, cached in work/<id>/timeline.json until the transcript changes; `used` is computed per request. */
export function jobTimeline(job,folder){
 const file=path.join(folder,'transcript.json');if(!fs.existsSync(file))throw Object.assign(new Error('Transcript is not ready'),{status:404});
 const stat=fs.statSync(file),key=`${stat.mtimeMs}:${stat.size}:${momentShape(job.options)?job.options.editTemplate:''}`,cacheFile=path.join(folder,'timeline.json');let cached=null;
 try{cached=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(cached.key!==key)cached=null;}catch{cached=null;}
 if(!cached){const transcript=JSON.parse(fs.readFileSync(file,'utf8'));cached={key,...streamActivity(transcript),candidates:streamCandidates(job,transcript,{folder})};fs.writeFileSync(cacheFile,JSON.stringify(cached));}
 const {key:_,...out}=cached,clips=job.clips||[];
 return {...out,candidates:out.candidates.map(c=>({...c,used:clips.some(k=>overlaps(c,k))})),clips:clips.map(c=>({id:c.id,start:c.start,end:c.end,title:c.title,kept:c.kept}))};
}

/** Best unused candidate that overlaps none of `clips`. */
export function bestUnused(candidates,clips){return [...candidates].sort((a,b)=>b.score-a.score).find(c=>!clips.some(k=>overlaps(c,k)))||null;}

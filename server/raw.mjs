// Raw clips (the Raw Clip template): no transcription and no edits. Moments are found from loudness (the streamer
// and the game get loud at the good parts) and from on-screen action (workers/signals.py), then cut as they are.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {ACTION_KEEP} from './signals.mjs';import {platformTitle} from './source-clip.mjs';import {PLAY_MAX} from './selection.mjs';

const RATE=16000,HOP=8000;
/** Seconds before and after the loudest point of a raw moment: a 30 s clip with the setup before the peak. */
export const RAW_BEFORE=18,RAW_AFTER=12;

/** Byte offset and sample count of the PCM16 data in a 16 kHz mono WAV (the file FFmpeg prepares for every project). */
function wavData(fd){
 const head=Buffer.alloc(12);fs.readSync(fd,head,0,12,0);if(head.toString('ascii',0,4)!=='RIFF'||head.toString('ascii',8,12)!=='WAVE')throw new Error('Not a WAV file');
 let at=12;const chunk=Buffer.alloc(8);
 for(;;){if(fs.readSync(fd,chunk,0,8,at)<8)throw new Error('WAV file has no data chunk');const size=chunk.readUInt32LE(4);if(chunk.toString('ascii',0,4)==='data')return {offset:at+8,samples:Math.floor(size/2)};at+=8+size+(size&1);}
}

/** RMS per 0.5 s of the project's speech audio, read a block at a time (a 17-hour stream is about 2 GB). Same shape as the transcriber's `energy`. */
export function audioEnergy(file){
 const fd=fs.openSync(file,'r');
 try{const {offset,samples}=wavData(fd),out=[],block=HOP*120,buf=Buffer.alloc(block*2);
  for(let base=0;base<samples;base+=block){const n=Math.min(block,samples-base),got=fs.readSync(fd,buf,0,n*2,offset+base*2)>>1;
   for(let i=0;i<got;i+=HOP){let sum=0;const end=Math.min(got,i+HOP);for(let k=i;k<end;k++){const v=buf.readInt16LE(k*2)/32768;sum+=v*v;}out.push({time:+((base+i)/RATE).toFixed(3),rms:+Math.sqrt(sum/Math.max(1,end-i)).toFixed(5)});}
   if(got<n)break;}
  return out;}
 finally{fs.closeSync(fd);}
}

/** A transcript with no words, so every tool that reads transcript.json (timeline, editor, exports) still works. */
export function rawTranscript(audio,duration){return {language:'',duration,words:[],segments:[],energy:audioEnergy(audio),model:'none',raw:true};}

/**
 * Score per second: loudness against the stream's median (over 3 s, so one bump doesn't count much), plus sustained
 * on-screen action. Returns seconds 0..n-1.
 */
export function rawScores(energy=[],action=[],duration=0){
 const n=Math.max(1,Math.ceil(duration)),rms=energy.map(e=>e.rms),sorted=[...rms].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]||0,bin=energy.length>1?energy[1].time-energy[0].time:.5;
 const perSecond=Array.from({length:n},(_,t)=>{const i=Math.floor(t/bin),j=Math.max(i+1,Math.floor((t+1)/bin));let s=0,c=0;for(let k=i;k<j&&k<rms.length;k++){s+=rms[k];c++;}return c?s/c:0;});
 return perSecond.map((_,t)=>{let s=0,c=0;for(let k=Math.max(0,t-1);k<=Math.min(n-1,t+1);k++){s+=perSecond[k];c++;}const loud=median?s/c/median:0;return {t,loud,action:Number(action[t])||0,score:loud+.5*(Number(action[t])||0)/ACTION_KEEP};});
}

const window=(t,duration,before,after)=>{let start=Math.max(0,t-before),end=Math.min(duration,start+before+after);start=Math.max(0,end-before-after);return {start:+start.toFixed(2),end:+end.toFixed(2)};};

/**
 * The `count` best raw moments, as source ranges around the loudest or busiest seconds, never overlapping.
 * A source shorter than one moment becomes a single clip (at most a minute).
 */
export function rawMoments({energy=[],action=[],duration=0,count=5,before=RAW_BEFORE,after=RAW_AFTER}={}){
 if(!(duration>0))return [];
 if(duration<=before+after+2)return [{start:0,end:+Math.min(duration,PLAY_MAX-.1).toFixed(2),peakAt:+(Math.min(duration,PLAY_MAX)/2).toFixed(2),score:50,loud:1,action:0}];
 const scores=rawScores(energy,action,duration),picked=[];
 for(const s of [...scores].sort((a,b)=>b.score-a.score)){
  if(picked.length>=count)break;const w=window(s.t,duration,before,after);
  if(picked.some(p=>w.start<p.end+2&&w.end>p.start-2))continue;
  picked.push({...w,peakAt:+(s.t-w.start).toFixed(2),score:Math.round(Math.min(99,30+s.score*20)),loud:s.loud,action:s.action});
 }
 return picked.sort((a,b)=>a.start-b.start);
}

const clock=t=>{const s=Math.max(0,Math.floor(t)),h=Math.floor(s/3600),m=Math.floor(s/60)%60,ss=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${ss}`:`${m}:${ss}`;};
/** "Stream title (1:23:45)": raw clips have no transcript to write a title from. */
export function rawTitle(job,start){const name=String(job.title||'').replace(/\.(mp4|mov|mkv|webm|m4v)$/i,'').replace(/[_]+/g,' ');return `${platformTitle(name)||'Stream moment'} (${clock(start)})`.slice(0,100);}
export function rawReasons(m){return [m.action>=ACTION_KEEP?'On-screen action':null,m.loud>=1.4?`Loud: ${m.loud.toFixed(1)}× the stream's usual level`:null,'Raw clip: no transcription, cut as it happened'].filter(Boolean);}

/** A clip record for a raw moment (same shape as picked clips, without words). */
export function rawClip(job,m,settings={}){return {id:randomUUID(),start:m.start,end:m.end,title:rawTitle(job,m.start),hook:'',titleSource:'raw',score:m.score??50,category:'highlight',peakAt:m.peakAt??+((m.end-m.start)*.6).toFixed(2),kept:true,reasons:rawReasons(m),words:[],cuts:[],parts:[],effects:[],titleOptions:[],settings};}

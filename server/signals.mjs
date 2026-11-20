// Game signals for the moment picker (workers/signals.py): sustained on-screen action per second of the source.
// Cached in work/<id>/signals.json; optional and never fatal. (Game-sound bursts were tried and rejected: NOTES.md.)
import fs from 'node:fs';import path from 'node:path';
import {run} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';

export const signalsFile=folder=>path.join(folder,'signals.json');
export function loadSignals(folder){try{const s=JSON.parse(fs.readFileSync(signalsFile(folder),'utf8'));return s&&Array.isArray(s.action)?s:null;}catch{return null;}}
/** Measure once per project; a failure only logs and the picker runs on speech alone. */
export async function ensureSignals(job,folder,{audio=path.join(folder,'audio.wav'),signal,onProgress,runWorker=run}={}){
 const cached=loadSignals(folder);if(cached)return cached;if(!job.sourcePath||!fs.existsSync(audio))return null;
 try{await runWorker(PYTHON,[path.join(ROOT,'workers','signals.py'),audio,job.sourcePath,signalsFile(folder)],{signal,timeout:0,idleTimeout:15*60*1000,logFile:path.join(folder,'signals.log'),onLine:line=>{let e;try{e=JSON.parse(line);}catch{return;}if(Number.isFinite(e.progress))onProgress?.(e.progress,e.message);}});}
 catch(error){if(signal?.aborted)throw error;return null;}
 return loadSignals(folder);
}

/**
 * Source ranges to keep in an edit although nobody talks: sustained on-screen action (≥ 2.5) with no word within
 * 0.75 s. Pause trimming would otherwise cut the chase or the fight itself. At most `max` ranges, each with room
 * before (0.6 s) and after (1 s).
 */
export const ACTION_KEEP=2.5;
export function gameKeeps(signals,words,start,end,{max=6}={}){if(!signals?.action?.length)return [];const out=[];let a=null;
 const quiet=t=>!words.some(w=>w.end>t-.75&&w.start<t+.75),on=t=>(signals.action[t]||0)>=ACTION_KEEP&&quiet(t);
 const last=Math.floor(end);for(let t=Math.ceil(start);t<=last;t++){const yes=on(t);if(yes&&a===null)a=t;if((!yes||t===last)&&a!==null){const b=yes?t:t-1;out.push({start:+Math.max(start,a-.6).toFixed(2),end:+Math.min(end,b+1).toFixed(2)});a=null;}}
 return out.slice(0,max);}

// Automatic YouTube thumbnails for stream clips: the streamer's most expressive face cut out over a vivid gameplay
// frame, 1-4 huge words, the game name and an optional LIVE badge (workers/auto_thumb.py). The official game logo is
// never used (it is the publisher's trademark); the game name is drawn in our own lettering.
import fs from 'node:fs';import path from 'node:path';
import {run} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';
import {clipFacecam,reactionWindows} from './stack.mjs';

const FILLER=new Set(['the','a','an','to','of','by','with','for','and','on','in','at','his','her','their','is','was','gets','got']);
/** 2-4 punchy words from the clip's hook or title, without the streamer's name (their face is on the thumbnail). */
export function thumbText(clip,job={}){
 const names=[job.host?.name,job.host?.short,job.sourceInfo?.uploader,job.sourceInfo?.channel].filter(Boolean).flatMap(n=>String(n).toLowerCase().split(/\s+/));
 const words=String(clip.hook||clip.title||'').replace(/[“”"]/g,'').split(/\s+/).map(w=>w.replace(/[,:;.]+$/,'')).filter(Boolean).filter(w=>!names.includes(w.toLowerCase().replace(/[^\p{L}\d]/gu,'')));
 if(words.length<=4)return words.join(' ');
 // Keep numbers and the words around them ("6 STARS", "10K"); otherwise drop filler and keep the first four.
 const n=words.findIndex(w=>/\d/.test(w));if(n>=0)return words.slice(Math.max(0,n-1),n+2).join(' ');
 return words.filter(w=>!FILLER.has(w.toLowerCase())).slice(0,4).join(' ');
}
/** Short game name for the corner label: "GTA 6" for Grand Theft Auto VI; nothing for non-game categories. */
export function gameLabel(job={}){
 const c=String(job.sourceInfo?.categories?.[0]||job.sourceInfo?.game||'').trim();if(!c||/just chatting|irl|talk shows|music|people & blogs|entertainment|gaming$/i.test(c))return '';
 const gta=c.match(/grand theft auto\s*(vi|6|v|5|iv|4)\b/i);if(gta)return `GTA ${({vi:'6','6':'6',v:'V','5':'V',iv:'IV','4':'IV'})[gta[1].toLowerCase()]}`;
 return c.length<=16?c:'';
}

/** Head-and-shoulders box around a face ([x,y,w,h] shares): 4.5 face widths wide, face about a third from the top. */
export function aroundFace([fx,fy,fw,fh]){
 const w=Math.min(1,fw*4.5),h=Math.min(1,fh*3.4),x=Math.max(0,Math.min(1-w,fx+fw/2-w/2)),y=Math.max(0,Math.min(1-h,fy-fh*.8));
 return [x,y,w,h].map(v=>+v.toFixed(4));
}

/**
 * Render a thumbnail for `clip` to `out`. Options: text (else from the clip), live (LIVE badge), arrow.
 * Returns {file, text, faceAt, person}. Uses 1080p footage: the source, or a full-quality section for long streams.
 */
export async function autoThumbnail(job,folder,clip,out,{text,live=false,arrow=false,signal,runWorker=run}={}){
 let video=job.sourcePath,shift=0;
 if(job.remote?.proxy){const {ensureSection}=await import('./remote.mjs');const sec=await ensureSection(job,folder,clip.start,clip.end,{signal});video=sec.file;shift=sec.start;}
 const m=job.metadata||{},portrait=m.height>m.width;let cam=null;
 if(!portrait){try{const found=await clipFacecam(job,folder,clip,{signal});
  if(found?.found)cam=found.box;
  // No border found but the streamer's steady face was: use a head-and-shoulders area around it, never the whole
  // frame (where game characters' faces would compete).
  else if(Array.isArray(found?.face)&&!found.full)cam=aroundFace(found.face);}catch(e){if(signal?.aborted)throw e;}}
 // Frames every 2 s, plus the loudest reactions (where the best faces usually are).
 const times=[];for(let t=clip.start+.5;t<clip.end-.5;t+=2)times.push(+t.toFixed(2));
 const audio=path.join(folder,'audio.wav');
 if(fs.existsSync(audio)){try{const len=clip.end-clip.start;for(const [a] of reactionWindows({audio,edl:[{start:clip.start,end:clip.end,outputStart:0,outputEnd:len}],duration:len}).slice(1))for(const d of [.2,.6,1])times.push(+(clip.start+a+d).toFixed(2));}catch{}}
 const words=(text??thumbText(clip,job)).trim().slice(0,40);
 const spec={video,shift,times,cam,text:words,badge:live?'LIVE':'',game:gameLabel(job),arrow,fonts:path.join(ROOT,'assets','fonts'),out};
 const specFile=out.replace(/\.jpg$/i,'')+'.spec.json';fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(specFile,JSON.stringify(spec));
 try{const r=await runWorker(PYTHON,[path.join(ROOT,'workers','auto_thumb.py'),specFile],{signal,timeout:5*60*1000});
  const res=JSON.parse(String(r.stdout).trim().split(/\r?\n/).at(-1));if(res.error)throw new Error(res.error);
  return {file:out,text:words,faceAt:res.faceAt,person:res.person};}
 finally{fs.rmSync(specFile,{force:true});}
}

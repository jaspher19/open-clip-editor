// Stacked facecam layout for 9:16: the streamer's webcam on top, gameplay below.
// The facecam box is found by workers/facecam.py (a steady face plus the overlay's fixed borders) and can be
// moved or resized in the editor; boxes are [x, y, w, h] as shares (0-1) of the source frame.
import fs from 'node:fs';import path from 'node:path';
import {run} from './process.mjs';import {PYTHON,ROOT} from './config.mjs';

import {validBox,stackPanels,defaultGameBox,STACK_SPLIT_MIN,STACK_SPLIT_MAX,CARD,cardCamBox,ZOOM,zoomBox} from '../web/src/logic.mjs';
export {validBox,stackPanels,defaultGameBox,CARD,cardCamBox};
export const SPLIT_MIN=STACK_SPLIT_MIN,SPLIT_MAX=STACK_SPLIT_MAX;
const W=1080;

const cropOf=([x,y,w,h])=>`crop=w='floor(iw*${w.toFixed(5)}/2)*2':h='floor(ih*${h.toFixed(5)}/2)*2':x='iw*${x.toFixed(5)}':y='ih*${y.toFixed(5)}'`;
/** Filter lines from [cutv] to [framed]: each box is cropped, scaled to cover its panel, and the panels are stacked. */
export function stackFilters({camBox,gameBox,top,bottom,zooms=[],face=null,style='panels',overlays='../../assets/overlays'}){
 const panel=(box,h,label,w=W)=>`${cropOf(box)},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[${label}]`;
 const when=zooms.map(([a,b])=>`between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
 if(style==='card'){
  // Blurred gameplay behind everything (blurred small for speed), the gameplay band, then the rounded cam and its frame.
  const {cam,game}=CARD,png=f=>`movie=${overlays.replace(/\\/g,'/')}/${f}`;
  const camLines=zooms.length?[`[camsrc]${panel(camBox,cam.h,'camwide',cam.w)}`,`[zoomsrc]${panel(zoomBox(camBox,face),cam.h,'camtight',cam.w)}`,`[camwide][camtight]overlay=0:0:enable='${when}'[campanel]`]:[`[camsrc]${panel(camBox,cam.h,'campanel',cam.w)}`];
  return [`[cutv]split=${zooms.length?4:3}[camsrc]${zooms.length?'[zoomsrc]':''}[gamesrc][bgsrc]`,
   '[bgsrc]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=6:2,scale=1080:1920,eq=brightness=-0.04,setsar=1[cardbg]',
   `[gamesrc]${panel(gameBox,game.h,'gamepanel')}`,`[cardbg][gamepanel]overlay=0:${game.y}[cardbase]`,
   ...camLines,`${png('cam-card-mask.png')},format=gray[cardmask]`,'[campanel]format=rgba[camrgba]','[camrgba][cardmask]alphamerge[camround]',
   `[cardbase][camround]overlay=${cam.x}:${cam.y}[cardcam]`,`${png('cam-card-frame.png')}[cardframe]`,'[cardcam][cardframe]overlay=0:0,setsar=1[framed]'];
 }
 if(!zooms.length)return ['[cutv]split=2[camsrc][gamesrc]',`[camsrc]${panel(camBox,top,'campanel')}`,`[gamesrc]${panel(gameBox,bottom,'gamepanel')}`,'[campanel][gamepanel]vstack=inputs=2,setsar=1[framed]'];
 // Reaction zooms: a tighter crop of the cam shown over the normal cam panel during each window (hard cuts, as clip edits do).
 return ['[cutv]split=3[camsrc][zoomsrc][gamesrc]',`[camsrc]${panel(camBox,top,'camwide')}`,`[zoomsrc]${panel(zoomBox(camBox,face),top,'camtight')}`,
  `[camwide][camtight]overlay=0:0:enable='${when}'[campanel]`,`[gamesrc]${panel(gameBox,bottom,'gamepanel')}`,'[campanel][gamepanel]vstack=inputs=2,setsar=1[framed]'];
}

/**
 * Find the facecam in a clip's source range, cached per clip and range. `file` is the video to read (a full-quality
 * section for long streams) and `shift` its start in source time.
 */
export async function detectFacecam({file,shift=0,start,end,out,signal,runWorker=run}){
 try{const saved=JSON.parse(fs.readFileSync(out,'utf8'));if(saved.start===start&&saved.end===end)return saved;}catch{}
 const tmp=out.replace(/\.json$/,'.tmp.json');
 await runWorker(PYTHON,[path.join(ROOT,'workers/facecam.py'),file,tmp,'--start',String(Math.max(0,start-shift)),'--end',String(end-shift)],{signal,timeout:10*60*1000,logFile:out.replace(/\.json$/,'.log')});
 const result={...JSON.parse(fs.readFileSync(tmp,'utf8')),start,end};fs.writeFileSync(out,JSON.stringify(result,null,2));fs.rmSync(tmp,{force:true});
 return result;
}

/** Everything the renderer needs for one clip: boxes, panel sizes and a note for the export card. Null when there is nothing to stack. */
export function stackPlan(options,detected,sourceAspect=16/9){
 const manual=validBox(options.camBox),camBox=manual?options.camBox:detected?.found&&validBox(detected.box)?detected.box:null;
 if(!camBox)return null;
 const style=options.stackStyle==='card'?'card':'panels';
 const {top,bottom}=style==='card'?{top:1920-CARD.game.h,bottom:CARD.game.h}:stackPanels(camBox,{split:options.stackSplit,sourceAspect});
 const gameBox=validBox(options.gameBox)?options.gameBox:defaultGameBox(bottom,sourceAspect);
 // The streamer's face inside the cam (for reaction zooms); a manual box uses the detected face only if it lies inside.
 const f=detected?.face,face=Array.isArray(f)&&f[0]>=camBox[0]&&f[1]>=camBox[1]&&f[0]+f[2]<=camBox[0]+camBox[2]&&f[1]+f[3]<=camBox[1]+camBox[3]?f:null;
 return {camBox:style==='card'?cardCamBox(camBox,face,sourceAspect):camBox,gameBox,top,bottom,face,style,note:`${style==='card'?'Glow card facecam':'Facecam on top'} · ${manual?'your box':'found automatically'}`};
}

/** Find the facecam for a clip, reading a full-quality section for long streams. Cached in clips/<id>.facecam.json. */
export async function clipFacecam(job,folder,clip,{signal,detect=detectFacecam}={}){
 const {ensureSection}=await import('./remote.mjs');
 const sec=job.remote?.proxy?await ensureSection(job,folder,clip.start,clip.end,{signal}):null;
 fs.mkdirSync(path.join(folder,'clips'),{recursive:true});
 const found=await detect({file:sec?sec.file:job.sourcePath,shift:sec?sec.start:0,start:clip.start,end:clip.end,out:path.join(folder,'clips',`${clip.id}.facecam.json`),signal});
 return withStreamCam(folder,found);
}
/**
 * A streamer's cam stays in one place for the whole stream. The most confident border-based detection is kept per
 * project (facecam-stream.json); a clip whose own detection found the streamer's steady face but not the borders
 * reuses that box when the face sits inside it (seen on real GTA clips where the border hid behind busy footage).
 */
export function withStreamCam(folder,found){
 const file=path.join(folder,'facecam-stream.json');let saved=null;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 if(found?.found&&found.method==='edges'&&validBox(found.box)&&(!saved||(found.edgeScore||0)>(saved.edgeScore||0))){fs.writeFileSync(file,JSON.stringify({box:found.box,edgeScore:found.edgeScore||0}));return found;}
 const f=found?.face,b=saved?.box;
 if(found&&!found.found&&!found.full&&validBox(b)&&Array.isArray(f)&&f[0]>=b[0]&&f[1]>=b[1]&&f[0]+f[2]<=b[0]+b[2]+.01&&f[1]+f[3]<=b[1]+b[3]+.01)return {...found,found:true,box:b,method:'stream'};
 return found;
}

// ---- Reaction zooms ("Cam Split" template) ------------------------------------------------------------------
// Clip channels open on the streamer's reaction and cut tighter on the face for the big reactions. A full-screen cam
// would upscale a ~260 px tall webcam about 7x, so the cam panel itself cuts in on the face (about 1.4x) instead.
export const OPEN_ZOOM=1.2,REACTION=1.5;
export {ZOOM,zoomBox};
const HYPE=/^(yes+|yeah+|no+|nah+|what+|bro+|oh+|wait|stop|chat|bruh|ayo|wow|crazy|insane|let'?s|go+|omg|why|how)$/i;

/** Read 16-bit mono PCM samples of a WAV between two times (seconds). */
export function readPcm(file,start,end){
 const fd=fs.openSync(file,'r');try{
  const head=Buffer.alloc(4096);fs.readSync(fd,head,0,4096,0);let pos=12,rate=16000,data=-1;
  while(pos+8<=head.length){const id=head.toString('ascii',pos,pos+4),size=head.readUInt32LE(pos+4);if(id==='fmt ')rate=head.readUInt32LE(pos+12);if(id==='data'){data=pos+8;break;}pos+=8+size+(size&1);}
  if(data<0)throw new Error('No audio data in '+file);
  const a=Math.max(0,Math.floor(start*rate)),b=Math.max(a,Math.floor(end*rate)),buf=Buffer.alloc((b-a)*2);
  const n=fs.readSync(fd,buf,0,buf.length,data+a*2);return {rate,samples:new Int16Array(buf.buffer,buf.byteOffset,Math.floor(n/2))};
 }finally{fs.closeSync(fd);}
}

/**
 * Output-time windows [[start,end],...] for the cam to cut in: the opening hook, then up to three reaction peaks
 * (loudness well above the clip's own level, hype words count extra), at least 7 s apart, away from the ending.
 */
export function reactionWindows({audio,edl,words=[],duration}){
 const step=.25,levels=[];
 for(const s of edl){if((s.kind||'main')!=='main')continue;const {rate,samples}=readPcm(audio,s.start,s.end),per=Math.round(rate*step);
  for(let i=0;i+per<=samples.length;i+=per){let sum=0;for(let k=i;k<i+per;k++)sum+=samples[k]*samples[k];const db=10*Math.log10(sum/per/32768/32768+1e-10);
   levels.push({at:s.outputStart+(i/rate)/(s.speed||1),db});}}
 const sorted=levels.map(l=>l.db).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]??-60;
 for(const w of words)if(HYPE.test(String(w.text).replace(/[^\p{L}']/gu,''))||/!$/.test(w.text))for(const l of levels)if(l.at>=w.start-.1&&l.at<=w.end)l.db+=3;
 const picks=[];
 for(const l of [...levels].filter(l=>l.at>3&&l.at<duration-2.5&&l.db>=median+7).sort((a,b)=>b.db-a.db)){if(picks.length>=3)break;if(picks.every(p=>Math.abs(p-l.at)>=7))picks.push(l.at);}
 return [[0,Math.min(OPEN_ZOOM,duration)],...picks.sort((a,b)=>a-b).map(t=>[+Math.max(0,t-.35).toFixed(3),+Math.min(duration,t-.35+REACTION).toFixed(3)])];
}

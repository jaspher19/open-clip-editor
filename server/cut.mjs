// Video cutter: the owner picks ranges of the source (with the stream timeline's suggestions) and gets one MP4 of
// them back to back. Framing: fill or fit the chosen shape, or a camera + gameplay layout (two boxes cut from the
// source, each placed on the output). Text the owner typed is drawn in the browser (the same canvas as the preview,
// so fonts and sizes match exactly) and laid over the whole video as one transparent PNG.
import fs from 'node:fs';import path from 'node:path';
import {run,probe,filterScriptArgs} from './process.mjs';import {ensureSection} from './remote.mjs';
import {validBox} from '../web/src/logic.mjs';
import {cleanCaption,captionGroups,captionMetrics,cutFont} from '../web/src/cutCaptions.mjs';
import {ensureTranscribed} from './scan.mjs';import {ROOT} from './config.mjs';

export const CUT_FORMATS={
 video:{width:1920,height:1080,label:'Landscape 16:9'},
 shorts:{width:1080,height:1920,label:'Portrait 9:16'},
};
/** Export quality: the short side in pixels. 1440 is 2K (1440 × 2560 portrait, 2560 × 1440 landscape). */
export const CUT_QUALITIES={720:{crf:21,preset:'veryfast',label:'720p HD'},1080:{crf:19,preset:'veryfast',label:'1080p Full HD'},1440:{crf:18,preset:'faster',label:'1440p 2K'}};
export function cutSize(format,quality=1080){const base=CUT_FORMATS[format],k=Number(quality)/1080,even=v=>Math.round(v*k/2)*2;return {width:even(base.width),height:even(base.height)};}
export const CUT_LIMITS={segments:50,min:.5,total:3*3600,overlayBytes:4e6};
const PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

/** Camera + gameplay layout: source boxes (shares of the source frame) and where each goes (shares of the output). */
export function validateLayout(layout){
 const fail=m=>Object.assign(new Error(m),{status:400});
 if(!layout||typeof layout!=='object')throw fail('Set the camera and gameplay boxes');
 for(const k of ['cam','game','camOut','gameOut'])if(!validBox(layout[k]))throw fail(`Invalid ${k} box: use [x, y, width, height] inside the frame`);
 for(const k of ['camOut','gameOut'])if(layout[k][2]<.05||layout[k][3]<.05)throw fail('Each panel must cover at least 5% of the video');
 return {cam:layout.cam.map(round4),game:layout.game.map(round4),camOut:layout.camOut.map(round4),gameOut:layout.gameOut.map(round4),camOnTop:layout.camOnTop!==false,camHidden:layout.camHidden===true};
}
const round4=v=>+Math.max(0,Math.min(1,v)).toFixed(4);

/** A transparent PNG the size of the output, as a data URL; returns its bytes. */
export function decodeOverlay(dataUrl,{width,height}){
 const fail=m=>Object.assign(new Error(m),{status:400});
 const m=/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl||''));if(!m)throw fail('The text layer must be a PNG');
 const bytes=Buffer.from(m[1],'base64');if(bytes.length>CUT_LIMITS.overlayBytes)throw fail('The text layer is too large');
 if(!bytes.subarray(0,8).equals(PNG)||bytes.toString('ascii',12,16)!=='IHDR')throw fail('The text layer is not a valid PNG');
 if(bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height)throw fail(`The text layer must be ${width}×${height}`);
 return bytes;
}

/** Checks a cut request against the source; returns {segments, format, framing, layout, overlay, texts, title, total}. */
export function validateCut(body={},duration=0){
 const fail=m=>Object.assign(new Error(m),{status:400});
 const list=body.segments;if(!Array.isArray(list)||!list.length)throw fail('Add at least one part to cut');if(list.length>CUT_LIMITS.segments)throw fail(`A cut can have up to ${CUT_LIMITS.segments} parts`);
 const segments=list.map((s,i)=>{const start=Number(s?.start),end=Number(s?.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+.05||end-start<CUT_LIMITS.min)throw fail(`Part ${i+1} must be at least ${CUT_LIMITS.min} s long and inside the video`);return {start:+start.toFixed(3),end:+Math.min(duration,end).toFixed(3)};});
 const total=segments.reduce((n,s)=>n+s.end-s.start,0);if(total>CUT_LIMITS.total)throw fail('A cut can be up to 3 hours long');
 const format=body.format==='shorts'?'shorts':body.format==='video'?'video':null;if(!format)throw fail('Choose portrait or landscape');
 const framing=['fill','fit','split'].includes(body.framing)?body.framing:format==='video'?'fit':'fill';
 const layout=framing==='split'?validateLayout(body.layout):null;
 const quality=body.quality===undefined?1080:Number(body.quality);if(!CUT_QUALITIES[quality])throw fail('Choose 720p, 1080p or 1440p (2K)');
 const overlay=body.overlay?decodeOverlay(body.overlay,cutSize(format,quality)):null;
 // The typed text is kept with the cut (not used to render) so "Load these parts" can bring it back for editing.
 const texts=Array.isArray(body.texts)?body.texts.slice(0,8).filter(t=>t&&typeof t.text==='string').map(t=>({...t,text:t.text.slice(0,200)})):[];
 if(JSON.stringify(texts).length>8000)throw fail('Too much text');
 const title=typeof body.title==='string'?body.title.trim().slice(0,80):'';
 const captions=body.captions?validateCaptions(body.captions,total):null;
 return {segments,format,quality,framing,layout,overlay,texts,captions,title,total};
}

/** Auto captions: the look (cleaned) and word corrections ({start key: text}). Transcribing is CPU work: up to 30 minutes. */
export const CAPTION_MAX_SECONDS=30*60;
export function validateCaptions(c,total=0){
 const fail=m=>Object.assign(new Error(m),{status:400});if(typeof c!=='object')throw fail('Invalid captions');
 if(total>CAPTION_MAX_SECONDS)throw fail('Auto captions work on cuts up to 30 minutes long');
 const edits={};for(const [k,v] of Object.entries(c.edits||{}).slice(0,5000)){if(!/^\d+\.\d{2}$/.test(k)||typeof v!=='string'||v.length>60)throw fail('Invalid caption correction');edits[k]=v;}
 return {...cleanCaption(c),edits};
}

/** Transcript words inside each part (transcribing any part not transcribed yet), in source time. */
export async function cutWords(job,folder,segments,{signal,ensure=ensureTranscribed}={}){
 for(const s of segments)await ensure(job,folder,s.start,s.end,{signal});
 const all=JSON.parse(fs.readFileSync(path.join(folder,'transcript.json'),'utf8')).words||[];
 return segments.map(s=>all.filter(w=>w.start>=s.start-.05&&w.start<s.end-.05&&String(w.text||'').trim()).map(w=>({start:+w.start.toFixed(3),end:+Math.min(w.end,s.end).toFixed(3),text:String(w.text).trim()})));
}

const assTime=t=>{const c=Math.max(0,Math.round(t*100)),h=Math.floor(c/360000),m=Math.floor(c/6000)%60,sec=Math.floor(c/100)%60;return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
const assColor=hex=>`&H00${hex.slice(5,7)}${hex.slice(3,5)}${hex.slice(1,3)}&`.toUpperCase();
/**
 * libass captions for a cut: `parts` are the words of each part (source time) and the parts themselves; groups never
 * span two parts. Sizes come from captionMetrics on the PlayRes width, as the preview draws them.
 */
export function captionsAss(parts,segments,caption,{width,height}){
 const c=cleanCaption(caption),f=cutFont(c.font),m=captionMetrics(c,width),margin=Math.round(width*.06);
 const look=c.style==='box'?{bs:3,outline:m.pad,shadow:0,edge:assColor(c.boxColor)}:c.style==='shadow'?{bs:1,outline:0,shadow:m.shadow,edge:'&H00000000&'}:{bs:1,outline:m.bord,shadow:0,edge:'&H00000000&'};
 const lines=[`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 1\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,${f.family},${m.ass.toFixed(1)},${assColor(c.color).slice(0,-1)},${assColor(c.color).slice(0,-1)},${look.edge.slice(0,-1)},&H40000000,${f.weight>=700?-1:0},0,0,0,100,100,0,0,${look.bs},${look.outline.toFixed(1)},${look.shadow.toFixed(1)},5,${margin},${margin},0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`];
 const pos=`{\\pos(${Math.round(c.x*width)},${Math.round(c.y*height)})}`,hot=assColor(c.highlight),base=assColor(c.color);let offset=0;
 segments.forEach((s,i)=>{const shift=offset-s.start,limit=offset+(s.end-s.start);
  for(const g of captionGroups(parts[i]||[],{per:c.words,edits:caption.edits||{},upper:c.upper})){g.words.forEach((w,k)=>{const a=Math.max(offset,(k?w.start:g.start)+shift),b=Math.min(limit,(k<g.words.length-1?g.words[k+1].start:g.end)+shift);if(b-a<.02)return;
   const text=g.words.map((x,j)=>j===k&&c.highlight.toLowerCase()!==c.color.toLowerCase()?`{\\c${hot}}${x.text}{\\c${base}}`:x.text).join(' ');lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Cap,,0,0,0,,${pos}${text}`);});}
  offset=limit;});
 return lines.join('\n')+'\n';
}

const even=v=>Math.max(2,Math.round(v/2)*2),evenAt=v=>Math.max(0,Math.round(v/2)*2);
/** Output pixels of a panel [x,y,w,h] (shares), on even numbers so yuv420p never rounds a panel off the frame. */
export function panelPixels(box,{width,height}){const x=Math.min(width-2,evenAt(box[0]*width)),y=Math.min(height-2,evenAt(box[1]*height));return {x,y,w:Math.min(width-x,even(box[2]*width)),h:Math.min(height-y,even(box[3]*height))};}
const f4=v=>v.toFixed(4);
/** A source box cropped, then scaled to cover its panel (centre crop of any leftover, as the preview does). */
const panelChain=(box,p)=>`crop=w=iw*${f4(box[2])}:h=ih*${f4(box[3])}:x=iw*${f4(box[0])}:y=ih*${f4(box[1])},scale=${p.w}:${p.h}:force_original_aspect_ratio=increase,crop=${p.w}:${p.h},setsar=1`;

/** Picture chain for one part: fill (crop to the shape), fit (whole frame over a blurred copy), or the camera + gameplay layout. */
export function frameFilter(input,output,{width,height,framing,layout,duration=1}){
 const size=`${width}:${height}`;
 if(framing==='split'&&layout){
  const game=panelPixels(layout.gameOut,{width,height}),cam=panelPixels(layout.camOut,{width,height}),o=output;
  const lines=[`color=c=black:s=${width}x${height}:r=30:d=${duration.toFixed(3)}[${o}bg]`];
  if(layout.camHidden){lines.push(`[${input}]fps=30,${panelChain(layout.game,game)}[${o}g]`,`[${o}bg][${o}g]overlay=${game.x}:${game.y}:eof_action=pass,format=yuv420p[${o}]`);return lines;}
  lines.push(`[${input}]fps=30,split=2[${o}sg][${o}sc]`,`[${o}sg]${panelChain(layout.game,game)}[${o}g]`,`[${o}sc]${panelChain(layout.cam,cam)}[${o}c]`);
  const [first,second]=layout.camOnTop?[['g',game],['c',cam]]:[['c',cam],['g',game]];
  lines.push(`[${o}bg][${o}${first[0]}]overlay=${first[1].x}:${first[1].y}:eof_action=pass[${o}l]`,`[${o}l][${o}${second[0]}]overlay=${second[1].x}:${second[1].y}:eof_action=pass,format=yuv420p[${o}]`);
  return lines;
 }
 if(framing==='fit')return [`[${input}]fps=30,split=2[${output}b][${output}f]`,`[${output}b]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=24:2[${output}bg]`,`[${output}f]scale=${size}:force_original_aspect_ratio=decrease[${output}fg]`,`[${output}bg][${output}fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[${output}]`];
 return [`[${input}]fps=30,scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1,format=yuv420p[${output}]`];
}

/** The whole filter graph: each input is one part (already seeked and limited with -ss/-t); a text layer is the last input. */
export function cutGraph(segments,{width,height,framing,layout=null,overlay=false,captions=null}){
 const lines=[];segments.forEach((s,i)=>{const d=s.end-s.start,ds=d.toFixed(3);
  lines.push(...frameFilter(`${i}:v`,`f${i}`,{width,height,framing,layout,duration:d}));
  lines.push(`[f${i}]trim=duration=${ds},setpts=PTS-STARTPTS[v${i}]`);
  lines.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${ds},asetpts=N/SR/TB,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0,d-.02).toFixed(3)}:d=0.02[a${i}]`);});
 lines.push(segments.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${segments.length}:v=1:a=1[${overlay||captions?'vc':'v'}][a]`);
 // Captions (libass, under the typed text), then the text layer on top.
 if(captions)lines.push(`[vc]ass=filename=${captions.file}:fontsdir=${captions.fontsdir}${overlay?'[vs]':',format=yuv420p[v]'}`);
 if(overlay)lines.push(`[${segments.length}:v]format=rgba[txt]`,`[${captions?'vs':'vc'}][txt]overlay=0:0:format=auto,format=yuv420p[v]`);
 return lines.join(';\n');
}

/**
 * Render a cut to work/<job>/exports/cut-<id>.mp4. Long streams imported as a light copy read each part from its
 * full-quality section; if that fails the part comes from the light copy and the result says so.
 */
export async function renderCut(job,folder,{id,segments,format,quality=1080,framing,layout=null,overlay=null,captions=null},{signal,onProgress,runCommand=run,probeFile=probe,section=ensureSection,words=cutWords}={}){
 const {width,height}=cutSize(format,quality),{crf,preset}=CUT_QUALITIES[quality],dir=path.join(folder,'exports'),work=path.join(folder,'cuts');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(work,{recursive:true});
 const out=path.join(dir,`cut-${id}.mp4`),temp=path.join(dir,`cut-${id}.partial.mp4`),graph=path.join(work,`${id}.ffscript`),text=path.join(work,`${id}.text.png`),total=segments.reduce((n,s)=>n+s.end-s.start,0);
 let preview=false,previewReason='',sourceSide=0;const inputs=[];
 for(const s of segments){let file=job.sourcePath,at=s.start;
  if(job.remote?.proxy){try{const sec=await section(job,folder,s.start,s.end,{signal,height:quality>1080?1440:1080});file=sec.file;at=Math.max(0,s.start-sec.start);sourceSide=Math.max(sourceSide,Math.min(Number(sec.width)||0,Number(sec.height)||0));}catch(e){if(signal?.aborted)throw e;preview=true;previewReason||=e.message;}}
  inputs.push('-ss',at.toFixed(3),'-t',(s.end-s.start+.1).toFixed(3),'-i',file);}
 if(!job.remote?.proxy)sourceSide=Math.min(Number(job.metadata?.width)||0,Number(job.metadata?.height)||0);
 if(overlay){fs.writeFileSync(text,overlay);inputs.push('-i',text);}
 // Captions are laid out on the shape's 1080p canvas (PlayRes); libass scales them to the export size.
 let caps=null;if(captions){const parts=await words(job,folder,segments,{signal});fs.writeFileSync(path.join(work,`${id}.ass`),captionsAss(parts,segments,captions,CUT_FORMATS[format]));caps={file:`cuts/${id}.ass`,fontsdir:path.relative(folder,path.join(ROOT,'web','public','fonts')).split(path.sep).join('/')};}
 fs.writeFileSync(graph,cutGraph(segments,{width,height,framing,layout,overlay:!!overlay,captions:caps}));
 try{
  await runCommand('ffmpeg',['-hide_banner','-nostdin','-y',...inputs,...await filterScriptArgs(graph),'-map','[v]','-map','[a]','-t',total.toFixed(3),'-c:v','libx264','-preset',preset,'-crf',String(crf),'-threads','4','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart','-progress','pipe:1','-nostats',temp],{cwd:folder,signal,timeout:0,idleTimeout:10*60*1000,logFile:path.join(work,`${id}.log`),onLine:line=>{const m=line.match(/^out_time_us=(\d+)/);if(m)onProgress?.(Math.min(1,Number(m[1])/1e6/Math.max(.1,total)));}});
  const meta=await probeFile(temp,{signal});if(meta.width!==width||meta.height!==height)throw new Error('The cut came out in the wrong size');
  fs.renameSync(temp,out);
  // The sharpest picture any part came from, so the app can say when 2K was made from a 1080p stream.
  return {file:path.basename(out),duration:meta.duration,bytes:fs.statSync(out).size,width,height,preview,...(previewReason?{previewReason}:{}),sourceSide};
 }catch(e){fs.rmSync(temp,{force:true});throw e;}
 finally{fs.rmSync(graph,{force:true});fs.rmSync(text,{force:true});fs.rmSync(path.join(work,`${id}.ass`),{force:true});}
}

import fs from 'node:fs';import path from 'node:path';import {run} from './process.mjs';import {ROOT} from './config.mjs';
// Custom thumbnails for main videos: one 1280x720 frame, optionally with big outlined text in the title font.
const FONTS=path.join(ROOT,'assets','fonts');
const assText=t=>String(t||'').replace(/[{}\\]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
// Two lines at most, split near the middle so the text stays large.
function lines(text){const w=assText(text).split(' ').filter(Boolean);if(w.length<3)return w.join(' ');let best=1,diff=Infinity;for(let i=1;i<w.length;i++){const d=Math.abs(w.slice(0,i).join(' ').length-w.slice(i).join(' ').length);if(d<diff){diff=d;best=i;}}return `${w.slice(0,best).join(' ')}\\N{\\c&H3FD2FF&}${w.slice(best).join(' ')}`;}
export function thumbnailAss(text){
 const body=lines(text),size=assText(text).length>22?104:124;
 return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Thumb,Montserrat Black,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,9,5,1,40,40,46,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Thumb,,0,0,0,,${body}\n`;
}
// A thumbnail only needs the picture, so unlike probe() this accepts files without audio.
async function frameInfo(file,options){const r=await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height:format=duration','-of','json',file],options);const d=JSON.parse(r.stdout),s=d.streams?.[0];if(!s?.width)throw new Error('This post has no video picture to take a thumbnail from');return {width:s.width,height:s.height,duration:Number(d.format?.duration)||0};}
/** Renders the frame at `time` (seconds into the post's video) to `output`. Vertical footage gets a blurred fill. */
export async function renderThumbnail(video,output,{time=0,text='',signal}={}){
 const meta=await frameInfo(video,{signal}),at=Math.max(0,Math.min(Number(time)||0,Math.max(0,meta.duration-.1)));
 // Temp files stay on this drive under .cache, so the fonts path can be relative (no "E:" colon in the filter).
 const temps=path.join(ROOT,'.cache','thumbnails');fs.mkdirSync(temps,{recursive:true});const work=fs.mkdtempSync(path.join(temps,'t-')),ass=path.join(work,'text.ass');
 try{
  const wide=meta.width>meta.height,fit=wide?'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720':'split=2[bg][fg];[bg]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=24:2[b];[fg]scale=1280:720:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2';
  let filter=`${fit},setsar=1`;
  if(assText(text)){fs.writeFileSync(ass,thumbnailAss(text));filter+=`,ass=filename=text.ass:fontsdir=${path.relative(work,FONTS).split(path.sep).join('/')}`;}
  const partial=output.replace(/\.jpe?g$/i,'')+'.partial.jpg';
  await run('ffmpeg',['-hide_banner','-nostdin','-v','error','-y','-ss',at.toFixed(3),'-i',video,'-frames:v','1','-vf',filter,'-q:v','3',partial],{cwd:work,signal,timeout:120000});
  // YouTube rejects thumbnails over 2 MB; quality 3 is far below that at 1280x720, but check anyway.
  if(fs.statSync(partial).size>2*1024*1024){fs.rmSync(partial,{force:true});throw new Error('The thumbnail came out over 2 MB; pick a less detailed frame');}
  fs.renameSync(partial,output);return {time:at,text:assText(text)?String(text).trim().slice(0,40):''};
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}

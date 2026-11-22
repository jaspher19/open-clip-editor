// Original demo for a facecam template card (Cam Split by default; `node scripts/make-cam-split-demo.mjs glow-card`): a synthetic "stream" (moving gameplay pattern with a bordered cam box
// in the corner, one loud reaction at 4.5 s) rendered through the real template. No third-party footage.
import fs from 'node:fs';import path from 'node:path';import {ROOT,localEnv} from '../server/config.mjs';import {run} from '../server/process.mjs';
import {renderClip} from '../server/render.mjs';import {applyTemplate} from '../server/templates.mjs';import {validateOptions} from '../server/options.mjs';
Object.assign(process.env,localEnv());
const id=process.argv[2]||'cam-split';if(!['cam-split','glow-card','raw-clip'].includes(id))throw new Error('Use cam-split, glow-card or raw-clip');
const folder=path.join(ROOT,'work',`${id}-demo`),publicDir=path.join(ROOT,'web/public/templates');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(publicDir,{recursive:true});
const sourcePath=path.join(folder,'source.mp4'),font='assets/fonts/WorkSans-Bold.ttf';
// Cam box: x 0-320, y 90-270 of 1280x720 (shares [0, .125, .25, .25]); a simple figure, a white border.
const cam=["drawbox=x=0:y=90:w=320:h=180:c=0x2a2238:t=fill","drawbox=x=40:y=110:w=60:h=110:c=0x4b3a63:t=fill","drawbox=x=230:y=120:w=50:h=60:c=0x6a3f8a:t=fill",
 "drawbox=x=125:y=200:w=110:h=70:c=0xd9d4e8:t=fill","drawbox=x=150:y=128:w=60:h=72:c=0xe8c3a3:t=fill","drawbox=x=146:y=118:w=68:h=22:c=0x2b1d14:t=fill",
 "drawbox=x=0:y=90:w=320:h=180:c=white:t=3"].join(',');
const game=`drawtext=fontfile=${font}:text='GAMEPLAY':fontsize=72:fontcolor=white@0.85:x=(w-tw)/2+180:y=(h-th)/2`;
await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=1280x720:r=30:d=9','-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=9',
 '-vf',`hue=s=.55,${game},${cam}`,'-af',"volume='if(between(t,4.3,4.9),0.9,0.03)':eval=frame",'-c:v','libx264','-g','30','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-shortest',sourcePath]);
// Reaction zooms read the 16 kHz speech audio, as in a real project.
await run('ffmpeg',['-v','error','-y','-i',sourcePath,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',path.join(folder,'audio.wav')]);
const words='No way he actually pulled that off in the last second, chat'.split(' ').map((text,i)=>({text,start:.3+i*.68,end:.3+(i+1)*.68-.05}));
const transcript={words};fs.writeFileSync(path.join(folder,'transcript.json'),JSON.stringify(transcript));
const options=validateOptions(applyTemplate(id,{},{camBox:[0,.125,.25,.25],hookText:'He did NOT expect that',musicEnabled:false}));
const job={options,sourcePath,title:'Original OpenClip demo',source:{},silences:[],clips:[],metadata:{width:1280,height:720}};
const clip={id:`${id}-demo`,start:0,end:9,title:`${id} demo`,hook:'',score:80,kept:true,settings:options};
const out=await renderClip(job,clip,transcript,{folder});
const file=path.join(folder,'exports',out.filename);fs.copyFileSync(file,path.join(publicDir,`${id}.mp4`));
await run('ffmpeg',['-v','error','-y','-ss','2.2','-i',file,'-frames:v','1','-vf','scale=540:-2','-q:v','4',path.join(publicDir,`${id}.jpg`)]);
console.log(JSON.stringify({framing:out.framing,duration:out.duration,files:[`web/public/templates/${id}.mp4`,`web/public/templates/${id}.jpg`]}));

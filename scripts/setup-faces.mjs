// `npm run setup:faces` (optional): MediaPipe for face follow and automatic thumbnails, plus its three small models
// (Apache-2.0). Explains failures in plain words instead of a stack trace.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ROOT,PYTHON,CACHE,localEnv} from '../server/config.mjs';
const env=localEnv(),folder=path.join(CACHE,'models/face');
const MODELS=[
 ['blaze_face_short_range.tflite','https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite','face follow'],
 // Auto thumbnails: expression scores (jaw open, eyes wide) pick the reaction frame; the selfie segmenter cuts the streamer out.
 ['face_landmarker.task','https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task','thumbnail expressions'],
 ['selfie_segmenter.tflite','https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite','thumbnail cut-outs'],
];
try{
 if(!fs.existsSync(PYTHON))throw new Error('Run npm run setup first: it creates the Python environment this step adds to.');
 console.log('[1/2] Installing MediaPipe (face detection)…');
 const uv=spawnSync('uv',['--version'],{env,windowsHide:true}).status===0;
 const r=spawnSync(uv?'uv':PYTHON,uv?['pip','install','--python',PYTHON,'mediapipe>=0.10.30,<2']:['-m','pip','install','mediapipe>=0.10.30,<2'],{cwd:ROOT,env,windowsHide:true,stdio:'inherit'});
 if(r.error||r.status!==0)throw new Error('MediaPipe did not install (see the messages above). Check your internet connection, then run npm run setup:faces again.');
 console.log('[2/2] Downloading the face models…');fs.mkdirSync(folder,{recursive:true});
 for(const [file,url,use] of MODELS){
  if(fs.existsSync(path.join(folder,file))){console.log(`  ${file}: already here`);continue;}
  let response;try{response=await fetch(url);}catch{throw new Error(`Couldn't download the ${use} model: no internet connection? Run npm run setup:faces again when you're online.`);}
  if(!response.ok)throw new Error(`Couldn't download the ${use} model (the server answered ${response.status}). Try npm run setup:faces again later.`);
  const temp=path.join(folder,file+'.partial');fs.writeFileSync(temp,Buffer.from(await response.arrayBuffer()));fs.renameSync(temp,path.join(folder,file));console.log(`  ${file}: done`);
 }
 console.log('\nFace follow and automatic thumbnails are ready (MediaPipe models, Apache-2.0). Restart OpenClip if it is running.');
}catch(e){console.error(`\nFace setup stopped: ${e.message}\nOpenClip works without it; only face follow and automatic thumbnails need it.`);process.exitCode=1;}

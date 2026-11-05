import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ROOT,PYTHON,CACHE,localEnv} from '../server/config.mjs';
const env=localEnv();const uv=spawnSync('uv',['--version'],{env,windowsHide:true});
const r=spawnSync(uv.status===0?'uv':PYTHON,uv.status===0?['pip','install','--python',PYTHON,'mediapipe>=0.10.30,<2']:['-m','pip','install','mediapipe>=0.10.30,<2'],{cwd:ROOT,env,windowsHide:true,stdio:'inherit'});
if(r.error||r.status!==0)throw new Error('Face detector installation failed. Run npm run setup first.');
const folder=path.join(CACHE,'models/face');fs.mkdirSync(folder,{recursive:true});
const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite');if(!response.ok)throw new Error('Face model download failed');
fs.writeFileSync(path.join(folder,'blaze_face_short_range.tflite'),Buffer.from(await response.arrayBuffer()));console.log('Face follow ready. BlazeFace short-range model: Apache-2.0.');

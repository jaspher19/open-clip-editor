// `npm run setup:faces` (optional): MediaPipe for face follow, Cam Split and automatic thumbnails, plus its three
// small models (Apache-2.0). It ends with a real test (load MediaPipe and OpenCV, run the face detector once), repairs
// the usual breakages by itself and explains the rest in plain words instead of a stack trace.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ROOT,PYTHON,CACHE,localEnv} from '../server/config.mjs';
const env=localEnv(),folder=path.join(CACHE,'models/face');
const MODELS=[
 ['blaze_face_short_range.tflite','https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite','face follow'],
 // Auto thumbnails: expression scores (jaw open, eyes wide) pick the reaction frame; the selfie segmenter cuts the streamer out.
 ['face_landmarker.task','https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task','thumbnail expressions'],
 ['selfie_segmenter.tflite','https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite','thumbnail cut-outs'],
];
// Every OpenCV build that provides `cv2`. Two of them at once overwrite each other and break `import cv2`.
const OPENCV=['opencv-python','opencv-python-headless','opencv-contrib-python','opencv-contrib-python-headless'];
const uv=spawnSync('uv',['--version'],{env,windowsHide:true}).status===0;
const pip=(args,quiet=false)=>spawnSync(uv?'uv':PYTHON,uv?['pip',...args.filter(a=>a!=='-y'),'--python',PYTHON]:['-m','pip',...args],{cwd:ROOT,env,windowsHide:true,stdio:quiet?'pipe':'inherit',encoding:'utf8'});

// The same calls workers/facecam.py makes, on a blank picture: if this passes, Cam Split and face follow can run.
const TEST=`
import json,sys,importlib.metadata as md
out={'python':sys.version.split()[0],'opencv':[]}
for d in ${JSON.stringify(OPENCV)}:
    try:out['opencv'].append(d+' '+md.version(d))
    except Exception:pass
try:
    import numpy as np,cv2,mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    out['mediapipe']=mp.__version__
    opts=vision.FaceDetectorOptions(base_options=python.BaseOptions(model_asset_path=sys.argv[1]),running_mode=vision.RunningMode.IMAGE)
    with vision.FaceDetector.create_from_options(opts) as det:
        det.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.zeros((96,96,3),np.uint8)))
    cv2.Sobel(np.zeros((8,8),np.float32),cv2.CV_32F,1,0)
    out['ok']=True
except Exception as e:
    out['ok']=False;out['error']=type(e).__name__+': '+str(e)
print(json.dumps(out))
`;
function selfTest(){
 const r=spawnSync(PYTHON,['-I','-c',TEST,path.join(folder,MODELS[0][0])],{cwd:ROOT,env,windowsHide:true,encoding:'utf8'});
 try{return JSON.parse(String(r.stdout).trim().split('\n').at(-1));}catch{return {ok:false,error:(r.stderr||r.error?.message||'Python did not start').trim().split('\n').slice(-3).join(' '),opencv:[]};}
}
async function downloadModels(){
 fs.mkdirSync(folder,{recursive:true});
 for(const [file,url,use] of MODELS){
  if(fs.existsSync(path.join(folder,file))&&fs.statSync(path.join(folder,file)).size>10_000){console.log(`  ${file}: already here`);continue;}
  let response;try{response=await fetch(url);}catch{throw new Error(`Couldn't download the ${use} model: no internet connection? Run npm run setup:faces again when you're online.`);}
  if(!response.ok)throw new Error(`Couldn't download the ${use} model (the server answered ${response.status}). Try npm run setup:faces again later.`);
  const temp=path.join(folder,file+'.partial');fs.writeFileSync(temp,Buffer.from(await response.arrayBuffer()));fs.renameSync(temp,path.join(folder,file));console.log(`  ${file}: done`);
 }
}
/** The fix for a failed test, in plain words; repairs what it can first. Returns true when it repaired something. */
function repair(t){
 const e=String(t.error||'');
 // Two OpenCV builds, or one that NumPy/MediaPipe can't use: keep only the one MediaPipe asks for.
 if(t.opencv.length>1||/cv2|opencv|numpy|_ARRAY_API|dtype size/i.test(e)){
  console.log(`  Repairing OpenCV (${t.opencv.join(', ')||'broken'}): keeping a single build…`);
  pip(['uninstall','-y',...OPENCV]);
  pip(['install','--force-reinstall','mediapipe>=0.10.30,<2']);return true;}
 // A model file that was cut off or is not a model at all.
 if(/model|tflite|asset|Unable to open|INVALID_ARGUMENT|flatbuffer/i.test(e)){
  console.log('  The face model file looks damaged: downloading it again…');
  for(const [file] of MODELS)fs.rmSync(path.join(folder,file),{force:true});return 'models';}
 return false;
}
function explain(t){
 const e=String(t.error||'');
 if(/DLL load failed|_framework_bindings|msvcp|vcruntime/i.test(e))return 'Windows is missing the Microsoft Visual C++ Redistributable that MediaPipe needs.\n  Install it from https://aka.ms/vs/17/release/vc_redist.x64.exe, restart the computer, then run npm run setup:faces again.';
 if(/No module named ['"]?mediapipe/i.test(e))return `MediaPipe isn't installed in OpenClip's Python ${t.python||''}. Run npm run setup:faces again; if it still fails, OpenClip's Python may be too new for MediaPipe: delete the .venv folder, install Python 3.12, then run npm run setup and npm run setup:faces.`;
 return `The face tools didn't pass their test: ${e.slice(0,300)}\n  Run npm run setup:faces again. If it keeps failing, open an issue with this message.`;
}

try{
 if(!fs.existsSync(PYTHON))throw new Error('Run npm run setup first: it creates the Python environment this step adds to.');
 console.log('[1/3] Installing MediaPipe (face detection)…');
 const r=pip(['install','mediapipe>=0.10.30,<2']);
 if(r.error||r.status!==0)throw new Error('MediaPipe did not install (see the messages above). Check your internet connection, then run npm run setup:faces again.');
 console.log('[2/3] Downloading the face models…');await downloadModels();
 console.log('[3/3] Testing the face tools…');
 let t=selfTest();
 for(let attempt=0;!t.ok&&attempt<2;attempt++){const fixed=repair(t);if(!fixed)break;if(fixed==='models')await downloadModels();t=selfTest();}
 if(!t.ok)throw new Error(explain(t));
 console.log(`  MediaPipe ${t.mediapipe} · ${t.opencv.join(', ')} · Python ${t.python}: face detection works.`);
 console.log('\nFace follow, Cam Split and automatic thumbnails are ready (MediaPipe models, Apache-2.0).\nRestart OpenClip if it is running, then render the Cam Split clips again.');
}catch(e){console.error(`\nFace setup stopped: ${e.message}\nOpenClip works without it; only face follow, Cam Split and automatic thumbnails need it.`);process.exitCode=1;}

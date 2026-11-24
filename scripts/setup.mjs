// `npm run setup`: the Python workers in .venv, then a check of everything OpenClip needs, explained in plain words
// with the exact install command for this computer when something is missing. Ends with a checklist.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ROOT,PYTHON,localEnv,CACHE} from '../server/config.mjs';import {VC_RUNTIME_URL} from '../server/process.mjs';
const env=localEnv();for(const d of ['tmp','npm','pip','uv','huggingface','models','pycache','python'])fs.mkdirSync(path.join(CACHE,d),{recursive:true});
const OS=process.platform==='win32'?'windows':process.platform==='darwin'?'mac':'linux';
const INSTALL={
 python:{windows:'winget install Python.Python.3.12   (or: winget install astral-sh.uv)',mac:'brew install uv',linux:'sudo apt install python3 python3-venv   (or install uv: curl -LsSf https://astral.sh/uv/install.sh | sh)'},
 ffmpeg:{windows:'winget install Gyan.FFmpeg',mac:'brew install ffmpeg',linux:'sudo apt install ffmpeg'},
};
const how=tool=>`Install it with:\n    ${INSTALL[tool][OS]}\n  then close this terminal, open a new one, and run npm run setup again.`;
class SetupError extends Error{}
const step=(n,text)=>console.log(`\n[${n}/5] ${text}`);
const exec=(cmd,args,what)=>{const r=spawnSync(cmd,args,{cwd:ROOT,env,windowsHide:true,stdio:'inherit'});if(r.error?.code==='ENOENT')throw new SetupError(`${cmd} was not found. ${what||''}`);if(r.error||r.status!==0)throw new SetupError(`${what||cmd} did not finish (see the messages above). Check your internet connection and free disk space, then run npm run setup again.`);};
const found=cmd=>{const r=spawnSync(cmd,['-version'],{env,encoding:'utf8',windowsHide:true});return !r.error&&r.status===0;};

// The workers need Python 3.11-3.13: 3.11 for hashlib.file_digest, and faster-whisper's CTranslate2 has no wheels
// for newer releases yet. macOS ships an older python3 (3.9), so a bare `python3` is not enough.
const SUPPORTED=[[3,11],[3,12],[3,13]];
const versionOf=(cmd,pre=[])=>{const r=spawnSync(cmd,[...pre,'-c','import sys;print(sys.version_info[0],sys.version_info[1])'],{env,encoding:'utf8',windowsHide:true});if(r.error||r.status!==0)return null;const [a,b]=String(r.stdout).trim().split(/\s+/).map(Number);return Number.isFinite(a)&&Number.isFinite(b)?[a,b]:null;};
const ok=v=>!!v&&SUPPORTED.some(([a,b])=>v[0]===a&&v[1]===b);
const show=v=>v?v.join('.'):'not found';
const hasUv=()=>spawnSync('uv',['--version'],{env,windowsHide:true}).status===0;
function findPython(){
 // On Windows the py launcher can pick a version even when `python` on PATH is a different one.
 const candidates=[process.env.PYTHON,'python3.12','python3.13','python3.11','python3','python'].filter(Boolean).map(cmd=>({cmd,args:[]}));
 if(process.platform==='win32')for(const v of ['3.12','3.13','3.11'])candidates.push({cmd:'py',args:[`-${v}`]});
 const tried=[];
 for(const c of candidates){const v=versionOf(c.cmd,c.args);tried.push(`${[c.cmd,...c.args].join(' ')}: ${show(v)}`);if(ok(v))return c;}
 throw new SetupError(`OpenClip needs Python 3.11, 3.12 or 3.13 and found none (${tried.join(', ')}).\n  ${how('python')}`);
}

/**
 * Windows: the speech engine (CTranslate2) is built with a recent Microsoft compiler and crashes with 0xC0000005 when
 * the system's msvcp140.dll is older than 14.40. Returns a warning, or null when fine (or not Windows).
 */
function vcRuntimeWarning(){
 if(process.platform!=='win32')return null;
 const dll=path.join(process.env.SystemRoot||'C:\\Windows','System32','msvcp140.dll');
 if(!fs.existsSync(dll))return `The Microsoft Visual C++ Runtime is missing, so transcription will crash. Install it from ${VC_RUNTIME_URL}, then restart the computer.`;
 const r=spawnSync('powershell',['-NoProfile','-Command',`(Get-Item -LiteralPath '${dll}').VersionInfo.FileVersion`],{encoding:'utf8',windowsHide:true}),version=String(r.stdout||'').trim(),[major,minor]=version.split('.').map(Number);
 if(!Number.isFinite(major))return null;
 if(major<14||(major===14&&minor<40))return `The Microsoft Visual C++ Runtime is too old (${version}), so transcription may crash (Windows error 0xC0000005). Update it from ${VC_RUNTIME_URL}, then restart the computer.`;
 return null;
}
/** Free space on the drive OpenClip lives on, in GB (null when unknown). */
function freeGb(){try{const s=fs.statfsSync(ROOT);return s.bavail*s.bsize/1e9;}catch{return null;}}

const done=[],warnings=[];
try{
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<20||(major===20&&minor<19))throw new SetupError(`OpenClip needs Node.js 20.19 or newer; this is ${process.versions.node}. Install the current LTS from https://nodejs.org/ (Windows: winget install OpenJS.NodeJS.LTS), then run npm run setup again.`);
 done.push(`Node.js ${process.versions.node}`);

 step(1,'Python for the speech and video helpers');
 const uv=hasUv();
 if(fs.existsSync(PYTHON)&&!ok(versionOf(PYTHON))){
  console.log(`  The project's Python environment uses Python ${show(versionOf(PYTHON))}, which OpenClip can't use. Rebuilding it.`);
  fs.rmSync(path.join(ROOT,'.venv'),{recursive:true,force:true});
 }
 if(!fs.existsSync(PYTHON)){
  if(uv)exec('uv',['venv','.venv','--python','3.12'],'Creating the Python environment with uv');
  else{const py=findPython();exec(py.cmd,[...py.args,'-m','venv',path.join(ROOT,'.venv')],'Creating the Python environment');}
 }
 if(!ok(versionOf(PYTHON)))throw new SetupError(`The project's Python environment uses Python ${show(versionOf(PYTHON))}; OpenClip needs 3.11-3.13. Delete the .venv folder, then:\n  ${how('python')}`);
 done.push(`Python ${show(versionOf(PYTHON))} in .venv${uv?' (via uv)':''}`);

 step(2,'Installing the speech recognizer and video downloader (first time: a few minutes)');
 if(uv)exec('uv',['pip','install','--python',PYTHON,'-r','workers/requirements.txt'],'Installing the Python packages');
 else{exec(PYTHON,['-m','ensurepip'],'Preparing pip');exec(PYTHON,['-m','pip','install','-r','workers/requirements.txt'],'Installing the Python packages');}
 exec(PYTHON,['-c','import faster_whisper,yt_dlp; print("  Workers ready")'],'Checking the Python packages');
 done.push('Speech recognizer (faster-whisper) and downloader (yt-dlp)');

 step(3,'FFmpeg');
 if(!found('ffmpeg')||!found('ffprobe'))throw new SetupError(`FFmpeg (ffmpeg and ffprobe) was not found.\n  ${how('ffmpeg')}`);
 const filters=spawnSync('ffmpeg',['-hide_banner','-filters'],{env,encoding:'utf8',windowsHide:true});
 if(!/\bass\s/.test(filters.stdout||''))throw new SetupError(`This FFmpeg is a cut-down build without captions (the libass filter).\n  Install the full build: ${INSTALL.ffmpeg[OS]}${OS==='windows'?'  (or the "full" build from https://www.gyan.dev/ffmpeg/builds/)':''}\n  Make sure it is the first ffmpeg on your PATH, then run npm run setup again.`);
 done.push(`FFmpeg with captions (${String(spawnSync('ffmpeg',['-version'],{encoding:'utf8',windowsHide:true}).stdout||'').split('\n')[0].replace(/^ffmpeg version (\S+).*/,'$1')})`);

 step(4,'This computer');
 const vc=vcRuntimeWarning();if(vc)warnings.push(vc);else if(OS==='windows')done.push('Microsoft Visual C++ Runtime');
 const gb=freeGb();if(gb!==null&&gb<10)warnings.push(`Only ${gb.toFixed(1)} GB free on this drive. Speech models, downloads and renders need about 10 GB; free some space or move OpenClip to a bigger drive.`);
 if(!fs.existsSync(path.join(ROOT,'web','dist','index.html')))warnings.push('The web app is not built yet: run npm run build.');

 step(5,'Optional extras');
 if(!fs.existsSync(path.join(CACHE,'models','face','blaze_face_short_range.tflite')))console.log('  Face follow and automatic thumbnails: run npm run setup:faces (optional).');else done.push('Face follow and thumbnail models');
 const envFile=['.env','.env.txt'].find(f=>fs.existsSync(path.join(ROOT,f)));console.log(envFile?`  AI settings file found (${envFile}). The home page shows which keys OpenClip picked up.`:'  AI titles are optional: copy .env.example to .env and add a free Gemini or Groq key (see the README).');

 console.log('\n'+'-'.repeat(60));for(const d of done)console.log(`  OK   ${d}`);for(const w of warnings)console.log(`  !!   ${w}`);
 console.log(`\nSetup complete${warnings.length?` with ${warnings.length} thing${warnings.length===1?'':'s'} to check above`:''}. Start OpenClip with:  npm start\nThen open http://localhost:${process.env.PORT||5173} in your browser. Caches and models stay inside ${ROOT}`);
}catch(e){
 console.error('\n'+'-'.repeat(60)+'\nSetup stopped: '+(e instanceof SetupError?e.message:`${e.message}\n  This was unexpected. Run npm run setup again; if it keeps happening, copy the messages above into an issue on GitHub.`));
 process.exitCode=1;
}

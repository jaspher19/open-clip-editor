import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ROOT,PYTHON,localEnv,CACHE} from '../server/config.mjs';
const env=localEnv();for(const d of ['tmp','npm','pip','uv','huggingface','models','pycache','python'])fs.mkdirSync(path.join(CACHE,d),{recursive:true});
const exec=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:ROOT,env,windowsHide:true,stdio:'inherit'});if(r.error||r.status!==0)throw new Error(`${cmd} did not complete. ${r.error?.message||''}`);};
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
 throw new Error(`No Python 3.11-3.13 found (${tried.join(', ')}). Install Python 3.12 or uv (see the README), then run npm run setup again.`);
}
try{
 const uv=hasUv();
 if(fs.existsSync(PYTHON)&&!ok(versionOf(PYTHON))){
  console.log(`The project's Python environment uses Python ${show(versionOf(PYTHON))}, which OpenClip can't use. Rebuilding it.`);
  fs.rmSync(path.join(ROOT,'.venv'),{recursive:true,force:true});
 }
 if(!fs.existsSync(PYTHON)){
  if(uv)exec('uv',['venv','.venv','--python','3.12']);
  else{const py=findPython();exec(py.cmd,[...py.args,'-m','venv',path.join(ROOT,'.venv')]);}
 }
 if(!ok(versionOf(PYTHON)))throw new Error(`The project's Python environment uses Python ${show(versionOf(PYTHON))}; OpenClip needs 3.11-3.13. Delete the .venv folder and install Python 3.12 or uv.`);
 if(uv)exec('uv',['pip','install','--python',PYTHON,'-r','workers/requirements.txt']);
 else{exec(PYTHON,['-m','ensurepip']);exec(PYTHON,['-m','pip','install','-r','workers/requirements.txt']);}
 exec('ffmpeg',['-version']);exec('ffprobe',['-version']);exec(PYTHON,['-c','import faster_whisper,yt_dlp; print("Workers ready")']);
 const filters=spawnSync('ffmpeg',['-filters'],{env,encoding:'utf8',windowsHide:true});if(!/\bass\s/.test(filters.stdout||''))throw new Error('FFmpeg needs the libass subtitle filter. Install a full FFmpeg build and add ffmpeg/ffprobe to PATH.');
 console.log('\nSetup complete. Run npm start; all application caches and models stay under '+ROOT);
}catch(e){console.error('\nSetup failed: '+e.message+'\nUse Node 20.19+/22.12+, Python 3.11–3.13 (or uv), and an FFmpeg build with libass.');process.exitCode=1;}

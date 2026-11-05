import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ROOT,PYTHON,localEnv,CACHE} from '../server/config.mjs';
const env=localEnv();for(const d of ['tmp','npm','pip','uv','huggingface','models','pycache','python'])fs.mkdirSync(path.join(CACHE,d),{recursive:true});
const exec=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:ROOT,env,windowsHide:true,stdio:'inherit'});if(r.error||r.status!==0)throw new Error(`${cmd} did not complete. ${r.error?.message||''}`);};
try{
 if(!fs.existsSync(PYTHON)){
  const uv=spawnSync('uv',['--version'],{env,windowsHide:true});
  if(uv.status===0)exec('uv',['venv','.venv','--python','3.12']);
  else exec(process.env.PYTHON||'python',['-m','venv',path.join(ROOT,'.venv')]);
 }
 const uv=spawnSync('uv',['--version'],{env,windowsHide:true});
 if(uv.status===0)exec('uv',['pip','install','--python',PYTHON,'-r','workers/requirements.txt']);
 else{exec(PYTHON,['-m','ensurepip']);exec(PYTHON,['-m','pip','install','-r','workers/requirements.txt']);}
 exec('ffmpeg',['-version']);exec('ffprobe',['-version']);exec(PYTHON,['-c','import faster_whisper,yt_dlp; print("Workers ready")']);
 const filters=spawnSync('ffmpeg',['-filters'],{env,encoding:'utf8',windowsHide:true});if(!/\bass\s/.test(filters.stdout||''))throw new Error('FFmpeg needs the libass subtitle filter. Install a full FFmpeg build and add ffmpeg/ffprobe to PATH.');
 console.log('\nSetup complete. Run npm start; all application caches and models stay under '+ROOT);
}catch(e){console.error('\nSetup failed: '+e.message+'\nUse Node 20.19+/22.12+, Python 3.11–3.13 (or uv), and an FFmpeg build with libass.');process.exitCode=1;}

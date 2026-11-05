import {spawn} from 'node:child_process';import fs from 'node:fs';import {localEnv,ROOT} from './config.mjs';
export async function run(command,args,{cwd=ROOT,signal,onLine,logFile,timeout=60*60*1000,idleTimeout=0,maxOutput=2_000_000,env={}}={}){
 if(signal?.aborted)throw new Error('Job cancelled');
 for(const value of [timeout,idleTimeout])if(!Number.isFinite(value)||value<0||value>2147483647)throw new Error('Invalid subprocess timeout');
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:localEnv(env),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let stdout='',stderr='',buffer='',errBuffer='',settled=false,timedOut=false;
  const log=logFile?fs.createWriteStream(logFile,{flags:'a'}):null;
  const terminate=()=>{if(!child.pid||child.exitCode!==null)return;if(process.platform==='win32'){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}};
  let idleTimer;const timer=timeout>0?setTimeout(()=>{timedOut='absolute';terminate();},timeout):null;
  const touch=()=>{if(!idleTimeout)return;clearTimeout(idleTimer);idleTimer=setTimeout(()=>{timedOut='idle';terminate();},idleTimeout);};touch();
  const abort=()=>terminate();signal?.addEventListener('abort',abort,{once:true});
  const read=(chunk,isErr)=>{touch();const s=chunk.toString();log?.write(s);if(isErr)stderr=(stderr+s).slice(-maxOutput);else stdout=(stdout+s).slice(-maxOutput);let b=(isErr?errBuffer:buffer)+s;const lines=b.split(/\r?\n|\r/);b=lines.pop();if(isErr)errBuffer=b;else buffer=b;for(const line of lines)if(line.trim())onLine?.(line,isErr);};
  child.stdout.on('data',c=>read(c,false));child.stderr.on('data',c=>read(c,true));
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(idleTimer);signal?.removeEventListener('abort',abort);log?.end();error?reject(error):resolve(value);};
  child.on('error',e=>finish(new Error(`Cannot start ${command}: ${e.message}`)));
  child.on('close',(code)=>{if(buffer.trim())onLine?.(buffer,false);if(errBuffer.trim())onLine?.(errBuffer,true);if(signal?.aborted)return finish(new Error('Job cancelled'));if(timedOut)return finish(new Error(timedOut==='idle'?`${command} stopped without progress: no output for ${Math.round(idleTimeout/1000)} seconds`:`${command} timed out after ${Math.round(timeout/1000)} seconds`));if(code!==0)return finish(new Error(`${command} failed (${code}): ${(stderr||stdout).slice(-5000)}`));finish(null,{stdout,stderr});});
 });
}
export async function probe(file,options={}){
 const r=await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],options);let data;try{data=JSON.parse(r.stdout);}catch{throw new Error('Could not read video metadata');}
 const video=data.streams?.find(s=>s.codec_type==='video'),audio=data.streams?.find(s=>s.codec_type==='audio');const duration=Number(data.format?.duration);
 if(!video||!audio||!Number.isFinite(duration)||duration<=0)throw new Error('The source must contain a video track and audible audio track');
 if(duration>4*3600)throw new Error('Use a video under four hours');
 const rate=String(video.avg_frame_rate||video.r_frame_rate).split('/').map(Number);return {duration,audioDuration:Number(audio.duration)>0?Number(audio.duration):duration,width:video.width,height:video.height,fps:rate[1]?rate[0]/rate[1]:rate[0],audioCodec:audio.codec_name,videoCodec:video.codec_name,size:Number(data.format.size)||0};
}

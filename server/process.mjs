import {spawn} from 'node:child_process';import {StringDecoder} from 'node:string_decoder';import fs from 'node:fs';import path from 'node:path';import {localEnv,ROOT} from './config.mjs';
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
  // One UTF-8 decoder per stream: a character split across two chunks stays whole.
  const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')];
  const read=(chunk,isErr)=>{touch();const s=decoders[isErr?1:0].write(chunk);log?.write(s);if(isErr)stderr=(stderr+s).slice(-maxOutput);else stdout=(stdout+s).slice(-maxOutput);let b=(isErr?errBuffer:buffer)+s;const lines=b.split(/\r?\n|\r/);b=lines.pop();if(isErr)errBuffer=b;else buffer=b;for(const line of lines)if(line.trim())onLine?.(line,isErr);};
  child.stdout.on('data',c=>read(c,false));child.stderr.on('data',c=>read(c,true));
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(idleTimer);signal?.removeEventListener('abort',abort);log?.end();error?reject(error):resolve(value);};
  child.on('error',e=>finish(new Error(`Cannot start ${command}: ${e.message}`)));
  child.on('close',(code)=>{if(buffer.trim())onLine?.(buffer,false);if(errBuffer.trim())onLine?.(errBuffer,true);if(signal?.aborted)return finish(new Error('Job cancelled'));if(timedOut)return finish(new Error(timedOut==='idle'?`${command} stopped without progress: no output for ${Math.round(idleTimeout/1000)} seconds`:`${command} timed out after ${Math.round(timeout/1000)} seconds`));if(code!==0){const hint=crashHint(code);return finish(new Error(hint?`${hint} (${path.basename(String(command))} crashed: Windows error 0x${(code>>>0).toString(16).toUpperCase()})`:`${command} failed (${code}): ${(stderr||stdout).slice(-5000)}`));}finish(null,{stdout,stderr});});
 });
}
export async function probe(file,options={}){
 const r=await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],options);let data;try{data=JSON.parse(r.stdout);}catch{throw new Error('Could not read video metadata');}
 const video=data.streams?.find(s=>s.codec_type==='video'),audio=data.streams?.find(s=>s.codec_type==='audio');const duration=Number(data.format?.duration);
 if(!video||!audio||!Number.isFinite(duration)||duration<=0)throw new Error('The source must contain a video track and audible audio track');
 if(duration>30*3600)throw new Error('Use a video under 30 hours');
 const rate=String(video.avg_frame_rate||video.r_frame_rate).split('/').map(Number);return {duration,audioDuration:Number(audio.duration)>0?Number(audio.duration):duration,width:video.width,height:video.height,fps:rate[1]?rate[0]/rate[1]:rate[0],audioCodec:audio.codec_name,videoCodec:video.codec_name,size:Number(data.format.size)||0};
}

/**
 * How to hand FFmpeg a filter graph stored in a file. `-/filter_complex <file>` works from FFmpeg 7.0 on, and newer
 * builds removed `-filter_complex_script` (a user's renders failed with "Unrecognized option"); FFmpeg 6 and older
 * (Ubuntu 22.04 and 24.04) only know the old spelling. Tested once with a tiny graph, then remembered.
 */
let filterScriptMode=null;
export function filterScriptArgs(file){
 filterScriptMode??=(async()=>{const dir=fs.mkdtempSync(`${localEnv().TMP}/fc-`),graph=`${dir}/g.txt`;fs.writeFileSync(graph,'[0:v]null[v]');
  try{await run('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','color=c=black:s=16x16:d=0.04','-/filter_complex',graph,'-map','[v]','-f','null','-'],{timeout:30000});return 'new';}
  catch{return 'old';}finally{fs.rmSync(dir,{recursive:true,force:true});}})();
 return filterScriptMode.then(mode=>mode==='new'?['-/filter_complex',file]:['-filter_complex_script',file]);
}

/** Download link for the current Microsoft Visual C++ Runtime (x64). */
export const VC_RUNTIME_URL='https://aka.ms/vs/17/release/vc_redist.x64.exe';
/**
 * Plain-language fix for a Windows crash exit code, or null. A user's transcription died with 3221225477
 * (0xC0000005, access violation) while loading the speech model: the usual cause is an outdated msvcp140.dll, since
 * the speech engine is built with a newer Microsoft compiler (programs built with Visual Studio 17.10+ crash on an older
 * runtime's std::mutex).
 */
export function crashHint(code){
 switch(Number(code)>>>0){
  case 0xC0000005:case 0xC0000409:case 0xC0000374:return `The local speech or video helper crashed. On Windows this is almost always an outdated Microsoft Visual C++ Runtime: install the latest one from ${VC_RUNTIME_URL}, restart the computer, then press Retry`;
  case 0xC0000135:case 0xC0000139:return `A Windows component the local helper needs is missing: install the Microsoft Visual C++ Runtime from ${VC_RUNTIME_URL}, then press Retry`;
  case 0xC000001D:return 'The local speech model needs a newer processor (it uses AVX instructions this CPU does not have). Transcription cannot run on this computer';
  default:return null;}
}

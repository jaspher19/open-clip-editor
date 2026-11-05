import fs from 'node:fs';import path from 'node:path';import {run} from './process.mjs';
export async function prepareAudio({sourcePath,audioPath,sourceDuration,signal,runCommand=run}){
 const valid=async file=>{if(!fs.existsSync(file))return false;try{const result=await runCommand('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],{signal});const data=JSON.parse(result.stdout),a=data.streams?.find(s=>s.codec_type==='audio')||data.streams?.[0];return a?.codec_name==='pcm_s16le'&&Number(a.sample_rate)===16000&&a.channels===1&&Math.abs(Number(data.format?.duration)-sourceDuration)<.5;}catch(e){if(signal?.aborted)throw e;return false;}};
 if(await valid(audioPath))return audioPath;
 const partial=path.join(path.dirname(audioPath),'audio.partial.wav');
 try{await runCommand('ffmpeg',['-v','error','-y','-i',sourcePath,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',partial],{signal});if(!await valid(partial))throw new Error('Prepared speech audio failed completeness verification');fs.renameSync(partial,audioPath);return audioPath;}
 finally{if(fs.existsSync(partial))fs.unlinkSync(partial);}
}

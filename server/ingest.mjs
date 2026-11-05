import fs from 'node:fs';import path from 'node:path';import {run} from './process.mjs';import {PYTHON} from './config.mjs';
export function parseYouTubeUrl(value){
 let u;try{u=new URL(value);}catch{throw new Error('Enter a valid YouTube video URL');}
 const host=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be'].includes(host))throw new Error('Only public YouTube video URLs are supported');
 let id;if(host.endsWith('youtu.be'))id=u.pathname.split('/')[1];else if(u.pathname==='/watch')id=u.searchParams.get('v');else if(/^\/(shorts|live)\//.test(u.pathname))id=u.pathname.split('/')[2];
 if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw new Error('Enter a single YouTube video, not a playlist');
 return {id,url:`https://www.youtube.com/watch?v=${id}`};
}
// Long 1080p60 streams pass 4 GB in H.264, and yt-dlp then aborts without an error, so prefer full-height 1080p (H.264, then VP9) whose known size fits, then 720p.
const FORMAT='bv*[vcodec^=avc1][height>=1000][height<=1080][filesize<3800M]+ba[acodec^=mp4a]/bv*[vcodec^=vp][height>=1000][height<=1080][filesize<3800M]+ba[acodec^=mp4a]/bv*[vcodec^=avc1][height<=1080][filesize<3800M]+ba[acodec^=mp4a]/bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b[height<=1080]';
/** yt-dlp exits 0 when it skips a download on purpose; say why, and drop the partial pieces. */
function skipReason(folder){
 let log='';try{log=fs.readFileSync(path.join(folder,'download.log'),'utf8');}catch{}
 for(const f of fs.readdirSync(folder))if(/^source\.f[\w-]+\./.test(f))fs.rmSync(path.join(folder,f),{force:true});
 if(/larger than max-filesize/i.test(log))return 'This video is over 4 GB even at a lower quality. Import a section of the stream (up to 15 minutes) or upload a local file.';
 if(/does not pass filter/i.test(log))return 'YouTube skipped this video: it is still live or longer than 4 hours. Wait for the stream to end, or import a section of it.';
 return 'YouTube did not return a supported video file';
}
export async function importYouTube(url,folder,{signal,onProgress,infoOnly=false,section}={}){
 if(section&&(!Number.isFinite(section.start)||!Number.isFinite(section.end)||section.start<0||section.end-section.start<20||section.end-section.start>900))throw new Error('Invalid recorded-stream section');
 const parsed=parseYouTubeUrl(url);const args=['-m','yt_dlp','--no-playlist','--no-cache-dir','--js-runtimes',`node:${process.execPath}`,'--socket-timeout','20','--retries','2','--extractor-retries','2','--match-filter',section?'!is_live':'!is_live & duration <= 14400'];
 if(section)args.push('--download-sections',`*${section.start}-${section.end}`);else args.push('--max-filesize','4G');
 if(infoOnly){const r=await run(PYTHON,[...args,'--skip-download','--dump-single-json',parsed.url],{cwd:folder,signal,timeout:180000});return JSON.parse(r.stdout);}
 const out=path.join(folder,'source.%(ext)s');
 const r=await run(PYTHON,[...args,'--newline','--progress-template','download:download:%(progress._percent_str)s','-f',FORMAT,'--merge-output-format','mp4','--write-info-json','--windows-filenames','-o',out,parsed.url],{cwd:folder,signal,timeout:30*60*1000,logFile:path.join(folder,'download.log'),onLine:line=>{const m=line.match(/download:\s*([\d.]+)%/);if(m)onProgress?.(Number(m[1])/100);}}).catch(e=>{if(signal?.aborted)throw new Error('Job cancelled');throw new Error(`YouTube import failed. The video may be unavailable or YouTube may require sign-in. Local upload remains available. ${e.message}`);});
 const filename=fs.readdirSync(folder).find(f=>/^source\.(mp4|mkv|webm|mov)$/.test(f));if(!filename)throw new Error(skipReason(folder));
 let info={};const meta=fs.readdirSync(folder).find(f=>f.endsWith('.info.json'));if(meta)try{info=JSON.parse(fs.readFileSync(path.join(folder,meta),'utf8'));}catch{}
 return {path:path.join(folder,filename),title:info.title||'YouTube video',youtubeId:parsed.id,sourceInfo:{uploader:info.uploader||info.channel||'',channel:info.channel||'',uploaderId:info.uploader_id||'',tags:(info.tags||[]).slice(0,20)}};
}

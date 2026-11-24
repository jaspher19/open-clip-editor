// YouTube live chat replay: when a past live stream is imported, its chat (kept by YouTube for the VOD) is fetched
// with yt-dlp and stored as work/<id>/chat.jsonl in the same {t, m} form as recorded Twitch chat, so the moment picker
// can see where chat went wild. Optional: a normal upload has no chat, and any failure only means no chat signal.
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
import {run} from './process.mjs';import {PYTHON} from './config.mjs';

export const youtubeChatFile=folder=>path.join(folder,'chat.jsonl');
const NONE='chat.none';
const text=runs=>(runs||[]).map(r=>r.text??r.emoji?.shortcuts?.[0]??r.emoji?.emojiId??'').join('').replace(/\s+/g,' ').trim();

/** One line of yt-dlp's .live_chat.json (one replay action) as chat messages {t, m}. Super Chats count as hype. */
export function parseChatLine(line){
 let o;try{o=JSON.parse(line);}catch{return [];}const r=o.replayChatItemAction,t=Number(r?.videoOffsetTimeMsec)/1000;if(!Number.isFinite(t)||t<0)return [];
 const out=[];for(const a of r.actions||[]){const item=a.addChatItemAction?.item||{},paid=item.liveChatPaidMessageRenderer,msg=item.liveChatTextMessageRenderer||paid;if(!msg)continue;
  const m=(text(msg.message?.runs)+(paid?' !!!':'')).trim().slice(0,200);if(m)out.push({t:+t.toFixed(2),m});}
 return out;
}

/** Chat stored for a project (empty without). */
export function loadYouTubeChat(folder){try{return fs.readFileSync(youtubeChatFile(folder),'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(m=>m&&Number.isFinite(m.t));}catch{return [];}}

/**
 * Fetch and store the chat replay of a YouTube video once (null when there is none). Imports of a section of a
 * video are skipped: their clock does not start at the stream's start.
 */
export async function fetchYouTubeChat(job,folder,{signal,runCommand=run}={}){
 if(job.source?.type!=='youtube'||job.source.kind!=='video'||job.source.section||!job.source.url)return null;
 const file=youtubeChatFile(folder);if(fs.existsSync(file))return loadYouTubeChat(folder).length;if(fs.existsSync(path.join(folder,NONE)))return null;
 const dir=path.join(folder,'ytchat');fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
 try{
  await runCommand(PYTHON,['-m','yt_dlp','--no-playlist','--no-cache-dir','--js-runtimes',`node:${process.execPath}`,'--skip-download','--write-subs','--sub-langs','live_chat','-o',path.join(dir,'chat.%(ext)s'),job.source.url],{signal,timeout:30*60*1000,idleTimeout:5*60*1000,logFile:path.join(folder,'chat.log')});
  const raw=fs.readdirSync(dir).find(f=>f.endsWith('.live_chat.json'));if(!raw){fs.writeFileSync(path.join(folder,NONE),'');return null;}
  // Long streams have big replays (tens of MB): read line by line, write as we go.
  const temp=file+'.partial',outStream=fs.createWriteStream(temp);let n=0;
  for await(const line of readline.createInterface({input:fs.createReadStream(path.join(dir,raw)),crlfDelay:Infinity}))for(const m of parseChatLine(line)){outStream.write(JSON.stringify(m)+'\n');n++;}
  await new Promise((ok,bad)=>outStream.end(e=>e?bad(e):ok()));
  if(!n){fs.rmSync(temp,{force:true});fs.writeFileSync(path.join(folder,NONE),'');return null;}
  fs.renameSync(temp,file);return n;
 }catch(e){if(signal?.aborted)throw e;return null;}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}

// Twitch live chat as a moment signal. While a live Twitch stream is imported, its chat is read from Twitch's documented
// chat interface (IRC over WebSocket, anonymous read-only login "justinfan…") and stored per broadcast as
// work/chat/twitch-<broadcast id>.jsonl: one line per message with seconds since the stream started and the text only
// (no usernames). Chat only arrives from the moment we connect, so it helps when the same broadcast is imported again
// later (paste the link again for the newer part) or its moments are re-picked.
import fs from 'node:fs';import path from 'node:path';import {WORK} from './config.mjs';import {clamp} from './moments.mjs';

export const CHAT_URL='wss://irc-ws.chat.twitch.tv:443';
export const CHAT_DIR=path.join(WORK,'chat');
/** Viewers see the stream a few seconds late and then type: a chat spike points about 6 s before itself. */
export const CHAT_DELAY=6;
const MAX_HOURS=24,QUIET_STOP=45*60*1000;
export const chatFile=(id,dir=CHAT_DIR)=>path.join(dir,`twitch-${String(id).replace(/[^\w-]/g,'')}.jsonl`);

/** The text of a PRIVMSG line from Twitch IRC, or null. */
export function privmsg(line){const m=/^(?:@\S+ )?:\S+ PRIVMSG #\S+ :(.*)$/.exec(line);return m?m[1].slice(0,200):null;}

const recorders=new Map();
/**
 * Record a channel's chat into `file` until `until` (epoch ms), 45 quiet minutes, or stop(). Reconnects with backoff.
 * Returns {stop, done}. `startedAt` is the stream's start (epoch seconds), so times line up with the imported video.
 */
export function recordChat({channel,id,startedAt,file=chatFile(id),until=Date.now()+MAX_HOURS*3600e3,WS=globalThis.WebSocket,now=()=>Date.now(),log=()=>{}}){
 const key=file;if(recorders.has(key))return recorders.get(key);
 fs.mkdirSync(path.dirname(file),{recursive:true});let ws=null,stopped=false,last=now(),tries=0,timer=null,resolve;
 const done=new Promise(r=>{resolve=r;}),name=String(channel).toLowerCase().replace(/[^a-z0-9_]/g,'');
 const finish=()=>{if(stopped)return;stopped=true;clearTimeout(timer);try{ws?.close();}catch{}recorders.delete(key);resolve();};
 const connect=()=>{if(stopped)return;if(now()>=until||now()-last>QUIET_STOP){finish();return;}
  ws=new WS(CHAT_URL);
  ws.onopen=()=>{tries=0;ws.send(`NICK justinfan${10000+Math.floor(Math.random()*80000)}`);ws.send(`JOIN #${name}`);};
  ws.onmessage=e=>{for(const line of String(e.data).split('\r\n')){if(!line)continue;if(line.startsWith('PING')){ws.send(line.replace('PING','PONG'));continue;}
   const text=privmsg(line);if(text===null)continue;last=now();fs.appendFileSync(file,JSON.stringify({t:+(last/1000-startedAt).toFixed(1),m:text})+'\n');}
   if(now()>=until)finish();};
  ws.onclose=()=>{if(stopped)return;tries++;timer=setTimeout(connect,Math.min(60e3,1000*2**Math.min(6,tries)));};
  ws.onerror=e=>log(`chat ${name}: ${e?.message||'connection error'}`);};
 connect();const rec={stop:finish,done,file};recorders.set(key,rec);return rec;
}
export const chatRecorders=()=>[...recorders.values()];

/** Messages of a broadcast's recorded chat: [{t, m}]. */
export function loadChat(id,dir=CHAT_DIR){if(!id)return [];try{return fs.readFileSync(chatFile(id,dir),'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(m=>m&&Number.isFinite(m.t));}catch{return [];}}

// Laughing and hype emotes and words that mark a moment in Twitch chat.
const LAUGH=/\b(?:KEKW|LUL|LULW|OMEGALUL|ICANT|LMAO+|LMFAO|LOL+|xd+|HAHA\w*|dead)\b|😂|🤣|💀/i,HYPE=/\b(?:POG\w*|W+|CLIP+(?: IT| THAT)?|NO WAY|WTF|HOLY|OMG|Clueless|monkaS|PepeHands|L+)\b|\?{3,}|!{3,}/i;
/**
 * Per-second chat score 0–3, moved back by CHAT_DELAY: messages per second against the rolling 5-minute median, with
 * laughing and hype messages counting double. Empty (all zero) without chat.
 */
export function chatSignal(messages,secs){const out=new Float32Array(secs+1);if(!messages?.length)return out;
 const rate=new Float32Array(secs+1);for(const {t,m} of messages){const s=Math.round(t-CHAT_DELAY);if(s<0||s>secs)continue;rate[s]+=LAUGH.test(m)||HYPE.test(m)?2:1;}
 const smooth=new Float32Array(secs+1);for(let t=0;t<=secs;t++){let n=0;for(let k=Math.max(0,t-2);k<=Math.min(secs,t+2);k++)n+=rate[k];smooth[t]=n/5;}
 // Baseline: median of 5-second means around each point (±150 s), sampled every 10 s.
 const base=new Float32Array(secs+1),step=10;let prev=0;
 for(let c=0;c<=secs;c+=step){const vals=[];for(let k=Math.max(0,c-150);k<=Math.min(secs,c+150);k+=5)vals.push(smooth[k]);vals.sort((a,b)=>a-b);const med=vals[vals.length>>1]||0;for(let t=c;t<Math.min(secs+1,c+step);t++)base[t]=med;prev=med;}
 for(let t=0;t<=secs;t++){const b=Math.max(base[t]||prev,.3);out[t]=clamp((smooth[t]/b-2)/1.5,0,3);}
 return out;
}

/** The broadcast a job's chat belongs to: Twitch past broadcasts only (the VOD id). */
export const chatId=job=>job?.source?.type==='twitch'&&job.source.kind==='video'&&job.source.id?String(job.source.id):null;
export const jobChat=job=>loadChat(chatId(job));
/**
 * Start recording chat for a project imported from a live Twitch stream (no-op otherwise, or when it is already
 * recording). Recording stops 24 h after the stream started, or after 45 quiet minutes.
 */
export function followLiveChat(job,opts={}){const id=chatId(job),r=job?.remote;if(!id||!r?.live||!Number.isFinite(r.startedAt))return null;
 const channel=r.channel||job.source.channel||job.sourceInfo?.uploaderId;if(!channel)return null;const until=r.startedAt*1000+MAX_HOURS*3600e3;if(Date.now()>=until)return null;
 return recordChat({channel,id,startedAt:r.startedAt,until,...opts});}

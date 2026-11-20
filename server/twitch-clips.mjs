// Crowd signal for Twitch VODs: the clips viewers made of the broadcast, with their view counts, from the official
// Twitch Helix API. It needs the owner's own free Twitch application (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in
// .env, app access token, no user sign-in). Without a key, or if Twitch refuses, picking simply runs without it.
// https://dev.twitch.tv/docs/api/reference/#get-clips
import fs from 'node:fs';import path from 'node:path';import {writeJsonAtomic} from './atomic.mjs';

const HELIX='https://api.twitch.tv/helix',MAX_PAGES=10;
let cached=null;
export const crowdReady=(env=process.env)=>!!(env.TWITCH_CLIENT_ID&&env.TWITCH_CLIENT_SECRET);
async function appToken({env=process.env,fetchImpl=fetch}={}){
 if(cached&&cached.id===env.TWITCH_CLIENT_ID&&cached.expires>Date.now()+60_000)return cached.token;
 const body=new URLSearchParams({client_id:env.TWITCH_CLIENT_ID,client_secret:env.TWITCH_CLIENT_SECRET,grant_type:'client_credentials'});
 const r=await fetchImpl('https://id.twitch.tv/oauth2/token',{method:'POST',body,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error(r.status===400||r.status===403?'Twitch rejected TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET':`Twitch sign-in failed (${r.status})`);
 const data=await r.json();cached={id:env.TWITCH_CLIENT_ID,token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000};return cached.token;
}
async function helix(route,params,{env,fetchImpl}){
 const token=await appToken({env,fetchImpl}),url=`${HELIX}/${route}?${new URLSearchParams(params)}`;
 const r=await fetchImpl(url,{headers:{'Client-Id':env.TWITCH_CLIENT_ID,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
 if(r.status===401)cached=null;if(!r.ok)throw new Error(`Twitch API ${route} failed (${r.status})`);return r.json();
}
/** Clips of one VOD, most viewed first: [{start,end,views,title,url}] in VOD seconds. */
export async function vodClips(videoId,{env=process.env,fetchImpl=fetch}={}){
 if(!/^\d{6,14}$/.test(String(videoId)))throw new Error('Invalid Twitch VOD id');
 const video=(await helix('videos',{id:String(videoId)},{env,fetchImpl})).data?.[0];if(!video)return [];
 const began=Date.parse(video.created_at),length=parseDuration(video.duration);if(!Number.isFinite(began))return [];
 // Clips are listed per broadcaster and creation time; keep the ones cut from this VOD.
 const out=[];let after='';
 for(let page=0;page<MAX_PAGES;page++){
  const params={broadcaster_id:video.user_id,started_at:new Date(began).toISOString(),ended_at:new Date(began+(length+6*3600)*1000).toISOString(),first:'100'};if(after)params.after=after;
  const r=await helix('clips',params,{env,fetchImpl});
  for(const c of r.data||[])if(String(c.video_id)===String(videoId)&&Number.isFinite(c.vod_offset)&&c.vod_offset>=0)out.push({start:c.vod_offset,end:c.vod_offset+(Number(c.duration)||30),views:Number(c.view_count)||0,title:String(c.title||'').slice(0,100),url:String(c.url||'')});
  after=r.pagination?.cursor;if(!after)break;
 }
 return out.sort((a,b)=>b.views-a.views);
}
/** "4h3m2s" -> seconds. */
export function parseDuration(text){const m=String(text||'').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);return m?(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0):0;}
export const crowdFile=folder=>path.join(folder,'crowd.json');
export function loadCrowd(folder){try{const list=JSON.parse(fs.readFileSync(crowdFile(folder),'utf8'));return Array.isArray(list)?list:[];}catch{return [];}}
/** Fetch and save the crowd clips for a Twitch VOD job. Never throws: returns a status for the job record. */
export async function collectCrowd(job,folder,{env=process.env,fetchImpl=fetch}={}){
 if(job.source?.type!=='twitch'||job.source.kind!=='video')return null;
 if(!crowdReady(env))return {status:'skipped',reason:'Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env to use viewers’ clips'};
 try{const clips=await vodClips(job.source.id,{env,fetchImpl});writeJsonAtomic(crowdFile(folder),clips);return {status:'done',clips:clips.length,views:clips.reduce((n,c)=>n+c.views,0)};}
 catch(e){return {status:'failed',reason:e.message};}
}
/** Per-second weight a viewer clip adds: more views count for more, with diminishing returns. */
export const crowdWeight=views=>Math.min(8,2+1.5*Math.log10(1+Math.max(0,views)));

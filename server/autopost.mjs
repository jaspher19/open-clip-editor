// Auto-post: when a project finishes editing, its best clips go to the posting calendar on their own. The top few
// upload right away (clip channels that post within hours of the stream get the views; the same moment posted a day
// later by a new channel got 0–2 views), the rest are spread over the next days at fixed release times.
// Off until the owner turns it on. Every safety of the calendar still applies: repeats of anything already uploaded
// are skipped by the upload log, and YouTube's upload quota (about 6 uploads a day) is respected by daily batches.
import fs from 'node:fs';import path from 'node:path';import {writeJsonAtomic} from './atomic.mjs';import {probe} from './process.mjs';import {publicationMetadata} from './context.mjs';

export const AUTOPOST_DEFAULTS={enabled:false,postNow:2,times:['12:00','18:00','21:00'],maxScheduled:9,titleStyle:'hook',madeForKids:false,skipWarnings:true};
export function validateAutopost(input={}){const s={...AUTOPOST_DEFAULTS,...input};
 if(typeof s.enabled!=='boolean'||typeof s.skipWarnings!=='boolean')throw new Error('Invalid auto-post switch');
 if(s.madeForKids!==false&&s.madeForKids!==true)throw new Error('Choose whether these Shorts are made for kids');
 if(!Number.isInteger(s.postNow)||s.postNow<0||s.postNow>4)throw new Error('Post 0–4 clips right away');
 if(!Number.isInteger(s.maxScheduled)||s.maxScheduled<0||s.maxScheduled>30)throw new Error('Schedule 0–30 more clips');
 if(!Array.isArray(s.times)||!s.times.length||s.times.length>6||s.times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new Error('Choose 1–6 daily release times (HH:MM)');
 if(!['hook','standard'].includes(s.titleStyle))throw new Error('Invalid title style');
 return {enabled:s.enabled,postNow:s.postNow,times:[...new Set(s.times)].sort(),maxScheduled:s.maxScheduled,titleStyle:s.titleStyle,madeForKids:s.madeForKids,skipWarnings:s.skipWarnings};}
export const autopostFile=root=>path.join(root,'posting','autopost.json');
export function loadAutopost(root){try{return validateAutopost(JSON.parse(fs.readFileSync(autopostFile(root),'utf8')));}catch{return {...AUTOPOST_DEFAULTS};}}
export function saveAutopost(root,input){const s=validateAutopost(input);fs.mkdirSync(path.dirname(autopostFile(root)),{recursive:true});writeJsonAtomic(autopostFile(root),s);return s;}

// One emoji that fits the hook, the way the clip channels that win on the same streams title their Shorts.
const EMOJI=[[/\b(cooked|took an? L|L\b|crashed out|fail|wrecks?|crash\w*|struggles?|rages?)/i,'💀'],[/\b(tweaking|shocked|not ready|ain.t no way|realism|scared|jump)/i,'😱'],[/\b(W\b|locked in|aura|clutch|secures|wins?)/i,'🔥'],[/\b(laugh|roasts?|yapping|funny|glazing|rizz)/i,'😭']];
/** Hashtags for the title: the template's (e.g. #gta6) and the streamer's, at most 2, never #shorts. */
function titleTags(description,host,game=''){const tags=[...new Set([...(game?[game]:[]),...(String(description).match(/#[\p{L}\p{N}_]+/gu)||[]).map(t=>t.toLowerCase())].filter(t=>t!=='#shorts'))];
 const h=host?`#${String(host).toLowerCase().replace(/[^\p{L}\p{N}_]/gu,'')}`:'';return [...(h&&h.length>1?[h]:[]),...tags.filter(t=>t!==h)].slice(0,2);}
/** The game hashtag when the stream says which game (GTA 6 for now). */
export const gameTag=text=>/\bgta\s*(?:6|vi)\b/i.test(String(text||''))?'#gta6':'';
/** "Jynxzi got cooked by the driving 💀 #jynxzi #gta6": the specific on-screen hook, one emoji, two hashtags (≤ 100 chars). */
export function hookTitle(clip,meta,host,game=''){const hook=String(clip.settings?.hookText||clip.hook||'').replace(/\s+/g,' ').trim();if(hook.split(' ').length<3)return null;
 const emoji=EMOJI.find(([re])=>re.test(hook))?.[1]||'😭',base=`${hook[0].toUpperCase()}${hook.slice(1)} ${emoji}`;let title=base;
 for(const t of titleTags(meta.description,host,game))if(`${title} ${t}`.length<=100)title+=` ${t}`;return title;}

/** Clips worth posting automatically, best first: kept, exported with the latest edits, no export error, and (by default) no file-check warnings. */
export function postable(job,{skipWarnings=true}={}){const out=[];for(const c of job.clips||[]){if(c.kept===false||c.dirty||c.exportError)continue;const e=(job.exports||[]).find(x=>x.clipId===c.id);if(!e)continue;if(skipWarnings&&Array.isArray(e.checks)&&e.checks.length)continue;out.push({clip:c,output:e});}
 return out.sort((a,b)=>(b.clip.score||0)-(a.clip.score||0));}

/** The first release day (YYYY-MM-DD, Manila) after the latest day already scheduled, or today. */
export function nextReleaseDay(posts,now=Date.now()){const day=t=>new Date(t+8*3600e3).toISOString().slice(0,10);let last=null;
 for(const p of posts)if(p.state==='draft'&&p.settings?.privacy==='schedule'&&Date.parse(p.settings.publishAt)>now){const d=day(Date.parse(p.settings.publishAt));if(!last||d>last)last=d;}
 if(!last)return day(now);return day(Date.parse(`${last}T00:00:00+08:00`)+86400e3);}

/**
 * Send a finished project's best clips to the calendar: `postNow` upload as public right away, up to `maxScheduled`
 * more are scheduled at the daily times. Clips already in the calendar are skipped. Returns {now, scheduled, skipped}.
 */
export async function autoPostJob(job,{store,posting,youtube,settings,probeFile=probe,now=Date.now()}){
 if(!settings?.enabled)return null;if(job.autoPosted)return {now:[],scheduled:[],skipped:'already auto-posted'};
 const host=job.host?.short||job.host?.name||'',inCalendar=new Set(posting.list().filter(p=>p.source?.jobId===job.id).map(p=>p.source.clipId));
 const picks=postable(job,settings).filter(x=>!inCalendar.has(x.clip.id)).slice(0,settings.postNow+settings.maxScheduled),made=[];
 for(const {clip,output} of picks){const file=path.join(store.folder(job.id),'exports',output.filename);if(!fs.existsSync(file))continue;
  const base=clip.metadata||publicationMetadata(clip,job),title=settings.titleStyle==='hook'?hookTitle(clip,base,host,gameTag(`${job.title} ${clip.title}`)):null,metadata={...base,...(title?{title}:{})};
  try{const media=await probeFile(file);made.push(posting.create(file,media,{format:'shorts',metadata,settings:{privacy:'public',madeForKids:settings.madeForKids},label:clip.title,source:{jobId:job.id,clipId:clip.id}}));}
  catch(e){made.push({error:e.message,clipId:clip.id});}}
 const ok=made.filter(p=>p.id),first=ok.slice(0,settings.postNow),later=ok.slice(settings.postNow);
 // Right away: public uploads, picked up by the calendar's own minute timer (it never runs two batches at once).
 for(const p of first)posting.save({...posting.get(p.id),autoUpload:{at:new Date(now).toISOString()},state:'draft'});
 if(later.length){const start=nextReleaseDay(posting.list().filter(p=>!later.some(l=>l.id===p.id)),now);posting.schedule(later.map(p=>p.id),{start,times:settings.times,offset:'+08:00',daily:true,now});}
 const result={now:first.map(p=>p.id),scheduled:later.map(p=>p.id),failed:made.filter(p=>!p.id),at:new Date(now).toISOString()};
 store.update(job.id,{autoPosted:result,...(first.length||later.length?{message:`${job.message||'Clips are ready'} · auto-post: ${first.length} uploading now, ${later.length} scheduled`}:{})});if(youtube?.status?.().connected&&first.length)posting.tick().catch(()=>{});return result;}

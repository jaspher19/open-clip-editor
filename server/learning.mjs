// Learn what the owner's channel rewards. Each uploaded clip keeps its traits (category and the picker's signals:
// laughs, hype words, "clip that", loud reaction, on-screen action, chat spike, viewers' clips, AI pick).
// View counts come from the YouTube Data API (videos.list statistics, read-only scope the channel already granted).
// Each trait's lesson is how much better or worse its Shorts did than the channel's typical Short, shrunk toward zero
// when there are few uploads, so a handful of lucky videos cannot steer the picker.
import fs from 'node:fs';import path from 'node:path';import {writeJsonAtomic} from './atomic.mjs';

export const TRAITS={laugh:/\blaugh/,hype:/hype word/,clipCue:/"clip that"/,loud:/loud reaction/,action:/busy on-screen action/,chat:/chat went wild/,crowd:/Viewers clipped this/};
export const TRAIT_LABELS={laugh:'laughing moments',hype:'hype moments',clipCue:'"clip that" moments',loud:'loud reactions',action:'on-screen action',chat:'chat spikes',crowd:'moments viewers clipped','category:funny':'funny moments','category:highlight':'highlights','category:clippable':'talking moments'};
/** A clip's traits from its category and the reasons the picker wrote. */
export function clipTraits(clip){if(!clip)return [];const text=(clip.reasons||[]).join(' · '),out=Object.entries(TRAITS).filter(([,re])=>re.test(text)).map(([k])=>k);if(clip.category)out.push(`category:${clip.category}`);return out;}

/** Minimum age before a Short's views count (Shorts get most of their views in the first days). */
export const MIN_AGE_DAYS=3,SHRINK=4;
/**
 * Lessons from logged uploads with statistics: {traits:{[trait]:{n, lift}}, videos, median}. `lift` is the shrunk mean of
 * log10(views+1) minus the channel median, in orders of magnitude (+0.3 ≈ twice the views).
 */
export function channelLessons(entries,{now=Date.now()}={}){
 const usable=entries.filter(e=>e.stats&&Number.isFinite(e.stats.views)&&Array.isArray(e.traits)&&e.privacy!=='private'&&now-Date.parse(e.uploadedAt||0)>=MIN_AGE_DAYS*864e5);
 if(usable.length<4)return {videos:usable.length,median:null,traits:{}};
 const score=e=>Math.log10(1+e.stats.views),sorted=usable.map(score).sort((a,b)=>a-b),mid=sorted.length>>1,median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2,traits={};
 for(const e of usable)for(const t of new Set(e.traits)){const r=traits[t]||={n:0,sum:0};r.n++;r.sum+=score(e)-median;}
 for(const [t,r] of Object.entries(traits))traits[t]={n:r.n,lift:+(r.sum/(r.n+SHRINK)).toFixed(3)};
 return {videos:usable.length,median:+median.toFixed(3),traits};
}
/** Picker bonus for a candidate's traits: about ±6 points at most, and the strongest reason to show. */
export function lessonBonus(lessons,traits){if(!lessons?.traits)return {bonus:0,note:null};let bonus=0,best=null;
 for(const t of traits){const l=lessons.traits[t];if(!l||l.n<2)continue;bonus+=8*l.lift;if(!best||Math.abs(l.lift)>Math.abs(best.lift))best={t,...l};}
 bonus=Math.max(-6,Math.min(6,bonus));const pct=best?Math.round((10**best.lift-1)*100):0;
 return {bonus,note:best&&Math.abs(pct)>=15?`Your channel: ${TRAIT_LABELS[best.t]||best.t} get ${pct>0?`${pct}% more`:`${-pct}% fewer`} views`:null};}

export const lessonsFile=root=>path.join(root,'posting','lessons.json');
export function loadLessons(root){try{return JSON.parse(fs.readFileSync(lessonsFile(root),'utf8'));}catch{return null;}}
/**
 * Fetch view counts for logged uploads (50 per request, 1 quota unit each) and save the lessons.
 * Uploads logged before traits were stored get them from their project when it still exists.
 */
export async function refreshLessons({youtube,log,store,root,now=Date.now()}){
 const list=log.list();let changed=0;
 for(const e of list)if(!Array.isArray(e.traits)&&e.source?.jobId&&e.source.clipId){try{const clip=store.get(e.source.jobId).clips?.find(c=>c.id===e.source.clipId);if(clip){log.record({videoId:e.videoId,traits:clipTraits(clip)});changed++;}}catch{/* project deleted */}}
 const ids=log.list().map(e=>e.videoId).filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id||''));
 for(let i=0;i<ids.length;i+=50){const stats=await youtube.videoStats(ids.slice(i,i+50));for(const [videoId,s] of Object.entries(stats)){log.record({videoId,stats:{...s,at:new Date(now).toISOString()}});changed++;}}
 const lessons={...channelLessons(log.list(),{now}),updatedAt:new Date(now).toISOString()};writeJsonAtomic(lessonsFile(root),lessons);return {...lessons,changed};
}

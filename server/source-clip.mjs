// A Twitch or Kick clip link already is the moment: it becomes one clip covering the whole file, with pauses kept
// (gameplay action often happens while nobody talks). Clips with real speech get written titles like any moment;
// near-silent ones use the clipper's title when it reads as words, else the streamer and game.
import {randomUUID} from 'node:crypto';import {dropProfanity} from './moments.mjs';import {PLAY_MAX} from './selection.mjs';

/** Clip titles are often keyboard mash ("rsetdryftgyhuiojipokp", "hcmmcgcgg"); those are not used. */
export function looksLikeWords(title){
 const tokens=String(title||'').toLowerCase().match(/\p{L}+/gu)||[];if(!tokens.length)return false;
 const vowels=t=>(t.match(/[aeiouy]/g)||[]).length;
 return tokens.every(t=>t.length<=14&&!/[^aeiouy]{5,}/.test(t)&&(t.length<5||vowels(t)/t.length>=.15))&&(tokens.length>1||tokens[0].length<=10);
}
export function platformTitle(title){
 if(!looksLikeWords(title))return '';
 // Twitch titles of in-progress archives end with a date stamp; emoji and hashtags do not belong in a burned-in hook.
 const s=dropProfanity(String(title||'').replace(/\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,'').replace(/#[\p{L}\p{N}_]+/gu,'').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu,'').replace(/\s+/g,' ').trim());
 if(s.length<=60)return s;const cut=s.slice(0,60),space=cut.lastIndexOf(' ');return (space>30?cut.slice(0,space):cut).replace(/[\s,.;:!?-]+$/,'');
}
export function sourceClip(job,metadata,transcript={}){
 const duration=Number(metadata?.duration)||0,shorts=(job.options?.outputFormat||'shorts')!=='video';
 const info=job.sourceInfo||{},game=String(info.categories?.[0]||'').replace(/\s*\([^)]*\)\s*$/,'');
 const end=Math.max(.5,shorts?Math.min(duration,PLAY_MAX-.1):duration),title=platformTitle(job.title)||[info.uploader,game&&`in ${game}`].filter(Boolean).join(' ')||'Stream clip';
 const words=(transcript.words||[]).filter(w=>w.start<end).length,short=title.split(/\s+/).length<=6;
 return {id:randomUUID(),start:0,end,title,hook:short?title:'',score:100,category:'highlight',peakAt:end/2,kept:true,
  reasons:[`Your ${job.source?.type==='kick'?'Kick':'Twitch'} clip link`,words?`${words} spoken words`:'Gameplay without speech: pauses are kept'],
  titleSource:'platform',settings:{keepPauses:true}};
}

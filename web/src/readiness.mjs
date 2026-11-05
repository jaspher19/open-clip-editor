// "Ready to post?" checks for one clip, shared by the clip cards and the editor.
// Each check is pass, warn (worth fixing, does not block) or fail (fix before posting).
import {playSegments,tightLength} from './logic.mjs';
const STRONG=/\b(?:no way|oh my (?:god|gosh)|let'?s go|what the|why|how|wait|stop|look at|bro|yo+)\b|[!?]/i;
const words=s=>String(s||'').split(/\s+/).filter(Boolean);
const norm=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const nameRe=n=>new RegExp(`(^|[^\\p{L}\\p{N}])${String(n).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^\\p{L}\\p{N}])`,'iu');

/** Seconds of output before source time `t` in the main range (cuts removed). */
export function outputTime(clip,t){return t-clip.start-(clip.cuts||[]).reduce((s,c)=>s+Math.max(0,Math.min(t,c.end)-Math.max(clip.start,c.start)),0);}

/** Approximate output length: main range minus cuts and tightened pauses, plus parts, cold open, freezes and slow-motion replays. */
export function playLength(clip){
 const s=clip.settings||{},spoken=clip.words?.length?clip.words:null,tight=(a,b)=>{const t=spoken&&tightLength(spoken,a,b,s);return t||b-a;};
 const main=spoken?playSegments(clip.start,clip.end,clip.cuts||[]).reduce((n,p)=>n+tight(p.start,p.end),0):outputTime(clip,clip.end),parts=(clip.parts||[]).reduce((n,p)=>n+tight(p.start,p.end),0);
 const fx=(clip.effects||[]).reduce((n,e)=>n+(e.type==='freeze'?e.duration??.9:e.type==='replay'?(e.duration??2)/.6:0),0);
 return main+parts+fx+(s.coldOpen?Number(s.coldOpenSeconds)||1.6:0);
}

export function readiness(clip,job,exportInfo){
 const s=clip.settings||{},checks=[],add=(id,label,level,fix='')=>checks.push({id,label,pass:level==='pass',level,fix});
 const format=s.outputFormat||job?.options?.outputFormat||'shorts',cuts=clip.cuts||[];
 const spoken=(clip.words||[]).filter(w=>w.end>clip.start&&w.start<clip.end&&!cuts.some(c=>w.start>=c.start-.01&&w.end<=c.end+.01)).sort((a,b)=>a.start-b.start);
 // 1. Somebody talks right away (a cold open starts on the payoff, so it counts).
 if(s.coldOpen)add('speech','Opens on the payoff (cold open)','pass');
 else if(!spoken.length)add('speech','Speech in the first 2 seconds','warn','Open the editor to check the first words');
 else{const first=Math.max(0,outputTime(clip,spoken[0].start));add('speech',first<=2?'Speech in the first 2 seconds':`First words at ${first.toFixed(1)} s`,first<=2?'pass':'fail','Trim the start or cut the silence at the beginning');}
 // 2. Short on-screen hook that names who it is about.
 const hook=String(s.hookText||clip.hook||'').trim(),host=job?.host;
 if(s.hookEnabled===false||!hook)add('hook','On-screen title','warn','Turn on the on-video title so viewers know what they are watching');
 else if(words(hook).length>6)add('hook',`Hook is ${words(hook).length} words`,'warn','Keep the on-screen hook to 6 words or fewer');
 else if(host&&![host.name,host.short].filter(Boolean).some(n=>nameRe(n).test(hook)))add('hook',`Hook doesn't name ${host.short||host.name}`,'warn',`Say who did it, like “${host.short||host.name} …”`);
 else add('hook','Short hook that says who','pass');
 // 3. Length that suits the format.
 const length=playLength(clip),moment=job?.moments?.[s.editTemplate||job?.options?.editTemplate];
 if(length>60)add('length',`Plays for ${Math.round(length)} s`,'fail','Cut it to 60 seconds or less');
 else if(moment)add('length',`Plays for ${Math.round(length)} s`,length<moment.play[0]-2?'warn':'pass',`${moment.label}s play ${moment.play[0]}–${moment.play[1]} s; add setup before the payoff`);
 else if(length<20)add('length',`Plays for ${Math.round(length)} s`,'warn','Very short clips rarely hold attention; add setup');
 else if(format==='shorts'&&length<40)add('length',`Plays for ${Math.round(length)} s`,'warn','Add setup: about a minute gives viewers the context before the payoff');
 else add('length',`Plays for ${Math.round(length)} s`,'pass');
 // 4. Captions.
 add('captions',s.captionsEnabled===false?'Captions are off':'Captions on',s.captionsEnabled===false?'warn':'pass','Most viewers watch muted; turn captions on');
 // 5. Exported with the latest edits.
 if(!exportInfo)add('export','Not exported yet','fail','Export the clip');
 else if(clip.dirty)add('export','Edits not exported yet','fail','Re-export to apply your edits');
 else if(clip.exportError)add('export','Last export failed','fail',clip.exportError);
 else add('export','Exported with your edits','pass');
 // 6. A strong first line or a cold open (soft check).
 const opening=spoken.slice(0,8).map(w=>w.text).join(' ');
 const early=(clip.effects||[]).some(e=>e.at>=clip.start&&outputTime(clip,e.at)<=3);
 if(s.coldOpen||early||STRONG.test(opening))add('opening',s.coldOpen?'Cold open':early?'Effect in the first 3 seconds':'Strong first line','pass');
 else add('opening','Slow start','warn','Turn on the cold open or add a zoom or sound in the first 3 seconds');
 // 7. The title is a who-did-what line, not a raw transcript quote.
 const title=String(clip.title||'').trim(),said=norm(clip.sourceContext?.transcript||spoken.map(w=>w.text).join(' '));
 const quote=/^["“'‘]/.test(title)||(words(title).length>=4&&said&&said.includes(norm(title)));
 add('title',quote?'Title is a quote from the clip':'Title says who did what',quote?'warn':'pass','Rewrite it as “who did what”, or press Rewrite titles');
 const failed=checks.filter(c=>c.level==='fail').length,warned=checks.filter(c=>c.level==='warn').length;
 return {ok:!failed,failed,warned,passed:checks.length-failed-warned,checks};
}

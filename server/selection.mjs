import {randomUUID} from 'node:crypto';
import {laugh,strong,clipCue,clamp,maskProfanity,dropProfanity,loudness,cueSums,categoryScores} from './moments.mjs';import {clipPeople} from './people.mjs';import {EDIT_TEMPLATES} from './templates.mjs';
const CATEGORIES=['funny','highlight','clippable'];
/** Shorts play at most 60 s (longer ones are blocked worldwide once a Content ID claim lands); the source window may run to 90 s because pauses are trimmed. */
export const PLAY_MAX=60,SPAN_MAX=90;
/**
 * Templates built around one kind of moment (the meme edits) carry a `moment` shape: played length `play` [lo,hi] s,
 * source window `min`–`max` s, where the payoff sits (`payoff`, 0–1), and `cut` (a jump cut right before it) or
 * `ending` (the clip ends within `after` s of it). Other templates use the default minute-long moments.
 */
export function momentShape(options={}){return EDIT_TEMPLATES.find(t=>t.id===options.editTemplate)?.moment||null;}
export function validateCandidates(list,duration,{min=20}={}){
 if(!Array.isArray(list)||list.length>30)throw new Error('Invalid clip response');
 return list.map(c=>{if(!c||typeof c.start!=='number'||typeof c.end!=='number'||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end>duration+.01||c.end-c.start<min||c.end-c.start>SPAN_MAX)throw new Error('Invalid candidate time range');return {id:c.id&&/^[a-f0-9-]{36}$/.test(c.id)?c.id:randomUUID(),start:c.start,end:c.end,title:String(c.title||'Selected moment').slice(0,100),hook:String(c.hook||'').slice(0,200),score:Math.max(0,Math.min(100,Number(c.score)||50)),reasons:Array.isArray(c.reasons)?c.reasons.map(String).slice(0,4):['Suggested moment'],category:CATEGORIES.includes(c.category)?c.category:'clippable',...(Number.isFinite(c.peakAt)?{peakAt:c.peakAt}:{}),...(c.titleSource?{titleSource:String(c.titleSource)}:{}),kept:true,settings:{}};});
}
/** "auto" scales with the source: about one clip per 11 minutes, 3–12. Explicit counts are kept. */
export function clipCount(count,duration){return Number.isInteger(count)?count:clamp(Math.round((duration||0)/660),3,12);}

const filler=/^(?:and|but|so|like|uh+|um+|or|because|cause|then|yeah|okay|ok)\b/i;
const leadFiller=/^(?:(?:yo+|bro|bruh|dude|man|like|uh+|um+|okay|ok|so|and|but|yeah|nah|chat|look|listen|wait)[,!.]?\s+)+/i;
const stamp=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const wordCount=s=>String(s||'').split(/\s+/).filter(Boolean).length;
const SMALL=new Set(['a','an','the','of','to','in','on','at','and','or','for','by','with','as']);
export const titleCase=s=>String(s||'').replace(/[\p{L}\p{N}'’]+/gu,(w,at,all)=>at&&!/[“"(:]\s*$/.test(all.slice(0,at))&&SMALL.has(w.toLowerCase())?w.toLowerCase():/[A-Z].*[A-Z]|\d/.test(w)?w:w[0].toUpperCase()+w.slice(1));
function quotable(line){const s=dropProfanity(String(line||'').replace(/\s+/g,' ').trim()).replace(leadFiller,'').replace(/^[,.;:\s]+/,'').replace(/[,;:]+$/,'').trim();return s?s[0].toUpperCase()+s.slice(1):'';}
// A quote earns a title only if it says something: no repeated words, at least two words that are not filler.
const FILLER=new Set('okay ok alright yeah yes no like bro uh um oh yo so go what wait huh man dude bruh just the a and i you it is'.split(' '));
const meaningful=q=>{const w=q.toLowerCase().match(/[\p{L}\p{N}']+/gu)||[];return new Set(w).size===w.length&&w.filter(x=>!FILLER.has(x)).length>=2;};
/**
 * Local "who did what" titles when no AI key is set, built only from evidence: the subject is the host (from the channel)
 * or a person named in/near the clip; the action comes from the reaction cues; otherwise a short clean quote from the peak.
 */
export function localTitles(text,{category='clippable',peakText='',people=[],counts={},loudPeak=false}={}){
 const subject=people[0]||{name:'Streamer',short:'Streamer'},guest=people.find(p=>p.evidence==='named in the clip'&&p.name!==subject.name);
 const near=`${peakText} `,lines=String(text||'').split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
 const rate=s=>(strong.test(s)?3:0)+(laugh.test(s)?2:0)+(/[!?]$/.test(s)?1:0)+(near.includes(s.slice(0,20))?4:0)-(wordCount(quotable(s))<2?6:0)-(wordCount(quotable(s))>7?3:0);
 const best=lines.map(s=>({s,r:rate(s)})).sort((a,b)=>b.r-a.r)[0]?.s||'',quote=quotable(best),shortQuote=wordCount(quote)>=3&&wordCount(quote)<=6&&quote.length<=40&&/[?!.]$/.test(quote)&&meaningful(quote)?quote.replace(/\.$/,''):'';
 let action='';
 if(counts.laughs>=2)action="Can't Stop Laughing";
 else if(/\bno way\b/i.test(near))action="Can't Believe What Happened";
 else if(/\boh my (?:god|gosh)\b|\bomg\b/i.test(near))action='Loses It';
 else if(/\blet'?s go+(?:[!.,]|\s*$)/i.test(near))action='Celebrates Hard';
 else if(/\b(?:that'?s|this is) (?:insane|unbelievable)\b/i.test(near))action='Calls It Insane';
 let title;
 if(action)title=`${subject.name} ${action}${guest&&`${subject.name} ${action} With ${guest.short}`.length<=60?` With ${guest.short}`:''}`;
 else if(shortQuote)title=/\?$/.test(shortQuote)?`${subject.name} Asks “${titleCase(shortQuote)}”`:loudPeak&&/!$/.test(shortQuote)?`${subject.name} Yells “${titleCase(shortQuote)}”`:`${subject.name}: “${titleCase(shortQuote)}”`;
 else title=`${subject.name} Reacts ${guest?`With ${guest.short}`:'Live On Stream'}`;
 if(title.length>60)title=title.replace(subject.name,subject.short);
 title=titleCase(maskProfanity(title)).slice(0,60);
 let hook=title;
 if(wordCount(hook)>6)hook=shortQuote&&wordCount(shortQuote)<=6?`“${titleCase(shortQuote)}”`:wordCount(`${subject.short} ${action}`)<=6&&action?`${subject.short} ${action}`:({funny:'Wait for it…',highlight:'Wait for the reaction',clippable:'You have to see this'})[category]||'Wait for it…';
 return {title,hook:titleCase(hook)};
}

/**
 * Modern-clipper picking: find reaction peaks (laughs, hype words, "clip that", loudness against the stream's own baseline),
 * then choose a sentence-aligned window per peak with setup before it and an ending once the reaction settles.
 */
export function pickClips(transcript,options={},{people={host:null,named:[]}}={}){
 const {count='auto',threshold=.6,padding=.12}=options,shape=momentShape(options),minDuration=shape?.min??options.minDuration??45,maxDuration=shape?.max??options.maxDuration??90;
 const words=transcript.words||[],duration=transcript.duration||words.at(-1)?.end||0;if(words.length<8||duration<minDuration)return [];
 const n=words.length,wanted=clipCount(count,duration),cues=cueSums(words),loud=loudness(transcript);
 const isStart=words.map((w,i)=>i===0||/[.!?]$/.test(words[i-1].text)||w.start-words[i-1].end>.7);
 const isEnd=words.map((w,i)=>i===n-1||/[.!?]$/.test(w.text)||words[i+1].start-w.end>.6);
 const longGap=[0];for(let i=1;i<n;i++)longGap[i]=longGap[i-1]+Math.max(0,words[i].start-words[i-1].end-1.5);
 const cut=[0];for(let i=1;i<n;i++){const gap=words[i].start-words[i-1].end;cut[i]=cut[i-1]+(gap>threshold?gap-2*padding:0);}
 const kept=(i,j)=>words[j].end-words[i].start-(cut[j]-cut[i])+2*padding;
 const firstAt=t=>{let lo=0,hi=n;while(lo<hi){const m=(lo+hi)>>1;if(words[m].start<t)lo=m+1;else hi=m;}return lo;};
 // Excitement per second: cue weights within ±3 s plus a loudness boost.
 const secs=Math.ceil(duration),cue=new Float32Array(secs+1),speech=new Uint8Array(secs+1);
 words.forEach((w,i)=>{const s=clamp(Math.floor(w.start),0,secs),t=w.text||'',pair=`${words[i-1]?.text||''} ${t}`;speech[s]=1;cue[s]+=(laugh.test(t)?3:0)+(strong.test(t)||strong.test(pair)?2.5:0)+(clipCue.test(pair)?4:0)+(/!$/.test(t)?.6:0)+(/\?$/.test(t)?.3:0);});
 const excite=new Float32Array(secs+1);
 for(let t=0;t<=secs;t++){let c=0,talk=0;for(let k=Math.max(0,t-3);k<=Math.min(secs,t+3);k++){c+=cue[k];talk+=speech[k];}if(!talk){excite[t]=0;continue;}const {ratio,peak}=loud.at(Math.max(0,t-1.5),t+1.5);excite[t]=c+2.5*clamp(peak-1,0,1.5)+1.5*clamp(ratio-1,0,2);}
 // Peaks: strongest seconds first, at least 25 s apart, away from the very edges.
 const order=[...excite.keys()].filter(t=>t>4&&t<duration-2).sort((a,b)=>excite[b]-excite[a]),peaks=[];
 const spacing=shape?Math.max(12,shape.max*.6):25;for(const t of order){if(peaks.length>=Math.max(20,wanted*5))break;if(peaks.every(p=>Math.abs(p-t)>=spacing))peaks.push(t);}
 // Aim for about a minute of playback after pause trimming: enough setup before the payoff for viewers to follow it.
 // The source window may run longer (up to maxDuration) because pauses are cut; playback stays under the 60 s Shorts limit.
 // A template's moment shape sets its own played length and where the payoff sits instead.
 const hi=shape?shape.play[1]:Math.min(PLAY_MAX-1,maxDuration),target=shape?(shape.play[0]+shape.play[1])/2:hi-2,lo=shape?shape.play[0]:target-10,[early,late]=shape?.payoff||[.35,.85];
 // Longest pause just before a peak: the jump cut a reveal lands on.
 const gapBefore=p=>{let g=0;for(let k=Math.max(1,firstAt(p-1.5));k<n&&words[k].start<=p+.5;k++)g=Math.max(g,words[k].start-words[k-1].end);return g;};
 const candidates=[];
 for(const p of peaks){
  let best=null;const iFrom=firstAt(p-maxDuration+2),iTo=firstAt(p-3),jFrom=firstAt(p+1.5),jTo=firstAt(shape?.after?p+shape.after:p+maxDuration-4);
  const reveal=shape?.cut?(gapBefore(p)>threshold?6:-5):0;
  for(let i=iFrom;i<iTo&&i<n;i++){
   if(!isStart[i])continue;const start=Math.max(0,words[i].start-.08),opening=words.slice(i,i+8).map(w=>w.text).join(' ');
   const setup=(i===0||words[i].start-words[i-1].end>.7?3:1)+(filler.test(opening)?-4:0)+(/\?/.test(opening)?2:0);
   for(let j=Math.max(jFrom-1,i+1);j<Math.min(jTo,n);j++){
    if(!isEnd[j])continue;const end=Math.min(duration,words[j].end+.1),len=end-start;if(len<minDuration)continue;if(len>maxDuration)break;
    const k=kept(i,j);if(k>hi)break;const {ratio,peak}=loud.at(start,end),scores=categoryScores({cues,i,j,ratio,peak,opening,density:(j+1-i)/len});
    const category=CATEGORIES.reduce((a,b)=>scores[b]>scores[a]?b:a),base=scores[category]+.2*(scores.funny+scores.highlight+scores.clippable-scores[category]);
    const pos=(p-start)/len,payoff=pos>=early&&pos<=late?6:-12*Math.min(Math.abs(pos-early),Math.abs(pos-late));
    const settleTail=loud.at(Math.max(start,end-1.5),end).ratio,settle=loud.available?2*clamp(loud.at(p-1,p+1).ratio-settleTail,0,2):0;
    const fit=(k>=lo&&k<=hi?0:-1.2*(k<lo?lo-k:k-hi))-.25*Math.abs(k-target),dead=-.8*(longGap[j]-longGap[i]),thin=(j+1-i)/len<1?-4:0;
    const ending=shape?.ending?(cues.range('laugh',firstAt(end-3),j+1)?4:0)+(cues.range('strong',firstAt(end-3),j+1)?2:0):0;
    const raw=base+setup+payoff+settle+fit+dead+thin+reveal+ending+(/[!?]$/.test(words[j].text)?1:0);
    if(!best||raw>best.raw)best={start:+start.toFixed(3),end:+end.toFixed(3),i,j,p,raw,category,scores,peak,kept:k};
   }
  }
  if(best)candidates.push(best);
 }
 candidates.sort((a,b)=>b.raw-a.raw);const selected=[];
 for(const c of candidates){if(selected.some(s=>Math.max(0,Math.min(c.end,s.end)-Math.max(c.start,s.start))>Math.min(3,(c.end-c.start)*.1)))continue;selected.push(c);if(selected.length===wanted)break;}
 return validateCandidates(selected.map(c=>{
  const text=words.slice(c.i,c.j+1).map(w=>w.text).join(' '),peakText=words.slice(firstAt(c.p-4),firstAt(c.p+3)).map(w=>w.text).join(' ');
  const laughs=cues.range('laugh',c.i,c.j+1),hype=cues.range('strong',c.i,c.j+1),clipped=cues.range('clip',c.i,c.j+1),nearby=words.slice(firstAt(c.start-30),firstAt(c.end+15)).map(w=>w.text).join(' ');
  const {title,hook}=localTitles(text,{category:c.category,peakText,people:clipPeople(people,nearby),counts:{laughs,hype},loudPeak:c.peak>1.1});
  const reasons=[`Peak ${stamp(c.p-c.start)} in${[laughs&&`${laughs} laugh${laughs>1?'s':''}`,hype&&`${hype} hype word${hype>1?'s':''}`,clipped&&'"clip that" cue',c.peak>1.1&&'loud reaction'].filter(Boolean).map(s=>' · '+s).join('')}`,`Setup ${Math.round(c.p-c.start)}s before the payoff`,`About ${Math.round(c.kept)}s after pause trimming`,...(shape?[`${shape.label} for this template`]:[])];
  return {start:c.start,end:c.end,title,hook,score:Math.round(clamp(99*(1-Math.exp(-Math.max(0,c.raw)/40)),1,99)),reasons,category:c.category,peakAt:+(c.p-c.start).toFixed(2),titleSource:'local'};
 }),duration,{min:Math.min(20,minDuration)});
}

export function buildEdl(words,{start,end,threshold=.6,padding=.12,silences=[]}={}){
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Invalid source range');
 const valid=words.filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start&&w.end>start&&w.start<end).sort((a,b)=>a.start-b.start);
 if(!valid.length)return [];
 // ASR gaps and measured quiet intervals identify dead air; never cut through a retained word.
 const spans=[];let a=Math.max(start,valid[0].start-padding),b=Math.min(end,valid[0].end+padding);
 for(let i=1;i<valid.length;i++){
  const w=valid[i],prev=valid[i-1];const gap=w.start-prev.end;
  const measured=silences.some(s=>s.start< w.start-padding&&s.end>prev.end+padding);
  if(gap>threshold){spans.push({start:a,end:b});const safePadding=measured?padding:Math.max(padding,.16);a=Math.max(start,w.start-safePadding);b=Math.min(end,w.end+padding);}
  else b=Math.max(b,Math.min(end,w.end+padding));
 }
 spans.push({start:a,end:b});let output=0;
 return spans.filter(s=>s.end>s.start).map(s=>{const outputStart=output;output+=s.end-s.start;return {...s,outputStart,outputEnd:output};});
}
// Measured on the references: the skull ending holds its last frame for 2.93 s (B4Xh4PzRtJM 15.80–18.73);
// the reveal holds the frame before the jump cut for 0.53 s (eUFkorW-1kk 1.80–2.33) while the sound fades to silence.
export const SKULL_HOLD=2.9,REVEAL_HOLD=.53;
const finite=v=>typeof v==='number'&&Number.isFinite(v),num=(v,lo,hi,d)=>finite(v)?Math.min(hi,Math.max(lo,v)):d,FRAME=1/30;
// Output length of a segment: freezes hold one frame, replays play slower than real time.
const outLength=s=>s.kind==='freeze'||s.kind==='skull'?s.hold:(s.end-s.start)/(s.speed||1);
// A single clock for concat video, PCM samples and captions. Padding belongs to
// each cut, rather than accumulating unaccounted rounding at every concat join.
export function clockEdl(spans,fps=30){let frame=0;return spans.map(s=>{const frames=Math.max(1,Math.ceil(outLength(s)*fps-1e-7)),outputStart=frame/fps;frame+=frames;return {...s,frames,samples:frames*48000/fps,outputStart,outputEnd:frame/fps};});}
const isMain=s=>!s.kind||s.kind==='main';
// Captions follow the main pass only: the cold-open teaser and slow-motion replays repeat words and show a label instead.
export function retimeWords(words,edl){
 const result=[],mains=edl.filter(isMain);for(const w of words){const span=mains.find(s=>w.start>=s.start-.001&&w.end<=s.end+.001);if(!span)continue;const start=Math.max(0,span.outputStart+w.start-span.start),end=span.outputStart+w.end-span.start;if(end>start)result.push({...w,start,end});}return result;
}
/** Owner cuts inside [start,end]: merged, and shrunk so they never split a kept word; words mostly inside a cut go with it. */
export function cleanCuts(cuts,words,{start,end}){
 const list=(Array.isArray(cuts)?cuts:[]).filter(c=>c&&finite(c.start)&&finite(c.end)).map(c=>({start:Math.max(start,c.start),end:Math.min(end,c.end)})).filter(c=>c.end-c.start>=.1).sort((a,b)=>a.start-b.start).slice(0,40);
 const merged=[];for(const c of list){const last=merged.at(-1);if(last&&c.start<=last.end)last.end=Math.max(last.end,c.end);else merged.push({...c});}
 const inside=w=>merged.some(c=>Math.min(w.end,c.end)-Math.max(w.start,c.start)>(w.end-w.start)/2),kept=words.filter(w=>!inside(w));
 const shrunk=merged.map(c=>{let a=c.start,b=c.end;for(const w of kept){if(w.start<a&&w.end>b)return null;if(w.start<a&&w.end>a)a=w.end;if(w.start<b&&w.end>b)b=w.start;}return b-a>=.05?{start:a,end:b}:null;}).filter(Boolean);
 return {cuts:shrunk,words:kept};
}
function subtract(spans,cuts){const out=[];for(const s of spans){let pieces=[{start:s.start,end:s.end}];for(const c of cuts)pieces=pieces.flatMap(p=>c.end<=p.start||c.start>=p.end?[p]:[{start:p.start,end:c.start},{start:c.end,end:p.end}]);out.push(...pieces.filter(p=>p.end-p.start>=FRAME));}return out;}
// Split the main segment that contains t and put seg between the halves (or after it when t is its end).
function insertAt(list,t,seg){const i=list.findIndex(s=>isMain(s)&&t>=s.start-.001&&t<=s.end+.001);if(i<0)return false;const s=list[i],pieces=[];if(t-s.start>=FRAME)pieces.push({...s,end:t});pieces.push(seg);if(s.end-t>=FRAME)pieces.push({...s,start:t});list.splice(i,1,...pieces);return true;}
/** Where the cold-open teaser points: contract coldOpenAt, else the first replay, else the picker's peak, else 65% through. */
export function payoffTime(clip,options={}){const s=clip.start,e=clip.end,replay=(clip.effects||[]).find(f=>f&&f.type==='replay'&&finite(f.at));const p=finite(options.coldOpenAt)?options.coldOpenAt:replay?replay.at:finite(clip.peakAt)?s+clip.peakAt:s+.65*(e-s);return Math.min(e,Math.max(s,p));}
/**
 * The whole edit as unclocked segments: the speech-tightened main range minus owner cuts, extra parts in order,
 * freezes and slow-motion replays from manual effects, and an optional cold-open teaser in front.
 * Kinds: main (captioned), cold (teaser), freeze (one held frame, `hold` s; `reveal` marks the meme reveal's), replay (`speed` < 1),
 * skull (the held last frame of the skull ending).
 */
export function buildClipEdl(words,clip,options={},{silences=[]}={}){
 const opts={threshold:options.threshold??.6,padding:options.padding??.12,silences},ranges=[{start:clip.start,end:clip.end}];
 for(const p of (Array.isArray(clip.parts)?clip.parts:[]).slice(0,3))if(p&&finite(p.start)&&finite(p.end)&&p.end-p.start>=2&&p.end-p.start<=30)ranges.push({start:p.start,end:p.end});
 let list=[];for(const r of ranges){const inRange=words.filter(w=>w.end>r.start&&w.start<r.end),{cuts,words:kept}=cleanCuts(clip.cuts,inRange,r);list.push(...subtract(kept.length?buildEdl(kept,{start:r.start,end:r.end,...opts}):[],cuts).map(s=>({start:s.start,end:s.end,kind:'main'})));}
 if(!list.length)return [];
 // Loop ending: stop right after the last word, no trailing room tone, so the Short wraps straight into its start.
 if(options.loopEnding){const last=list.at(-1),word=words.filter(w=>w.start<last.end&&w.end>last.start).at(-1);if(word)last.end=Math.max(last.start+FRAME,Math.min(last.end,word.end+.04));}
 // Splits land on a word end, so no caption word is cut in two.
 const wordEnd=(t,limit)=>{const w=words.find(x=>x.start<t&&x.end>t);return w?Math.min(limit,w.end):t;};
 for(const f of (Array.isArray(clip.effects)?clip.effects:[]).filter(f=>f&&finite(f.at)&&(f.type==='freeze'||f.type==='replay')).sort((a,b)=>a.at-b.at)){
  const host=list.find(s=>isMain(s)&&f.at>=s.start&&f.at<=s.end);if(!host)continue;
  if(f.type==='freeze'){const t=wordEnd(f.at,host.end);insertAt(list,t,{kind:'freeze',start:t,end:t,hold:num(f.duration,.4,2,.9),effectId:f.id});continue;}
  const d=num(f.duration,1,4,2),a=Math.max(host.start,f.at-d*.75),b=wordEnd(Math.min(host.end,f.at+d*.25),host.end);if(b-a<.4)continue;
  insertAt(list,b,{kind:'replay',start:a,end:b,speed:.6,effectId:f.id});
 }
 // Meme reveal: hold the frame just before the jump cut nearest the payoff (within 1.5 s), else before the word nearest it.
 if(options.revealFx&&finite(clip.peakAt)){const p=clip.start+clip.peakAt,mains=list.filter(isMain);let t=null;
  const jumps=mains.slice(1).map((b,i)=>({a:mains[i],b})).filter(({a,b})=>b.start-a.end>.05&&Math.abs(b.start-p)<=1.5).sort((x,y)=>Math.abs(x.b.start-p)-Math.abs(y.b.start-p));
  if(jumps.length)t=jumps[0].a.end-FRAME;else{const w=words.filter(w=>Math.abs(w.start-p)<=2&&mains.some(s=>w.start>s.start&&w.start<=s.end)).sort((a,b)=>Math.abs(a.start-p)-Math.abs(b.start-p))[0];if(w)t=w.start;}
  if(t!==null&&t-clip.start>=1.8)insertAt(list,t,{kind:'freeze',start:t,end:t,hold:REVEAL_HOLD,reveal:true});}
 // Skull ending: the last kept frame holds for 2.9 s (whip, punch-in, grade, flames, skull and beat are added at render).
 if(options.skullEnding){const k=list.findLastIndex(isMain),last=list[k];if(last){const t=Math.max(last.start,last.end-FRAME);list.splice(k+1,0,{kind:'skull',start:t,end:t,hold:SKULL_HOLD});}}
 if(options.coldOpen){const S=num(options.coldOpenSeconds,1,3,1.6),p=payoffTime(clip,options);let b=Math.min(clip.end,p+S*.4),a=Math.max(clip.start,b-S);b=Math.min(clip.end,a+S);if(b-a>=.5)list.unshift({kind:'cold',start:a,end:b});}
 return list;
}
/** Seconds the finished edit plays: pauses tightened, cuts removed, parts, freezes, replays and cold open added. */
export const playedLength=(words,clip,options={})=>buildClipEdl(words,clip,options).reduce((n,s)=>n+outLength(s),0);
/** Pull the end back to a sentence end (else any word end) until the edit plays for at most `max` seconds. */
export function fitPlayed(words,clip,options={},max=60){
 if(playedLength(words,clip,options)<=max)return clip;
 const inside=words.filter(w=>w.end>clip.start+20&&w.end<clip.end).reverse();
 for(const pass of [w=>/[.!?]$/.test(w.text),()=>true])for(const w of inside.filter(pass)){const end=+(w.end+.1).toFixed(3);if(playedLength(words,{...clip,end},options)<=max)return {...clip,end};}
 return clip;
}
/**
 * Manual effects at output time: freezes and replays at their own segment, others where their source time plays in the
 * main pass. An effect in dead air that pause removal dropped snaps to the nearest kept speech (within 2 s); one inside an
 * owner cut is dropped with the cut.
 */
export function placeEffects(effects,edl,{cuts=[]}={}){const out=[],mains=edl.filter(isMain);for(const f of (Array.isArray(effects)?effects:[]).slice(0,40)){if(!f||!finite(f.at))continue;
 if(f.type==='freeze'||f.type==='replay'){const seg=edl.find(s=>s.effectId===f.id&&s.kind===f.type);if(seg)out.push({...f,out:seg.outputStart,dur:seg.outputEnd-seg.outputStart});continue;}
 if((Array.isArray(cuts)?cuts:[]).some(c=>c&&f.at>=c.start&&f.at<=c.end))continue;
 let seg=mains.find(s=>f.at>=s.start&&f.at<=s.end),at=f.at;if(!seg){const next=mains.filter(s=>s.start>f.at).sort((a,b)=>a.start-b.start)[0],prev=mains.filter(s=>s.end<f.at).sort((a,b)=>b.end-a.end)[0];if(next&&next.start-f.at<=2){seg=next;at=next.start;}else if(prev&&f.at-prev.end<=2){seg=prev;at=prev.end;}}
 if(!seg)continue;out.push({...f,out:Math.min(seg.outputEnd,seg.outputStart+at-seg.start),dur:num(f.duration,.15,1.5,f.type==='pop'?.9:f.type==='flash'?.25:.5),...(f.type==='label'?{dur:num(f.duration,.4,2,.9)}:{})});}
 return out.sort((a,b)=>a.out-b.out);}

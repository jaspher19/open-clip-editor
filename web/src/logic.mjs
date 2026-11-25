export function formatTime(t){if(!Number.isFinite(t)||t<0)return '0:00.0';if(t>=3600)return clock(t);return `${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;}
export function trimError(start,end,duration,min=20){if(!Number.isFinite(start)||!Number.isFinite(end))return 'Enter a valid number for both trim points.';if(start<0||end>duration)return 'Keep the range within the source video.';if(end-start<min)return `Choose at least ${min} seconds of source footage.`;if(end-start>90)return 'Keep each source selection at 90 seconds or less.';return '';}
export function downloadableIds(job){return job.clips.filter(c=>c.kept&&!c.dirty&&job.exports.some(e=>e.clipId===c.id)).map(c=>c.id);}
// Settings the user changed after choosing a template; unset keys keep the template value.
export function templateChanges(value,template){return template?Object.keys(template.settings).filter(k=>value[k]!==undefined&&JSON.stringify(value[k])!==JSON.stringify(template.settings[k])):[];}
// Per-template memory of the user's tweaks. Browser storage may be unavailable; memory is a convenience only.
const TWEAKS_KEY='openclip.templateTweaks';
export function loadTweaks(storage=globalThis.localStorage){try{return JSON.parse(storage?.getItem(TWEAKS_KEY)||'{}')||{};}catch{return {};}}
export function saveTweaks(id,value,template,storage=globalThis.localStorage){if(!id||!template)return;const all=loadTweaks(storage),keys=templateChanges(value,template),next={...all};if(keys.length)next[id]=Object.fromEntries(keys.map(k=>[k,value[k]]));else delete next[id];if(JSON.stringify(next)!==JSON.stringify(all))try{storage?.setItem(TWEAKS_KEY,JSON.stringify(next));}catch{/* private mode or full storage */}}
// Meme-only effects are off unless the chosen template turns them on (mirrors server/templates.mjs).
const TEMPLATE_RESET={revealFx:false,cutFlash:false,tintFlashes:false,skullEnding:false,actionLabels:false,hookReveal:'pop',hookPosition:'top',rawClip:false};
export function withTemplate(value,template,{remember=true,storage=globalThis.localStorage}={}){const saved=remember?loadTweaks(storage)[template.id]||{}:{};const tweaks=Object.fromEntries(Object.entries(saved).filter(([k])=>k in template.settings));return {...value,...TEMPLATE_RESET,...template.settings,...tweaks,editTemplate:template.id};}
// Editor clock: m:ss.s under an hour, h:mm:ss.s above.
export function clock(t){if(!Number.isFinite(t)||t<0)t=0;const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=(t%60).toFixed(1).padStart(4,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;}
export function parseClock(text){const parts=String(text).trim().split(':');if(!parts[0]||parts.length>3||parts.some(p=>!/^\d+(\.\d+)?$/.test(p)))return NaN;return parts.reduce((total,p)=>total*60+Number(p),0);}
export const CATEGORY_INFO={funny:{label:'Fun moment',className:'is-fun'},highlight:{label:'Worth it',className:'is-worth'},clippable:{label:'Clip this',className:'is-clip'}};
// Clips that have a current export and can be posted or downloaded.
export function readyClips(job){return job.clips.filter(c=>c.kept&&!c.dirty&&job.exports.some(e=>e.clipId===c.id));}
// The template the clips actually use: most common export template, else the project's template.
export function projectTemplate(job){const counts=new Map();for(const e of job.exports||[])if(e.editTemplate&&e.editTemplate!=='custom')counts.set(e.editTemplate,(counts.get(e.editTemplate)||0)+1);for(const c of job.clips||[])if(c.settings?.editTemplate)counts.set(c.settings.editTemplate,(counts.get(c.settings.editTemplate)||0)+.5);return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||job.options?.editTemplate||'context-hit';}
// Face-follow centre at a source time, linearly interpolated; 0.5 when there is no track.
export function centerAt(samples,t){const s=(samples||[]).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.centerX));if(!s.length)return .5;if(t<=s[0].time)return s[0].centerX;for(let i=0;i<s.length-1;i++)if(t<=s[i+1].time){const a=s[i],b=s[i+1];return a.centerX+(b.centerX-a.centerX)*(t-a.time)/Math.max(.001,b.time-a.time);}return s.at(-1).centerX;}
// CSS box (percent of the frame) that shows a sourceAspect video cropped to frameAspect around centerX.
export function cropBox(sourceAspect,frameAspect,centerX=.5){const ratio=sourceAspect/frameAspect;if(ratio<=1)return {width:100,left:0};const left=Math.min(0,Math.max((1-ratio)*100,50-centerX*ratio*100));return {width:ratio*100,left};}
// The caption chunk on screen at time t: up to `size` words around the spoken word, with the active one marked.
export function captionChunk(words,t,{size=3,edits={}}={}){const i=words.findLastIndex(w=>w.start<=t);if(i<0||t>=words[i].end+.15)return null;const first=Math.floor(i/size)*size;return {words:words.slice(first,first+size).map((w,k)=>({text:edits[first+k]??w.text,active:first+k===i}))};}
// Word to colour in an on-screen hook: the longest word, ties to the later one.
export function accentWord(text){const words=String(text||'').split(/\s+/).filter(Boolean);let best=-1;words.forEach((w,i)=>{const n=w.replace(/[^\p{L}\p{N}]/gu,'').length;if(n>=3&&(best<0||n>=words[best].replace(/[^\p{L}\p{N}]/gu,'').length))best=i;});return best;}
// --- Editing timeline (docs/EDIT-CONTRACT.md). All inputs are source seconds. ---
// Cuts clipped to [start,end], at least 0.1 s, sorted and merged where they touch.
export function normalizeCuts(cuts,start,end){const out=[];for(const c of [...(cuts||[])].map(c=>({start:Math.max(start,c.start),end:Math.min(end,c.end)})).filter(c=>c.end-c.start>=.1).sort((a,b)=>a.start-b.start)){const last=out.at(-1);if(last&&c.start<=last.end+.001)last.end=Math.max(last.end,c.end);else out.push({...c});}return out;}
// The played source segments in order: the main range minus cuts, then each extra part. outStart is the preview clock.
export function playSegments(start,end,cuts=[],parts=[]){const pieces=[];let at=start;for(const c of normalizeCuts(cuts,start,end)){if(c.start>at)pieces.push({start:at,end:c.start});at=Math.max(at,c.end);}if(end>at)pieces.push({start:at,end});for(const p of parts||[])if(p.end>p.start)pieces.push({start:p.start,end:p.end,part:true});let out=0;return pieces.map(p=>{const s={...p,outStart:out};out+=p.end-p.start;return s;});}
export const outputLength=segments=>segments.reduce((n,s)=>n+s.end-s.start,0);
// Source → preview time (null inside a cut or outside the clip); preview → source.
export function toOutput(t,segments){const s=segments.find(s=>t>=s.start-1e-6&&t<=s.end+1e-6);return s?s.outStart+Math.min(s.end,Math.max(s.start,t))-s.start:null;}
export function toSource(o,segments){if(!segments.length)return 0;const s=segments.find(s=>o<s.outStart+(s.end-s.start))||segments.at(-1);return Math.min(s.end,s.start+Math.max(0,o-s.outStart));}
export const inCut=(t,cuts)=>(cuts||[]).some(c=>t>=c.start&&t<c.end);
// The server's automatic accent beats (server/effects.mjs effectBeats), on preview time: pauses or ?/! words, 2.8 s apart, at most 8.
export function autoBeats(words,segments){const timed=words.map(w=>({w,o:toOutput(w.start,segments)})).filter(x=>x.o!==null).sort((a,b)=>a.o-b.o),total=outputLength(segments),out=[];for(let i=0;i<timed.length;i++){const {w,o}=timed[i];if(o<.08||o>total-.4)continue;const prev=timed[i-1];if(!out.length||((prev&&w.start-prev.w.end>.35||/[!?]$/.test(w.text))&&o-out.at(-1)>2.8)){out.push(o);if(out.length===8)break;}}return out;}
export const EFFECT_DEFAULTS={zoom:{duration:.5},shake:{duration:.4},flash:{duration:.3},freeze:{duration:.9,text:'WAIT FOR IT…'},replay:{duration:2,text:'REPLAY'},sfx:{},pop:{text:'',emoji:''},label:{duration:.9,text:'GETS UP'}};
export const EFFECT_LIMITS={zoom:[.15,1.5],shake:[.15,1.5],flash:[.15,1.5],freeze:[.4,2],replay:[1,4],label:[.4,2]};
// Undo history: each change pushes the previous state; changes with the same key within `ms` coalesce (typing, dragging).
export function historyPush(h,next,{key='',now=Date.now(),ms=900,limit=100}={}){if(JSON.stringify(next)===JSON.stringify(h.present))return h;if(key&&h.key===key&&now-h.at<ms)return {...h,present:next,at:now};return {past:[...h.past,h.present].slice(-limit),present:next,future:[],key,at:now};}
export const historyUndo=h=>h.past.length?{past:h.past.slice(0,-1),present:h.past.at(-1),future:[h.present,...h.future],key:'',at:0}:h;
export const historyRedo=h=>h.future.length?{past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1),key:'',at:0}:h;
/** Seconds a source range plays once export tightens pauses (an estimate of server/edl.mjs buildEdl). */
export function tightLength(words,start,end,{threshold=.6,padding=.12}={}){const w=(words||[]).filter(x=>x.end>start&&x.start<end).sort((a,b)=>a.start-b.start);if(!w.length)return 0;let total=0,a=Math.max(start,w[0].start-padding),b=Math.min(end,w[0].end+padding);for(let i=1;i<w.length;i++){if(w[i].start-w[i-1].end>threshold){total+=b-a;a=Math.max(start,w[i].start-padding);b=Math.min(end,w[i].end+padding);}else b=Math.max(b,Math.min(end,w[i].end+padding));}return total+b-a;}
// Stacked facecam layout (shared with server/stack.mjs so the preview matches the export). Boxes are [x,y,w,h] shares of the source frame.
export const STACK_SPLIT_MIN=.25,STACK_SPLIT_MAX=.55;
export function validBox(b){return Array.isArray(b)&&b.length===4&&b.every(v=>typeof v==='number'&&Number.isFinite(v))&&b[0]>=0&&b[1]>=0&&b[2]>=.02&&b[3]>=.02&&b[0]+b[2]<=1.0001&&b[1]+b[3]<=1.0001;}
/**
 * Panel heights in 1080×1920 pixels. Automatic split: the cam's own shape at full width, kept between 25% and 55% of the height.
 * @param {number[]|null} camBox
 * @param {{split?:number|null,sourceAspect?:number}} [opts]
 */
export function stackPanels(camBox,{split=null,sourceAspect=16/9}={}){
 const camAspect=camBox?(camBox[2]*sourceAspect)/camBox[3]:16/9,clamp=x=>Math.max(STACK_SPLIT_MIN,Math.min(STACK_SPLIT_MAX,x));
 const share=typeof split==='number'?clamp(split):clamp(1080/camAspect/1920),top=Math.max(2,Math.round(1920*share/2)*2);return {top,bottom:1920-top};
}
/**
 * Glow Card layout (stackStyle 'card', after the GTA 6 launch Shorts of Typical Gamer): a rounded webcam card with a
 * glowing edge over a full-width gameplay band, on a blurred copy of the gameplay. Pixels of the 1080×1920 frame;
 * the frame art (scripts/make-cam-card.py) is drawn around cam.
 */
export const CARD={cam:{x:100,y:48,w:880,h:544},game:{y:530,h:1210},captionY:672};
/**
 * The part of the cam box shaped like the card (880×544). A cam taller than the card loses height, not the head: the
 * face sits about 45% down (or the crop keeps the upper part when no face is known). A wider cam is cut at the sides
 * around the face.
 */
/**@param {number[]} box @param {number[]|null} [face] @param {number} [sourceAspect]*/
export function cardCamBox(box,face=null,sourceAspect=16/9){
 const [x,y,w,h]=box;
 const target=CARD.cam.w/CARD.cam.h,aspect=w*sourceAspect/h,clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 if(Math.abs(aspect-target)<.01)return [x,y,w,h];
 if(aspect<target){const nh=w*sourceAspect/target,ny=face?clamp(face[1]+face[3]/2-nh*.45,y,y+h-nh):y+(h-nh)*.2;return [x,ny,w,nh].map(v=>+v.toFixed(5));}
 const nw=h*target/sourceAspect,nx=face?clamp(face[0]+face[2]/2-nw/2,x,x+w-nw):x+(w-nw)/2;return [nx,y,nw,h].map(v=>+v.toFixed(5));
}
/** Default gameplay crop: full height, centred, shaped like the bottom panel (the whole width when the source is narrower). */
export function defaultGameBox(bottom,sourceAspect=16/9){const w=Math.min(1,(1080/bottom)/sourceAspect);return [+((1-w)/2).toFixed(4),0,+w.toFixed(4),1];}
/** The part of a box that fills a panel of `panelAspect` (cover scaling crops the box's longer side, centred). */
export function coverRect([x,y,w,h],panelAspect,sourceAspect=16/9){const a=(w*sourceAspect)/h;if(a>panelAspect){const nw=w*panelAspect/a;return [x+(w-nw)/2,y,nw,h];}const nh=h*a/panelAspect;return [x,y+(h-nh)/2,w,nh];}

/** Cam Split reaction zooms: how much tighter the cam panel cuts in. */
export const ZOOM=1.4;
/**
 * The tighter cam crop: the cam box shrunk by ZOOM around the face (or the box centre), kept inside the box.
 * @param {number[]} cam
 * @param {number[]|null} [face]
 */
export function zoomBox(cam,face){
 const [x,y,w,h]=cam,nw=w/ZOOM,nh=h/ZOOM,cx=face?face[0]+face[2]/2:x+w/2,cy=face?face[1]+face[3]*.6:y+h/2;
 return [Math.max(x,Math.min(x+w-nw,cx-nw/2)),Math.max(y,Math.min(y+h-nh,cy-nh/2)),nw,nh].map(v=>+v.toFixed(5));
}

/**
 * Caption translation, part 1: the clip's spoken words grouped into phrases to translate as whole sentences.
 * A phrase ends at . ! ?, at a pause of `gap` seconds, or after `maxWords` words. Returns arrays of word indices.
 * @param {{start:number,end:number,text:string}[]} words the whole transcript (with the owner's edits)
 * @param {{start:number,end:number}[]} ranges what the clip plays (main range and extra parts)
 */
export function captionPhrases(words,ranges,{maxWords=14,gap=.7}={}){
 const phrases=[];let current=[];
 words.forEach((w,i)=>{if(!ranges.some(r=>w.end>r.start&&w.start<r.end)||!String(w.text||'').trim())return;
  const prev=current.length?words[current.at(-1)]:null;
  if(prev&&(current.length>=maxWords||/[.!?…]["”']?$/.test(prev.text)||w.start-prev.end>gap||i!==current.at(-1)+1)){phrases.push(current);current=[];}
  current.push(i);});
 if(current.length)phrases.push(current);return phrases;
}
const NO_SPACES=/^(ja|zh|th|lo|km|my)(-|$)/i;
/** Words of a translated line; languages written without spaces are split into words with Intl.Segmenter. */
export function translationTokens(text,language=''){
 const clean=String(text||'').replace(/\s+/g,' ').trim();if(!clean)return [];
 if(!NO_SPACES.test(language)||typeof Intl.Segmenter!=='function')return clean.split(' ');
 const out=[];for(const s of new Intl.Segmenter(language,{granularity:'word'}).segment(clean)){if(!s.segment.trim())continue;if(!s.isWordLike&&out.length)out[out.length-1]+=s.segment;else out.push(s.segment);}
 return out;
}
/**
 * Caption translation, part 2: a translated phrase spread over the phrase's original word slots, in order, so the
 * subtitles keep the speech timing. More words than slots share a slot; fewer leave the last slots of each stretch blank.
 * @returns {string[]} one caption text per slot
 */
export function spreadTranslation(slotCount,text,language=''){
 const tokens=translationTokens(text,language),n=slotCount,k=tokens.length,glue=NO_SPACES.test(language)?'':' ';
 if(!n)return [];if(!k)return Array(n).fill('');
 const out=Array(n).fill('');
 if(k>=n)for(let j=0;j<n;j++)out[j]=tokens.slice(Math.floor(j*k/n),Math.floor((j+1)*k/n)).join(glue).slice(0,120);
 else tokens.forEach((t,i)=>{out[Math.floor(i*n/k)]=t.slice(0,120);});
 return out;
}

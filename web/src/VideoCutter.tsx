import {useEffect,useMemo,useRef,useState} from 'react';
import {Loader2,Play,Pause,Plus,Minus,Trash2,ArrowUp,ArrowDown,Download,ScissorsLineDashed,ZoomIn,ZoomOut,X,CircleAlert,RectangleVertical,RectangleHorizontal,Check,Sparkles,Film,Type,ScanFace,LayoutPanelTop,Maximize,Columns2} from 'lucide-react';
import type {Job,Cut} from './types';import {clock,parseClock} from './logic.mjs';
import {OUTPUT,PRESETS,defaultLayout,applyPreset,withPanel,withCamera,pixelAspect,shareRatio,coverSource,sameShapeLayout,refit} from './cutlayout.mjs';
import {TEXT_FONTS,newText,drawTexts,loadFonts,textLayer,type TextItem} from './cutText';
import CutBox from './CutBox';import {askTip} from './TipJar';
import './cutter.css';

type Seg={start:number;end:number};
type Box=[number,number,number,number];
type Layout={cam:Box;game:Box;camOut:Box;gameOut:Box;camOnTop:boolean;camHidden:boolean};
type Format='shorts'|'video';type Framing='fill'|'fit'|'split';
type Bucket={t:number;loud:number;laugh:number;hype:number;cue:number};
type Candidate={start:number;end:number;score:number;category:string;title:string;reasons?:string[]};
type Timeline={duration:number;bucket:number;buckets:Bucket[];candidates:Candidate[];clips:{id:string;start:number;end:number;title:string;kept:boolean}[]};
type HdSection={start:number;end:number;width:number;height:number;url:string};
type Quality=720|1080|1440;
const QUALITIES:[Quality,string][]=[[720,'720p HD'],[1080,'1080p Full HD'],[1440,'1440p 2K']];
const short=(s:{width:number;height:number})=>Math.min(s.width||0,s.height||0);
type Look={format:Format;framing:Framing;layouts:Record<Format,Layout|null>;texts:TextItem[]};
const busy=(j:Job)=>['queued','running','exporting'].includes(j.status);
const round=(t:number)=>Number(t.toFixed(2));
const isTyping=(el:EventTarget|null)=>{const e=el as HTMLElement|null;return !!e&&(e.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.tagName));};
async function call<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{...init,headers:{'Content-Type':'application/json',...init?.headers}});const type=r.headers.get('content-type')||'';if(!type.includes('json'))throw new Error(r.status===404?'The app server is running an older version. Restart it (Ctrl+C, then npm start).':`Request failed (${r.status})`);const body=await r.json();if(!r.ok)throw new Error(body.error||`Request failed (${r.status})`);return body as T;}
// Drafts live in browser storage: parts, and the look (shape, framing, boxes, text). A convenience only.
const store={get<T>(key:string,fallback:T):T{try{const v=localStorage.getItem(key);return v?JSON.parse(v) as T:fallback;}catch{return fallback;}},set(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* storage can be blocked */}}};
function loadDraft(id:string):Seg[]{const v=store.get<unknown>(`openclip-cut-${id}`,[]);return Array.isArray(v)?v.filter(s=>Number.isFinite(s?.start)&&Number.isFinite(s?.end)&&s.end>s.start):[];}
function saveDraft(id:string,segs:Seg[]){if(segs.length)store.set(`openclip-cut-${id}`,segs);else try{localStorage.removeItem(`openclip-cut-${id}`);}catch{/* ignore */}}
function loadLook(job:Job):Look{const v=store.get<Partial<Look>>(`openclip-cut-look-${job.id}`,{});const format:Format=v.format==='video'||v.format==='shorts'?v.format:job.options.outputFormat==='video'?'video':'shorts';
 return {format,framing:['fill','fit','split'].includes(String(v.framing))?v.framing as Framing:format==='video'?'fit':'fill',layouts:{shorts:sameShapeLayout(v.layouts?.shorts)?v.layouts!.shorts:null,video:sameShapeLayout(v.layouts?.video)?v.layouts!.video:null},texts:Array.isArray(v.texts)?v.texts.filter(t=>t&&typeof t.text==='string'):[]};}
const mb=(n?:number)=>n?`${(n/1e6).toFixed(n>1e8?0:1)} MB`:'';

function TimeField({label,value,max,onChange}:{label:string;value:number;max:number;onChange:(v:number)=>void}){
 const [text,setText]=useState(clock(value));useEffect(()=>setText(clock(value)),[value]);
 const commit=()=>{const t=parseClock(text);if(Number.isFinite(t))onChange(round(Math.max(0,Math.min(max,t))));else setText(clock(value));};
 return <span className="cut-time"><button type="button" aria-label={`${label} half a second earlier`} onClick={()=>onChange(round(Math.max(0,value-.5)))}><Minus size={13}/></button><input aria-label={label} inputMode="decimal" value={text} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();}}}/><button type="button" aria-label={`${label} half a second later`} onClick={()=>onChange(round(Math.min(max,value+.5)))}><Plus size={13}/></button></span>;
}

/** Draws one output frame from the source video: fill, fit (over a blurred copy) or the camera + gameplay layout. */
function drawFrame(ctx:CanvasRenderingContext2D,v:HTMLVideoElement,cw:number,ch:number,framing:Framing,layout:Layout|null){
 ctx.fillStyle='#000';ctx.fillRect(0,0,cw,ch);const sw=v.videoWidth,sh=v.videoHeight;if(!sw||!sh||v.readyState<2)return;
 const put=(sx:number,sy:number,w:number,h:number,dx:number,dy:number,dw:number,dh:number)=>{const [a,b,c,d]=coverSource(sx,sy,w,h,dw,dh);ctx.drawImage(v,a,b,c,d,dx,dy,dw,dh);};
 if(framing==='split'&&layout){const panel=(src:Box,out:Box)=>put(src[0]*sw,src[1]*sh,src[2]*sw,src[3]*sh,out[0]*cw,out[1]*ch,out[2]*cw,out[3]*ch);
  const order=layout.camHidden?['game']:layout.camOnTop?['game','cam']:['cam','game'];for(const k of order)k==='game'?panel(layout.game,layout.gameOut):panel(layout.cam,layout.camOut);return;}
 if(framing==='fit'){ctx.save();ctx.filter=`blur(${Math.round(cw/45)}px)`;put(0,0,sw,sh,-cw*.05,-ch*.05,cw*1.1,ch*1.1);ctx.restore();const s=Math.min(cw/sw,ch/sh);ctx.drawImage(v,(cw-sw*s)/2,(ch-sh*s)/2,sw*s,sh*s);return;}
 put(0,0,sw,sh,0,0,cw,ch);
}

/** Cut any parts of a project's video into one MP4: suggestions from the stream timeline, drag or I/O to mark, a camera + gameplay layout and text, then export. */
export default function VideoCutter({jobs,jobId,onPick,onChanged,onNewProject}:{jobs:Job[];jobId:string|null;onPick:(id:string)=>void;onChanged:(job:Job)=>void;onNewProject:()=>void}){
 const usable=jobs.filter(j=>j.sourceUrl&&j.metadata?.duration),job=usable.find(j=>j.id===jobId)||null;
 useEffect(()=>{if(!job&&usable[0])onPick(usable[0].id);},[job?.id,usable.length]);
 if(!usable.length)return <section className="cutter"><div className="cutter-empty"><Film size={42}/><h2>Nothing to cut yet</h2><p>Start a project with a video link or a file first. Once the video is imported, cut any parts of it here.</p><button className="primary" onClick={onNewProject}><Plus size={17}/>New project</button></div></section>;
 if(!job)return <section className="cutter"><p className="muted"><Loader2 className="spin" size={16}/> Opening the project…</p></section>;
 return <CutterFor key={job.id} job={job} jobs={usable} onPick={onPick} onChanged={onChanged}/>;
}

function CutterFor({job,jobs,onPick,onChanged}:{job:Job;jobs:Job[];onPick:(id:string)=>void;onChanged:(job:Job)=>void}){
 const duration=job.metadata?.duration||0,video=useRef<HTMLVideoElement>(null),strip=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),drag=useRef<number|null>(null),queue=useRef<{list:Seg[];i:number}|null>(null);
 const [segs,setSegsRaw]=useState<Seg[]>(()=>loadDraft(job.id)),[markIn,setMarkIn]=useState<number|null>(null),[t,setT]=useState(0),[playing,setPlaying]=useState(false);
 const [data,setData]=useState<Timeline|null>(null),[timelineNote,setTimelineNote]=useState(''),[view,setView]=useState<[number,number]|null>(null),[pick,setPick]=useState<[number,number]|null>(null);
 const [title,setTitle]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false),[showAll,setShowAll]=useState(false);
 const [look,setLookRaw]=useState<Look>(()=>loadLook(job)),[size,setSize]=useState<[number,number]>([job.metadata?.width||1920,job.metadata?.height||1080]);
 const [selected,setSelected]=useState<string|null>(null),[camBusy,setCamBusy]=useState(false),[camNote,setCamNote]=useState(''),[bounds,setBounds]=useState<Record<string,Box>>({});
 const proxy=!!job.remote?.proxy,[hd,setHdRaw]=useState<HdSection[]>([]),hdRef=useRef<HdSection[]>([]),[hdBusy,setHdBusy]=useState(''),[hdNote,setHdNote]=useState(''),[sourceSide,setSourceSide]=useState<number|null>(null);
 const [src,setSrc]=useState<HdSection|null>(null),srcRef=useRef<HdSection|null>(null),pendingSeek=useRef<{t:number;play:boolean}|null>(null);
 const [quality,setQualityRaw]=useState<Quality>(()=>{const q=Number(store.get('openclip-cut-quality',1080));return q===720||q===1440?q:1080;});const setQuality=(q:Quality)=>{setQualityRaw(q);store.set('openclip-cut-quality',q);};
 const [cs,setCs]=useState(360);
 const setHd=(list:HdSection[])=>{hdRef.current=list;setHdRaw(list);};
 // Source time of the playhead: the player shows either the light copy or a full-quality part that starts at src.start.
 const cur=()=>{const v=video.current;return v?v.currentTime+(srcRef.current?.start||0):0;};
 const covering=(t:number)=>hdRef.current.filter(x=>t>=x.start+.05&&t<x.end-.4).sort((a,b)=>short(b)-short(a))[0]||null;
 /** Jump to source time t, on the sharpest copy that has it (switching files when needed). */
 function go(t:number,play?:boolean){const v=video.current;if(!v)return;const want=proxy?covering(t):null,now=srcRef.current,resume=play??!v.paused;
  if((want?.url||null)===(now?.url||null)){v.currentTime=Math.max(0,t-(now?.start||0));if(play)v.play().catch(()=>{});return;}
  pendingSeek.current={t,play:resume};srcRef.current=want;setSrc(want);}
 const {format,framing,texts}=look,[sw,sh]=size,out=OUTPUT[format],layout:Layout=(look.layouts[format]||defaultLayout(format,sw,sh)) as Layout,split=framing==='split';
 const setSegs=(next:Seg[])=>{setSegsRaw(next);saveDraft(job.id,next);};
 const setLook=(patch:Partial<Look>)=>setLookRaw(old=>{const next={...old,...patch};store.set(`openclip-cut-look-${job.id}`,next);return next;});
 const setLayout=(next:Layout)=>setLook({layouts:{...look.layouts,[format]:next}});
 const setTexts=(next:TextItem[])=>setLook({texts:next});
 useEffect(()=>{let live=true;call<Timeline>(`/api/jobs/${job.id}/timeline`).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setTimelineNote(/not ready/i.test((e as Error).message)?'Suggestions appear once the project has found its moments.':(e as Error).message);});return()=>{live=false;};},[job.id,job.status]);
 useEffect(()=>{call<{sections:HdSection[];sourceHeight:number|null}>(`/api/jobs/${job.id}/hd`).then(d=>{setHd(d.sections);setSourceSide(d.sourceHeight);}).catch(()=>{});},[job.id]);
 // Long streams: fetch full quality for every part (one at a time), so the preview is sharp where it matters.
 const partsKey=segs.map(x=>`${x.start}-${x.end}`).join();
 useEffect(()=>{if(!proxy||!segs.length)return;let stop=false;(async()=>{for(const [i,p] of segs.entries()){if(stop)return;const end=Math.min(p.end,p.start+600);if(hdRef.current.some(x=>x.start<=p.start+.05&&x.end>=end-.4))continue;
   setHdBusy(`Getting full quality for part ${i+1} of ${segs.length}…`);try{const r=await call<{sections:HdSection[]}>(`/api/jobs/${job.id}/hd`,{method:'POST',body:JSON.stringify({start:p.start,end})});if(!stop){setHd(r.sections);setHdNote('');}}catch(e){if(!stop)setHdNote(`Full quality for part ${i+1} didn’t download (${(e as Error).message}). The export will try again.`);}}
  if(!stop)setHdBusy('');})();return()=>{stop=true;};},[partsKey,proxy]);
 // Paused on the light copy for a moment: fetch full quality around the playhead (once per spot).
 const hdBusyRef=useRef('');hdBusyRef.current=hdBusy;const autoTimer=useRef(0),asked=useRef<number[]>([]);
 function maybeSharpen(){if(!proxy)return;window.clearTimeout(autoTimer.current);{const v=video.current;if(v&&v.paused&&!srcRef.current&&!pendingSeek.current&&covering(cur())){go(cur());return;}}autoTimer.current=window.setTimeout(()=>{const v=video.current;if(!v||!v.paused||hdBusyRef.current||pendingSeek.current)return;const at=cur();if(covering(at)){if(!srcRef.current)go(at);return;}if(asked.current.some(a=>Math.abs(a-at)<25))return;asked.current.push(at);sharpenHere();},1200);}
 useEffect(()=>()=>window.clearTimeout(autoTimer.current),[]);
 async function sharpenHere(){const t=cur();setHdBusy('Getting full quality around the playhead…');setHdNote('');try{const r=await call<{sections:HdSection[]}>(`/api/jobs/${job.id}/hd`,{method:'POST',body:JSON.stringify({start:Math.max(0,t-5),end:Math.min(duration,t+40)})});setHd(r.sections);go(t);}catch(e){setHdNote((e as Error).message);}finally{setHdBusy('');}}
 // Sharp preview canvas: as many pixels as the screen shows (up to the export size).
 useEffect(()=>{const c=canvas.current;if(!c)return;const ro=new ResizeObserver(()=>{const w=Math.min(OUTPUT[format].width,Math.round(c.clientWidth*(window.devicePixelRatio||1)));if(w>40)setCs(w);});ro.observe(c);return()=>ro.disconnect();},[format]);
 // Cuts render in the background: keep the project fresh until they finish (the live connection also pushes updates).
 const rendering=(job.cuts||[]).some(c=>c.status==='rendering');
 useEffect(()=>{if(!rendering)return;const timer=setInterval(()=>{call<Job>(`/api/jobs/${job.id}`).then(onChanged).catch(()=>{});},2000);return()=>clearInterval(timer);},[rendering,job.id]);
 // Keyboard: space plays, I marks the start, O adds the part from the mark to the playhead.
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(isTyping(e.target)||e.ctrlKey||e.metaKey||e.altKey||(e.target as HTMLElement)?.closest?.('.cut-box'))return;const v=video.current;if(!v)return;const k=e.key.toLowerCase();
  if(e.key===' '){e.preventDefault();if(v.paused)v.play().catch(()=>{});else v.pause();}else if(k==='i')setMarkIn(round(cur()));else if(k==='o')endHere();
  else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(Math.max(0,Math.min(duration,cur()+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1))));}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
 // Live preview: redraw every animation frame from the source video, with the text on top.
 const latest=useRef({framing,layout,texts,format});latest.current={framing,layout,texts,format};
 useEffect(()=>{let frame=0,lastBounds='';const draw=()=>{frame=requestAnimationFrame(draw);const c=canvas.current,v=video.current;if(!c||!v)return;const ctx=c.getContext('2d');if(!ctx)return;ctx.imageSmoothingQuality='high';const s=latest.current;
  drawFrame(ctx,v,c.width,c.height,s.framing,s.framing==='split'?s.layout:null);const b=drawTexts(ctx,s.texts,c.width,c.height),key=JSON.stringify(b);if(key!==lastBounds){lastBounds=key;setBounds(b as Record<string,Box>);}};
  frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);},[]);
 useEffect(()=>{loadFonts(texts).then(()=>setBounds(b=>({...b})));},[texts.map(t=>t.font).join()]);
 const [v0,v1]=view||[0,Math.max(1,duration)],span=Math.max(1,v1-v0),pct=(x:number)=>`${((x-v0)/span*100).toFixed(3)}%`,width=(a:number,b:number)=>`${(Math.max(0,Math.min(b,v1)-Math.max(a,v0))/span*100).toFixed(3)}%`;
 const visible=useMemo(()=>(data?.buckets||[]).filter(b=>b.t+(data?.bucket||5)>=v0&&b.t<=v1),[data,v0,v1]),maxLoud=useMemo(()=>Math.max(1.5,...(data?.buckets||[]).map(b=>b.loud)),[data]);
 const suggestions=useMemo(()=>[...(data?.candidates||[])].sort((a,b)=>b.score-a.score).slice(0,showAll?30:8),[data,showAll]);
 const total=segs.reduce((n,s)=>n+s.end-s.start,0),overlapping=segs.some((s,i)=>segs.some((o,k)=>k!==i&&s.start<o.end&&o.start<s.end));
 const seek=(x:number,play=false)=>{queue.current=null;go(Math.max(0,Math.min(duration,x)),play||undefined);};
 function add(seg:Seg){const s={start:round(Math.max(0,seg.start)),end:round(Math.min(duration,seg.end))};if(s.end-s.start<.5){setError('A part must be at least half a second long.');return;}setError('');setSegs([...segs,s]);}
 function endHere(){if(!video.current)return;const now=round(cur());if(markIn===null){setError('Press I (or Mark start) first, then O at the end of the part.');return;}add({start:Math.min(markIn,now),end:Math.max(markIn,now)});setMarkIn(null);}
 function playList(list:Seg[]){if(!video.current||!list.length)return;queue.current={list,i:0};go(list[0].start,true);}
 function onTime(){const v=video.current;if(!v||pendingSeek.current)return;const now=cur();setT(now);const q=queue.current,part=q?.list[q.i];
  if(q&&part&&now>=part.end-.03){q.i++;const next=q.list[q.i];if(next)go(next.start,true);else{v.pause();queue.current=null;}return;}
  // Leaving a full-quality part: carry on in the light copy (or the next part). Entering one while playing: switch up.
  const at=srcRef.current;if(at&&now>=at.end-.45)go(now);else if(!at&&proxy&&!v.paused&&covering(now+.3))go(now+.05,true);}
 const update=(i:number,patch:Partial<Seg>)=>setSegs(segs.map((s,k)=>k===i?{...s,...patch}:s));
 const move=(i:number,d:number)=>{const k=i+d;if(k<0||k>=segs.length)return;const next=[...segs];[next[i],next[k]]=[next[k],next[i]];setSegs(next);};
 const timeAt=(x:number)=>{const r=strip.current!.getBoundingClientRect();return Math.max(0,Math.min(duration,v0+(x-r.left)/r.width*span));};
 function down(e:React.PointerEvent){if((e.target as HTMLElement).closest('button'))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current=timeAt(e.clientX);setPick([drag.current,drag.current]);}
 function moveDrag(e:React.PointerEvent){if(drag.current===null)return;const x=timeAt(e.clientX);setPick([Math.min(drag.current,x),Math.max(drag.current,x)]);}
 function up(){if(drag.current===null)return;const p=pick;drag.current=null;setPick(null);if(!p)return;if(p[1]-p[0]<Math.max(.5,span/400))seek(p[0]);else add({start:p[0],end:p[1]});}
 const zoom=(f:number)=>{const c=video.current?cur():(v0+v1)/2,next=Math.max(10,Math.min(duration,span*f));if(next>=duration){setView(null);return;}const a=Math.max(0,Math.min(duration-next,c-next/2));setView([a,a+next]);};
 const ticks=useMemo(()=>Array.from({length:5},(_,k)=>v0+span*k/4),[v0,span]);
 // Shapes and layouts.
 const chooseFormat=(f:Format)=>{if(f===format)return;setLook({format:f,framing:framing==='split'?'split':f==='video'?'fit':'fill'});};
 const camRatio=shareRatio(pixelAspect(layout.camOut,out.width,out.height),sw,sh),gameRatio=shareRatio(pixelAspect(layout.gameOut,out.width,out.height),sw,sh);
 async function findCamera(){const at=cur(),range={start:Math.max(0,at-20),end:Math.min(duration,Math.max(at+20,Math.min(duration,40)))};setCamBusy(true);setCamNote('');setError('');
  try{const r=await call<{facecam:{found:boolean;box:Box|null;full:boolean;face:Box|null}}>(`/api/jobs/${job.id}/facecam`,{method:'POST',body:JSON.stringify({start:range.start,end:range.end})});
   if(r.facecam.found&&r.facecam.box){setLayout(withCamera(layout,r.facecam.box,format,sw,sh) as Layout);setCamNote('Found the camera. Drag the pink box to adjust.');}
   else if(r.facecam.face){const f=r.facecam.face,b:Box=[Math.max(0,f[0]-f[2]*.9),Math.max(0,f[1]-f[3]*.7),Math.min(1,f[2]*2.8),Math.min(1,f[3]*2.4)];setLayout({...layout,cam:refit(b,pixelAspect(layout.camOut,out.width,out.height),sw,sh) as Box,camHidden:false});setCamNote('No camera border found; boxed the streamer’s face instead.');}
   else setCamNote(r.facecam.full?'The camera fills the whole video here, so there is no separate camera to box.':`No camera found around ${clock(at)}. Move to a moment where the camera shows and try again, or drag the pink box onto it.`);}
  catch(e){setError((e as Error).message);}finally{setCamBusy(false);}}
 // Text.
 const chosen=texts.find(x=>x.id===selected)||null;
 const editText=(id:string,patch:Partial<TextItem>)=>setTexts(texts.map(x=>x.id===id?{...x,...patch}:x));
 function addText(){const t=newText(texts.length);setTexts([...texts,t]);setSelected(t.id);}
 // Export.
 async function exportCut(){askTip();setSending(true);setError('');try{const overlay=await textLayer(texts,exportSize.width,exportSize.height);
  await call<Cut>(`/api/jobs/${job.id}/cuts`,{method:'POST',body:JSON.stringify({segments:segs,format,quality,framing,title,layout:split?layout:undefined,overlay:overlay||undefined,texts})});onChanged(await call<Job>(`/api/jobs/${job.id}`));}
  catch(e){setError((e as Error).message);}finally{setSending(false);}}
 async function cancelCut(c:Cut){try{await call(`/api/jobs/${job.id}/cuts/${c.id}/cancel`,{method:'POST'});}catch(e){setError((e as Error).message);}}
 async function removeCut(c:Cut){try{onChanged(await call<Job>(`/api/jobs/${job.id}/cuts/${c.id}`,{method:'DELETE'}));}catch(e){setError((e as Error).message);}}
 function loadCut(c:Cut){setSegs(c.segments);setTitle(c.title);if(c.quality===720||c.quality===1080||c.quality===1440)setQuality(c.quality);const f=c.format==='video'?'video':'shorts';setLook({format:f,framing:c.framing,texts:Array.isArray(c.texts)?c.texts as TextItem[]:[],layouts:{...look.layouts,...(c.layout&&sameShapeLayout(c.layout)?{[f]:c.layout}:{})}});}
 const locked=busy(job),aspect=sw/sh,k=quality/1080,exportSize={width:Math.round(out.width*k/2)*2,height:Math.round(out.height*k/2)*2},upscaled=!!sourceSide&&quality>sourceSide+8;
 const framings:[Framing,string,string,React.ReactNode][]=format==='video'?[['fit','Whole picture','The full frame, over a blurred copy if it doesn’t fit',<Maximize size={17}/>],['split','Camera + gameplay','Box the camera and the gameplay, place each one',<LayoutPanelTop size={17}/>]]:[['fill','Fill','Crops the sides so the picture fills the phone',<Maximize size={17}/>],['fit','Whole picture','Keeps everything, over a blurred copy',<Columns2 size={17}/>],['split','Camera + gameplay','Box the camera and the gameplay, place each one',<LayoutPanelTop size={17}/>]];

 return <section className="cutter" aria-labelledby="cutter-title">
  <div className="cutter-head"><div><h1 id="cutter-title"><ScissorsLineDashed size={26}/>Video cutter</h1><p className="muted">Pick the parts you want, box the camera and the gameplay, add text, and get one video back.</p></div>
   <label className="cutter-project"><span className="field-label">Project</span><select aria-label="Project to cut" value={job.id} onChange={e=>onPick(e.target.value)}>{jobs.map(j=><option key={j.id} value={j.id}>{j.title||'Untitled video'} · {clock(j.metadata?.duration||0)}</option>)}</select></label></div>
  {locked&&<p className="cutter-warning" role="status"><Loader2 className="spin" size={16}/>This project is still processing ({job.stage}). You can mark parts now; exporting unlocks when it finishes.</p>}
  {job.remote?.proxy&&<p className="cutter-note">You're previewing the light 360p copy of this long stream. The export downloads each part in full quality.</p>}
  <div className="cutter-grid">
   <div className="cutter-player">
    <div className="cutter-video" style={{aspectRatio:String(aspect),width:`min(100%, calc(62vh * ${aspect.toFixed(4)}))`}}>
     <video ref={video} src={src?.url||job.sourceUrl} preload="auto" playsInline onLoadedMetadata={e=>{const v=e.currentTarget;if(v.videoWidth&&v.videoHeight)setSize([v.videoWidth,v.videoHeight]);const p=pendingSeek.current;if(p){pendingSeek.current=null;v.currentTime=Math.max(0,p.t-(srcRef.current?.start||0));if(p.play)v.play().catch(()=>{});}}} onTimeUpdate={onTime} onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);maybeSharpen();}} onSeeked={maybeSharpen} onCanPlay={maybeSharpen} onClick={e=>{const v=e.currentTarget;if(v.paused)v.play().catch(()=>{});else v.pause();}}/>
     <span className={`cut-quality-badge ${src||!proxy?'hd':''}`}>{src?`Full quality · ${short(src)}p`:proxy?`Light copy · ${short({width:size[0],height:size[1]})}p`:`${short({width:size[0],height:size[1]})}p`}</span>
     {split&&<div className="cut-box-layer">
      <CutBox box={layout.game} tone="game" label="Gameplay" ratio={gameRatio} lines={[0,.5,1]} selected={selected==='game'} onSelect={()=>setSelected('game')} onChange={b=>setLayout({...layout,game:b})}/>
      {!layout.camHidden&&<CutBox box={layout.cam} tone="cam" label="Camera" ratio={camRatio} lines={[0,.5,1]} selected={selected==='cam'} onSelect={()=>setSelected('cam')} onChange={b=>setLayout({...layout,cam:b})}/>}
     </div>}
    </div>
    {split&&<p className="cutter-hint"><span className="swatch cam"/>Pink is the camera, <span className="swatch game"/>green is the gameplay. Drag a box to move it, drag a corner to resize. Each box keeps the shape of its panel in the preview.</p>}
    <div className="cutter-controls">
     <button type="button" className="secondary" onClick={()=>{const v=video.current;if(!v)return;queue.current=null;if(v.paused)v.play().catch(()=>{});else v.pause();}}>{playing?<Pause size={16}/>:<Play size={16}/>}{playing?'Pause':'Play'}</button>
     <span className="cutter-clock" aria-live="off">{clock(t)} / {clock(duration)}</span>
     <button type="button" className="secondary" title="Shortcut: I" onClick={()=>setMarkIn(round(cur()))}>Mark start (I)</button>
     <button type="button" className="primary" title="Shortcut: O" disabled={markIn===null} onClick={endHere}><Plus size={16}/>Add part to here (O)</button>
     {markIn!==null&&<span className="cutter-mark">Start marked at {clock(markIn)}<button type="button" className="text-button" aria-label="Clear the start mark" onClick={()=>setMarkIn(null)}><X size={14}/></button></span>}
    </div>
    {proxy&&<div className="cutter-hd">{hdBusy?<span><Loader2 className="spin" size={14}/>{hdBusy}</span>:<span>{hd.length?`Full quality is ready for ${hd.length} stretch${hd.length===1?'':'es'} of the stream; the preview switches to it there.`:'Pause anywhere (or add a part) and full quality downloads there for a sharp preview.'}</span>}<button type="button" className="text-button" disabled={!!hdBusy} onClick={sharpenHere}>Sharpen here</button>{hdNote&&<small className="trim-warning">{hdNote}</small>}</div>}
    <div className="cutter-timeline">
     <div className="cutter-zoom"><span className="muted">Drag across the strip to add a part · click to jump · taller bars are louder</span><span><button type="button" className="text-button" onClick={()=>zoom(.25)}><ZoomIn size={15}/>Zoom in</button><button type="button" className="text-button" disabled={!view} onClick={()=>zoom(4)}><ZoomOut size={15}/>Zoom out</button>{view&&<button type="button" className="text-button" onClick={()=>setView(null)}>Whole video</button>}</span></div>
     <div ref={strip} className="timeline-strip cutter-strip" role="presentation" onPointerDown={down} onPointerMove={moveDrag} onPointerUp={up}>
      {visible.map(b=><span key={b.t} className={`timeline-bar ${b.laugh?'laugh':b.hype||b.cue?'hype':''}`} style={{left:pct(b.t),width:width(b.t,b.t+(data?.bucket||5)),height:`${Math.max(6,Math.min(100,b.loud/maxLoud*100)).toFixed(1)}%`}}/>)}
      {suggestions.filter(c=>c.end>v0&&c.start<v1).map((c,i)=><button type="button" key={'s'+i} className="cut-suggestion" style={{left:pct(Math.max(v0,c.start)),width:width(c.start,c.end)}} title={`Suggested · ${clock(c.start)}–${clock(c.end)} · ${c.title}`} onClick={()=>seek(c.start,true)}/>)}
      {segs.map((s,i)=>s.end>v0&&s.start<v1&&<button type="button" key={'p'+i} className={`cut-part ${overlapping?'warn':''}`} style={{left:pct(Math.max(v0,s.start)),width:width(s.start,s.end)}} title={`Part ${i+1} · ${clock(s.start)}–${clock(s.end)}`} onClick={()=>playList([s])}>{i+1}</button>)}
      {pick&&<span className="timeline-pick" style={{left:pct(pick[0]),width:width(pick[0],pick[1])}}/>}
      {markIn!==null&&markIn>=v0&&markIn<=v1&&<span className="cut-markline" style={{left:pct(markIn)}}/>}
      {t>=v0&&t<=v1&&<span className="cut-playhead" style={{left:pct(t)}}/>}
     </div>
     <div className="timeline-ticks">{ticks.map((x,i)=><span key={i} style={{left:`${i*25}%`}}>{clock(x)}</span>)}</div>
     <p className="cutter-legend"><i className="lg-part"/>Your parts <i className="lg-suggest"/>Suggested moments</p>
    </div>
   </div>
   <aside className="cutter-side">
    <section className="cutter-panel" aria-labelledby="look-title"><div className="cutter-panel-head"><h2 id="look-title">Preview</h2><span className="cutter-total">{format==='video'?'16:9 · 1920 × 1080':'9:16 · 1080 × 1920'}</span></div>
     <div className="cut-shape-tabs" role="radiogroup" aria-label="Video shape">{([['shorts','Portrait 9:16',<RectangleVertical key="v" size={17}/>],['video','Landscape 16:9',<RectangleHorizontal key="h" size={17}/>]] as const).map(([f,name,icon])=><button type="button" role="radio" key={f} aria-checked={format===f} className={format===f?'selected':''} onClick={()=>chooseFormat(f)}>{icon}{name}</button>)}</div>
     <div className={`cut-preview ${format}`} style={{maxWidth:format==='video'?'100%':'300px'}}>
      <canvas ref={canvas} width={cs} height={Math.round(cs*out.height/out.width)} aria-label="Preview of the exported video"/>
      <div className="cut-box-layer" onPointerDown={()=>setSelected(null)}>
       {split&&<CutBox box={layout.gameOut} tone="game" label="Gameplay panel" lines={[0,.5,1,...(layout.camHidden?[]:[layout.camOut[1],layout.camOut[1]+layout.camOut[3],layout.camOut[0],layout.camOut[0]+layout.camOut[2]])]} selected={selected==='gameOut'} onSelect={()=>setSelected('gameOut')} onChange={b=>setLayout(withPanel(layout,'game',b,format,sw,sh) as Layout)}/>}
       {split&&!layout.camHidden&&<CutBox box={layout.camOut} tone="cam" label="Camera panel" lines={[0,.5,1,layout.gameOut[1],layout.gameOut[1]+layout.gameOut[3],layout.gameOut[0],layout.gameOut[0]+layout.gameOut[2]]} selected={selected==='camOut'} onSelect={()=>setSelected('camOut')} onChange={b=>setLayout(withPanel(layout,'cam',b,format,sw,sh) as Layout)}/>}
       {texts.filter(x=>bounds[x.id]).map(x=>{const b=bounds[x.id];return <CutBox key={x.id} box={b} tone="text" label={`Text: ${x.text.slice(0,24)}`} resizable={false} lines={[.5]} selected={selected===x.id} onSelect={()=>setSelected(x.id)} onChange={nb=>editText(x.id,{x:+(nb[0]+nb[2]/2).toFixed(4),y:+(nb[1]+nb[3]/2).toFixed(4)})}/>;})}
      </div>
     </div>
     <p className="cutter-hint">{split?'Drag the panels to place the camera and gameplay; drag a corner to resize. Drag text to move it.':'Drag text to move it. Choose Camera + gameplay to box and place the camera.'}</p>
     <div className="cut-shapes" role="radiogroup" aria-label="Framing">{framings.map(([id,name,about,icon])=><button type="button" role="radio" key={id} aria-checked={framing===id} className={framing===id?'selected':''} onClick={()=>setLook({framing:id})}>{icon}<span><strong>{name}</strong><small>{about}</small></span>{framing===id&&<Check size={15}/>}</button>)}</div>
     {split&&<div className="cut-layout-tools">
      <div className="cut-presets" role="group" aria-label="Layout presets">{PRESETS[format].map(p=><button type="button" key={p.id} className="chip" onClick={()=>setLayout(applyPreset(layout,p,format,sw,sh) as Layout)}>{p.name}</button>)}<button type="button" className="chip" onClick={()=>setLayout(defaultLayout(format,sw,sh) as Layout)}>Reset</button></div>
      <div className="cut-layout-row"><button type="button" className="secondary" disabled={camBusy} title="Looks for the streamer’s camera around the playhead" onClick={findCamera}>{camBusy?<Loader2 className="spin" size={15}/>:<ScanFace size={15}/>}Find the camera here</button>
       <label className="check-option"><input type="checkbox" checked={!layout.camHidden} onChange={e=>setLayout({...layout,camHidden:!e.target.checked})}/>Show camera</label>
       <label className="check-option"><input type="checkbox" checked={layout.camOnTop} disabled={layout.camHidden} onChange={e=>setLayout({...layout,camOnTop:e.target.checked})}/>Camera in front</label></div>
      {camNote&&<p className="cutter-note" role="status">{camNote}</p>}
     </div>}
     <div className="cut-texts"><div className="cutter-panel-head"><h3><Type size={17}/>Text</h3><button type="button" className="secondary" disabled={texts.length>=8} onClick={addText}><Plus size={15}/>Add text</button></div>
      {!texts.length?<p className="muted">Add a caption, title or @handle. It stays on screen for the whole video.</p>:<div className="cut-text-chips">{texts.map((x,i)=><button type="button" key={x.id} className={`chip ${selected===x.id?'selected':''}`} onClick={()=>setSelected(x.id)}>{x.text.trim().slice(0,18)||`Text ${i+1}`}</button>)}</div>}
      {chosen&&<div className="cut-text-edit">
       <label><span className="field-label">Text</span><textarea aria-label="Caption text" rows={2} maxLength={200} value={chosen.text} onChange={e=>editText(chosen.id,{text:e.target.value})}/></label>
       <div className="cut-text-grid">
        <label><span className="field-label">Font</span><select aria-label="Caption font" value={chosen.font} onChange={e=>editText(chosen.id,{font:e.target.value})} style={{fontFamily:`"${TEXT_FONTS.find(f=>f.id===chosen.font)?.family}"`}}>{TEXT_FONTS.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label><span className="field-label">Style</span><select aria-label="Caption style" value={chosen.style} onChange={e=>editText(chosen.id,{style:e.target.value as TextItem['style']})}><option value="outline">Black outline</option><option value="box">Box behind</option><option value="plain">Soft shadow</option></select></label>
        <label><span className="field-label">Size · {Math.round(chosen.size*100)}</span><input aria-label="Caption size" type="range" min="2" max="20" step=".5" value={chosen.size*100} onChange={e=>editText(chosen.id,{size:e.target.valueAsNumber/100})}/></label>
        <label className="color-field"><span className="field-label">Color</span><input aria-label="Caption color" type="color" value={chosen.color} onChange={e=>editText(chosen.id,{color:e.target.value})}/></label>
        {chosen.style==='box'&&<label className="color-field"><span className="field-label">Box</span><input aria-label="Caption box color" type="color" value={chosen.boxColor} onChange={e=>editText(chosen.id,{boxColor:e.target.value})}/></label>}
       </div>
       <div className="cut-layout-row"><label className="check-option"><input type="checkbox" checked={chosen.upper} onChange={e=>editText(chosen.id,{upper:e.target.checked})}/>ALL CAPS</label><button type="button" className="text-button" onClick={()=>editText(chosen.id,{x:.5})}>Center</button><button type="button" className="text-button danger-text" onClick={()=>{setTexts(texts.filter(x=>x.id!==chosen.id));setSelected(null);}}><Trash2 size={14}/>Remove</button></div>
      </div>}
     </div>
    </section>
    <section className="cutter-panel" aria-labelledby="export-title"><h2 id="export-title">Export</h2>
     <div className="cut-quality" role="radiogroup" aria-label="Export quality">{QUALITIES.map(([q,name])=><button type="button" role="radio" key={q} aria-checked={quality===q} className={`chip ${quality===q?'selected':''}`} onClick={()=>setQuality(q)}>{name}</button>)}</div>
     <p className="cutter-hint">{exportSize.width} × {exportSize.height}{quality===1440?' · the sharpest. Uses 1440p from the stream when the platform serves it (Twitch can; YouTube parts come in 1080p and are scaled up)':quality===720?' · smallest file, fastest export':' · the usual for Shorts and YouTube'}.</p>
     {upscaled&&<p className="cutter-note">This video is {sourceSide}p at most, so {quality}p is scaled up from it: a bigger file, but no extra detail.</p>}
     <label><span className="field-label">Name (optional)</span><input aria-label="Cut name" maxLength={80} value={title} placeholder={`Cut of ${job.title||'this video'}`.slice(0,80)} onChange={e=>setTitle(e.target.value)}/></label>
     {format==='shorts'&&total>60&&<p className="cutter-note">This runs over a minute. YouTube allows Shorts up to 3 minutes, but blocks any Short over 1 minute that gets a copyright claim.</p>}
     {error&&<p className="trim-warning" role="alert"><CircleAlert size={15}/>{error}</p>}
     <button type="button" className="primary cut-export" disabled={!segs.length||sending||locked||rendering} onClick={exportCut}>{sending?<Loader2 className="spin" size={17}/>:<ScissorsLineDashed size={17}/>}{rendering?'A cut is rendering…':!segs.length?'Add a part to export':`Export ${segs.length} part${segs.length===1?'':'s'} · ${clock(total)}`}</button>
    </section>
   </aside>
  </div>
  <section className="cutter-panel" aria-labelledby="parts-title"><div className="cutter-panel-head"><h2 id="parts-title">Your parts</h2>{segs.length>0&&<span className="cutter-total">{segs.length} part{segs.length===1?'':'s'} · {clock(total)}</span>}</div>
   {!segs.length?<p className="muted">No parts yet. Drag across the timeline, press I and O while the video plays, or add a suggestion below.</p>:<ol className="cut-parts">{segs.map((s,i)=><li key={i}><b>{i+1}</b><TimeField label={`Part ${i+1} start`} value={s.start} max={duration} onChange={v=>update(i,{start:Math.min(v,s.end-.5)})}/><span className="cut-arrow">→</span><TimeField label={`Part ${i+1} end`} value={s.end} max={duration} onChange={v=>update(i,{end:Math.max(v,s.start+.5)})}/><small>{(s.end-s.start).toFixed(1)} s</small>
    <span className="cut-row-actions"><button type="button" aria-label={`Play part ${i+1}`} onClick={()=>playList([s])}><Play size={14}/></button><button type="button" aria-label={`Move part ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp size={14}/></button><button type="button" aria-label={`Move part ${i+1} down`} disabled={i===segs.length-1} onClick={()=>move(i,1)}><ArrowDown size={14}/></button><button type="button" aria-label={`Remove part ${i+1}`} onClick={()=>setSegs(segs.filter((_,k)=>k!==i))}><Trash2 size={14}/></button></span></li>)}</ol>}
   {segs.length>0&&<div className="cut-parts-actions"><button type="button" className="secondary" onClick={()=>playList(segs)}><Play size={15}/>Watch the whole cut</button><button type="button" className="text-button" onClick={()=>setSegs([...segs].sort((a,b)=>a.start-b.start))}>Sort by time</button><button type="button" className="text-button" onClick={()=>{setSegs([]);setMarkIn(null);}}>Clear all</button></div>}
   {overlapping&&<p className="cutter-warning">Some parts overlap, so that footage plays twice. That's fine if you meant it.</p>}
  </section>
  <section className="cutter-panel" aria-labelledby="suggest-title"><div className="cutter-panel-head"><h2 id="suggest-title"><Sparkles size={18}/>Suggested moments</h2>{(data?.candidates.length||0)>8&&<button type="button" className="text-button" onClick={()=>setShowAll(!showAll)}>{showAll?'Show fewer':`Show all ${data!.candidates.length}`}</button>}</div>
   {!data?<p className="muted">{timelineNote||<><Loader2 className="spin" size={15}/> Finding the loud and busy parts…</>}</p>:!suggestions.length?<p className="muted">No suggestions for this video.</p>:
   <ul className="timeline-candidates">{suggestions.map((c,i)=><li key={i}><button type="button" className="candidate-time" onClick={()=>seek(c.start,true)}>{clock(c.start)}</button><span className="candidate-kind">{Math.round(c.end-c.start)} s</span><span className="candidate-title">{c.title}{c.reasons?.[0]&&<small className="cut-reason"> · {c.reasons[0]}</small>}</span><span className="candidate-score">{c.score}</span><button type="button" className="secondary" onClick={()=>add(c)}><Plus size={14}/>Add</button></li>)}</ul>}
   {!!data?.clips.length&&<button type="button" className="text-button" onClick={()=>setSegs([...segs,...data.clips.filter(c=>c.kept).map(c=>({start:round(c.start),end:round(c.end)}))])}><Plus size={14}/>Add this project's {data.clips.filter(c=>c.kept).length} kept clips as parts</button>}
  </section>
  {!!job.cuts?.length&&<section className="cutter-panel" aria-labelledby="cuts-title"><h2 id="cuts-title">Your cuts</h2><ul className="cut-list">{job.cuts.map(c=><li key={c.id} className={`cut-item ${c.status}`}>
   {c.status==='done'?<video controls preload="none" src={`/api/jobs/${job.id}/cuts/${c.id}?v=${encodeURIComponent(c.finishedAt||'')}`} className={c.format==='video'?'wide':'tall'}/>:<div className={`cut-thumb ${c.format==='video'?'wide':'tall'}`}>{c.status==='rendering'?<Loader2 className="spin" size={26}/>:<CircleAlert size={26}/>}</div>}
   <div className="cut-info"><strong>{c.title}</strong><small>{c.quality||1080}p · {c.format==='video'?'Landscape 16:9':'Portrait 9:16'} · {c.framing==='split'?'camera + gameplay':c.framing==='fit'?'whole picture':'fill'}{c.texts?.length?` · ${c.texts.length} text${c.texts.length===1?'':'s'}`:''} · {c.segments.length} part{c.segments.length===1?'':'s'} · {clock(c.duration||c.length)}{c.bytes?` · ${mb(c.bytes)}`:''}</small>
    {c.status==='rendering'&&<><div className="progress-track"><i style={{width:`${Math.max(2,c.progress*100)}%`}}/></div><button type="button" className="text-button" onClick={()=>cancelCut(c)}>Cancel</button></>}
    {c.status==='failed'&&<p className="trim-warning">{c.error||'The cut failed.'}</p>}
    {c.status==='done'&&!!c.sourceSide&&(c.quality||1080)>c.sourceSide+8&&<p className="cutter-note">Scaled up: this part of the stream was only {c.sourceSide}p.</p>}
    {c.preview&&<p className="cutter-note">Some parts came from the light copy (lower quality) because the full-quality download failed{c.previewReason?`: ${c.previewReason}`:''}. Export again to retry.</p>}
    <span className="cut-item-actions">{c.status==='done'&&<a className="secondary" href={`/api/jobs/${job.id}/cuts/${c.id}?download=1`}><Download size={15}/>Download</a>}{c.status!=='rendering'&&<><button type="button" className="text-button" onClick={()=>loadCut(c)}>Edit again</button><button type="button" className="text-button danger-text" onClick={()=>removeCut(c)}><Trash2 size={14}/>Delete</button></>}</span></div></li>)}</ul></section>}
 </section>;
}

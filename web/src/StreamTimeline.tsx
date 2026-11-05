import {useEffect,useMemo,useRef,useState} from 'react';
import {Loader2,Plus,Shuffle,ZoomIn,ZoomOut,Laugh,Flame,Scissors} from 'lucide-react';
import type {Job,Clip} from './types';
import './moments.css';

type Bucket={t:number;loud:number;peak:number;laugh:number;hype:number;cue:number;words:number};
type Candidate={start:number;end:number;score:number;category:'funny'|'highlight'|'clippable';title:string;hook?:string;used:boolean};
type Timeline={duration:number;bucket:number;buckets:Bucket[];candidates:Candidate[];clips:{id:string;start:number;end:number;title:string;kept:boolean}[]};

async function call<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{...init,headers:{'Content-Type':'application/json',...init?.headers}});const type=r.headers.get('content-type')||'';if(!type.includes('json'))throw new Error('The server is running old code. Restart it (Ctrl+C, then npm start).');const body=await r.json();if(!r.ok)throw new Error(body.error||'Request failed');return body as T;}
const clock=(t:number)=>{const s=Math.max(0,Math.round(t)),h=Math.floor(s/3600),m=Math.floor(s/60)%60,ss=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${ss}`:`${m}:${ss}`;};
const KIND={funny:'Funny',highlight:'Hype',clippable:'Clip that'} as const;

/** Whole-stream heat strip: see where the reactions are, open existing clips, add any 20–90 s range (up to a minute once pauses are trimmed) as a new clip. */
export default function StreamTimeline({job,onAdded,onOpenClip}:{job:Job;onAdded:(job:Job,clip:Clip)=>void;onOpenClip:(clipId:string)=>void}){
 const [data,setData]=useState<Timeline|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[view,setView]=useState<[number,number]|null>(null),[pick,setPick]=useState<[number,number]|null>(null),[showUsed,setShowUsed]=useState(false);
 const strip=useRef<HTMLDivElement>(null),drag=useRef<number|null>(null);
 const clipKey=job.clips.map(c=>`${c.id}:${c.start}:${c.end}`).join('|');
 useEffect(()=>{let live=true;setError('');call<Timeline>(`/api/jobs/${job.id}/timeline`).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError((e as Error).message);});return ()=>{live=false;};},[job.id,clipKey]);
 const duration=data?.duration||job.metadata?.duration||1,[v0,v1]=view||[0,duration],span=Math.max(1,v1-v0);
 const pct=(t:number)=>`${((t-v0)/span*100).toFixed(3)}%`,width=(a:number,b:number)=>`${(Math.max(0,Math.min(b,v1)-Math.max(a,v0))/span*100).toFixed(3)}%`;
 const visible=useMemo(()=>(data?.buckets||[]).filter(b=>b.t+(data?.bucket||5)>=v0&&b.t<=v1),[data,v0,v1]);
 const maxLoud=useMemo(()=>Math.max(1.5,...(data?.buckets||[]).map(b=>b.loud)),[data]);
 const timeAt=(clientX:number)=>{const r=strip.current!.getBoundingClientRect();return Math.max(0,Math.min(duration,v0+(clientX-r.left)/r.width*span));};
 const least=Math.min(20,job.moments?.[String(job.options?.editTemplate)]?.min??20),length=pick?pick[1]-pick[0]:0,valid=length>=least&&length<=90;
 function down(e:React.PointerEvent){if((e.target as HTMLElement).closest('.timeline-clip'))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current=timeAt(e.clientX);setPick([drag.current,drag.current]);}
 function move(e:React.PointerEvent){if(drag.current===null)return;const t=timeAt(e.clientX),a=Math.min(drag.current,t),b=Math.max(drag.current,t);setPick([a,Math.min(b,a+90)]);}
 function up(){if(drag.current===null)return;drag.current=null;setPick(p=>p&&p[1]-p[0]<1?[p[0],Math.min(duration,p[0]+30)]:p);}
 const nudge=(k:0|1,d:number)=>setPick(p=>{if(!p)return p;const n:[number,number]=[...p];n[k]=Math.max(0,Math.min(duration,n[k]+d));return n[0]<n[1]?n:p;});
 async function add(range:[number,number],label:string){setBusy(label);setError('');try{const r=await call<{clip:Clip;job:Job}>(`/api/jobs/${job.id}/clips`,{method:'POST',body:JSON.stringify({start:+range[0].toFixed(2),end:+range[1].toFixed(2)})});setPick(null);onAdded(r.job,r.clip);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 const candidates=(data?.candidates||[]).filter(c=>showUsed||!c.used).sort((a,b)=>Number(a.used)-Number(b.used)||b.score-a.score);
 if(!data&&!error)return <section className="stream-timeline"><p className="muted"><Loader2 className="spin" size={16}/> Mapping the stream…</p></section>;
 return <section className="stream-timeline" aria-labelledby="timeline-title">
  <div className="timeline-head"><div><h2 id="timeline-title">The whole stream</h2><p className="muted">Taller bars are louder. Drag across the strip to pick any moment, or add one of the suggestions below. Click a clip to edit it.</p></div>
   <div className="timeline-zoom">{pick&&<button type="button" className="text-button" onClick={()=>setView([Math.max(0,pick[0]-90),Math.min(duration,pick[1]+90)])}><ZoomIn size={15}/>Zoom to pick</button>}{view&&<button type="button" className="text-button" onClick={()=>setView(null)}><ZoomOut size={15}/>Whole stream</button>}</div></div>
  {error&&<p role="alert" className="trim-warning">{error}</p>}
  {data&&<><div ref={strip} className="timeline-strip" onPointerDown={down} onPointerMove={move} onPointerUp={up} role="presentation">
   {visible.map(b=><span key={b.t} className={`timeline-bar ${b.laugh?'laugh':b.hype||b.cue?'hype':''}`} style={{left:pct(b.t),width:width(b.t,b.t+data.bucket),height:`${Math.max(6,Math.min(100,b.loud/maxLoud*100)).toFixed(1)}%`}}/>)}
   {visible.filter(b=>b.laugh||b.hype||b.cue).map(b=><span key={'m'+b.t} className={`timeline-mark ${b.laugh?'laugh':'hype'}`} style={{left:pct(b.t+data.bucket/2)}} title={`${clock(b.t)} · ${[b.laugh&&`${b.laugh} laugh`,b.hype&&`${b.hype} hype`,b.cue&&'“clip that”'].filter(Boolean).join(' · ')}`}/>)}
   {data.clips.filter(c=>c.end>v0&&c.start<v1).map(c=><button type="button" key={c.id} className={`timeline-clip ${c.kept?'':'discarded'}`} style={{left:pct(Math.max(v0,c.start)),width:width(c.start,c.end)}} title={`${clock(c.start)} · ${c.title}`} aria-label={`Edit clip: ${c.title}`} onClick={()=>onOpenClip(c.id)}/>)}
   {pick&&<span className={`timeline-pick ${valid?'':'invalid'}`} style={{left:pct(Math.max(v0,pick[0])),width:width(pick[0],pick[1])}}/>}
  </div>
  <div className="timeline-ticks" aria-hidden="true">{[0,.25,.5,.75,1].map(f=><span key={f} style={{left:`${f*100}%`}}>{clock(v0+f*span)}</span>)}</div>
  {pick&&<div className="timeline-pickbar"><span><Scissors size={15}/><strong>{clock(pick[0])} – {clock(pick[1])}</strong> · {Math.round(length)} s{!valid&&<em> · pick {least}–90 seconds</em>}</span>
   <span className="timeline-nudge">Start <button type="button" onClick={()=>nudge(0,-1)} aria-label="Start 1 second earlier">−1s</button><button type="button" onClick={()=>nudge(0,1)} aria-label="Start 1 second later">+1s</button> End <button type="button" onClick={()=>nudge(1,-1)} aria-label="End 1 second earlier">−1s</button><button type="button" onClick={()=>nudge(1,1)} aria-label="End 1 second later">+1s</button></span>
   <button type="button" className="primary" disabled={!valid||!!busy} onClick={()=>add(pick,'pick')}>{busy==='pick'?<Loader2 className="spin" size={16}/>:<Plus size={16}/>}Add clip</button><button type="button" className="text-button" onClick={()=>setPick(null)}>Clear</button></div>}
  <div className="timeline-candidates-head"><h3>More moments worth a look</h3><label className="check-option"><input type="checkbox" checked={showUsed} onChange={e=>setShowUsed(e.target.checked)}/>Show ones already clipped</label></div>
  {!candidates.length?<p className="muted">Every strong moment the app found is already a clip.</p>:<ul className="timeline-candidates">{candidates.slice(0,12).map(c=><li key={c.start} className={c.used?'used':''}>
   <button type="button" className="candidate-time" onClick={()=>{setPick([c.start,c.end]);setView([Math.max(0,c.start-90),Math.min(duration,c.end+90)]);}} title="Show on the strip">{clock(c.start)}</button>
   <span className={`candidate-kind ${c.category}`}>{c.category==='funny'?<Laugh size={13}/>:<Flame size={13}/>}{KIND[c.category]}</span><span className="candidate-title">{c.title}</span><span className="candidate-score">{c.score}</span>
   <button type="button" className="secondary" disabled={c.used||!!busy} onClick={()=>add([c.start,c.end],String(c.start))}>{busy===String(c.start)?<Loader2 className="spin" size={15}/>:<Plus size={15}/>}{c.used?'Clipped':'Add'}</button></li>)}</ul>}
  </>}
 </section>;
}

/** Replace a weak clip with the best moment that isn't clipped yet. */
export function SwapButton({job,clip,onSwapped}:{job:Job;clip:Clip;onSwapped:(job:Job,clip:Clip)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function swap(){setBusy(true);setError('');try{const r=await call<{clip:Clip;job:Job}>(`/api/jobs/${job.id}/clips/${clip.id}/swap`,{method:'POST',body:'{}'});onSwapped(r.job,r.clip);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <span className="swap-button"><button type="button" className="text-button" disabled={busy} onClick={swap} title="Replace this clip with the best moment that isn't clipped yet">{busy?<Loader2 className="spin" size={15}/>:<Shuffle size={15}/>}Swap for another moment</button>{error&&<small role="alert" className="trim-warning">{error}</small>}</span>;
}

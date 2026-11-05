import {useRef,useState} from 'react';import {ImagePlus,Loader2,Trash2} from 'lucide-react';import './publishing.css';
// Custom thumbnail for a main-video post: scrub to a frame, add big text, render it on the server.
type ThumbPost={id:string;format:string;locked:boolean;thumbnail?:{time:number;text:string;updatedAt:string};thumbnailError?:string};
async function call(url:string,init?:RequestInit){const r=await fetch(url,{...init,headers:{'Content-Type':'application/json'}});const data=r.headers.get('content-type')?.includes('json')?await r.json():{};if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data;}
export function ThumbnailPicker({post,onSaved}:{post:ThumbPost;onSaved:()=>void|Promise<void>}){
 const video=useRef<HTMLVideoElement>(null),[time,setTime]=useState(post.thumbnail?.time||0),[text,setText]=useState(post.thumbnail?.text||''),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const [version,setVersion]=useState(post.thumbnail?.updatedAt||'');
 if(post.format!=='video')return <div className="thumb-picker thumb-note"><strong>Thumbnail</strong><p className="muted">For Shorts, YouTube only lets you pick the thumbnail frame in the YouTube mobile app after upload.</p></div>;
 async function save(){setBusy('save');setError('');try{const p=await call(`/api/posting/${post.id}/thumbnail`,{method:'POST',body:JSON.stringify({time:Number(time.toFixed(2)),text:text.trim()})});setVersion(p.thumbnail?.updatedAt||String(Date.now()));await onSaved();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 async function remove(){setBusy('remove');setError('');try{await call(`/api/posting/${post.id}/thumbnail`,{method:'DELETE'});setVersion('');await onSaved();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 return <div className="thumb-picker"><div className="thumb-head"><strong>Thumbnail</strong><small className="muted">1280×720 · uploaded after the video</small></div>
  <div className="thumb-grid"><div className="thumb-frame"><video ref={video} muted preload="metadata" src={`/api/posting/${post.id}/video`} onLoadedMetadata={e=>{e.currentTarget.currentTime=time;}} onSeeked={e=>setTime(e.currentTarget.currentTime)}/>{text.trim()&&<span className="thumb-overlay">{text.trim()}</span>}</div>
   <div className="thumb-current">{version?<><img alt="Current custom thumbnail" src={`/api/posting/${post.id}/thumbnail?v=${encodeURIComponent(version)}`}/><button type="button" className="text-button" disabled={!!busy||post.locked} onClick={remove}>{busy==='remove'?<Loader2 className="spin" size={14}/>:<Trash2 size={14}/>}Use YouTube’s pick instead</button></>:<p className="muted">No custom thumbnail. YouTube picks a frame for you.</p>}</div></div>
  <label>Frame <span className="counter">{time.toFixed(1)} s</span><input type="range" min={0} max={video.current?.duration||600} step={0.1} value={time} disabled={post.locked} onChange={e=>{const t=Number(e.target.value);setTime(t);if(video.current)video.current.currentTime=t;}}/></label>
  <label>Big text on the thumbnail (optional) <span className="counter">{text.length}/40</span><input maxLength={40} value={text} disabled={post.locked} placeholder="KAI LOSES IT" onChange={e=>setText(e.target.value)}/></label>
  <button type="button" className="secondary" disabled={!!busy||post.locked} onClick={save}>{busy==='save'?<Loader2 className="spin" size={16}/>:<ImagePlus size={16}/>}Use this frame</button>
  {post.thumbnailError&&<p role="alert" className="trim-warning">{post.thumbnailError}</p>}{error&&<p role="alert" className="trim-warning">{error}</p>}
 </div>;
}
// Title choices from the AI: tap one to use it as the post title.
export function TitleOptions({options,current,onPick}:{options:string[];current:string;onPick:(t:string)=>void}){
 if(options.length<2)return null;
 return <div className="title-options" role="group" aria-label="Title options"><small className="muted">Title options</small>{options.map(t=><button type="button" key={t} aria-pressed={t===current} onClick={()=>onPick(t)}>{t}</button>)}</div>;
}

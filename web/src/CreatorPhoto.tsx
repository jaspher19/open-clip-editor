import {useEffect,useRef,useState} from 'react';import {Camera,Loader2} from 'lucide-react';
import type {Job} from './types';

// Creator photo in the project list: the channel's public profile picture (fetched once by the server), a photo the
// user picked, or the creator's initials on a colour of their own.
const initials=(name:string)=>{const parts=name.replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/).filter(Boolean);return ((parts[0]?.[0]||'?')+(parts.length>1?parts.at(-1)![0]:parts[0]?.[1]||'')).toUpperCase();};
const hue=(s:string)=>[...s].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7);
// Local uploads have no channel: their file name, without the extension.
export const creatorName=(j:Job)=>j.creator?.name||(j.source?.name||j.title||'').replace(/\.(mp4|mov|mkv|webm|m4v)$/i,'')||'New project';

export function CreatorAvatar({job,version,status}:{job:Job;version:number;status:''|'processing'|'failed'}){
 const name=creatorName(job),key=`${job.creator?.name||''}|${version}`;const [shown,setShown]=useState<string|null>(null);
 // Only show the picture once it has loaded, so a missing photo never flashes a broken image.
 useEffect(()=>{setShown(null);const img=new Image();let live=true;const src=`/api/jobs/${job.id}/creator/photo?v=${encodeURIComponent(key)}`;img.onload=()=>{if(live)setShown(src);};img.src=src;return ()=>{live=false;};},[job.id,key]);
 return <span className="creator-avatar" aria-hidden="true" style={{'--avatar-hue':hue(name)} as React.CSSProperties}>{shown?<img src={shown} alt=""/>:<span>{initials(name)}</span>}<i className={`history-dot ${status}`}/></span>;
}

/** Small menu on a project row: pick a photo for its creator, or go back to the channel's own picture. */
export function CreatorPhotoMenu({job,onChanged,onClose}:{job:Job;onChanged:()=>void;onClose:()=>void}){
 const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function send(init:RequestInit){setBusy(true);setError('');try{const r=await fetch(`/api/jobs/${job.id}/creator/photo`,init);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not change the photo');onChanged();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function pick(file?:File){if(!file)return;const form=new FormData();form.append('photo',file);send({method:'POST',body:form});}
 return <div className="history-confirm creator-menu" role="group" aria-label={`Photo for ${creatorName(job)}`}>
  <span>Photo for <b translate="no">{creatorName(job)}</b>{job.creator?.platform&&job.creator.platform!=='upload'?' (used for all their projects)':''}</span>
  <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={e=>pick(e.target.files?.[0])}/>
  <button type="button" disabled={busy} onClick={()=>input.current?.click()}>{busy?<Loader2 className="spin" size={14}/>:<Camera size={14}/>}Choose picture</button>
  {job.creator?.platform&&job.creator.platform!=='upload'&&<button type="button" disabled={busy} onClick={()=>send({method:'DELETE'})}>Use channel photo</button>}
  <button type="button" disabled={busy} onClick={onClose}>Close</button>
  {error&&<small role="alert" className="creator-menu-error">{error}</small>}
 </div>;
}

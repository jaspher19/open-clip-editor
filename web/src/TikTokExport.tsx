import {lazy,Suspense,useState} from 'react';
import {Loader2,Smartphone} from 'lucide-react';

const TikTokPost=lazy(()=>import('./TikTok').then(module=>({default:module.TikTokPost})));
type CalendarPost={id:string;metadata:{title:string}};

export function TikTokExport({jobId,clipId,onConnect,disabled=false,onPreparing}:{
 jobId:string;clipId:string;onConnect:()=>void;disabled?:boolean;onPreparing?:(preparing:boolean)=>void;
}){
 const [post,setPost]=useState<CalendarPost|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function prepare(){
  setBusy(true);onPreparing?.(true);setError('');
  try{
   const response=await fetch('/api/posting/export',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jobId,clipId,destination:'tiktok',format:'auto',autoThumbnail:false}),
   });
   const data=await response.json().catch(()=>null);
   if(!response.ok||!data?.id)throw new Error(data?.error||'Could not prepare this export for TikTok.');
   setPost(data);
  }catch(e){setError(e instanceof Error?e.message:'Could not prepare this export for TikTok.');}
  finally{setBusy(false);onPreparing?.(false);}
 }
 return <>
  <button type="button" className="primary" aria-haspopup="dialog" disabled={disabled||busy} onClick={prepare}>
   {busy?<Loader2 size={16} className="spin"/>:<Smartphone size={16}/>}
   {busy?'Preparing video…':'Continue to TikTok'}
  </button>
  {error&&<p className="trim-warning" role="alert">{error}</p>}
  {post&&<Suspense fallback={<p role="status">Opening TikTok…</p>}>
   <TikTokPost post={post} onClose={()=>setPost(null)} onConnect={onConnect}/>
  </Suspense>}
 </>;
}

import {useState} from 'react';import {Loader2,Plus,X,Check,CircleAlert} from 'lucide-react';
import type {Job} from './types';

// "Clip again": more clips from the same stream, never repeating one already made. They are added one at a time in
// the background and each renders on its own, so the clips already there stay watchable and editable.
const COUNTS=[3,5,10];

export function ClipAgain({job,disabled,onStart,onStop}:{job:Job;disabled:boolean;onStart:(count:number)=>void;onStop:()=>void}){
 const [count,setCount]=useState(5),room=30-job.clips.length,running=job.more?.status==='running';
 if(running)return <button type="button" className="secondary" onClick={onStop}><X size={16}/>Stop adding clips</button>;
 return <div className="clip-again"><select aria-label="How many more clips" value={Math.min(count,Math.max(1,room))} disabled={disabled||room<=0} onChange={e=>setCount(Number(e.target.value))}>{COUNTS.filter(n=>n<=Math.max(room,COUNTS[0])).map(n=><option key={n} value={n}>{Math.min(n,room)} more</option>)}</select>
  <button type="button" className="secondary" disabled={disabled||room<=0} title={room<=0?'A project holds up to 30 clips':'Finds new moments that don’t repeat your clips. Keep watching and editing meanwhile.'} onClick={()=>onStart(Math.min(count,room))}><Plus size={16}/>Clip again</button></div>;
}

/** Progress of "Clip again" above the clips; the finished message can be closed. */
export function MoreStatus({job,onStop}:{job:Job;onStop:()=>void}){
 const more=job.more,[closed,setClosed]=useState('');const key=`${job.id}:${more?.status}:${more?.added}`;
 if(!more||closed===key)return null;
 if(more.status==='running')return <div className="more-status" role="status"><Loader2 className="spin" size={16}/><span>Finding more clips · {more.added} of {more.wanted} added. Watch and edit your clips meanwhile; new ones appear as they’re ready.</span><button type="button" className="text-button" onClick={onStop}>Stop</button></div>;
 const ok=more.added>0;
 return <div className={`more-status ${ok?'done':'failed'}`} role="status">{ok?<Check size={16}/>:<CircleAlert size={16}/>}<span>{ok?`Added ${more.added} new clip${more.added===1?'':'s'} (marked New)${more.status==='stopped'?' before you stopped':''}. They’re edited one by one with your template.`:more.status==='stopped'?'Stopped before any new clip was added.':`No new clips were added: ${more.error||'no moments left that don’t repeat your clips'}.`}</span><button type="button" className="icon-button small" aria-label="Close" onClick={()=>setClosed(key)}><X size={14}/></button></div>;
}

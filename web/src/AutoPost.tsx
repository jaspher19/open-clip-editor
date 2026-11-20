import {useEffect,useState} from 'react';import {Zap} from 'lucide-react';

type Settings={enabled:boolean;postNow:number;times:string[];maxScheduled:number;titleStyle:'hook'|'standard';madeForKids:boolean;skipWarnings:boolean;connected?:boolean};

/** Auto-post: when a project finishes editing, post its best clips right away and schedule the rest. */
export default function AutoPost(){
 const [s,setS]=useState<Settings|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/autopost').then(r=>r.json()).then(setS).catch(()=>setMsg('Could not load auto-post settings'));},[]);
 if(!s)return <div className="posting-form"><h2><Zap size={18}/>Auto-post</h2><p className="muted">{msg||'Loading…'}</p></div>;
 async function save(next:Settings){setBusy(true);setMsg('');try{const r=await fetch('/api/autopost',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});const d=await r.json();if(!r.ok&&r.status!==409)throw new Error(d.error||'Could not save');setS({...next,...d});setMsg(d.error||'Saved');}catch(e){setMsg((e as Error).message);}finally{setBusy(false);}}
 const set=(patch:Partial<Settings>)=>save({...s,...patch});
 return <div className="posting-form auto-post"><h2><Zap size={18}/>Auto-post</h2>
  <p className="muted">When a project finishes editing, its best clips go to YouTube on their own. Clip channels that post within hours of the stream get the views.</p>
  <label className="check-option"><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e=>set({enabled:e.target.checked})}/>Auto-post finished projects</label>
  {!s.connected&&<p className="muted">Connect YouTube in Automation first.</p>}
  <label>Post right away<select value={s.postNow} disabled={busy} onChange={e=>set({postNow:Number(e.target.value)})}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n===0?'None, schedule all':`Best ${n}, public now`}</option>)}</select></label>
  <label>Then schedule up to<select value={s.maxScheduled} disabled={busy} onChange={e=>set({maxScheduled:Number(e.target.value)})}>{[0,3,6,9,12,15].map(n=><option key={n} value={n}>{n} more</option>)}</select></label>
  <label>Daily release times (Manila)<input value={s.times.join(', ')} disabled={busy} onChange={e=>setS({...s,times:e.target.value.split(/[,\s]+/).filter(Boolean)})} onBlur={()=>save(s)}/></label>
  <label>YouTube title<select value={s.titleStyle} disabled={busy} onChange={e=>set({titleStyle:e.target.value as Settings['titleStyle']})}><option value="hook">The hook + emoji + hashtags (“Jynxzi got cooked by the driving 💀 #jynxzi #gta6”)</option><option value="standard">The clip title</option></select></label>
  <label className="check-option"><input type="checkbox" checked={!s.madeForKids} disabled={busy} onChange={e=>set({madeForKids:!e.target.checked})}/>Not made for kids</label>
  <label className="check-option"><input type="checkbox" checked={s.skipWarnings} disabled={busy} onChange={e=>set({skipWarnings:e.target.checked})}/>Skip clips with sound or picture warnings</label>
  <p className="muted">YouTube allows about 6 uploads a day, so keep the total per day near that. Clips already on YouTube are never posted twice.</p>
  {msg&&<p className="muted" role="status">{msg}</p>}
 </div>;
}

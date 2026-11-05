import {useState} from 'react';
import {Sparkles,Download,Upload,MonitorPlay,Smartphone} from 'lucide-react';
import type {Job} from './types';
import {formatTime} from './logic.mjs';

const LENGTHS={video:[[300,'5 min'],[600,'10 min'],[900,'15 min'],[1200,'20 min']],shorts:[[30,'30 s'],[60,'60 s'],[90,'90 s'],[180,'3 min']]} as const;
const CATEGORY_CLASS={funny:'is-fun',highlight:'is-worth',clippable:'is-clip'};

/** Builds one video from the stream's fun, worth-it and clippable moments, as a main video or a Short. */
export default function StreamSummary({job,busy,onBuild,onPost}:{job:Job;busy:boolean;onBuild:(format:'video'|'shorts',targetSeconds:number)=>void;onPost:()=>void}){
 const summary=job.summary,[format,setFormat]=useState<'video'|'shorts'>(summary?.format||'video'),[length,setLength]=useState<number>(summary?.format===format?summary.targetSeconds:LENGTHS[format][1][0]);
 const pick=(f:'video'|'shorts')=>{setFormat(f);setLength(LENGTHS[f][1][0]);};
 const src=summary&&`/api/jobs/${job.id}/summary?v=${encodeURIComponent(summary.createdAt)}`;
 return <section className="summary-panel" aria-labelledby="summary-title">
  <div className="summary-heading"><div><h2 id="summary-title"><Sparkles size={20}/>Stream summary</h2><p>One recap video of the stream’s funniest, biggest and most clippable moments, in order — as a main video with chapters or a quick Short.</p></div></div>
  <div className="summary-controls">
   <div className="format-choice" role="radiogroup" aria-label="Summary format">
    <button type="button" role="radio" aria-checked={format==='video'} className={format==='video'?'chosen':''} onClick={()=>pick('video')}><MonitorPlay size={20}/><strong>Main video</strong><small>16:9 · chapters in the description</small></button>
    <button type="button" role="radio" aria-checked={format==='shorts'} className={format==='shorts'?'chosen':''} onClick={()=>pick('shorts')}><Smartphone size={20}/><strong>Shorts</strong><small>9:16 vertical · quick recap</small></button>
   </div>
   <label><span className="field-label">Length</span><select aria-label="Summary length" value={length} onChange={e=>setLength(Number(e.target.value))}>{LENGTHS[format].map(([s,l])=><option key={s} value={s}>{l}</option>)}</select></label>
   <button className="primary" disabled={busy} onClick={()=>onBuild(format,length)}><Sparkles size={16}/>{summary?'Rebuild summary':'Build summary'}</button>
  </div>
  {summary&&<div className={`summary-result ${summary.format}`}>
   <video src={src!} controls preload="metadata" poster={`/api/jobs/${job.id}/summary?type=jpg&v=${encodeURIComponent(summary.createdAt)}`}/>
   <div className="summary-details">
    <p className="summary-meta"><strong>{summary.format==='video'?'Main video':'Short'}</strong> · {formatTime(summary.duration)} · {summary.moments.length} moments</p>
    <ol className="moment-list">{summary.moments.map(m=><li key={m.index}><span className="moment-title">{m.title}</span><span className={`moment-chip small ${CATEGORY_CLASS[m.category]}`}>{m.label}</span><small>from {formatTime(m.start)}</small></li>)}</ol>
    {summary.chapters.length>0&&<details><summary>YouTube chapters ({summary.chapters.length})</summary><pre>{summary.chapters.map(c=>c.line).join('\n')}</pre></details>}
    <div className="summary-actions"><button className="primary" disabled={busy} onClick={onPost}><Upload size={15}/>Post summary</button><a className="secondary" href={`/api/jobs/${job.id}/summary?download=1`}><Download size={15}/>Download</a></div>
   </div>
  </div>}
 </section>;
}

import {CircleCheck,CircleAlert,TriangleAlert} from 'lucide-react';
import type {Job,Clip} from './types';
import {readiness} from './readiness.mjs';
import './moments.css';

type Check={id:string;label:string;pass:boolean;level:'pass'|'warn'|'fail';fix:string};
type Result={ok:boolean;failed:number;warned:number;passed:number;checks:Check[]};
const ICON={pass:CircleCheck,warn:TriangleAlert,fail:CircleAlert};

/** Ready-to-post checklist: a small pill for clip cards, a full list with fixes for the editor. */
export default function ReadyCheck({clip,job,compact=false}:{clip:Clip;job:Job;compact?:boolean}){
 const r=readiness(clip,job,job.exports.find(e=>e.clipId===clip.id)) as Result;
 const state=r.failed?'fail':r.warned?'warn':'pass',summary=r.failed?`${r.failed} to fix`:r.warned?`Ready · ${r.warned} tip${r.warned===1?'':'s'}`:'Ready to post';
 if(compact){const Icon=ICON[state];return <span className={`ready-pill ${state}`} title={r.checks.filter(c=>!c.pass).map(c=>`${c.label}: ${c.fix}`).join('\n')||'Every check passed'}><Icon size={14}/>{summary}</span>;}
 return <section className={`ready-check ${state}`} aria-label="Ready to post check"><h3>{(()=>{const Icon=ICON[state];return <Icon size={17}/>;})()}{r.failed?'Fix before posting':r.warned?'Ready to post, with tips':'Ready to post'}<small>{r.passed}/{r.checks.length} checks pass</small></h3>
  <ul>{r.checks.map(c=>{const Icon=ICON[c.level];return <li key={c.id} className={c.level}><Icon size={15}/><span><strong>{c.label}</strong>{!c.pass&&c.fix&&<small>{c.fix}</small>}</span></li>;})}</ul></section>;
}

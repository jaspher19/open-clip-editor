import fs from 'node:fs';import path from 'node:path';import {runPipeline} from './pipeline.mjs';import {renderClip} from './render.mjs';import {renderCompilation} from './compilation.mjs';import {renderSummary} from './summary.mjs';
// What makes a clip's video: when any of it changes while the clip renders, that render is out of date.
const VOLATILE=new Set(['dirty','render','exportError','metadata','kept','titleOptions','sourceContext']);
export const clipFingerprint=clip=>JSON.stringify(Object.keys(clip||{}).sort().filter(k=>!VOLATILE.has(k)).map(k=>[k,clip[k]]));
// The project-wide inputs too: its settings and its uploaded music.
const renderInputs=(job,clip)=>clipFingerprint(clip)+JSON.stringify([job.options,job.musicPath||'',job.silences?.length||0]);

/**
 * One local work lane (the CPU does one heavy thing at a time). Two kinds of work share it:
 *  - project work (find clips, compilation, summary): the project is busy and can't be edited meanwhile;
 *  - clip renders ('export'): one clip at a time, and the project stays editable. A clip shows its own state
 *    (clip.render = {state:'queued'|'rendering', progress}); editing another clip, or the same one again, just queues it.
 *    Saving a clip that is rendering stops that out-of-date render and renders it again with the new edit.
 */
export class JobQueue{
 constructor(store,{render=renderClip}={}){this.store=store;this.render=render;this.pending=new Set();this.tasks=[];this.active=null;this.renders=new Map();}
 isBusy(id){return this.pending.has(id);}
 /** Clips of project `id` waiting or rendering. */
 rendering(id){const r=this.renders.get(id);return r?[...(r.active?[r.active.clipId]:[]),...r.waiting]:[];}
 isRendering(id){return this.rendering(id).length>0;}
 enqueue(id,kind='pipeline',clipIds=[],params={}){
  if(kind==='export')return this.enqueueClips(id,clipIds);
  if(this.isBusy(id))throw new Error('This job is already processing');
  if(this.isRendering(id))throw new Error('Wait for the clips that are updating to finish first');
  this.pending.add(id);this.tasks.push({id,kind,clipIds,params});this.store.update(id,{status:'queued',stage:'queued',message:'Waiting in local queue'});queueMicrotask(()=>this.drain());
 }
 enqueueClips(id,clipIds){
  if(this.isBusy(id))throw new Error('This job is already processing');
  const r=this.lane(id),job=this.store.get(id),ids=[...new Set(clipIds)].filter(c=>job.clips.some(x=>x.id===c));
  for(const clipId of ids){
   if(r.active?.clipId===clipId){this.cancelled?.delete(`${id}/${clipId}`);r.active.again=true;r.active.controller.abort();continue;}// restarts with the new edit
   if(!r.waiting.includes(clipId)){r.waiting.push(clipId);this.tasks.push({id,kind:'clip',clipId});}
  }
  this.setRender(id,ids,{state:'queued',progress:0});queueMicrotask(()=>this.drain());
 }
 lane(id){let r=this.renders.get(id);if(!r){r={waiting:[],active:null};this.renders.set(id,r);}return r;}
 setRender(id,clipIds,render){try{const job=this.store.get(id);let changed=false;const clips=job.clips.map(c=>{if(!clipIds.includes(c.id))return c;changed=true;if(!render){const {render:_,...rest}=c;return rest;}const {exportError:_,...rest}=c;return {...rest,render};});if(changed)this.store.update(id,{clips});}catch{/* project deleted */}}
 async drain(){if(this.active||!this.tasks.length)return;const task=this.tasks.shift();const controller=new AbortController();this.active={...task,controller};
  try{
   if(task.kind==='clip')await this.renderOne(task,controller);
   else if(task.kind==='pipeline'){await runPipeline(this.store,task.id,{signal:controller.signal});try{await this.onPipelineDone?.(task.id);}catch{/* auto-post records its own errors */}}
   else if(task.kind==='compilation'){const job=this.store.get(task.id);this.store.update(job.id,{status:'exporting',stage:'export',message:'Building a real countdown compilation'});const output=await renderCompilation(job,task.clipIds,{folder:this.store.folder(job.id),signal:controller.signal,onProgress:p=>this.store.update(job.id,{progress:p})});this.store.update(job.id,{compilation:output,status:'complete',stage:'complete',progress:1,message:'Countdown compilation ready'});}
   else if(task.kind==='summary'){const job=this.store.get(task.id),label=task.params.format==='shorts'?'Shorts':'main video';this.store.update(job.id,{status:'exporting',stage:'export',progress:0,message:`Finding the best moments for a ${label} summary`});const output=await renderSummary(job,task.params,{folder:this.store.folder(job.id),signal:controller.signal,onProgress:p=>this.store.update(job.id,{progress:p,message:`Building the ${label} summary · ${Math.round(p*100)}%`})});this.store.update(job.id,{summary:output,status:'complete',stage:'complete',progress:1,message:`Stream summary ready · ${output.moments.length} moments`});}
  }catch(e){if(task.kind!=='clip'){const current=this.store.get(task.id);if(!['failed','cancelled'].includes(current.status))this.store.update(task.id,{status:controller.signal.aborted?'cancelled':'failed',message:e.message,error:e.message,stage:'error'});}}
  finally{if(task.kind!=='clip')this.pending.delete(task.id);this.active=null;this.drain();}}
 async renderOne(task,controller){
  const {id,clipId}=task,r=this.lane(id);r.waiting=r.waiting.filter(c=>c!==clipId);
  let job,clip;try{job=this.store.get(id);clip=job.clips.find(c=>c.id===clipId);}catch{}
  if(!clip){this.forget(id);return;}
  const active={clipId,controller,again:false};r.active=active;const before=renderInputs(job,clip);let shown=-1;
  this.setRender(id,[clipId],{state:'rendering',progress:0});
  try{
   const transcript=JSON.parse(fs.readFileSync(path.join(this.store.folder(id),'transcript.json'),'utf8'));
   const output=await this.render(job,clip,transcript,{folder:this.store.folder(id),signal:controller.signal,onProgress:p=>{const pct=Math.floor(p*50)*2;if(pct!==shown&&!active.again){shown=pct;this.setRender(id,[clipId],{state:'rendering',progress:pct/100});}}});
   const current=this.store.get(id),fresh=current.clips.find(c=>c.id===clipId);
   if(fresh){const stale=renderInputs(current,fresh)!==before;
    this.store.update(id,{exports:[...(current.exports||[]).filter(e=>e.clipId!==clipId),output],compilation:null,clips:current.clips.map(c=>{if(c.id!==clipId)return c;const {exportError:_,render:__,...rest}=c;return {...rest,dirty:stale||active.again};})});}
  }catch(e){
   if(!active.again){let gone=false;try{gone=!this.store.get(id).clips.some(c=>c.id===clipId);}catch{gone=true;}
    if(!gone){if(controller.signal.aborted)this.setRender(id,[clipId],null);else{try{const current=this.store.get(id);this.store.update(id,{clips:current.clips.map(c=>{if(c.id!==clipId)return c;const {render:_,...rest}=c;return {...rest,exportError:e.message};})});}catch{}}}}
  }finally{
   r.active=null;
   // Saved again while rendering: render it again first, with the latest edit.
   if(active.again&&!this.cancelled?.has(`${id}/${clipId}`)){r.waiting.unshift(clipId);this.tasks.unshift({id,kind:'clip',clipId});this.setRender(id,[clipId],{state:'queued',progress:0});}
   this.cancelled?.delete(`${id}/${clipId}`);this.forget(id);
  }
 }
 forget(id){const r=this.renders.get(id);if(r&&!r.active&&!r.waiting.length)this.renders.delete(id);}
 /** Stop one clip's render (waiting or running). */
 cancelClip(id,clipId){const r=this.renders.get(id);if(!r)return false;let hit=false;
  if(r.waiting.includes(clipId)){r.waiting=r.waiting.filter(c=>c!==clipId);this.tasks=this.tasks.filter(t=>!(t.kind==='clip'&&t.id===id&&t.clipId===clipId));this.setRender(id,[clipId],null);hit=true;}
  if(r.active?.clipId===clipId){(this.cancelled||=new Set()).add(`${id}/${clipId}`);r.active.again=false;r.active.controller.abort();hit=true;}
  this.forget(id);return hit;}
 /** Stop every clip render of project `id`. */
 cancelRenders(id){for(const clipId of this.rendering(id))this.cancelClip(id,clipId);}
 cancel(id){if(this.isRendering(id))this.cancelRenders(id);if(!this.pending.has(id))return;if(this.active?.id===id&&this.active.kind!=='clip')this.active.controller.abort();else{this.tasks=this.tasks.filter(t=>!(t.id===id&&t.kind!=='clip'));this.pending.delete(id);this.store.update(id,{status:'cancelled',stage:'cancelled',message:'Cancelled before processing'});}}
}

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {JobStore} from '../server/jobs.mjs';import {JobQueue,clipFingerprint} from '../server/queue.mjs';import {CACHE} from '../server/config.mjs';

// A fake renderer: each call waits until the test releases it, so the test can edit clips mid-render.
function fakeRenderer(){
 const calls=[];
 const render=(job,clip,transcript,{signal,onProgress})=>new Promise((resolve,reject)=>{
  const call={clipId:clip.id,start:clip.start,done:()=>resolve({clipId:clip.id,filename:`${clip.id}.mp4`,duration:30,createdAt:new Date().toISOString()}),fail:e=>reject(e)};
  calls.push(call);onProgress?.(.5);signal.addEventListener('abort',()=>reject(new Error('Job cancelled')),{once:true});});
 return {render,calls};
}
const until=async(check,ms=2000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timed out');await new Promise(r=>setTimeout(r,5));}};
function project(t){
 const store=new JobStore(path.join(CACHE,'clip-renders-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const job=store.create({type:'upload'},{});fs.writeFileSync(path.join(store.folder(job.id),'transcript.json'),'{"words":[]}');
 const clips=['a','b','c'].map((id,i)=>({id,start:i*60,end:i*60+30,title:id,kept:true,settings:{},dirty:true}));
 store.update(job.id,{status:'complete',stage:'complete',clips,exports:[]});return {store,id:job.id};
}

test('clip renders run one by one and never lock the project',async t=>{
 const {store,id}=project(t),{render,calls}=fakeRenderer(),queue=new JobQueue(store,{render});
 queue.enqueue(id,'export',['a','b']);
 await until(()=>calls.length===1);
 assert.equal(queue.isBusy(id),false,'project work is not blocked by clip renders');
 assert.equal(store.get(id).status,'complete');
 assert.deepEqual(store.get(id).clips.map(c=>c.render?.state||''),['rendering','queued','']);
 // Another clip saved meanwhile simply joins the line.
 queue.enqueue(id,'export',['c']);assert.deepEqual(queue.rendering(id),['a','b','c']);
 calls[0].done();await until(()=>calls.length===2);
 let job=store.get(id);assert.equal(job.clips[0].dirty,false);assert.equal(job.clips[0].render,undefined);assert.deepEqual(job.exports.map(e=>e.clipId),['a']);
 calls[1].done();await until(()=>calls.length===3);calls[2].done();await until(()=>!queue.isRendering(id));
 job=store.get(id);assert.deepEqual(job.exports.map(e=>e.clipId).sort(),['a','b','c']);assert.ok(job.clips.every(c=>!c.dirty&&!c.render));
 assert.throws(()=>{queue.enqueue(id,'export',['a']);queue.enqueue(id,'compilation',['a']);},/clips that are updating/);
});

test('saving a clip while it renders restarts it with the new edit; an edit without re-render keeps it marked',async t=>{
 const {store,id}=project(t),{render,calls}=fakeRenderer(),queue=new JobQueue(store,{render});
 queue.enqueue(id,'export',['a']);await until(()=>calls.length===1);
 // Saved and updated again: the out-of-date render stops and the clip renders again with the new start.
 store.update(id,{clips:store.get(id).clips.map(c=>c.id==='a'?{...c,start:5,dirty:true}:c)});queue.enqueue(id,'export',['a']);
 await until(()=>calls.length===2);assert.equal(calls[1].start,5);
 // Saved without updating: the finished render is already old, so the clip still shows "Update video".
 store.update(id,{clips:store.get(id).clips.map(c=>c.id==='a'?{...c,end:40}:c)});
 calls[1].done();await until(()=>!queue.isRendering(id));
 const a=store.get(id).clips.find(c=>c.id==='a');assert.equal(a.dirty,true);assert.equal(a.render,undefined);assert.equal(store.get(id).exports.length,1);
 // New music for the project while it renders: still out of date.
 queue.enqueue(id,'export',['b']);await until(()=>calls.length===3);store.update(id,{musicPath:'new.mp3'});calls[2].done();await until(()=>!queue.isRendering(id));assert.equal(store.get(id).clips.find(c=>c.id==='b').dirty,true);
 assert.notEqual(clipFingerprint({...a,dirty:false,render:{state:'queued'}}),clipFingerprint({...a,end:41}));
 assert.equal(clipFingerprint({...a,dirty:false,render:{state:'queued'},kept:false}),clipFingerprint(a));
});

test('one clip can be stopped, a failure stays on that clip, and a restart clears stale progress',async t=>{
 const {store,id}=project(t),{render,calls}=fakeRenderer(),queue=new JobQueue(store,{render});
 queue.enqueue(id,'export',['a','b','c']);await until(()=>calls.length===1);
 assert.equal(queue.cancelClip(id,'b'),true);assert.equal(store.get(id).clips.find(c=>c.id==='b').render,undefined);
 assert.equal(queue.cancelClip(id,'a'),true);await until(()=>calls.length===2);
 assert.equal(calls[1].clipId,'c','the stopped clip is skipped and the next one starts');
 const a=store.get(id).clips.find(c=>c.id==='a');assert.equal(a.render,undefined);assert.equal(a.exportError,undefined);
 calls[1].fail(new Error('ffmpeg broke'));await until(()=>!queue.isRendering(id));
 const c=store.get(id).clips.find(x=>x.id==='c');assert.equal(c.exportError,'ffmpeg broke');assert.equal(c.render,undefined);
 // A server stopped mid-render: the clip keeps its edits, marked to update, without a stuck progress bar.
 store.update(id,{clips:store.get(id).clips.map(x=>x.id==='b'?{...x,dirty:false,render:{state:'rendering',progress:.4}}:x)});
 const fresh=new JobStore(store.root);fresh.recover();const b=fresh.get(id).clips.find(x=>x.id==='b');assert.equal(b.render,undefined);assert.equal(b.dirty,true);
});

import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';import {JobStore} from '../server/jobs.mjs';import {ROOT} from '../server/config.mjs';import {YouTubeClient} from '../server/youtube.mjs';import {unusedMoments} from '../server/timeline.mjs';

test('deleting clips removes them, their videos and side files, stops their update, and Clip again skips them',async t=>{
 const store=new JobStore(path.join(ROOT,'.cache','clip-delete-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const cancelled=[];let busy=false;const queue={isBusy:()=>busy,isRendering:()=>false,enqueue(){},cancel(){},cancelClip:(id,clipId)=>{cancelled.push(clipId);return true;}};
 const app=createApp({store,queue,youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const job=store.create({type:'upload'},{}),folder=store.folder(job.id);
 const clips=['a','b','c'].map((n,i)=>({id:randomUUID(),start:i*100,end:i*100+30,title:n,kept:n!=='c',settings:{}}));
 for(const dir of ['exports','clips'])fs.mkdirSync(path.join(folder,dir));
 for(const c of clips){for(const ext of ['mp4','jpg','srt','txt'])fs.writeFileSync(path.join(folder,'exports',`${c.id}.${ext}`),'x');fs.writeFileSync(path.join(folder,'clips',`${c.id}.facecam.json`),'{}');}
 fs.writeFileSync(path.join(folder,'exports','other-cut.mp4'),'keep me');
 store.update(job.id,{status:'complete',metadata:{duration:600},clips,exports:clips.map(c=>({clipId:c.id,filename:c.id+'.mp4'}))});
 const del=body=>fetch(`${base}/api/jobs/${job.id}/clips/delete`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

 for(const bad of [{},{clipIds:[]},{clipIds:['nope']},{clipIds:[clips[0].id,clips[0].id]},{clipIds:[42]}])assert.equal((await del(bad)).status,400,JSON.stringify(bad));
 busy=true;assert.equal((await del({clipIds:[clips[0].id]})).status,409,'not while the project is processing');busy=false;

 let r=await del({clipIds:[clips[1].id,clips[2].id]});assert.equal(r.status,200,await r.clone().text());const out=await r.json();
 assert.deepEqual(out.clips.map(c=>c.title),['a']);assert.deepEqual(out.exports.map(e=>e.clipId),[clips[0].id]);
 assert.deepEqual(cancelled.sort(),[clips[1].id,clips[2].id].sort(),'an update in progress is stopped first');
 const left=[...fs.readdirSync(path.join(folder,'exports')),...fs.readdirSync(path.join(folder,'clips'))];
 assert.ok(left.every(f=>!f.startsWith(clips[1].id)&&!f.startsWith(clips[2].id)),'their files are gone');
 assert.ok(left.includes(`${clips[0].id}.mp4`)&&left.includes('other-cut.mp4'),'other files stay');
 const saved=store.get(job.id);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'clips.json'),'utf8')).map(c=>c.title),['a']);
 // Clip again won't bring a deleted moment back.
 assert.deepEqual(unusedMoments([{start:105,end:130,score:9},{start:400,end:430,score:5}],{clips:saved.clips,retired:saved.retiredMoments},5).map(m=>m.start),[400]);
 assert.equal((await del({clipIds:[clips[1].id]})).status,400,'an already deleted clip');
});

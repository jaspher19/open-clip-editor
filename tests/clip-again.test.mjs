import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';import {JobStore} from '../server/jobs.mjs';import {ROOT} from '../server/config.mjs';import {YouTubeClient} from '../server/youtube.mjs';import {unusedMoments} from '../server/timeline.mjs';
for(const k of ['GEMINI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','METADATA_AI'])delete process.env[k];
const overlap=(a,b)=>Math.min(a.end,b.end)-Math.max(a.start,b.start)>Math.min(3,(a.end-a.start)*.1);

test('Clip again picks the best moments that repeat nothing',()=>{
 const c=[{start:0,end:30,score:90},{start:20,end:50,score:85},{start:100,end:130,score:80},{start:200,end:230,score:70},{start:300,end:330,score:60}];
 assert.deepEqual(unusedMoments(c,{clips:[{start:5,end:35}]},2).map(m=>m.start),[100,200],'skips the clip it overlaps');
 assert.deepEqual(unusedMoments(c,{clips:[],retired:[{start:95,end:125}]},3).map(m=>m.start),[0,200,300],'skips swapped-away moments and its own overlaps');
 assert.deepEqual(unusedMoments(c,{clips:c},5),[]);
});

test('Clip again adds new clips in the background, each rendering on its own, while the project stays editable',async t=>{
 const store=new JobStore(path.join(ROOT,'.cache','clip-again-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const queued=[];const queue={isBusy:()=>false,isRendering:()=>false,enqueue:(...a)=>queued.push(a),cancel(){}};
 const app=createApp({store,queue,youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const job=store.create({type:'upload',name:'stream.mp4'},{});const folder=store.folder(job.id);
 const words=[];for(let s=1;s<1200;s+=.5){const text=s%150<10?'hahaha':s%150>=40&&s%150<44?'insane!':s%7<.5?'okay.':'word';words.push({start:s,end:s+.35,text});}
 fs.writeFileSync(path.join(folder,'transcript.json'),JSON.stringify({words,duration:1200}));
 const first={id:randomUUID(),start:0,end:30,title:'First',hook:'',score:60,category:'highlight',kept:true,settings:{},dirty:false};
 store.update(job.id,{status:'complete',metadata:{duration:1200},clips:[first],exports:[{clipId:first.id,filename:'x.mp4'}],retiredMoments:[{start:150,end:180}]});
 const post=(p,body={})=>fetch(`${base}/api/jobs/${job.id}${p}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 let r=await post('/more',{count:3});assert.equal(r.status,202,await r.clone().text());assert.equal((await r.json()).more.status,'running');
 // While it works, the existing clip can still be edited.
 const edit=await fetch(`${base}/api/jobs/${job.id}/clips/${first.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Still editable'})});assert.equal(edit.status,200);
 const end=Date.now()+20000;while(store.get(job.id).more?.status==='running'){if(Date.now()>end)throw new Error('timed out');await new Promise(r=>setTimeout(r,50));}
 const done=store.get(job.id);assert.equal(done.more.status,'done',done.more.error);assert.equal(done.more.added,3);assert.equal(done.clips.length,4);
 assert.equal(done.clips.find(c=>c.id===first.id).title,'Still editable');
 for(const [i,a] of done.clips.entries())for(const b of done.clips.slice(i+1))assert.ok(!overlap(a,b),`clips ${a.start}-${a.end} and ${b.start}-${b.end} overlap`);
 assert.ok(done.clips.every(c=>!overlap(c,{start:150,end:180})),'a swapped-away moment does not come back');
 const added=done.clips.filter(c=>c.addedBy==='more');assert.equal(added.length,3);assert.ok(added.every(c=>c.kept&&c.dirty));
 assert.deepEqual(queued.map(q=>q.slice(0,2)),added.map(()=>[job.id,'export']).slice(0,queued.length));assert.equal(queued.length,3,'each new clip renders on its own');
 assert.deepEqual(new Set(queued.map(q=>q[2][0])),new Set(added.map(c=>c.id)));
 assert.equal((await post('/more/cancel')).status,409);
 // Keep asking until the stream runs out: never a repeat, and a clear answer at the end.
 for(let k=0;k<12;k++){r=await post('/more',{count:10});if(r.status!==202)break;while(store.get(job.id).more?.status==='running')await new Promise(r=>setTimeout(r,50));}
 assert.ok([404,409].includes(r.status));assert.match((await r.json()).error,/No new moments|up to 30/);
 const all=store.get(job.id).clips;for(const [i,a] of all.entries())for(const b of all.slice(i+1))assert.ok(!overlap(a,b));
});

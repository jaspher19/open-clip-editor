import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {JobStore} from '../server/jobs.mjs';import {run} from '../server/process.mjs';import {ROOT} from '../server/config.mjs';
test('completed job state survives a fresh store and invalid IDs cannot traverse',()=>{
 const dir=path.join(ROOT,'.cache','test-jobs-'+randomUUID());const store=new JobStore(dir);
 const j=store.create({type:'youtube',url:'https://youtu.be/R6gKMvetXUU'},{});store.update(j.id,{status:'complete',stage:'complete',progress:1});
 const restored=new JobStore(dir).get(j.id);assert.equal(restored.status,'complete');assert.equal(restored.progress,1);assert.throws(()=>store.get('../escape'),/Invalid/i);
});
test('a restart marks running work interrupted, not complete',()=>{
 const dir=path.join(ROOT,'.cache','test-jobs-'+randomUUID());const store=new JobStore(dir);const j=store.create({type:'local',path:'x.mp4'},{});store.update(j.id,{status:'running'});
 const fresh=new JobStore(dir);fresh.recover();assert.equal(fresh.get(j.id).status,'interrupted');
});
test('subprocess receives project-local temp paths and reports failures',async()=>{
 const r=await run(process.execPath,['-e','process.stdout.write(process.env.TEMP)']);assert.ok(r.stdout.startsWith(ROOT));
 await assert.rejects(run(process.execPath,['-e','process.stderr.write("intentional failure");process.exit(4)']),/intentional failure/);
 const c=new AbortController();c.abort();await assert.rejects(run(process.execPath,['-e',''],{signal:c.signal}),/cancelled/);
});
test('subprocess timeouts and mid-run cancellation have distinct outcomes',async()=>{
 await assert.rejects(run(process.execPath,['-e','setTimeout(()=>{},5000)'],{timeout:35}),/timed out/);
 const c=new AbortController();const result=run(process.execPath,['-e','setTimeout(()=>{},5000)'],{signal:c.signal});setTimeout(()=>c.abort(),35);await assert.rejects(result,/cancelled/);
});
test('a briefly locked job.json on Windows is retried instead of crashing the server',()=>{
 const dir=path.join(ROOT,'.cache','test-jobs-'+randomUUID());const store=new JobStore(dir);const j=store.create({type:'youtube',url:'https://youtu.be/R6gKMvetXUU'},{});const real=fs.renameSync;let locked=2;
 fs.renameSync=(...a)=>{if(locked-->0)throw Object.assign(new Error('EPERM: operation not permitted, rename'),{code:'EPERM'});return real(...a);};
 try{store.update(j.id,{progress:.06,message:'Downloading video · 6%'});}finally{fs.renameSync=real;}
 assert.equal(store.get(j.id).progress,.06);assert.ok(!fs.existsSync(path.join(store.folder(j.id),'job.json.tmp')));
 fs.renameSync=()=>{throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});};try{assert.throws(()=>store.update(j.id,{progress:.1}),/ENOENT/);}finally{fs.renameSync=real;}
 fs.rmSync(dir,{recursive:true,force:true});});

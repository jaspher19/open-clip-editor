import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {CACHE} from '../server/config.mjs';

test('posts and finished clips have a preview picture',async t=>{
 process.env.POSTING_AUTO='0';
 const {createApp}=await import('../server/app.mjs');const {JobStore}=await import('../server/jobs.mjs');const {YouTubeClient}=await import('../server/youtube.mjs');
 const store=new JobStore(path.join(CACHE,'api-previews-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const app=createApp({store,queue:{isBusy:()=>false,enqueue(){},cancel(){}},youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const job=store.create({type:'upload'},{}),exports=path.join(store.folder(job.id),'exports');fs.mkdirSync(exports);
 const video=path.join(exports,'clip-1.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=360x640:d=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-pix_fmt','yuv420p','-c:a','aac','-shortest',video]);
 store.update(job.id,{status:'complete',clips:[{id:'clip-1',start:0,end:30,title:'t',kept:true,settings:{}}],exports:[{clipId:'clip-1',filename:'clip-1.mp4',createdAt:new Date().toISOString()}]});
 const isJpeg=async r=>Buffer.from(await r.arrayBuffer()).subarray(0,2).toString('hex')==='ffd8';
 let r=await fetch(`${base}/api/jobs/${job.id}/clips/clip-1/poster`);assert.equal(r.status,200);assert.ok(await isJpeg(r),'a frame of the export');
 assert.equal((await fetch(`${base}/api/jobs/${job.id}/clips/nope/poster`)).status,404);
 const form=new FormData();form.append('video',new Blob([fs.readFileSync(video)]),'done.mp4');form.append('post',JSON.stringify({format:'auto',timeZone:'UTC',settings:{privacy:'private',madeForKids:false},metadata:{title:'Done',description:'',tags:[],categoryId:'24'}}));
 r=await fetch(`${base}/api/posting/upload`,{method:'POST',body:form});assert.equal(r.status,201);const post=await r.json();
 r=await fetch(`${base}/api/posting/${post.id}/poster`);assert.equal(r.status,200);assert.ok(await isJpeg(r),'a frame of the post video');
 app.locals.posting.remove?.(post.id);
});

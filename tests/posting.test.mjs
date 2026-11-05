import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {CACHE} from '../server/config.mjs';import {PostingQueue,validatePost,planSchedule} from '../server/posting.mjs';
const input={metadata:{title:'A finished edit',description:'Context',tags:[]},settings:{privacy:'private',madeForKids:false},format:'shorts',timeZone:'Asia/Manila'};
test('posting requires eligible media and explicit valid publication data',()=>{assert.throws(()=>validatePost({...input,format:'video'},{width:1080,height:1920,duration:60}),/horizontal/);assert.throws(()=>validatePost(input,{width:1920,height:1080,duration:60}),/vertical/);assert.throws(()=>validatePost({...input,settings:{privacy:'schedule',madeForKids:false,publishAt:'yesterday'}},{width:1080,height:1920,duration:60}),/future/);assert.equal(validatePost(input,{width:1080,height:1920,duration:60}).settings.privacy,'private');});
test('durable edited-file queue retries one session and distinguishes private from scheduled',async()=>{const root=fs.mkdtempSync(path.join(CACHE,'tmp/posting-'));try{let calls=0,seen;const youtube={status:()=>({connected:true}),upload:async args=>{calls++;seen=args.sessionFile;if(calls===1){fs.writeFileSync(seen,'session');throw new Error('network');}if(calls===2)assert.equal(args.sessionFile,seen);return {videoId:'12345678901',url:'https://youtu.be/12345678901'};}};const queue=new PostingQueue({root,youtube});const file=path.join(root,'finished.mp4');fs.writeFileSync(file,'media');let p=queue.create(file,{width:1080,height:1920,duration:30},input);await queue.run([p.id]);assert.equal(queue.get(p.id).state,'needs-retry');assert.throws(()=>queue.edit(p.id,{...input,metadata:{...input.metadata,title:'changed'}}),/locked/);await queue.run([p.id]);assert.equal(queue.get(p.id).state,'uploaded-private');await queue.run([p.id]);assert.equal(calls,2);fs.writeFileSync(file,'another edit');const scheduled=queue.create(file,{width:1080,height:1920,duration:30},{...input,settings:{privacy:'schedule',madeForKids:false,publishAt:new Date(Date.now()+3600000).toISOString()}});await queue.run([scheduled.id]);assert.equal(queue.get(scheduled.id).state,'scheduled');}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('planSchedule spreads posts over daily Manila release times and skips past slots',()=>{
 const now=Date.parse('2026-11-04T10:30:00+08:00');
 const slots=planSchedule(5,{start:'2026-11-04',times:['18:00','09:00'],now});
 assert.deepEqual(slots.map(s=>new Date(s).toLocaleString('sv-SE',{timeZone:'Asia/Manila'}).slice(0,16)),['2026-11-04 18:00','2026-11-05 09:00','2026-11-05 18:00','2026-11-06 09:00','2026-11-06 18:00'],'09:00 today is already past; times are sorted');
 assert.throws(()=>planSchedule(2,{start:'',times:['09:00']}),/first release day/);assert.throws(()=>planSchedule(2,{start:'2026-11-04',times:['25:00']}),/release times/);
});
test('drafts can be bulk scheduled and get a newer video without losing their details; uploaded posts cannot',async()=>{const root=fs.mkdtempSync(path.join(CACHE,'tmp/posting-'));try{
 const youtube={status:()=>({connected:true}),upload:async()=>({videoId:'12345678901',url:'https://youtu.be/12345678901'})};const queue=new PostingQueue({root,youtube});const file=path.join(root,'finished.mp4');fs.writeFileSync(file,'media');
 const a=queue.create(file,{width:1080,height:1920,duration:30},{...input,source:{jobId:'j',clipId:'c'}}),b=queue.create(file,{width:1080,height:1920,duration:30},input);
 assert.equal(a.source.clipId,'c');const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const [sa,sb]=queue.schedule([a.id,b.id],{start:tomorrow,times:['09:00','20:00']});assert.equal(sa.settings.privacy,'schedule');assert.ok(Date.parse(sb.settings.publishAt)>Date.parse(sa.settings.publishAt));
 const edited=queue.edit(a.id,{...sa,metadata:{...sa.metadata,title:'Kai Cenat Gets Jump Scared',description:'New caption'}});assert.equal(edited.metadata.title,'Kai Cenat Gets Jump Scared');assert.equal(edited.settings.publishAt,sa.settings.publishAt,'editing keeps the schedule');
 const newer=path.join(root,'newer.mp4');fs.writeFileSync(newer,'fixed captions');const r=queue.replaceVideo(a.id,newer,{width:1080,height:1920,duration:31});assert.equal(fs.readFileSync(r.file,'utf8'),'fixed captions');assert.equal(r.metadata.description,'New caption');assert.equal(r.media.duration,31);
 await queue.run([b.id]);assert.throws(()=>queue.replaceVideo(b.id,newer,{width:1080,height:1920,duration:31}),/already started uploading/);assert.throws(()=>queue.schedule([b.id],{start:tomorrow,times:['09:00']}),/already started uploading/);
}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('an MP4 added as auto is a Short when vertical and short, otherwise a main video',()=>{
 const base={metadata:{title:'Kai Wins',description:'',tags:[],categoryId:'24'},settings:{privacy:'private',madeForKids:false}};
 assert.equal(validatePost({...base,format:'auto'},{width:1080,height:1920,duration:40}).format,'shorts');
 assert.equal(validatePost({...base,format:'auto'},{width:1920,height:1080,duration:40}).format,'video');
 assert.equal(validatePost({...base,format:'auto'},{width:1080,height:1920,duration:600}).format,'video');
});
test('a custom thumbnail is sent after the upload; a refused thumbnail is a note, not a failed upload',async()=>{const root=fs.mkdtempSync(path.join(CACHE,'tmp/posting-'));try{
 const sent=[];let refuse=false;const youtube={status:()=>({connected:true}),upload:async()=>({videoId:'12345678901',url:'https://youtu.be/12345678901'}),setThumbnail:async(id,file)=>{sent.push([id,fs.readFileSync(file,'utf8')]);if(refuse)throw new Error('YouTube refused the custom thumbnail.');}};
 const queue=new PostingQueue({root,youtube}),file=path.join(root,'finished.mp4'),thumb=path.join(root,'t.jpg');fs.writeFileSync(file,'media-a');fs.writeFileSync(thumb,'jpeg');
 const wide={...input,format:'video'},a=queue.create(file,{width:1920,height:1080,duration:300},wide);queue.setThumbnail(a.id,{time:12,text:'Big moment',file:thumb});assert.equal(queue.get(a.id).thumbnail.time,12);
 await queue.run([a.id]);assert.equal(queue.get(a.id).state,'uploaded-private');assert.deepEqual(sent,[['12345678901','jpeg']]);assert.equal(queue.get(a.id).thumbnailError,'');
 assert.throws(()=>queue.setThumbnail(a.id,{time:1,file:thumb}),/YouTube Studio/);assert.throws(()=>queue.clearThumbnail(a.id),/YouTube Studio/);
 refuse=true;fs.writeFileSync(file,'media-b');const b=queue.create(file,{width:1920,height:1080,duration:300},wide);queue.setThumbnail(b.id,{time:3,file:thumb});await queue.run([b.id]);
 assert.equal(queue.get(b.id).state,'uploaded-private','the video upload still counts');assert.match(queue.get(b.id).thumbnailError,/refused/);
 fs.writeFileSync(file,'media-c');const c=queue.create(file,{width:1920,height:1080,duration:300},wide);queue.setThumbnail(c.id,{time:3,file:thumb});queue.clearThumbnail(c.id);assert.ok(!fs.existsSync(queue.thumbnailFile(c.id))&&!queue.get(c.id).thumbnail);
}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('a clip already on YouTube is skipped at upload, even after a re-export changed the file',async()=>{
 const root=path.join(CACHE,'test-twin-'+Date.now());fs.mkdirSync(root,{recursive:true});
 try{const uploads=[];const youtube={status:()=>({connected:true}),upload:async()=>{uploads.push(1);return {videoId:'v',url:'https://youtu.be/v'};}};const q=new PostingQueue({root,youtube});
  const media={width:1080,height:1920,duration:30,fps:30,audioCodec:'aac',videoCodec:'h264'},file=n=>{const f=path.join(root,n+'.mp4');fs.writeFileSync(f,n);return f;};
  const meta=t=>({title:t,description:'',tags:[],categoryId:'24'}),settings={privacy:'private',madeForKids:false};
  const first=q.create(file('a'),media,{metadata:meta('Kai Wins'),settings,source:{jobId:'j',clipId:'c'}});await q.run([first.id]);
  const again=q.create(file('b'),media,{metadata:meta('Kai Wins Again'),settings,source:{jobId:'j',clipId:'c'}}),sameTitle=q.create(file('c'),media,{metadata:meta('kai wins!'),settings});
  assert.equal(q.postedTwin(again)?.id,first.id);assert.equal(q.postedTwin(sameTitle),null,'a different video with the same title is not a duplicate');
  await q.run([again.id]);assert.equal(uploads.length,1,'only the first upload happened');assert.equal(q.get(again.id).state,'already-posted');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('daily batches: each post uploads on its own day, a missed slot asks for a new time, and only one server uploads',async()=>{
 const {uploadTime}=await import('../server/posting.mjs');const root=path.join(CACHE,'test-daily-'+Date.now());fs.mkdirSync(root,{recursive:true});
 try{const uploaded=[];const youtube={status:()=>({connected:true}),upload:async({metadata})=>{uploaded.push(metadata.title);return {videoId:'v'+uploaded.length,url:'https://youtu.be/v'};}};const q=new PostingQueue({root,youtube});
  const media={width:1080,height:1920,duration:30,fps:30,audioCodec:'aac',videoCodec:'h264'};const make=n=>{const f=path.join(root,n+'.mp4');fs.writeFileSync(f,n);return q.create(f,media,{...input,metadata:{...input.metadata,title:n}});};
  const posts=['a','b','c','d'].map(make),now=Date.parse('2030-01-01T00:00:00Z'),day=new Date(now+86400000).toISOString().slice(0,10);
  const planned=q.schedule(posts.map(p=>p.id),{start:day,times:['09:00','18:00'],offset:'+08:00',daily:true,now});
  assert.deepEqual(planned.map(p=>p.autoUpload.at),planned.map(p=>uploadTime(p.settings.publishAt,now)));assert.equal(Date.parse(planned[0].settings.publishAt)-Date.parse(planned[0].autoUpload.at),3*3600000);
  const at=k=>Date.parse(planned[k].autoUpload.at)+1000;assert.deepEqual(q.due(at(0)).map(p=>p.metadata.title),['a'],'only the 9:00 post is due 3 hours before 9:00');
  fs.writeFileSync(path.join(root,'.auto-upload.lock'),'other');assert.deepEqual(await q.tick(at(0)),[],'another server holds the lock');fs.rmSync(path.join(root,'.auto-upload.lock'));
  assert.equal((await q.tick(at(0))).length,1);assert.equal((await q.tick(at(1))).length,1);assert.deepEqual(uploaded,['a','b'],'day one uploads its two posts, each on time');assert.equal(q.get(planned[0].id).state,'scheduled');assert.equal(q.get(planned[2].id).state,'draft','day two waits');
  const late=Date.parse(planned[3].settings.publishAt)-60000;await q.tick(late);assert.equal(q.get(planned[2].id).state,'missed');assert.equal(q.get(planned[2].id).autoUpload,undefined);
  assert.equal(uploaded.length,2,'missed posts are not uploaded late');
  const edited=q.edit(planned[3].id,{...input,settings:{privacy:'private',madeForKids:false}});assert.equal(edited.autoUpload,undefined,'leaving the schedule ends the daily plan');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

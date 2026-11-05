import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {CACHE} from '../server/config.mjs';import {UploadLog,guardUploads} from '../server/upload-log.mjs';import {PostingQueue} from '../server/posting.mjs';
const input={format:'shorts',timeZone:'Asia/Manila',metadata:{title:'Speed meets a fan',description:'',tags:[],categoryId:'24'},settings:{privacy:'private',madeForKids:false}};
const media={width:1080,height:1920,duration:50};
test('the upload log catches the same file, clip, stream moment or title, and Upload anyway overrides it',async()=>{const root=fs.mkdtempSync(path.join(CACHE,'tmp/upload-log-'));try{
 const log=new UploadLog(path.join(root,'upload-log.json'));let n=0;const ranges={a:{start:100,end:160},b:{start:110,end:170},c:{start:400,end:460}};
 const youtube=guardUploads({status:()=>({connected:true}),upload:async()=>{n++;return {videoId:`vid0000000${n}`,url:`https://youtu.be/vid0000000${n}`};}},log,s=>({video:'https://www.youtube.com/watch?v=abcdefghijk',...ranges[s.clipId]}));
 const queue=new PostingQueue({root:path.join(root,'posts'),youtube}),file=path.join(root,'a.mp4');fs.writeFileSync(file,'edit-a');
 const first=queue.create(file,media,{...input,source:{jobId:'j1',clipId:'a'}});await queue.run([first.id]);assert.equal(queue.get(first.id).state,'uploaded-private');assert.equal(log.list().length,1);assert.equal(log.list()[0].source.video,'abcdefghijk');
 // A re-cut of the same moment in a new file and under a new title is still a repeat.
 fs.writeFileSync(file,'edit-b');const recut=queue.create(file,media,{...input,metadata:{...input.metadata,title:'Different words'},source:{jobId:'j2',clipId:'b'}});await queue.run([recut.id]);
 let p=queue.get(recut.id);assert.equal(p.state,'already-posted');assert.match(p.repeatOf.reason,/stream moment/);assert.equal(n,1);
 fs.writeFileSync(file,'edit-c');const sameTitle=queue.create(file,media,{...input,source:{jobId:'j1',clipId:'c'}});await queue.run([sameTitle.id]);assert.equal(queue.get(sameTitle.id).repeatOf.reason,'the same title');
 fs.writeFileSync(file,'edit-a');const sameFile=queue.create(file,media,{...input,metadata:{...input.metadata,title:'New'},source:{jobId:'j9',clipId:'c'}});assert.equal(log.findRepeat({fingerprint:await queue.fingerprint(sameFile),title:'x'}).reason,'the exact same video file');
 fs.writeFileSync(file,'edit-d');const fresh=queue.create(file,media,{...input,metadata:{...input.metadata,title:'A new moment'},source:{jobId:'j1',clipId:'c'}});await queue.run([fresh.id]);assert.equal(queue.get(fresh.id).state,'uploaded-private');
 await queue.run([recut.id],{allowRepeat:true});p=queue.get(recut.id);assert.equal(p.state,'uploaded-private');assert.equal(log.list().length,3);assert.equal(log.list().at(-1).repeatAllowed,true);
 log.record({videoId:'vid00000001',title:'renamed'});assert.equal(log.list().length,3,'recording a logged video again updates it');
}finally{fs.rmSync(root,{recursive:true,force:true});}});

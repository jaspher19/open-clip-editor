import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {autoPostJob,hookTitle,postable,nextReleaseDay,validateAutopost,saveAutopost,loadAutopost} from '../server/autopost.mjs';
import {PostingQueue} from '../server/posting.mjs';

test('hook titles: the specific hook, one fitting emoji, the streamer and game hashtags, never #shorts',()=>{
 assert.equal(hookTitle({hook:'Jynxzi got cooked by the driving'},{description:'… #gta6 #gaming #shorts'},'Jynxzi'),'Jynxzi got cooked by the driving 💀 #jynxzi #gta6');
 assert.equal(hookTitle({settings:{hookText:'the GTA 6 realism had Jynxzi tweaking'}},{description:''},'Jynxzi'),'The GTA 6 realism had Jynxzi tweaking 😱 #jynxzi');
 assert.equal(hookTitle({hook:'wow'},{description:''},'Jynxzi'),null,'too short to be a title');
});
test('settings are validated and default to off',()=>{
 const root=fs.mkdtempSync(path.join(process.cwd(),'.cache','tmp','ap-'));assert.equal(loadAutopost(root).enabled,false);
 assert.throws(()=>validateAutopost({times:['25:00']}),/release times/);assert.throws(()=>validateAutopost({postNow:9}),/0–4/);
 assert.deepEqual(saveAutopost(root,{enabled:true,times:['21:00','12:00']}).times,['12:00','21:00']);assert.equal(loadAutopost(root).enabled,true);fs.rmSync(root,{recursive:true,force:true});
});
test('auto-post: best clean clips first; the top ones upload now as public, the rest are scheduled daily after what is already planned',async()=>{
 const root=fs.mkdtempSync(path.join(process.cwd(),'.cache','tmp','ap-')),jobDir=path.join(root,'job'),exports=path.join(jobDir,'exports');fs.mkdirSync(exports,{recursive:true});
 const clip=(id,score,extra={})=>({id,score,title:`Clip ${id}`,hook:`Jynxzi got cooked by thing ${id}`,start:0,end:30,...extra});
 const clips=[clip('a',90),clip('b',70),clip('c',80),clip('d',95,{kept:false}),clip('e',99,{dirty:true}),clip('f',85),clip('g',60)];
 const exp=clips.map(c=>({clipId:c.id,filename:`${c.id}.mp4`,checks:c.id==='f'?['Nearly silent: check the sound before posting']:[]}));for(const e of exp)fs.writeFileSync(path.join(exports,e.filename),'x');
 let job={id:'00000000-0000-4000-8000-000000000001',status:'complete',title:'Jynxzi GTA 6',host:{name:'Jynxzi'},options:{editTemplate:'glow-card'},clips,exports:exp};
 assert.deepEqual(postable(job).map(x=>x.clip.id),['a','c','b','g'],'not unkept, unsaved or with warnings; best first');
 const posting=new PostingQueue({root:path.join(root,'posting'),youtube:{status:()=>({connected:false})}});
 const now=Date.parse('2026-11-20T02:00:00Z'),store={folder:()=>jobDir,update:(id,patch)=>(job={...job,...patch})};
 const r=await autoPostJob(job,{store,posting,settings:{...validateAutopost({enabled:true,postNow:2,times:['12:00','18:00']}),maxScheduled:9},probeFile:async()=>({width:1080,height:1920,duration:40}),now});
 assert.equal(r.now.length,2);assert.equal(r.scheduled.length,2);const posts=posting.list();
 const first=posts.filter(p=>r.now.includes(p.id));assert.deepEqual(first.map(p=>p.source.clipId).sort(),['a','c']);assert.ok(first.every(p=>p.settings.privacy==='public'&&p.autoUpload&&p.settings.madeForKids===false));
 assert.match(first.find(p=>p.source.clipId==='a').metadata.title,/^Jynxzi got cooked by thing a 💀 #jynxzi/);
 const later=posts.filter(p=>r.scheduled.includes(p.id)).sort((x,y)=>x.settings.publishAt.localeCompare(y.settings.publishAt));
 assert.deepEqual(later.map(p=>p.settings.publishAt),['2026-11-20T04:00:00.000Z','2026-11-20T10:00:00.000Z'],'today 12:00 and 18:00 Manila');assert.ok(later.every(p=>p.autoUpload));
 assert.match(job.message,/auto-post: 2 uploading now, 2 scheduled/);
 assert.equal((await autoPostJob(job,{store,posting,settings:validateAutopost({enabled:true}),now})).skipped,'already auto-posted');
 assert.equal(nextReleaseDay(posting.list(),now),'2026-11-21','the next project starts the day after the last scheduled post');
 assert.equal(await autoPostJob(job,{store,posting,settings:validateAutopost({enabled:false})}),null,'off by default');
 fs.rmSync(root,{recursive:true,force:true});
});

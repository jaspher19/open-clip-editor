import test from 'node:test';import assert from 'node:assert/strict';
import {clipTraits,channelLessons,lessonBonus,refreshLessons,loadLessons} from '../server/learning.mjs';
import fs from 'node:fs';import path from 'node:path';import {UploadLog} from '../server/upload-log.mjs';

const old='2026-11-01T00:00:00Z',now=Date.parse('2026-11-19T00:00:00Z');
test('clip traits come from the category and the picker reasons',()=>{
 assert.deepEqual(clipTraits({category:'funny',reasons:['Peak 0:30 in · 3 laughs · busy on-screen action · chat went wild','Setup 20s before the payoff','Viewers clipped this · 12 views']}),['laugh','action','chat','crowd','category:funny']);
});
test('lessons: traits on well-viewed Shorts gain, shrunk toward zero; private and too-new videos do not count',()=>{
 const e=(views,traits,extra={})=>({videoId:'x',uploadedAt:old,privacy:'public',stats:{views},traits,...extra});
 const list=[e(20000,['laugh']),e(15000,['laugh']),e(9000,['laugh','action']),e(300,['hype']),e(200,['hype']),e(250,['hype']),e(50000,['laugh'],{privacy:'private'}),e(90000,['hype'],{uploadedAt:'2026-11-18T12:00:00Z'})];
 const l=channelLessons(list,{now});assert.equal(l.videos,6,'private and 12-hour-old uploads skipped');
 assert.ok(l.traits.laugh.lift>.3&&l.traits.laugh.lift<1,'laughs did better, shrunk');assert.ok(l.traits.hype.lift<0);assert.equal(l.traits.laugh.n,3);
 const up=lessonBonus(l,['laugh']),down=lessonBonus(l,['hype']);assert.ok(up.bonus>0&&up.bonus<=6);assert.ok(down.bonus<0&&down.bonus>=-6);
 assert.match(up.note,/^Your channel: laughing moments get \d+% more views$/);assert.equal(lessonBonus(l,['action']).bonus,0,'one video is not a lesson');
 assert.deepEqual(channelLessons(list.slice(0,3),{now}).traits,{},'too few videos: no lessons');
});
test('refresh: reads view counts 50 at a time, fills traits from projects that still exist, saves the lessons',async()=>{
 const root=fs.mkdtempSync(path.join(process.cwd(),'.cache','tmp','learn-'));const log=new UploadLog(path.join(root,'posting','upload-log.json'));
 const ids=['AAAAAAAAAA1','AAAAAAAAAA2','AAAAAAAAAA3','AAAAAAAAAA4','AAAAAAAAAA5'];
 ids.forEach((videoId,k)=>log.record({videoId,uploadedAt:old,privacy:'public',...(k?{traits:k%2?['laugh']:['hype']}:{source:{jobId:'j',clipId:'c'}})}));
 const store={get:id=>({clips:[{id:'c',category:'funny',reasons:['Peak · 2 laughs']}]})},calls=[];
 const youtube={videoStats:async list=>{calls.push(list.length);return Object.fromEntries(list.map((id,k)=>[id,{views:k%2?5000:100,likes:1,comments:0}]));}};
 const r=await refreshLessons({youtube,log,store,root,now});assert.deepEqual(calls,[5]);assert.deepEqual(log.list()[0].traits,['laugh','category:funny']);
 assert.equal(r.videos,5);assert.ok(loadLessons(root).traits.laugh);assert.equal(log.list()[1].stats.views,5000);
 fs.rmSync(root,{recursive:true,force:true});
});

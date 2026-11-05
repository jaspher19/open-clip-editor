import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';import {JobStore} from '../server/jobs.mjs';import {ROOT} from '../server/config.mjs';import {YouTubeClient} from '../server/youtube.mjs';
import {validateClipEdits,outputLength} from '../server/clip-edits.mjs';import {streamActivity,bestUnused} from '../server/timeline.mjs';
for(const k of ['GEMINI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','METADATA_AI'])delete process.env[k];

test('clip edits: cuts, parts, effects and title options are validated and cleaned',()=>{
 const clip={start:100,end:150};
 const out=validateClipEdits({cuts:[{start:120,end:125},{start:105,end:106.5}],parts:[{start:300,end:310}],effects:[{id:'b',type:'freeze',at:130,duration:1,text:' WAIT '},{id:'a',type:'pop',at:110,text:'NO WAY',emoji:'😱',sound:'meme/boom'}],titleOptions:['Kai Wins',' Kai Wins ','Kai Loses']},clip,{duration:600});
 assert.deepEqual(out.cuts.map(c=>c.start),[105,120],'cuts are sorted');assert.deepEqual(out.effects.map(e=>e.id),['a','b'],'effects are sorted by time');assert.equal(out.effects[1].text,'WAIT');assert.deepEqual(out.titleOptions,['Kai Wins','Kai Loses']);
 assert.equal(outputLength(100,150,out.cuts,out.parts),50-6.5+10);
 for(const [body,re] of [[{cuts:[{start:90,end:95}]},/inside the clip/],[{cuts:[{start:110,end:120},{start:115,end:125}]},/overlap/],[{cuts:[{start:110,end:110.05}]},/0\.1/],[{parts:[{start:140,end:160}]},/overlaps the main clip/],[{parts:[{start:300,end:301}]},/2–30/],
  [{effects:[{id:'x',type:'explode',at:110}]},/Unknown effect/],[{effects:[{id:'x',type:'zoom',at:10}]},/inside the clip/],[{effects:[{id:'x',type:'freeze',at:110,duration:5}]},/0\.4–2/],[{effects:[{id:'x',type:'zoom',at:110},{id:'x',type:'zoom',at:111}]},/unique id/],
  [{effects:[{id:'x',type:'zoom',at:110,sound:'../etc'}]},/Invalid sound/],[{effects:[{id:'x',type:'zoom',at:110,emoji:'😱'}]},/emoji/],[{titleOptions:['a','b','c','d']},/at most 3/]])
  assert.throws(()=>validateClipEdits(body,clip,{duration:600}),re);
 assert.deepEqual(validateClipEdits({effects:[{id:'p',type:'sfx',at:305}]},{...clip,parts:[{start:300,end:310}]}).effects[0].at,305,'effects may sit in an extra part');
});

test('stream activity buckets count laughs and hype; the best unused moment skips overlapping clips',()=>{
 const words=[{start:12,end:12.4,text:'hahaha'},{start:13,end:13.4,text:'no'},{start:13.5,end:13.9,text:'way'},{start:31,end:31.3,text:'clip'},{start:31.4,end:31.8,text:'that'}];
 const a=streamActivity({words,duration:40});assert.equal(a.buckets.length,8);assert.equal(a.buckets[2].laugh,1);assert.equal(a.buckets[2].hype,1);assert.equal(a.buckets[6].cue,1);
 const c=[{start:0,end:30,score:90},{start:100,end:130,score:80},{start:200,end:230,score:70}];
 assert.equal(bestUnused(c,[{start:5,end:35}]).start,100);assert.equal(bestUnused(c,[{start:5,end:35},{start:110,end:140},{start:190,end:220}]),null);
});

function fixture(t){
 const store=new JobStore(path.join(ROOT,'.cache','moments-tests-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));const queue={isBusy:()=>false,enqueue(){},cancel(){}};
 const app=createApp({store,queue,youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const job=store.create({type:'upload',name:'stream.mp4'},{});const folder=store.folder(job.id);
 // Ten minutes of talk with a laughing fit at 300 s and a hype burst at 450 s.
 const words=[];for(let t=1;t<600;t+=.5){const text=t>=300&&t<310?'hahaha':t>=450&&t<455?'insane!':t%7<.5?'okay.':'word';words.push({start:t,end:t+.35,text});}
 fs.writeFileSync(path.join(folder,'transcript.json'),JSON.stringify({words,duration:600,energy:Array.from({length:1200},(_,i)=>({time:i/2,rms:i>=600&&i<620?.6:.1}))}));
 const clipId=randomUUID();store.update(job.id,{status:'complete',title:'Kai Cenat stream',metadata:{duration:600},clips:[{id:clipId,start:100,end:130,title:'Kai Cenat Wins',hook:'Kai Wins',score:60,category:'highlight',kept:true,settings:{editTemplate:'context-hit'},dirty:false}],exports:[{clipId,filename:clipId+'.mp4'}]});
 return {store,app,job:store.get(job.id),clipId};
}
const listen=async(t,app)=>{const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;};
const json=(method,body)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('PATCH accepts cuts, parts and effects, checks the played length, and marks the clip for re-export',async t=>{
 const {store,app,job,clipId}=fixture(t),base=await listen(t,app),url=`${base}/api/jobs/${job.id}/clips/${clipId}`;
 let r=await fetch(url,json('PATCH',{start:100,end:170,cuts:[{start:110,end:130}],effects:[{id:'z1',type:'zoom',at:105,sound:'impact/hit_01'}]}));assert.equal(r.status,200,await r.clone().text());
 let clip=await r.json();assert.equal(clip.cuts.length,1);assert.equal(clip.effects[0].type,'zoom');assert.equal(clip.dirty,true);
 r=await fetch(url,json('PATCH',{start:100,end:170}));assert.equal(r.status,200,'70 s span plays 50 s thanks to the kept cut');assert.equal((await r.json()).cuts.length,1);
 r=await fetch(url,json('PATCH',{cuts:[]}));assert.equal(r.status,400);assert.match((await r.json()).error,/plays for 70 seconds/);
 r=await fetch(url,json('PATCH',{start:100,end:125,parts:[{start:400,end:410}]}));assert.equal(r.status,200);clip=await r.json();assert.deepEqual(clip.parts,[{start:400,end:410}]);assert.ok(clip.words.some(w=>w.start>=400),'part words are kept for captions');
 r=await fetch(url,json('PATCH',{effects:[{id:'bad',type:'zoom',at:50}]}));assert.equal(r.status,400);assert.match((await r.json()).error,/inside the clip/);
 r=await fetch(url,json('PATCH',{start:0,end:200}));assert.equal(r.status,400);
 assert.equal(store.get(job.id).clips[0].effects.length,1,'a rejected edit changes nothing');
});

test('timeline, hand-picked clips and swaps',async t=>{
 const {store,app,job,clipId}=fixture(t),base=await listen(t,app);
 let r=await fetch(`${base}/api/jobs/${job.id}/timeline`);assert.equal(r.status,200);const tl=await r.json();
 assert.equal(tl.buckets.length,120);assert.ok(tl.buckets[60].laugh>0,'the laughing fit shows at 300 s');assert.ok(tl.candidates.length>0);assert.ok(tl.candidates.every(c=>typeof c.used==='boolean'));assert.equal(tl.clips[0].id,clipId);
 assert.ok(fs.existsSync(path.join(store.folder(job.id),'timeline.json')),'cached');
 r=await fetch(`${base}/api/jobs/${job.id}/clips`,json('POST',{start:440,end:470}));assert.equal(r.status,201,await r.clone().text());
 const added=await r.json();assert.ok(added.clip.title);assert.equal(added.clip.dirty,true);assert.equal(added.clip.kept,true);assert.equal(added.clip.settings.editTemplate,'context-hit','uses the project look');assert.equal(added.job.clips.length,2);
 r=await fetch(`${base}/api/jobs/${job.id}/clips`,json('POST',{start:440,end:450}));assert.equal(r.status,400);
 r=await fetch(`${base}/api/jobs/${job.id}/clips/${clipId}/swap`,json('POST',{}));assert.equal(r.status,200,await r.clone().text());
 const swapped=await r.json(),clips=store.get(job.id).clips;assert.equal(swapped.replaced,clipId);assert.ok(!clips.some(c=>c.id===clipId));assert.equal(clips.length,2);
 assert.ok(!store.get(job.id).exports.some(e=>e.clipId===clipId),'the old export no longer stands for this clip');
 const others=clips.filter(c=>c.id!==swapped.clip.id);assert.ok(others.every(o=>Math.min(o.end,swapped.clip.end)-Math.max(o.start,swapped.clip.start)<3),'no overlap with other clips');
 store.update(job.id,{status:'running'});r=await fetch(`${base}/api/jobs/${job.id}/clips`,json('POST',{start:200,end:230}));assert.equal(r.status,409);
});

test('music library lists, serves and accepts tracks with safe names',async t=>{
 const {store,app}=fixture(t),base=await listen(t,app);
 const rate=8000,pcm=Buffer.alloc(rate*2),wav=Buffer.alloc(44);wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);
 const send=name=>{const form=new FormData();form.append('music',new Blob([Buffer.concat([wav,pcm])]),name);return fetch(`${base}/api/music`,{method:'POST',body:form});};
 let r=await send('../../My Beat?.wav');assert.equal(r.status,201,await r.clone().text());const track=await r.json();assert.equal(track.name,'My Beat.wav');assert.equal(track.duration,1);
 r=await send('My Beat.wav');assert.equal((await r.json()).name,'My Beat (2).wav');
 r=await send('notes.txt');assert.equal(r.status,400);
 r=await fetch(`${base}/api/music`);const list=await r.json();assert.deepEqual(list.map(m=>m.name).sort(),['My Beat (2).wav','My Beat.wav']);
 r=await fetch(`${base}/api/music/${encodeURIComponent('My Beat.wav')}`);assert.equal(r.status,200);r=await fetch(`${base}/api/music/${encodeURIComponent('..\\job.json')}`);assert.equal(r.status,404);
 assert.ok(fs.readdirSync(path.join(store.root,'music-library')).every(n=>!n.startsWith('incoming-')),'no leftovers');
});

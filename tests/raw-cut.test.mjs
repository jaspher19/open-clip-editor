import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {rawMoments,audioEnergy,rawTitle,rawClip} from '../server/raw.mjs';import {validateOptions} from '../server/options.mjs';import {applyTemplate,EDIT_TEMPLATES} from '../server/templates.mjs';
import {validateCut,cutGraph,frameFilter} from '../server/cut.mjs';import {buildClipEdl} from '../server/edl.mjs';import {streamCandidates} from '../server/timeline.mjs';
import {withTemplate} from '../web/src/logic.mjs';

const flat=(seconds,level=.01)=>Array.from({length:seconds*2},(_,i)=>({time:i/2,rms:level}));

test('raw moments: the loudest stretches, setup before the peak, never overlapping',()=>{
 const energy=flat(1200);for(const [t,l] of [[300,.08],[310,.07],[800,.09],[100,.05]])for(let k=0;k<4;k++)energy[t*2+k].rms=l;
 const picks=rawMoments({energy,duration:1200,count:3});
 assert.equal(picks.length,3);assert.deepEqual(picks.map(p=>p.start),[...picks.map(p=>p.start)].sort((a,b)=>a-b));
 for(const p of picks)assert.equal(+(p.end-p.start).toFixed(2),30);
 for(let i=1;i<picks.length;i++)assert.ok(picks[i].start>=picks[i-1].end,'no overlap');
 const loud=picks.find(p=>p.start<=800&&p.end>=801);assert.ok(loud,'the loudest moment is picked');assert.ok(Math.abs(loud.start+loud.peakAt-800)<=2,'peak sits inside, after the setup');
 assert.ok(picks.some(p=>p.start<=300&&p.end>=310),'300 s and 310 s are one moment');
});
test('raw moments: on-screen action counts when the audio is flat; a short source is one clip',()=>{
 const action=Array.from({length:600},(_,t)=>t>=420&&t<430?4:0),picks=rawMoments({energy:flat(600),action,duration:600,count:1});
 assert.ok(picks[0].start<=425&&picks[0].end>=425);
 assert.deepEqual(rawMoments({energy:flat(20),duration:20,count:5}).map(p=>[p.start,p.end]),[[0,20]]);
 assert.equal(rawMoments({duration:0}).length,0);
});
test('raw moments: audio energy is read from the project WAV in 0.5 s bins',()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMP||os.tmpdir(),'raw-')),file=path.join(dir,'audio.wav'),samples=16000*3,data=Buffer.alloc(samples*2);
 for(let i=0;i<samples;i++)data.writeInt16LE(i>=16000&&i<24000?16384:0,i*2);
 const head=Buffer.alloc(44);head.write('RIFF',0);head.writeUInt32LE(36+data.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(16000,24);head.writeUInt32LE(32000,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(data.length,40);
 fs.writeFileSync(file,Buffer.concat([head,data]));const e=audioEnergy(file);fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(e.length,6);assert.equal(e[2].time,1);assert.equal(e[2].rms,.5);assert.equal(e[0].rms,0);assert.equal(e[3].rms,0);
});
test('raw clip template: no captions, pauses kept, and switching templates turns it off',()=>{
 const raw=EDIT_TEMPLATES.find(t=>t.id==='raw-clip');assert.equal(raw.group,'raw');
 const o=validateOptions(applyTemplate('raw-clip',{outputFormat:'video'}));assert.equal(o.rawClip,true);assert.equal(o.keepPauses,true);assert.equal(o.captionsEnabled,false);assert.equal(o.outputFormat,'video','the chosen shape survives the template');
 assert.equal(validateOptions({rawClip:true,captionsEnabled:true}).captionsEnabled,false);
 const back=applyTemplate('context-hit',o);assert.equal(back.rawClip,false);assert.equal(back.outputFormat,'video');
 const web=withTemplate(withTemplate({outputFormat:'video'},raw,{remember:false}),EDIT_TEMPLATES[0],{remember:false});assert.equal(web.rawClip,false);assert.equal(web.outputFormat,'video');
 assert.throws(()=>validateOptions({rawClip:'yes'}),/rawClip/);
});
test('raw clips play their whole range: no words means no pause trimming',()=>{
 const edl=buildClipEdl([],{start:10,end:40},{keepPauses:true});assert.deepEqual(edl.map(s=>[s.start,s.end]),[[10,40]]);
 const job={title:'Speed Beating GTA 6 Right Now',options:{}},clip=rawClip(job,{start:3725,end:3755,peakAt:18,score:70,loud:2,action:0});
 assert.equal(clip.title,'Speed Beating GTA 6 Right Now (1:02:05)');assert.equal(rawTitle({title:''},5),'Stream moment (0:05)');assert.deepEqual(clip.words,[]);assert.ok(clip.reasons.some(r=>/Loud/.test(r)));
});
test('raw projects: the stream timeline suggests loud moments instead of speech picks',()=>{
 const energy=flat(900);for(let k=0;k<6;k++)energy[1000+k].rms=.1;
 const out=streamCandidates({title:'Stream',options:{},metadata:{duration:900}},{raw:true,words:[],energy,duration:900},{folder:path.join(os.tmpdir(),'no-such-project')});
 assert.ok(out.length>5);assert.ok(out.some(c=>c.start<=500&&c.end>=502));assert.ok(out.every(c=>c.category==='highlight'&&c.title));
});
test('video cutter: parts are checked against the video and framed to the chosen shape',()=>{
 const cut=validateCut({segments:[{start:10,end:20},{start:100.5,end:101.25}],format:'shorts',title:'  My cut  '},600);
 assert.equal(cut.framing,'fill');assert.equal(cut.title,'My cut');assert.equal(cut.total,10.75);
 assert.equal(validateCut({segments:[{start:0,end:5}],format:'video'},600).framing,'fit');
 assert.throws(()=>validateCut({segments:[],format:'video'},600),/at least one part/);
 assert.throws(()=>validateCut({segments:[{start:10,end:10.2}],format:'video'},600),/Part 1/);
 assert.throws(()=>validateCut({segments:[{start:590,end:700}],format:'video'},600),/inside the video/);
 assert.throws(()=>validateCut({segments:[{start:0,end:5}],format:'square'},600),/portrait or landscape/);
 const graph=cutGraph(cut.segments,{width:1080,height:1920,framing:'fill'});
 assert.match(graph,/\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[v\]\[a\]/);assert.match(graph,/crop=1080:1920/);assert.match(graph,/atrim=duration=0\.750/);
 assert.equal(frameFilter('0:v','f0',{width:1920,height:1080,framing:'fit'}).length,4);
});

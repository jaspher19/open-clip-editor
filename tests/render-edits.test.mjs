import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {CACHE} from '../server/config.mjs';
import {buildClipEdl,clockEdl,retimeWords,placeEffects,cleanCuts,payoffTime} from '../server/edl.mjs';import {validateOptions} from '../server/options.mjs';
import {writeEffects,manualEffectsAss,listSounds,soundFile} from '../server/effects.mjs';import {zoomFilter} from '../server/templates.mjs';import {musicPath} from '../server/render.mjs';
// One word per second, 0.6 s long, from 0 to 40 s: easy to reason about which words survive an edit.
const words=Array.from({length:40},(_,i)=>({start:i,end:i+.6,text:`w${i}`})),clip={start:0,end:30};
const plain=o=>({threshold:2,padding:.1,...o});
const frameExact=edl=>edl.every((s,i)=>s.samples===s.frames*1600&&Math.abs(s.outputEnd-s.outputStart-s.frames/30)<1e-9&&(!i||Math.abs(s.outputStart-edl[i-1].outputEnd)<1e-9));
test('owner cuts remove the middle; words mostly inside a cut go with it and no kept word is split',()=>{
 const edl=clockEdl(buildClipEdl(words,{...clip,cuts:[{start:10.5,end:11.9}]},plain()));assert.ok(frameExact(edl));
 const kept=retimeWords(words,edl).map(w=>w.text);assert.ok(!kept.includes('w11')&&kept.includes('w10')&&kept.includes('w12'),'w10 is barely in the cut so it stays; w11 is inside and goes');
 assert.ok(edl.every(s=>!(s.start<11.5&&s.end>11.5)),'nothing inside the cut plays');
 const full=clockEdl(buildClipEdl(words,clip,plain()));assert.ok(edl.at(-1).outputEnd<full.at(-1).outputEnd-.9);
 const {cuts}=cleanCuts([{start:10.3,end:12.2}],words,{start:0,end:30});assert.deepEqual(cuts,[{start:10.6,end:12}],'cut shrinks to the gap between kept words');
});
test('extra parts play after the main range, in order, with their own captions',()=>{
 const edl=clockEdl(buildClipEdl(words,{start:0,end:10,parts:[{start:33,end:37},{start:20,end:23}]},plain()));assert.ok(frameExact(edl));
 const order=edl.map(s=>Math.floor(s.start));assert.ok(order.indexOf(33)>order.indexOf(0)&&order.indexOf(20)>order.indexOf(33));
 const r=retimeWords(words,edl);assert.ok(r.find(w=>w.text==='w34').start<r.find(w=>w.text==='w21').start,'part 1 captions come before part 2');
 assert.ok(buildClipEdl(words,{start:0,end:10,parts:[{start:33,end:33.5}]},plain()).every(s=>s.start<10.5),'parts under 2 s are ignored');
});
test('freeze holds a frame and replay repeats the window in slow motion right after it, both with exact clocks',()=>{
 const effects=[{id:'f',type:'freeze',at:5.3,duration:.9},{id:'r',type:'replay',at:15,duration:2}];
 const edl=clockEdl(buildClipEdl(words,{...clip,effects},plain()));assert.ok(frameExact(edl));
 const freeze=edl.find(s=>s.kind==='freeze');assert.equal(freeze.frames,27);assert.equal(freeze.start,5.6,'freeze snaps to the end of the word it lands in');
 const replay=edl.find(s=>s.kind==='replay');assert.equal(replay.speed,.6);assert.ok(Math.abs(replay.start-13.5)<1e-9);assert.equal(replay.end,15.6,'the window ends on a word end');assert.equal(replay.frames,Math.ceil(2.1/.6*30-1e-7));
 const i=edl.indexOf(replay);assert.equal(edl[i-1].end,15.6,'replay follows the moment');assert.equal(edl[i+1].start,15.6);
 const r=retimeWords(words,edl),w15=r.filter(w=>w.text==='w15');assert.equal(w15.length,1,'replayed words are captioned once');assert.ok(r.every(w=>!(w.start>replay.outputStart+.01&&w.end<replay.outputEnd-.01)),'no captions during the replay');
 const placed=placeEffects([...effects,{id:'z',type:'zoom',at:20.2},{id:'gone',type:'shake',at:40}],edl);
 assert.deepEqual(placed.map(p=>p.id),['f','r','z']);
 const gap=clockEdl(buildClipEdl(words,{...clip,cuts:[{start:3.1,end:3.9}]},plain({threshold:.2}))),snapped=placeEffects([{id:'g',type:'pop',at:8.8},{id:'c',type:'pop',at:3.5}],gap,{cuts:[{start:3.1,end:3.9}]});
 assert.deepEqual(snapped.map(p=>p.id),['g'],'effects in owner cuts are dropped');const next=gap.find(x=>x.start>8.8);assert.ok(Math.abs(snapped[0].out-next.outputStart)<1e-9,'an effect in dead air snaps to the next speech');assert.equal(placed[0].out,freeze.outputStart);assert.ok(Math.abs(placed[0].dur-.9)<1e-9);
 const seg=edl.find(s=>s.kind==='main'&&s.start<=20.2&&s.end>=20.2);assert.ok(Math.abs(placed[2].out-(seg.outputStart+20.2-seg.start))<1e-9);
});
test('cold open puts a teaser of the payoff first; captions start with the real clip',()=>{
 const edl=clockEdl(buildClipEdl(words,{...clip,peakAt:20},plain({coldOpen:true,coldOpenSeconds:1.6})));assert.ok(frameExact(edl));
 assert.equal(edl[0].kind,'cold');assert.ok(Math.abs(edl[0].end-edl[0].start-1.6)<1e-9);assert.ok(edl[0].start<=20&&edl[0].end>=20);
 const r=retimeWords(words,edl);assert.ok(r[0].start>=edl[0].outputEnd,'no captions on the teaser');assert.equal(r[0].text,'w0');
 assert.equal(payoffTime({...clip,effects:[{type:'replay',at:12}]},{}),12,'the first replay is the payoff');assert.equal(payoffTime(clip,{coldOpenAt:7}),7);assert.equal(payoffTime(clip,{}),19.5);
 const loop=buildClipEdl(words,{start:0,end:12},plain({loopEnding:true}));assert.ok(Math.abs(loop.at(-1).end-11.64)<1e-9,'loop ending stops right after the last word');
});
test('new settings validate with contract defaults and reject unsafe music names',()=>{
 const o=validateOptions({});assert.equal(o.autoEffects,true);assert.equal(o.coldOpen,false);assert.equal(o.coldOpenSeconds,1.6);assert.equal(o.coldOpenAt,null);assert.equal(o.profanityAudio,'keep');assert.equal(o.cropX,null);assert.equal(o.musicTrack,'');
 for(const bad of [{coldOpenSeconds:5},{cropX:1.5},{profanityAudio:'bleep'},{musicTrack:'../.env'},{musicTrack:'a/b.mp3'},{coldOpen:'yes'}])assert.throws(()=>validateOptions(bad));
 assert.equal(validateOptions({musicTrack:'Chill Beat (loop).mp3',cropX:.3}).cropX,.3);
 assert.throws(()=>musicPath({},{musicTrack:'missing-track.mp3'}),/no longer in the music library/);assert.equal(musicPath({},{musicTrack:''}),null);
});
test('manual effects: overlays, chosen sounds, beeps and manual zooms',()=>{
 const ass=manualEffectsAss([{type:'flash',out:1,dur:.25},{type:'freeze',out:2,dur:.9},{type:'replay',out:4,dur:3},{type:'pop',out:8,dur:.9,text:'no way',emoji:'😱'}]);
 assert.match(ass,/WAIT FOR IT…/);assert.match(ass,/REPLAY/);assert.match(ass,/NO WAY/);assert.match(ass,/😱/);assert.match(ass,/\\1a&H08&\\t\(0,250,\\1a&HFF&\)/);
 const folder=fs.mkdtempSync(path.join(CACHE,'render-edits-'));try{const file=path.join(folder,'fx.wav');writeEffects(file,[],4,{soundEffects:'off',cues:[{at:1,sound:'meme/boom'},{at:3.6,sound:'nope/x'}],beeps:[{start:3,end:3.3}]});
  const b=fs.readFileSync(file),off=b.indexOf('data')+8,at=t=>Math.abs(b.readInt16LE(off+Math.round(t*48000)*2));let loudBoom=0,loudBeep=0;for(let i=0;i<4800;i++){loudBoom=Math.max(loudBoom,at(1+i/48000));loudBeep=Math.max(loudBeep,at(3.05+i/96000));}
  assert.ok(loudBoom>1000,'the boom is audible');assert.ok(loudBeep>3000,'the beep covers the word');assert.equal(at(.5),0);assert.equal(at(3.7),0,'unknown sounds are skipped');}finally{fs.rmSync(folder,{recursive:true,force:true});}
 assert.ok(listSounds().some(s=>s.id==='meme/boom')&&listSounds().some(s=>s.id==='impact/hit_01'));assert.equal(soundFile('../config'),null);assert.equal(soundFile('meme/../../.env'),null);
 assert.match(zoomFilter({punchIn:false},[],[{out:2,dur:.5}]),/between\(on\/30,2\.000,2\.500\)\*0\.18/);assert.equal(zoomFilter({punchIn:true,autoEffects:false},[1,2]),'','auto punch-ins follow autoEffects');
});

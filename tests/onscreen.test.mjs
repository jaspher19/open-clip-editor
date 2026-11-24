import test from 'node:test';import assert from 'node:assert/strict';
import {screenText,stripLinks} from '../server/onscreen.mjs';import {makeAss} from '../server/captions.mjs';import {validateOptions} from '../server/options.mjs';

test('on-screen text: links and the bare stream title never reach the video',()=>{
 const job={title:'🔴 BEATING GTA 6 RIGHT NOW 100% (FINAL MISSION)'};
 assert.equal(screenText('https://www.youtube.com/watch?v=BXuVBw88ELc',job),'');
 assert.equal(screenText('Lacy gets lost https://youtu.be/abc',job),'Lacy gets lost');
 assert.equal(screenText('Watch on twitch.tv/lacy',job),'Watch on');
 assert.equal(screenText('BEATING GTA 6 RIGHT NOW 100% (FINAL MISSION)',job),'','the stream title, without its emoji');
 assert.equal(screenText('GTA VI FINALE',{title:'GTA VI FINALE'}),'');assert.equal(screenText('GTA 6 MARATHON DAY 1',{title:'GTA 6 MARATHON DAY 1 2026-11-21 14:44'}),'','Twitch date stamp');
 assert.equal(screenText('Lacy finds the plane in GTA 6',job),'Lacy finds the plane in GTA 6','normal hooks stay');
 assert.equal(stripLinks('  '),'');
});
test('options: a pasted link is dropped from the on-screen context; dragged caption positions are checked',()=>{
 assert.equal(validateOptions({contextText:'https://www.youtube.com/watch?v=BXuVBw88ELc'}).contextText,'');
 assert.equal(validateOptions({contextText:'Costume contest www.example.com'}).contextText,'Costume contest');
 const o=validateOptions({captionX:.95,captionY:.3});assert.deepEqual([o.captionX,o.captionY],[.85,.3]);
 assert.deepEqual([validateOptions({}).captionX,validateOptions({}).captionY],[null,null]);assert.throws(()=>validateOptions({captionY:'top'}),/captionY/);
});
const words=[{start:.2,end:.5,text:'no'},{start:.5,end:.9,text:'way'},{start:.9,end:1.3,text:'bro'}];
const dialogue=ass=>ass.split('\n').filter(l=>l.startsWith('Dialogue'));
test('captions: a dragged position centres the captions on that point; titles stay where they were',()=>{
 const base=makeAss(words,{style:'clean',title:'Lacy gets lost',hookEnabled:true,duration:3,captionPosition:'lower'});
 const moved=makeAss(words,{style:'clean',title:'Lacy gets lost',hookEnabled:true,duration:3,captionPosition:'lower',captionX:.3,captionY:.4});
 const caps=ass=>dialogue(ass).filter(l=>/,Default,/.test(l)&&!l.includes('\\p1'));
 assert.ok(caps(moved).length&&caps(moved).every(l=>l.includes('\\an5\\pos(324,')),'centred at 30% across');
 const y=Number(caps(moved)[0].split('\\pos(324,')[1].split(')')[0]);assert.ok(Math.abs(y-768)<60,`about 40% down (${y})`);
 const titles=ass=>dialogue(ass).filter(l=>/,Title,/.test(l));assert.deepEqual(titles(moved),titles(base),'the title does not move');
 assert.deepEqual(makeAss(words,{style:'clean',duration:3}),makeAss(words,{style:'clean',duration:3,captionX:null,captionY:null}),'no drag: unchanged');
});

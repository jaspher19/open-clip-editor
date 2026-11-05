import test from 'node:test';import assert from 'node:assert/strict';
import {buildEdl,retimeWords} from '../server/edl.mjs';
import {groupWords,makeAss} from '../server/captions.mjs';
import {pickClips,validateCandidates} from '../server/selection.mjs';
import {parseYouTubeUrl} from '../server/ingest.mjs';
import {validateOptions} from '../server/options.mjs';
const words=(n=120)=>Array.from({length:n},(_,i)=>({start:i*.4,end:i*.4+.27,text:(i%20===0?'How':i%20===19?'works.':'word')}));
test('EDL removes dead air without clipping spoken words',()=>{
 const w=[{start:1,end:2,text:'Hello.'},{start:5,end:6,text:'Again.'}];
 const e=buildEdl(w,{start:0,end:8,threshold:.6,padding:.12,silences:[{start:2,end:5}]});
 assert.equal(e.length,2);assert.ok(e[0].start<1&&e[0].end>2);assert.ok(e[1].start<5&&e[1].end>6);
 assert.equal(e[0].outputStart,0);assert.equal(e[1].outputStart,e[0].outputEnd);assert.ok(e.at(-1).outputEnd<3);
 const mapped=retimeWords(w,e);assert.equal(mapped.length,2);assert.ok(mapped[1].start-mapped[0].end<.6);assert.ok(mapped.every(x=>x.start>=0&&x.end>x.start));
});
test('EDL trims leading/trailing silence and does not invent speech',()=>{
 assert.deepEqual(buildEdl([],{start:0,end:20}),[]);
 assert.throws(()=>buildEdl(words(),{start:10,end:2}),/range/i);
 const e=buildEdl([{start:5,end:6,text:'real'}],{start:0,end:30});assert.ok(e[0].start>4.7&&e.at(-1).end<6.3);
});
test('caption grouping never crosses a sentence or long gap',()=>{
 const w=[{start:0,end:.2,text:'Hi.'},{start:.3,end:.5,text:'New'},{start:.6,end:.8,text:'idea'},{start:3,end:3.3,text:'Next'}];
 const groups=groupWords(w);assert.deepEqual(groups.map(g=>g.map(w=>w.text)),[['Hi.'],['New','idea'],['Next']]);
});
test('ASS captions highlight each observed word and escape control text',()=>{
 const a=makeAss([{start:0,end:.3,text:'hello'},{start:.4,end:.7,text:'{\\an8}'}],{style:'clean'});
 assert.match(a,/PlayResX: 1080/);assert.match(a,/PlayResY: 1920/);assert.match(a,/hello/);assert.match(a,/Dialogue:/);assert.ok(!a.includes('} {\\an8}'));
 const lines=a.split('\n').filter(l=>l.startsWith('Dialogue:'));assert.equal(lines.length,2);assert.ok(lines.every(l=>!l.includes('NaN')));
});
test('heuristic picker returns non-overlapping sentence-aligned candidates',()=>{
 const transcript={duration:240,words:words(600),energy:[]};const c=pickClips(transcript,{count:5,minDuration:20,maxDuration:60});
 assert.ok(c.length>=3&&c.length<=5);assert.ok(c.every(x=>x.end-x.start>=20&&x.end-x.start<=60&&x.score>=0&&x.score<=100));
 for(let i=0;i<c.length;i++)for(let j=i+1;j<c.length;j++)assert.ok(Math.max(0,Math.min(c[i].end,c[j].end)-Math.max(c[i].start,c[j].start))<4);
 assert.deepEqual(pickClips({duration:60,words:[],energy:[]}),[]);
});
test('provider windows cannot escape source bounds or contain invalid numbers',()=>{
 assert.throws(()=>validateCandidates([{start:NaN,end:40}],60),/invalid/i);
 assert.throws(()=>validateCandidates([{start:-1,end:45}],60),/invalid/i);
 assert.throws(()=>validateCandidates([{start:10,end:80}],60),/invalid/i);
 assert.equal(validateCandidates([{start:0,end:30,title:'Test',hook:'How'}],60).length,1);
});
test('YouTube parser accepts individual videos and rejects arbitrary URLs and playlists',()=>{
 assert.equal(parseYouTubeUrl('https://www.youtube.com/watch?v=R6gKMvetXUU').id,'R6gKMvetXUU');
 assert.equal(parseYouTubeUrl('https://youtu.be/R6gKMvetXUU?t=5').url,'https://www.youtube.com/watch?v=R6gKMvetXUU');
 assert.equal(parseYouTubeUrl('https://youtube.com/shorts/R6gKMvetXUU').id,'R6gKMvetXUU');
 for(const url of ['http://127.0.0.1/','file:///etc/passwd','https://youtube.com.evil.test/watch?v=R6gKMvetXUU','https://youtube.com/playlist?list=abc','https://youtube.com/watch?v=nope'])assert.throws(()=>parseYouTubeUrl(url),/YouTube/i);
});
test('render options reject NaN, unsupported styles and surprising types',()=>{
 assert.equal(validateOptions({}).style,'clean');assert.equal(validateOptions({}).picker,'heuristic');
 assert.throws(()=>validateOptions({threshold:NaN}),/threshold/i);assert.throws(()=>validateOptions({style:';bad'}),/style/i);assert.throws(()=>validateOptions({count:100}),/count/i);assert.throws(()=>validateOptions({punchIn:'false'}),/punchIn/i);
});

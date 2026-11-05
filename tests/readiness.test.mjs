import test from 'node:test';import assert from 'node:assert/strict';
import {readiness,playLength,outputTime} from '../web/src/readiness.mjs';
const job={host:{name:'Kai Cenat',short:'Kai'},options:{outputFormat:'shorts'}};
const talk=(from,to,text='word')=>{const out=[];for(let t=from;t<to;t+=.5)out.push({start:t,end:t+.4,text});return out;};
const good={id:'a',start:100,end:150,title:'Kai Cenat Loses It Over a Fake Spider',hook:'Kai Loses It',settings:{hookText:'Kai Loses It',hookEnabled:true,captionsEnabled:true},words:[{start:100.2,end:100.5,text:'No'},{start:100.6,end:101,text:'way!'},...talk(101,150)],dirty:false};
const check=(r,id)=>r.checks.find(c=>c.id===id);

test('a tight, exported who-did-what clip is ready',()=>{
 const r=readiness(good,job,{clipId:'a'});assert.equal(r.ok,true);assert.equal(r.failed,0);assert.equal(r.warned,0,JSON.stringify(r.checks.filter(c=>!c.pass)));
});
test('fails what blocks posting and warns about what loses viewers',()=>{
 const slow={...good,words:talk(104,130),title:'word word word word',hook:'This is a very long hook text',settings:{...good.settings,hookText:'This is a very long hook text',captionsEnabled:false},dirty:true};
 const r=readiness(slow,job,{clipId:'a'});assert.equal(r.ok,false);
 assert.equal(check(r,'speech').level,'fail');assert.match(check(r,'speech').label,/4\.0 s/);assert.equal(check(r,'export').level,'fail');
 for(const id of ['hook','captions','title','opening'])assert.equal(check(r,id).level,'warn',id);
 assert.equal(check(readiness({...good,settings:{...good.settings,hookText:'Speed Wins'}},job,{}),'hook').level,'warn','a hook that names nobody from the stream');
 assert.equal(check(readiness(good,job),'export').level,'fail','never exported');
});
test('cuts, parts, cold open, freezes and replays change the played length and the first-words time',()=>{
 const cut={...good,words:talk(104,130),cuts:[{start:100,end:103.8}]};
 assert.ok(Math.abs(outputTime(cut,104)-.2)<1e-9);assert.equal(check(readiness(cut,job,{}),'speech').level,'pass','the silent start was cut');
 assert.ok(Math.abs(playLength({...good,cuts:[{start:110,end:115}],parts:[{start:300,end:310}],effects:[{type:'freeze',at:120,duration:1},{type:'replay',at:125,duration:1.2}],settings:{coldOpen:true,coldOpenSeconds:2}})-(9.92+35+10+1+2+2))<1e-6,'pauses and edges tighten; a part without speech counts in full');
 assert.equal(check(readiness({...good,end:170,words:talk(100,170)},job,{}),'length').level,'fail');assert.equal(check(readiness({...good,end:130,words:talk(100,130)},job,{}),'length').level,'warn','Shorts under 40 s lack setup');
 assert.equal(check(readiness({...good,end:130,words:talk(100,130),settings:{...good.settings,outputFormat:'video'}},job,{}),'length').level,'pass');
 assert.equal(check(readiness({...good,end:175,words:[...talk(100,130),...talk(146,175)]},job,{}),'length').level,'pass','a 75 s window with a 16 s pause plays under a minute');
 assert.equal(check(readiness({...good,words:talk(105,130)},job,{}),'speech').level,'fail');assert.equal(check(readiness({...good,words:talk(105,130),settings:{...good.settings,coldOpen:true}},job,{}),'speech').level,'pass');
});
test('quote titles are flagged; clips without word timings still get a result',()=>{
 assert.equal(check(readiness({...good,title:'“No way!”'},job,{}),'title').level,'warn');
 assert.equal(check(readiness({...good,title:'No way word word',sourceContext:{transcript:'No way word word word'}},job,{}),'title').level,'warn');
 const bare=readiness({id:'b',start:0,end:30,title:'Kai Wins',hook:'Kai Wins',settings:{}},{},{});assert.equal(check(bare,'speech').level,'warn');assert.equal(bare.checks.length,7);
});

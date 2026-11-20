import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {CACHE} from '../server/config.mjs';import {validateOptions} from '../server/options.mjs';
import {scanMode,draftModel,mergeRanges,uncovered,mergeTranscript,scanRegions,fastScan,ensureTranscribed,hotBudget,FAST_AFTER,PAD_BEFORE,PAD_AFTER} from '../server/scan.mjs';

const tmp=name=>{fs.mkdirSync(CACHE,{recursive:true});return fs.mkdtempSync(path.join(CACHE,`${name}-`));};
test('scan mode: long streams get the fast scan unless the owner asks for a full transcript',()=>{
 assert.equal(scanMode(validateOptions({}),FAST_AFTER+1),'fast');assert.equal(scanMode(validateOptions({}),FAST_AFTER),'full');
 assert.equal(scanMode(validateOptions({scan:'full'}),FAST_AFTER*5),'full');assert.equal(scanMode(validateOptions({scan:'fast'}),600),'fast');
 assert.throws(()=>validateOptions({scan:'quick'}),/Invalid scan/);
 assert.equal(draftModel({model:'small.en',language:'auto'}),'base.en');assert.equal(draftModel({model:'small',language:'en'}),'base.en');assert.equal(draftModel({model:'small',language:'es'}),'base');
 assert.equal(hotBudget(36000),1200);assert.equal(hotBudget(600),300);
});
test('ranges: merging, gaps in coverage, and words added on demand',()=>{
 assert.deepEqual(mergeRanges([{start:50,end:80},{start:-5,end:10},{start:79,end:100},{start:200,end:200.2}],{duration:90}),[{start:0,end:10},{start:50,end:90}]);
 const t={words:[{start:10,end:10.5,text:'a'},{start:110,end:110.5,text:'b'}],segments:[],coverage:[[0,60],[100,160]]};
 assert.deepEqual(uncovered(t,50,120),[{start:60,end:100}]);assert.deepEqual(uncovered(t,0,60),[]);assert.deepEqual(uncovered({words:[]},0,500),[],'a full transcript covers everything');
 const merged=mergeTranscript(t,{words:[{start:70,end:70.4,text:'new'}],segments:[{start:70,end:70.4,text:'new'}],coverage:[[60,100]]});
 assert.deepEqual(merged.words.map(w=>w.text),['a','new','b']);assert.deepEqual(merged.coverage,[[0,160]]);
});
// A synthetic draft: flat chatter with one reaction around 40 min.
function draft(minutes=180){const words=[];let t=0;while(t<minutes*60){const hot=t>2400&&t<2430;words.push({start:+t.toFixed(2),end:+(t+.3).toFixed(2),text:hot?(words.length%3?'hahaha':'no way!'):'word'});if(words.length%9===0)words.at(-1).text+='.';t+=.55;}return {words,duration:minutes*60,energy:[]};}
test('scan regions: the draft’s candidates are padded and joined with the loud/busy hot spots',()=>{
 const d=draft(),{candidates,regions}=scanRegions(d,validateOptions({}),{people:{host:null,named:[]},hot:[{start:9000,end:9120}],duration:d.duration});
 assert.ok(candidates.length>=3&&candidates.length<=30);
 assert.ok(regions.some(r=>r.start<=2400&&r.end>=2430),'the reaction is covered');assert.ok(regions.some(r=>r.start<=9000&&r.end>=9120),'the hot spot is covered');
 const top=candidates[0];assert.ok(regions.some(r=>r.start<=Math.max(0,top.start-PAD_BEFORE)+1e-6&&r.end>=top.end+PAD_AFTER-1e-6),'with padding');
 assert.ok(regions.reduce((n,r)=>n+r.end-r.start,0)<d.duration*.5,'far less than the whole stream');
});
test('fast scan: draft, hot spots, then only the chosen windows; finished steps are not redone',async()=>{
 const folder=tmp('scan');const calls=[];const d=draft();
 const runWorker=async(name,args)=>{calls.push([name,args]);
  if(name==='hotspots.py')fs.writeFileSync(args[2],JSON.stringify({regions:[{start:9000,end:9120}]}));
  else if(args.includes('--draft'))fs.writeFileSync(args[1],JSON.stringify(d));
  else{const regions=JSON.parse(fs.readFileSync(args[args.indexOf('--regions')+1],'utf8'));fs.writeFileSync(args[1],JSON.stringify({words:regions.flatMap(r=>[0,1,2].map(i=>({start:r.start+i,end:r.start+i+.5,text:'w'}))),segments:[],coverage:regions.map(r=>[r.start,r.end]),duration:d.duration,language:'en'}));}
  return {stdout:''};};
 const job={options:validateOptions({model:'small.en'}),sourcePath:path.join(folder,'source.mp4'),source:{type:'twitch',kind:'video'}},messages=[];
 const out=await fastScan(job,folder,{audio:'audio.wav',duration:d.duration,runWorker,update:(p,m)=>messages.push([p,m])});
 assert.deepEqual(calls.map(c=>c[0]),['transcribe.py','hotspots.py','transcribe.py','transcribe.py','transcribe.py'],'the draft, the scan, the final pass in three parallel groups');
 const [,draftArgs]=calls[0];assert.ok(draftArgs.includes('--draft'));assert.equal(draftArgs[draftArgs.indexOf('--model')+1],'base.en');assert.ok(!draftArgs.includes('--regions'),'the draft covers the whole stream');
 const finals=calls.slice(2).map(c=>c[1]);assert.ok(finals.every(a=>a[a.indexOf('--threads')+1]==='4'));
 const transcript=JSON.parse(fs.readFileSync(path.join(folder,'transcript.json'),'utf8')),regions=JSON.parse(fs.readFileSync(path.join(folder,'scan-regions.json'),'utf8'));
 assert.deepEqual(transcript.coverage,regions.map(r=>[r.start,r.end]),'the joined transcript covers every window');assert.equal(transcript.words.length,regions.length*3);assert.ok(transcript.words.every((w,i)=>!i||w.start>=transcript.words[i-1].start));
 assert.deepEqual(fs.readdirSync(folder).filter(f=>/^(transcript-part|scan-regions-)/.test(f)),[],'part files are removed');
 const finalArgs=finals[0];assert.equal(finalArgs[finalArgs.indexOf('--model')+1],'small.en');assert.ok(finalArgs.includes('--regions'));assert.ok(!finalArgs.includes('--draft'));
 assert.equal(out.mode,'fast');assert.ok(out.coveredSeconds<d.duration*.5);assert.ok(messages.every(([p])=>p>=0&&p<=1));
 // A retry after the draft and scan finished goes straight to the final pass.
 fs.rmSync(path.join(folder,'transcript.json'));calls.length=0;await fastScan(job,folder,{audio:'audio.wav',duration:d.duration,runWorker});assert.deepEqual(calls.map(c=>c[0]),['transcribe.py','transcribe.py','transcribe.py']);
});
test('on demand: a range outside the fast-scan coverage is transcribed and merged, once',async()=>{
 const folder=tmp('ondemand');fs.writeFileSync(path.join(folder,'transcript.json'),JSON.stringify({words:[{start:10,end:10.4,text:'old'}],segments:[],coverage:[[0,100]],duration:3600}));let runs=0;
 const runWorker=async(name,args)=>{runs++;const regions=JSON.parse(fs.readFileSync(args[args.indexOf('--regions')+1],'utf8'));assert.deepEqual(regions,[{start:900-PAD_BEFORE,end:1000+PAD_AFTER}],'only the missing part, with context');
  fs.writeFileSync(args[1],JSON.stringify({words:[{start:950,end:950.5,text:'fresh'}],segments:[],coverage:regions.map(r=>[r.start,r.end])}));return {stdout:''};};
 const job={options:validateOptions({}),metadata:{duration:3600}};
 assert.equal(await ensureTranscribed(job,folder,900,1000,{runWorker}),true);
 const t=JSON.parse(fs.readFileSync(path.join(folder,'transcript.json'),'utf8'));assert.deepEqual(t.words.map(w=>w.text),['old','fresh']);assert.deepEqual(t.coverage,[[0,100],[875,1015]]);
 assert.equal(await ensureTranscribed(job,folder,920,990,{runWorker}),false);assert.equal(runs,1);
 assert.deepEqual(fs.readdirSync(folder),['transcript.json'],'temporary files are removed');
});
test('final pass groups: windows split into three groups of about equal length',async()=>{
 const {balancedGroups}=await import('../server/scan.mjs');const r=[{start:0,end:100},{start:200,end:500},{start:600,end:700},{start:900,end:1300},{start:1400,end:1500}];
 const g=balancedGroups(r),len=x=>x.reduce((n,y)=>n+y.end-y.start,0);assert.equal(g.length,3);assert.deepEqual(g.map(len).sort(),[300,300,400]);
 assert.deepEqual(g.flat().map(x=>x.start).sort((a,b)=>a-b),r.map(x=>x.start),'every window once');assert.ok(g.every(x=>x.every((y,i)=>!i||y.start>x[i-1].start)),'stream order inside a group');
 assert.equal(balancedGroups([{start:0,end:300}]).length,1,'short scans stay in one process');
});
test('coverage clamp: a word whose end ran into a later window is cut at its own window’s end',async()=>{
 const {clampToCoverage}=await import('../server/scan.mjs');const cov=[[700,800],[3400,3500]];
 // The real case: "fuck" at 765.97 with its end mapped to 3479.68.
 assert.deepEqual(clampToCoverage([{start:765.97,end:3479.684,text:'fuck'},{start:710,end:710.4,text:'ok'},{start:900,end:901,text:'stray'}],cov),[{start:765.97,end:800,text:'fuck'},{start:710,end:710.4,text:'ok'}]);
 assert.deepEqual(clampToCoverage([{start:1,end:2}],undefined),[{start:1,end:2}],'a full transcript is left alone');
});

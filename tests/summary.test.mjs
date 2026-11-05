import test from 'node:test';import assert from 'node:assert/strict';
import {findMoments,planSummary,summaryChapters,summaryMetadata,SUMMARY_FORMATS} from '../server/summary.mjs';

// A 10-minute "stream": filler sentences, plus a laugh at ~100 s, a loud hype burst at ~300 s and a "clip that" at ~450 s.
function stream(){
 const words=[],filler=['so','we','are','just','walking','around','the','city','right','now.'];let t=0;
 const say=list=>{for(const w of list){words.push({start:+t.toFixed(2),end:+(t+.3).toFixed(2),text:w});t+=.4;}};
 while(t<600){if(t>=100&&t<101)say('haha haha that was so funny lol haha I am dying.'.split(' '));else if(t>=300&&t<301)say("let's go no way oh my god that was insane!".split(' '));else if(t>=450&&t<451)say('wait clip that chat clip that right now that was it.'.split(' '));else say(filler);}
 const energy=[];for(let s=0;s<600;s+=.5)energy.push({time:s,rms:s>=300&&s<318?.2:.02});
 return {words,energy,duration:600};
}
test('stream moments are scored as fun, worth-it and clippable from words and loudness',()=>{
 const moments=findMoments(stream(),{format:'video'}),near=(t,cat)=>moments.filter(m=>m.start<=t+2&&m.end>=t).sort((a,b)=>b.score-a.score)[0]?.category;
 assert.equal(near(101,'funny'),'funny');assert.equal(near(301),'highlight');assert.equal(near(451),'clippable');
 const {minSeg,maxSeg}=SUMMARY_FORMATS.video;assert.ok(moments.every(m=>m.kept>=minSeg-.01&&m.kept<=maxSeg+.01),'trimmed length stays in range');
});
test('a summary plan fills the length budget with non-overlapping moments in story order, spread across the stream',()=>{
 const transcript=stream();
 for(const [format,target] of [['video',120],['shorts',30]]){
  const plan=planSummary(findMoments(transcript,{format}),{format,targetSeconds:target,duration:600}),total=plan.reduce((a,m)=>a+m.end-m.start,0);
  const kept=plan.reduce((a,m)=>a+m.kept,0);assert.ok(plan.length>=2);assert.ok(kept<=target+SUMMARY_FORMATS[format].minSeg/2,`${format} stays within its budget`);assert.ok(kept>=target*.75,`${format} fills most of its budget after pause trimming`);assert.ok(plan.every(m=>m.kept<=m.end-m.start+.3&&m.kept>=SUMMARY_FORMATS[format].minSeg-.2));void total;
  assert.ok(plan.every((m,i)=>!i||m.start>=plan[i-1].end),'chronological and non-overlapping');assert.ok(plan.every(m=>m.label));
  if(format==='video'){assert.ok(['funny','highlight','clippable'].every(c=>plan.some(m=>m.category===c)),'all three kinds of moment made it in');assert.ok(plan.at(-1).start-plan[0].start>250,'covers the stream, not one stretch');}
 }
 assert.throws(()=>planSummary([],{format:'tiktok'}),/main video or Shorts/);
});
test('chapters follow YouTube rules and metadata lists them',()=>{
 const parts=[{label:'FUN MOMENT',title:'That was so funny',duration:20},{label:'WORTH IT',title:"Let's go <no way>",duration:31},{label:'CLIP THIS',title:'Clip that chat',duration:15.5}];
 const chapters=summaryChapters(parts);assert.deepEqual(chapters.map(c=>c.line),['0:00 That was so funny','0:20 Let\'s go no way','0:51 Clip that chat'],'chapters carry the title only, no category label');
 assert.deepEqual(summaryChapters(parts.slice(0,2)),[],'fewer than three chapters are omitted');
 assert.deepEqual(summaryChapters([...parts,{label:'WORTH IT',title:'x',duration:4},{label:'FUN MOMENT',title:'Last laugh',duration:12}]).map(c=>c.line),['0:00 That was so funny','0:20 Let\'s go no way','0:51 Clip that chat','1:10 Last laugh'],'a chapter under 10 s folds into the one before it');
 assert.deepEqual(summaryChapters([{label:'WORTH IT',title:'short opener',duration:6},...parts]).map(c=>c.time),[0,26,57],'a short opening chapter absorbs the next one so the list still starts at 0:00');
 const meta=summaryMetadata({title:'Halloween stream',source:{url:'https://youtu.be/R6gKMvetXUU'},options:{}},{format:'video',duration:66.5,moments:[{category:'funny',score:80,title:'a'},{category:'highlight',score:90,title:'b'}],chapters});
 assert.match(meta.title,/Halloween Stream Best Moments/);assert.match(meta.description,/0:20 Let's go no way/);assert.match(meta.description,/Full stream: https:\/\/youtu\.be/);assert.ok(!/[<>]/.test(meta.description));assert.ok(meta.tags.includes('highlights'));
});
test('summary moments get a short who-did-what hook on screen, not a transcript line',async()=>{
 const {nameMoments}=await import('../server/summary.mjs');
 const words='listen if you notice oh W costume but we were like we were like ya'.split(' ').map((text,i)=>({text,start:10+i*.4,end:10.3+i*.4}));
 const moments=[{start:9,end:20,category:'funny'}],stream={host:{name:'Kai Cenat',short:'Kai',evidence:'channel'},named:[],groups:[]};
 const content=JSON.stringify({clips:[{index:0,hook:'"we were like ya"',title:'Kai Cenat Shows Off His Halloween Costume',youtubeTitle:'Kai Cenat Shows Off His Halloween Costume at the Party',description:'d',hashtags:[],tags:[]}]});
 const fetchImpl=async()=>({ok:true,status:200,json:async()=>({model:'m',choices:[{message:{content}}]})});
 await nameMoments({title:'AMP HALLOWEEN PARTY',options:{}},moments,{words},stream,{env:{GROQ_API_KEY:'g'},fetchImpl});
 assert.equal(moments[0].title,'Kai Cenat Shows Off His Halloween Costume');assert.ok(!/["“]|we were like/.test(moments[0].hook),moments[0].hook);assert.match(moments[0].hook,/^Kai /);
});
test('the 16:9 summary has no on-screen title over the stream, and no per-moment cold opens',async()=>{
 const src=(await import('node:fs')).readFileSync(new URL('../server/summary.mjs',import.meta.url),'utf8');
 assert.match(src,/hookEnabled:format!=='video'/);assert.match(src,/coldOpen:false,loopEnding:false/);
});
test('working labels in the project name never reach the YouTube title',async()=>{
 const {sourceName}=await import('../server/context.mjs');
 assert.equal(sourceName('[TEST] 🎃AMP HALLOWEEN PARTY🎃'),'AMP HALLOWEEN PARTY');assert.equal(sourceName('Speed in Tokyo (copy)'),'Speed in Tokyo');
 const meta=summaryMetadata({title:'[TEST] 🎃AMP HALLOWEEN PARTY🎃',clips:[],options:{}},{format:'video',duration:600,moments:[],chapters:[],host:'Kai Cenat'});
 assert.ok(!/test/i.test(meta.title),meta.title);
});

import test from 'node:test';import assert from 'node:assert/strict';import {formatTime,trimError,downloadableIds,templateChanges,withTemplate,saveTweaks,loadTweaks,clock,parseClock,readyClips,projectTemplate,centerAt,cropBox,captionChunk,accentWord} from '../web/src/logic.mjs';
test('editor gives actionable finite and source-bound trim errors',()=>{
 assert.match(trimError(NaN,40,100),/number/i);assert.match(trimError(0,19,100),/20/);assert.match(trimError(0,95,200),/90/);assert.equal(trimError(0,75,200),'');assert.match(trimError(50,110,100),/source/);assert.equal(trimError(10,40,100),'');
 assert.equal(formatTime(61.2),'1:01.2');assert.equal(formatTime(0),'0:00.0');
});
test('downloads include only kept clips with current exports',()=>{
 const job={clips:[{id:'a',kept:true},{id:'b',kept:false},{id:'c',kept:true,dirty:true}],exports:[{clipId:'a'},{clipId:'b'},{clipId:'c'}]};assert.deepEqual(downloadableIds(job),['a']);
});
test('template changes list only settings that differ from the chosen template',()=>{
 const template={settings:{style:'gaming',vfx:'accent',punchZoom:1.12}};
 assert.deepEqual(templateChanges({style:'gaming',vfx:'accent',punchZoom:1.12},template),[]);
 assert.deepEqual(templateChanges({style:'impact',vfx:'reaction',punchZoom:1.12,count:8},template),['style','vfx']);
 assert.deepEqual(templateChanges({style:'gaming'},template),[]);assert.deepEqual(templateChanges({style:'x'},undefined),[]);});
test('template memory restores my tweaks for that template and reset forgets them',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};const gaming={id:'gaming',settings:{style:'gaming',vfx:'accent',font:'anton'}},clean={id:'clean',settings:{style:'clean',vfx:'none',font:'work'}};
 let v=withTemplate({count:3},gaming,{storage});assert.equal(v.style,'gaming');v={...v,vfx:'reaction'};saveTweaks('gaming',v,gaming,storage);
 v=withTemplate(v,clean,{storage});assert.equal(v.vfx,'none');v=withTemplate(v,gaming,{storage});assert.equal(v.vfx,'reaction');assert.equal(v.style,'gaming');assert.equal(v.count,3);
 v=withTemplate(v,gaming,{remember:false,storage});saveTweaks('gaming',v,gaming,storage);assert.equal(v.vfx,'accent');assert.deepEqual(loadTweaks(storage),{});
 assert.deepEqual(loadTweaks({getItem:()=>{throw new Error('blocked');}}),{});});
test('editor clock shows and parses minutes and hours',()=>{
 assert.equal(clock(65.25),'1:05.3');assert.equal(clock(7028.67),'1:57:08.7');assert.equal(clock(-1),'0:00.0');
 assert.equal(parseClock('1:57:08.67'),7028.67);assert.equal(parseClock('2:05'),125);assert.equal(parseClock('42.5'),42.5);assert.ok(Number.isNaN(parseClock('1:x')));assert.ok(Number.isNaN(parseClock('')));
});
test('review page finds ready clips and the template the clips really use',()=>{
 const job={options:{editTemplate:'impact'},clips:[{id:'a',kept:true,settings:{editTemplate:'context-hit'}},{id:'b',kept:true,dirty:true,settings:{}},{id:'c',kept:false,settings:{}}],exports:[{clipId:'a',editTemplate:'context-hit'},{clipId:'b',editTemplate:'context-hit'},{clipId:'c'}]};
 assert.deepEqual(readyClips(job).map(c=>c.id),['a']);assert.equal(projectTemplate(job),'context-hit');assert.equal(projectTemplate({options:{editTemplate:'impact'},clips:[],exports:[]}),'impact');
});
test('live preview crops around the face and shows the spoken caption chunk',()=>{
 assert.equal(centerAt([],5),.5);assert.ok(Math.abs(centerAt([{time:0,centerX:.2},{time:10,centerX:.6}],5)-.4)<1e-9);
 const box=cropBox(16/9,9/16,.5);assert.ok(Math.abs(box.width-316.05)<.1);assert.ok(Math.abs(box.left+108.02)<.1);
 assert.equal(cropBox(16/9,9/16,0).left,0,'never shows past the left edge');assert.ok(Math.abs(cropBox(16/9,9/16,1).left-(100-box.width))<1e-9,'or the right edge');assert.deepEqual(cropBox(16/9,16/9),{width:100,left:0});
 const words=[{start:0,end:.4,text:'no'},{start:.4,end:.8,text:'way'},{start:.8,end:1.2,text:'he'},{start:1.2,end:1.6,text:'did'}];
 assert.deepEqual(captionChunk(words,.5,{edits:{0:'No'}}),{words:[{text:'No',active:false},{text:'way',active:true},{text:'he',active:false}]});assert.equal(captionChunk(words,5),null);
 assert.equal(accentWord('He actually did it'),1);assert.equal(accentWord('a b'),-1);
});
test('edit timeline: cuts merge and play segments skip cuts, then play extra parts',async()=>{
 const {normalizeCuts,playSegments,outputLength,toOutput,toSource}=await import('../web/src/logic.mjs');
 assert.deepEqual(normalizeCuts([{start:15,end:18},{start:5,end:5.05},{start:17,end:20},{start:-3,end:11}],10,40),[{start:10,end:11},{start:15,end:20}]);
 const s=playSegments(10,40,[{start:15,end:20}],[{start:100,end:104}]);
 assert.deepEqual(s.map(x=>[x.start,x.end,x.outStart]),[[10,15,0],[20,40,5],[100,104,25]]);assert.equal(outputLength(s),29);
 assert.equal(toOutput(17,s),null,'inside a cut');assert.equal(toOutput(22,s),7);assert.equal(toOutput(101,s),26);
 assert.equal(toSource(7,s),22);assert.equal(toSource(26,s),101);assert.equal(toSource(99,s),104,'clamps to the end');
});
test('auto beats follow pauses and exclamations on preview time; undo history coalesces typing',async()=>{
 const {playSegments,autoBeats,historyPush,historyUndo,historyRedo}=await import('../web/src/logic.mjs');
 const words=[[0,.5,'Yo'],[.6,1,'look'],[2,2.4,'what!'],[6,6.3,'no'],[6.4,6.8,'way']].map(([start,end,text])=>({start:start+10,end:end+10,text}));
 assert.deepEqual(autoBeats(words,playSegments(10,20)).map(t=>+t.toFixed(2)),[.6,6],'first eligible word, then a pause 2.8 s later');
 let h={past:[],present:{t:'a'},future:[],key:'',at:0};
 h=historyPush(h,{t:'ab'},{key:'title',now:1000});h=historyPush(h,{t:'abc'},{key:'title',now:1500});h=historyPush(h,{t:'abc',x:1},{key:'x',now:1600});
 assert.equal(h.past.length,2,'typing coalesced into one step');h=historyUndo(h);assert.deepEqual(h.present,{t:'abc'});h=historyUndo(h);assert.deepEqual(h.present,{t:'a'});h=historyRedo(h);assert.deepEqual(h.present,{t:'abc'});
});

import test from 'node:test';import assert from 'node:assert/strict';
import {titleClips} from '../server/titles.mjs';import {writeClipBatchAI,fixNames} from '../server/metadata-ai.mjs';import {nameMoments} from '../server/summary.mjs';

const transcript={duration:200,words:'Yo Duke Dennis look at this. Oh my god no way! Hahaha I am dying. What are you doing?'.split(' ').map((text,i)=>({start:20+i,end:20.6+i,text}))};
const job={title:'🎃AMP HALLOWEEN PARTY🎃',source:{url:'https://youtu.be/abc'},sourceInfo:{uploader:'Kai Cenat Live',channel:'Kai Cenat Live'},options:{outputFormat:'shorts'}};
const clip=over=>({id:crypto.randomUUID(),start:18,end:45,peakAt:6,category:'funny',score:80,kept:true,settings:{},title:'raw line',...over});
const reply=clips=>async()=>({ok:true,status:200,json:async()=>({model:'gemini-3.8-flash',choices:[{message:{content:JSON.stringify({clips})}}]})});

test('no key: every clip gets a local who-did-what title, hook and credited description',async()=>{
 const {clips,aiTitles}=await titleClips(job,[clip()],transcript,{env:{}});
 assert.equal(aiTitles.status,'skipped');assert.match(clips[0].title,/^Kai Cenat /);assert.equal(clips[0].settings.hookText,clips[0].hook);
 assert.equal(clips[0].metadata.generatedBy,'local who-did-what');assert.match(clips[0].metadata.description,/All credit to Kai Cenat/);assert.match(clips[0].metadata.description,/youtu\.be\/abc/);
 assert.ok(clips[0].metadata.tags.includes('Kai Cenat'));assert.equal(clips[0].metadata.categoryId,'24');
});

test('one batched AI call fills hooks, titles and metadata, but never replaces owner edits or invents names',async()=>{
 const calls=[];const fetchImpl=async(url,init)=>{calls.push(JSON.parse(init.body));return reply([
  {index:0,hook:'Duke Scares Kai Cenat',title:'Duke Dennis Scares Kai Cenat',youtubeTitle:'Duke Dennis Scares Kai Cenat At The Halloween Party',description:'Hook line\nSecond',hashtags:['KaiCenat'],tags:['Kai Cenat','profanity','Duke Dennis']},
  {index:1,hook:'Kai Fights Adin Ross',title:'Kai Fights Adin Ross',youtubeTitle:'Kai Fights Adin Ross On Stream',description:'x',hashtags:[],tags:[]},
  {index:2,hook:'New Hook Words',title:'Kai Cenet Reacts To The Mask',youtubeTitle:'Kai Cenet Reacts To The Mask Reveal',description:'y',hashtags:[],tags:[]}])();};
 const edited=clip({title:'My own title',titleEdited:true,hook:'Mine',hookEdited:true,settings:{hookText:'Mine'}});
 const {clips,aiTitles}=await titleClips(job,[clip(),clip(),edited],transcript,{env:{GEMINI_API_KEY:'k'},fetchImpl});
 assert.equal(calls.length,1,'one request for the whole project');assert.match(calls[0].messages[1].content,/People with evidence: Kai Cenat .*Duke Dennis/);
 assert.equal(aiTitles.status,'done');assert.equal(clips[0].title,'Duke Dennis Scares Kai Cenat');assert.equal(clips[0].settings.hookText,'Duke Scares Kai Cenat');assert.equal(clips[0].metadata.generatedBy,'ai:gemini-3.8-flash');
 assert.ok(!clips[0].metadata.tags.includes('profanity'));assert.match(clips[0].metadata.description,/Full stream: https:\/\/youtu\.be\/abc/);
 assert.match(clips[1].title,/^Kai Cenat /,'a guessed name (Adin Ross) is rejected and the local title kept');assert.equal(clips[1].titleSource,'local');
 assert.equal(clips[2].title,'My own title');assert.equal(clips[2].hook,'Mine');assert.equal(clips[2].settings.hookText,'Mine');
 assert.equal(fixNames('Kai Cenet',[{name:'Kai Cenat',short:'Kai'}]),'Kai Cenat');
});

test('AI failure keeps local titles and records why; batches are chunked for free-tier limits',async()=>{
 const {clips,aiTitles}=await titleClips(job,[clip()],transcript,{env:{GEMINI_API_KEY:'k',GEMINI_FALLBACK_MODELS:''},fetchImpl:async()=>({ok:false,status:401,json:async()=>({})})});
 assert.equal(aiTitles.status,'failed');assert.match(aiTitles.error,/rejected the API key/);assert.match(clips[0].title,/^Kai Cenat /);
 let n=0;const many=Array.from({length:8},(_,index)=>({index,people:[{name:'Kai Cenat',short:'Kai'}],transcript:'hi'}));
 const out=await writeClipBatchAI({clips:many},{env:{GEMINI_API_KEY:'k'},chunk:3,fetchImpl:async(url,init)=>{n++;const idx=[...JSON.parse(init.body).messages[1].content.matchAll(/Clip (\d+) \(/g)].map(m=>+m[1]);return reply(idx.map(index=>({index,hook:'Kai Reacts',title:'Kai Cenat Reacts Live',youtubeTitle:'Kai Cenat Reacts Live On Stream',description:'d',hashtags:[],tags:[]})))();}});
 assert.equal(n,3);assert.equal(out.clips.filter(c=>c.title).length,8);
});

test('summary moments get who-did-what titles, never category labels',async()=>{
 const moments=[{start:18,end:45,category:'funny',label:'FUN MOMENT',title:'I am dying'}];
 await nameMoments(job,moments,transcript,{host:{name:'Kai Cenat',short:'Kai'},named:[]},{env:{}});
 assert.match(moments[0].title,/^Kai Cenat /);assert.ok(!/FUN MOMENT|WORTH IT|CLIP THIS/.test(moments[0].title));
});
test('on-screen hooks always say who did what: quote-only hooks fall back to the shortened title',async()=>{
 const fetchImpl=async()=>reply([{index:0,hook:'“What Are You Doing?”',title:'Kai Cenat Learns About a Unexpected Dancer',youtubeTitle:'Kai Cenat Learns About An Unexpected Dancer',description:'x',hashtags:[],tags:[]}])();
 const {clips}=await titleClips(job,[clip()],transcript,{env:{GEMINI_API_KEY:'k'},fetchImpl});
 assert.equal(clips[0].title,'Kai Cenat Learns About an Unexpected Dancer','a/an is fixed');
 assert.equal(clips[0].hook,'Kai Learns About an Unexpected Dancer');assert.equal(clips[0].settings.hookText,clips[0].hook);
 const local=(await titleClips(job,[clip()],transcript,{env:{}})).clips[0];assert.doesNotMatch(local.hook,/^["“]/,'local hooks are not bare quotes');
});
test('title options keep the chosen title first, drop duplicates and anything over 60 characters',async()=>{
 const {titleOptions}=await import('../server/titles.mjs');
 assert.deepEqual(titleOptions('Kai Cenat Wins',['kai cenat wins','A'.repeat(61)],['Kai Cenat Cannot Believe It','Kai Cenat Celebrates','Kai Cenat Extra']),['Kai Cenat Wins','Kai Cenat Cannot Believe It','Kai Cenat Celebrates']);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {shapeTitle,resolveHashtags,publicationMetadata,templateMetadata,normalizeTemplateMeta,stripEmoji} from '../server/context.mjs';
import {titleClips,localMetadata,pickHook} from '../server/titles.mjs';import {writeClipBatchAI,batchPrompt} from '../server/metadata-ai.mjs';

// Templates are built here, so these tests do not depend on what presets/edits.json currently holds.
const META={titleGuide:'<Streamer> <past-tense action> <twist>',emoji:['😭','💀','😳'],emojiCount:2,case:'title',maxLength:60,hashtags:['#shorts','#{host}','#funny','#streamer','#viral','#clips'],descriptionTemplate:'{title}\n\n{context}\n\nSource: {source}\n\n{hashtags}'};
const templates=[{id:'meta-test',metadata:META},{id:'plain-test',settings:{}}];
const EMOJI=/\p{Extended_Pictographic}/u,emojiOf=s=>s.match(/\p{Extended_Pictographic}/gu)||[];
const transcript={duration:200,words:'Yo Duke Dennis look at this. Oh my god no way! Hahaha I am dying. What are you doing?'.split(' ').map((text,i)=>({start:20+i,end:20.6+i,text}))};
const job=over=>({title:'AMP Halloween Party',source:{url:'https://youtu.be/abc'},sourceInfo:{uploader:'Kai Cenat Live',channel:'Kai Cenat Live'},options:{outputFormat:'shorts'},...over});
const clip=over=>({id:'clip-1',start:18,end:45,peakAt:6,category:'funny',score:80,kept:true,settings:{editTemplate:'meta-test'},title:'raw line',...over});
const reply=clips=>async()=>({ok:true,status:200,json:async()=>({model:'gemini-3.8-flash',choices:[{message:{content:JSON.stringify({clips})}}]})});

test('title shaping: case, trailing emoji from the list, whole words within maxLength, deterministic per clip',()=>{
 const a=shapeTitle('kai cenat gets scared by a fake spider',META,{seed:'clip-1'});
 assert.match(a,/^Kai Cenat Gets Scared by a Fake Spider [😭💀😳]{2}$/u);assert.equal(emojiOf(a).length,2);
 assert.equal(shapeTitle('kai cenat gets scared by a fake spider',META,{seed:'clip-1'}),a,'same clip, same emoji');
 const seeds=new Set(['a','b','c','d','e','f'].map(seed=>emojiOf(shapeTitle('Kai Cenat Wins',META,{seed})).join('')));assert.ok(seeds.size>1,'emoji vary between clips');
 assert.equal(shapeTitle(a,META,{seed:'other'}),a,'shaping is idempotent');
 const long=shapeTitle('Kai Cenat Gets Scared By A Fake Spider In The Middle Of His Halloween Stream With Everyone',{...META,maxLength:40},{seed:'x'});
 assert.ok(long.length<=40,long);assert.match(stripEmoji(long),/^Kai Cenat Gets Scared by a Fake Spider$|^Kai Cenat Gets Scared by a Fake$|^Kai Cenat Gets Scared$/,'never cuts a word or ends on a connector');
 assert.ok(!/\b(?:by|a|the|in|of)$/i.test(stripEmoji(long)));
 assert.equal(shapeTitle('KAI CENAT GETS SCARED BY SPEED #shorts',{...META,case:'sentence',emojiCount:0},{people:[{name:'Kai Cenat',short:'Kai'},{name:'Speed',short:'Speed'}]}),'Kai Cenat gets scared by Speed','sentence case keeps names; hashtags leave the title');
 assert.match(shapeTitle('kai wins',{...META,case:'upper',emojiCount:1}),/^KAI WINS \p{Extended_Pictographic}$/u);
 assert.equal(shapeTitle('Kai Wins 🔥',{...META,emojiCount:0}),'Kai Wins','emojiCount 0 removes emoji');
 assert.equal(normalizeTemplateMeta({emoji:['😭','x','#'],maxLength:500}).maxLength,100,'YouTube limit');assert.deepEqual(normalizeTemplateMeta({emoji:['😭','x']}).emoji,['😭']);
 assert.equal(templateMetadata({settings:{editTemplate:'plain-test'}},{},templates),null);assert.equal(templateMetadata({settings:{}},{options:{editTemplate:'meta-test'}},templates).emojiCount,2,'project template applies');
});

test('hashtags: #{host} becomes the host name, deduped, at most 5, #shorts kept for Shorts',()=>{
 assert.deepEqual(resolveHashtags(META.hashtags,{host:'Kai Cenat',isShort:true}),['#shorts','#kaicenat','#funny','#streamer','#viral']);
 assert.deepEqual(resolveHashtags(META.hashtags,{isShort:true}),['#shorts','#funny','#streamer','#viral','#clips'],'unknown host: placeholder dropped');
 assert.deepEqual(resolveHashtags(['#a','#b','#c','#d','#e','#shorts'],{isShort:true}).slice(0,1),['#shorts']);assert.deepEqual(resolveHashtags(['#Funny','#funny'],{isShort:false}),['#Funny']);
});

test('description template fills {title} {context} {source} {hashtags}; tags gain hashtag words; limits hold',()=>{
 const m=publicationMetadata({id:'c',title:'Kai Cenat Gets Scared',contextText:'Kai jumps at a fake spider',settings:{editTemplate:'meta-test'}},{title:'AMP Stream',host:{name:'Kai Cenat',short:'Kai'},source:{url:'https://youtu.be/a'}},{},{templates});
 assert.match(m.title,/^Kai Cenat Gets Scared [😭💀😳]{2}$/u);const lines=m.description.split('\n');
 assert.equal(lines[0],m.title,'line 1 repeats the title');assert.match(m.description,/\n\nKai jumps at a fake spider\n\nSource: AMP Stream\n\n#shorts #kaicenat #funny #streamer #viral/);assert.match(m.description,/Full stream: https:\/\/youtu\.be\/a/,'credit link kept');
 assert.ok(m.tags.includes('kaicenat')&&m.tags.includes('funny')&&!m.tags.some(t=>t.startsWith('#')));
 const huge=publicationMetadata({title:'Kai Cenat Wins',contextText:'x'.repeat(9000),settings:{editTemplate:'meta-test'}},{},{},{templates});assert.ok(Buffer.byteLength(huge.description)<=5000);
 const many=publicationMetadata({title:'Kai',settings:{editTemplate:'meta-test'}},{},{tags:Array.from({length:60},(_,i)=>`long search phrase ${i}`)},{templates});assert.ok(many.tags.join(',').length<=440&&many.tags.includes('funny'),'hashtag words survive the tag budget');
 const video=publicationMetadata({title:'Kai Cenat Wins',settings:{editTemplate:'meta-test',outputFormat:'video'}},{},{},{templates});assert.doesNotMatch(video.description,/#shorts/i,'no #Shorts on a regular video');
 const plain=publicationMetadata({title:'Kai Cenat Wins',settings:{editTemplate:'plain-test'}},{},{},{templates});assert.doesNotMatch(plain.title,EMOJI);assert.match(plain.description,/#Shorts$/,'no template metadata: unchanged');
 const recipe=publicationMetadata({title:'T',settings:{editTemplate:'meta-test'}},{},{descriptionTemplate:'{title} only'},{templates});assert.equal(recipe.description,'T only','an automation recipe template wins');
});

test('local titles: YouTube title and options get emoji, the on-screen hook and clip title never do',async()=>{
 const {clips}=await titleClips(job(),[clip()],transcript,{env:{},templates});const c=clips[0];
 assert.match(c.title,/^Kai Cenat /);assert.doesNotMatch(c.title,EMOJI);assert.doesNotMatch(c.hook,EMOJI);assert.doesNotMatch(c.settings.hookText,EMOJI);
 assert.equal(emojiOf(c.metadata.title).length,2);assert.equal(stripEmoji(c.metadata.title),c.title,'same who-did-what wording');assert.ok(c.metadata.title.length<=60);
 assert.equal(c.titleOptions[0],c.metadata.title);assert.match(c.metadata.description,/#shorts #kaicenat/);assert.match(c.metadata.description,/Source: Kai Cenat · AMP Halloween Party/);
 assert.equal(pickHook('Kai Wins 😭💀','Kai Cenat Wins',[{name:'Kai Cenat',short:'Kai'}]),'Kai Wins');
 const old=(await titleClips(job(),[clip({settings:{}})],transcript,{env:{},templates})).clips[0];assert.doesNotMatch(old.metadata.title,EMOJI);assert.match(old.metadata.description,/All credit to Kai Cenat/);assert.equal(old.metadata.generatedBy,'local who-did-what');
 const lm=localMetadata({...c,metadata:undefined},job({host:{name:'Kai Cenat'}}),[{name:'Kai Cenat',short:'Kai',evidence:'host (channel)'}],{templates});assert.match(lm.description,/#kaicenat/);
});

test('AI titles: the prompt carries the template pattern, and output is reshaped even when the model ignores it',async()=>{
 const calls=[];const fetchImpl=async(url,init)=>{calls.push(JSON.parse(init.body));return reply([{index:0,hook:'Duke Scares Kai 😭',title:'Duke Dennis Scares Kai Cenat 💀',altTitles:['Kai Cenat Cannot Believe Duke Dennis 🔥🔥🔥'],youtubeTitle:'DUKE DENNIS SCARES KAI CENAT AT THE HALLOWEEN PARTY AND EVERYONE IN CHAT LOSES IT #shorts',description:'Duke Dennis Scares Kai Cenat\nDuke hides behind the door and Kai jumps.\n\n#KaiCenat #Halloween',hashtags:['KaiCenat','Halloween'],tags:['Kai Cenat','Duke Dennis']}])();};
 const {clips,aiTitles}=await titleClips(job(),[clip()],transcript,{env:{GEMINI_API_KEY:'k'},fetchImpl,templates});const c=clips[0],prompt=calls[0].messages[1].content;
 assert.equal(aiTitles.status,'done');assert.match(prompt,/YouTube title style: follow the pattern \[Streamer\] \[past-tense action\] \[twist\]/);assert.match(prompt,/Title Case/);assert.match(prompt,/2 emoji from 😭 💀 😳/);assert.match(prompt,/at most 60 characters/);
 assert.equal(c.hook,'Duke Scares Kai');assert.equal(c.title,'Duke Dennis Scares Kai Cenat');assert.doesNotMatch(c.settings.hookText,EMOJI);
 const t=c.metadata.title;assert.ok(t.length<=60,t);assert.equal(emojiOf(t).length,2);assert.ok(emojiOf(t).every(e=>META.emoji.includes(e)),'off-list emoji replaced');assert.doesNotMatch(t,/#|DENNIS SCARES/,'case fixed, no hashtag');assert.match(t,/^Duke Dennis Scares Kai Cenat/);
 assert.match(c.metadata.description,/^Duke Dennis Scares Kai Cenat [^\n]+\n\nDuke hides behind the door and Kai jumps\.\n\nSource: Kai Cenat · AMP Halloween Party\n\n#shorts #kaicenat #funny #streamer #viral/u);assert.match(c.metadata.description,/Full stream: https:\/\/youtu\.be\/abc/);
 assert.ok(c.metadata.tags.includes('Kai Cenat')&&c.metadata.tags.includes('funny'));
 assert.ok(c.titleOptions.length>=2&&c.titleOptions.every(o=>o.length<=60&&emojiOf(o).length===2),JSON.stringify(c.titleOptions));
 const direct=await writeClipBatchAI({clips:[{index:0,people:[{name:'Kai Cenat',short:'Kai'}],transcript:'hi'}]},{env:{GEMINI_API_KEY:'k'},fetchImpl:reply([{index:0,hook:'Kai Wins',title:'Kai Cenat Wins Big',youtubeTitle:'Kai Cenat Wins Big On Stream 🔥',description:'d',hashtags:[],tags:[]}])});
 assert.equal(direct.clips[0].metadata.title,'Kai Cenat Wins Big On Stream 🔥','no template: AI title untouched');assert.doesNotMatch(batchPrompt({clips:[{index:0,transcript:'x'}]}),/YouTube title style/);
});

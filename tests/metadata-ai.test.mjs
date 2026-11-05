import test from 'node:test';import assert from 'node:assert/strict';
import {finishDraft,metadataPrompt,writeMetadataAI,metadataProvider} from '../server/metadata-ai.mjs';

test('AI drafts are held to YouTube limits: title length, three hashtags, tag budget, no angle brackets',()=>{
 const long='Spider-Man gets chased through Times Square by a fan who will not stop asking for his autograph tonight';
 const out=finishDraft({title:`<b>${long}</b>`,description:'Line one hook\nLine two',hashtags:['#spiderman','ishowspeed','#IRL Stream','#halloween','#fun'],tags:['spider-man','Spider-Man','ishowspeed, irl',...Array.from({length:80},(_,i)=>`long search phrase number ${i}`)],rationale:'Hooks on the chase.'},{chapters:[{line:'0:00 Fun moment · Chase'},{line:'0:20 Worth it · Autograph'},{line:'0:41 Clip this · Escape'}]});
 assert.ok(out.title.length<=100&&!/[<>]/.test(out.title)&&!/\s\S{0,3}$/.test(out.title.slice(-2)));
 assert.deepEqual(out.hashtags,['#spiderman','#ishowspeed','#IRLStream']);
 assert.equal(out.tags.filter(t=>t.toLowerCase()==='spider-man').length,1,'duplicate tags removed');assert.ok(!out.tags.some(t=>t.includes(',')));
 assert.ok(out.tags.join(',').length<=440,'tag budget fits the upload validator');
 assert.match(out.description,/0:20 Worth it · Autograph/,'chapters are kept');assert.match(out.description,/#spiderman #ishowspeed #IRLStream$/);
});
test('the prompt carries the real transcript, chapters, credit link and trending titles as style only',()=>{
 const p=metadataPrompt({kind:'summary',format:'video',sourceTitle:'HALLOWEEN SPIDER-MAN STREAM',transcript:"I'm dying! Let's go!",moments:[{label:'FUN MOMENT',title:"I'm dying!"}],chapters:[{line:'0:00 Fun moment · I\'m dying!'}],trending:[{title:'Speed meets Spider-Man',tags:['speed','spiderman']}],sourceUrl:'https://youtu.be/abc'});
 assert.match(p,/regular video/);assert.match(p,/I'm dying! Let's go!/);assert.match(p,/exactly, one per line/);assert.match(p,/style reference only/);assert.match(p,/youtu\.be\/abc/);
});
test('Claude is called once with structured output and fallbacks; refusals become a clear message',async()=>{
 const calls=[];const client=reply=>({beta:{messages:{parse:async req=>{calls.push(req);return reply;}}}});
 const ok=await writeMetadataAI({kind:'clip',format:'shorts',sourceTitle:'Stream',transcript:'hi'},{client:client({stop_reason:'end_turn',model:'claude-opus-5-5',parsed_output:{title:'He did not expect that',description:'Hook\nMore',hashtags:['shorts'],tags:['irl'],rationale:'Surprise.'}})});
 assert.equal(ok.title,'He did not expect that');assert.equal(calls[0].model,'claude-opus-5-5');assert.equal(calls[0].fallbacks,'default');assert.deepEqual(calls[0].betas,['server-side-fallback-2026-07-01']);assert.equal(calls[0].output_config.format.type,'json_schema');
 await assert.rejects(writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{client:client({stop_reason:'refusal',parsed_output:null})}),/declined/);
 await assert.rejects(writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{client:client({stop_reason:'end_turn',parsed_output:null})}),/unexpected shape/);
});
test('free providers: Gemini is preferred, then Groq, then Claude; METADATA_AI overrides',()=>{
 assert.equal(metadataProvider({}),null);assert.equal(metadataProvider({ANTHROPIC_API_KEY:'a',GROQ_API_KEY:'g'}),'groq');
 assert.equal(metadataProvider({ANTHROPIC_API_KEY:'a',GROQ_API_KEY:'g',GEMINI_API_KEY:'m'}),'gemini');
 assert.equal(metadataProvider({METADATA_AI:'claude',ANTHROPIC_API_KEY:'a',GEMINI_API_KEY:'m'}),'claude');assert.equal(metadataProvider({METADATA_AI:'groq',GEMINI_API_KEY:'m'}),null);
});
test('Gemini drafts go through the OpenAI-compatible endpoint and the same YouTube limits',async()=>{
 const calls=[],reply=(status,content)=>async(url,init)=>{calls.push({url,init});return {ok:status<400,status,json:async()=>({model:'gemini-2.5-flash',choices:[{message:{content}}]})};};
 const env={GEMINI_API_KEY:'k'},draft=JSON.stringify({title:'<i>He did not expect that</i>',description:'Hook',hashtags:['#a','b','c','d'],tags:['irl'],rationale:'Surprise.'});
 const ok=await writeMetadataAI({kind:'clip',format:'shorts',transcript:'hi'},{env,fetchImpl:reply(200,'```json\n'+draft+'\n```')});
 assert.equal(ok.title,'He did not expect that','HTML tags are stripped whole');assert.equal(ok.hashtags.length,3);assert.equal(ok.model,'gemini-2.5-flash');
 assert.match(calls[0].url,/generativelanguage\.googleapis\.com/);assert.equal(calls[0].init.headers.Authorization,'Bearer k');assert.equal(JSON.parse(calls[0].init.body).response_format.type,'json_object');
 await assert.rejects(writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{env,fetchImpl:reply(429,'')}),/free tier limit/);
 await assert.rejects(writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{env,fetchImpl:reply(200,'not json')}),/unexpected shape/);
 await assert.rejects(writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{env:{}}),/GEMINI_API_KEY/);
});
test('a busy Gemini is retried, then hands over to Groq; a bad key does not fall through',async()=>{
 const urls=[],env={GEMINI_API_KEY:'m',GROQ_API_KEY:'g',GEMINI_FALLBACK_MODELS:''},content=JSON.stringify({title:'Bro climbed the pole',description:'Hook',hashtags:[],tags:[],rationale:'r'});
 const fetchImpl=status=>async url=>{urls.push(url);const gemini=/googleapis/.test(url);return {ok:!gemini||status<400,status:gemini?status:200,json:async()=>({model:'llama-3.3-70b-versatile',choices:[{message:{content}}]})};};
 const ok=await writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{env,fetchImpl:fetchImpl(503),retryDelays:[0]});
 assert.equal(ok.title,'Bro climbed the pole');assert.deepEqual(urls.map(u=>/groq/.test(u)?'groq':'gemini'),['gemini','gemini','groq']);
 await assert.rejects(writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{env,fetchImpl:fetchImpl(401),retryDelays:[0]}),/GEMINI_API_KEY/);
});
test('an overloaded Gemini model falls back to the lighter Gemini model before leaving Gemini',async()=>{
 const models=[],content=JSON.stringify({title:'Kai Cenat Gets Scared By A Fake Spider',description:'Hook',hashtags:[],tags:[],rationale:'r'});
 const fetchImpl=async(url,init)=>{const model=JSON.parse(init.body).model;models.push(model);const ok=model==='gemini-3.5-flash-lite';return {ok,status:ok?200:503,json:async()=>({model,choices:[{message:{content}}]})};};
 const out=await writeMetadataAI({kind:'clip',format:'shorts',transcript:'x'},{env:{GEMINI_API_KEY:'m'},fetchImpl,retryDelays:[0]});
 assert.equal(out.model,'gemini-3.5-flash-lite');assert.deepEqual(models,['gemini-3.8-flash','gemini-3.8-flash','gemini-3.5-flash-lite']);
});
test('batch titles may carry alternative angles; alternates naming people without evidence are dropped',async()=>{
 const {writeClipBatchAI}=await import('../server/metadata-ai.mjs');
 const content=JSON.stringify({clips:[{index:0,hook:'Kai Finds A Surprise',title:'Kai Cenat Finds a Surprise in His Pocket',altTitles:['Kai Cenat Cannot Believe What Was in His Pocket','IShowSpeed Finds a Surprise Pocket','Kai Cenat Finds a Surprise in His Pocket'],youtubeTitle:'Kai Cenat Finds a Surprise in His Pocket at the Party',description:'d',hashtags:[],tags:[]}]});
 const r=await writeClipBatchAI({clips:[{index:0,people:[{name:'Kai Cenat',short:'Kai'}],transcript:'what is in my pocket'}]},{env:{GROQ_API_KEY:'g'},fetchImpl:async()=>({ok:true,status:200,json:async()=>({model:'m',choices:[{message:{content}}]})})});
 assert.deepEqual(r.clips[0].altTitles,['Kai Cenat Cannot Believe What Was in His Pocket']);
});
test('batch replies are accepted when a free model renumbers clips, sends a bare array or skips optional fields',async()=>{
 const {writeClipBatchAI}=await import('../server/metadata-ai.mjs');
 const reply=content=>async()=>({ok:true,status:200,json:async()=>({model:'m',choices:[{message:{content:JSON.stringify(content)}}]})});
 const people=[{name:'Kai Cenat',short:'Kai',evidence:'host'}],clips=[{index:4,category:'funny',duration:30,people,transcript:'x'}];
 const a=await writeClipBatchAI({format:'shorts',clips},{env:{GROQ_API_KEY:'g'},fetchImpl:reply([{index:0,hook:'Kai Finds a Surprise',title:'Kai Cenat Finds a Surprise in His Pocket'}])});
 assert.equal(a.clips[0].title,'Kai Cenat Finds a Surprise in His Pocket');assert.equal(a.clips[0].hook,'Kai Finds a Surprise');
});

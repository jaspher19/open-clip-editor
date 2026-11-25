import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {captionPhrases,spreadTranslation,translationTokens} from '../web/src/logic.mjs';import {aiTranslateCaptions} from '../server/ui-language.mjs';
import {makeAss,makeSrt} from '../server/captions.mjs';import {videoPoster} from '../server/thumbnails.mjs';import {CACHE} from '../server/config.mjs';

const w=(text,start,end=start+.3)=>({text,start,end});
const words=[w('ok',0),w('chat',.4),w('look.',.8),w('he',3),w('is',3.4),w('crazy',3.8),w('outside',9)];

test('phrases follow sentences and pauses, inside what the clip plays',()=>{
 assert.deepEqual(captionPhrases(words,[{start:0,end:5}]),[[0,1,2],[3,4,5]]);
 assert.deepEqual(captionPhrases(words,[{start:0,end:1.5},{start:8.5,end:10}]),[[0,1,2],[6]],'extra parts are translated too');
 assert.deepEqual(captionPhrases(words.map((x,i)=>i===1?{...x,text:''}:x),[{start:0,end:1.5}]),[[0],[2]],'a blank word splits the phrase');
 assert.equal(captionPhrases(Array.from({length:30},(_,i)=>w('go',i*.3)),[{start:0,end:20}],{maxWords:14})[0].length,14);
});

test('a translated phrase is spread over the spoken words, in order',()=>{
 assert.deepEqual(spreadTranslation(3,'mira chat mira esto'),['mira','chat','mira esto']);
 assert.deepEqual(spreadTranslation(4,'está loco'),['está','','loco','']);
 assert.deepEqual(spreadTranslation(2,''),['','']);assert.deepEqual(spreadTranslation(0,'x'),[]);
 assert.ok(spreadTranslation(1,'a '.repeat(200))[0].length<=120,'each caption edit stays within the 120-character limit');
 const ja=translationTokens('彼は狂っている。','ja');assert.ok(ja.length>1,'Japanese is split into words');assert.equal(ja.join(''),'彼は狂っている。');
 assert.equal(spreadTranslation(2,'彼は狂っている。','ja').join(''),'彼は狂っている。','no spaces are added in Japanese');
});

test('blank caption words are skipped in burned-in captions and the SRT',()=>{
 const shown=[w('está',0),w('',.4),w('loco',.8)];
 const ass=makeAss(shown,{style:'clean',duration:2,hookEnabled:false});
 assert.ok(!/\{[^}]*\}\s*(\\N)?\s*$/m.test(ass.split('[Events]')[1].split('\n').filter(l=>l.startsWith('Dialogue')).map(l=>l.split(',,').at(-1)).join('\n')),'no empty caption lines');
 assert.match(ass,/está/);assert.match(ass,/loco/);
 assert.doesNotMatch(makeSrt(shown),/\n\n\d+\n[^\n]+\n\s*\n/,'no empty SRT cues');assert.match(makeSrt(shown),/está/);
});

test('AI caption translation keeps one line per phrase and checks its answer',async()=>{
 const seen=[];const ask=async({system,user})=>{seen.push({system,user:JSON.parse(user)});return {data:{translations:JSON.parse(user).lines.map(l=>`ES ${l}`)}};};
 assert.deepEqual(await aiTranslateCaptions('en','es',['ok chat look.','he is crazy'],{ask}),['ES ok chat look.','ES he is crazy']);
 assert.match(seen[0].system,/"en".*"es"/s);assert.deepEqual(seen[0].user.lines,['ok chat look.','he is crazy']);
 await assert.rejects(aiTranslateCaptions('en','es',['a','b'],{ask:async()=>({data:{translations:['only one']}})}),/wrong number/);
 await assert.rejects(aiTranslateCaptions('en','../x',['a'],{ask}),/Unknown language/);
 await assert.rejects(aiTranslateCaptions('en','es',[],{ask}),/up to 400/);
 const many=Array.from({length:90},(_,i)=>`line ${i}`);let calls=0;
 const out=await aiTranslateCaptions('en','fr',many,{ask:async a=>{calls++;return ask(a);}});assert.equal(out.length,90);assert.equal(calls,3,'long clips go in chunks');
});

test('caption edits can be cleared, and the translate route explains what it needs',async t=>{
 const {createApp}=await import('../server/app.mjs');const {JobStore}=await import('../server/jobs.mjs');const {YouTubeClient}=await import('../server/youtube.mjs');
 const store=new JobStore(path.join(CACHE,'api-captions-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const app=createApp({store,queue:{isBusy:()=>false,enqueue(){},cancel(){}},youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const job=store.create({type:'upload'},{});const said=Array.from({length:40},(_,i)=>w(`word${i}`,i*.5,i*.5+.4));
 fs.writeFileSync(path.join(store.folder(job.id),'transcript.json'),JSON.stringify({words:said}));
 store.update(job.id,{status:'complete',metadata:{duration:60,width:1920,height:1080},clips:[{id:'c1',start:0,end:19.9+5,title:'t',kept:true,settings:{},wordEdits:{0:'hola',1:''}}],exports:[]});
 const patch=body=>fetch(`${base}/api/jobs/${job.id}/clips/c1`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let r=await patch({wordEdits:{1:null,2:'mundo'}});assert.equal(r.status,200);assert.deepEqual((await r.json()).wordEdits,{0:'hola',2:'mundo'});
 assert.equal((await patch({wordEdits:['x']})).status,400);
 const keys=['GEMINI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','OLLAMA_MODEL','OLLAMA_HOST','OPENAI_API_KEY','MISTRAL_API_KEY','CEREBRAS_API_KEY'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];t.after(()=>{for(const k of keys)if(saved[k]!==undefined)process.env[k]=saved[k];});
 r=await fetch(`${base}/api/jobs/${job.id}/captions/translate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'en',to:'es',lines:['hi']})});
 if(r.status!==200){assert.equal(r.status,409);assert.match((await r.json()).error,/Chrome or Edge|AI key/);}
 r=await fetch(`${base}/api/jobs/${job.id}/captions/translate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:'not a language',lines:['hi']})});assert.equal(r.status,400);
});

test('post and clip previews: a small frame, made once and remade when the video changes',async t=>{
 const dir=path.join(CACHE,'posters-'+randomUUID());fs.mkdirSync(dir,{recursive:true});t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const video=path.join(dir,'v.mp4'),poster=path.join(dir,'poster.jpg');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=360x640:d=2','-pix_fmt','yuv420p',video]);
 assert.equal(await videoPoster(video,poster),poster);const first=fs.statSync(poster).mtimeMs;assert.equal(fs.readFileSync(poster).subarray(0,2).toString('hex'),'ffd8');
 await videoPoster(video,poster);assert.equal(fs.statSync(poster).mtimeMs,first,'cached');
 const later=new Date(Date.now()+5000);fs.utimesSync(video,later,later);await videoPoster(video,poster);assert.ok(fs.statSync(poster).mtimeMs>first,'remade for a newer video');
 await assert.rejects(videoPoster(path.join(dir,'missing.mp4'),poster),/missing/);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {genzHook,titleClips} from '../server/titles.mjs';import {templateStyle,genzCase,GENZ_HOOK,batchPrompt} from '../server/metadata-ai.mjs';
import {makeAss} from '../server/captions.mjs';import {EDIT_TEMPLATES} from '../server/templates.mjs';

const jynxzi=[{name:'Jynxzi',short:'Jynxzi'}];
test('Gen-Z hooks without AI: the true who-did-what event, reworded like a clip-channel caption',()=>{
 assert.equal(genzHook('Jynxzi Struggles with Terrible Driving',jynxzi),'Jynxzi got cooked by the driving');
 assert.equal(genzHook('Jynxzi Shocked by Insane GTA 6 Realism',jynxzi),'The GTA 6 realism had Jynxzi tweaking');
 assert.equal(genzHook('Jynxzi Rages at Bad Drivers',jynxzi),'Jynxzi crashed out over the bad drivers');
 assert.equal(genzHook('Jynxzi Wrecks the Car While Driving',jynxzi),'Jynxzi took a massive L with the car');
 assert.equal(genzHook('Kai Cenat Reacts to Sudden Shooting',[{name:'Kai Cenat',short:'Kai'}]),'Kai was not ready for the shooting');
 assert.equal(genzHook('Jynxzi Explains His Setup',jynxzi),null,'no pattern: the caller keeps the plain hook');
 assert.equal(genzHook('Someone Reacts to Things',jynxzi),null,'the streamer must be named');
 for(const t of ['Jynxzi Struggles with Terrible Driving','Jynxzi Reacts to Wild Cutscene Dialogue'])assert.ok(genzHook(t,jynxzi).length<=48);
});
test('Gen-Z hook voice: every template asks the AI for it unless it opts out, and the hooks keep their casing',()=>{
 const glow=EDIT_TEMPLATES.find(t=>t.id==='glow-card');assert.equal(glow.metadata.hookVoice,'genz');assert.equal(glow.settings.hookEnabled,true);assert.equal(glow.settings.hookPosition,'middle');
 assert.ok(templateStyle(glow.metadata).includes(GENZ_HOOK));for(const t of EDIT_TEMPLATES)assert.ok(templateStyle(t.metadata).includes(GENZ_HOOK),t.id);assert.ok(!templateStyle({...glow.metadata,hookVoice:'plain'}).includes(GENZ_HOOK),'opt-out');
 assert.match(batchPrompt({sourceTitle:'s',clips:[{index:0,people:[],transcript:'hi'}]}),/Gen-Z meme caption/,'clips without a template too');
 assert.match(GENZ_HOOK,/true to the transcript/);assert.match(GENZ_HOOK,/no swearing/);
 assert.equal(genzCase('jynxzi got cooked by an NPC.'),'Jynxzi got cooked by an NPC');
});
test('Glow Card projects get Gen-Z hooks from local titles when no AI key is set',async()=>{
 const job={id:'j',title:'Jynxzi GTA 6 stream',options:{editTemplate:'glow-card'},host:{name:'Jynxzi'},source:{}};
 const words='bro this driving is so bad i keep crashing into everything'.split(' ').map((text,i)=>({text,start:10+i*.4,end:10.35+i*.4}));
 const clip={id:'c',start:9,end:16,category:'highlight',title:'Jynxzi Struggles with Terrible Driving',titleEdited:true,settings:{editTemplate:'glow-card'}};
 const {clips}=await titleClips(job,[clip],{words},{env:{}});
 assert.equal(clips[0].hook,'Jynxzi got cooked by the driving');assert.equal(clips[0].settings.hookText,'Jynxzi got cooked by the driving');
 for(const id of ['cam-split','custom'])assert.equal((await titleClips({...job,options:{editTemplate:id}},[{...clip,settings:{editTemplate:id}}],{words},{env:{}})).clips[0].hook,'Jynxzi got cooked by the driving',id);
});
test('Glow Card hook: big comic lettering in up to three rows, numbers kept with their word, key word in yellow',()=>{
 const ass=makeAss([{text:'hi',start:3,end:3.3}],{style:'comic-word',font:'luckiest',captionPosition:'seam',title:'The GTA 6 realism had Jynxzi tweaking',hookEnabled:true,hookPosition:'middle',hookDuration:2.6,motionIntensity:'off',duration:5});
 const line=ass.split('\n').find(l=>l.includes(',Title,,'));assert.ok(line);
 assert.ok(line.includes('\\fnLuckiest Guy'));assert.ok(+line.match(/\\fs(\d+)/)[1]>=100,'stays big');
 assert.equal(line.split('\\N').length,3);assert.ok(line.includes('GTA\u00A06'));assert.ok(line.includes('&H0000E5FF&'));assert.match(line,/0:00:02\.60/);
});

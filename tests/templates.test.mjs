import test from 'node:test';import assert from 'node:assert/strict';
import {EDIT_TEMPLATES,applyTemplate,captionFont,zoomFilter} from '../server/templates.mjs';
import {validateOptions} from '../server/options.mjs';import {makeAss} from '../server/captions.mjs';
const words=[{start:0,end:.4,text:'Build'},{start:.4,end:.8,text:'something'},{start:.8,end:1.3,text:'useful.'}];
test('intent templates apply complete edit settings without replacing user music or hook',()=>{
 assert.equal(EDIT_TEMPLATES.length,15);assert.ok(EDIT_TEMPLATES.every(t=>/^https:\/\/www\.youtube\.com\/shorts\/[\w-]{11}$/.test(t.referenceUrl)),'every template is replicated from a reference video');for(const t of EDIT_TEMPLATES){const s=applyTemplate(t.id,{musicEnabled:true,hookText:'Keep my hook',count:6});assert.equal(s.editTemplate,t.id);assert.equal(s.musicEnabled,true);assert.equal(s.hookText,'Keep my hook');assert.equal(s.count,6);assert.equal(validateOptions(s).style,t.settings.style);assert.ok(captionFont(s.font));}
 assert.equal(validateOptions({editTemplate:'rainbow-hype'}).font,'anton');assert.equal(validateOptions({editTemplate:'gaming',style:'gaming'}).editTemplate,'custom','retired templates keep their saved look as custom');assert.throws(()=>applyTemplate('bad'),/template/i);assert.throws(()=>validateOptions({font:'Some injected font'}),/font/i);assert.throws(()=>validateOptions({hookText:'x'.repeat(81)}),/hook/i);assert.throws(()=>validateOptions({motionIntensity:'wild'}),/motion/i);assert.throws(()=>validateOptions({punchInterval:0}),/punchInterval/i);
});
test('templates render chosen font, protected hook, position, accent and motion settings',()=>{
 const opts=validateOptions({style:'impact',font:'anton',captionPosition:'lower',motionIntensity:'punchy',punchIn:true,hookEnabled:true,titleMode:'persistent'});const ass=makeAss(words,{...opts,title:'{\\pos(0,0)} A useful hook',duration:10});assert.match(ass,/Anton/);assert.match(ass,/A USEFUL HOOK/);assert.ok(!ass.includes('{\\pos(0,0)}'));assert.match(ass,/\\pos\(540,1330\)/);assert.match(ass,/\\t\(/);
 const calm=makeAss(words,{...validateOptions({style:'story',font:'barlow',hookEnabled:true}),title:'A quiet story',motionIntensity:'off',duration:10});assert.ok(!calm.includes('\\t('));assert.match(calm.replace(/\{[^}]*\}/g,''),/A quiet story/);
 const noHook=makeAss(words,{...opts,hookEnabled:false,title:'Hidden title',duration:10});assert.ok(!noHook.includes('Hidden title'));
 const center=makeAss(words,{...opts,captionPosition:'center',duration:10});assert.match(center,/\\pos\(540,1250\)/);
 assert.equal(zoomFilter({...opts,motionIntensity:'off'}),'');assert.match(zoomFilter({...opts,motionIntensity:'punchy',punchInterval:2,punchZoom:1.1}),/120/);assert.ok(!zoomFilter(opts).includes('NaN'));
});

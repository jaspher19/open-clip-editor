import test from 'node:test';import assert from 'node:assert/strict';
import {EDIT_TEMPLATES,applyTemplate} from '../server/templates.mjs';import {validateOptions} from '../server/options.mjs';import {makeAss} from '../server/captions.mjs';

// Users reported they couldn't edit the on-screen hook on some templates: half the templates turn the hook off.
// The editor now always offers the hook box (typing turns it on); this checks every template then really draws it,
// and draws the context line too.
const words=Array.from({length:20},(_,i)=>({text:`word${i}`,start:i*.5,end:i*.5+.4}));
// Override tags removed: Skull Ending types the hook out letter by letter ({\ko} before each character).
const dialogue=ass=>ass.split('\n').filter(l=>l.startsWith('Dialogue:')).map(l=>l.split(',,').slice(1).join(',,').replace(/\{[^}]*\}/g,'')).join('\n');

for(const t of EDIT_TEMPLATES)test(`template ${t.id}: an edited hook and context line reach the video`,()=>{
 const base=applyTemplate(t.id,validateOptions({}));
 const options=validateOptions({...base,hookEnabled:true,hookText:'LACY CANT BELIEVE THIS',contextText:'GTA SIX FINALE STREAM'});
 const text=dialogue(makeAss(words,{...options,title:options.hookText,duration:10}));
 assert.match(text,/BELIEVE/i,'the hook is drawn');
 assert.match(text,/FINALE/i,'the context line is drawn');
 const off=validateOptions({...base,hookEnabled:false,hookText:'LACY CANT BELIEVE THIS',contextText:''});
 assert.doesNotMatch(dialogue(makeAss(words,{...off,title:off.hookText,duration:10})),/BELIEVE/i,'turning the hook off removes it');
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {getLanguage,setLanguage,readStrings,saveStrings,validLanguage,aiTranslate} from '../server/ui-language.mjs';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'openclip-lang-'));

test('display language: English until chosen, then saved on disk and read back after a restart',()=>{
 const root=tmp();
 assert.equal(getLanguage(root),'en');
 setLanguage('es',root);assert.equal(getLanguage(root),'es');
 setLanguage('zh-Hant',root);assert.equal(getLanguage(root),'zh-Hant');
 setLanguage('en',root);assert.equal(getLanguage(root),'en','back to English');
 assert.throws(()=>setLanguage('../x',root));assert.throws(()=>setLanguage('',root));
 assert.ok(validLanguage('fil')&&!validLanguage('EN-us-xx')&&!validLanguage(null));
 fs.writeFileSync(path.join(root,'settings.json'),'{broken');assert.equal(getLanguage(root),'en','a damaged file falls back to English');
});

test('translated lines: merged, checked, and never stored for English',()=>{
 const root=tmp();
 assert.deepEqual(readStrings('fr',root),{});
 assert.equal(saveStrings('fr',{'New project':'Nouveau projet','Transcribed {0} / {1}s':'Transcrit {0} / {1} s'},root),2);
 assert.equal(saveStrings('fr',{'Save':'Enregistrer','':'x','Bad':42,'Too long':'y'.repeat(5000)},root),1,'empty, non-text and oversized lines are dropped');
 assert.deepEqual(readStrings('fr',root),{'New project':'Nouveau projet','Transcribed {0} / {1}s':'Transcrit {0} / {1} s','Save':'Enregistrer'});
 assert.throws(()=>saveStrings('en',{a:'b'},root));assert.throws(()=>saveStrings('fr',['x'],root));
 assert.deepEqual(readStrings('en',root),{});assert.deepEqual(readStrings('../../etc',root),{});
});

test('AI fallback: one line back per line sent, placeholders kept by the prompt, wrong counts refused',async()=>{
 let seen;const ask=async({system,user})=>{seen={system,user};const {lines}=JSON.parse(user);return {data:{translations:lines.map(l=>`[fil] ${l}`)}};};
 const out=await aiTranslate('fil',['Find clips','Find clips','Transcribed {0} / {1}s',''],{ask});
 assert.deepEqual(out,{'Find clips':'[fil] Find clips','Transcribed {0} / {1}s':'[fil] Transcribed {0} / {1}s'});
 assert.match(seen.system,/\{0\}/);assert.match(seen.system,/"fil"/);
 await assert.rejects(aiTranslate('fil',['a','b'],{ask:async()=>({data:{translations:['x']}})}),/wrong number/);
 await assert.rejects(aiTranslate('en',['a'],{ask}),/Unknown language/);
});

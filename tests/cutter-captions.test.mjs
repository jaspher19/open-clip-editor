import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {CUT_FONTS,captionGroups,captionAt,captionMetrics,cleanCaption,wordKey} from '../web/src/cutCaptions.mjs';
import {captionsAss,cutGraph,validateCut,validateCaptions,cutWords} from '../server/cut.mjs';import {uncovered,mergeTranscript} from '../server/scan.mjs';

function fontRatio(file){const b=fs.readFileSync(file),n=b.readUInt16BE(4),t={};for(let i=0;i<n;i++){const o=12+i*16;t[b.toString('ascii',o,o+4)]=b.readUInt32BE(o+8);}return b.readUInt16BE(t.head+18)/(b.readUInt16BE(t['OS/2']+74)+b.readUInt16BE(t['OS/2']+76));}
test('cutter captions: each font’s em ratio matches its file, so preview and libass sizes agree',()=>{
 for(const f of CUT_FONTS){const file=path.join('web/public/fonts',f.file);assert.ok(fs.existsSync(file),f.file);assert.ok(Math.abs(fontRatio(file)-f.em)<.0005,`${f.id}: ${fontRatio(file)} vs ${f.em}`);}
 const m=captionMetrics(cleanCaption({font:'anton',size:.1}),1080);assert.equal(Math.round(m.em),108);assert.equal(Math.round(m.ass),187);
});
const W=(start,end,text)=>({start,end,text});
test('cutter captions: groups break at the word limit, pauses and sentence ends; corrections and caps apply',()=>{
 const words=[W(0,.3,'no'),W(.3,.6,'way'),W(.6,.9,'bro.'),W(.9,1.2,'look'),W(2.2,2.5,'again'),W(2.5,2.8,'here')];
 const g=captionGroups(words,{per:3,edits:{'2.20':'AGAIN?'},upper:true});
 assert.deepEqual(g.map(x=>x.words.map(w=>w.text).join(' ')),['NO WAY BRO.','LOOK','AGAIN?','HERE'],'the corrected AGAIN? ends a sentence, so HERE starts a new group');
 assert.equal(g[1].end,1.45,'a pause follows: shown 0.25 s after the last word');assert.equal(g[0].end,.9,'until the next group starts');
 assert.deepEqual(captionAt(g,.45).active,1);assert.equal(captionAt(g,1.8),null);assert.equal(wordKey({start:12.5}),'12.50');
 assert.equal(captionGroups(words,{per:1,upper:false}).length,6);
});
test('cutter captions: the caption file uses the cut’s timeline, highlights the spoken word and never spans two parts',()=>{
 const parts=[[W(10,10.4,'one'),W(10.4,10.8,'two')],[W(50,50.5,'three')]],segments=[{start:9,end:11},{start:49.5,end:51}];
 const ass=captionsAss(parts,segments,{font:'luckiest',style:'box',boxColor:'#112233',highlight:'#00ff00',x:.5,y:.75},{width:1080,height:1920});
 assert.match(ass,/PlayResX: 1080\nPlayResY: 1920/);assert.match(ass,/Style: Cap,Luckiest Guy,\d+\.\d,&H00FFFFFF,&H00FFFFFF,&H00332211,&H40000000,0,0,0,0,100,100,0,0,3,/);
 const lines=ass.split('\n').filter(l=>l.startsWith('Dialogue'));assert.equal(lines.length,3);
 assert.match(lines[0],/^Dialogue: 0,0:00:01\.00,0:00:01\.40,Cap,,0,0,0,,\{\\pos\(540,1440\)\}\{\\c&H0000FF00&\}ONE\{\\c&H00FFFFFF&\} TWO$/);
 assert.match(lines[2],/^Dialogue: 0,0:00:02\.50,0:00:03\.25,Cap/,'part 2 starts at 2 s on the cut’s clock; its last word stays 0.25 s');
 const outline=captionsAss(parts,segments,{style:'outline'},{width:1080,height:1920});assert.match(outline,/,1,6\.5,0\.0,5,65,65,0,1/,'outline 8% of the em');
});
test('cutter captions: libass draws the captions under the text layer; requests are checked',()=>{
 const caps={file:'cuts/x.ass',fontsdir:'../../web/public/fonts'};
 assert.match(cutGraph([{start:0,end:3}],{width:1080,height:1920,framing:'fill',captions:caps}),/concat=n=1:v=1:a=1\[vc\]\[a\];\n\[vc\]ass=filename=cuts\/x\.ass:fontsdir=\.\.\/\.\.\/web\/public\/fonts,format=yuv420p\[v\]$/);
 assert.match(cutGraph([{start:0,end:3}],{width:1080,height:1920,framing:'fill',captions:caps,overlay:true}),/\[vc\]ass=[^\n]*\[vs\];\n\[1:v\]format=rgba\[txt\];\n\[vs\]\[txt\]overlay=0:0/);
 const cut=validateCut({segments:[{start:0,end:5}],format:'shorts',captions:{font:'nope',size:5,edits:{'1.20':'Hi'}}},60);
 assert.equal(cut.captions.font,'anton');assert.equal(cut.captions.size,.2);assert.deepEqual(cut.captions.edits,{'1.20':'Hi'});
 assert.throws(()=>validateCaptions({edits:{'abc':'x'}}),/correction/);assert.throws(()=>validateCaptions({},31*60),/30 minutes/);
});
test('cutter captions: raw projects (nothing transcribed) get their parts transcribed on demand',async()=>{
 assert.deepEqual(uncovered({raw:true,words:[]},10,20),[{start:10,end:20}]);assert.deepEqual(uncovered({words:[]},10,20),[],'a full transcript covers everything');
 const merged=mergeTranscript({raw:true,words:[],segments:[],energy:[1]},{words:[W(12,12.5,'hi')],segments:[],coverage:[[0,30]]});assert.deepEqual(merged.coverage,[[0,30]]);assert.equal(merged.words.length,1);assert.deepEqual(merged.energy,[1]);
 const dir=fs.mkdtempSync(path.join(process.env.TMP||'.','words-'));fs.writeFileSync(path.join(dir,'transcript.json'),JSON.stringify({words:[W(1,1.5,'a'),W(5,5.5,'b'),W(9,9.5,' ')]}));
 const asked=[],words=await cutWords({},dir,[{start:4,end:10},{start:0,end:2}],{ensure:async(j,f,a,b)=>asked.push([a,b])});fs.rmSync(dir,{recursive:true,force:true});
 assert.deepEqual(asked,[[4,10],[0,2]]);assert.deepEqual(words.map(l=>l.map(w=>w.text)),[['b'],['a']]);
});

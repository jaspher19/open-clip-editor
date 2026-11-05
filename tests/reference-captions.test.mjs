import test from 'node:test';import assert from 'node:assert/strict';import {makeAss,CAPTION_STYLES} from '../server/captions.mjs';
// Reference caption styles (docs/EDIT-CONTRACT.md "Reference template contract"): position, colour rules, box, glow, case, watermark.
const say=(text,step=.5)=>text.split(' ').map((t,i)=>({start:i*step,end:i*step+step*.9,text:t}));
const dialog=ass=>ass.split('\n').filter(l=>l.startsWith('Dialogue:'));
const caption=(ass,layer=0)=>dialog(ass).filter(l=>l.startsWith(`Dialogue: ${layer},`)&&!/\\pos\(\d+,1574\)/.test(l));
const pos=l=>{const m=l.match(/\\an(\d)\\pos\((\d+),(\d+)\)/);return {an:+m[1],x:+m[2],y:+m[3]};};
const colours=l=>[...l.matchAll(/\\c(&H[0-9A-F]{8}&)/g)].map(m=>m[1]);
test('every reference style exists with a label',()=>{for(const id of ['boxed','boxed-yellow','facecam','rainbow','rainbow-rapid','neon-phrase','lowercase','raw-small'])assert.ok(CAPTION_STYLES[id]?.label,id);});
test('middle captions centre on the frame midline in tall and wide output',()=>{
 const tall=pos(caption(makeAss(say('hello'),{style:'clean',captionPosition:'middle'}))[0]);assert.equal(tall.an,5);assert.equal(tall.x,540);assert.ok(Math.abs(tall.y-960)<=30,`y ${tall.y}`);
 const wide=pos(caption(makeAss(say('hello'),{style:'facecam',captionPosition:'middle',outputFormat:'video'}))[0]);assert.equal(wide.an,5);assert.equal(wide.x,960);assert.ok(Math.abs(wide.y-540)<=40,`y ${wide.y}`);
 // Two-line phrases anchor at the block top so the block (2 rows of the font size) straddles the midline.
 const rows=caption(makeAss(say('but he accidentally woke up'),{style:'neon-phrase',captionPosition:'middle'}),1),last=rows.at(-1),p=pos(last),fs=+last.match(/\\fs(\d+)/)[1];
 assert.match(last,/\\N/);assert.equal(p.an,8);assert.equal(p.y+fs,960);assert.ok(rows.every(l=>pos(l).y===p.y),'the block does not jump as words build up');
 for(const [position,y] of [['lower',1330],['center',1250],['upper',860]])assert.equal(pos(caption(makeAss(say('hello'),{style:'clean',captionPosition:position}))[0]).y,y);
});
test('alternate, cycle, keywords and active colour rules',()=>{
 const words=say('one two three four five six seven eight nine ten');
 const alt=caption(makeAss(words,{style:'facecam'})).map(l=>colours(l)[0]),[a,b]=CAPTION_STYLES.facecam.palette;assert.deepEqual(alt.slice(0,4),[a,b,a,b]);
 const cyc=caption(makeAss(words,{style:'rainbow'})).map(l=>colours(l)[0]);assert.ok(cyc.every(c=>CAPTION_STYLES.rainbow.palette.includes(c)));assert.ok(cyc.every((c,i)=>i===0||c!==cyc[i-1]),'never the same colour twice in a row');assert.ok(new Set(cyc).size>=3);
 const kw=caption(makeAss(say('i want my icecream right now'),{style:'boxed',captionReveal:'word'})).map(l=>colours(l)[0]),yellow=CAPTION_STYLES.boxed.palette[0];
 assert.equal(kw.filter(c=>c===yellow).length,1,'only the keyword is yellow');assert.equal(kw[3],yellow,'the longest content word');
 assert.equal(colours(caption(makeAss(say('yes!'),{style:'boxed'}))[0])[0],yellow,'exclamations are emphasised');
 const act=caption(makeAss(say('build this'),{style:'creator'})).at(-1);assert.deepEqual(colours(act),[CAPTION_STYLES.creator.inactive,CAPTION_STYLES.creator.active]);
});
test('solid box style draws an opaque BorderStyle 3 box hugging the word',()=>{
 const ass=makeAss(say('icecream'),{style:'boxed',captionPosition:'middle'});assert.match(ass,/^Style: Box,.*,3,12,0,2,/m);const l=caption(ass)[0];
 assert.match(l,/,Box,/);assert.match(l,/\\bord14\\3c&H00000000&\\3a&H00&\\shad0\\clip\(0,\d+,1080,\d+\)/);const [,top,bottom]=l.match(/\\clip\(0,(\d+),1080,(\d+)\)/).map(Number);assert.ok(top<960&&bottom>960&&bottom-top<160,'box is tight around the capitals');
 assert.doesNotMatch(makeAss(say('icecream'),{style:'clean'}),/Style: Box/,'other styles keep the original header');
});
test('glow and soft shadow sit on a lower layer under the text',()=>{
 const ass=makeAss(say('but he accidentally woke up'),{style:'neon-phrase'}),under=caption(ass,0),top=caption(ass,1);assert.ok(top.length&&under.length===top.length*2);
 const glow=under.filter(l=>/\\blur14/.test(l)).at(-1);assert.match(glow,/\\alpha&H66&\\c&H003CFF3C&\\3c&H003CFF3C&\\bord7\}ACCIDENTALLY/);assert.match(glow,/\{\\alpha&HFF&\}BUT/,'white words do not glow');
 assert.ok(under.some(l=>/\\c&H00000000&\\alpha&H80&\\blur8/.test(l)),'soft black shadow');assert.ok(top.every(l=>/\\bord0\\shad0/.test(l)),'no outline on the text itself');
 const hard=caption(makeAss(say('number'),{style:'facecam'}))[0];assert.match(hard,/\\bord7\\3c&H00000000&\\shad4\\4c&H00000000&\\4a&H00&/);
});
test('lowercase case, letter spacing and minSize',()=>{
 const low=caption(makeAss(say('ABSOLUTELY Insane'),{style:'lowercase'}));assert.match(low[0],/\}absolutely$/);assert.match(low[1],/\}insane$/);
 const up=caption(makeAss(say('hello'),{style:'raw-small'}))[0];assert.match(up,/HELLO/);
 const long=caption(makeAss(say('pneumonoultramicroscopicsilico'),{style:'rainbow-rapid'}))[0];assert.equal(+long.match(/\\fs(\d+)/)[1],CAPTION_STYLES['rainbow-rapid'].minSize,'shrinks no further than minSize');
 assert.equal(+up.match(/\\fs(\d+)/)[1],CAPTION_STYLES['raw-small'].size,'small Montserrat sizes below the old 70 px floor');
 assert.doesNotMatch(makeAss(say('hi'),{style:'clean'}),/\\fsp/);CAPTION_STYLES.spacedTest={...CAPTION_STYLES.clean,spacing:3};try{assert.match(caption(makeAss(say('hi'),{style:'spacedTest'}))[0],/\\fs\d+\\fsp3\\bord/);}finally{delete CAPTION_STYLES.spacedTest;}
});
test('watermark layer spans the clip, faded and centred at watermarkY',()=>{
 const ass=makeAss(say('hello'),{style:'boxed',duration:12,watermark:'@ClippingIRL',watermarkY:.82}),wm=dialog(ass).find(l=>l.includes('@ClippingIRL'));
 assert.match(wm,/^Dialogue: -1,0:00:00\.00,0:00:12\.00,/);assert.match(wm,/\\an5\\pos\(540,1574\)\\fnAnton\\fs38\\c&H00FFFFFF&\\1a&H8C&\\3c&H00000000&\\3a&HB4&\\bord2\\shad0\}@ClippingIRL$/);
 const wide=dialog(makeAss(say('hello'),{style:'clean',duration:5,watermark:'@me',watermarkY:.9,outputFormat:'video'})).find(l=>l.includes('@me'));assert.match(wide,/\\pos\(960,972\)\\fnWork Sans\\fs30/);
 assert.ok(!dialog(makeAss(say('hello'),{style:'boxed',duration:12})).some(l=>/\\1a&H8C&/.test(l)),'no watermark when empty');
});

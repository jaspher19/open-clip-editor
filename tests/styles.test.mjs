import test from 'node:test';import assert from 'node:assert/strict';import {makeAss,makeSrt} from '../server/captions.mjs';import {mapFaceTrack,cropCenterExpression} from '../server/framing.mjs';import {validateOptions} from '../server/options.mjs';import {EDIT_TEMPLATES,applyTemplate} from '../server/templates.mjs';
const words=[{start:0,end:.5,text:'Build'},{start:.6,end:1,text:'this.'}];
test('creator and focus captions produce finite motion and portable SRT',()=>{
 const creator=makeAss(words,{style:'creator',progressBar:true,duration:20});assert.match(creator,/\\t\(/);assert.match(creator,/\\clip\(/);assert.match(creator,/BUILD/);assert.ok(!creator.includes('NaN'));
 const focus=makeAss(words,{style:'focus'});assert.match(focus,/Red Hat Mono/);assert.match(makeSrt(words),/00:00:00,000 --> 00:00:01,000/);
 assert.equal(validateOptions({style:'creator',framing:'face'}).faceTrack,true);assert.equal(validateOptions({framing:'fit'}).framing,'fit');assert.throws(()=>validateOptions({musicVolume:4}),/musicVolume/);
});
test('face path follows EDL output time with a center fallback',()=>{
 const edl=[{start:10,end:12,outputStart:0,outputEnd:2},{start:20,end:22,outputStart:2,outputEnd:4}];const samples=[{time:10,centerX:.3},{time:12,centerX:.5},{time:20,centerX:.7},{time:22,centerX:.9}];const mapped=mapFaceTrack(samples,edl);assert.equal(mapped[0].time,0);assert.equal(mapped.at(-1).time,4);assert.ok(mapped.every(p=>p.centerX>=0&&p.centerX<=1));
 assert.equal(cropCenterExpression([]),'0.5');const expr=cropCenterExpression(mapped);assert.match(expr,/if/);assert.ok(!expr.includes('NaN'));
});
test('a long on-screen title ends at a whole word, never mid-word',()=>{
 const title="I know I've been seeing you all over time and trying to catch you because I've been saving";
 const ass=makeAss([{start:0,end:.5,text:'hi'}],{style:'editorial',title,duration:20,hookEnabled:true,titleMode:'persistent',framing:'editorial',font:'work'});
 const shown=ass.split('\n').filter(l=>l.startsWith('Dialogue:')).map(l=>l.replace(/\{[^}]*\}/g,'').split(',').slice(9).join(',')).join(' ');
 assert.match(shown,/because I've…/);assert.doesNotMatch(shown,/I've b(\N|\s|$)/);});
test('the title sits at the top with no dark box, and context stacks right under it',()=>{
 const tpl=EDIT_TEMPLATES.find(t=>t.id==='word-punch');const opts=validateOptions(applyTemplate('word-punch',{},{titleMode:'persistent'}));
 assert.equal(validateOptions({}).titleMode,'persistent');
 const ass=makeAss(words,{...opts,title:'What are you doing here',contextText:'Spider-Man meets a fan',duration:30});const dialog=ass.split('\n').filter(l=>l.startsWith('Dialogue:'));
 assert.ok(!dialog.some(l=>/\\p1[^}]*\\alpha&H35&/.test(l)),'no translucent box behind the title');
 const title=dialog.find(l=>/what are you/i.test(l)),context=dialog.find(l=>l.includes('Spider-Man meets'));const y=l=>Number(l.match(/\\(?:pos|move)\(\d+,(\d+)/)[1]);
 assert.match(title,/0:00:30\.00/);assert.ok(y(title)>=230&&y(title)<=320,'title is near the top, below the stream-overlay band');assert.ok(y(context)>y(title)&&y(context)<640,'context sits just below the title');assert.ok(!tpl.settings.contextText);});

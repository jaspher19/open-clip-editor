import test from 'node:test';import assert from 'node:assert/strict';
import {memePlan,placeLabels,withLabels,skullAss,skullGraph,labelAss,lookFilter,toOutput} from '../server/meme-edit.mjs';import {buildClipEdl,clockEdl,playedLength,SKULL_HOLD,REVEAL_HOLD} from '../server/edl.mjs';import {makeAss} from '../server/captions.mjs';import {validateOptions} from '../server/options.mjs';import {applyTemplate} from '../server/templates.mjs';
const words=[['I',0,.3],["I'm",.3,.6],['getting',.6,1],['a',1,1.1],['little',1.1,1.5],['fat.',1.5,2],['Oh',3.4,3.7],['my',3.7,3.9],['gosh!',3.9,4.4],['Look',4.5,4.8],['at',4.8,5],['my',5,5.2],['stomach.',5.2,5.8],['No',7.6,7.9],["I'm",7.9,8.1],['not!',8.1,8.5],['Wait,',8.6,9],['how',9,9.3],['can',9.3,9.6],['I',9.6,9.7],['do',9.7,9.9],['that?',9.9,10.4]].map(([text,start,end])=>({text,start,end}));
const clip={start:0,end:10.6,peakAt:3.4};
test('the meme reveal freezes the frame before the jump cut while the sound fades out, then lands with an exposure flash and a boom',()=>{
 const options=validateOptions(applyTemplate('meme-reveal',{}));const edl=clockEdl(buildClipEdl(words,clip,options)),duration=edl.at(-1).outputEnd,hold=edl.find(s=>s.reveal);
 assert.equal(hold.kind,'freeze');assert.equal(hold.hold,REVEAL_HOLD);assert.ok(hold.start<2.1&&hold.start>1.9,'the held frame is the last one before the cut');assert.equal(edl[edl.indexOf(hold)+1].start>3,true,'the cut follows the hold');
 const plan=memePlan(words,edl,{duration,options});assert.equal(plan.reveal,hold.outputEnd);assert.deepEqual(plan.fades,[[Math.max(0,hold.outputStart-.3),hold.outputStart]]);
 assert.deepEqual(plan.cues.map(c=>c.sound),['meme/boom']);assert.ok(plan.looks.some(l=>l.kind==='reveal'&&l.at===plan.reveal));
 assert.ok(plan.looks.some(l=>l.kind==='green'||l.kind==='red'),'a shouted word gets a tint');assert.equal(plan.looks.find(l=>words.some(w=>/^No$/.test(w.text)&&Math.abs(toOutput(w.start,edl)-l.at)<.01))?.kind??'red','red','a no is red');
 assert.ok(plan.looks.filter(l=>l.kind==='exposure').every(l=>Math.abs(l.at-plan.reveal)>1),'cut flashes keep clear of the reveal');
 const eq=lookFilter(plan.looks);assert.match(eq,/^eq=eval=frame:brightness='0\+/);assert.match(eq,/gamma_[rg]='1\+/);
 const off=memePlan(words,clockEdl(buildClipEdl(words,clip,validateOptions({}))),{duration,options:validateOptions({})});assert.equal(off.reveal,null);assert.equal(off.looks.length+off.cues.length,0,'nothing is added unless a template asks');
});
test('labels are anchored to quoted words, must name a physical action, and replace only earlier automatic labels',()=>{
 const placed=placeLabels([{text:'*gets fat*',after:'getting a little fat'},{text:'CHANGES THE RULES',after:'look at my stomach'},{text:'FAT',after:'never said this'},{text:'SKINNY',after:'how can I do'}],words,clip);
 assert.deepEqual(placed.map(l=>l.text),['GETS FAT','SKINNY']);assert.equal(placed[0].at,2.05);assert.ok(placed.every(l=>l.auto&&l.type==='label'));
 const mine={id:'own',type:'label',at:1,text:'MINE'};assert.deepEqual(withLabels([mine,{id:'old',type:'label',at:2,text:'OLD',auto:true}],placed).map(e=>e.id),['own',...placed.map(l=>l.id)]);
 assert.match(labelAss([{type:'label',out:1,dur:.9,text:'gets fat'}]),/\*GETS FAT\*/);assert.match(labelAss([{type:'label',out:1,dur:.9,text:'gets fat'}]),/\\t\(70,71,\\c&HFFFFFF&\)/,'red first, then white');
});
test('the skull ending holds the last frame for 2.9 s with a smear, punch-in, flames, a mind-blown skull and a slow 808',()=>{
 const options=validateOptions(applyTemplate('skull-ending',{}));const edl=clockEdl(buildClipEdl(words,clip,options)),tail=edl.at(-1),duration=tail.outputEnd;
 assert.equal(tail.kind,'skull');assert.equal(tail.hold,SKULL_HOLD);assert.ok(Math.abs(tail.start-edl.at(-2).end)<.05,'the held frame is the last kept frame');assert.ok(Math.abs(playedLength(words,clip,options)-playedLength(words,clip,validateOptions({}))-SKULL_HOLD)<.05);
 const plan=memePlan(words,edl,{duration,options});assert.equal(plan.skull.start,tail.outputStart);assert.deepEqual(plan.cues.map(c=>c.sound),['meme/whoosh','meme/skull-808']);assert.equal(plan.looks.length,0,'no cut flashes on this template');
 const ass=skullAss(plan.skull).split('\n');assert.equal(ass.filter(l=>l.startsWith('Dialogue: 5')).length,6,'a floor haze and five flames');assert.ok(ass.filter(l=>l.startsWith('Dialogue: 7')&&l.includes('\\move')).length>=8,'cap and jaw move on each beat');
 const graph=skullGraph('a','b',plan.skull);assert.match(graph[1],/^\[sks\]trim=start=/);assert.match(graph[1],/scale=1210:2150,crop=1080:1920/);assert.match(graph.at(-1),/overlay=eof_action=pass\[b\]$/);
});
test('a middle title holds the middle spot: captions wait until it is gone',()=>{
 const ass=makeAss(words,{...validateOptions(applyTemplate('skull-ending',{})),title:'Speed proves he is strong',duration:12}).split('\n'),first=ass.find(l=>/^Dialogue: [01],/.test(l)&&!l.includes(',Title,'));
 assert.ok(Number(first.match(/^Dialogue: \d,0:00:(\d\d\.\d\d),/)[1])>=2.4,'no caption under the title');const top=Number(ass.join('\n').match(/,Title,,0,0,0,,\{\\an8\\pos\(540,(\d+)\)/)[1]);assert.ok(top>700&&top<900,`title block is centred near 47% height (${top})`);
});
test('meme captions change colour on each new sentence and the hook can type on letter by letter',()=>{
 const ass=makeAss(words,validateOptions(applyTemplate('meme-reveal',{})));const colourOf=w=>ass.match(new RegExp(`\\{\\\\c(&H[0-9A-F]+&)\\}${w}`,'i'))?.[1];
 assert.equal(colourOf('GETTING'),'&H0000F2FF&');assert.equal(colourOf('GOSH!'),'&H00FFE63C&');assert.equal(colourOf('LOOK'),'&H0000F2FF&');
 const typed=makeAss(words,{...validateOptions(applyTemplate('skull-ending',{})),title:'Kai Cenat proves he can dance',duration:12});assert.match(typed,/\\ko\d+\}K\{\\ko\d+\}A/);assert.match(typed,/\\2a&HFF&/);
});
test('meme templates find their own short moments: a reveal after a jump cut, or a clip that ends on the punchline',async()=>{
 const {pickClips}=await import('../server/selection.mjs'),{selectionPrompt}=await import('../server/providers.mjs');
 const stream=[];let t=0;const say=(text,gap=.05)=>{t+=gap;for(const w of text.split(' ')){stream.push({text:w,start:+t.toFixed(2),end:+(t+.28).toFixed(2)});t+=.32;}};
 while(t<420){if(Math.abs(t-140)<2){say('so he walks up to the counter and asks for it.');say('No way! Oh my god! Let\'s go!',1.4);say('Haha haha that is insane.');}
  else if(Math.abs(t-300)<2){say('and then he tries the jump again.');say('Bro what! Haha haha lmao I\'m dead.',.9);}
  else say('we are just talking about the plan for the next round right now.');}
 const transcript={words:stream,duration:t},pick=id=>pickClips(transcript,validateOptions(applyTemplate(id,{count:3})));
 assert.ok(pick('meme-reveal').length&&pick('skull-ending').length,'moments found');
 for(const c of pick('meme-reveal')){const len=c.end-c.start;assert.ok(len>=10&&len<=32,`short window (${len})`);assert.ok(c.peakAt/len>=.45&&c.peakAt/len<=.85,'payoff late in the clip');assert.ok(c.reasons.includes('Reveal moment for this template'));}
 for(const c of pick('skull-ending'))assert.ok(c.end-(c.start+c.peakAt)<=5,'ends on the punchline');
 assert.ok(pick('context-hit').every(c=>c.end-c.start>=45),'other templates keep minute-long moments');
 assert.match(selectionPrompt({segments:[],duration:400},validateOptions(applyTemplate("meme-reveal",{count:3}))),/11–24 seconds.*jump cut \(a reveal\)/);
});
test('the AI judges a pool of meme-shaped candidates: its best-scored moments win, times snap to words and fit the format',async()=>{
 const {judgeMoments,judgeReady,fitPick}=await import('../server/meme-judge.mjs');
 const stream=[];let t=0;const say=(text,gap=.05)=>{t+=gap;for(const w of text.split(' ')){stream.push({text:w,start:+t.toFixed(2),end:+(t+.28).toFixed(2)});t+=.32;}};
 while(t<900){const k=Math.round(t/150);if(Math.abs(t-k*150)<2&&k>0){say(`so number ${k} walks up to the counter and asks for the big one.`);say('No way! Oh my god! Haha haha that is insane.',1.2);}else say('we are just talking about the plan for the next round right now.');}
 const transcript={words:stream,duration:t},options=validateOptions(applyTemplate('skull-ending',{count:3}));let prompt='';
 // The fake AI loves candidate 4 and 2, and asks candidate 2 to end far after its punchline (which must be pulled back).
 const ask=async({user})=>{prompt=user;const pool=[...user.matchAll(/^#(\d+) window ([\d.]+)-([\d.]+) · local pick ([\d.]+)-([\d.]+), peak ([\d.]+)/gm)].map(m=>({id:+m[1],start:+m[4],end:+m[5],peak:+m[6]}));
  return {provider:'gemini',model:'test',data:{picks:pool.map(c=>({id:c.id,start:c.start,payoff:c.peak,end:c.id===2?c.end+5:c.end,score:c.id===4?95:c.id===2?90:30,why:`moment ${c.id}`}))}};};
 const {clips,status}=await judgeMoments(transcript,options,{ask});
 assert.equal(status.status,'done');assert.ok(status.pool>=4);assert.match(prompt,/SKULL ENDING/);assert.equal(clips.length,3);
 assert.deepEqual(clips.slice(0,2).map(c=>c.reasons[0]),['AI pick: moment 4','AI pick: moment 2'],'ranked by the AI score');
 for(const c of clips){assert.ok(stream.some(w=>Math.abs(w.start-.08-c.start)<1e-6),'starts on a word');assert.ok(c.end-(c.start+c.peakAt)<=4.2,'ends on the punchline');}
 const failed=await judgeMoments(transcript,options,{ask:async()=>{throw new Error('Gemini is busy');}});assert.equal(failed.status.status,'failed');assert.equal(failed.clips.length,3,'local picks are kept');
 assert.equal(fitPick({start:0,payoff:1,end:2},{start:0,end:20,peakAt:10},stream,options),null,'too short for the format');
 assert.equal(judgeReady(options,{GEMINI_API_KEY:'x'}),true);assert.equal(judgeReady(validateOptions(applyTemplate('context-hit',{})),{GEMINI_API_KEY:'x'}),false,'meme templates only');assert.equal(judgeReady(options,{}),false);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {makeAss,maskProfanity,emphasisIndex} from '../server/captions.mjs';import {smoothFaceTrack,mapFaceTrack,cropCenterExpression,cropFraction} from '../server/framing.mjs';
import {zoomFilter,applyTemplate} from '../server/templates.mjs';
const titleLine=ass=>ass.split('\n').find(l=>l.startsWith('Dialogue: 2,')&&l.includes('\\fs'));

test('burned-in text masks swearing and slurs but keeps first and last letters',()=>{
 assert.equal(maskProfanity('What the FUCK, bitch'),'What the F**K, b***h');assert.equal(maskProfanity('motherfucker'),'m********ker');assert.equal(maskProfanity('Kai wins'),'Kai wins');
 const ass=makeAss([{start:0,end:.5,text:'shit'}],{style:'impact',title:'This Shit Is Wild',duration:5});assert.ok(!/shit/i.test(ass));assert.match(ass,/S\*\*T/);
 assert.match(makeAss([{start:0,end:.5,text:'shit'}],{style:'clean',maskProfanity:false}),/shit/);
});
test('the emphasis word is the action word, a payoff word, or the name',()=>{
 const pick=t=>{const w=t.split(' ');return w[emphasisIndex(w)];};
 assert.equal(pick('Speed Climbs A Pole On Stream'),'Climbs');assert.equal(pick('Kai Cenat Gets Jump Scared'),'Scared');assert.equal(pick('Werewolf Gets Roasted By Daredevil'),'Roasted');assert.equal(pick('Duke Dennis Goes Viral'),'Viral');
});
test('modern hook title: Title Case kept, two lines max, accent word, pop-in, below the overlay band',()=>{
 const ass=makeAss([{start:0,end:1,text:'hi'}],{style:'reaction',title:'Werewolf Gets Roasted By Daredevil At The Halloween Party Tonight For Real',duration:20,titleMode:'persistent',accentColor:'#ffe36c'});
 const line=titleLine(ass),body=line.split(',,').at(-1);
 assert.match(line,/\\fnMontserrat Black/);assert.match(body,/Werewolf/,'Title Case is not forced to caps');assert.ok(body.split('\\N').length<=2,'at most two lines');
 assert.match(body,/\{\\c&H006ce3ff&\}Roasted\{\\c&H00FFFFFF&\}/i,'one accent word');assert.match(line,/\\t\(0,140,\\fscx106/);assert.match(line,/\\bord8\\shad5/);
 const y=Number(line.match(/\\pos\(540,(\d+)\)/)[1]);assert.ok(y>=240,'clear of viewer counters in the top 13%');
 assert.match(titleLine(makeAss([],{style:'impact',title:'Kai Cenat Gets Jump Scared',duration:5})),/KAI CENAT/,'all-caps templates stay all-caps');
 const wide=titleLine(makeAss([],{style:'impact',title:'Kai Cenat Gets Jump Scared',duration:5,outputFormat:'video'}));assert.ok(!wide.includes('\\N'),'16:9 keeps a short title on one line');
});
test('captions sit in the lower-middle band, never at frame centre',()=>{
 for(const captionPosition of ['lower','center']){const ass=makeAss([{start:0,end:1,text:'hello'}],{style:'impact',captionPosition});const y=Number(ass.match(/Dialogue: 0,[^\n]*\\pos\(540,(\d+)\)/)[1]);assert.ok(y>=1240&&y<=1400,captionPosition+' at '+y);}
});
test('face follow keeps every detected face box inside the crop and does not lag behind',()=>{
 const fraction=cropFraction(1920,1080);assert.ok(Math.abs(fraction-.3164)<.001);
 // Subject jumps from the left third to the right third at t=4.
 const samples=Array.from({length:21},(_,i)=>{const t=i*.4,x=t<4?.3:.7;return {time:t,centerX:.5,rawX:x,left:x-.06,right:x+.06};});
 const out=smoothFaceTrack(samples,{fraction});
 for(const p of out){assert.ok(p.left>=p.centerX-fraction/2-1e-9&&p.right<=p.centerX+fraction/2+1e-9,`face box inside crop at ${p.time}`);}
 assert.ok(Math.abs(out[0].centerX-.3)<.08&&Math.abs(out.at(-1).centerX-.7)<.08);
 const legacy=[{time:0,centerX:.4},{time:1,centerX:.6}];assert.deepEqual(smoothFaceTrack(legacy),legacy,'old tracks without boxes are unchanged');
});
test('long camera paths compile to a shallow expression ffmpeg accepts',()=>{
 const track=Array.from({length:121},(_,i)=>({time:i*.3,centerX:.5+.2*Math.sin(i)}));const expr=cropCenterExpression(track);let depth=0,max=0;for(const c of expr){if(c==='(')max=Math.max(max,++depth);else if(c===')')depth--;}
 assert.ok(max<30,'nesting depth '+max);
 const ev=new Function('t','iff','lt','gte','return '+expr.replace(/if\(/g,'iff('));const iff=(c,a,b)=>c?a:b,lt=(a,b)=>a<b,gte=(a,b)=>a>=b;
 for(let i=0;i<120;i++){const m=(track[i].time+track[i+1].time)/2,want=(track[i].centerX+track[i+1].centerX)/2;assert.ok(Math.abs(ev(m,iff,lt,gte)-want)<1e-4);}
 assert.ok(mapFaceTrack(track,[{start:0,end:36,outputStart:0,outputEnd:36}]).length<=122);
});
test('punch-ins land on speech beats when there are any',()=>{
 const opts=applyTemplate('context-hit',{});assert.match(zoomFilter(opts,[1.2,6]),/between\(on\/30,1\.200,/);assert.match(zoomFilter(opts,[]),/mod\(on/);
});

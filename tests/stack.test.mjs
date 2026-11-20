import test from 'node:test';import assert from 'node:assert/strict';
import {stackPanels,defaultGameBox,stackFilters,stackPlan,validBox,SPLIT_MIN,SPLIT_MAX} from '../server/stack.mjs';
import {coverRect} from '../web/src/logic.mjs';
import {validateOptions} from '../server/options.mjs';
import {videoFilters,SETTING_KEYS} from '../server/render.mjs';

test('the facecam panel takes the cam\'s own shape, within 25-55% of the height',()=>{
 // A 16:9 cam at full width is 1080x608 (32%); a 4:3-ish cam is taller; extreme shapes are clamped.
 assert.deepEqual(stackPanels([0,0,.25,.25]),{top:608,bottom:1312});
 const tall=stackPanels([0,0,.21,.3]);assert.ok(tall.top>800&&tall.top<900,String(tall.top));
 assert.equal(stackPanels([0,0,.5,.1]).top,Math.round(1920*SPLIT_MIN/2)*2);
 assert.equal(stackPanels([0,0,.1,.6]).top,Math.round(1920*SPLIT_MAX/2)*2);
 // A chosen split wins and is clamped; panels always fill 1920 with even heights.
 assert.equal(stackPanels([0,0,.25,.25],{split:.4}).top,768);
 assert.equal(stackPanels([0,0,.25,.25],{split:.9}).top,1056);
 for(const p of [stackPanels([0,0,.2,.27]),stackPanels([0,.1,.3,.2],{sourceAspect:4/3})]){assert.equal(p.top+p.bottom,1920);assert.equal(p.top%2,0);}
});

test('default gameplay crop is full height, centred, shaped like the bottom panel',()=>{
 const [x,y,w,h]=defaultGameBox(1312);assert.equal(y,0);assert.equal(h,1);
 assert.ok(Math.abs(x+w/2-.5)<1e-3);assert.ok(Math.abs((w*16/9)/h-1080/1312)<.002);
 // A source narrower than the panel keeps its whole width.
 assert.deepEqual(defaultGameBox(1312,9/16),[0,0,1,1]);
});

test('cover crop trims a box to the panel shape around its centre',()=>{
 const [x,y,w,h]=coverRect([0,0,.5,.5],1,16/9);assert.ok(Math.abs(w*16/9-h)<1e-9);assert.ok(Math.abs(x+w/2-.25)<1e-9);assert.equal(y,0);
 const t=coverRect([.1,.1,.2,.8],1,16/9);assert.equal(t[2],.2);assert.ok(Math.abs(t[1]+t[3]/2-.5)<1e-9);
});

test('a manual box wins over the detected cam; no cam means no stack',()=>{
 const detected={found:true,box:[0,.16,.23,.24]};
 assert.deepEqual(stackPlan({},detected).camBox,[0,.16,.23,.24]);
 assert.match(stackPlan({},detected).note,/automatically/);
 const manual=stackPlan({camBox:[.7,0,.3,.3],gameBox:[0,0,.4,1]},detected);
 assert.deepEqual(manual.camBox,[.7,0,.3,.3]);assert.deepEqual(manual.gameBox,[0,0,.4,1]);assert.match(manual.note,/your box/);
 assert.equal(stackPlan({},{found:false,box:null}),null);
 assert.equal(stackPlan({},null),null);
 assert.equal(stackPlan({},{found:true,box:[.9,.9,.5,.5]}),null,'a box outside the frame is ignored');
});

test('the stacked graph crops both boxes, covers each panel and stacks them',()=>{
 const plan=stackPlan({},{found:true,box:[0,.16,.23,.24]});const lines=stackFilters(plan);
 assert.equal(lines[0],'[cutv]split=2[camsrc][gamesrc]');
 assert.match(lines[1],new RegExp(`scale=1080:${plan.top}:force_original_aspect_ratio=increase,crop=1080:${plan.top}`));
 assert.match(lines[2],new RegExp(`crop=1080:${plan.bottom}`));
 assert.equal(lines.at(-1),'[campanel][gamepanel]vstack=inputs=2,setsar=1[framed]');
 // The video chain uses it only for the facecam framing on vertical exports.
 const options=validateOptions({framing:'stack'});
 assert.ok(videoFilters(options,{stack:plan}).filters.some(f=>f.includes('vstack')));
 assert.ok(!videoFilters(options,{stack:null}).filters.some(f=>f.includes('vstack')),'no cam: center crop');
 assert.ok(!videoFilters(validateOptions({framing:'stack',outputFormat:'video'}),{stack:plan}).filters.some(f=>f.includes('vstack')));
});

test('stack options are validated and saved per clip',()=>{
 const o=validateOptions({framing:'stack',camBox:[0,0,.2,.3],gameBox:[.3,0,.45,1],stackSplit:.4});
 assert.deepEqual([o.camBox,o.gameBox,o.stackSplit],[[0,0,.2,.3],[.3,0,.45,1],.4]);
 assert.deepEqual([validateOptions({}).camBox,validateOptions({}).gameBox,validateOptions({}).stackSplit],[null,null,null]);
 for(const bad of [{camBox:[0,0,1.2,.3]},{camBox:[0,0,.2]},{gameBox:['a',0,.2,.2]},{camBox:[.9,0,.2,.2]},{stackSplit:.9},{stackSplit:'x'}])assert.throws(()=>validateOptions(bad),/Invalid/);
 for(const k of ['camBox','gameBox','stackSplit'])assert.ok(SETTING_KEYS.includes(k));
 assert.ok(validBox([0,0,1,1]));assert.ok(!validBox([0,0,0,1]));
});

// ---- Cam Split template: reaction zooms ----
import fs from 'node:fs';import path from 'node:path';import {CACHE} from '../server/config.mjs';
import {reactionWindows,zoomBox,readPcm,ZOOM} from '../server/stack.mjs';
import {formatFor} from '../server/remote.mjs';
function wav(file,seconds,loudAt=[]){
 const rate=16000,n=seconds*rate,data=Buffer.alloc(n*2);
 for(let i=0;i<n;i++){const t=i/rate,hit=loudAt.find(([a])=>t>=a&&t<a+.6);data.writeInt16LE(Math.round(Math.sin(i*.3)*(hit?hit[1]:900)),i*2);}
 const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+data.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(data.length,40);
 fs.writeFileSync(file,Buffer.concat([h,data]));
}
test('reaction zooms: the opening hook plus the loudest moments, spaced apart, away from the ending',()=>{
 fs.mkdirSync(CACHE,{recursive:true});const file=path.join(fs.mkdtempSync(path.join(CACHE,'react-')),'audio.wav');
 // Source 100-160 s plays as output 0-60 s; shouts at source 110, 112 (too close to 110), 130 and 158 (inside the ending).
 wav(file,170,[[110,26000],[112,18000],[130,20000],[158,26000]]);
 assert.equal(readPcm(file,1,2).samples.length,16000);
 const windows=reactionWindows({audio:file,edl:[{start:100,end:160,outputStart:0,outputEnd:60}],duration:60});
 assert.deepEqual(windows[0],[0,1.2],'opens tight on the face');
 const peaks=windows.slice(1).map(w=>w[0]+.35);
 assert.equal(peaks.length,2);assert.ok(Math.abs(peaks[0]-10)<.6&&Math.abs(peaks[1]-30)<.6,JSON.stringify(peaks));
 for(const [a,b] of windows.slice(1))assert.ok(b-a<=1.5+1e-9);
});
test('the tight cam crop stays inside the cam box, around the face',()=>{
 const cam=[0,.16,.24,.24],face=[.08,.26,.04,.07],[x,y,w,h]=zoomBox(cam,face);
 assert.ok(Math.abs(w-cam[2]/ZOOM)<1e-4&&Math.abs(h-cam[3]/ZOOM)<1e-4);
 assert.ok(x>=cam[0]&&y>=cam[1]&&x+w<=cam[0]+cam[2]+1e-9&&y+h<=cam[1]+cam[3]+1e-9);
 assert.ok(x<=face[0]&&x+w>=face[0]+face[2],'face inside horizontally');
 // A face at the box edge pushes the crop against that edge, never outside.
 assert.equal(zoomBox(cam,[0,.17,.03,.05])[0],0);
});
test('Cam Split graph: a tight cam shown over the wide one during the windows',()=>{
 const plan=stackPlan({},{found:true,box:[0,.16,.23,.24],face:[.08,.26,.037,.066]});
 const lines=stackFilters({...plan,zooms:[[0,1.2],[10,11.5]]});
 assert.equal(lines[0],'[cutv]split=3[camsrc][zoomsrc][gamesrc]');
 assert.ok(lines.some(l=>l.includes("overlay=0:0:enable='between(t,0.000,1.200)+between(t,10.000,11.500)'")));
 assert.deepEqual(validateOptions({camTakeover:'zoom'}).camTakeover,'zoom');assert.throws(()=>validateOptions({camTakeover:'full'}),/camTakeover/);
});
test('vertical sources keep the whole frame and download at their real 1080p',()=>{
 const options=validateOptions({framing:'letterbox'});
 const nine=videoFilters(options,{portrait:9/16}).filters.join(';');
 assert.match(nine,/\[cutv\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/);assert.doesNotMatch(nine,/1440/,'no letterbox band');
 assert.match(videoFilters(options,{portrait:3/4}).filters.join(';'),/boxblur/,'other portrait shapes get a blurred fill');
 assert.match(videoFilters(validateOptions({framing:'stack'}),{portrait:9/16,stack:stackPlan({},{found:true,box:[0,0,.2,.2]})}).filters.join(';'),/^\[cutv\]scale=1080:1920/,'no stacking on a vertical source');
 assert.match(formatFor('youtube','section',360,{portrait:true}),/\[width<=1080\]/);assert.doesNotMatch(formatFor('youtube','section',360,{portrait:true}),/\[height/);
 assert.match(formatFor('twitch','proxy',360,{portrait:true}),/\[width<=360\]/);assert.match(formatFor('twitch','proxy',360),/\[height<=360\]/);
});

import {cardCamBox,CARD} from '../server/stack.mjs';import {groupWords,makeAss} from '../server/captions.mjs';
test('Glow Card: the cam is cropped to the card keeping the head, gameplay fills a full-width band',()=>{
 // A 4:3 cam (Jynxzi's) is taller than the 880x544 card: the crop loses height and keeps the face about 45% down.
 const cam=[0,.44,.23,.31],face=[.08,.47,.06,.1],box=cardCamBox(cam,face,16/9);
 assert.ok(Math.abs(box[2]*16/9/box[3]-CARD.cam.w/CARD.cam.h)<.01,'card shape');assert.equal(box[0],0);assert.equal(box[2],.23);
 assert.ok(box[1]>=cam[1]&&box[1]+box[3]<=cam[1]+cam[3]+1e-6,'inside the cam');assert.ok(box[1]<=face[1],'the head stays in');
 const noFace=cardCamBox(cam,null,16/9);assert.ok(noFace[1]-cam[1]<(cam[3]-noFace[3])/2,'without a face it keeps the upper part');
 const wideCam=cardCamBox([.6,0,.4,.2],null,16/9);assert.ok(Math.abs(wideCam[2]*16/9/wideCam[3]-CARD.cam.w/CARD.cam.h)<.01);assert.equal(wideCam[3],.2);
 const plan=stackPlan({stackStyle:'card'},{found:true,box:cam,face},16/9);
 assert.equal(plan.style,'card');assert.equal(plan.bottom,CARD.game.h);assert.deepEqual(plan.camBox,box);assert.match(plan.note,/Glow card/);
 const graph=stackFilters({...plan,overlays:'../../assets/overlays'}).join(';\n');
 assert.match(graph,/split=3\[camsrc\]\[gamesrc\]\[bgsrc\]/);assert.match(graph,/boxblur/);assert.match(graph,/scale=1080:1210/);assert.match(graph,/overlay=0:530/);
 assert.match(graph,/scale=880:544/);assert.match(graph,/movie=\.\.\/\.\.\/assets\/overlays\/cam-card-mask\.png/);assert.match(graph,/alphamerge/);assert.match(graph,/overlay=100:48/);assert.match(graph,/cam-card-frame\.png\[cardframe\]/);assert.match(graph,/\[framed\]$/);
 const zoomed=stackFilters({...plan,zooms:[[1,2]]}).join(';');assert.match(zoomed,/split=4/);assert.match(zoomed,/between\(t,1\.000,2\.000\)/);
 for(const f of ['cam-card-frame.png','cam-card-mask.png'])assert.ok(fs.existsSync(path.join('assets','overlays',f)),f);
 assert.equal(validateOptions({stackStyle:'card'}).stackStyle,'card');assert.throws(()=>validateOptions({stackStyle:'round'}),/stackStyle/);assert.ok(SETTING_KEYS.includes('stackStyle'));
});
test('Glow Card captions: pairs only around linking words or numbers, centred under the card',()=>{
 const w=(t,i,gap=0)=>({text:t,start:i*.4+gap,end:i*.4+.35+gap});
 const words=['The','money','is','gone,','sick','GTA','6','watch','this'].map((t,i)=>w(t,i));
 assert.deepEqual(groupWords(words,{maxWords:2,maxChars:12,pairing:'link'}).map(g=>g.map(x=>x.text).join(' ')),['The money','is gone,','sick','GTA 6','watch this']);
 const ass=makeAss([w('Probably',0)],{style:'comic-word',captionPosition:'seam',hookEnabled:false,duration:2});
 const at=ass.match(/\\an5\\pos\(540,(\d+)\)/);assert.ok(at,'centred anchor');const y=+at[1];assert.ok(Math.abs(y-CARD.captionY)<60,`caption at ${y}`);
 assert.ok(ass.includes('\\fnLuckiest Guy'));assert.match(ass,/PROBABLY/);assert.equal(validateOptions({captionPosition:'seam'}).captionPosition,'seam');
});

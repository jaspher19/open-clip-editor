import test from 'node:test';import assert from 'node:assert/strict';
import {defaultLayout,applyPreset,PRESETS,withPanel,withCamera,refit,moveBox,resizeBox,pixelAspect,shareRatio,coverSource,OUTPUT} from '../web/src/cutlayout.mjs';
import {validateCut,validateLayout,decodeOverlay,cutGraph,panelPixels} from '../server/cut.mjs';

const near=(a,b,eps=.01)=>assert.ok(Math.abs(a-b)<=eps,`${a} ≈ ${b}`);
const inside=b=>assert.ok(b[0]>=0&&b[1]>=0&&b[0]+b[2]<=1.0001&&b[1]+b[3]<=1.0001,`inside: ${b}`);

test('cutter layout: every source box has its panel’s shape, so the box is exactly what shows',()=>{
 for(const format of ['shorts','video']){const {width,height}=OUTPUT[format],l=defaultLayout(format,1920,1080);
  for(const [src,out] of [['cam','camOut'],['game','gameOut']]){inside(l[src]);near(pixelAspect(l[src],1920,1080),pixelAspect(l[out],width,height),.02);}
  for(const p of PRESETS[format]){const n=applyPreset(l,p,format,1920,1080);for(const [src,out] of [['cam','camOut'],['game','gameOut']]){inside(n[src]);near(pixelAspect(n[src],1920,1080),pixelAspect(n[out],width,height),.02);}}}
 // Portrait default: camera band on top, gameplay below, together covering the frame.
 const p=defaultLayout('shorts');assert.deepEqual([p.camOut[1],+(p.camOut[3]+p.gameOut[3]).toFixed(4)],[0,1]);
});
test('cutter layout: resizing a panel re-shapes its source box around the same spot',()=>{
 const l=defaultLayout('shorts',1920,1080),n=withPanel(l,'game',[0,.5,1,.5],'shorts',1920,1080);
 near(pixelAspect(n.game,1920,1080),1080/960,.02);near(n.game[0]+n.game[2]/2,l.game[0]+l.game[2]/2,.02);
 const r=refit([.9,.9,.1,.1],3,1920,1080);inside(r);near(pixelAspect(r,1920,1080),3,.02);
});
test('cutter layout: a found camera sets the camera band’s height from its shape',()=>{
 const l=defaultLayout('shorts',1920,1080),n=withCamera(l,[0,.1,.25,.25],'shorts',1920,1080);
 near(n.camOut[3],(1080/(480/270))/1920,.01);near(n.camOut[3]+n.gameOut[3],1,.001);near(n.gameOut[1],n.camOut[3],.001);
 near(pixelAspect(n.cam,1920,1080),pixelAspect(n.camOut,1080,1920),.02);
});
test('cutter boxes: moves snap to edges and centre, resizes keep the shape and stay inside',()=>{
 assert.deepEqual(moveBox([.2,.2,.3,.3],.495,0),[.7,.2,.3,.3],'the right edge snaps to the frame edge');
 const m=moveBox([.1,.1,.2,.2],-.5,-.5);assert.deepEqual(m.slice(0,2),[0,0]);
 const c=moveBox([.1,.1,.2,.2],.295,0);assert.equal(c[0]+c[2]/2,.5,'centre snaps to the middle');
 const r=resizeBox([.1,.1,.2,.2],'se',.2,.05,{ratio:2});near(r[2]/r[3],2,.001);assert.deepEqual(r.slice(0,2),[.1,.1]);
 const big=resizeBox([.5,.5,.2,.2],'se',2,2,{ratio:1});inside(big);
 const nw=resizeBox([.5,.5,.2,.2],'nw',-.1,-.1);assert.deepEqual(nw,[.4,.4,.3,.3]);
 assert.equal(resizeBox([.5,.5,.2,.2],'se',-1,-1)[2],.05,'never smaller than the minimum');
 near(shareRatio(16/9,1920,1080),1,.0001);
 assert.deepEqual(coverSource(0,0,1920,1080,100,100),[420,0,1080,1080]);
});
test('video cutter: a camera + gameplay cut builds both panels and lays the text over the joined video',()=>{
 const layout=validateLayout(defaultLayout('shorts',1920,1080)),graph=cutGraph([{start:0,end:4},{start:10,end:12}],{width:1080,height:1920,framing:'split',layout,overlay:true});
 assert.match(graph,/color=c=black:s=1080x1920:r=30:d=4\.000\[f0bg\]/);
 assert.match(graph,/\[f0sg\]crop=w=iw\*[\d.]+:h=ih\*[\d.]+:x=iw\*[\d.]+:y=ih\*[\d.]+,scale=1080:1268:force_original_aspect_ratio=increase,crop=1080:1268/);
 assert.match(graph,/\[f0bg\]\[f0g\]overlay=0:652:eof_action=pass\[f0l\];\n\[f0l\]\[f0c\]overlay=0:0/,'gameplay first, camera in front');
 assert.match(graph,/concat=n=2:v=1:a=1\[vc\]\[a\];\n\[2:v\]format=rgba\[txt\];\n\[vc\]\[txt\]overlay=0:0/);
 const behind=cutGraph([{start:0,end:4}],{width:1080,height:1920,framing:'split',layout:{...layout,camOnTop:false}});assert.match(behind,/\[f0bg\]\[f0c\]overlay/);
 const hidden=cutGraph([{start:0,end:4}],{width:1080,height:1920,framing:'split',layout:{...layout,camHidden:true}});assert.doesNotMatch(hidden,/f0c/);
 assert.deepEqual(panelPixels([0,.34,1,.66],{width:1080,height:1920}),{x:0,y:652,w:1080,h:1268});
});
test('video cutter: the layout and the text layer are checked',()=>{
 assert.throws(()=>validateCut({segments:[{start:0,end:5}],format:'shorts',framing:'split'},60),/camera and gameplay/);
 assert.throws(()=>validateLayout({...defaultLayout('shorts'),cam:[.9,.9,.5,.5]}),/cam box/);
 assert.throws(()=>validateLayout({...defaultLayout('shorts'),camOut:[0,0,.02,.02]}),/5%/);
 const png=w=>{const b=Buffer.alloc(33);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(w,16);b.writeUInt32BE(1920,20);return 'data:image/png;base64,'+b.toString('base64');};
 assert.equal(decodeOverlay(png(1080),{width:1080,height:1920}).length,33);
 assert.throws(()=>decodeOverlay(png(1920),{width:1080,height:1920}),/1080×1920/);
 assert.throws(()=>decodeOverlay('data:image/jpeg;base64,AAAA',{width:1080,height:1920}),/PNG/);
 const cut=validateCut({segments:[{start:0,end:5}],format:'shorts',framing:'split',layout:defaultLayout('shorts'),overlay:png(1080),texts:[{id:'a',text:'Hi'}]},60);
 assert.equal(cut.framing,'split');assert.ok(cut.layout.camOnTop);assert.equal(cut.overlay.length,33);assert.deepEqual(cut.texts,[{id:'a',text:'Hi'}]);
});
test('video cutter: export quality sets the size (2K is 1440 × 2560 / 2560 × 1440) and fetches 1440p parts',async()=>{
 const {cutSize,renderCut}=await import('../server/cut.mjs'),{formatFor}=await import('../server/remote.mjs');
 assert.deepEqual(cutSize('shorts',1440),{width:1440,height:2560});assert.deepEqual(cutSize('video',1440),{width:2560,height:1440});assert.deepEqual(cutSize('video',720),{width:1280,height:720});assert.deepEqual(cutSize('shorts',1080),{width:1080,height:1920});
 assert.equal(validateCut({segments:[{start:0,end:5}],format:'video'},60).quality,1080);
 assert.throws(()=>validateCut({segments:[{start:0,end:5}],format:'video',quality:4320},60),/2K/);
 const png=(w,h)=>{const b=Buffer.alloc(33);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return 'data:image/png;base64,'+b.toString('base64');};
 assert.equal(validateCut({segments:[{start:0,end:5}],format:'shorts',quality:1440,overlay:png(1440,2560)},60).quality,1440);
 assert.throws(()=>validateCut({segments:[{start:0,end:5}],format:'shorts',quality:1440,overlay:png(1080,1920)},60),/1440×2560/);
 assert.match(formatFor('youtube','section',360,{section:1440}),/height<=1440/);assert.match(formatFor('twitch','section',360,{section:1440}),/height<=1440/);assert.match(formatFor('youtube','section'),/height<=1080/);
 // A 2K cut of a long stream asks for 1440p parts and encodes at 2560 × 1440.
 const asked=[],args=[];const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');const folder=fs.mkdtempSync(path.join(process.env.TMP||os.tmpdir(),'cut-'));
 const out=await renderCut({remote:{proxy:true},sourcePath:'light.mp4',metadata:{width:640,height:360}},folder,{id:'t',segments:[{start:10,end:15}],format:'video',quality:1440,framing:'fit'},{section:async(j,f,a,b,o)=>{asked.push(o.height);return {file:'hd.mp4',start:5,width:2560,height:1440};},runCommand:async(cmd,a)=>{args.push(...a);fs.writeFileSync(a.at(-1),'x');},probeFile:async()=>({width:2560,height:1440,duration:5})});
 fs.rmSync(folder,{recursive:true,force:true});
 assert.deepEqual(asked,[1440]);assert.equal(out.sourceSide,1440);assert.deepEqual([out.width,out.height],[2560,1440]);assert.ok(args.join(' ').includes('-crf 18'));
});

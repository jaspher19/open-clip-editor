import test from 'node:test';import assert from 'node:assert/strict';
import {videoFilters} from '../server/render.mjs';import {validateOptions} from '../server/options.mjs';import {letterboxBand,letterboxFilters,cropFraction} from '../server/framing.mjs';import {manualEffectsAss,gradeFilter,monoWindows} from '../server/effects.mjs';
const chain=(o,extra={})=>videoFilters(validateOptions(o),{name:'c1',...extra}).filters;
test('defaults keep the existing centre-crop graph byte for byte',()=>{
 assert.deepEqual(chain({}),["[cutv]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:x='max(0,min(iw-ow,iw*(0.5)-ow/2))':y='(ih-oh)/2',setsar=1[framed]",'[framed]ass=filename=clips/c1.ass:fontsdir=../../assets/fonts,format=yuv420p[v]']);
 const wide=chain({outputFormat:'video'});assert.equal(wide.length,5);assert.equal(wide.at(-1),'[framed]ass=filename=clips/c1.ass:fontsdir=../../assets/fonts,format=yuv420p[v]');
 const pulse=chain({vfx:'reaction'},{beats:[1,4]}).at(-1);assert.equal(pulse,"[framed]eq=contrast=1.12:saturation=1.2:enable='between(t,1.000,1.220)+between(t,4.000,4.220)',ass=filename=clips/c1.ass:fontsdir=../../assets/fonts,format=yuv420p[v]");
});
test('letterbox: full-width band of the chosen aspect, pure black bars added after motion',()=>{
 assert.deepEqual(letterboxBand('3:4'),{width:1080,height:1440,y:240});assert.deepEqual(letterboxBand('4:5'),{width:1080,height:1350,y:285});
 for(const [aspect,h,y] of [['3:4',1440,240],['4:5',1350,285]]){const f=chain({framing:'letterbox',letterboxAspect:aspect,punchIn:true},{beats:[2],placed:[{type:'shake',out:3,dur:.4}],center:'0.40000'});
  assert.equal(f[0],`[cutv]scale=1080:${h}:force_original_aspect_ratio=increase,crop=1080:${h}:x='max(0,min(iw-ow,iw*(0.40000)-ow/2))':y='(ih-oh)/2',setsar=1[framed]`);
  const last=f.at(-1);assert.ok(last.includes(`:s=1080x${h}:`),'punch-in zooms the band, not the bars');assert.ok(last.includes(`crop=1080:${h}:`),'shake jitters the band');
  assert.ok(last.includes(`format=yuv444p,pad=1080:1920:0:${y}:black,ass=`),'bars are padded after motion and before captions');assert.ok(y+h+y===1920);}
 assert.ok(Math.abs(cropFraction(1920,1080,{outHeight:1440})-.421875)<1e-9,'face track crop width matches the 3:4 band');
 assert.match(letterboxFilters().pad,/pad=1080:1920:0:240:black/);
 const wide=chain({framing:'letterbox',outputFormat:'video'});assert.ok(wide[0].startsWith('[cutv]split=2')&&!wide.at(-1).includes('pad='),'16:9 video falls back to the blurred full-frame fit');
});
test('flashColor tints flashes; auto keeps the white flash unchanged',()=>{
 const white=manualEffectsAss([{type:'flash',out:1,dur:.25}]);assert.equal(white,manualEffectsAss([{type:'flash',out:1,dur:.25}],{flashColor:'auto'}));assert.match(white,/\\c&HFFFFFF&\\1a&H08&\\t\(0,250,\\1a&HFF&\)/);
 const red=manualEffectsAss([{type:'flash',out:1,dur:.28}],{flashColor:'#ff2020'});assert.match(red,/\\c&H2020FF&\\1a&H8C&\\t\(0,280,\\1a&HFF&\)/);assert.ok(!red.includes('FFFFFF'));
 assert.match(manualEffectsAss([{type:'flash',out:0,dur:.3}],{flashColor:'#12ab9c'}),/\\c&H9CAB12&/);
});
test('grade filters per mode',()=>{
 assert.equal(gradeFilter('none',[1]),'');assert.equal(gradeFilter('mono-peaks',[]),'');
 assert.match(gradeFilter('vivid'),/^eq=saturation=1\.25:contrast=1\.08,unsharp=/);
 assert.equal(gradeFilter('mono-peaks',[.1,5]),"hue=s=0:enable='between(t,0.000,1.500)+between(t,4.800,6.400)',");
 for(const [a,b] of monoWindows([3,9]))assert.ok(b-a>=1.2&&b-a<=2);
 assert.match(chain({grade:'vivid'}).at(-1),/^\[framed\]eq=saturation=1\.25:contrast=1\.08,unsharp=[^,]+,ass=/);
 assert.match(chain({grade:'mono-peaks'},{beats:[2]}).at(-1),/hue=s=0:enable='between\(t,1\.800,3\.400\)',ass=/);
 assert.ok(!chain({grade:'mono-peaks',autoEffects:false},{beats:[2]}).at(-1).includes('hue='),'peaks follow autoEffects');
 assert.match(chain({framing:'letterbox',grade:'vivid'}).at(-1),/unsharp=[^,]+,format=yuv444p,pad=/,'grade runs before the bars so they stay black');
});

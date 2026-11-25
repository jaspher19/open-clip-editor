import test from 'node:test';import assert from 'node:assert/strict';
import {effectsInside} from '../web/src/logic.mjs';import {validateClipEdits} from '../server/clip-edits.mjs';

// Found by driving real saves: adding an effect, then trimming the clip (or removing the extra part it sat in),
// made Save fail with "Each effect must sit inside the clip". The editor now drops effects on footage that's gone.
test('trimming the clip or removing a part takes its effects with it, and the save is accepted',()=>{
 const fx=[{id:'a',type:'zoom',at:105},{id:'b',type:'pop',at:148},{id:'c',type:'flash',at:305}];
 const trimmed=effectsInside(fx,100,140,[{start:300,end:310}]);
 assert.deepEqual(trimmed.map(e=>e.id),['a','c'],'the effect past the new end goes; the one in the part stays');
 assert.doesNotThrow(()=>validateClipEdits({effects:trimmed},{start:100,end:140,parts:[{start:300,end:310}]}));
 const noPart=effectsInside(fx,100,150,[]);assert.deepEqual(noPart.map(e=>e.id),['a','b']);
 assert.doesNotThrow(()=>validateClipEdits({effects:noPart,parts:[]},{start:100,end:150}));
 assert.throws(()=>validateClipEdits({effects:fx,parts:[]},{start:100,end:150}),/inside the clip/,'the server still refuses stray effects sent by other tools');
 assert.deepEqual(effectsInside(undefined,0,10),[]);assert.deepEqual(effectsInside([{id:'x',at:NaN}],0,10),[]);
});

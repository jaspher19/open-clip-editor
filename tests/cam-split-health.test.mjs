import test from 'node:test';import assert from 'node:assert/strict';
import {faceToolsProblem} from '../server/stack.mjs';import {sectionCovers} from '../server/remote.mjs';

test('a face tools crash is explained with its fix instead of "No facecam found"',()=>{
 assert.match(faceToolsProblem('RuntimeError: Face model missing; run npm run setup:faces'),/not installed: run npm run setup:faces/);
 assert.match(faceToolsProblem("ModuleNotFoundError: No module named 'mediapipe'"),/not installed/);
 assert.match(faceToolsProblem('ImportError: DLL load failed while importing _framework_bindings'),/Visual C\+\+ Redistributable/);
 assert.match(faceToolsProblem('ImportError: numpy.core.multiarray failed to import (cv2)'),/run npm run setup:faces again/);
 assert.equal(faceToolsProblem('The downloaded section (0.1–85.1 s) does not cover 0.0–76.8 s'),null);
 assert.equal(faceToolsProblem(''),null);
});

test('a full-quality section that starts a few frames into the stream covers a clip that starts at 0',()=>{
 assert.equal(sectionCovers({start:.1,end:85.1},0,76.8),true,'the case seen on a real stream');
 assert.equal(sectionCovers({start:0,end:85},0,76.8),true);
 assert.equal(sectionCovers({start:.8,end:85},0,76.8),false,'more than half a second missing is still refused');
 assert.equal(sectionCovers({start:30.1,end:90},30,80),false,'only at the very start of the stream');
 assert.equal(sectionCovers({start:.1,end:70},0,76.8),false,'the end must still be covered');
});

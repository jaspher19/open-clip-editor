import test from 'node:test';import assert from 'node:assert/strict';
import {crashHint,run,VC_RUNTIME_URL} from '../server/process.mjs';

test('windows crashes: the user’s 3221225477 explains the Visual C++ Runtime fix instead of raw progress lines',()=>{
 assert.match(crashHint(3221225477),/outdated Microsoft Visual C\+\+ Runtime/);assert.ok(crashHint(3221225477).includes(VC_RUNTIME_URL));
 assert.match(crashHint(0xC0000409),/Visual C\+\+ Runtime/);assert.match(crashHint(0xC0000135),/missing/);assert.match(crashHint(0xC000001D),/AVX/);
 assert.equal(crashHint(1),null);assert.equal(crashHint(2),null);
});
test('windows crashes: a crashing helper’s error says what to do',{skip:process.platform!=='win32'},async()=>{
 const e=await run('powershell',['-NoProfile','-Command','Write-Output \'{"stage":"transcribe"}\'; exit -1073741819'],{timeout:30000}).catch(x=>x);
 assert.match(e.message,/^The local speech or video helper crashed\. .*press Retry \(powershell crashed: Windows error 0xC0000005\)$/);
 const other=await run('powershell',['-NoProfile','-Command','exit 3'],{timeout:30000}).catch(x=>x);assert.match(other.message,/failed \(3\)/);
});

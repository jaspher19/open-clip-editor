import fs from 'node:fs';
// Windows Defender/Search briefly lock freshly written files; replacing one then fails with EPERM/EACCES/EBUSY.
const TRANSIENT=new Set(['EPERM','EACCES','EBUSY']),pause=new Int32Array(new SharedArrayBuffer(4));
export function replaceFile(from,to,{attempts=12}={}){for(let i=1;;i++){try{return fs.renameSync(from,to);}catch(e){if(!TRANSIENT.has(e.code)||i>=attempts)throw e;Atomics.wait(pause,0,0,Math.min(250,15*i));}}}
export function writeJsonAtomic(file,value,options){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2),options);replaceFile(file+'.tmp',file);}

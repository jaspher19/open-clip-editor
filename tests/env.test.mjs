import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {loadEnv,decodeEnv,envProblems} from '../server/env.mjs';

const folder=()=>fs.mkdtempSync(path.join(process.env.TMP||os.tmpdir(),'env-'));
test('settings: a .env saved as UTF-16 by PowerShell still loads (dotenv alone reads nothing)',()=>{
 const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('GEMINI_API_KEY=abc123\r\n','utf16le')]);
 assert.deepEqual(decodeEnv(utf16),{text:'GEMINI_API_KEY=abc123\r\n',encoding:'utf-16'});
 assert.equal(decodeEnv(Buffer.from('GROQ_API_KEY=x','utf16le')).encoding,'utf-16','no byte-order mark');
 const dir=folder(),env={};fs.writeFileSync(path.join(dir,'.env'),utf16);const s=loadEnv({root:dir,env});fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(env.GEMINI_API_KEY,'abc123');assert.equal(s.keys.GEMINI_API_KEY,true);assert.match(s.problems[0],/UTF-16/);
});
test('settings: .env.txt (Notepad with hidden extensions) is used, and the app says to rename it',()=>{
 const dir=folder(),env={};fs.writeFileSync(path.join(dir,'.env.txt'),'GROQ_API_KEY=k1\n');const s=loadEnv({root:dir,env});fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(env.GROQ_API_KEY,'k1');assert.equal(s.file,'.env.txt');assert.match(s.problems.join(' '),/rename it to "\.env"/);
});
test('settings: a changed .env applies without a restart; real environment variables win',()=>{
 const dir=folder(),file=path.join(dir,'.env'),env={OPENAI_API_KEY:'from-system'};
 fs.writeFileSync(file,'GEMINI_API_KEY=\nOPENAI_API_KEY=from-file\n');let s=loadEnv({root:dir,env});assert.equal(s.keys.GEMINI_API_KEY,false);assert.equal(env.OPENAI_API_KEY,'from-system');
 fs.writeFileSync(file,'GEMINI_API_KEY=new-key\n# a comment line\n');const t=new Date(Date.now()+2000);fs.utimesSync(file,t,t);s=loadEnv({root:dir,env});
 assert.equal(env.GEMINI_API_KEY,'new-key');assert.equal(s.keys.GEMINI_API_KEY,true);
 fs.writeFileSync(file,'# GEMINI_API_KEY=new-key\n');const t2=new Date(Date.now()+4000);fs.utimesSync(file,t2,t2);s=loadEnv({root:dir,env});fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(env.GEMINI_API_KEY,undefined,'removed from the file, removed here');assert.match(s.problems.join(' '),/GEMINI_API_KEY is commented out/);
});
test('settings: no .env yet says to copy the example',()=>{
 const dir=folder();fs.writeFileSync(path.join(dir,'.env.example'),'GEMINI_API_KEY=\n');const s=loadEnv({root:dir,env:{}});fs.rmSync(dir,{recursive:true,force:true});
 assert.equal(s.file,null);assert.match(s.problems[0],/copy \.env\.example to \.env/);
 assert.deepEqual(envProblems('export GEMINI_API_KEY=x',{file:'/a/.env',encoding:'utf-8'}),['Remove "export " from the start of lines in .env.']);
});

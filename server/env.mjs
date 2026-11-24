// Settings from .env, read from the OpenClip folder (not wherever the app was started), forgiving the usual Windows
// mistakes: a file saved as UTF-16 (PowerShell's `echo ... > .env`), or saved as ".env.txt" by Notepad with file
// extensions hidden. It is read again when it changes, so a new API key works without restarting. Real environment
// variables win over the file. `envStatus()` says what was found (never the values) for the app and the start log.
import fs from 'node:fs';import path from 'node:path';import dotenv from 'dotenv';
import {ROOT} from './config.mjs';

export const AI_KEYS=[['GEMINI_API_KEY','Gemini'],['GROQ_API_KEY','Groq'],['OLLAMA','Ollama'],['ANTHROPIC_API_KEY','Claude'],['OPENAI_API_KEY','OpenAI']];
// Ollama needs no key on this computer: it counts as set up with a model, a host or a cloud key.
const aiReady=(key,env)=>key==='OLLAMA'?!!String(env.OLLAMA_API_KEY||env.OLLAMA_MODEL||env.OLLAMA_HOST||'').trim():!!String(env[key]||'').trim();
const fromFile=new Set();let seen='',status={file:null,encoding:null,problems:[],keys:{}};

/** Text of a .env file in any of the encodings Windows editors save. */
export function decodeEnv(bytes){
 if(bytes[0]===0xff&&bytes[1]===0xfe)return {text:bytes.subarray(2).toString('utf16le'),encoding:'utf-16'};
 if(bytes[0]===0xfe&&bytes[1]===0xff){const b=Buffer.from(bytes.subarray(2));b.swap16();return {text:b.toString('utf16le'),encoding:'utf-16'};}
 // UTF-16 without a byte-order mark: every other byte is zero.
 if(bytes.length>3&&bytes[1]===0&&bytes[3]===0)return {text:bytes.toString('utf16le'),encoding:'utf-16'};
 const text=bytes.toString('utf8');return {text:text.replace(/^﻿/,''),encoding:'utf-8'};
}

/** Problems people hit with .env, as plain sentences (no values). */
export function envProblems(text,{file,encoding}){
 const out=[];if(!file)return out;
 if(path.basename(file)!=='.env')out.push(`The settings file is named "${path.basename(file)}". It works, but rename it to ".env".`);
 if(encoding==='utf-16')out.push('The .env file was saved as UTF-16 (PowerShell does this). OpenClip reads it anyway; saving it as UTF-8 avoids trouble with other tools.');
 for(const [key] of AI_KEYS.filter(([k])=>k!=='OLLAMA').concat([['OLLAMA_API_KEY'],['OLLAMA_MODEL']])){const m=text.match(new RegExp(`^\\s*#\\s*${key}\\s*=\\s*\\S`,'m'));if(m&&!new RegExp(`^\\s*${key}\\s*=\\s*\\S`,'m').test(text))out.push(`${key} is commented out: remove the # at the start of its line.`);}
 if(/^\s*export\s+\w+=/m.test(text))out.push('Remove "export " from the start of lines in .env.');
 return out;
}

/** Read .env (again, if it changed since last time) into process.env. Cheap: one stat per call. */
export function loadEnv({root=ROOT,env=process.env}={}){
 const candidates=['.env','.env.txt','env','.env.env'].map(n=>path.join(root,n)),file=candidates.find(f=>{try{return fs.statSync(f).isFile();}catch{return false;}})||null;
 let stamp='';try{if(file){const s=fs.statSync(file);stamp=`${file}:${s.mtimeMs}:${s.size}`;}}catch{}
 if(stamp===seen&&env===process.env)return status;seen=stamp;
 if(!file){status={file:null,encoding:null,problems:fs.existsSync(path.join(root,'.env.example'))?['No .env file yet: copy .env.example to .env and add a key (see the README).']:[],keys:keyStatus(env)};return status;}
 const {text,encoding}=decodeEnv(fs.readFileSync(file)),values=dotenv.parse(text);
 // Values that came from the file follow the file (a key removed from it is removed here); real environment variables stay.
 for(const key of fromFile)if(!(key in values)){delete env[key];fromFile.delete(key);}
 for(const [key,value] of Object.entries(values))if(env[key]===undefined||env[key]===''||fromFile.has(key)){env[key]=value;fromFile.add(key);}
 status={file:path.basename(file),encoding,problems:envProblems(text,{file,encoding}),keys:keyStatus(env)};return status;
}
const keyStatus=env=>Object.fromEntries(AI_KEYS.map(([key])=>[key,aiReady(key,env)]));
export const envStatus=()=>loadEnv();

loadEnv();

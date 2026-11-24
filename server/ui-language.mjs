// The app's display language. The browser translates the interface on this computer (Chrome/Edge built-in
// translator) or, without one, the user's own AI key does. Both the choice and every translated line are kept in
// work/ui-language/, so a restart (or another browser on this PC) comes back in the same language without
// translating again. English is the original: choosing it just turns translation off.
import fs from 'node:fs';import path from 'node:path';import {z} from 'zod';
import {WORK} from './config.mjs';import {askAI,metadataProviders} from './metadata-ai.mjs';

export const UI_LANGUAGE_DIR=path.join(WORK,'ui-language');
const CODE=/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
const MAX_ENTRIES=20000,MAX_TEXT=600;
export const validLanguage=code=>typeof code==='string'&&CODE.test(code);
const dir=(root=UI_LANGUAGE_DIR)=>{fs.mkdirSync(root,{recursive:true});return root;};
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJson(file,value){const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}

/** The saved language ('en' when never chosen). */
export function getLanguage(root=UI_LANGUAGE_DIR){const v=readJson(path.join(root,'settings.json'),{}).language;return validLanguage(v)?v:'en';}
export function setLanguage(language,root=UI_LANGUAGE_DIR){
 if(!validLanguage(language))throw new Error('Unknown language');
 writeJson(path.join(dir(root),'settings.json'),{language,updatedAt:new Date().toISOString()});return language;
}
/** Every line already translated into `language`, as {english: translated}. */
export function readStrings(language,root=UI_LANGUAGE_DIR){
 if(!validLanguage(language)||language==='en')return {};
 const v=readJson(path.join(root,`${language}.json`),{});return v&&typeof v==='object'&&!Array.isArray(v)?v:{};
}
const cleanPair=([en,tr])=>typeof en==='string'&&typeof tr==='string'&&en.trim()&&tr.trim()&&en.length<=MAX_TEXT&&tr.length<=MAX_TEXT*3;
/** Adds translated lines to the saved ones (the oldest go first past MAX_ENTRIES). */
export function saveStrings(language,entries,root=UI_LANGUAGE_DIR){
 if(!validLanguage(language)||language==='en')throw new Error('Unknown language');
 if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new Error('Invalid translations');
 const fresh=Object.entries(entries).filter(cleanPair);if(!fresh.length)return 0;
 const all={...readStrings(language,root)};for(const [en,tr] of fresh){delete all[en];all[en]=tr;}
 const keys=Object.keys(all);for(const k of keys.slice(0,Math.max(0,keys.length-MAX_ENTRIES)))delete all[k];
 writeJson(path.join(dir(root),`${language}.json`),all);return fresh.length;
}

export const aiTranslateReady=(env=process.env)=>metadataProviders(env).length>0;
const Reply=z.object({translations:z.array(z.string())});
/**
 * Fallback for browsers without a built-in translator: the user's own AI key translates interface lines.
 * {0}, {1}… are numbers the app fills in later and must survive unchanged.
 */
export async function aiTranslate(language,texts,{ask=askAI,chunk=60}={}){
 if(!validLanguage(language)||language==='en')throw new Error('Unknown language');
 const list=[...new Set((Array.isArray(texts)?texts:[]).filter(t=>typeof t==='string'&&t.trim()&&t.length<=MAX_TEXT))].slice(0,400);
 const out={};
 for(let i=0;i<list.length;i+=chunk){
  const part=list.slice(i,i+chunk);
  const {data}=await ask({schema:Reply,maxTokens:8000,timeout:60000,
   system:`You translate the interface of OpenClip, a desktop app that cuts livestreams into short clips, from English into the language with the code "${language}". Return exactly one translation per input line, in the same order. Keep them short like button and menu labels. Keep {0}, {1} and similar placeholders, numbers, emoji, file names, commands (npm, git), and the names OpenClip, YouTube, TikTok, Twitch, Kick, Whop, Gemini, Groq, Ollama, Claude, FFmpeg unchanged.`,
   user:JSON.stringify({language,lines:part})});
  if(data.translations.length!==part.length)throw new Error('The AI returned the wrong number of lines. Try again.');
  part.forEach((en,k)=>{const tr=String(data.translations[k]||'').trim();if(tr)out[en]=tr;});
 }
 return out;
}

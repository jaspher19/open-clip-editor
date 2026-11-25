/**
 * Translates OpenClip's interface on the page, for every screen, without touching the React code: it rewrites the
 * text of the page's text nodes (and their title / placeholder / aria-label) and keeps the English original, so going
 * back to English is exact. React only ever replaces text it changed itself, and the observer translates that again.
 *
 * Translation runs on this computer with the browser's built-in translator (Chrome / Edge, `Translator`); without one
 * it uses the user's own AI key through the server. Every translated line is saved twice, in this browser and in the
 * OpenClip folder (work/ui-language/), and so is the chosen language: after a restart the app opens straight in it.
 *
 * Never translated: anything the user made or the video says (titles, captions, transcripts, project names, post
 * text), everything inside [translate="no"] / .notranslate, form fields, code and commands.
 */

export type Availability='ready'|'download'|'downloading'|'ai'|'none';
export type TranslateState={language:string;busy:number;engine:'browser'|'ai'|'saved'|null;download:number|null;error:string;needsClick:boolean};

type TranslatorLike={translate(text:string):Promise<string>;destroy?():void};
type TranslatorApi={availability(o:{sourceLanguage:string;targetLanguage:string}):Promise<string>;create(o:{sourceLanguage:string;targetLanguage:string;monitor?:(m:EventTarget)=>void}):Promise<TranslatorLike>};
const api=():TranslatorApi|null=>(globalThis as unknown as {Translator?:TranslatorApi}).Translator??null;

/** Languages offered (any the browser's translator or an AI can do). Native names come from Intl. */
export const LANGUAGES=['es','pt','fr','de','it','nl','pl','tr','ru','uk','ar','he','hi','bn','mr','ta','te','kn','id','ms','fil','vi','th','ja','ko','zh','zh-Hant','sv','da','no','fi','cs','sk','ro','hu','el','bg','hr','sl','lt'];
export function languageName(code:string,inLanguage=code):string{try{const n=new Intl.DisplayNames([inLanguage],{type:'language'}).of(code);return n?n.charAt(0).toLocaleUpperCase(inLanguage)+n.slice(1):code;}catch{return code;}}

// User content and things that must stay as they are.
const SKIP='[translate="no"],.notranslate,[contenteditable=""],[contenteditable="true"],script,style,textarea,code,pre,kbd,svg,noscript,'+
 '.brand,.brand-by,.tip-qr,.history-item strong,.creator-avatar,.creator-menu b,.project-heading h1,.clip-headline,.moment-title,.candidate-title,.metadata-description,.post-caption,.post-card strong,.transcript-words,.live-caption,.live-pop,.live-series,.hook-title,.update-steps,.update-list strong';
const ATTRS=['title','placeholder','aria-label'] as const;
const LETTER=/\p{L}/u,NUM=/\d+(?:[.,:]\d+)*/g,SLOT=/\{(\d+)\}/g;
const LS_LANG='openclip-language',lsStrings=(l:string)=>`openclip-ui-${l}`;

/** "Transcribed 120 / 300s" → key "Transcribed {0} / {1}s" + the numbers, so counters are translated once. */
function parse(text:string){const m=text.match(/^(\s*)([\s\S]*?)(\s*)$/)!,core=m[2];if(!core||core.length>600||!LETTER.test(core)||/^(https?:\/\/|www\.)\S+$/i.test(core))return null;
 const nums:string[]=[];const key=core.replace(NUM,n=>`{${nums.push(n)-1}}`);return {lead:m[1],trail:m[3],key,nums};}
const fill=(tr:string,nums:string[])=>tr.replace(SLOT,(s,i)=>nums[+i]??s);
/** A translation is usable when it kept every {n} slot. */
export const keepsSlots=(key:string,tr:string)=>{const want=(key.match(SLOT)||[]).sort().join(),got=(tr.match(SLOT)||[]).sort().join();return want===got;};

type Rec={en:string;shown:string};
const skipped=(el:Element|null)=>!el||!!el.closest(SKIP);

class Engine{
 language='en';private cache=new Map<string,string>();private texts=new Map<Text,Rec>();private attrs=new Map<Element,Map<string,Rec>>();
 private waiting=new Set<string>();private failed=new Set<string>();private observer:MutationObserver|null=null;private timer=0;private running=false;
 private translator:TranslatorLike|null=null;private engine:TranslateState['engine']=null;private unsaved:Record<string,string>={};private saveTimer=0;private generation=0;
 private state:TranslateState={language:'en',busy:0,engine:null,download:null,error:'',needsClick:false};private listeners=new Set<(s:TranslateState)=>void>();
 subscribe(fn:(s:TranslateState)=>void){this.listeners.add(fn);fn(this.state);return ()=>{this.listeners.delete(fn);};}
 private emit(patch:Partial<TranslateState>){this.state={...this.state,...patch};for(const fn of this.listeners)fn(this.state);}

 /** Switch language. `fromClick` lets the browser download its language pack (it needs a click for that). */
 async use(language:string,{fromClick=false,save=true}:{fromClick?:boolean;save?:boolean}={}){
  const gen=++this.generation;
  if(save)savePreference(language);
  this.translator?.destroy?.();this.translator=null;this.engine=null;this.waiting.clear();this.failed.clear();
  if(language==='en'){this.revert();this.language='en';document.documentElement.lang='en';this.emit({language,busy:0,engine:null,download:null,error:'',needsClick:false});return;}
  this.revert();this.language=language;document.documentElement.lang=language;this.cache=new Map(Object.entries(await loadStrings(language)));
  if(gen!==this.generation)return;
  this.emit({language,busy:0,engine:'saved',download:null,error:'',needsClick:false});
  this.watch();this.scan(document.body);   // saved lines show at once, before any translator is ready
  try{
   const t=api();const avail=t?await t.availability({sourceLanguage:'en',targetLanguage:language}).catch(()=>'unavailable'):'unavailable';
   if(gen!==this.generation)return;
   if(t&&avail!=='unavailable'){
    if(avail!=='available'&&!fromClick&&!navigator.userActivation?.isActive){this.emit({needsClick:true});if(await aiReady())this.engine='ai';}
    else{this.emit({download:avail==='available'?null:0});
     this.translator=await t.create({sourceLanguage:'en',targetLanguage:language,monitor:m=>m.addEventListener('downloadprogress',e=>this.emit({download:(e as ProgressEvent).loaded}))});
     if(gen!==this.generation){this.translator.destroy?.();return;}
     this.engine='browser';this.emit({download:null,needsClick:false});}
   }else if(await aiReady())this.engine='ai';
   else if(!this.cache.size)throw new Error(t?`This browser can’t translate into ${languageName(language,'en')}. Add an AI key to .env, or pick another language.`:'Open OpenClip in Chrome or Edge to translate it on this computer, or add an AI key to .env.');
  }catch(e){if(gen===this.generation)this.emit({error:(e as Error).message||'Translation could not start',download:null});}
  if(gen!==this.generation)return;
  this.emit({engine:this.engine??'saved'});this.scan(document.body);this.schedule();
 }

 private watch(){if(this.observer)return;this.observer=new MutationObserver(list=>{if(this.language==='en')return;for(const m of list){
   if(m.type==='characterData')this.text(m.target as Text);
   else if(m.type==='attributes')this.attr(m.target as Element,m.attributeName!);
   else for(const n of m.addedNodes)this.scan(n);}
  this.schedule();});
  this.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:[...ATTRS]});}

 private scan(root:Node){
  if(root.nodeType===Node.TEXT_NODE){this.text(root as Text);return;}
  if(root.nodeType!==Node.ELEMENT_NODE)return;const el=root as Element;if(skipped(el))return;
  for(const a of ATTRS)if(el.hasAttribute(a))this.attr(el,a);
  const walk=document.createTreeWalker(el,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:n=>n.nodeType===Node.ELEMENT_NODE&&(n as Element).matches(SKIP)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let n=walk.nextNode();n;n=walk.nextNode()){if(n.nodeType===Node.TEXT_NODE)this.text(n as Text);else for(const a of ATTRS)if((n as Element).hasAttribute(a))this.attr(n as Element,a);}
 }
 /** Shows the translation of `rec.en` if known; queues it otherwise. Returns the text to show. */
 private shown(rec:Rec):string{const p=parse(rec.en);if(!p)return rec.en;const tr=this.cache.get(p.key);
  if(tr!==undefined)return p.lead+fill(tr,p.nums)+p.trail;if(!this.failed.has(p.key))this.waiting.add(p.key);return rec.en;}
 private text(node:Text){
  const value=node.nodeValue??'';let rec=this.texts.get(node);
  if(rec&&value===rec.shown)return;            // our own write
  if(!node.parentElement||skipped(node.parentElement))return;
  rec={en:value,shown:value};this.texts.set(node,rec);
  const out=this.shown(rec);if(out!==value){rec.shown=out;node.nodeValue=out;}
 }
 private attr(el:Element,name:string){
  const value=el.getAttribute(name);if(value===null||skipped(el))return;let map=this.attrs.get(el);const rec0=map?.get(name);
  if(rec0&&value===rec0.shown)return;
  if(!map){map=new Map();this.attrs.set(el,map);}const rec={en:value,shown:value};map.set(name,rec);
  const out=this.shown(rec);if(out!==value){rec.shown=out;el.setAttribute(name,out);}
 }
 /** Every translated line back to its English original. */
 private revert(){
  for(const [node,rec] of this.texts)if(node.isConnected&&node.nodeValue===rec.shown&&rec.shown!==rec.en)node.nodeValue=rec.en;
  for(const [el,map] of this.attrs)for(const [name,rec] of map)if(el.isConnected&&el.getAttribute(name)===rec.shown&&rec.shown!==rec.en)el.setAttribute(name,rec.en);
  this.texts.clear();this.attrs.clear();
 }
 private refresh(){
  for(const [node,rec] of this.texts){if(!node.isConnected){this.texts.delete(node);continue;}if(node.nodeValue!==rec.shown)continue;const out=this.shown(rec);if(out!==rec.shown){rec.shown=out;node.nodeValue=out;}}
  for(const [el,map] of this.attrs){if(!el.isConnected){this.attrs.delete(el);continue;}for(const [name,rec] of map){if(el.getAttribute(name)!==rec.shown)continue;const out=this.shown(rec);if(out!==rec.shown){rec.shown=out;el.setAttribute(name,out);}}}
 }
 private schedule(){if(this.language==='en'||this.running||!this.waiting.size)return;clearTimeout(this.timer);this.timer=window.setTimeout(()=>void this.flush(),150);}
 private async flush(){
  if(this.running)return;const gen=this.generation;this.running=true;
  try{
   while(this.waiting.size&&gen===this.generation&&(this.translator||this.engine==='ai')){
    const batch=[...this.waiting].slice(0,this.translator?24:120);this.emit({busy:this.waiting.size});
    let got:Record<string,string>={};
    try{
     if(this.translator){const t=this.translator;const res=await Promise.all(batch.map(k=>t.translate(k).catch(()=>'')));batch.forEach((k,i)=>{if(res[i])got[k]=res[i];});}
     else got=await aiTranslate(this.language,batch);
    }catch(e){this.emit({error:(e as Error).message});batch.forEach(k=>this.failed.add(k));}
    if(gen!==this.generation)return;
    for(const k of batch){this.waiting.delete(k);const tr=got[k]?.trim();if(tr&&keepsSlots(k,tr)){this.cache.set(k,tr);if(this.translator)this.unsaved[k]=tr;}else this.failed.add(k);}
    keepLocal(this.language,this.cache);this.refresh();this.persist();
   }
  }finally{this.running=false;if(gen===this.generation){this.emit({busy:0});if(this.waiting.size&&(this.translator||this.engine==='ai'))this.schedule();}}
 }
 /** Browser translations also go to the OpenClip folder (the server saves AI ones itself). */
 private persist(){clearTimeout(this.saveTimer);const lang=this.language;this.saveTimer=window.setTimeout(()=>{const entries=this.unsaved;this.unsaved={};if(!Object.keys(entries).length||lang==='en')return;
  fetch(`/api/ui-language/${lang}/strings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({entries})}).catch(()=>{});},1500);}
}

export const translator=new Engine();

// ---- saving ----
export function savedLanguage():string{try{return localStorage.getItem(LS_LANG)||'';}catch{return '';}}
function savePreference(language:string){try{localStorage.setItem(LS_LANG,language);}catch{/* private window */}
 fetch('/api/ui-language',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({language})}).catch(()=>{});}
function keepLocal(language:string,cache:Map<string,string>){try{localStorage.setItem(lsStrings(language),JSON.stringify(Object.fromEntries([...cache].slice(-4000))));}catch{/* full or blocked: the server copy remains */}}
async function loadStrings(language:string):Promise<Record<string,string>>{
 let local:Record<string,string>={};try{local=JSON.parse(localStorage.getItem(lsStrings(language))||'{}');}catch{/* none */}
 try{const r=await fetch(`/api/ui-language/${language}/strings`);if(r.ok)return {...local,...await r.json()};}catch{/* server older than this feature */}
 return local;
}
let aiCache:boolean|null=null;
async function aiReady(){if(aiCache!==null)return aiCache;try{const r=await fetch('/api/ui-language');aiCache=r.ok&&!!(await r.json()).ai;}catch{aiCache=false;}return aiCache;}
async function aiTranslate(language:string,texts:string[]):Promise<Record<string,string>>{
 const r=await fetch(`/api/ui-language/${language}/translate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({texts})});
 const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Translation failed');return body;
}
/** The language to open in: this browser's choice, else the one saved in the OpenClip folder. */
export async function startupLanguage():Promise<string>{
 const local=savedLanguage();if(local)return local;
 try{const r=await fetch('/api/ui-language');if(r.ok){const {language}=await r.json();return typeof language==='string'?language:'en';}}catch{/* offline */}
 return 'en';
}
/** How each language can be translated here, for the menu. */
export async function availability(codes:string[]):Promise<Record<string,Availability>>{
 const t=api(),ai=await aiReady(),out:Record<string,Availability>={};
 await Promise.all(codes.map(async c=>{let a='unavailable';if(t)try{a=await t.availability({sourceLanguage:'en',targetLanguage:c});}catch{/* unknown code */}
  out[c]=a==='available'?'ready':a==='downloadable'?'download':a==='downloading'?'downloading':ai?'ai':'none';}));
 return out;
}

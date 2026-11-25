import {useState} from 'react';import {Languages,Loader2,RotateCcw} from 'lucide-react';
import type {Word,Range} from './types';import {captionPhrases,spreadTranslation} from './logic.mjs';import {LANGUAGES,languageName,savedLanguage} from './translate';

// Clip editor: translate the clip's captions into another language. Each spoken phrase is translated as a whole and
// its words are spread back over the phrase's original word timings, so the subtitles stay in sync with the speech.
// The result is ordinary caption edits: undo, Edit captions and Save all work on it. Translation runs in the browser
// (Chrome / Edge on-device translator) when it can, else with the user's own AI key through the server.
type BrowserTranslator={translate:(text:string)=>Promise<string>;destroy?:()=>void};
type TranslatorApi={availability:(o:{sourceLanguage:string;targetLanguage:string})=>Promise<string>;create:(o:{sourceLanguage:string;targetLanguage:string;monitor?:(m:EventTarget)=>void})=>Promise<BrowserTranslator>};
const browserApi=()=>(globalThis as unknown as {Translator?:TranslatorApi}).Translator;
const CHOICES=['en',...LANGUAGES];
const base=(code:string)=>code.split('-')[0].toLowerCase();

async function translateLines(jobId:string,from:string,to:string,lines:string[],onProgress:(text:string)=>void):Promise<string[]>{
 const api=browserApi();
 if(api&&from){const ready=await api.availability({sourceLanguage:from,targetLanguage:to}).catch(()=>'unavailable');
  if(ready!=='unavailable'){
   if(ready!=='available')onProgress('Downloading the language pack once (it stays on this computer)…');
   const t=await api.create({sourceLanguage:from,targetLanguage:to,monitor:m=>m.addEventListener('downloadprogress',e=>onProgress(`Downloading the language pack · ${Math.round(((e as ProgressEvent).loaded||0)*100)}%`))});
   try{const out:string[]=[];for(let i=0;i<lines.length;i++){onProgress(`Translating line ${i+1} of ${lines.length}…`);out.push(await t.translate(lines[i]));}return out;}finally{t.destroy?.();}
  }}
 onProgress('Translating with your AI key…');
 const r=await fetch(`/api/jobs/${jobId}/captions/translate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from,to,lines})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Translation failed');return d.lines;
}

export default function CaptionTranslate({jobId,words,edits,setEdits,ranges,spoken}:{jobId:string;words:Word[];edits:Record<string,string>;setEdits:(e:Record<string,string>)=>void;ranges:Range[];spoken:string}){
 const from=base(spoken||'en'),ui=savedLanguage();
 const [to,setTo]=useState(ui&&ui!=='en'&&base(ui)!==from?ui:from==='en'?'es':'en');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [done,setDone]=useState<{to:string;before:Record<string,string>;after:Record<string,string>}|null>(null);
 // Translating again starts from the words before the last translation, never from a translation.
 const current=done&&done.after===edits?done:null;
 async function run(){
  if(base(to)===from){setError(`The captions are already in ${languageName(to,'en')}.`);return;}
  const start=current?current.before:edits,text=(i:number)=>start[i]??words[i].text;
  const phrases=captionPhrases(words.map((w,i)=>({...w,text:text(i)})),ranges);
  if(!phrases.length){setError('This clip has no spoken words to translate.');return;}
  setBusy(true);setError('');setStatus('Starting…');
  try{const out=await translateLines(jobId,from,to,phrases.map(p=>p.map(text).join(' ')),setStatus);
   if(out.length!==phrases.length)throw new Error('The translation came back incomplete. Try again.');
   const next={...start};phrases.forEach((p,k)=>spreadTranslation(p.length,out[k],to).forEach((t,j)=>{next[p[j]]=t;}));
   setEdits(next);setDone({to,before:start,after:next});setStatus('');
  }catch(e){setError((e as Error).message||'Translation failed');setStatus('');}finally{setBusy(false);}
 }
 function back(){if(!current)return;setEdits(current.before);setDone(null);}
 return <div className="caption-translate">
  <div className="caption-translate-row"><Languages size={16} aria-hidden="true"/><label htmlFor="caption-language">Translate captions to</label>
   <select id="caption-language" translate="no" value={to} disabled={busy} onChange={e=>{setTo(e.target.value);setError('');}}>{CHOICES.filter(c=>base(c)!==from).map(c=><option key={c} value={c}>{languageName(c)} · {languageName(c,'en')}</option>)}</select>
   <button type="button" className="secondary small" disabled={busy} onClick={run}>{busy?<Loader2 className="spin" size={14}/>:<Languages size={14}/>}{busy?'Translating…':current?'Translate again':'Translate'}</button>
   {current&&!busy&&<button type="button" className="text-button" onClick={back}><RotateCcw size={14}/>Back to original words</button>}</div>
  {status&&<small role="status">{status}</small>}
  {current&&!busy&&<small role="status">Captions are in {languageName(current.to,'en')} and keep the speech timing. Check them in the preview, fix any word with Edit captions, then Save.</small>}
  {error&&<small role="alert" className="caption-translate-error">{error}</small>}
 </div>;
}

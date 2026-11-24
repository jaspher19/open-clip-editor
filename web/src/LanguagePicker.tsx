import {useEffect,useMemo,useRef,useState} from 'react';
import {Languages,Check,ChevronDown,Loader2,RotateCcw,Search,Download,Sparkles,CircleAlert} from 'lucide-react';
import {translator,LANGUAGES,languageName,availability,startupLanguage,type Availability,type TranslateState} from './translate';

const NOTE:Record<Availability,string>={ready:'Ready',download:'Downloads once',downloading:'Downloading',ai:'Uses your AI key',none:'Not in this browser'};

/** Top-bar language menu. English is the original; the choice is saved on this computer and comes back after a restart. */
export default function LanguagePicker(){
 const [state,setState]=useState<TranslateState>({language:'en',busy:0,engine:null,download:null,error:'',needsClick:false});
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[avail,setAvail]=useState<Record<string,Availability>|null>(null);
 const box=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
 useEffect(()=>translator.subscribe(setState),[]);
 useEffect(()=>{let live=true;startupLanguage().then(l=>{if(live&&l!=='en')void translator.use(l,{save:false});});return ()=>{live=false;};},[]);
 useEffect(()=>{if(!open)return;search.current?.focus();if(!avail)availability(LANGUAGES).then(setAvail);
  const away=(e:PointerEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);},esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',away);document.addEventListener('keydown',esc);
  return ()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',esc);};},[open,avail]);
 const list=useMemo(()=>{const q=query.trim().toLowerCase();return LANGUAGES.map(code=>({code,native:languageName(code),english:languageName(code,'en')}))
  .filter(l=>!q||l.native.toLowerCase().includes(q)||l.english.toLowerCase().includes(q)||l.code.startsWith(q))
  .sort((a,b)=>Number(avail?.[a.code]==='none')-Number(avail?.[b.code]==='none')||a.english.localeCompare(b.english));},[query,avail]);
 const pick=(code:string)=>{setOpen(false);setQuery('');void translator.use(code,{fromClick:true}).then(()=>setAvail(null));};
 const english=state.language==='en',busy=state.download!==null||state.busy>0;
 const label=english?'English':languageName(state.language);
 return <div className="lang-picker" ref={box} translate="no">
  <button type="button" className={`update-button lang-button ${english?'':'active'}`} aria-haspopup="listbox" aria-expanded={open} title="Language"
   onClick={()=>setOpen(!open)}>
   {busy?<Loader2 className="spin" size={14}/>:<Languages size={14}/>}<span>{label}</span>{state.needsClick&&<i className="lang-dot" aria-label="Needs a click to finish"/>}<ChevronDown size={13}/>
  </button>
  {open&&<div className="lang-menu" role="dialog" aria-label="Language">
   {state.needsClick&&<button type="button" className="lang-revert lang-finish" onClick={()=>pick(state.language)}><Download size={15}/>Finish setting up {label}</button>}
   {!english&&<button type="button" className="lang-revert" onClick={()=>pick('en')}><RotateCcw size={15}/>Back to English</button>}
   <label className="lang-search"><Search size={14}/><input ref={search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search languages" aria-label="Search languages"/></label>
   <ul role="listbox" aria-label="Languages">
    <li><button type="button" role="option" aria-selected={english} className={english?'on':''} onClick={()=>pick('en')}><span><strong>English</strong><small>Original</small></span>{english&&<Check size={15}/>}</button></li>
    {list.map(l=>{const a=avail?.[l.code],on=state.language===l.code;return <li key={l.code}><button type="button" role="option" aria-selected={on} className={on?'on':''} disabled={a==='none'&&!on} onClick={()=>pick(l.code)}>
     <span><strong lang={l.code}>{l.native}</strong><small>{l.english}{a?` · ${NOTE[a]}`:''}</small></span>
     {on?<Check size={15}/>:a==='download'?<Download size={14}/>:a==='ai'?<Sparkles size={14}/>:null}</button></li>;})}
    {!list.length&&<li className="lang-empty">No language called “{query}”.</li>}
   </ul>
   <p className="lang-note">{state.download!==null?<><Loader2 className="spin" size={13}/>Downloading the {label} pack… {Math.round((state.download||0)*100)}%</>:
    state.busy?<><Loader2 className="spin" size={13}/>Translating {state.busy} line{state.busy===1?'':'s'}…</>:
    state.error?<><CircleAlert size={13}/>{state.error}</>:
    'Translated on this computer and saved here, so it stays after a restart. Clip titles, captions and posts stay as written.'}</p>
  </div>}
 </div>;
}

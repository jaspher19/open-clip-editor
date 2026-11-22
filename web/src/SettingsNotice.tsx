import {useEffect,useState} from 'react';
import {KeyRound,RotateCcw} from 'lucide-react';

type Status={file:string|null;encoding:string|null;problems:string[];keys:Record<string,boolean>};
const NAMES:Record<string,string>={GEMINI_API_KEY:'Gemini',GROQ_API_KEY:'Groq',ANTHROPIC_API_KEY:'Claude',OPENAI_API_KEY:'OpenAI'};

/** Home page: which AI keys OpenClip found in .env, and what to fix when a key isn't being picked up. */
export default function SettingsNotice(){
 const [s,setS]=useState<Status|null>(null),[checking,setChecking]=useState(false);
 const check=()=>{setChecking(true);fetch('/api/settings-check').then(r=>r.ok?r.json():null).then(d=>{if(d)setS(d);}).catch(()=>{}).finally(()=>setChecking(false));};
 useEffect(check,[]);
 if(!s)return null;const found=Object.entries(s.keys).filter(([,on])=>on).map(([k])=>NAMES[k]||k);
 if(found.length&&!s.problems.length)return <p className="settings-ok"><KeyRound size={15}/>AI is on: {found.join(', ')} {found.length>1?'keys':'key'} found in {s.file}.</p>;
 return <section className="settings-notice" role="status"><KeyRound size={18}/><div>
  <strong>{found.length?`AI is on (${found.join(', ')}), but check your settings file`:'AI features are off: no API key found'}</strong>
  <ul>{s.problems.map(p=><li key={p}>{p}</li>)}{!found.length&&s.file&&<li>{s.file} has no key filled in. Put it right after the = sign, for example <code>GEMINI_API_KEY=AIza…</code>, with no # in front.</li>}</ul>
  <small>OpenClip reads .env from its own folder and picks up changes by itself. No rebuild or setup needed.</small>
 </div><button type="button" className="text-button" disabled={checking} onClick={check}><RotateCcw size={14}/>Check again</button></section>;
}

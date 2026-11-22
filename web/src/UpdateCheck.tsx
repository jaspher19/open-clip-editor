import {useRef,useState} from 'react';
import {RefreshCw,Loader2,Check,X,Copy,ArrowUpRight,CircleAlert} from 'lucide-react';

type Result={status:'current'|'behind'|'ahead'|'diverged'|'unknown';current?:string;latest?:string;behind?:number;ahead?:number;commits?:{hash:string;subject:string;when:string}[];dependencies?:boolean;python?:boolean;dirty?:boolean;message?:string;repo:string};

/** Top-bar "Check for updates": asks the server to compare this copy with GitHub, then shows what's new and how to update. */
export default function UpdateCheck(){
 const dialog=useRef<HTMLDialogElement>(null),[busy,setBusy]=useState(false),[result,setResult]=useState<Result|null>(null),[copied,setCopied]=useState(false);
 async function check(){setBusy(true);setCopied(false);setResult(null);dialog.current?.showModal();
  try{const r=await fetch('/api/update');if(!r.headers.get('content-type')?.includes('json'))throw new Error('Restart OpenClip (Ctrl+C, then npm start) to use the update check.');setResult(await r.json());}
  catch(e){setResult({status:'unknown',message:(e as Error).message,repo:'https://github.com/jaspher19/open-clip-editor'});}finally{setBusy(false);}}
 const steps=result?.status==='behind'||result?.status==='diverged'?['git pull',...(result.dependencies?['npm ci']:[]),...(result.python?['npm run setup']:[]),'npm run build']:[];
 const close=()=>dialog.current?.close();
 return <>
  <button type="button" className="update-button" onClick={check} disabled={busy} title="Compare this copy with the newest version on GitHub">{busy?<Loader2 className="spin" size={14}/>:<RefreshCw size={14}/>}Check for updates</button>
  <dialog ref={dialog} className="update-dialog" aria-labelledby="update-title" onClick={e=>{if(e.target===e.currentTarget)close();}}>
   <button type="button" className="tip-close" aria-label="Close" onClick={close}><X size={18}/></button>
   <h2 id="update-title"><RefreshCw size={20}/>Updates</h2>
   {!result?<p className="update-status"><Loader2 className="spin" size={16}/>Checking GitHub…</p>:
    result.status==='current'?<p className="update-status ok"><Check size={18}/>You’re on the newest version ({result.current}).</p>:
    result.status==='ahead'?<p className="update-status ok"><Check size={18}/>You’re up to date, with {result.ahead} change{result.ahead===1?'':'s'} of your own not on GitHub yet ({result.current}).</p>:
    result.status==='unknown'?<><p className="update-status warn"><CircleAlert size={18}/>{result.message}</p><a className="secondary" href={result.repo} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15}/>Open OpenClip on GitHub</a></>:
    <>
     <p className="update-status new"><RefreshCw size={18}/>{result.behind} update{result.behind===1?'':'s'} available ({result.current} → {result.latest}).</p>
     {!!result.commits?.length&&<ul className="update-list">{result.commits.map(c=><li key={c.hash}><strong>{c.subject}</strong><small>{c.when}</small></li>)}</ul>}
     <p className="update-help">Stop OpenClip (Ctrl+C in its terminal), run these in the OpenClip folder, then start it again with <code>npm start</code>:</p>
     <pre className="update-steps">{steps.join('\n')}</pre>
     <button type="button" className="secondary" onClick={()=>navigator.clipboard.writeText(steps.join('\n')).then(()=>setCopied(true)).catch(()=>{})}>{copied?<Check size={15}/>:<Copy size={15}/>}{copied?'Copied':'Copy commands'}</button>
     {result.dirty&&<p className="update-help warn">You changed some OpenClip files yourself. If <code>git pull</code> refuses, save your changes first (<code>git stash</code>), then run it again.</p>}
     {result.status==='diverged'&&<p className="update-help warn">Your copy also has {result.ahead} change{result.ahead===1?'':'s'} of your own, so git will merge them with the update.</p>}
    </>}
   <p className="tip-by"><a href={result?.repo||'https://github.com/jaspher19/open-clip-editor'} target="_blank" rel="noopener noreferrer">What’s new on GitHub</a></p>
  </dialog>
 </>;
}

import {useEffect,useRef,useState} from 'react';
import {Copy,ExternalLink,Loader2,Settings2,Upload,X} from 'lucide-react';

type Connection={configured:boolean;connected:boolean;displayName:string;accountId:string|null};
type Draft={caption:string;state:string;error?:string;checkable:boolean;resumable?:boolean;videoError?:string};
type CalendarPost={id:string;metadata:{title:string}};
const states:Record<string,string>={
 draft:'Ready to prepare',processing:'TikTok is processing the video',
 inbox:'Delivered to TikTok Inbox',published:'Posted on TikTok',failed:'TikTok upload failed',
};

async function request<T>(url:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);
 if(!data)throw new Error('Restart OpenClip to load the TikTok endpoints.');
 if(!response.ok)throw new Error(data.error||'TikTok request failed.');
 return data;
}
const status=()=>request<Connection>('/api/tiktok/status');
const message=(error:unknown)=>error instanceof Error?error.message:'TikTok request failed.';

export function TikTokConnection(){
 const dialog=useRef<HTMLDialogElement>(null),connectWindow=useRef<Window|null>(null);
 const [connection,setConnection]=useState<Connection|null>(null);
 const [clientKey,setClientKey]=useState(''),[clientSecret,setClientSecret]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[setupOpen,setSetupOpen]=useState(false);
 useEffect(()=>{
  status().then(setConnection).catch(e=>setError(message(e)));
  const timer=setInterval(()=>{
   if(connectWindow.current)status().then(next=>{
    setConnection(next);
    if(next.connected||connectWindow.current?.closed)connectWindow.current=null;
   }).catch(()=>{});
  },3000);
  return()=>clearInterval(timer);
 },[]);

 async function save(){
  setBusy('save');setError('');
  try{
   setConnection(await request<Connection>('/api/tiktok/configure','POST',{clientKey,clientSecret}));
   dialog.current?.close();
  }catch(e){setError(message(e));}
  finally{setBusy('');}
 }
 async function connect(){
  const popup=window.open('','openclip-tiktok','width=620,height=760');
  setBusy('connect');setError('');
  try{
   const data=await request<{url:string}>('/api/tiktok/connect','POST');
   if(popup){connectWindow.current=popup;popup.location.href=data.url;}
   else window.location.href=data.url;
  }catch(e){popup?.close();setError(message(e));}
  finally{setBusy('');}
 }
 async function disconnect(){
  setBusy('disconnect');setError('');
  try{setConnection(await request<Connection>('/api/tiktok/disconnect','POST'));}
  catch(e){setError(message(e));}
  finally{setBusy('');}
 }
 return <>
  <section className="youtube-connection">
   <div><h2>TikTok account</h2><p>{connection?.connected?`Connected to ${connection.displayName}`:'Send portrait calendar videos to TikTok Inbox for review.'}</p>
    {error&&!setupOpen&&<p role="alert" className="trim-warning">{error}</p>}
   </div>
   <div className="connection-actions">
    <button type="button" className="secondary" disabled={!connection||(!!busy&&busy!=='save')} aria-haspopup="dialog" onClick={()=>{setError('');setSetupOpen(true);dialog.current?.showModal();}}><Settings2 size={15}/>TikTok setup</button>
    {connection?.connected?<button type="button" className="secondary" disabled={!!busy} onClick={disconnect}>Disconnect TikTok</button>:
     <button type="button" className="primary" disabled={!connection?.configured||!!busy} onClick={connect}>Connect TikTok<ExternalLink size={15}/></button>}
   </div>
  </section>
  <dialog ref={dialog} className="youtube-setup-dialog tiktok-setup-dialog" aria-labelledby="tiktok-setup-title" onCancel={e=>{if(busy)e.preventDefault();}} onClose={()=>{setClientKey('');setClientSecret('');setError('');setSetupOpen(false);}}>
   <h2 id="tiktok-setup-title"><Settings2 size={20}/>Set up TikTok access</h2>
   <ol>
    <li>In <a href="https://developers.tiktok.com/apps/" target="_blank" rel="noreferrer">TikTok for Developers</a>, register a Desktop app and add Login Kit and Content Posting API.</li>
    <li>Register this redirect URI in Desktop Login Kit. Request the <code>user.info.basic</code> and <code>video.upload</code> scopes.</li>
   </ol>
   <code className="tiktok-redirect">{location.origin}/api/tiktok/callback</code>
   {connection?.connected?<><p>Disconnect TikTok before changing the app credentials.</p><footer><button type="button" className="secondary" onClick={()=>dialog.current?.close()}>Close</button></footer></>:
    <form onSubmit={e=>{e.preventDefault();void save();}} autoComplete="off">
     <label>Client key<input value={clientKey} disabled={!!busy} onChange={e=>setClientKey(e.target.value)} autoComplete="off" maxLength={256}/></label>
     <label>Client secret<input type="password" value={clientSecret} disabled={!!busy} onChange={e=>setClientSecret(e.target.value)} autoComplete="new-password" maxLength={256}/></label>
     <p>After TikTok approves video upload access, save the app credentials and choose Connect TikTok.</p>
     {error&&<p role="alert" className="trim-warning">{error}</p>}
     <footer><button type="button" className="secondary" disabled={!!busy} onClick={()=>dialog.current?.close()}>Cancel</button><button type="submit" className="primary" disabled={!!busy||!clientKey.trim()||!clientSecret.trim()}>Save credentials</button></footer>
    </form>}
  </dialog>
 </>;
}

export function TikTokPost({post,onClose,onConnect}:{post:CalendarPost;onClose:()=>void;onConnect:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),endpoint=`/api/posting/${post.id}/tiktok`;
 const [connection,setConnection]=useState<Connection|null>(null),[draft,setDraft]=useState<Draft|null>(null);
 const [caption,setCaption]=useState(''),[consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const dirty=!!draft&&caption!==draft.caption;
 useEffect(()=>{
  dialog.current?.showModal();
  Promise.all([request<Draft>(endpoint),status()]).then(([post,account])=>{
   setDraft(post);setCaption(post.caption);setConnection(account);
  }).catch(e=>setError(message(e)));
 },[endpoint]);
 async function run(action:'save'|'send'|'check'){
  setBusy(action);setError('');setNotice('');
  try{
   if(action==='save'||(action==='send'&&dirty)){
    const saved=await request<Draft>(endpoint,'PUT',{caption});
    setDraft(old=>({...old,...saved}));
    if(action==='save')setNotice('TikTok caption saved.');
   }
   if(action==='send'||action==='check'){
    const result=await request<Draft>(action==='check'?`${endpoint}/check`:endpoint,'POST',{consent,accountId:connection?.accountId});
    setDraft(old=>({...old,...result}));
    if(action==='send')setConsent(false);
   }
  }catch(e){
   setError(message(e));
   if(action==='send')request<Draft>(endpoint).then(setDraft).catch(()=>{});
  }finally{setBusy('');}
 }
 const canSend=draft&&(draft.state==='draft'||draft.state==='failed'||draft.resumable)&&!draft.videoError;
 return <dialog ref={dialog} className="post-editor tiktok-post-dialog" aria-labelledby="tiktok-post-title" onClose={onClose} onCancel={e=>{if(busy)e.preventDefault();}}>
  <header><div><h2 id="tiktok-post-title">Send to TikTok</h2><p className="muted">{post.metadata.title}</p></div><button type="button" className="icon-button" aria-label="Close" disabled={!!busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></header>
  <div className="post-editor-body">
   <div className="post-editor-media"><video controls preload="metadata" src={`/api/posting/${post.id}/video`}/></div>
   <div className="post-editor-fields">
    {connection?.connected?<p>Send to <strong>{connection.displayName}</strong> for review.</p>:connection&&<p>TikTok is not connected. <button type="button" className="text-button" onClick={()=>{dialog.current?.close();onConnect();}}>Connect in Automation</button></p>}
    {draft&&<>
     <label>TikTok caption and hashtags <span className="counter">{caption.length}/2200</span><textarea rows={6} value={caption} maxLength={2200} disabled={!!busy} onChange={e=>{setCaption(e.target.value);setNotice('');}}/></label>
     <button type="button" className="secondary tiktok-copy" disabled={!caption.trim()} onClick={()=>navigator.clipboard.writeText(caption).then(()=>setNotice('TikTok caption copied.')).catch(()=>setError('Select the caption field and copy it manually.'))}><Copy size={15}/>Copy caption</button>
     <p className="muted">TikTok Inbox receives the video. Paste this caption in TikTok before publishing.</p>
     <p role="status">{states[draft.state]||draft.state}{draft.state==='inbox'?' · Open the Inbox notification in TikTok to finish.':''}</p>
     {draft.videoError&&<p className="trim-warning">{draft.videoError}</p>}
     {draft.error&&<p className="trim-warning">{draft.error}</p>}
     {canSend&&connection?.connected&&<label className="tiktok-consent"><input type="checkbox" checked={consent} disabled={!!busy} onChange={e=>setConsent(e.target.checked)}/>I want to send this video to TikTok Inbox.</label>}
    </>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="trim-warning">{error}</p>}
   </div>
  </div>
  {draft&&<footer>
   {draft?.checkable&&connection?.connected&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>run('check')}>Check TikTok status</button>}
   <button type="button" className="secondary" disabled={!dirty||!!busy} onClick={()=>run('save')}>Save caption</button>
   {canSend&&<button type="button" className="primary" disabled={!connection?.connected||!consent||!!busy} onClick={()=>run('send')}>{busy==='send'?<Loader2 size={16} className="spin"/>:<Upload size={16}/>} {draft.resumable?'Resume TikTok upload':'Send to TikTok Inbox'}</button>}
  </footer>}
 </dialog>;
}

import {useEffect,useRef,useState} from 'react';
import {Upload,X,Loader2,ExternalLink,CalendarClock,MonitorPlay,Smartphone,RefreshCw,Sparkles} from 'lucide-react';
import type {Job,Clip,UploadMetadata} from './types';import {TitleOptions} from './ThumbnailPicker';

type Publication={metadata:UploadMetadata;exported:boolean;format:'shorts'|'video';connected:boolean;channelTitle:string;ai:boolean};
type AiDraft={metadata:UploadMetadata;hashtags:string[];rationale:string;trendingUsed:number};
type Post={id:string;state:string;error?:string;url?:string};
const CATEGORIES:[string,string][]=[['20','Gaming'],['24','Entertainment'],['22','People & Blogs'],['23','Comedy'],['17','Sports'],['10','Music'],['27','Education'],['28','Science & Technology'],['26','How-to & Style'],['19','Travel & Events']];
const DONE=/^(uploaded-|scheduled$|published$|needs-retry$)/;

async function api<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{...init,headers:{'Content-Type':'application/json',...init?.headers}});
 // An HTML reply means the server predates this feature (or is down): say so instead of a JSON parse error.
 if(!(r.headers.get('content-type')||'').includes('json'))throw new Error(r.status===404?'The app server is running an older version. Restart it (Ctrl+C, then npm start) and try Post again.':`The app server replied unexpectedly (${r.status}). Check that it is running.`);
 const d=await r.json();if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;}
const localInput=(d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);

/** Review a finished clip's YouTube details, then upload it in one step. */
export default function PostDialog({job,clip,onClose,onReexport}:{job:Job;clip:Pick<Clip,'id'|'title'>&{titleOptions?:string[]};onClose:()=>void;onReexport?:(format:'video'|'shorts')=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [pub,setPub]=useState<Publication|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[post,setPost]=useState<Post|null>(null),[postAs,setPostAs]=useState<'video'|'shorts'>('shorts'),[writing,setWriting]=useState(false),[ai,setAi]=useState<AiDraft|null>(null);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[tags,setTags]=useState(''),[categoryId,setCategoryId]=useState('22');
 const [privacy,setPrivacy]=useState('private'),[kids,setKids]=useState<''|'no'|'yes'>(''),[publishAt,setPublishAt]=useState(localInput(new Date(Date.now()+3600000)));
 useEffect(()=>{dialog.current?.showModal();api<Publication>(`/api/jobs/${job.id}/clips/${clip.id}/publication`).then(p=>{setPub(p);setPostAs(p.format);setTitle(p.metadata.title.slice(0,100));setDescription(p.metadata.description||'');setTags((p.metadata.tags||[]).join(', '));setCategoryId(p.metadata.categoryId||'22');}).catch(e=>setError(e.message));},[job.id,clip.id]);
 // Follow the upload until YouTube reports a final state.
 useEffect(()=>{if(!post||DONE.test(post.state))return;const timer=setInterval(()=>api<{posts:Post[]}>('/api/posting').then(r=>{const next=r.posts.find(p=>p.id===post.id);if(next)setPost(next);}).catch(()=>{}),2000);return ()=>clearInterval(timer);},[post]);
 const tagList=tags.split(',').map(t=>t.trim()).filter(Boolean),tagChars=tagList.join(',').length;
 const mismatch=!!pub&&postAs!==pub.format;
 const problem=!pub?'':mismatch?(pub.format==='shorts'?'This export is vertical, so YouTube would post it as a Short. Re-export it as a 16:9 main video first.':'This export is 16:9, so YouTube would post it as a regular video. Re-export it vertically for Shorts first.'):!pub.exported?'Export this clip first: the Post button sends the finished video file.':!title.trim()?'Add a title.':title.length>100?'Titles are limited to 100 characters.':/[<>]/.test(title+description)?'YouTube does not allow < or > in titles or descriptions.':tagChars>440?'Tags are over the 440-character limit.':!kids?'Choose whether this video is made for kids.':privacy==='schedule'&&Date.parse(publishAt)<Date.now()+60000?'Pick a release time at least a minute from now.':'';
 async function writeWithAi(){setWriting(true);setError('');try{const d=await api<AiDraft>(`/api/jobs/${job.id}/clips/${clip.id}/metadata/ai`,{method:'POST',body:JSON.stringify({format:postAs,categoryId})});setTitle(d.metadata.title);setDescription(d.metadata.description);setTags(d.metadata.tags.join(', '));setAi(d);}catch(e){setError((e as Error).message);}finally{setWriting(false);}}
 async function submit(upload:boolean){setBusy(true);setError('');try{
  const draft=await api<Post>('/api/posting/export',{method:'POST',body:JSON.stringify({jobId:job.id,clipId:clip.id,format:postAs,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,metadata:{title:title.trim(),description,tags:tagList,categoryId},settings:{privacy,madeForKids:kids==='yes',publishAt:privacy==='schedule'?new Date(publishAt).toISOString():undefined}})});
  if(upload){await api('/api/posting/run',{method:'POST',body:JSON.stringify({ids:[draft.id]})});setPost({...draft,state:'uploading'});}else setPost({...draft,state:'draft'});
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const close=()=>{dialog.current?.close();onClose();};
 const finished=post&&DONE.test(post.state),uploading=post&&post.state==='uploading';
 return <dialog ref={dialog} className="editor-dialog post-dialog" aria-labelledby="post-title" onCancel={e=>{e.preventDefault();close();}}>
  <header className="editor-header"><div><span>Post to YouTube{pub?.channelTitle?` · ${pub.channelTitle}`:''}</span><h2 id="post-title">Ready to post?</h2></div><button className="icon-button" aria-label="Close" onClick={close}><X size={18}/></button></header>
  <div className="post-body">
   {!pub&&!error&&<p className="loading-words"><Loader2 className="spin" size={16}/>Writing the title and description…</p>}
   {pub&&!post&&<form id="post-form" onSubmit={e=>{e.preventDefault();submit(true);}}>
    <div className="format-choice" role="radiogroup" aria-label="Post as"><button type="button" role="radio" aria-checked={postAs==='video'} className={postAs==='video'?'chosen':''} onClick={()=>setPostAs('video')}><MonitorPlay size={20}/><strong>Main video</strong><small>16:9 on your channel's Videos tab</small></button><button type="button" role="radio" aria-checked={postAs==='shorts'} className={postAs==='shorts'?'chosen':''} onClick={()=>setPostAs('shorts')}><Smartphone size={20}/><strong>Shorts</strong><small>Vertical, up to 3 minutes</small></button></div>
    {mismatch&&onReexport&&<button type="button" className="secondary" onClick={()=>{onReexport(postAs);close();}}><RefreshCw size={15}/>Re-export as {postAs==='video'?'a main video (1920 × 1080)':'a Short (1080 × 1920)'}</button>}
    {!pub.connected&&<p className="setup-warning">YouTube isn't connected. Save a draft now and upload it from the Posting calendar later, or connect in Automation.</p>}
    <div className="ai-row"><button type="button" className="secondary" disabled={writing||!pub.ai} onClick={writeWithAi}>{writing?<Loader2 className="spin" size={15}/>:<Sparkles size={15}/>}{writing?'Writing…':ai?'Write again':'Write with AI'}</button>{!pub.ai&&<small>Add a free <code>GEMINI_API_KEY</code> (aistudio.google.com/app/apikey) to your <code>.env</code> file, then restart, to let AI write hooks, hashtags and tags.</small>}{ai&&<small className="ai-note">{ai.rationale}{ai.trendingUsed>0?` · Matched to ${ai.trendingUsed} trending videos.`:''} Check it's accurate before posting.</small>}</div>
    <TitleOptions options={clip.titleOptions||[]} current={title} onPick={setTitle}/><label><span className="field-label">Title <small>{title.length}/100</small></span><input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} required/></label>
    <label><span className="field-label">Description</span><textarea rows={6} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <label><span className="field-label">Tags · comma separated <small>{tagChars}/440</small></span><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="ishowspeed, spider-man, irl"/></label>
    <div className="post-grid">
     <label><span className="field-label">Category</span><select value={categoryId} onChange={e=>setCategoryId(e.target.value)}>{CATEGORIES.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
     
     <label><span className="field-label">Visibility</span><select value={privacy} onChange={e=>setPrivacy(e.target.value)}><option value="private">Private · only you</option><option value="unlisted">Unlisted · anyone with the link</option><option value="public">Public · post now</option><option value="schedule">Schedule a public release</option></select></label>
     {privacy==='schedule'&&<label><span className="field-label"><CalendarClock size={13}/> Release time</span><input type="datetime-local" value={publishAt} onChange={e=>setPublishAt(e.target.value)}/></label>}
    </div>
    <fieldset className="kids-choice"><legend className="field-label">Audience · required by YouTube</legend><label className="check-option"><input type="radio" name="kids" checked={kids==='no'} onChange={()=>setKids('no')}/>No, it's not made for kids</label><label className="check-option"><input type="radio" name="kids" checked={kids==='yes'} onChange={()=>setKids('yes')}/>Yes, it's made for kids</label></fieldset>
    {problem&&<p className="trim-warning" role="status">{problem}</p>}
   </form>}
   {post&&<div className="post-result" role="status">
    {uploading&&<p className="loading-words"><Loader2 className="spin" size={16}/>Uploading to YouTube… you can close this; it keeps going.</p>}
    {post.state==='draft'&&<p>Saved as a draft in the <strong>Posting calendar</strong>.</p>}
    {finished&&!post.error&&<p><strong>{post.state==='scheduled'?'Scheduled!':'Posted!'}</strong> YouTube has your video.</p>}
    {post.error&&<p className="trim-warning">{post.error}</p>}
    {post.url&&<a className="secondary" href={post.url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Open on YouTube</a>}
   </div>}
   {error&&<p className="trim-warning" role="alert">{error}</p>}
  </div>
  <footer className="editor-footer"><button className="text-button" onClick={close}>{post?'Close':'Cancel'}</button>{pub&&!post&&<div><button className="secondary" type="button" disabled={busy||!!problem} onClick={()=>submit(false)}>Save draft</button><button className="primary" type="submit" form="post-form" disabled={busy||!!problem||!pub.connected}>{busy?<Loader2 className="spin" size={16}/>:<Upload size={16}/>}{privacy==='schedule'?'Schedule upload':'Upload to YouTube'}</button></div>}</footer>
 </dialog>;
}

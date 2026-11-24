import {useEffect,useState} from 'react';
import {Check,ExternalLink,TriangleAlert,ChevronRight} from 'lucide-react';

// Steps checked against Google's help for the Google Auth Platform (support.google.com/cloud/answer/15544987,
// 15549945, 15549257). The Personal setup page (console.cloud.google.com/auth/overview/personal) makes the project and
// a Desktop client in one go; Personal apps need no test users, show no "unverified app" screen and don't expire
// every 7 days. The same guide, longer, is docs/YOUTUBE-SETUP.md.
export const FULL_GUIDE='https://github.com/jaspher19/open-clip-editor/blob/master/docs/YOUTUBE-SETUP.md';
const PERSONAL='https://console.cloud.google.com/auth/overview/personal';
const API='https://console.cloud.google.com/apis/library/youtube.googleapis.com';

type Step={id:string;label:string;body:React.ReactNode;link?:{label:string;href:string}};
const A=({href,children}:{href:string;children:React.ReactNode})=><a href={href} target="_blank" rel="noreferrer">{children}</a>;

const steps:Step[]=[
 {id:'account',label:'Right account',body:<>
  <p>Everything below must be done with <strong>the Google account that owns your YouTube channel</strong>. Using a different account is the most common reason setup fails.</p>
  <ol>
   <li>Open <A href="https://www.youtube.com">youtube.com</A>, click your profile picture (top right) and check that it shows <strong>your channel</strong>. No channel yet? Click <strong>Create a channel</strong> first.</li>
   <li>Signed in to several Google accounts in this browser? Easiest fix: open the links in this guide in a <strong>private / incognito window</strong> and sign in only with the channel’s account.</li>
  </ol>
  <p className="yt-tip">No billing or credit card is needed for any of this.</p></>},
 {id:'client',label:'Make your app',link:{label:'Open Google’s Personal setup page',href:PERSONAL},body:<>
  <p>Google has one page that makes everything OpenClip needs. Open it with the button below and sign in with the channel’s account.</p>
  <ol>
   <li><strong>Project:</strong> keep the suggested one (<em>personal-mode-app</em>) or pick <strong>Create a new project</strong>.</li>
   <li><strong>Application type:</strong> choose <strong>Desktop app</strong> (not Web application).</li>
   <li>Tick the box to agree to the Terms of Service and click <strong>Continue</strong>.</li>
   <li>In the <strong>OAuth client created</strong> window, click <strong>Download JSON</strong> <em>before you close it</em>. Google shows the secret only once. The file is named like <code>client_secret_….json</code> and lands in your Downloads folder.</li>
  </ol>
  <details className="yt-more"><summary>The Personal page doesn’t open or doesn’t offer Personal?</summary>
   <p>Use the classic way instead:</p>
   <ol>
    <li>Create a project at <A href="https://console.cloud.google.com/projectcreate">console.cloud.google.com/projectcreate</A>.</li>
    <li>Open <A href="https://console.cloud.google.com/auth/overview">Google Auth Platform</A> → <strong>Get started</strong>. App name <em>OpenClip</em>, your email as support email, Audience <strong>External</strong>, your email as contact, agree, <strong>Create</strong>.</li>
    <li>Open <strong>Audience</strong> → <strong>Test users</strong> → <strong>Add users</strong> and add <strong>the channel’s email</strong>. Without this, Google says “Access blocked”.</li>
    <li>Open <A href="https://console.cloud.google.com/auth/clients">Clients</A> → <strong>Create client</strong> → <strong>Desktop app</strong> → <strong>Create</strong> → <strong>Download JSON</strong>.</li>
   </ol>
   <p>External apps in testing ask you to connect again every 7 days.</p>
  </details></>},
 {id:'api',label:'Turn on API',link:{label:'Open YouTube Data API v3',href:API},body:<>
  <p>Your new project has to be allowed to talk to YouTube.</p>
  <ol>
   <li>Open the API page with the button below.</li>
   <li>At the top of the page, check that <strong>your project</strong> is selected (for example <em>personal-mode-app</em>). If not, click the project name and pick it.</li>
   <li>Click <strong>Enable</strong>. If you see <strong>Manage</strong> instead, it’s already on. Give it a minute before connecting.</li>
  </ol></>},
 {id:'json',label:'Add JSON',body:<>
  <p>Now give the file to OpenClip, using the box below this guide.</p>
  <ol>
   <li>Click <strong>Choose JSON file</strong> and pick the <code>client_secret_….json</code> from your Downloads (or open it in Notepad and paste everything into the box).</li>
   <li>Click <strong>Save credentials</strong>. It stays on this computer only.</li>
  </ol></>},
 {id:'connect',label:'Connect',body:<>
  <ol>
   <li>Close this window and click <strong>Connect YouTube</strong>. A Google tab opens.</li>
   <li>Pick <strong>the channel’s Google account</strong>. If you manage several channels, pick the right one.</li>
   <li>On the permission page, <strong>tick every box</strong> and click <strong>Continue</strong>.</li>
   <li>The tab says <strong>YouTube connected</strong>. Close it; OpenClip shows your channel name.</li>
  </ol>
  <p className="yt-tip">Classic (External) app only: Google first says <em>“Google hasn’t verified this app”</em>. Click <strong>Advanced</strong> → <strong>Go to OpenClip (unsafe)</strong>. It’s your own app, so that’s fine.</p>
  <p className="yt-tip">New Google projects can only upload <strong>private</strong> videos until YouTube audits them. OpenClip uploads privately by default; switch a video to public in YouTube Studio when you’re ready.</p></>},
];

/** Error messages people hit, with the fix. Same list as docs/YOUTUBE-SETUP.md. */
const PROBLEMS:[string,React.ReactNode][]=[
 ['“Access blocked: … has not completed the Google verification process” (Error 403: access_denied)',<>You’re signed in with an account the app doesn’t allow. With the Personal page: use the account that made the app. With the classic way: add that exact email under <strong>Audience → Test users</strong>.</>],
 ['“client_user_mismatch” or “This app can only be used by its owner”',<>You picked a different Google account at sign-in. Click <strong>Connect YouTube</strong> again and pick the account you used in step 2.</>],
 ['“Error 400: redirect_uri_mismatch” or “That JSON is for a Web application client”',<>The client is the wrong type. Make a new client with Application type <strong>Desktop app</strong>, download its JSON and save it again.</>],
 ['“YouTube Data API v3 is turned off” / “has not been used in project”',<>Do step 3 in the <strong>same project</strong> as your client, wait two minutes, then connect again.</>],
 ['“The JSON has no client secret” or “invalid_client”',<>The secret is only shown when the client is made. Open <A href="https://console.cloud.google.com/auth/clients">Clients</A>, open your client, click <strong>Add secret</strong>, download the JSON again and save it.</>],
 ['“OpenClip wasn’t given permission to upload”',<>A permission box was left unticked. Click <strong>Disconnect</strong>, <strong>Connect YouTube</strong>, and tick every box.</>],
 ['“This Google account has no YouTube channel yet”',<>Create the channel on youtube.com (profile picture → <strong>Create a channel</strong>), or connect with the account that owns it.</>],
 ['It worked, but a week later uploads fail (“invalid_grant”)',<>Classic External apps in testing expire after 7 days. Click <strong>Disconnect</strong> and <strong>Connect YouTube</strong> again, or remake the app with the Personal page to stop this.</>],
 ['Uploads stay private',<>Normal for new Google projects until YouTube audits them. Make the video public in YouTube Studio, or apply through Google’s YouTube API audit form.</>],
 ['“used up today’s free YouTube quota”',<>Google’s free quota is about 6 uploads a day per project. It resets at midnight Pacific Time.</>],
];

export default function YouTubeSetupGuide({connected,configured=false}:{connected:boolean;configured?:boolean}){
 const done=(id:string)=>id==='json'?configured||connected:id==='connect'?connected:false;
 const first=connected?steps.length-1:configured?steps.findIndex(s=>s.id==='connect'):0;
 const [selected,setSelected]=useState(first);
 useEffect(()=>setSelected(first),[first]);
 const step=steps[selected];
 return <div className="youtube-guide">
  <ol className="youtube-guide-steps" aria-label="YouTube setup steps">
   {steps.map(({id,label},index)=><li key={id}><button type="button" aria-current={selected===index?'step':undefined} className={done(id)?'done':''} onClick={()=>setSelected(index)}>
    <span className="yt-num">{done(id)?<Check size={13}/>:index+1}</span>{label}
   </button></li>)}
  </ol>
  <div className="youtube-guide-panel" aria-live="polite">
   <h3>Step {selected+1} of {steps.length}: {step.label}</h3>
   {connected&&step.id==='connect'?<p className="yt-ok"><Check size={16}/>Your channel is connected. To use a different Google client, click Disconnect first, then open this guide again.</p>:step.body}
   {step.link&&<a className="yt-link" href={step.link.href} target="_blank" rel="noreferrer">{step.link.label}<ExternalLink size={14}/></a>}
   <div className="youtube-guide-nav">{selected>0?<button type="button" className="text-button" onClick={()=>setSelected(selected-1)}>← Back</button>:<span/>}{selected<steps.length-1&&<button type="button" className="text-button" onClick={()=>setSelected(selected+1)}>Done, next step <ChevronRight size={14}/></button>}</div>
  </div>
  <details className="yt-problems">
   <summary><TriangleAlert size={15}/>Stuck? Fixes for the usual errors</summary>
   <dl>{PROBLEMS.map(([q,a])=><div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
   <p>Still stuck? The <A href={FULL_GUIDE}>full guide on GitHub</A> has more detail.</p>
  </details>
 </div>;
}

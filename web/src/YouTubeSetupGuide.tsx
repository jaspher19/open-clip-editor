import {useState} from 'react';

// Steps checked against Google's help for the Google Auth Platform (support.google.com/cloud/answer/15544987,
// 15549945, 15549257). "Personal" apps (only the account that made them can sign in) need no test users, show no
// unverified-app screen and their sign-in doesn't expire after 7 days, so they are the recommended path.
// Each step can show a screenshot from /youtube-setup/<id>.webp|png when one exists (see `image`).
type Step={id:string;label:string;image?:string;instructions:React.ReactNode;link?:{label:string;href:string}};
const steps:Step[]=[
 {id:'create-project',label:'Project',
  instructions:<>Sign in to Google Cloud with <strong>the Google account that owns your YouTube channel</strong> (this matters: only this account will be able to connect). Click <strong>Create project</strong>, give it any name (for example <em>OpenClip</em>) and click <strong>Create</strong>. No billing is needed.</>,
  link:{label:'Create a project',href:'https://console.cloud.google.com/projectcreate'}},
 {id:'enable-api',label:'Enable API',image:'enable-api',
  instructions:<>With that project selected at the top of the page, open <strong>YouTube Data API v3</strong> and click <strong>Enable</strong>.</>,
  link:{label:'Open YouTube Data API v3',href:'https://console.cloud.google.com/apis/library/youtube.googleapis.com'}},
 {id:'oauth-consent',label:'Sign-in screen',image:'oauth-consent',
  instructions:<>Open the <strong>Google Auth Platform</strong> and click <strong>Get started</strong>. Enter an app name (<em>OpenClip</em>) and choose your email as the support email. Under <strong>Audience</strong>, choose <strong>Personal</strong> (recommended: only you can sign in, no test users, no warning screen, and you don’t have to reconnect every week). Add your email as the contact, accept the policy and click <strong>Create</strong>.<br/><small>No Personal option? Choose <strong>External</strong>, then open <strong>Audience</strong> and under <strong>Test users</strong> click <strong>Add users</strong> and add your own email. With External, Google asks you to sign in again every 7 days.</small></>,
  link:{label:'Open Google Auth Platform',href:'https://console.cloud.google.com/auth/overview'}},
 {id:'desktop-client',label:'Get JSON',image:'desktop-client',
  instructions:<>Open <strong>Clients</strong> and click <strong>Create client</strong>. For <strong>Application type</strong> choose <strong>Desktop app</strong>, type any name and click <strong>Create</strong>. In the window that opens, click <strong>Download JSON</strong> <em>before</em> closing it: Google shows the secret only once. (Lost it? Open the client and use <strong>Add secret</strong>.)</>,
  link:{label:'Open Clients',href:'https://console.cloud.google.com/auth/clients'}},
 {id:'connect-channel',label:'Connect',image:'connect-channel',
  instructions:<>Below, choose the downloaded JSON file (or paste its contents) and click <strong>Save credentials</strong>. Then click <strong>Connect YouTube</strong>, sign in with the same Google account, pick your channel if you have several, and allow access. With an External app, Google first says <em>“Google hasn’t verified this app”</em>: click <strong>Advanced</strong>, then <strong>Go to OpenClip</strong>. It’s your own app, so that’s safe.<br/><small>Uploads from a new Google Cloud project can stay <strong>private</strong> until YouTube audits the project; OpenClip uploads privately by default. To publish, change the video to public in YouTube Studio, or apply for the audit in Google’s YouTube API Services form.</small></>},
];

const IMAGE_EXT:Record<string,string>={'enable-api':'webp','oauth-consent':'webp','desktop-client':'webp','connect-channel':'webp'};

export default function YouTubeSetupGuide({connected}:{connected:boolean}){
 const [selected,setSelected]=useState(0);
 const step=steps[selected];
 return <div className="youtube-guide">
  <div className="youtube-guide-steps" role="group" aria-label="YouTube setup steps">
   {steps.map(({id,label},index)=><button key={id} type="button" aria-pressed={selected===index} onClick={()=>setSelected(index)}>
    {index+1}. {label}
   </button>)}
  </div>
  <div className="youtube-guide-panel" aria-live="polite">
   {step.image&&<img src={`/youtube-setup/${step.image}.${IMAGE_EXT[step.image]||'webp'}`} alt="" width={760} height={208}/>}
   <p>{connected&&step.id==='connect-channel'?
    <>Your channel is connected. To use a different OAuth client, disconnect first, then open this dialog again to import its JSON.</>:
    step.instructions}</p>
   {step.link&&<a href={step.link.href} target="_blank" rel="noreferrer">{step.link.label} ↗</a>}
   <div className="youtube-guide-nav">{selected>0&&<button type="button" className="text-button" onClick={()=>setSelected(selected-1)}>← Back</button>}{selected<steps.length-1&&<button type="button" className="text-button" onClick={()=>setSelected(selected+1)}>Next step →</button>}</div>
  </div>
 </div>;
}

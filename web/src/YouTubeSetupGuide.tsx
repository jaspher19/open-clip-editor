import {useState} from 'react';

const steps = [
 {
  id:'enable-api',
  label:'Enable API',
  instructions:<>In Google Cloud, create or select a project. Open the API Library, find <strong>YouTube Data API v3</strong>, and click <strong>Enable</strong>.</>,
  link:{label:'Open YouTube Data API v3', href:'https://console.cloud.google.com/apis/library/youtube.googleapis.com'},
 },
 {
  id:'oauth-consent',
  label:'Set up consent',
  instructions:<>Open <strong>Branding</strong>. If prompted, click <strong>Get Started</strong> and fill in the app name, support email, audience, and contact email. For an External app in Testing, open <strong>Audience</strong> and add the Google account you’ll sign in with under <strong>Test users</strong>.</>,
  link:{label:'Open Branding', href:'https://console.cloud.google.com/auth/branding'},
 },
 {
  id:'desktop-client',
  label:'Get JSON',
  instructions:<>In <strong>Clients</strong>, click <strong>Create client</strong>, choose <strong>Desktop app</strong>, enter a name, and click <strong>Create</strong>. In the confirmation window, click <strong>Download JSON</strong> before closing it.</>,
  link:{label:'Open Clients', href:'https://console.cloud.google.com/auth/clients'},
 },
 {
  id:'connect-channel',
  label:'Connect',
  instructions:<>Paste the contents of the downloaded JSON below or choose the file. Click <strong>Save credentials</strong>, then use <strong>Connect YouTube</strong> in Automation to authorize your channel with Google.</>,
 },
] as const;

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
   <img src={`/youtube-setup/${step.id}.webp`} alt="" width={760} height={208}/>
   <p>{connected&&step.id==='connect-channel'?
    <>Your channel is connected. To use a different OAuth client, disconnect first, then open this dialog again to import its JSON.</>:
    step.instructions}</p>
   {'link' in step&&<a href={step.link.href} target="_blank" rel="noreferrer">{step.link.label} ↗</a>}
  </div>
 </div>;
}

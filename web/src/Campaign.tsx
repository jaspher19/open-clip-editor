import {Target,CircleAlert} from 'lucide-react';
import type {Job} from './types';

/** Project page: the campaign rules the AI read from the pasted brief, and what they changed. */
export default function CampaignCard({campaign}:{campaign:NonNullable<Job['campaign']>}){
 if(campaign.status!=='done'||!campaign.rules)return <section className="campaign-card warn" role="status"><CircleAlert size={18}/><div><strong>Campaign requirements weren’t used</strong><p>{campaign.error||'The AI could not read the brief.'} These clips were picked without them.</p></div></section>;
 const r=campaign.rules,length=r.minSeconds||r.maxSeconds?`${r.minSeconds?`${r.minSeconds}`:'0'}–${r.maxSeconds?`${r.maxSeconds}`:'∞'} s`:'';
 return <section className="campaign-card" aria-labelledby="campaign-title"><Target size={20}/><div>
  <h2 id="campaign-title">Campaign: {r.name}</h2>{r.summary&&<p>{r.summary}</p>}
  <ul className="campaign-rules">
   {length&&<li><b>Length</b>{length}</li>}{r.format!=='any'&&<li><b>Shape</b>{r.format==='vertical'?'Vertical 9:16':'Horizontal 16:9'}</li>}
   {r.mustShow.length>0&&<li><b>Must show</b>{r.mustShow.join(' · ')}</li>}{r.avoid.length>0&&<li><b>Avoid</b>{r.avoid.join(' · ')}</li>}
   {(r.requiredHashtags.length>0||r.requiredMentions.length>0)&&<li><b>Added to every post</b>{[...r.requiredMentions,...r.requiredHashtags].join(' ')}</li>}
   {r.titleRules&&<li><b>Titles</b>{r.titleRules}</li>}
  </ul>
  {!!campaign.applied?.length&&<p className="campaign-applied">Applied: {campaign.applied.join(' · ')}</p>}
  <small>The AI picked moments against these rules ({campaign.provider||'AI'}). Check each clip against the campaign before you submit it.</small>
 </div></section>;
}

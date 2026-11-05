import type {CSSProperties} from 'react';
import type {EditTemplate} from './types';
import {HookTitle} from './LivePreview';

const FONT:Record<string,string>={anton:'Anton',barlow:"'Barlow Condensed'",work:"'Work Sans'"};
const CAPTION:Record<string,string>={impact:'NO WAY HE DID',gaming:'WAIT FOR IT',podcast:'here’s the thing',explain:'first, explain the',story:'and then it changed',editorial:'the full context',reaction:'watch his face'};

/** Drawn card art for templates without an original reference: shows each template's layout, font and colours. */
export default function TemplateMock({template}:{template:EditTemplate}){
 const s=template.settings,font=FONT[String(s.font)]||template.fontFamily,framing=String(s.framing||'center'),caption=CAPTION[String(s.style)]||'the best part';
 const words=caption.split(' '),hit=Math.min(words.length-1,1);
 return <span className={`template-mock mock-${framing} caption-${String(s.captionPosition||'lower')}`} style={{'--mock-accent':template.accent,fontFamily:font} as CSSProperties} aria-hidden="true">
  <span className="mock-scene"><span className="mock-person"/></span>
  <span className="mock-hook"><HookTitle text={template.sample} accent={template.accent} fontFamily={font}/></span>
  <span className="mock-caption">{words.map((w,i)=><span key={i} className={i===hit?'accent':undefined}>{w} </span>)}</span>
 </span>;
}

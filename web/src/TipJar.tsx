import {useEffect,useRef,useState} from 'react';
import {Coffee,X,Scissors,ExternalLink} from 'lucide-react';
import qr from './assets/tip-qr-code.png';import kofiQr from './assets/tip-kofi-qr.png';

// "Spare me some change": the author's InstaPay QR. It opens when a project starts and whenever something is
// generated (exports, countdowns, summaries, cuts), and from the Tip me button. It never blocks the work itself.
export const AUTHOR='Jaspher Tampos',AUTHOR_URL='https://www.facebook.com/JaspherTampos',KOFI_URL='https://ko-fi.com/jasphertampos';
const EVENT='openclip:tip';
/** Show the tip popup (the action that triggered it carries on in the background). */
export function askTip(){window.dispatchEvent(new Event(EVENT));}

export function TipButton({compact=false}:{compact?:boolean}){
 return <button type="button" className={`tip-button ${compact?'compact':''}`} onClick={askTip}><Coffee size={compact?15:17}/>{compact?'Tip me':'Spare me some change'}</button>;
}

function TipCard({qr,size,alt,tag,note,badge=false,link}:{qr:string;size:number;alt:string;tag:string;note:string;badge?:boolean;link?:React.ReactNode}){
 return <figure className="tip-card">
  <figcaption className="tip-card-name" translate="no"><span className="brand-mark" aria-hidden="true"><Scissors size={18}/></span>OpenClip</figcaption>
  <div className="tip-card-qr"><i className="tip-corner tl"/><i className="tip-corner tr"/><i className="tip-corner bl"/><i className="tip-corner br"/><img src={qr} alt={alt} width={size} height={size} style={{width:size}}/>{badge&&<span className="tip-qr-badge" aria-hidden="true"><Coffee size={26}/></span>}</div>
  <span className="tip-tag">{tag}</span><small className="tip-note">{note}</small>{link}
 </figure>;
}

export default function TipJar(){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
 useEffect(()=>{const show=()=>setOpen(true);window.addEventListener(EVENT,show);return()=>window.removeEventListener(EVENT,show);},[]);
 useEffect(()=>{const d=dialog.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close();},[open]);
 return <dialog ref={dialog} className="tip-dialog" aria-labelledby="tip-title" onCancel={e=>{e.preventDefault();setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
  <button type="button" className="tip-close" aria-label="Close" onClick={()=>setOpen(false)}><X size={18}/></button>
  <h2 id="tip-title"><Coffee size={22}/>Spare me some change?</h2>
  <p>OpenClip is free and made by one person. If it saved you time, a small tip keeps it going. Thank you!</p>
  {/* InstaPay: cut pixel for pixel from the bank's code (same payload). Ko-fi: made from KOFI_URL with the highest
      error correction, so the coffee badge in the middle never stops it scanning. Both show at full size: don't shrink. */}
  <div className="tip-cards">
   <TipCard qr={qr} size={325} alt="InstaPay QR code to tip OpenClip" tag="InstaPay · Philippines" note="GCash, Maya, BPI, BDO or any InstaPay bank"/>
   <TipCard qr={kofiQr} size={328} alt="Ko-fi QR code to tip OpenClip" tag="Ko-fi · Worldwide" note="Card or PayPal, from any country" badge
    link={<a className="tip-link" href={KOFI_URL} target="_blank" rel="noopener noreferrer">ko-fi.com/jasphertampos<ExternalLink size={14}/></a>}/>
  </div>
  <div className="tip-actions"><button type="button" className="primary" onClick={()=>setOpen(false)}>Maybe later</button></div>
  <p className="tip-by">OpenClip · by <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">{AUTHOR}</a></p>
 </dialog>;
}

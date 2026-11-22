import {useEffect,useRef,useState} from 'react';
import {Coffee,X} from 'lucide-react';
import qr from './assets/tip-qr.png';

// "Spare me some change": the author's InstaPay QR. It opens when a project starts and whenever something is
// generated (exports, countdowns, summaries, cuts), and from the Tip me button. It never blocks the work itself.
export const AUTHOR='Jaspher Tampos',AUTHOR_URL='https://www.facebook.com/JaspherTampos';
const EVENT='openclip:tip';
/** Show the tip popup (the action that triggered it carries on in the background). */
export function askTip(){window.dispatchEvent(new Event(EVENT));}

export function TipButton({compact=false}:{compact?:boolean}){
 return <button type="button" className={`tip-button ${compact?'compact':''}`} onClick={askTip}><Coffee size={compact?15:17}/>{compact?'Tip me':'Spare me some change'}</button>;
}

export default function TipJar(){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
 useEffect(()=>{const show=()=>setOpen(true);window.addEventListener(EVENT,show);return()=>window.removeEventListener(EVENT,show);},[]);
 useEffect(()=>{const d=dialog.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close();},[open]);
 return <dialog ref={dialog} className="tip-dialog" aria-labelledby="tip-title" onCancel={e=>{e.preventDefault();setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
  <button type="button" className="tip-close" aria-label="Close" onClick={()=>setOpen(false)}><X size={18}/></button>
  <h2 id="tip-title"><Coffee size={22}/>Spare me some change?</h2>
  <p>OpenClip is free and made by one person. If it saved you time, a small tip keeps it going. Thank you!</p>
  <img src={qr} alt="InstaPay QR code for Open Clip (BPI), to send a tip" width={376} height={407}/>
  <p className="tip-small">Scan with any InstaPay bank or e-wallet: GCash, Maya, BPI, BDO and more.</p>
  <div className="tip-actions"><button type="button" className="primary" onClick={()=>setOpen(false)}>Maybe later</button></div>
  <p className="tip-by">OpenClip · by <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">{AUTHOR}</a></p>
 </dialog>;
}

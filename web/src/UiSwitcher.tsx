import {useEffect,useRef,useState} from 'react';import {Check,Palette} from 'lucide-react';
// Three looks for the same app. Only the <html data-ui> attribute changes: no reload, nothing re-fetched, every feature
// and open dialog stays as it is. index.html applies the saved choice before the first paint, so there's no flash.
export const UI_DESIGNS=[
 {id:'comic',name:'Comic',note:'Bold ink, sunburst, pop shadows'},
 {id:'studio',name:'Studio',note:'Dark dashboard, lime accents'},
 {id:'noir',name:'Noir',note:'Pure black, minimal, warm glow'},
 {id:'aurora',name:'Aurora',note:'Charcoal glass, warm orange glow'},
] as const;
export type UiDesign=typeof UI_DESIGNS[number]['id'];
const KEY='openclip-ui',PAGE_COLOR:Record<UiDesign,string>={comic:'#ffd23f',studio:'#0c0c0e',noir:'#000000',aurora:'#121212'};
// Aurora's cursor spotlight: the card under the pointer gets --mx/--my (aurora.css paints a soft light there).
// One passive listener, a style write at most once a frame, and only while Aurora is on.
const LIT='.clip-card,.template-card,.import-panel,.summary-panel,.stream-timeline,.cutter-player,.cutter-panel,.countdown-card,.posting-form,.posting-calendar,.automation-builder,.how-it-works>div,.ready-banner';
function spotlight(){
 let frame=0,last:PointerEvent|null=null;
 const move=(e:PointerEvent)=>{last=e;if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const ev=last;if(!ev)return;
  const card=(ev.target as Element|null)?.closest?.(LIT) as HTMLElement|null;if(!card)return;
  const r=card.getBoundingClientRect();card.style.setProperty('--mx',`${Math.round(ev.clientX-r.left)}px`);card.style.setProperty('--my',`${Math.round(ev.clientY-r.top)}px`);});};
 document.addEventListener('pointermove',move,{passive:true});
 return()=>{document.removeEventListener('pointermove',move);if(frame)cancelAnimationFrame(frame);};
}
export function savedDesign():UiDesign{try{const v=localStorage.getItem(KEY);return UI_DESIGNS.some(d=>d.id===v)?v as UiDesign:'comic';}catch{return 'comic';}}
function paint(design:UiDesign){
 const root=document.documentElement;
 if(design==='comic')root.removeAttribute('data-ui');else root.setAttribute('data-ui',design);
 document.querySelector('meta[name=theme-color]')?.setAttribute('content',PAGE_COLOR[design]);
}
/** Switch the look with a short cross-fade (or instantly when the system asks for less motion). */
export function applyDesign(design:UiDesign){
 try{localStorage.setItem(KEY,design);}catch{/* the choice still applies to this visit */}
 if(document.documentElement.getAttribute('data-ui')===(design==='comic'?null:design))return;
 const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const doc=document as Document&{startViewTransition?:(cb:()=>void)=>unknown};
 if(still){paint(design);return;}
 if(doc.startViewTransition){doc.startViewTransition(()=>paint(design));return;}
 const root=document.documentElement;root.classList.add('ui-fading');paint(design);setTimeout(()=>root.classList.remove('ui-fading'),350);
}

export function UiSwitcher(){
 const [design,setDesign]=useState<UiDesign>(savedDesign),[open,setOpen]=useState(false);
 const box=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;
  const away=(e:PointerEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',away);document.addEventListener('keydown',key,true);
  box.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();
  return()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',key,true);};},[open]);
 // Another tab changed the look: follow it.
 useEffect(()=>{const sync=(e:StorageEvent)=>{if(e.key===KEY){const d=savedDesign();setDesign(d);paint(d);}};addEventListener('storage',sync);return()=>removeEventListener('storage',sync);},[]);
 useEffect(()=>{if(design!=='aurora'||matchMedia('(prefers-reduced-motion: reduce)').matches||matchMedia('(hover: none)').matches)return;return spotlight();},[design]);
 function choose(id:UiDesign){setDesign(id);applyDesign(id);setOpen(false);button.current?.focus();}
 function arrows(e:React.KeyboardEvent){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();
  const items=[...(box.current?.querySelectorAll<HTMLButtonElement>('.ui-option')||[])],at=items.indexOf(document.activeElement as HTMLButtonElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:items.length-1))%items.length;items[next]?.focus();
 }
 const current=UI_DESIGNS.find(d=>d.id===design)!;
 return <div className="ui-switch" ref={box}>
  <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} title="Change how OpenClip looks" onClick={()=>setOpen(o=>!o)}><Palette size={15} aria-hidden="true"/><span>{current.name}</span></button>
  {open&&<div className="ui-switch-menu" role="menu" aria-label="App design" onKeyDown={arrows}>
   <p>App design</p>
   {UI_DESIGNS.map(d=><button key={d.id} type="button" role="menuitemradio" aria-checked={d.id===design} className="ui-option" onClick={()=>choose(d.id)}>
    <span className={`ui-swatch ${d.id}`} aria-hidden="true"><i/><i/><i/></span>
    <span><strong>{d.name}</strong><small>{d.note}</small></span>
    {d.id===design?<Check size={16} aria-hidden="true"/>:<span/>}
   </button>)}
  </div>}
 </div>;
}

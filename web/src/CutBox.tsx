import {useRef} from 'react';
import {moveBox,resizeBox} from './cutlayout.mjs';

type Box=[number,number,number,number];
type Drag={mode:'move'|'nw'|'ne'|'sw'|'se';x:number;y:number;box:Box;w:number;h:number};
/**
 * A box over a video or preview that drags to move and resizes from its corners. Values are shares of the parent.
 * `ratio` keeps the shape (width / height in shares) while resizing. Updates are batched to one per animation frame.
 */
export default function CutBox({box,onChange,label,tone,ratio=null,resizable=true,selected=false,onSelect,lines}:{box:Box;onChange:(b:Box)=>void;label:string;tone:'cam'|'game'|'text';ratio?:number|null;resizable?:boolean;selected?:boolean;onSelect?:()=>void;lines?:number[]}){
 const drag=useRef<Drag|null>(null),frame=useRef(0),pending=useRef<Box|null>(null);
 const start=(mode:Drag['mode'])=>(e:React.PointerEvent)=>{e.preventDefault();e.stopPropagation();onSelect?.();const parent=(e.currentTarget as HTMLElement).closest('.cut-box-layer')!.getBoundingClientRect();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);drag.current={mode,x:e.clientX,y:e.clientY,box,w:parent.width,h:parent.height};};
 const move=(e:React.PointerEvent)=>{const d=drag.current;if(!d)return;const dx=(e.clientX-d.x)/d.w,dy=(e.clientY-d.y)/d.h;
  pending.current=d.mode==='move'?moveBox(d.box,dx,dy,{lines:lines||[0,.5,1]}) as Box:resizeBox(d.box,d.mode,dx,dy,{ratio,lines:lines||[0,1]}) as Box;
  if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;if(pending.current)onChange(pending.current);});};
 const end=(e:React.PointerEvent)=>{if(!drag.current)return;drag.current=null;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);if(frame.current){cancelAnimationFrame(frame.current);frame.current=0;}if(pending.current){onChange(pending.current);pending.current=null;}};
 // Arrow keys nudge the selected box (Shift for bigger steps), so boxes can be placed without a mouse.
 const key=(e:React.KeyboardEvent)=>{const step=e.shiftKey?.02:.004,d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(!d)return;e.preventDefault();e.stopPropagation();onChange(moveBox(box,d[0],d[1],{lines:[],snap:0}) as Box);};
 const pct=(v:number)=>`${(v*100).toFixed(3)}%`;
 return <div className={`cut-box ${tone} ${selected?'selected':''}`} style={{left:pct(box[0]),top:pct(box[1]),width:pct(box[2]),height:pct(box[3])}} role="slider" aria-label={`${label}: drag to move${resizable?', drag a corner to resize':''}, arrow keys to nudge`} aria-valuetext={`x ${Math.round(box[0]*100)}%, y ${Math.round(box[1]*100)}%, ${Math.round(box[2]*100)}% wide`} tabIndex={0} onKeyDown={key} onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
  <span className="cut-box-label">{label}</span>
  {resizable&&(['nw','ne','sw','se'] as const).map(c=><span key={c} className={`cut-box-handle ${c}`} onPointerDown={start(c)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>)}
 </div>;
}

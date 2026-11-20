import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type RefObject} from 'react';
import {Loader2,ScanFace,RotateCcw} from 'lucide-react';
import {stackPanels,defaultGameBox,coverRect,validBox,CARD,cardCamBox,zoomBox} from './logic.mjs';

type Box=[number,number,number,number];
export type Facecam={found:boolean;box:Box|null;full?:boolean;face?:Box|null}|null;
export type StackLayout={camBox:Box;gameBox:Box;top:number;card?:boolean;face?:Box|null;zooms?:[number,number][]};
type Value={camBox?:unknown;gameBox?:unknown;stackSplit?:unknown;[k:string]:unknown};
const FALLBACK_CAM:Box=[0,0,.25,.25];

/** The boxes and panel split the export will use (manual boxes win over the detected cam). Null when no cam is known. */
export function stackLayout(value:Value,facecam:Facecam,sourceAspect:number):StackLayout|null{
 const cam=validBox(value.camBox)?value.camBox as Box:facecam?.found&&validBox(facecam.box)?facecam.box as Box:null;if(!cam)return null;
 const card=value.stackStyle==='card',{top,bottom}=card?{top:1920-CARD.game.h,bottom:CARD.game.h}:stackPanels(cam,{split:typeof value.stackSplit==='number'?value.stackSplit:null,sourceAspect});
 const face=Array.isArray(facecam?.face)?facecam.face as Box:null;
 return {camBox:card?cardCamBox(cam,face,sourceAspect) as Box:cam,gameBox:validBox(value.gameBox)?value.gameBox as Box:defaultGameBox(bottom,sourceAspect) as Box,top,card,face:face&&face[0]>=cam[0]&&face[1]>=cam[1]&&face[0]+face[2]<=cam[0]+cam[2]&&face[1]+face[3]<=cam[1]+cam[3]?face:null};
}

/** Draw a frame of `video` as the stacked 9:16 layout. */
function paint(canvas:HTMLCanvasElement,video:HTMLVideoElement,layout:StackLayout,sourceAspect:number){
 const ctx=canvas.getContext('2d'),vw=video.videoWidth,vh=video.videoHeight;if(!ctx||!vw||!vh)return;
 const W=canvas.width,H=canvas.height,top=Math.round(H*layout.top/1920);
 const draw=(box:Box,y:number,h:number)=>{const [x,yy,w,hh]=coverRect(box,W/h,sourceAspect);ctx.drawImage(video,x*vw,yy*vh,w*vw,hh*vh,0,y,W,h);};
 try{
  if(layout.card){
   // Glow Card: blurred gameplay behind, the gameplay band, then the rounded cam with a glowing cream edge.
   const s=W/1080,{cam,game}=CARD;ctx.save();ctx.filter='blur(14px) brightness(0.92)';ctx.drawImage(video,0,0,vw,vh,-W*.4,0,W*1.8,H);ctx.restore();
   const gy=game.y*s,gh=game.h*s,[gx,gyy,gw,ghh]=coverRect(layout.gameBox,W/gh,sourceAspect);ctx.drawImage(video,gx*vw,gyy*vh,gw*vw,ghh*vh,0,gy,W,gh);
   const cx=cam.x*s,cy=cam.y*s,cw=cam.w*s,ch=cam.h*s,r=34*s,[x,y,w,h]=coverRect(layout.camBox,cam.w/cam.h,sourceAspect);
   ctx.save();ctx.beginPath();ctx.roundRect(cx,cy,cw,ch,r);ctx.clip();ctx.drawImage(video,x*vw,y*vh,w*vw,h*vh,cx,cy,cw,ch);ctx.restore();
   ctx.save();ctx.shadowColor='rgba(255,110,30,.9)';ctx.shadowBlur=18*s;ctx.strokeStyle='#fff1c4';ctx.lineWidth=16*s;ctx.beginPath();ctx.roundRect(cx-8*s,cy-8*s,cw+16*s,ch+16*s,r+8*s);ctx.stroke();ctx.restore();
  }else{
   // Cam Split reaction zooms (from the last export, source time): the cam panel cuts in tighter, as the export does.
   const t=video.currentTime,tight=layout.zooms?.some(([a,b])=>t>=a&&t<b);
   draw(tight?zoomBox(layout.camBox,layout.face||null) as Box:layout.camBox,0,top);draw(layout.gameBox,top,H-top);}
 }catch{/* frame not ready */}
}

/** Live stacked preview: a canvas painted from the (hidden) preview video every frame. */
export function StackCanvas({video,layout,sourceAspect}:{video:RefObject<HTMLVideoElement|null>;layout:StackLayout;sourceAspect:number}){
 const canvas=useRef<HTMLCanvasElement>(null),latest=useRef(layout);latest.current=layout;
 useEffect(()=>{let raf=0;const loop=()=>{const c=canvas.current,v=video.current;if(c&&v)paint(c,v,latest.current,sourceAspect);raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);},[video,sourceAspect]);
 return <canvas ref={canvas} width={540} height={960} className="stack-canvas" aria-label="Facecam on top, gameplay below"/>;
}

type Drag={kind:'cam'|'game';mode:'move'|'size';x:number;y:number;box:Box};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const round=(b:Box):Box=>b.map(v=>+v.toFixed(4)) as Box;

/**
 * Edit the two boxes on the source frame: drag a box to move it, drag its corner to resize. The gameplay box keeps the
 * bottom panel's shape so what you frame is what the export shows.
 */
export function StackEditor({video,sourceAspect,value,onChange,facecam,busy,onDetect}:{video:RefObject<HTMLVideoElement|null>;sourceAspect:number;value:Value;onChange:(v:Value)=>void;facecam:Facecam;busy:boolean;onDetect:()=>void}){
 const frame=useRef<HTMLCanvasElement>(null),area=useRef<HTMLDivElement>(null),[drag,setDrag]=useState<Drag|null>(null),active=useRef<Drag|null>(null);// the ref is read by pointer moves before React re-renders
 const layout=stackLayout(value,facecam,sourceAspect),cam=layout?.camBox||FALLBACK_CAM,{top,bottom}=stackPanels(cam,{split:typeof value.stackSplit==='number'?value.stackSplit:null,sourceAspect});
 const game=layout?.gameBox||defaultGameBox(bottom,sourceAspect) as Box,gameShape=sourceAspect*bottom/1080;// game h = w * gameShape
 // Show the current preview frame behind the boxes.
 useEffect(()=>{const v=video.current;if(!v)return;const draw=()=>{const c=frame.current;if(!c||!v.videoWidth)return;const ctx=c.getContext('2d');try{ctx?.drawImage(v,0,0,c.width,c.height);}catch{}};draw();const id=window.setInterval(draw,500);v.addEventListener('seeked',draw);v.addEventListener('loadeddata',draw);return()=>{window.clearInterval(id);v.removeEventListener('seeked',draw);v.removeEventListener('loadeddata',draw);};},[video]);
 function start(kind:'cam'|'game',mode:'move'|'size',e:ReactPointerEvent){e.preventDefault();e.stopPropagation();(e.target as Element).setPointerCapture?.(e.pointerId);active.current={kind,mode,x:e.clientX,y:e.clientY,box:kind==='cam'?cam:game};setDrag(active.current);}
 function stop(){active.current=null;setDrag(null);}
 function move(e:ReactPointerEvent){const drag=active.current;if(!drag||!area.current)return;const r=area.current.getBoundingClientRect(),dx=(e.clientX-drag.x)/r.width,dy=(e.clientY-drag.y)/r.height;let [x,y,w,h]=drag.box;
  if(drag.mode==='move'){x=clamp(x+dx,0,1-w);y=clamp(y+dy,0,1-h);}
  else if(drag.kind==='cam'){w=clamp(w+dx,.05,1-x);h=clamp(h+dy,.05,1-y);}
  else{w=clamp(w+dx,.1,1-x);h=w*gameShape;if(y+h>1){h=1-y;w=h/gameShape;}}
  onChange(drag.kind==='cam'?{...value,camBox:round([x,y,w,h])}:{...value,gameBox:round([x,y,w,h])});}
 const style=(b:Box)=>({left:`${b[0]*100}%`,top:`${b[1]*100}%`,width:`${b[2]*100}%`,height:`${b[3]*100}%`});
 const manual=validBox(value.camBox),status=busy?'Looking for the facecam…':manual?'Your facecam box':facecam?.found?'Facecam found automatically':facecam?.full?'The camera fills the frame here: nothing to stack. Center crop is used.':facecam?'No facecam found. Drag the yellow box onto the cam, or the export uses a center crop.':'The facecam is found when you export, or now:';
 const split=typeof value.stackSplit==='number'?value.stackSplit:null;
 return <div className="stack-editor">
  <div className="stack-status"><span>{status}</span>{busy?<Loader2 className="spin" size={14}/>:<button type="button" className="secondary small" onClick={onDetect}><ScanFace size={14}/>{facecam?'Find again':'Find facecam'}</button>}
   {(manual||validBox(value.gameBox)||split!==null)&&<button type="button" className="text-button" onClick={()=>onChange({...value,camBox:null,gameBox:null,stackSplit:null})}><RotateCcw size={14}/>Automatic</button>}</div>
  <div className="stack-source" ref={area} style={{aspectRatio:String(sourceAspect)}} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>
   <canvas ref={frame} width={640} height={Math.round(640/sourceAspect)}/>
   <div className={`stack-box game${drag?.kind==='game'?' dragging':''}`} style={style(game)} onPointerDown={e=>start('game','move',e)}><span>Gameplay</span><i aria-label="Resize gameplay box" onPointerDown={e=>start('game','size',e)}/></div>
   <div className={`stack-box cam${drag?.kind==='cam'?' dragging':''}${layout||manual?'':' guess'}`} style={style(cam)} onPointerDown={e=>start('cam','move',e)}><span>Facecam</span><i aria-label="Resize facecam box" onPointerDown={e=>start('cam','size',e)}/></div>
  </div>
  <label><span className="field-label">Facecam height · {split===null?`automatic (${Math.round(top/19.2)}%)`:`${Math.round(split*100)}%`}</span>
   <input type="range" aria-label="Facecam panel height" min={.25} max={.55} step={.01} value={split??top/1920} onChange={e=>onChange({...value,stackSplit:e.target.valueAsNumber})}/></label>
  <small>Drag a box to move it and its corner to resize. Gameplay keeps the shape of the bottom panel.</small>
 </div>;
}

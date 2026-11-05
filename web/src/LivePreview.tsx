import {useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import {Play,Pause,Eye,Film} from 'lucide-react';
import type {Word,Settings,Effect,Range,EngagementSettings} from './types';
import {clock,centerAt,cropBox,captionChunk,accentWord,toOutput,toSource,outputLength} from './logic.mjs';

/** On-video hook in the modern clipper look: heavy outlined capitals with one accent word. */
export function HookTitle({text,accent,fontFamily,className=''}:{text:string;accent:string;fontFamily?:string;className?:string}){
 const words=text.split(/\s+/).filter(Boolean),hit=accentWord(text);
 return <span className={`hook-title ${className}`} style={{fontFamily,'--hook-accent':accent} as CSSProperties}>{words.map((w,i)=><span key={i} className={i===hit?'accent':undefined}>{w}{i<words.length-1?' ':''}</span>)}</span>;
}

const CAPTION_TOP:Record<string,string>={lower:'68%',middle:'50%',center:'50%',upper:'36%'};
// Browser approximation of the reference caption styles in presets/captions.json (server/captions.mjs renders the export).
// fs = libass size in 1080-wide px; EM = CSS em per libass size unit (unitsPerEm / (winAscent+winDescent)); gw = width per char.
type Look={font:string;fs:number;fit?:number;words:number;textCase:'upper'|'lower';color:string;palette?:string[];rule?:'alternate'|'cycle'|'keywords';box?:string;outline?:number;shadow?:number;soft?:boolean;glow?:boolean;build?:boolean};
const EM:Record<string,number>={Anton:.577,'Montserrat ExtraBold':.64,'Work Sans':.691},GW:Record<string,number>={Anton:.28,'Montserrat ExtraBold':.52,'Work Sans':.47};
const RAINBOW=['#40F0F0','#FF8FA8','#39FF14','#A030FF','#FF2D2D','#2E7BFF','#FFFFFF'],NEON=['#3CFF3C','#FF2A2A','#F2FF2E','#2EF2FF','#FF2EFF'];
const LOOKS:Record<string,Look>={
 boxed:{font:'Anton',fs:180,fit:760,words:2,textCase:'upper',color:'#fff',palette:['#FFE600'],rule:'keywords',box:'#000'},
 'boxed-yellow':{font:'Anton',fs:180,fit:800,words:1,textCase:'upper',color:'#F2C60E',box:'#000'},
 facecam:{font:'Anton',fs:252,fit:760,words:1,textCase:'upper',color:'#fff',palette:['#FFFFFF','#FFF200'],rule:'alternate',outline:7,shadow:4},
 rainbow:{font:'Anton',fs:272,fit:800,words:1,textCase:'upper',color:'#fff',palette:RAINBOW,rule:'cycle',outline:6,shadow:5},
 'rainbow-rapid':{font:'Montserrat ExtraBold',fs:100,words:1,textCase:'upper',color:'#fff',palette:['#FF3D3D','#FFD21F','#FFFFFF','#E040FB'],rule:'cycle',outline:3,shadow:3},
 'neon-phrase':{font:'Montserrat ExtraBold',fs:94,fit:1000,words:6,textCase:'upper',color:'#fff',palette:NEON,rule:'keywords',soft:true,glow:true,build:true},
 lowercase:{font:'Work Sans',fs:118,words:1,textCase:'lower',color:'#FFD800',outline:3,shadow:3},
 'raw-small':{font:'Montserrat ExtraBold',fs:68,words:1,textCase:'upper',color:'#fff',outline:3,shadow:2}};
const STOP=new Set('a an the and or but of on in at to for with from by is are was were be been it its this that his her their my your our as up out off over into just have had does did'.split(' '));
// Same stable pick as server/captions.mjs so the `cycle` colours match the export.
const pick=(k:number,n:number,prev:number)=>{if(n<2)return 0;const r=Math.floor(Math.abs(Math.sin(k*12.9898+1)*43758.5453))%(prev<0?n:n-1);return prev>=0&&r>=prev?r+1:r;};
function wordColor(look:Look,words:Word[],k:number){const pal=look.palette||[look.color];
 if(look.rule==='alternate')return pal[k%pal.length];
 if(look.rule==='cycle'){let prev=-1;for(let i=0;i<=k;i++)prev=pick(i,pal.length,prev);return pal[prev];}
 if(look.rule==='keywords'){const size=look.words>=3?look.words:6,first=Math.floor(k/size)*size,phrase=words.slice(first,first+size).map(w=>w.text.replace(/[^\p{L}\p{N}']/gu,''));let hot=-1;phrase.forEach((b,i)=>{if(b.length>=4&&!STOP.has(b.toLowerCase())&&(hot<0||b.length>phrase[hot].length))hot=i;});return k-first===hot||/[!?]$/.test(words[k].text)?pal[Math.floor(k/size)%pal.length]:look.color;}
 return look.color;}
function ReferenceCaption({look,words,time,top,wide}:{look:Look;words:Word[];time:number;top:string;wide:boolean}){
 let i=words.length-1;while(i>=0&&words[i].start>time)i--;if(i<0||time>=words[i].end+.15)return null;const first=Math.floor(i/look.words)*look.words,shown=words.slice(first,look.build?i+1:first+look.words);
 const text=shown.map(w=>look.textCase==='upper'?w.text.toUpperCase():w.text.toLowerCase()),chars=Math.max(...text.map(t=>t.length),text.join(' ').length/(look.build?2:1));
 const fs=Math.min(look.fs,(look.fit||900)/(Math.max(1,Math.min(chars,28))*(GW[look.font]||.47))),unit=wide?1080/1920:1,em=(EM[look.font]||.65)*fs/10.8*unit,px=(n:number)=>`${(n/10.8*unit).toFixed(3)}cqw`;
 const hard=[look.shadow?`${px(look.shadow)} ${px(look.shadow)} 0 #000`:'',look.soft?`${px(3)} ${px(3)} ${px(8)} #00000080`:''].filter(Boolean);
 const style={top,fontFamily:`'${look.font}'`,fontSize:`${em.toFixed(3)}cqw`,textTransform:'none',lineHeight:look.box?1.15:1.08,textShadow:hard.join(',')||'none',WebkitTextStroke:look.outline?`${px(look.outline*2)} #000`:undefined,paintOrder:'stroke fill',textWrap:'balance'} as CSSProperties;
 return <div className="live-caption" style={style}><span style={look.box?{background:look.box,padding:`0 ${px(14)}`,boxDecorationBreak:'clone',WebkitBoxDecorationBreak:'clone'}:undefined}>{shown.map((w,j)=>{const c=wordColor(look,words,first+j),glow=look.glow&&c.toUpperCase()!==look.color.toUpperCase();return <span key={j} style={{color:c,textShadow:glow?`0 0 ${px(14)} ${c},${hard.join(',')||'0 0 0 transparent'}`:undefined}}>{text[j]}{j<shown.length-1?' ':''}</span>;})}</span></div>;
}
type Segment=Range&{outStart:number;part?:boolean};
type Phase={kind:'normal'}|{kind:'cold';until:number}|{kind:'hold';label:string}|{kind:'replay';until:number;label:string};

/**
 * Approximates the export over the source video: crop, framing, hook title, captions, and the edit itself —
 * cuts are skipped, extra parts follow, and freezes, replays, the cold open and on-screen effects play out.
 * `words` already carry caption corrections and exclude cut words.
 */
export default function LivePreview({video,src,segments,words,settings,hook,sourceAspect,samples,fontFamily,accent,effects=[],coldOpenAt}:{video:RefObject<HTMLVideoElement|null>;src:string;segments:Segment[];words:Word[];settings:Partial<Settings>&EngagementSettings;hook:string;sourceAspect:number;samples:{time:number;centerX:number}[];fontFamily?:string;accent:string;effects?:Effect[];coldOpenAt?:number}){
 const [time,setTime]=useState(segments[0]?.start??0),[playing,setPlaying]=useState(false),[mode,setMode]=useState<'edited'|'original'>('edited'),[phase,setPhase]=useState<Phase>({kind:'normal'}),[rewind,setRewind]=useState(false);
 const raf=useRef(0),seg=useRef(0),done=useRef(new Set<string>()),last=useRef(0),phaseRef=useRef<Phase>({kind:'normal'}),holding=useRef(false),timer=useRef(0);
 const first=segments[0],total=outputLength(segments);
 const setP=(p:Phase)=>{phaseRef.current=p;setPhase(p);};
 // Refs so the playback loop always sees the latest edit without restarting.
 const live=useRef({segments,effects,settings,coldOpenAt,mode});live.current={segments,effects,settings,coldOpenAt,mode};
 useEffect(()=>{const v=video.current;if(!v)return;
  const restart=()=>{const {segments:s,settings:o,coldOpenAt:c}=live.current;seg.current=0;done.current.clear();v.playbackRate=1;if(o.coldOpen&&Number.isFinite(c)){const len=Number(o.coldOpenSeconds??1.6);v.currentTime=Math.max(0,c!-len*.6);setP({kind:'cold',until:c!+len*.4});}else{v.currentTime=s[0]?.start??0;setP({kind:'normal'});}last.current=v.currentTime;};
  const tick=()=>{const {segments:s,effects:fx,mode:m}=live.current,t=v.currentTime,p=phaseRef.current;setTime(t);
   if(m==='edited'&&s.length&&!holding.current){
    if(p.kind==='cold'){if(t>=p.until){setRewind(true);window.setTimeout(()=>setRewind(false),380);v.currentTime=s[0].start;seg.current=0;setP({kind:'normal'});}}
    else if(p.kind==='replay'){if(t>=p.until){v.playbackRate=1;setP({kind:'normal'});}}
    else{
     let cur=s[seg.current];if(!cur||t<cur.start-.35||t>cur.end+.35){const i=s.findIndex(x=>t>=x.start-.05&&t<x.end);seg.current=i<0?0:i;cur=s[seg.current];}
     for(const e of fx){if(done.current.has(e.id)||e.at<cur.start||e.at>cur.end)continue;
      if(e.type==='freeze'&&last.current<e.at&&t>=e.at){done.current.add(e.id);holding.current=true;v.pause();setP({kind:'hold',label:e.text||'WAIT FOR IT…'});timer.current=window.setTimeout(()=>{holding.current=false;setP({kind:'normal'});v.play().catch(()=>{});},Number(e.duration??.9)*1000);break;}
      const d=Number(e.duration??2),endAt=e.at+d*.25;
      if(e.type==='replay'&&last.current<endAt&&t>=endAt){done.current.add(e.id);v.currentTime=Math.max(cur.start,e.at-d*.75);v.playbackRate=.6;setP({kind:'replay',until:endAt,label:e.text||'REPLAY'});break;}
     }
     if(!holding.current&&phaseRef.current.kind==='normal'&&t>=cur.end-.02){if(seg.current<s.length-1){seg.current++;v.currentTime=s[seg.current].start;}else{v.pause();restart();}}
    }
   }
   last.current=v.currentTime;raf.current=requestAnimationFrame(tick);};
  const play=()=>{setPlaying(true);cancelAnimationFrame(raf.current);const {segments:s,mode:m}=live.current;if(m==='edited'&&!holding.current&&s.length){const t=v.currentTime,inside=s.some(x=>t>=x.start-.05&&t<x.end-.05);if(!inside||Math.abs(t-s[0].start)<.06)restart();}last.current=v.currentTime;raf.current=requestAnimationFrame(tick);};
  const pause=()=>{if(holding.current)return;setPlaying(false);cancelAnimationFrame(raf.current);setTime(v.currentTime);};
  const sync=()=>setTime(v.currentTime);
  v.addEventListener('play',play);v.addEventListener('pause',pause);v.addEventListener('seeked',sync);v.addEventListener('loadedmetadata',sync);
  return()=>{cancelAnimationFrame(raf.current);window.clearTimeout(timer.current);v.removeEventListener('play',play);v.removeEventListener('pause',pause);v.removeEventListener('seeked',sync);v.removeEventListener('loadedmetadata',sync);};},[video]);
 const wide=settings.outputFormat==='video',frameAspect=wide?16/9:9/16,framing=String(settings.framing||'center');
 const contained=framing==='fit'||framing==='editorial',center=typeof settings.cropX==='number'?settings.cropX:framing==='face'?centerAt(samples,time):.5,box=cropBox(sourceAspect,frameAspect,center);
 const active=(e:Effect,len:number)=>time>=e.at&&time<e.at+len,fx=mode==='edited'&&phase.kind!=='cold'?effects:[];
 const zoom=fx.find(e=>e.type==='zoom'&&active(e,Number(e.duration??.5))),shake=fx.some(e=>e.type==='shake'&&active(e,Number(e.duration??.4))),flash=fx.find(e=>e.type==='flash'&&active(e,Number(e.duration??.3))),pop=fx.find(e=>e.type==='pop'&&active(e,.9));
 const zoomScale=zoom?1+.18*Math.sin(Math.PI*Math.min(1,(time-zoom.at)/Number(zoom.duration??.5))):1;
 const videoStyle:CSSProperties=mode==='original'?{}:contained?{position:'absolute',left:0,width:'100%',top:framing==='editorial'?'26%':'50%',height:'auto',transform:framing==='editorial'?undefined:'translateY(-50%)'}:{position:'absolute',top:0,height:'100%',width:`${box.width}%`,left:`${box.left}%`,maxWidth:'none',objectFit:'cover'};
 const out=toOutput(time,segments),elapsed=out??0,showHook=settings.hookEnabled!==false&&!!hook&&phase.kind!=='cold'&&(settings.titleMode==='persistent'||elapsed<Number(settings.hookDuration||2.8)),chunk=settings.captionsEnabled===false||phase.kind==='cold'?null:captionChunk(words,time);
 // Reference styles use their own font unless a caption font is chosen (fontFamily is then the user's pick).
 const captionTop=CAPTION_TOP[String(settings.captionPosition||'lower')]||'68%',base=LOOKS[String(settings.style||'')],look=base&&settings.font&&settings.font!=='auto'&&fontFamily?{...base,font:fontFamily}:base;
 function toggle(){const v=video.current;if(!v)return;if(v.paused&&!holding.current)v.play().catch(()=>{});else{holding.current=false;window.clearTimeout(timer.current);setP({kind:'normal'});v.pause();}}
 function seek(o:number){const t=toSource(o,segments);if(video.current){video.current.currentTime=t;video.current.playbackRate=1;}seg.current=Math.max(0,segments.findIndex(s=>t>=s.start&&t<=s.end));setP({kind:'normal'});setTime(t);}
 const label=phase.kind==='hold'||phase.kind==='replay'?phase.label:phase.kind==='cold'?'Cold open':'';
 return <div className="live-preview">
  <div className="live-mode" role="radiogroup" aria-label="Preview mode"><button type="button" role="radio" aria-checked={mode==='edited'} className={mode==='edited'?'chosen':''} onClick={()=>setMode('edited')}><Eye size={14}/>As edited</button><button type="button" role="radio" aria-checked={mode==='original'} className={mode==='original'?'chosen':''} onClick={()=>setMode('original')}><Film size={14}/>Original</button></div>
  <div className={`live-frame ${mode} framing-${framing} ${wide?'wide':'tall'} ${shake&&mode==='edited'?'is-shaking':''} ${phase.kind==='hold'?'is-frozen':''}`} style={mode==='edited'?{aspectRatio:String(frameAspect)}:undefined}>
   <div className="live-zoom" style={mode==='edited'&&zoomScale!==1?{transform:`scale(${zoomScale.toFixed(3)})`}:undefined}><video ref={video} src={src} style={videoStyle} controls={mode==='original'} playsInline preload="metadata" onLoadedMetadata={()=>{if(video.current&&first&&video.current.currentTime<first.start)video.current.currentTime=first.start;}}/></div>
   {mode==='edited'&&<>{showHook&&<div className={settings.hookPosition==='middle'?'live-hook middle':'live-hook'}><HookTitle text={hook} accent={accent} fontFamily={fontFamily}/></div>}{settings.seriesLabel&&<span className="live-series">{String(settings.seriesLabel)}</span>}
    {look&&settings.captionsEnabled!==false&&phase.kind!=='cold'&&<ReferenceCaption look={look} words={words} time={time} top={captionTop} wide={wide}/>}
    {settings.watermark&&<div aria-hidden="true" style={{position:'absolute',left:0,right:0,top:`${(Number(settings.watermarkY??.82)*100).toFixed(1)}%`,transform:'translateY(-50%)',textAlign:'center',fontFamily:`'${look?.font||'Work Sans'}'`,fontWeight:700,fontSize:`${((EM[look?.font||'Work Sans']||.65)*(wide?30/19.2:38/10.8)).toFixed(3)}cqw`,color:'#ffffff73',WebkitTextStroke:`${(wide?2/19.2:2/10.8).toFixed(3)}cqw #0000004c`,paintOrder:'stroke fill',pointerEvents:'none',zIndex:1}}>{String(settings.watermark)}</div>}
    {chunk&&!look&&<div className="live-caption" style={{top:captionTop,fontFamily,'--hook-accent':accent} as CSSProperties}>{chunk.words.map((w:{text:string;active:boolean},i:number)=><span key={i} className={w.active?'active':undefined}>{w.text}{i<chunk.words.length-1?' ':''}</span>)}</div>}
    {pop&&<div className="live-pop" key={pop.id} style={{fontFamily,'--hook-accent':accent} as CSSProperties}>{pop.emoji&&<span className="live-pop-emoji">{pop.emoji}</span>}{pop.text||'!!'}</div>}
    {label&&<div className={`live-label phase-${phase.kind}`}>{label}</div>}
    {flash&&<i className="live-flash" style={{opacity:Math.max(0,1-(time-flash.at)/Number(flash.duration??.3))}}/>}{rewind&&<i className="live-rewind"/>}
    <span className="live-badge">Preview</span></>}
  </div>
  {mode==='edited'&&<div className="live-controls"><button type="button" className="icon-button" onClick={toggle} aria-label={playing?'Pause preview':'Play preview'}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><input type="range" aria-label="Preview position" min={0} max={Math.max(.1,total)} step={0.05} value={Math.min(total,Math.max(0,elapsed))} onChange={e=>seek(e.target.valueAsNumber)}/><span className="live-time">{clock(elapsed)} / {clock(total)}</span></div>}
 </div>;
}

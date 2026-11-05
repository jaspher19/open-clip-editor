import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {ZoomIn,Vibrate,Zap,Snowflake,Rewind,Type,Volume2,Trash2,Play,Undo2,Redo2,Keyboard,Plus,X,Scissors,Asterisk} from 'lucide-react';
import type {Effect,EffectType,Range,Sound,Settings,EngagementSettings} from './types';
import {clock,toOutput,toSource,outputLength,EFFECT_DEFAULTS,EFFECT_LIMITS,historyPush,historyUndo,historyRedo} from './logic.mjs';

type Segment=Range&{outStart:number;part?:boolean};
type Value=Partial<Settings>&EngagementSettings;

export const EFFECT_INFO:Record<EffectType,{label:string;key:string;hint:string;Icon:typeof ZoomIn}>={
 zoom:{label:'Zoom',key:'Z',hint:'Quick punch-in on the moment',Icon:ZoomIn},
 shake:{label:'Shake',key:'S',hint:'Camera shake on a hit',Icon:Vibrate},
 flash:{label:'Flash',key:'F',hint:'White flash that fades out',Icon:Zap},
 freeze:{label:'Freeze',key:'',hint:'Hold the frame with a label',Icon:Snowflake},
 replay:{label:'Replay',key:'R',hint:'Slow-motion instant replay',Icon:Rewind},
 pop:{label:'Pop text',key:'P',hint:'Big word pops on screen',Icon:Type},
 sfx:{label:'Sound',key:'',hint:'Just a sound effect',Icon:Volume2},
 label:{label:'Action label',key:'',hint:'*ACTION* label that flashes red, then white',Icon:Asterisk},
};
const ORDER:EffectType[]=['zoom','shake','flash','freeze','replay','pop','label','sfx'];
// Default sound per effect, picked by name from whatever the server bundles.
const SOUND_HINTS:Partial<Record<EffectType,string[]>>={zoom:['whoosh','swoosh'],shake:['boom','slam','hit'],flash:['hit','impact'],freeze:['scratch','record','stop'],replay:['rewind','whoosh'],pop:['pop','plop'],sfx:['boom','pop']};
export function defaultSound(type:EffectType,sounds:Sound[]){for(const hint of SOUND_HINTS[type]||[]){const s=sounds.find(x=>x.id.toLowerCase().includes(hint));if(s)return s.id;}return '';}
export function newEffect(type:EffectType,at:number,sounds:Sound[],extra:Partial<Effect>={}):Effect{return {id:crypto.randomUUID(),type,at:Number(at.toFixed(2)),...EFFECT_DEFAULTS[type],sound:defaultSound(type,sounds),...extra};}

/** Undo/redo over one editor document. `set(patch, key)` coalesces rapid changes with the same key (typing, dragging). */
export function useUndo<T>(initial:T){
 const [h,setH]=useState({past:[] as T[],present:initial,future:[] as T[],key:'',at:0});
 const set=useCallback((patch:Partial<T>|((d:T)=>Partial<T>),key='')=>setH(old=>historyPush(old,{...old.present,...(typeof patch==='function'?patch(old.present):patch)},{key})),[]);
 return {doc:h.present,set,undo:()=>setH(historyUndo),redo:()=>setH(historyRedo),canUndo:h.past.length>0,canRedo:h.future.length>0};
}

export function UndoBar({canUndo,canRedo,onUndo,onRedo}:{canUndo:boolean;canRedo:boolean;onUndo:()=>void;onRedo:()=>void}){
 return <div className="undo-bar"><button type="button" className="icon-button small" disabled={!canUndo} onClick={onUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={16}/></button><button type="button" className="icon-button small" disabled={!canRedo} onClick={onRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={16}/></button></div>;
}

export function ShortcutsHelp(){
 const rows=[['Space','Play / pause'],['I / O','Set start / end at the playhead'],['X','Cut the selected words'],['Z S F R P','Add zoom, shake, flash, replay, pop text at the playhead'],['Delete','Remove the selected effect'],['← →','Move the playhead 0.1 s (Shift: 1 s)'],['Ctrl+Z / Ctrl+Shift+Z','Undo / redo']];
 return <details className="shortcuts-help"><summary><Keyboard size={15}/>Keyboard shortcuts</summary><dl>{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details>;
}

/** The current video time, refreshed while it plays. */
function usePlayhead(video:RefObject<HTMLVideoElement|null>){
 const [t,setT]=useState(0);
 useEffect(()=>{const v=video.current;if(!v)return;let raf=0;const tick=()=>{setT(v.currentTime);raf=requestAnimationFrame(tick);};const sync=()=>setT(v.currentTime);const play=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(tick);},stop=()=>{cancelAnimationFrame(raf);sync();};
  v.addEventListener('play',play);v.addEventListener('pause',stop);v.addEventListener('seeked',sync);sync();return()=>{cancelAnimationFrame(raf);v.removeEventListener('play',play);v.removeEventListener('pause',stop);v.removeEventListener('seeked',sync);};},[video]);
 return t;
}

/** Effects on the edited clip's own timeline: add at the playhead, drag to move, click to edit. */
export function EffectsLane({video,segments,effects,beats,autoOn,selected,sounds,onSelect,onChange}:{video:RefObject<HTMLVideoElement|null>;segments:Segment[];effects:Effect[];beats:number[];autoOn:boolean;selected:string|null;sounds:Sound[];onSelect:(id:string|null)=>void;onChange:(effects:Effect[],key?:string)=>void}){
 const lane=useRef<HTMLDivElement>(null),drag=useRef<{id:string;moved:boolean}|null>(null),t=usePlayhead(video),total=Math.max(.1,outputLength(segments)),pct=(o:number)=>`${Math.min(100,Math.max(0,o/total*100))}%`;
 const head=toOutput(t,segments);
 const fromPointer=(x:number)=>{const r=lane.current!.getBoundingClientRect();return toSource(Math.min(total,Math.max(0,(x-r.left)/r.width*total)),segments);};
 function add(type:EffectType){const at=video.current?.currentTime??segments[0]?.start??0;const e=newEffect(type,toOutput(at,segments)===null?(segments[0]?.start??at):at,sounds);onChange([...effects,e]);onSelect(e.id);}
 const current=effects.find(e=>e.id===selected);
 return <section className="effects-lane" aria-label="Effects">
  <div className="effects-toolbar"><span className="field-label">Add at playhead</span>{ORDER.map(type=>{const {label,key,hint,Icon}=EFFECT_INFO[type];return <button type="button" key={type} className={`effect-add fx-${type}`} title={`${hint}${key?` (${key})`:''}`} onClick={()=>add(type)}><Icon size={14}/>{label}</button>;})}</div>
  <div ref={lane} className="effects-track" onPointerDown={e=>{if(e.target===e.currentTarget&&video.current){video.current.currentTime=fromPointer(e.clientX);onSelect(null);}}}>
   {segments.slice(1).map((s,i)=><i key={i} className={`segment-join ${s.part?'part':''}`} style={{left:pct(s.outStart)}} title={s.part?'Extra part starts':'Cut'}/>)}
   {autoOn&&beats.map((b,i)=><i key={i} className="auto-beat" style={{left:pct(b)}} title="Automatic accent"/>)}
   {effects.map(e=>{const o=toOutput(e.at,segments);if(o===null)return null;const {Icon,label}=EFFECT_INFO[e.type];const width=e.duration&&e.type!=='sfx'?`${Math.max(.6,e.duration/total*100)}%`:undefined;
    return <button type="button" key={e.id} className={`effect-marker fx-${e.type} ${selected===e.id?'selected':''}`} style={{left:pct(o),width}} aria-label={`${label} at ${clock(o)}`} title={`${label} · ${clock(o)} · drag to move`}
     onPointerDown={ev=>{ev.stopPropagation();ev.currentTarget.setPointerCapture(ev.pointerId);drag.current={id:e.id,moved:false};onSelect(e.id);}}
     onPointerMove={ev=>{if(drag.current?.id!==e.id)return;drag.current.moved=true;const at=Number(fromPointer(ev.clientX).toFixed(2));onChange(effects.map(x=>x.id===e.id?{...x,at}:x),`drag-${e.id}`);}}
     onPointerUp={()=>{if(drag.current&&!drag.current.moved&&video.current)video.current.currentTime=e.at;drag.current=null;}}><Icon size={13}/></button>;})}
   {head!==null&&<i className="lane-playhead" style={{left:pct(head)}}/>}
  </div>
  <div className="lane-scale"><span>0:00</span><span>{autoOn?'Faded ticks: automatic accents':'Automatic accents off'}</span><span>{clock(total)}</span></div>
  {current?<EffectInspector effect={current} sounds={sounds} segments={segments} onChange={e=>onChange(effects.map(x=>x.id===e.id?e:x),`edit-${e.id}`)} onDelete={()=>{onChange(effects.filter(x=>x.id!==current.id));onSelect(null);}} onClose={()=>onSelect(null)}/>:<p className="lane-hint">{effects.length?`${effects.length} effect${effects.length===1?'':'s'}. Click one to edit it, or drag it along the lane.`:'Play to the moment, then add an effect. In the transcript, “Pop word” turns any word into pop text.'}</p>}
 </section>;
}

function playSound(id:string){if(!id)return;const a=new Audio(`/api/sounds/${id}`);a.volume=.8;a.play().catch(()=>{});}
export function SoundSelect({value,sounds,onChange,label='Sound'}:{value:string;sounds:Sound[];onChange:(v:string)=>void;label?:string}){
 const groups=[...new Set(sounds.map(s=>s.group))];
 return <div className="sound-select"><label><span className="field-label">{label}</span><select aria-label={label} value={value} onChange={e=>{onChange(e.target.value);playSound(e.target.value);}}><option value="">None</option>{groups.map(g=><optgroup key={g} label={g}>{sounds.filter(s=>s.group===g).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}</select></label><button type="button" className="icon-button small" disabled={!value} aria-label="Play sound" title="Play sound" onClick={()=>playSound(value)}><Play size={14}/></button>{!sounds.length&&<small>Sounds load when the server is updated.</small>}</div>;
}

function EffectInspector({effect,sounds,segments,onChange,onDelete,onClose}:{effect:Effect;sounds:Sound[];segments:Segment[];onChange:(e:Effect)=>void;onDelete:()=>void;onClose:()=>void}){
 const {label,hint,Icon}=EFFECT_INFO[effect.type],limits=EFFECT_LIMITS[effect.type as keyof typeof EFFECT_LIMITS] as number[]|undefined,o=toOutput(effect.at,segments);
 return <div className={`effect-inspector fx-${effect.type}`}><div className="inspector-head"><strong><Icon size={16}/>{label}</strong><span>{o===null?'Inside a cut — not shown':`at ${clock(o)}`} · {hint}</span><button type="button" className="icon-button small" aria-label="Close effect" onClick={onClose}><X size={15}/></button></div>
  <div className="inspector-fields">
   {limits&&<label><span className="field-label">{effect.type==='replay'?'Replayed seconds':'Length'} · {Number(effect.duration??limits[0]).toFixed(2)} s</span><input type="range" aria-label={`${label} length`} min={limits[0]} max={limits[1]} step={.05} value={effect.duration??limits[0]} onChange={e=>onChange({...effect,duration:e.target.valueAsNumber})}/></label>}
   {(effect.type==='pop'||effect.type==='freeze'||effect.type==='replay'||effect.type==='label')&&<label><span className="field-label">{effect.type==='pop'?'Pop text':effect.type==='label'?'Action · shown as *TEXT*':'Label'}</span><input aria-label={effect.type==='pop'?'Pop text':`${label} label`} maxLength={24} value={effect.text||''} placeholder={effect.type==='label'?'GETS FAT':effect.type==='freeze'?'WAIT FOR IT…':effect.type==='replay'?'REPLAY':'NO WAY'} onChange={e=>onChange({...effect,text:e.target.value,auto:undefined})}/></label>}
   {effect.type==='pop'&&<label><span className="field-label">Emoji · optional</span><input aria-label="Pop emoji" maxLength={4} value={effect.emoji||''} placeholder="😭" onChange={e=>onChange({...effect,emoji:e.target.value})}/></label>}
   <SoundSelect value={effect.sound||''} sounds={sounds} onChange={sound=>onChange({...effect,sound})}/>
  </div>
  <button type="button" className="text-button danger-text" onClick={onDelete}><Trash2 size={14}/>Remove effect</button></div>;
}

/** Cut ranges and extra parts, listed under the transcript. */
export function CutsAndParts({cuts,parts,words,onRestore,onParts,playhead,ClockInput}:{cuts:Range[];parts:Range[];words:{start:number;end:number;text:string}[];onRestore:(i:number)=>void;onParts:(p:Range[],key?:string)=>void;playhead:()=>number;ClockInput:(p:{label:string;value:number;onChange:(v:number)=>void;onPlayhead:()=>void})=>React.ReactElement}){
 const said=(r:Range)=>{const t=words.filter(w=>w.start>=r.start-.01&&w.end<=r.end+.01).map(w=>w.text).join(' ');return t.length>60?t.slice(0,57)+'…':t;};
 return <div className="cuts-parts">
  {cuts.length>0&&<div className="cut-list"><span className="field-label"><Scissors size={13}/>Cut out · {cuts.reduce((n,c)=>n+c.end-c.start,0).toFixed(1)} s</span>{cuts.map((c,i)=><div key={i} className="cut-row"><span>{clock(c.start)}–{clock(c.end)}</span><em>“{said(c)||'…'}”</em><button type="button" className="text-button" onClick={()=>onRestore(i)}>Restore</button></div>)}</div>}
  <div className="part-list"><span className="field-label">Extra parts · play after the clip</span>{parts.map((p,i)=><div key={i} className="part-row"><strong>Part {i+2}</strong><ClockInput label="From" value={p.start} onChange={v=>onParts(parts.map((x,k)=>k===i?{...x,start:v}:x),`part-${i}`)} onPlayhead={()=>onParts(parts.map((x,k)=>k===i?{...x,start:Number(playhead().toFixed(2))}:x))}/><ClockInput label="To" value={p.end} onChange={v=>onParts(parts.map((x,k)=>k===i?{...x,end:v}:x),`part-${i}`)} onPlayhead={()=>onParts(parts.map((x,k)=>k===i?{...x,end:Number(playhead().toFixed(2))}:x))}/><em>{p.end-p.start<2||p.end-p.start>30?'Each part must be 2–30 seconds':`“${said(p)||'…'}”`}</em><button type="button" className="icon-button small" aria-label={`Remove part ${i+2}`} onClick={()=>onParts(parts.filter((_,k)=>k!==i))}><Trash2 size={14}/></button></div>)}
   {parts.length<3&&<button type="button" className="text-button" onClick={()=>{const t=playhead();onParts([...parts,{start:Number(t.toFixed(2)),end:Number((t+6).toFixed(2))}]);}}><Plus size={14}/>Add another part from the playhead</button>}
   <small>Tip: in Cut mode, select words outside the clip and choose “Add as a part” — good for joining a setup and its payoff.</small></div>
 </div>;
}

type Music={name:string;label:string};
/** Cold open, loop ending, swear words, automatic effects, manual crop and music. */
export function EngagementControls({value,onChange,playhead,show}:{value:Value;onChange:(v:Value)=>void;playhead:()=>number;show:'quick'|'advanced'}){
 const tall=value.outputFormat!=='video'&&value.framing!=='fit'&&value.framing!=='editorial';
 if(show==='quick')return <div className="engage-controls">
  <label className="check-option"><input type="checkbox" checked={!!value.coldOpen} onChange={e=>onChange({...value,coldOpen:e.target.checked})}/>Cold open · start with the payoff, then rewind</label>
  {!!value.coldOpen&&<div className="engage-sub"><label><span className="field-label">Teaser length · {Number(value.coldOpenSeconds??1.6).toFixed(1)} s</span><input type="range" aria-label="Cold open seconds" min={1} max={3} step={.1} value={Number(value.coldOpenSeconds??1.6)} onChange={e=>onChange({...value,coldOpenSeconds:e.target.valueAsNumber})}/></label><div className="engage-row"><button type="button" className="secondary small" onClick={()=>onChange({...value,coldOpenAt:Number(playhead().toFixed(2))})}>Payoff is at the playhead</button><span>{value.coldOpenAt!=null?`Payoff at ${clock(Number(value.coldOpenAt))}`:'Payoff: first replay, else the loudest moment'}</span>{value.coldOpenAt!=null&&<button type="button" className="text-button" onClick={()=>onChange({...value,coldOpenAt:null})}>Automatic</button>}</div></div>}
  <label className="check-option"><input type="checkbox" checked={value.autoEffects!==false} onChange={e=>onChange({...value,autoEffects:e.target.checked})}/>Automatic effects · zooms and accents on speech beats</label>
 </div>;
 return <div className="engage-controls">
  <label className="check-option"><input type="checkbox" checked={!!value.loopEnding} onChange={e=>onChange({...value,loopEnding:e.target.checked})}/>Loop ending · end tight so the Short replays smoothly</label>
  <fieldset className="segmented"><legend className="field-label">Swear words in the audio</legend>{([['keep','Keep'],['beep','Beep'],['mute','Mute']] as const).map(([v,l])=><label key={v} className={(value.profanityAudio||'keep')===v?'chosen':''}><input type="radio" name="profanity-audio" checked={(value.profanityAudio||'keep')===v} onChange={()=>onChange({...value,profanityAudio:v})}/>{l}</label>)}</fieldset>
  {tall&&<div className="crop-control"><label><span className="field-label">Crop position · {value.cropX==null?'automatic':`${Math.round(Number(value.cropX)*100)}% from left`}</span><input type="range" aria-label="Manual crop position" min={0} max={1} step={.01} value={value.cropX==null?.5:Number(value.cropX)} onChange={e=>onChange({...value,cropX:e.target.valueAsNumber})}/></label>{value.cropX!=null&&<button type="button" className="text-button" onClick={()=>onChange({...value,cropX:null})}>Reset to automatic</button>}<small>Use this when face tracking misses a mask or helmet. It overrides the framing for the whole clip.</small></div>}
 </div>;
}

export function MusicLibrary({value,onChange,musicName,uploading,onUpload}:{value:Value;onChange:(v:Value)=>void;musicName:string;uploading:boolean;onUpload:(f?:File)=>void}){
 const [tracks,setTracks]=useState<Music[]|null>(null);
 useEffect(()=>{fetch('/api/music').then(r=>r.ok?r.json():[]).then(d=>{const list=Array.isArray(d)?d:d?.tracks||[];setTracks(list.map((t:string|{name?:string;file?:string;label?:string;title?:string})=>typeof t==='string'?{name:t,label:t}:{name:String(t.name||t.file||''),label:String(t.label||t.title||t.name||t.file||'')}).filter((t:Music)=>t.name));}).catch(()=>setTracks([]));},[]);
 const track=String(value.musicTrack||'');
 return <div className="music-controls"><span className="field-label">Background music · optional</span>
  {!!tracks?.length&&<label><span className="field-label">From your music library</span><select aria-label="Music track" value={track} onChange={e=>onChange({...value,musicTrack:e.target.value,musicEnabled:!!e.target.value||(!!musicName&&!!value.musicEnabled)})}><option value="">{musicName?`This project’s track · ${musicName}`:'None'}</option>{tracks.map(t=><option key={t.name} value={t.name}>{t.label}</option>)}</select></label>}
  <input aria-label="Upload background music" type="file" accept=".mp3,.wav,.m4a,.ogg,.flac" disabled={uploading} onChange={e=>onUpload(e.target.files?.[0])}/>
  <small>{uploading?'Uploading…':musicName?`Project track: ${musicName}`:'Choose a local track. Speech ducks the music automatically.'}</small>
  <label className="check-option"><input type="checkbox" checked={!!value.musicEnabled} disabled={(!musicName&&!track)||uploading} onChange={e=>onChange({...value,musicEnabled:e.target.checked})}/>Use background music</label>
  <label><span className="field-label">Music level</span><select aria-label="Music level" value={Number(value.musicVolume??-29)} onChange={e=>onChange({...value,musicVolume:Number(e.target.value)})}><option value={-32}>Subtle</option><option value={-29}>Balanced</option><option value={-26}>Present</option></select></label></div>;
}

export function TitleChips({options,current,onPick}:{options:string[];current:string;onPick:(t:string)=>void}){
 const list=[...new Set(options.filter(Boolean))];if(!list.length)return null;
 return <div className="title-chips" role="group" aria-label="Title options"><span className="field-label">Title options</span>{list.map(t=><button type="button" key={t} className={t===current?'chosen':''} aria-pressed={t===current} onClick={()=>onPick(t)}>{t}</button>)}</div>;
}

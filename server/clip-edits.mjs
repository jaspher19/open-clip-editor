// Moment and VFX edits saved on a clip (docs/EDIT-CONTRACT.md). All times are source seconds.
export const EFFECT_TYPES=['zoom','shake','flash','freeze','replay','sfx','pop','label'];
const DURATIONS={freeze:[.4,2,.9],replay:[1,4,2],zoom:[.15,1.5,.5],shake:[.15,1.5,.5],flash:[.15,1.5,.3],sfx:[.15,1.5,.5],pop:[.15,1.5,.9],label:[.4,2,.9]};
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const num=v=>typeof v==='number'&&Number.isFinite(v);
const round=v=>+v.toFixed(3);
const overlap=(a,b)=>Math.min(a.end,b.end)-Math.max(a.start,b.start)>1e-6;

function ranges(list,label,max){
 if(!Array.isArray(list))fail(`${label} must be a list`);if(list.length>max)fail(`Use at most ${max} ${label}`);
 return list.map(r=>{if(!r||!num(r.start)||!num(r.end)||r.end<=r.start)fail(`Each ${label.replace(/s$/,'')} needs a start before its end`);return {start:round(r.start),end:round(r.end)};}).sort((a,b)=>a.start-b.start);
}
/** Seconds of output for a source range, its cuts and extra parts (cuts are clipped to the range). */
export function outputLength(start,end,cuts=[],parts=[]){
 const removed=cuts.reduce((s,c)=>s+Math.max(0,Math.min(end,c.end)-Math.max(start,c.start)),0);
 return end-start-removed+parts.reduce((s,p)=>s+p.end-p.start,0);
}

/** Validate the edit fields present in `body` against the clip's range; returns only those fields, cleaned. */
export function validateClipEdits(body,clip,{duration=Infinity}={}){
 const out={},start=clip.start,end=clip.end;
 if(body.cuts!==undefined){
  const cuts=ranges(body.cuts,'cuts',40);
  cuts.forEach((c,i)=>{if(c.end-c.start<.1)fail('Each cut must be at least 0.1 seconds');if(c.start<start-.01||c.end>end+.01)fail('Cuts must sit inside the clip');if(i&&c.start<cuts[i-1].end)fail('Cuts must not overlap');});
  if(outputLength(start,end,cuts)<1)fail('The cuts remove the whole clip');
  out.cuts=cuts;
 }
 if(body.parts!==undefined){
  const parts=ranges(body.parts,'parts',3);
  for(const p of parts){if(p.end-p.start<2||p.end-p.start>30)fail('Each extra part must be 2–30 seconds');if(p.start<0||p.end>duration+.01)fail('Extra parts must be inside the source video');if(overlap(p,{start,end}))fail('An extra part overlaps the main clip');}
  parts.forEach((p,i)=>{if(i&&overlap(p,parts[i-1]))fail('Extra parts must not overlap each other');});
  // Parts play in the order given, so keep the owner's order rather than the sorted one.
  out.parts=body.parts.map(p=>({start:round(p.start),end:round(p.end)}));
 }
 if(body.effects!==undefined){
  if(!Array.isArray(body.effects))fail('Effects must be a list');if(body.effects.length>40)fail('Use at most 40 effects');
  const ids=new Set(),spans=[{start,end},...(out.parts||clip.parts||[])];
  out.effects=body.effects.map(e=>{
   if(!e||typeof e!=='object')fail('Invalid effect');
   if(typeof e.id!=='string'||!/^[\w-]{1,40}$/.test(e.id)||ids.has(e.id))fail('Each effect needs a unique id');ids.add(e.id);
   if(!EFFECT_TYPES.includes(e.type))fail(`Unknown effect type: ${String(e.type).slice(0,20)}`);
   if(!num(e.at)||!spans.some(s=>e.at>=s.start-.01&&e.at<=s.end+.01))fail('Each effect must sit inside the clip');
   const [lo,hi]=DURATIONS[e.type],effect={id:e.id,type:e.type,at:round(e.at)};
   if(e.duration!==undefined){if(!num(e.duration)||e.duration<lo||e.duration>hi)fail(`${e.type} length must be ${lo}–${hi} seconds`);effect.duration=round(e.duration);}
   if(e.sound!==undefined){if(typeof e.sound!=='string'||(e.sound&&!/^[a-z0-9_-]{1,30}\/[a-z0-9_-]{1,40}$/i.test(e.sound)))fail('Invalid sound');effect.sound=e.sound;}
   if(e.text!==undefined){if(typeof e.text!=='string'||e.text.length>24)fail('Effect text must be 24 characters or fewer');if(e.text.trim())effect.text=e.text.trim();}
   if(e.emoji!==undefined&&e.emoji!==''){if(e.type!=='pop'||typeof e.emoji!=='string'||[...e.emoji].length>4||/[\w\s]/.test(e.emoji))fail('Only pop effects take a single emoji');effect.emoji=e.emoji;}
   if(e.auto===true&&e.type==='label')effect.auto=true;
   return effect;
  }).sort((a,b)=>a.at-b.at);
 }
 if(body.titleOptions!==undefined){
  if(!Array.isArray(body.titleOptions)||body.titleOptions.length>3)fail('Use at most 3 title options');
  out.titleOptions=[...new Set(body.titleOptions.map(t=>{if(typeof t!=='string'||!t.trim()||t.length>100)fail('Each title option must be 1–100 characters');return t.trim();}))];
 }
 return out;
}

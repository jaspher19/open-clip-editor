const clamp=x=>Math.max(0,Math.min(1,x));
/** Share of the source width a 9:16 crop keeps (1 when the source is already that narrow). */
export function cropFraction(width,height,{outWidth=1080,outHeight=1920}={}){return width>0&&height>0?Math.min(1,(outWidth/outHeight)/(width/height)):1;}
/**
 * Turn raw face boxes into a steady camera path. Uses look-ahead (the whole clip is known), so the camera
 * arrives with the subject instead of chasing it; small drifts inside a dead zone are ignored; and every
 * detected face box is kept inside the crop window, which is what keeps faces from being cut off at the edges.
 * Samples without rawX (older tracks) are returned unchanged.
 */
export function smoothFaceTrack(samples,{fraction=.316,window=.9,deadZone=.18,margin=.04}={}){
 const list=samples.filter(p=>Number.isFinite(p.time)).sort((a,b)=>a.time-b.time),seen=list.filter(p=>Number.isFinite(p.rawX));if(!seen.length)return list;
 const half=fraction/2;
 // Fill gaps: hold the nearest detection for up to 2 s, otherwise ease between neighbours.
 const filled=list.map(p=>{if(Number.isFinite(p.rawX))return {...p,target:p.rawX};const before=[...seen].reverse().find(s=>s.time<=p.time),after=seen.find(s=>s.time>=p.time);
  const near=[before,after].filter(Boolean).sort((a,b)=>Math.abs(a.time-p.time)-Math.abs(b.time-p.time))[0];
  if(Math.abs(near.time-p.time)<=2||!before||!after)return {...p,target:near.rawX};return {...p,target:before.rawX+(after.rawX-before.rawX)*(p.time-before.time)/Math.max(.001,after.time-before.time)};});
 // Centred (non-causal) weighted average: no lag behind the subject.
 const smooth=filled.map(p=>{let sum=0,weight=0;for(const q of filled){const d=Math.abs(q.time-p.time);if(d>window)continue;const w=(1-d/window)*(Number.isFinite(q.rawX)?1:.35);sum+=q.target*w;weight+=w;}return weight?sum/weight:p.target;});
 // Dead zone: hold the shot until the subject drifts a meaningful share of the crop away.
 const held=[];for(const c of smooth){const prev=held.at(-1);held.push(prev===undefined||Math.abs(c-prev)>fraction*deadZone?c:prev);}
 // Hard rule: a detected face box always fits inside the crop (centre on it when it is wider than the crop).
 return filled.map((p,i)=>{let c=held[i];if(Number.isFinite(p.left)&&Number.isFinite(p.right)){const lo=p.right-half+margin*fraction,hi=p.left+half-margin*fraction;c=lo>hi?(p.left+p.right)/2:Math.max(lo,Math.min(hi,c));}
  return {...p,centerX:clamp(Math.max(half,Math.min(1-half,c)))};});
}
export function mapFaceTrack(samples,edl,{fraction}={}){
 const prepared=fraction?smoothFaceTrack(samples,{fraction}):samples;
 const source=prepared.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.centerX)).sort((a,b)=>a.time-b.time);if(!source.length)return [];
 const valueAt=t=>{let a=source[0],b=source.at(-1);for(let i=0;i<source.length-1;i++)if(t>=source[i].time&&t<=source[i+1].time){a=source[i];b=source[i+1];break;}if(t<=source[0].time)return clamp(source[0].centerX);if(t>=source.at(-1).time)return clamp(source.at(-1).centerX);return clamp(a.centerX+(b.centerX-a.centerX)*(t-a.time)/Math.max(.001,b.time-a.time));};
 const points=[];for(const e of edl){points.push({time:e.outputStart,centerX:valueAt(e.start)});for(const p of source)if(p.time>e.start&&p.time<e.end)points.push({time:e.outputStart+(p.time-e.start)/(e.speed||1),centerX:clamp(p.centerX)});points.push({time:e.outputEnd,centerX:valueAt(e.end)});}
 // Keep a manageable finite filter expression and preserve hard EDL boundaries.
 const unique=[];for(const p of points){if(unique.length&&Math.abs(p.time-unique.at(-1).time)<.001)unique[unique.length-1]=p;else unique.push(p);}
 if(unique.length<=121)return unique;const sampled=[unique[0]];for(let i=1;i<120;i++)sampled.push(unique[Math.round(i*(unique.length-1)/120)]);sampled.push(unique.at(-1));return sampled;
}
// Piecewise-linear path as a balanced if() tree: ffmpeg rejects expressions nested ~90 deep, a chain of 120 points would be.
export function cropCenterExpression(track){const pts=track.filter((p,i)=>i===0||p.time>track[i-1].time);if(!pts.length)return '0.5';if(pts.length===1)return pts[0].centerX.toFixed(5);
 const segment=i=>{const a=pts[i],b=pts[i+1];return `(${a.centerX.toFixed(5)}+(${(b.centerX-a.centerX).toFixed(5)})*(t-${a.time.toFixed(5)})/${(b.time-a.time).toFixed(5)})`;};
 const build=(lo,hi)=>hi-lo===1?segment(lo):(m=>`if(lt(t,${pts[m].time.toFixed(5)}),${build(lo,m)},${build(m,hi)})`)(Math.floor((lo+hi)/2));
 return `if(lt(t,${pts[0].time.toFixed(5)}),${pts[0].centerX.toFixed(5)},if(gte(t,${pts.at(-1).time.toFixed(5)}),${pts.at(-1).centerX.toFixed(5)},${build(0,pts.length-1)}))`;}
/** Letterbox band (contract): full width, black bars above and below; 3:4 → 1080×1440 at y 240, 4:5 → 1080×1350 at y 285. */
export const LETTERBOX={'3:4':{width:1080,height:1440,y:240},'4:5':{width:1080,height:1350,y:285}};export const letterboxBand=aspect=>LETTERBOX[aspect]||LETTERBOX['3:4'];
/** Crop the cut video into the band (centre expression from face track / cropX), and the pad that adds the bars after band-sized motion. 4:4:4 keeps the odd 4:5 offset exact. */
export function letterboxFilters(center='0.5',aspect='3:4'){const b=letterboxBand(aspect);return {crop:`[cutv]scale=${b.width}:${b.height}:force_original_aspect_ratio=increase,crop=${b.width}:${b.height}:x='max(0,min(iw-ow,iw*(${center})-ow/2))':y='(ih-oh)/2',setsar=1[framed]`,pad:`format=yuv444p,pad=1080:1920:0:${b.y}:black,`,band:b};}

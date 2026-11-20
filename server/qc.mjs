// Automatic checks on every finished edit (sound, black or frozen picture), like a picky editor's first look. They never fail the render:
// each problem becomes a short warning on the clip so the owner can fix it before posting.
import {run} from './process.mjs';

/** Parse ffmpeg's ebur128 summary and black/freeze detections from one decoding pass. */
export function parseChecks(stderr){
 const num=re=>{const m=stderr.match(re);return m?Number(m[1]):null;};
 const black=[...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m=>Number(m[2])-Number(m[1]));
 const freezes=[...stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map(m=>Number(m[1]));
 return {lufs:num(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/),peak:num(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/),black,freezes};
}
/**
 * Warnings for a finished edit. `held` is how many seconds the edit freezes on purpose (freezes, skull ending).
 * (A slow start is already in the ready-to-post checklist, web/src/readiness.mjs.)
 */
export function warningsFor({lufs,peak,black=[],freezes=[]},{duration,held=0}={}){
 const out=[],blackTotal=black.reduce((a,b)=>a+b,0),frozen=freezes.reduce((a,b)=>a+b,0)-held;
 if(lufs===null||lufs<-40)out.push('Nearly silent: check the sound before posting');
 else if(lufs<-24)out.push(`Quiet (${lufs.toFixed(0)} LUFS): Shorts usually sit around -14`);
 if(peak!==null&&peak>-.1)out.push('Sound clips at its loudest moment');
 if(blackTotal>=Math.min(3,duration*.15))out.push(`Black picture for ${blackTotal.toFixed(1)} s`);
 if(frozen>=3)out.push(`Picture frozen for ${frozen.toFixed(1)} s`);
 return out;
}
/** Decode the export once (loudness, black frames, frozen picture) and return its warnings; [] if the check itself fails. */
export async function checkExport(file,context,{signal,runCommand=run}={}){
 try{const r=await runCommand('ffmpeg',['-hide_banner','-nostats','-i',file,'-filter_complex','[0:v]scale=270:-2,blackdetect=d=0.5:pix_th=0.08,freezedetect=n=0.003:d=2[vo];[0:a]ebur128=peak=true[ao]','-map','[vo]','-map','[ao]','-f','null','-'],{signal,timeout:10*60*1000});
  return warningsFor(parseChecks(r.stderr||''),context);}
 catch(e){if(signal?.aborted)throw e;return [];}
}

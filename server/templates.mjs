import fs from 'node:fs';
export const EDIT_TEMPLATES=JSON.parse(fs.readFileSync(new URL('../presets/edits.json',import.meta.url),'utf8'));
export const CAPTION_FONTS=[{id:'anton',name:'Anton',family:'Anton'},{id:'barlow',name:'Barlow Condensed',family:'Barlow Condensed'},{id:'work',name:'Work Sans',family:'Work Sans'},{id:'mono',name:'Red Hat Mono',family:'Red Hat Mono'},{id:'montserrat',name:'Montserrat ExtraBold',family:'Montserrat ExtraBold'},{id:'montserrat-black',name:'Montserrat Black',family:'Montserrat Black'}];
export function captionFont(id){return CAPTION_FONTS.find(f=>f.id===id)?.family;}
export function applyTemplate(id,current={},overrides={}){const template=EDIT_TEMPLATES.find(t=>t.id===id);if(!template)throw new Error('Unknown edit template');return {...current,...template.settings,editTemplate:id,...overrides};}
// Punch-ins land on speech beats (after a pause, or on ! / ?) when there are any; otherwise on a steady cadence.
// Manual zooms ({out, dur} in output seconds) add a quick 1.18x punch that eases in and out over their duration.
export function zoomFilter(options,beats=[],zooms=[],ramps=[]){const auto=!!options.punchIn&&options.motionIntensity!=='off'&&options.autoEffects!==false;if(!auto&&!zooms.length&&!ramps.length)return '';const size=options.outputFormat==='video'?'1920x1080':'1080x1920';const cadence=Number(options.punchInterval??2.8),amount=Number(options.punchZoom??1.08),frames=Math.round(cadence*30),mode=options.motionIntensity||'balanced';
 let z='1';
 if(auto&&beats.length&&mode!=='subtle'){const hold=Math.min(1.4,cadence*.5),on=beats.map(t=>`between(on/30,${t.toFixed(3)},${(t+hold).toFixed(3)})`).join('+');z=`if(${on},${amount},1)`;}
 else if(auto&&mode==='subtle')z=`1+${(amount-1).toFixed(4)}*(0.5-0.5*cos(2*PI*on/${frames*2}))`;
 else if(auto)z=`if(lt(mod(on,${frames*2}),${frames}),1,${amount})`;
 if(zooms.length)z=`min(1.4,${z}+${zooms.slice(0,40).map(f=>{const a=f.out.toFixed(3),d=Math.max(.15,f.dur).toFixed(3);return `between(on/30,${a},${(f.out+Math.max(.15,f.dur)).toFixed(3)})*0.18*sin(PI*(on/30-${a})/${d})`;}).join('+')})`;
 // Ramps: a steady push-in that builds over the window and snaps back at its end (the meme reveal).
 if(ramps.length)z=`min(1.4,${z}+${ramps.slice(0,4).map(r=>{const a=r.out.toFixed(3),d=Math.max(.2,r.dur).toFixed(3);return `between(on/30,${a},${(r.out+Math.max(.2,r.dur)).toFixed(3)})*${Number(r.amount).toFixed(3)}*(on/30-${a})/${d}`;}).join('+')})`;
 return `zoompan=z='${z}':x='iw/2-iw/(zoom*2)':y='ih/2-ih/(zoom*2)':d=1:s=${size}:fps=30,`;
}

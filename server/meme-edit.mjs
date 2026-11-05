// Automatic meme edit, measured frame by frame on two reference Shorts (docs/EDIT-CONTRACT.md "Meme edit"):
//  - reveal (eUFkorW-1kk): the frame before the jump cut holds for 0.53 s while the sound fades to silence, then the cut lands
//    with an exposure flash and a bass boom; exposure flashes on a few other cuts; green/red full-frame tints on yes/no words;
//    *ACTION* labels that flash red then turn white;
//  - skull ending (B4Xh4PzRtJM): a 0.2 s vertical smear into the held last frame, punched in 1.12x with a warm glowing grade,
//    flames along the floor, an animated mind-blown skull and a slow 808 beat (one hit every 0.58 s); the voice drops out.
// Everything is placed from the transcript, the picker's peak and the edit list, so no frame is invented: labels come from the spoken words.
import {maskProfanity} from './moments.mjs';
const isMain=s=>!s.kind||s.kind==='main';
const HYPE=/^(yes+|yeah+|yep|no+|nah+|nope|not|what+|bro+|oh+|yo+|wait|stop|chat|bruh|huh|why|how|who|look|ayo|dang|damn|wow|crazy|insane)$/i,NEGATIVE=/^(no+|nah+|nope|not|stop|what+|why|huh|damn|dang)$/i;
export const TINTS=['#39FF14','#FF1E56'];
// One skull-ending beat: the 808 in meme/skull-808 hits every 0.58 s (103 BPM), as on the reference.
export const SKULL_BEAT=.58;
/** Source time → output time on the main pass; dead air removed by pause trimming snaps to the next kept speech. */
export function toOutput(t,edl){const mains=edl.filter(isMain),seg=mains.find(s=>t>=s.start&&t<=s.end);if(seg)return seg.outputStart+t-seg.start;const next=mains.find(s=>s.start>t);return next?next.outputStart:mains.at(-1)?.outputEnd??0;}
/** Output times where the edit jumps over removed source (pause trimming, owner cuts) between two main segments. */
export function cutPoints(edl){const out=[];for(let i=1;i<edl.length;i++){const a=edl[i-1],b=edl[i];if(isMain(a)&&isMain(b)&&b.start-a.end>.05)out.push(b.outputStart);}return out;}
const spaced=(list,gap,taken=[])=>{const out=[];for(const t of list.sort((a,b)=>a-b))if([...out,...taken].every(x=>Math.abs(x-t)>=gap))out.push(t);return out;};
/**
 * Every automatic meme effect for one clip, in output seconds:
 * looks [{at,kind:'exposure'|'reveal'|'green'|'red'}] (timed exposure and colour changes), sound cues [{at,sound,gain}],
 * voice fades [[a,b]] (down to silence), the reveal time (or null) and the skull ending window (or null).
 */
export function memePlan(words,edl,{duration,options={}}){
 const looks=[],cues=[],fades=[],skullSeg=edl.find(s=>s.kind==='skull'),skull=options.skullEnding&&skullSeg?{start:skullSeg.outputStart,end:duration}:null,limit=skull?skull.start-.6:duration;
 const hold=options.revealFx?edl.find(s=>s.kind==='freeze'&&s.reveal):null,reveal=hold?hold.outputEnd:null;
 if(hold){fades.push([Math.max(0,hold.outputStart-.3),hold.outputStart]);looks.push({at:reveal,kind:'reveal'});cues.push({at:reveal,sound:'meme/boom',gain:-3});}
 const busy=[...(reveal!==null?[reveal]:[]),...(skull?[skull.start]:[])];
 // The reference flashes on a few cuts, not every pause trim: at least 3 s apart, at most four.
 if(options.cutFlash)spaced(cutPoints(edl).filter(t=>t>.3&&t<limit&&busy.every(x=>Math.abs(x-t)>1)),3).slice(0,4).forEach(at=>looks.push({at,kind:'exposure'}));
 if(options.tintFlashes){const bare=w=>w.text.replace(/[^\p{L}']/gu,''),shouted=words.filter(w=>{const b=bare(w);return w.start>.4&&w.start<limit&&b&&(HYPE.test(b)||(/!$/.test(w.text)&&b.length<=7));});
  const times=spaced(shouted.map(w=>w.start),1.5,looks.map(l=>l.at)).filter(t=>busy.every(x=>Math.abs(x-t)>1)).slice(0,3);
  // Green for a yes, red for a no (as on the reference); other shouted words alternate.
  times.forEach((t,i)=>{const b=bare(shouted.find(w=>w.start===t));looks.push({at:t,kind:NEGATIVE.test(b)?'red':/^(yes+|yeah+|yep)$/i.test(b)?'green':i%2?'red':'green'});});}
 if(skull)cues.push({at:Math.max(0,skull.start-.22),sound:'meme/whoosh',gain:-12},{at:Math.max(0,skull.start-.13),sound:'meme/skull-808',gain:-2});
 return {reveal,looks:looks.sort((a,b)=>a.at-b.at),cues,fades,skull};
}
// Each look rises over 0.1 s and settles over 0.3 s (0.35 s for the reveal), as measured; the peak change per kind.
const LOOK={exposure:{brightness:.26},reveal:{brightness:.3,fall:.35},green:{brightness:.1,saturation:.5,gamma_g:1.3,gamma_r:-.5,gamma_b:-.5},red:{brightness:-.06,saturation:.5,gamma_r:1.2,gamma_g:-.55,gamma_b:-.35}};
const envelope=(at,fall=.3)=>`max(0,min((t-${at.toFixed(3)})/0.1,(${(at+.1+fall).toFixed(3)}-t)/${fall}))`;
/** One eq filter, evaluated per frame, for all of a clip's exposure flashes and colour tints. */
export function lookFilter(looks=[]){if(!looks.length)return '';const sum=(key,base)=>{const parts=looks.filter(l=>LOOK[l.kind]?.[key]).map(l=>`${LOOK[l.kind][key]}*${envelope(l.at,LOOK[l.kind].fall)}`);return parts.length?`${key}='${base}+${parts.join('+')}'`:'';};
 return 'eq=eval=frame:'+[sum('brightness',0),sum('saturation',1),sum('gamma_r',1),sum('gamma_g',1),sum('gamma_b',1)].filter(Boolean).join(':')+',';}
/** The vertical smear into the skull ending (the 0.13 s before the held frame), brightened like the reference. */
export function skullFilters(skull){if(!skull)return '';const w=`between(t,${(skull.start-.13).toFixed(3)},${skull.start.toFixed(3)})`;return `gblur=sigma=1:sigmaV=80:enable='${w}',eq=brightness=.1:enable='${w}',`;}
/**
 * The skull ending's own branch from [input] to [output]: from the held frame on, a 1.12x punch-in, the last 0.07 s of the smear,
 * a warm saturated grade (saturation about doubles, highlights go gold) and a soft glow on the highlights.
 */
export function skullGraph(input,output,skull,{width=1080,height=1920}={}){if(!skull)return [`[${input}]null[${output}]`];const a=skull.start.toFixed(3),W=Math.round(width*1.12/2)*2,H=Math.round(height*1.12/2)*2;
 return [`[${input}]split=2[skm][sks]`,
  `[sks]trim=start=${a},scale=${W}:${H},crop=${width}:${height}:(iw-ow)/2:(ih-oh)*0.42,gblur=sigma=1:sigmaV=60:enable='lt(t,${(skull.start+.07).toFixed(3)})',colorbalance=rs=.08:gs=.03:bs=-.15:rm=.1:gm=.02:bm=-.13:rh=.04:bh=-.07,eq=saturation=1.7:contrast=1.02:brightness=.05,split=2[skb][skg]`,
  `[skg]lutyuv=y='clip((val-150)*2.2,0,255)',gblur=sigma=34[skh]`,
  `[skb][skh]blend=c0_mode=screen:c0_opacity=.55:c1_mode=normal:c1_opacity=0:c2_mode=normal:c2_opacity=0[skl]`,
  `[skm][skl]overlay=eof_action=pass[${output}]`];}
const stamp=t=>{const n=Math.max(0,Math.round(t*100));return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};
// An original mind-blown skull drawn with ASS vectors around its centre: a puffy brain cloud bursting out above the open skull,
// the brain showing at the jagged rim, eye sockets and nose, and a separate grinning jaw. Units are drawing pixels at 100%.
const circle=(x,y,r)=>{const k=Math.round(r*.5523);return `m ${x} ${y-r} b ${x+k} ${y-r} ${x+r} ${y-k} ${x+r} ${y} b ${x+r} ${y+k} ${x+k} ${y+r} ${x} ${y+r} b ${x-k} ${y+r} ${x-r} ${y+k} ${x-r} ${y} b ${x-r} ${y-k} ${x-k} ${y-r} ${x} ${y-r} `;};
const FACE='m -100 -36 l -70 -46 l -50 -30 l -25 -48 l 0 -34 l 25 -50 l 50 -32 l 72 -46 l 100 -36 b 104 0 90 34 66 50 l 66 64 l -66 64 l -66 50 b -90 34 -104 0 -100 -36';
const BRAIN='m -96 -38 b -80 -70 80 -70 96 -38 l 72 -46 l 50 -32 l 25 -50 l 0 -34 l -25 -48 l -50 -30 l -70 -46 l -96 -38';
const HOLES='m -64 2 b -64 -24 -16 -26 -16 2 b -16 24 -64 26 -64 2 m 16 2 b 16 -26 64 -24 64 2 b 64 26 16 24 16 2 m 0 24 l 11 44 l -11 44';
const JAW='m -60 0 l 60 0 b 62 30 42 46 20 48 l -20 48 b -42 46 -62 30 -60 0',TEETH='m -48 4 l 48 4 l 48 9 l -48 9 m -30 4 l -26 4 l -26 30 l -30 30 m -10 4 l -6 4 l -6 33 l -10 33 m 8 4 l 12 4 l 12 33 l 8 33 m 28 4 l 32 4 l 32 30 l 28 30';
const CLOUD=circle(-70,-10,36)+circle(-34,-42,46)+circle(14,-50,50)+circle(62,-26,40)+circle(0,4,42)+circle(96,4,26)+circle(-104,10,24)+circle(46,14,30)+circle(-40,16,30);
const FLAME='m -50 0 b -62 -50 -24 -80 -14 -150 b 2 -104 24 -96 30 -128 b 58 -74 62 -36 50 0 l -50 0';
/**
 * Where the skull goes on a 9:16 crop: beside the face, on the side away from it. The face's place in the frame comes from the
 * face track sample nearest the held frame (its raw position against the crop window), else the default left side.
 */
export function skullSide(samples,at,fraction){const s=(samples||[]).filter(p=>Number.isFinite(p.rawX)&&Number.isFinite(p.centerX)&&Math.abs(p.time-at)<=1.5).sort((a,b)=>Math.abs(a.time-at)-Math.abs(b.time-at))[0];if(!s||!(fraction>0&&fraction<1))return 'left';
 const left=Math.min(1-fraction,Math.max(0,s.centerX-fraction/2));return (s.rawX-left)/fraction<.45?'right':'left';}
/** Mind-blown skull beside the subject and glowing flames along the floor over the skull ending; cloud and jaw move on every 808 hit. */
export function skullAss(skull,{outputFormat='shorts',side='left'}={}){if(!skull)return '';const wide=outputFormat==='video',W=wide?1920:1080,H=wide?1080:1920,x=Math.round(W*(wide?.36:side==='right'?.73:.27)),y=Math.round(H*.5),z=wide?80:100,a=skull.start+.05,end=skull.end,span=(end-a)*1000,lines=[];
 const at=(dx,dy)=>`${Math.round(x+dx*z/100)},${Math.round(y+dy*z/100)}`,base=`\\an7\\fscx${z}\\fscy${z}\\p1`,bone='&HD8ECF6&',ink='&H151515&',edge=`\\bord${wide?4:5}\\3c&H000000&\\shad${wide?3:4}\\4c&H000000&\\4a&H70&`;
 const add=(layer,t0,t1,tags,shape)=>lines.push(`Dialogue: ${layer},${stamp(t0)},${stamp(t1)},Default,,0,0,0,,{${base}${tags}}${shape}`);
 // Floor glow and flames: a warm haze along the bottom, then soft tongues of light that flicker at their own rates.
 lines.push(`Dialogue: 5,${stamp(a)},${stamp(end)},Default,,0,0,0,,{\\an7\\pos(0,${Math.round(H*.8)})\\p1\\bord0\\shad0\\blur${wide?40:60}\\c&H3CA0FF&\\1a&HC8&}m 0 0 l ${W} 0 l ${W} ${Math.round(H*.2)} l 0 ${Math.round(H*.2)}`);
 for(const [i,u] of [.12,.31,.47,.66,.86].entries()){const fx=Math.round(W*u),fy=Math.round(H*(.99-(i*7%5)*.012)),sx=(wide?100:130)+(i*41)%60,sy=(wide?120:150)+(i*67)%140,p=120+(i*53)%110;let flick='';for(let t=0;t<span;t+=p*2)flick+=`\\t(${t},${t+p},\\fscy${sy+70}\\1a&H98&)\\t(${t+p},${t+2*p},\\fscy${sy}\\1a&HB8&)`;
  lines.push(`Dialogue: 5,${stamp(a)},${stamp(end)},Default,,0,0,0,,{\\an7\\pos(${fx},${fy})\\fscx${sx}\\fscy${sy}\\p1\\bord0\\shad0\\blur${wide?26:38}\\c${i%2?'&H48B4FF&':'&H8CF0FF&'}\\1a&HB0&${flick}}${FLAME}`);}
 add(7,a,end,`\\pos(${at(0,0)})${edge}\\c${bone}`,FACE);add(8,a,end,`\\pos(${at(0,0)})\\bord0\\shad0\\c&H9C8CD8&`,BRAIN);add(8,a,end,`\\pos(${at(0,0)})\\bord0\\shad0\\c${ink}`,HOLES);
 // Each beat: the cloud bursts up and puffs out, the jaw drops; both settle back before the next hit.
 for(let b=a;b<end-.02;b+=SKULL_BEAT){const m=Math.min(end,b+SKULL_BEAT/2),n=Math.min(end,b+SKULL_BEAT),down=Math.round((n-m)*1000),hit=Math.min(Math.round((m-b)*1000),130);
  add(6,b,m,`\\move(${at(0,-104)},${at(0,-128)},0,${hit})\\t(0,${hit},\\fscx${z+12}\\fscy${z+12})${edge}\\c&HFFFFFF&`,CLOUD);
  add(6,m,n,`\\move(${at(0,-128)},${at(0,-104)},0,${down})\\fscx${z+12}\\fscy${z+12}\\t(0,${down},\\fscx${z}\\fscy${z})${edge}\\c&HFFFFFF&`,CLOUD);
  for(const [t0,t1,from,to,ms] of [[b,m,16,40,hit],[m,n,40,16,down]]){add(7,t0,t1,`\\move(${at(0,64+from)},${at(0,64+to)},0,${ms})${edge}\\c${bone}`,JAW);add(8,t0,t1,`\\move(${at(0,64+from)},${at(0,64+to)},0,${ms})\\bord0\\shad0\\c${ink}`,TEETH);}}
 return lines.join('\n')+'\n';}
const escape=s=>String(s).replaceAll('\\','＼').replaceAll('{','｛').replaceAll('}','｝').replace(/[\r\n]/g,' ').replace(/\s+/g,' ').trim();
/** *ACTION* labels at the caption spot: two frames of red, then white, with a small pop. */
export function labelAss(placed,{outputFormat='shorts',font='Montserrat Black',y}={}){const wide=outputFormat==='video',x=wide?960:540,top=y??(wide?540:960);
 return placed.filter(f=>f.type==='label'&&f.text).map(f=>{const text=`*${escape(maskProfanity(f.text)).replace(/^\*+|\*+$/g,'').toUpperCase().slice(0,22)}*`,size=Math.min(wide?92:104,Math.floor((wide?1500:940)/Math.max(6,text.length)/.62));
  return `Dialogue: 5,${stamp(f.out)},${stamp(f.out+f.dur)},Default,,0,0,0,,{\\an5\\pos(${x},${top})\\fn${font}\\fs${size}\\c&H552DFF&\\3c&H000000&\\bord8\\shad3\\4c&H000000&\\4a&H40&\\fscx88\\fscy88\\t(0,70,\\fscx104\\fscy104)\\t(70,71,\\c&HFFFFFF&)\\t(70,160,\\fscx100\\fscy100)}${text}`;}).join('\n')+(placed.some(f=>f.type==='label'&&f.text)?'\n':'');}
// Labels narrate a body action or state, never speech: the first word must be an action verb, or the label one body-state word.
const ACTIONS=new Set('GETS GOT PUTS RAISES HOLDS LIFTS BENDS TAKES GIVES BITES TASTES SMELLS TOUCHES RUNS RAN FALLS FELL JUMPS DANCES EATS DRINKS THROWS HITS SLAPS PUNCHES KICKS SCREAMS CRIES LAUGHS LEAVES WALKS SHOWS FLEXES TRIPS HUGS KISSES SITS STANDS LIES SLEEPS WAKES HIDES OPENS DROPS PICKS GRABS PUSHES PULLS SPINS RAGES BREAKS SMASHES CATCHES CHUGS SNIFFS STARES POINTS WAVES BOWS CLAPS SHAKES FREEZES FAINTS COLLAPSES SPRINTS DIVES CLIMBS ROLLS SLIPS SPITS CHOKES COUGHS YELLS SHOUTS SINGS RAPS PRAYS STRETCHES POSES SUCKS PUFFS BURPS FARTS SNEEZES BLUSHES SWEATS TURNS LOOKS WALKS'.split(' ')),STATES=new Set('FAT SKINNY PREGNANT BUFF BALD WET SOAKED SHIRTLESS NAKED SWEATY DIZZY FROZEN SILENCE SHOOK'.split(' '));
export const physical=text=>{const w=text.split(' ');return ACTIONS.has(w[0])||(w.length===1&&STATES.has(w[0]));};
const norm=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu,' ').replace(/\s+/g,' ').trim();
/**
 * Turn AI labels ({text, after}) into label effects: each lands right after its quoted words in the clip's transcript.
 * A label whose quote is not found is dropped, so every label is anchored to something actually said.
 */
export function placeLabels(labels,words,clip){const inside=words.filter(w=>w.start>=clip.start&&w.end<=clip.end),tokens=inside.map(w=>norm(w.text)),out=[];
 for(const l of (Array.isArray(labels)?labels:[]).slice(0,6)){const text=String(l?.text||'').replace(/[*_]/g,'').replace(/[^\p{L}\p{N}' ]/gu,'').replace(/\s+/g,' ').trim().toUpperCase();const quote=norm(l?.after).split(' ').filter(Boolean);
  if(!text||text.length>18||text.split(' ').length>3||quote.length<2||!physical(text))continue;
  let hit=-1;for(let i=0;i+quote.length<=tokens.length&&hit<0;i++)if(quote.every((q,k)=>tokens[i+k]===q))hit=i+quote.length-1;if(hit<0)continue;
  const at=inside[hit].end+.05,next=inside[hit+1]?.start??clip.end,duration=+Math.min(1.2,Math.max(.6,next-at)).toFixed(2);
  if(at>=clip.end-.3||out.some(o=>Math.abs(o.at-at)<1.5))continue;out.push({id:`label-auto-${out.length+1}`,type:'label',at:+at.toFixed(3),text,duration,auto:true});if(out.length===4)break;}
 return out;}
/** Replace a clip's earlier automatic labels with new ones; the owner's own effects stay. */
export const withLabels=(effects,labels)=>[...(Array.isArray(effects)?effects:[]).filter(e=>!(e?.type==='label'&&e.auto)),...labels].sort((a,b)=>a.at-b.at).slice(0,40);

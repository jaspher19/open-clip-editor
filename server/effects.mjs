import {ROOT} from './config.mjs';import path from 'node:path';import fs from 'node:fs';import {maskProfanity} from './moments.mjs';
// Speech boundaries drive accents; never fabricate reaction labels or dialogue.
export function effectBeats(words,duration){const out=[];for(let i=0;i<words.length;i++){const w=words[i];if(w.start<.08||w.start>duration-.4)continue;if(!out.length||((w.start-words[i-1].end>.35||/[!?]$/.test(w.text))&&w.start-out.at(-1)>2.8)){out.push(w.start);if(out.length===8)break;}}return out;}
export function effectAss(beats,{vfx='none',accent='&H0083FF70&',outputFormat='shorts'}={}){if(vfx==='none')return '';const stamp=t=>{const n=Math.round(t*100);return `0:${String(Math.floor(n/6000)).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};return beats.map(t=>`Dialogue: 1,${stamp(t)},${stamp(t+.32)},Default,,0,0,0,,{\\an5\\pos(${outputFormat==='video'?960:540},${outputFormat==='video'?540:1080})\\p1\\bord3\\shad0\\1a&HFF&\\3c${accent}\\fscx70\\fscy70\\t(0,300,\\fscx125\\fscy125\\alpha&HFF&)}m -440 -230 l -400 -230 m -440 -230 l -440 -190 m 440 -230 l 400 -230 m 440 -230 l 440 -190 m -440 230 l -400 230 m -440 230 l -440 190 m 440 230 l 400 230 m 440 230 l 440 190${vfx==='reaction'?' m -470 0 l -510 0 m 470 0 l 510 0':''}`).join('\n')+'\n';}
// Bundled sounds (assets/sfx, see LICENSE.txt): CC0 recordings in soft/ and impact/, sounds synthesised by scripts/make-sfx.mjs in meme/.
const SFX_ROOT=path.join(ROOT,'assets','sfx'),GROUPS=['soft','impact','meme'],library={},sounds={};
const readWav=file=>{const b=fs.readFileSync(file),data=b.indexOf('data')+8;if(b.readUInt32LE(24)!==48000||b.readUInt16LE(22)!==1)throw new Error('Sound accents must be 48 kHz mono: '+path.basename(file));return new Int16Array(b.buffer.slice(b.byteOffset+data,b.byteOffset+b.length-((b.length-data)%2)));};
function samples(style){if(!library[style]){const dir=path.join(SFX_ROOT,style==='impact'?'impact':'soft');library[style]=fs.readdirSync(dir).filter(n=>n.endsWith('.wav')).sort().map(n=>readWav(path.join(dir,n)));if(!library[style].length)throw new Error('No sound accents found in '+dir);}return library[style];}
/** Every bundled sound as {id:'group/name', name, group}. */
export function listSounds(){return GROUPS.flatMap(group=>{const dir=path.join(SFX_ROOT,group);return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>/^[\w-]+\.wav$/.test(n)).sort().map(n=>{const name=n.slice(0,-4);return {id:`${group}/${name}`,name:name.replace(/[-_]/g,' ').replace(/ 0?(\d+)$/,' $1'),group};}):[];});}
export const soundFile=id=>{const m=/^(soft|impact|meme)\/([\w-]+)$/.exec(String(id||''));if(!m)return null;const file=path.join(SFX_ROOT,m[1],m[2]+'.wav');return fs.existsSync(file)?file:null;};
const sound=id=>{if(!(id in sounds)){const file=soundFile(id);sounds[id]=file?readWav(file):null;}return sounds[id];};
// Manual effects that don't name a sound get a fitting default; an explicit '' means silence.
export const DEFAULT_SOUNDS={zoom:'meme/whoosh',shake:'meme/boom',flash:'meme/shutter',freeze:'meme/scratch',replay:'meme/rewind',pop:'meme/pop',sfx:'meme/boom'};
/**
 * Mix the effects track: automatic beat accents (soundEffects soft/impact), explicit cues [{at, sound}] (louder,
 * so a chosen boom is heard over speech) and 1 kHz beeps [{start,end}] over masked swear words.
 */
export function writeEffects(file,beats,duration,{soundEffects='soft',soundVolume=-27,cues=[],beeps=[]}={}){const rate=48000,count=Math.ceil(duration*rate),pcm=Buffer.alloc(count*2);
 const add=(clip,at,gain)=>{const offset=Math.round(at*rate);for(let i=0;i<clip.length&&offset+i<count;i++){if(offset+i<0)continue;const p=(offset+i)*2;pcm.writeInt16LE(Math.max(-32767,Math.min(32767,pcm.readInt16LE(p)+Math.round(clip[i]*gain))),p);}};
 if(soundEffects!=='off'){const set=samples(soundEffects),gain=10**(soundVolume/20);beats.forEach((at,n)=>add(set[n%set.length],at,gain));}
 const cueGain=10**(Math.min(-12,soundVolume+11)/20);for(const c of cues){const s=sound(c.sound);if(s&&Number.isFinite(c.at))add(s,c.at,Number.isFinite(c.gain)?10**(Math.min(-1,c.gain)/20):cueGain);}
 const beepGain=10**(-18/20)*32767;for(const b of beeps){const a=Math.max(0,Math.round(b.start*rate)),z=Math.min(count,Math.round(b.end*rate));for(let i=a;i<z;i++){const env=Math.min(1,(i-a)/240,(z-i)/240),p=i*2;pcm.writeInt16LE(Math.max(-32767,Math.min(32767,pcm.readInt16LE(p)+Math.round(Math.sin(2*Math.PI*1000*i/rate)*beepGain*env))),p);}}
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);fs.writeFileSync(file,Buffer.concat([header,pcm]));return file;}
const stamp=t=>{const n=Math.max(0,Math.round(t*100));return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};
const escape=s=>String(s).replaceAll('\\','＼').replaceAll('{','｛').replaceAll('}','｝').replace(/[\r\n]/g,' ').replace(/\s+/g,' ').trim();
/**
 * Overlays for placed manual effects ({type, out, dur, text, emoji}, output seconds): flashes (white, or a ~45% `flashColor` tint), big pop words,
 * the "WAIT FOR IT…" freeze card and the "REPLAY" badge. Layers 4–6 sit above captions and the title.
 */
export function manualEffectsAss(placed,{outputFormat='shorts',accent='&H0083FF70&',flashColor='auto'}={}){const wide=outputFormat==='video',W=wide?1920:1080,H=wide?1080:1920,cx=W/2,lines=[],hex=/^#[0-9a-f]{6}$/i.test(flashColor)?flashColor.toUpperCase():null,flash=hex?`\\c&H${hex.slice(5,7)}${hex.slice(3,5)}${hex.slice(1,3)}&\\1a&H8C&`:'\\c&HFFFFFF&\\1a&H08&';
 for(const f of placed){const a=f.out,b=f.out+f.dur,ms=Math.round(f.dur*1000);
  // Automatic meme flashes bring their own colour and strength.
  const own=f.color&&/^#[0-9a-f]{6}$/i.test(f.color)?`\\c&H${f.color.slice(5,7)}${f.color.slice(3,5)}${f.color.slice(1,3)}&\\1a${/^&H[0-9A-F]{2}&$/i.test(f.alpha||'')?f.alpha:'&H60&'}`:null;
  if(f.type==='flash')lines.push(`Dialogue: 6,${stamp(a)},${stamp(b)},Default,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0${own||flash}\\t(0,${ms},\\1a&HFF&)}m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}`);
  if(f.type==='pop'&&(f.text||f.emoji)){const text=escape(maskProfanity(f.text||'')).slice(0,24).toUpperCase(),size=Math.min(wide?150:170,Math.floor((wide?1500:960)/Math.max(4,text.length)/.62)),y=wide?470:860,end=Math.max(b,a+.9);
   lines.push(`Dialogue: 5,${stamp(a)},${stamp(end)},Default,,0,0,0,,{\\an5\\pos(${cx},${y})\\fnMontserrat Black\\fs${size}\\c&HFFFFFF&\\3c&H000000&\\bord11\\shad7\\4c&H000000&\\4a&H40&\\frz-4\\fscx60\\fscy60\\t(0,120,\\fscx115\\fscy115)\\t(120,230,\\fscx100\\fscy100)\\fad(0,140)}${text?`{\\c${accent}}${text}`:''}${f.emoji?`${text?'\\N':''}{\\fnSegoe UI Emoji\\c&HFFFFFF&\\bord0\\shad0}${escape(f.emoji).slice(0,8)}`:''}`);}
  if(f.type==='freeze'){lines.push(`Dialogue: 4,${stamp(a)},${stamp(b)},Default,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c&H000000&\\1a&H90&}m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}`);
   lines.push(`Dialogue: 5,${stamp(a)},${stamp(b)},Default,,0,0,0,,{\\an5\\pos(${cx},${wide?540:960})\\fnMontserrat Black\\fs${wide?120:118}\\c&HFFFFFF&\\3c&H000000&\\bord10\\shad6\\fscx70\\fscy70\\t(0,140,\\fscx108\\fscy108)\\t(140,260,\\fscx100\\fscy100)}${escape(maskProfanity(f.text||'WAIT FOR IT…')).slice(0,24).toUpperCase()}`);}
  if(f.type==='replay'){lines.push(`Dialogue: 5,${stamp(a)},${stamp(b)},Default,,0,0,0,,{\\an5\\pos(${cx},${wide?1000:1640})\\fnMontserrat Black\\fs${wide?64:72}\\c&HFFFFFF&\\3c&H000000&\\bord7\\shad4\\fad(80,120)}{\\c&H3030FF&}●{\\c&HFFFFFF&} ${escape(maskProfanity(f.text||'REPLAY')).slice(0,16).toUpperCase()}`);
   lines.push(`Dialogue: 4,${stamp(a)},${stamp(b)},Default,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c&H000000&\\1a&HC8&}m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}`);}
 }return lines.length?lines.join('\n')+'\n':'';}
/** Reaction-peak windows for `mono-peaks`: 1.6 s around each auto-effect beat (output seconds). */
export const monoWindows=beats=>beats.map(t=>[Math.max(0,t-.2),t+1.4]);
/** Colour grade before captions: `vivid` lifts the whole clip; `mono-peaks` drops to black-and-white in each peak window; `none` adds nothing. */
export function gradeFilter(grade='none',beats=[]){if(grade==='vivid')return 'eq=saturation=1.25:contrast=1.08,unsharp=5:5:0.4:5:5:0,';if(grade!=='mono-peaks'||!beats.length)return '';return `hue=s=0:enable='${monoWindows(beats).map(([a,b])=>`between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')}',`;}

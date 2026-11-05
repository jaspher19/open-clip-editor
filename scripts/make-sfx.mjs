// Generates the "meme" sound pack procedurally with ffmpeg, so every sound is original to this repo (no samples).
// Output: assets/sfx/meme/*.wav, 48 kHz mono 16-bit, peak-normalised to -1 dBFS. Run: node scripts/make-sfx.mjs
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),OUT=path.join(ROOT,'assets','sfx','meme');fs.mkdirSync(OUT,{recursive:true});
const R=48000,src=(expr,d)=>`aevalsrc='${expr}':s=${R}:d=${d}`,noise=(d,color='white')=>`anoisesrc=d=${d}:c=${color}:r=${R}:a=0.8`;
// Each sound: a lavfi source graph (one output) and its length in seconds.
const SOUNDS={
 boom:{graph:`${src('sin(2*PI*(34*t+60*(1-exp(-3*t))/3))*exp(-2.1*t)+0.35*(random(0)*2-1)*exp(-40*t)',1.6)},lowpass=f=260,acompressor=threshold=0.3:ratio=4`},
 'bass-hit':{graph:`${src('sin(2*PI*(48*t+40*(1-exp(-12*t))/12))*exp(-5*t)+0.5*sin(2*PI*1200*t)*exp(-90*t)',0.7)},lowpass=f=900`},
 whoosh:{graph:`${noise(0.75,'pink')},volume='pow(sin(PI*t/0.75),3)':eval=frame,highpass=f=350,lowpass=f=4200`},
 riser:{graph:`${src('(0.55*sin(2*PI*(180*t+260*t*t))+0.35*(random(0)*2-1))*pow(t/1.6,2)',1.6)},highpass=f=150,lowpass=f=6000`},
 rewind:{graph:`${src('sin(2*PI*(1600*t-1100*t*t))*(0.55+0.45*sin(2*PI*28*t))*min(1,8*t)*min(1,(0.62-t)*12)+0.25*(random(0)*2-1)*(0.5+0.5*sin(2*PI*28*t))',0.62)},highpass=f=180,lowpass=f=5000`},
 ding:{graph:`${src('(sin(2*PI*1318*t)+0.42*sin(2*PI*2637*t)+0.2*sin(2*PI*3954*t)+0.1*sin(2*PI*5272*t))*exp(-3.2*t)*min(1,t*400)',1.3)}`},
 scratch:{graph:`${src('(0.7*sin(2*PI*(420*t-260/(2*PI*7)*cos(2*PI*7*t)))+0.6*(random(0)*2-1))*pow(abs(sin(2*PI*7*t)),0.6)',0.5)},bandpass=f=1400:width_type=h:w=1600`},
 pop:{graph:`${src('sin(2*PI*(520*t+4200*t*t))*exp(-38*t)*min(1,t*900)',0.16)}`},
 shutter:{graph:`${src('(random(0)*2-1)*(exp(-260*t)+0.8*exp(-300*max(0,t-0.085))*gte(t,0.085))',0.2)},highpass=f=1800`},
 'crowd-ooh':{graph:`${src(Array.from({length:9},(_,i)=>{const f=(190+i*23.7).toFixed(1),v=(4.1+i*.37).toFixed(2);return `2*((${f}*t+0.004*sin(2*PI*${v}*t))-floor(${f}*t+0.004*sin(2*PI*${v}*t)+0.5))`;}).join('+')+'*1',1.5)},volume='0.09*pow(sin(PI*t/1.5),1.5)':eval=frame,lowpass=f=850,highpass=f=120`},
 // Skull ending beat (measured on B4Xh4PzRtJM): a deep, distorted 808 every 0.58 s (103 BPM) with a long tail and a soft hat between hits.
 'skull-808':{graph:`${src('(atan(1.6*sin(2*PI*(40*mod(t,0.58)+80*(1-exp(-20*mod(t,0.58)))/20))*exp(-5.5*mod(t,0.58)))/1.01)*0.9+0.08*(random(0)*2-1)*exp(-80*mod(t+0.29,0.58))',3.2)},lowpass=f=1800,afade=t=out:st=2.85:d=0.35,acompressor=threshold=0.3:ratio=3`},
 // Phonk-style drop for the skull ending: 128 BPM, an 808 on every beat (pitch drop, soft-clipped), a two-tone cowbell riff on the 8ths, ticking hats.
 'phonk-drop':{graph:`${src("(atan(3*sin(2*PI*(42*mod(t,0.46875)+90*(1-exp(-25*mod(t,0.46875)))/25))*exp(-3.2*mod(t,0.46875)))/1.25)*0.85+0.2*(sgn(sin(2*PI*560*PH*t))+sgn(sin(2*PI*829*PH*t)))*exp(-14*mod(t,0.234375))+0.12*(random(0)*2-1)*exp(-70*mod(t,0.1171875))".replaceAll('PH','if(eq(mod(floor(t/0.234375),8),2),1.189,if(eq(mod(floor(t/0.234375),8),4),1.335,if(eq(mod(floor(t/0.234375),8),5),1.189,if(eq(mod(floor(t/0.234375),8),7),0.891,1))))'),3)},afade=t=out:st=2.6:d=0.4,acompressor=threshold=0.25:ratio=3`},
};
// `node scripts/make-sfx.mjs phonk-drop` rebuilds only the named sounds.
const only=process.argv.slice(2);
const run=args=>{const r=spawnSync('ffmpeg',['-hide_banner','-nostdin','-y',...args],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-800));return r.stderr;};
for(const [name,{graph}] of Object.entries(SOUNDS).filter(([n])=>!only.length||only.includes(n))){
 const raw=path.join(OUT,`${name}.raw.wav`),file=path.join(OUT,`${name}.wav`);
 run(['-f','lavfi','-i',graph,'-ac','1','-ar',String(R),'-c:a','pcm_s16le',raw]);
 const peak=Number(run(['-i',raw,'-af','volumedetect','-f','null','-']).match(/max_volume: (-?[\d.]+) dB/)?.[1]??0);
 run(['-i',raw,'-af',`volume=${(-1-peak).toFixed(2)}dB,areverse,afade=t=in:d=0.02,areverse`,'-ac','1','-ar',String(R),'-c:a','pcm_s16le','-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact',file]);
 fs.rmSync(raw);console.log(`${name}.wav  peak ${peak.toFixed(1)} dB → -1 dBFS`);
}

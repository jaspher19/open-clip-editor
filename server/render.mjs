import {loadSignals,gameKeeps} from './signals.mjs';import {sourceTime,playedLength} from './edl.mjs';import {PLAY_MAX} from './selection.mjs';import {checkExport} from './qc.mjs';
import {effectBeats,effectAss,writeEffects,manualEffectsAss,gradeFilter,DEFAULT_SOUNDS} from './effects.mjs';
import {clipFacecam,stackPlan,stackFilters,validBox,reactionWindows} from './stack.mjs';
import fs from 'node:fs';import path from 'node:path';import {buildClipEdl,retimeWords,clockEdl,placeEffects} from './edl.mjs';import {makeAss,makeSrt} from './captions.mjs';import {run,probe} from './process.mjs';import {ROOT,PYTHON} from './config.mjs';import {zoomFilter} from './templates.mjs';import {publicationMetadata} from './context.mjs';import {validateOptions,MUSIC_NAME} from './options.mjs';import {mapFaceTrack,cropCenterExpression,cropFraction,letterboxBand,letterboxFilters} from './framing.mjs';import {hasProfanity} from './moments.mjs';import {ensureSection} from './remote.mjs';import {memePlan,skullFilters,skullGraph,skullAss,skullSide,labelAss,lookFilter} from './meme-edit.mjs';
/** Background music: a music-library track by file name (work/music-library), else the project's uploaded track. */
export function musicPath(job,options){if(options.musicTrack){if(!MUSIC_NAME.test(options.musicTrack))throw new Error('Invalid music track');const file=path.join(ROOT,'work','music-library',options.musicTrack);if(path.dirname(file)!==path.join(ROOT,'work','music-library')||!fs.existsSync(file))throw new Error('That music track is no longer in the music library');return file;}return job.musicPath&&fs.existsSync(job.musicPath)?job.musicPath:null;}
const isMain=s=>!s.kind||s.kind==='main',assColor=hex=>'&H00'+hex.slice(5,7)+hex.slice(3,5)+hex.slice(1,3)+'&',windows=list=>list.map(([a,b])=>`between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
/**
 * Video chain from [cutv] to [v]: framing, punch-ins, shake, beat pulse, grade, letterbox bars, then captions.
 * Letterbox on 16:9 'video' falls back to the blurred full-frame fit. Motion and grade run at band size before the bars, so bars stay pure black.
 */
export function videoFilters(options,{beats=[],placed=[],ramps=[],looks=[],skull=null,center='0.5',name='clip',fontsdir='../../assets/fonts',stack=null,portrait=0}={}){const wide=options.outputFormat==='video',framing=options.framing||'center',width=wide?1920:1080,filters=[];let height=wide?1080:1920,pad='',note=null;
 if(wide){filters.push('[cutv]split=2[bg][fg]');filters.push('[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24:2[background]');filters.push('[fg]scale=1920:1080:force_original_aspect_ratio=decrease[foreground]');filters.push('[background][foreground]overlay=(W-w)/2:(H-h)/2,setsar=1[framed]');note='Horizontal video · full footage with blurred fill';
 // A vertical source keeps its whole frame in a Short: no crop band, facecam stack or editorial box would cut it.
 }else if(portrait&&framing!=='fit'){
  if(portrait>=.5&&portrait<=.62)filters.push('[cutv]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[framed]');
  else{filters.push('[cutv]split=2[bg][fg]');filters.push('[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[background]');filters.push('[fg]scale=1080:1920:force_original_aspect_ratio=decrease[foreground]');filters.push('[background][foreground]overlay=(W-w)/2:(H-h)/2,setsar=1[framed]');}
  note='Vertical source · full frame';
 }else if(framing==='stack'&&stack){filters.push(...stackFilters(stack));note=stack.note;
 }else if(framing==='editorial'){
  filters.push('[cutv]split=2[bg][fg]');filters.push('[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawbox=c=white:t=fill[background]');filters.push('[fg]scale=1080:1050:force_original_aspect_ratio=decrease[foreground]');filters.push('[background][foreground]overlay=(W-w)/2:700+(850-h)/2,setsar=1[framed]');note='White editorial canvas · full footage';
 }else if(framing==='fit'){
  filters.push('[cutv]split=2[bg][fg]');filters.push('[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[background]');filters.push('[fg]scale=1080:1920:force_original_aspect_ratio=decrease[foreground]');filters.push('[background][foreground]overlay=(W-w)/2:(H-h)/2,setsar=1[framed]');
 }else if(framing==='letterbox'){const lb=letterboxFilters(center,options.letterboxAspect);filters.push(lb.crop);pad=lb.pad;height=lb.band.height;
 }else filters.push(`[cutv]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:x='max(0,min(iw-ow,iw*(${center})-ow/2))':y='(ih-oh)/2',setsar=1[framed]`);
 const pulse=options.autoEffects!==false&&options.vfx==='reaction'&&beats.length?`eq=contrast=1.12:saturation=1.2:enable='${beats.map(t=>`between(t,${t.toFixed(3)},${(t+.22).toFixed(3)})`).join('+')}',`:'';let punch=zoomFilter(options,beats,placed.filter(f=>f.type==='zoom'),ramps);if(pad)punch=punch.replace(':s=1080x1920:',`:s=1080x${height}:`);
 // Shake: an 8% overscan lets the frame jitter without showing edges, only while a shake window is active.
 const shakes=placed.filter(f=>f.type==='shake').map(f=>[f.out,f.out+f.dur]),amp=wide?30:34,shake=shakes.length?`scale=${Math.round(width*1.08/2)*2}:${Math.round(height*1.08/2)*2},crop=${width}:${height}:x='(iw-ow)/2+(${windows(shakes)})*${amp}*sin(t*83)':y='(ih-oh)/2+(${windows(shakes)})*${amp}*cos(t*61)',`:'';
 // Meme looks (timed exposure flashes and tints) and the skull ending's punch-in, grade and glow run before the bars and captions.
 const look=`${punch}${shake}${pulse}${gradeFilter(options.grade,options.autoEffects!==false?beats:[])}${lookFilter(looks)}${skullFilters(skull)}`,captions=`${pad}ass=filename=clips/${name}.ass:fontsdir=${fontsdir},format=yuv420p[v]`;
 if(skull)filters.push(`[framed]${look}null[looked]`,...skullGraph('looked','graded',skull,{width,height}),`[graded]${captions}`);else filters.push(`[framed]${look}${captions}`);
 return {filters,note};}
export const SETTING_KEYS=['outputFormat','editTemplate','style','font','accentColor','captionPosition','motionIntensity','punchIn','punchInterval','punchZoom','progressBar','hookEnabled','hookText','hookDuration','framing','threshold','titleMode','contextText','seriesLabel','captionsEnabled','captionReveal','captionOffsetMs','vfx','soundEffects','soundVolume','autoEffects','coldOpen','coldOpenSeconds','coldOpenAt','loopEnding','profanityAudio','cropX','musicTrack','letterboxAspect','watermark','watermarkY','flashColor','grade','revealFx','cutFlash','tintFlashes','skullEnding','actionLabels','hookReveal','hookPosition','keepPauses','camBox','gameBox','stackSplit','camTakeover','stackStyle'];
export async function renderClip(job,clip,transcript,{folder,signal,onProgress}={}){
 const options=validateOptions({...job.options,...clip.settings});const wide=options.outputFormat==='video',width=wide?1920:1080,height=wide?1080:1920;
 // Words carry the owner's caption edits; extra parts need words from outside the main range too.
 const all=transcript.words?.length?transcript.words.map((w,i)=>({...w,text:clip.wordEdits?.[i]??w.text})):(clip.words||[]),ranges=[{start:clip.start,end:clip.end},...(Array.isArray(clip.parts)?clip.parts:[])].filter(r=>r&&Number.isFinite(r.start)&&Number.isFinite(r.end));
 const words=all.filter(w=>ranges.some(r=>w.end>r.start&&w.start<r.end));
 const music=options.musicEnabled?musicPath(job,options):null;if(options.musicEnabled&&!music)throw new Error('Upload a local music file or turn background music off');
 // Clips picked before game signals existed keep their silent on-screen action too, unless that runs past a minute.
 const signals=loadSignals(folder);if(!clip.keep&&signals&&!options.keepPauses){const keep=gameKeeps(signals,words,clip.start,clip.end,{max:3});if(keep.length&&playedLength(words,{...clip,keep},options)<=PLAY_MAX)clip={...clip,keep};}
 const edl=clockEdl(buildClipEdl(words,clip,options,{silences:job.silences||[]}));
 if(!edl.some(isMain))throw new Error('This clip has no spoken words to export');
 const mapped=retimeWords(words,edl),retimed=mapped.map(w=>({...w,start:Math.max(0,w.start+options.captionOffsetMs/1000),end:Math.max(.01,w.end+options.captionOffsetMs/1000)})),duration=edl.at(-1).outputEnd;const clips=path.join(folder,'clips'),exports=path.join(folder,'exports');fs.mkdirSync(clips,{recursive:true});fs.mkdirSync(exports,{recursive:true});
 const name=clip.id;const filename=`${name}.mp4`;const output=path.join(exports,filename),temp=path.join(exports,`${name}.partial.mp4`);
 fs.writeFileSync(path.join(clips,`${name}.edl.json`),JSON.stringify({edl,words:retimed,duration},null,2));
 const skullAt=edl.find(s=>s.kind==='skull')?.outputStart??Infinity,shown=retimed.filter(w=>w.start<skullAt-.05).map(w=>({...w,end:Math.max(w.start+.04,Math.min(w.end,skullAt-.5))})),placed=placeEffects(clip.effects,edl,{cuts:clip.cuts}),labels=placed.filter(f=>f.type==='label'&&f.text),plan=memePlan(retimed,edl,{duration,options});
 fs.writeFileSync(path.join(clips,`${name}.ass`),makeAss(shown.filter(w=>!labels.some(f=>w.end>f.out&&w.start<f.out+f.dur)),{...options,contextText:options.contextText||'',title:options.hookText||((clip.title||'').split(/\s+/).length>3?clip.title:retimed.slice(0,9).map(w=>w.text).join(' ')),duration}));fs.writeFileSync(path.join(exports,`${name}.srt`),makeSrt(retimed));fs.writeFileSync(path.join(exports,`${name}.txt`),clip.title+'\n\n'+clip.hook+'\n');
 // Automatic beat accents unless the owner turned them off; manual effects always apply.
 const auto=options.autoEffects!==false,beats=auto?effectBeats(retimed,duration):[];fs.appendFileSync(path.join(clips,`${name}.ass`),effectAss(beats,{vfx:auto?options.vfx:'none',outputFormat:options.outputFormat}));
 const cold=edl[0].kind==='cold'?edl[0]:null,accent=options.accentColor&&options.accentColor!=='auto'?assColor(options.accentColor):'&H0083FF70&';
 // Cold open: a flash and a rewind sound mark the jump from the payoff back to the setup. A flashColor tint also flashes (silently) on each auto beat.
 const tints=options.flashColor&&options.flashColor!=='auto'?beats.map(t=>({type:'flash',out:t,dur:.28})):[];
 fs.appendFileSync(path.join(clips,`${name}.ass`),manualEffectsAss([...placed,...tints,...(cold?[{type:'flash',out:cold.outputEnd,dur:.22}]:[])],{outputFormat:options.outputFormat,accent,flashColor:options.flashColor})+labelAss(labels,{outputFormat:options.outputFormat}));
 const sm=job.metadata||{},sourceAspect=sm.width>0&&sm.height>0?sm.width/sm.height:16/9,portrait=!wide&&sourceAspect<.8;
 const manualCrop=Number.isFinite(options.cropX);let faceInfo={samples:[],detectedSamples:0,fallback:true},framing=options.framing||'center',framingNote=framing==='fit'?'Full frame with blurred fill':manualCrop?'Manual crop':'Center crop';
 if(!wide&&!portrait&&!manualCrop&&(options.faceTrack||framing==='face'||framing==='letterbox')&&['center','face','letterbox'].includes(framing)){
  const trackFile=path.join(clips,`${name}.faces.json`);
  try{const sec=job.remote?.proxy?await ensureSection(job,folder,clip.start,clip.end,{signal}):null,shift=sec?sec.start:0;await run(PYTHON,[path.join(ROOT,'workers/face_track.py'),sec?sec.file:job.sourcePath,trackFile,'--start',String(clip.start-shift),'--end',String(clip.end-shift)],{cwd:folder,signal,logFile:path.join(clips,`${name}.face.log`)});faceInfo=JSON.parse(fs.readFileSync(trackFile,'utf8'));if(shift){faceInfo.samples=faceInfo.samples.map(s=>({...s,time:+(s.time+shift).toFixed(4)}));fs.writeFileSync(trackFile,JSON.stringify(faceInfo,null,2));}framingNote=faceInfo.detectedSamples?`Face follow · ${faceInfo.detectedSamples} detected samples`:'Center fallback · no face detected';}
  catch(e){if(signal?.aborted)throw e;framingNote='Center fallback · face tracking unavailable';fs.writeFileSync(path.join(clips,`${name}.face-error.txt`),e.message);}
 }
 // Facecam on top, gameplay below: find the cam box unless the owner set one. Without a cam, center crop.
 let stack=null;
 if(!wide&&!portrait&&framing==='stack'){
  try{const manual=validBox(options.camBox),detected=manual?null:await clipFacecam(job,folder,{...clip,id:name},{signal});
   const m=job.metadata||{},aspect=m.width>0&&m.height>0?m.width/m.height:16/9;stack=stackPlan(options,detected,aspect);if(stack)stack.overlays=path.relative(folder,path.join(ROOT,'assets','overlays')).split(path.sep).join('/');
   // Cam Split template: cut in on the streamer's face for the opening hook and the loudest reactions.
   if(stack&&options.camTakeover==='zoom'&&fs.existsSync(path.join(folder,'audio.wav'))){stack.zooms=reactionWindows({audio:path.join(folder,'audio.wav'),edl,words:retimed,duration});stack.note+=` · ${stack.zooms.length-1} reaction zoom${stack.zooms.length===2?'':'s'}`;
    // The editor preview shows these cuts too: saved in source time next to the clip.
    fs.writeFileSync(path.join(clips,`${name}.zooms.json`),JSON.stringify({cam:stack.zooms.map(([a,b])=>[sourceTime(edl,a),sourceTime(edl,b)]).filter(([a,b])=>a!==null&&b!==null&&b>a)}));}
   framingNote=stack?stack.note:detected?.full?'No facecam: the camera fills the frame · center crop':'No facecam found · center crop';}
  catch(e){if(signal?.aborted)throw e;framingNote='No facecam found · center crop';fs.writeFileSync(path.join(clips,`${name}.facecam-error.txt`),e.message);}
 }
 // The skull goes beside the face, on the side away from it, once the face track is known.
 if(plan.skull){const held=edl.find(x=>x.kind==='skull'),fraction=faceInfo.width?cropFraction(faceInfo.width,faceInfo.height):0;fs.appendFileSync(path.join(clips,`${name}.ass`),skullAss(plan.skull,{outputFormat:options.outputFormat,side:wide||manualCrop?'left':skullSide(faceInfo.samples,held?.start,fraction)}));}
 // Segments far apart in the source (parts) get their own fast-seek input instead of decoding everything in between.
 const inputs=[],until=[],inputFor=s=>{let k=inputs.findIndex(b=>s.start>=b&&s.end-b<240);if(k<0){inputs.push(Math.max(0,s.start-.1));until.push(0);k=inputs.length-1;}until[k]=Math.max(until[k],s.end+.2);return k;},filters=[];
 edl.forEach((s,i)=>{const k=inputFor(s),b=inputs[k],a=(s.start-b).toFixed(5),z=(s.end-b).toFixed(5),out=(s.frames/30).toFixed(5),audio=`aresample=48000,aformat=channel_layouts=stereo`,tail=`apad,atrim=end_sample=${s.samples},asetpts=N/SR/TB`;
  if(s.kind==='freeze'||s.kind==='skull'){filters.push(`[${k}:v]trim=start=${a}:end=${(s.start-b+.1).toFixed(5)},setpts=PTS-STARTPTS,fps=30,trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${(s.hold+.2).toFixed(3)},trim=end_frame=${s.frames},setpts=N/(30*TB)[v${i}]`);filters.push(`[${k}:a]atrim=start=${a}:end=${(s.start-b+.1).toFixed(5)},asetpts=PTS-STARTPTS,${audio},volume=0,${tail}[a${i}]`);return;}
  if(s.kind==='replay'){filters.push(`[${k}:v]trim=start=${a}:end=${z},setpts=(PTS-STARTPTS)/${s.speed},fps=30,tpad=stop_mode=clone:stop_duration=0.2,trim=end_frame=${s.frames},setpts=N/(30*TB)[v${i}]`);filters.push(`[${k}:a]atrim=start=${a}:end=${z},asetpts=PTS-STARTPTS,${audio},atempo=${s.speed},volume=0.8,${tail},afade=t=in:d=0.03,afade=t=out:st=${Math.max(0,out-.04).toFixed(5)}:d=0.04[a${i}]`);return;}
  filters.push(`[${k}:v]trim=start=${a}:end=${z},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=0.1,trim=end_frame=${s.frames},setpts=N/(30*TB)[v${i}]`);filters.push(`[${k}:a]atrim=start=${a}:end=${z},asetpts=PTS-STARTPTS,${audio},${tail},afade=t=in:d=0.006,afade=t=out:st=${Math.max(0,s.end-s.start-.008).toFixed(5)}:d=0.008[a${i}]`);});
 filters.push(edl.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${edl.length}:v=1:a=1[cutv][cuta]`);
 const band=framing==='letterbox'&&!wide?letterboxBand(options.letterboxAspect):null,center=manualCrop?options.cropX.toFixed(5):faceInfo.detectedSamples?cropCenterExpression(mapFaceTrack(faceInfo.samples,edl,{fraction:faceInfo.width?cropFraction(faceInfo.width,faceInfo.height,band?{outHeight:band.height}:undefined):undefined})):'0.5';
 // FFmpeg runs inside the project folder; the font folder is found relative to wherever that is.
 const look=videoFilters(options,{beats,placed,looks:plan.looks,skull:plan.skull,center,name,stack,portrait:portrait?sourceAspect:0,fontsdir:path.relative(folder,path.join(ROOT,'assets','fonts')).split(path.sep).join('/')});filters.push(...look.filters);if(look.note)framingNote=look.note;else if(band)framingNote=`Letterbox ${options.letterboxAspect} · ${framingNote}`;
 // Sounds: each manual effect's chosen (or default) sound, the cold-open rewind, and beeps over swear words.
 const cues=[...placed.filter(f=>f.sound!=='').map(f=>({at:f.out,sound:f.sound===undefined?DEFAULT_SOUNDS[f.type]:f.sound})),...(cold?[{at:Math.max(0,cold.outputEnd-.3),sound:'meme/rewind'}]:[]),...plan.cues];
 const swears=options.profanityAudio==='keep'?[]:mapped.filter(w=>hasProfanity(w.text)).map(w=>[Math.max(0,w.start-.03),Math.min(duration,w.end+.03)]),beeps=options.profanityAudio==='beep'?swears.map(([start,end])=>({start,end})):[];
 const effectsFile=(auto&&options.soundEffects!=='off'&&beats.length)||cues.length||beeps.length?writeEffects(path.join(clips,`${name}.sfx.wav`),beats,duration,{...options,soundEffects:auto?options.soundEffects:'off',cues,beeps}):null;
 const beds=[];let inputIndex=inputs.length;
 const quiet=swears,fades=plan.fades.map(([a,b])=>`volume='clip((${b.toFixed(3)}-t)/${Math.max(.01,b-a).toFixed(3)},0,1)':eval=frame:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})',`).join('');filters.push(`[cuta]${quiet.length?`volume=0:enable='${windows(quiet)}',`:''}${fades}loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000,asplit=2[voice][side]`);
 if(music){filters.push(`[${inputIndex++}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=40,lowpass=f=8000,loudnorm=I=${options.musicVolume}:TP=-5:LRA=7,aresample=48000,atrim=duration=${duration},afade=t=in:d=0.12,afade=t=out:st=${Math.max(0,duration-.4)}:d=0.4[music]`);beds.push('[music]');}
 // Only the music ducks under speech; sound accents land on speech beats, so ducking them made many inaudible.
 const mix=['[voice]'];if(beds.length){filters.push('[music][side]sidechaincompress=threshold=.035:ratio=6:attack=5:release=180[ducked]');mix.push('[ducked]');}else filters.push('[side]anullsink');
 if(effectsFile){filters.push(`[${inputIndex++}:a]aresample=48000,aformat=channel_layouts=stereo[sfx]`);mix.push('[sfx]');}
 filters.push(mix.length>1?`${mix.join('')}amix=inputs=${mix.length}:normalize=0,alimiter=limit=.88:level=false[a]`:'[voice]anull[a]');
 const graph=path.join(clips,`${name}.ffscript`);fs.writeFileSync(graph,filters.join(';\n'));
 const extraInputs=[...(music?['-stream_loop','-1','-i',music]:[]),...(effectsFile?['-i',effectsFile]:[])];
 // Long streams imported as a light copy: each input reads its full-quality section, seeking by the section's measured start.
 // If the full-quality part can't be fetched or renders without a picture, the clip is made from the light copy
 // (lower resolution, same timing) instead of failing, and the framing note says so.
 let sources=null;if(job.remote?.proxy)try{sources=await Promise.all(inputs.map((b,k)=>ensureSection(job,folder,b,until[k],{signal})));}catch(e){if(signal?.aborted)throw e;fs.writeFileSync(path.join(clips,`${name}.section-error.txt`),e.message);}
 const argsFor=src=>inputs.flatMap((b,k)=>src?['-ss',Math.max(0,b-src[k].start).toFixed(5),'-i',src[k].file]:['-ss',b.toFixed(5),'-i',job.sourcePath]);
 let blurry=null;const lighter=()=>{blurry='Blurry: made from the low-quality preview copy because the full-quality part would not download. Render again to retry';framingNote=`${framingNote} · made from the preview copy (lower quality): the full-quality part failed`;};
 if(job.remote?.proxy&&!sources)lighter();
 // The platform only gave a low quality for this part (it was asked twice): say so instead of posting it blurry.
 const lowSide=sources?Math.min(...sources.map(x=>Math.min(Number(x.width)||9999,Number(x.height)||9999))):9999;if(sources&&lowSide<Math.min(720,Number(job.remote?.sourceHeight)||720))blurry=`Blurry: the platform only gave ${lowSide}p for this part. Render again later to retry`;
 const encode=async inputArgs=>{await run('ffmpeg',['-hide_banner','-nostdin','-y',...inputArgs,...extraInputs,'-filter_complex_script',graph,'-map','[v]','-map','[a]','-t',duration.toFixed(5),'-c:v','libx264','-preset','veryfast','-crf','20','-threads','4','-filter_complex_threads','2','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart','-progress','pipe:1','-nostats',temp],{cwd:folder,signal,logFile:path.join(clips,`${name}.render.log`),onLine:line=>{const m=line.match(/^out_time_us=(\d+)/);if(m)onProgress?.(Math.min(1,Number(m[1])/1e6/duration));}});const meta=await probe(temp,{signal}).catch(e=>{throw new Error(/video track/.test(e.message)?'The edit came out without a picture or sound':e.message);});if(meta.width!==width||meta.height!==height||Math.abs(meta.duration-duration)>.3)throw new Error('Rendered clip failed format/duration verification');return meta;};
 try{let meta;try{meta=await encode(argsFor(sources));}catch(e){if(!sources||signal?.aborted)throw e;fs.writeFileSync(path.join(clips,`${name}.section-error.txt`),e.message);if(fs.existsSync(temp))fs.unlinkSync(temp);lighter();meta=await encode(argsFor(null));}
 fs.renameSync(temp,output);
 // First look, like a clip-channel editor: silence, clipping, black or frozen picture. Warnings only.
 const held=edl.filter(x=>x.kind==='freeze'||x.kind==='skull').reduce((n,x)=>n+x.outputEnd-x.outputStart,0),checks=[...(blurry?[blurry]:[]),...await checkExport(output,{duration:meta.duration,held},{signal})];
 const metadata=clip.metadata||publicationMetadata(clip,{...job,options});fs.writeFileSync(path.join(exports,`${name}.json`),JSON.stringify(metadata,null,2));await run('ffmpeg',['-v','error','-y','-ss',String(Math.min((cold?cold.outputEnd:0)+(options.hookReveal==='typewriter'?1.3:.8),meta.duration/2)),'-i',output,'-frames:v','1','-vf',wide?'scale=960:540':'scale=540:960',path.join(exports,`${name}.jpg`)],{cwd:folder,signal});return {clipId:clip.id,filename,sidecars:['srt','txt','json','jpg'],duration:meta.duration,checks,bytes:fs.statSync(output).size,width,height,style:options.style,editTemplate:options.editTemplate||'custom',font:options.font||'auto',motionIntensity:options.motionIntensity||'balanced',hookEnabled:!!options.hookEnabled,editSettings:Object.fromEntries(SETTING_KEYS.map(key=>[key,options[key]])),framing:framingNote,punchIn:!!options.punchIn,progressBar:!!options.progressBar,music:!!music,effects:placed.length,coldOpen:!!cold,cuts:Array.isArray(clip.cuts)?clip.cuts.length:0,parts:edl.filter(isMain).length>0?ranges.length-1:0,sourceStart:clip.start,sourceEnd:clip.end,createdAt:new Date().toISOString()};}
 catch(e){if(fs.existsSync(temp))fs.unlinkSync(temp);throw e;}
}

import fs from 'node:fs';import path from 'node:path';import {renderClip} from './render.mjs';import {run,probe} from './process.mjs';import {ROOT} from './config.mjs';import {publicationMetadata,sourceName} from './context.mjs';import {laugh,strong,clipCue,clamp,maskProfanity,loudness,cueSums,categoryScores} from './moments.mjs';import {streamPeople,clipPeople} from './people.mjs';import {localTitles,titleCase} from './selection.mjs';import {writeClipBatchAI,metadataProviders} from './metadata-ai.mjs';import {pickHook} from './titles.mjs';
// Stream summary: score every sentence-aligned window of a long stream as a fun, worth-it or clippable moment,
// keep the best ones spread across the stream in story order, then render them into one video.
export const SUMMARY_FORMATS={
 video:{minSeg:12,maxSeg:45,targets:[300,600,900,1200],defaultTarget:600,maxTotal:3600},
 shorts:{minSeg:6,maxSeg:15,targets:[30,60,90,180],defaultTarget:60,maxTotal:180}
};
export const CATEGORY_LABELS={funny:'FUN MOMENT',highlight:'WORTH IT',clippable:'CLIP THIS'};
// The moment's on-screen title: its most expressive sentence (a reaction, laugh or question), not just the first one.
function bestLine(text){const lines=text.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean),rate=s=>(strong.test(s)?3:0)+(laugh.test(s)?3:0)+(clipCue.test(s)?2:0)+(/[!?]$/.test(s)?1:0)+(s.length>=12&&s.length<=60?2:s.length<12?-1:0);const line=maskProfanity(lines.reduce((a,b)=>rate(b)>rate(a)?b:a,lines[0]||'Best moment'));return line.length<=80?line:line.slice(0,81).replace(/\s+\S*$/,'')+'…';}

/** Score candidate windows. Each word contributes cue counts through prefix sums so a multi-hour stream stays fast. */
export function findMoments(transcript,{format='video',threshold=.6,padding=.12}={}){
 const cfg=SUMMARY_FORMATS[format];if(!cfg)throw new Error('Choose main video or Shorts');
 const words=transcript.words||[],duration=transcript.duration||0;if(words.length<8||duration<cfg.minSeg)return [];
 const n=words.length,cues=cueSums(words);
 // Length after the edit trims pauses: gaps over the silence threshold shrink to their padding (as buildEdl does).
 const cut=[0];for(let i=1;i<n;i++){const gap=words[i].start-words[i-1].end;cut[i]=cut[i-1]+(gap>threshold?gap-2*padding:0);}const kept=(i,j)=>words[j].end-words[i].start-(cut[j]-cut[i])+2*padding;
 const loud=loudness(transcript).at;
 const starts=[0];for(let i=1;i<n;i++)if(/[.!?]$/.test(words[i-1].text)||words[i].start-words[i-1].end>.7)starts.push(i);
 const out=[];
 for(const i of starts){
  const start=Math.max(0,words[i].start-.08);let best=null;
  for(let j=i+1;j<n;j++){
   const end=Math.min(duration,words[j].end+.1),len=end-start,trimmed=kept(i,j);if(trimmed>cfg.maxSeg||len>cfg.maxSeg*2.5)break;
   if(trimmed<cfg.minSeg||(!/[.!?]$/.test(words[j].text)&&j!==n-1&&words[j+1].start-words[j].end<.6))continue;
   const {ratio,peak}=loud(start,end),opening=words.slice(i,Math.min(j+1,i+8)).map(w=>w.text).join(' ');
   const scores=categoryScores({cues,i,j,ratio,peak,opening,density:(j+1-i)/len});
   const category=Object.keys(scores).reduce((a,b)=>scores[b]>scores[a]?b:a),score=Math.round(clamp(30+scores[category],0,99));
   if(!best||score>best.score)best={start:+start.toFixed(3),end:+end.toFixed(3),category,score,scores,kept:+trimmed.toFixed(2),title:bestLine(words.slice(i,j+1).map(w=>w.text).join(' '))};
  }
  if(best)out.push(best);
 }
 return out;
}

/** Keep the best moments without overlaps, spread across the stream, until the length budget is filled; story order. */
export function planSummary(moments,{format='video',targetSeconds,duration}={}){
 const cfg=SUMMARY_FORMATS[format];if(!cfg)throw new Error('Choose main video or Shorts');
 const target=clamp(Number(targetSeconds)||cfg.defaultTarget,cfg.minSeg,cfg.maxTotal);const span=duration||Math.max(0,...moments.map(m=>m.end));
 const ranked=[...moments].sort((a,b)=>b.score-a.score||a.start-b.start),picked=[];let total=0;
 const fits=m=>!picked.some(p=>m.start<p.end+3&&m.end>p.start-3)&&total+m.kept<=target+cfg.minSeg/2;
 // Seed one of each kind (fun, worth it, clippable) so loud streams do not crowd out the laughs and the hooks.
 for(const category of Object.keys(CATEGORY_LABELS)){const m=ranked.find(x=>x.category===category&&x.score>=50&&fits(x));if(m){picked.push(m);total+=m.kept;}}
 // Then the best moment in each slice of the stream, so a long stream is summarised end to end.
 const regions=clamp(Math.round(target/(cfg.maxSeg+cfg.minSeg)*2),1,24);
 for(let r=0;r<regions;r++){const a=span*r/regions,b=span*(r+1)/regions,m=ranked.find(x=>x.start>=a&&x.start<b&&x.score>=45&&fits(x));if(m){picked.push(m);total+=m.kept;}}
 for(const m of ranked){if(total>=target-cfg.minSeg/2)break;if(fits(m)){picked.push(m);total+=m.kept;}}
 return picked.sort((a,b)=>a.start-b.start).map((m,i)=>({...m,index:i,label:CATEGORY_LABELS[m.category]}));
}

const stamp=s=>{s=Math.max(0,Math.floor(s));const h=Math.floor(s/3600),m=Math.floor(s/60)%60,sec=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${sec}`:`${m}:${sec}`;};
/** YouTube chapters: first at 0:00, at least three, each at least 10 seconds. Returns [] when those rules cannot be met. */
export function summaryChapters(parts){
 const chapters=[];let at=0;for(const p of parts){const text=p.title.replace(/[<>]/g,'').slice(0,60),last=chapters.at(-1);if(last&&(p.duration<10||last.length<10))last.length+=p.duration;else chapters.push({time:Math.floor(at),text,length:p.duration});at+=p.duration;}
 return chapters.length>=3&&chapters.every(c=>c.length>=10)?chapters.map(c=>({time:c.time,text:c.text,line:`${stamp(c.time)} ${c.text}`})):[];
}

export function summaryMetadata(job,summary){
 const source=sourceName(job.title)||'the stream',base=publicationMetadata({title:source,contextText:job.clips?.[0]?.contextText||source,start:0,end:summary.duration},job);
 const counts=Object.entries(summary.moments.reduce((a,m)=>({...a,[m.category]:(a[m.category]||0)+1}),{})).map(([k,v])=>`${v} ${CATEGORY_LABELS[k].toLowerCase()}${v>1?'s':''}`).join(', ');
 const host=summary.host,clean=titleCase(String(source).replace(/[^\p{L}\p{N}\s'&!?.,:-]/gu,'').replace(/\s+/g,' ').trim().toLowerCase());
 const title=(summary.format==='shorts'?`${summary.moments.find(m=>m.score===Math.max(...summary.moments.map(x=>x.score)))?.title||source}`:`${host&&!clean.toLowerCase().includes(host.toLowerCase())?`${host} `:''}${clean||'Stream'} Best Moments`).replace(/[<>]/g,'').slice(0,100);
 const lines=[`The best moments from ${source} in ${stamp(summary.duration)}: ${counts}.`];if(summary.chapters.length)lines.push('',...summary.chapters.map(c=>c.line));if(job.source?.url)lines.push('',`Full stream: ${job.source.url}`);
 return {...base,title,description:lines.join('\n').replace(/[<>]/g,'').slice(0,4900),tags:[...new Set([...(base.tags||[]),'highlights','stream highlights','best moments'])].slice(0,20)};
}

const textIn=(words,a,b)=>words.filter(w=>w.end>a&&w.start<b).map(w=>w.text).join(' ');
/** Who-did-what titles for summary moments: local first, then one batched AI request when a key is set. */
export async function nameMoments(job,moments,transcript,stream,{env=process.env,fetchImpl}={}){
 const words=transcript.words||[],cues=cueSums(words);
 const items=moments.map((m,index)=>{const people=clipPeople(stream,textIn(words,m.start-30,m.end+15)),text=textIn(words,m.start,m.end),i=words.findIndex(w=>w.end>m.start),j=words.findLastIndex(w=>w.start<m.end);const local=localTitles(text,{category:m.category,peakText:text,people,counts:{laughs:i>=0&&j>=i?cues.range('laugh',i,j+1):0}});m.title=local.title;m.hook=pickHook(local.hook,m.title,people);return {index,people,text};});
 if(!metadataProviders(env).length)return moments;
 try{const r=await writeClipBatchAI({format:'shorts',sourceTitle:sourceName(job.title),contextText:job.options?.contextText||'',clips:items.map(it=>({index:it.index,category:moments[it.index].category,duration:moments[it.index].end-moments[it.index].start,people:it.people,transcript:it.text}))},{env,...(fetchImpl?{fetchImpl}:{})});if(r.error)console.warn("[summary titles]",r.error);for(const a of r.clips){const m=moments[a.index];if(!m||!a.title)continue;m.title=a.title;m.hook=pickHook(a.hook,a.title,items[a.index].people);}}catch(e){console.warn("[summary titles]",e.message);}
 return moments;
}
export async function renderSummary(job,{format='video',targetSeconds}={},{folder,signal,onProgress,env=process.env}={}){
 const transcript=JSON.parse(fs.readFileSync(path.join(folder,'transcript.json'),'utf8'));
 const moments=planSummary(findMoments(transcript,{format,threshold:job.options.threshold,padding:job.options.padding}),{format,targetSeconds,duration:transcript.duration});
 if(moments.length<2)throw new Error('Not enough distinct moments were found for a summary. Try a longer stream or a shorter target length.');
 const stream=streamPeople(job,{folder});await nameMoments(job,moments,transcript,stream,{env});
 const parts=[];
 for(const m of moments){
  const clip={id:`summary-${m.index}`,start:m.start,end:m.end,title:m.title,settings:{...job.options,outputFormat:format,seriesLabel:'',hookText:m.hook||m.title,hookEnabled:format!=='video',titleMode:'persistent',coldOpen:false,loopEnding:false,progressBar:false,musicEnabled:false,contextText:''}};
  const output=await renderClip(job,clip,transcript,{folder,signal,onProgress:p=>onProgress?.((m.index+p)/(moments.length+1))});parts.push({...m,file:path.join(folder,'exports',output.filename),duration:output.duration});
 }
 const script=path.join(folder,'clips','summary.ffscript');fs.writeFileSync(script,parts.map((_,i)=>`[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`).join(';')+';'+parts.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${parts.length}:v=1:a=1[v][a]`);
 const filename=`stream-summary-${format}.mp4`,file=path.join(folder,'exports',filename),partial=file.replace(/\.mp4$/,'.partial.mp4');
 await run('ffmpeg',['-v','error','-y',...parts.flatMap(p=>['-i',p.file]),'-filter_complex_script',script,'-map','[v]','-map','[a]','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4','-filter_complex_threads','2','-c:a','aac','-b:a','160k','-movflags','+faststart',partial],{cwd:ROOT,signal,timeout:0,idleTimeout:15*60*1000});
 const meta=await probe(partial,{signal});if(format==='shorts'&&meta.duration>180.5)throw new Error('The Shorts summary is over three minutes. Choose a shorter length.');fs.renameSync(partial,file);
 const best=parts.reduce((a,b)=>b.score>a.score?b:a);await run('ffmpeg',['-v','error','-y','-ss',String(Math.min(1.5,best.duration/2)),'-i',best.file,'-frames:v','1','-vf',format==='video'?'scale=1280:720':'scale=720:1280',path.join(folder,'exports','stream-summary.jpg')],{cwd:ROOT,signal});
 // Parts were only inputs to the join; remove them so a multi-gigabyte stream does not leave duplicates behind.
 for(const p of parts)for(const ext of ['mp4','json','jpg','srt','txt'])fs.rmSync(p.file.replace(/\.mp4$/,'.'+ext),{force:true});
 onProgress?.(1);
 const summary={clipId:'stream-summary',filename,format,width:meta.width,height:meta.height,duration:meta.duration,bytes:fs.statSync(file).size,targetSeconds:Number(targetSeconds)||SUMMARY_FORMATS[format].defaultTarget,
  moments:parts.map(({file:_,scores:__,...m})=>m),chapters:format==='video'?summaryChapters(parts):[],thumbnail:'stream-summary.jpg',host:stream.host?.name||'',createdAt:new Date().toISOString()};
 return {...summary,metadata:summaryMetadata(job,summary)};
}

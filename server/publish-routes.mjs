import fs from 'node:fs';import path from 'node:path';import {writeClipBatchAI,metadataProviders} from './metadata-ai.mjs';import {streamPeople,clipPeople} from './people.mjs';import {pickHook,titleOptions} from './titles.mjs';import {renderThumbnail,videoPoster} from './thumbnails.mjs';import {placeLabels,withLabels} from './meme-edit.mjs';
import {autoThumbnail} from './autothumb.mjs';
// Publishing extras: a fresh hook and title choices for one clip, and custom thumbnails for main-video posts.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const textIn=(words,a,b)=>words.filter(w=>w.end>a&&w.start<b).map(w=>w.text).join(' ').replace(/\s+/g,' ').trim();
export function registerPublishRoutes(app,{store,posting,env=process.env,fetchImpl,client}={}){
 app.post('/api/jobs/:id/clips/:clipId/hook/ai',async(req,res)=>{
  const job=store.get(req.params.id),clip=job.clips.find(c=>c.id===req.params.clipId);if(!clip)throw fail('Clip not found',404);
  if(!metadataProviders(env).length&&!client)throw fail('Set up AI in .env (a free Gemini or Groq key, or Ollama) to write hooks with AI');
  const folder=store.folder(job.id),file=path.join(folder,'transcript.json'),words=(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).words||[]:[]).map((w,i)=>({...w,text:clip.wordEdits?.[i]??w.text}));
  const people=clipPeople(streamPeople(job,{folder}),textIn(words,clip.start-30,clip.end+15)),transcript=textIn(words,clip.start,clip.end),peak=Number.isFinite(clip.peakAt)?clip.start+clip.peakAt:(clip.start+clip.end)/2;
  let result;try{result=await writeClipBatchAI({format:clip.settings?.outputFormat||job.options?.outputFormat||'shorts',sourceTitle:job.title,contextText:clip.settings?.contextText||job.options?.contextText||'',sourceUrl:job.source?.url||'',clips:[{index:0,category:clip.category,duration:clip.end-clip.start,people,peakLine:textIn(words,peak-4,peak+3),transcript}]},{env,...(fetchImpl?{fetchImpl}:{}),...(client?{client}:{})});}
  catch(error){throw fail(`The AI couldn't write a hook right now (${error.message}). Try again in a minute.`,502);}
  const a=result.clips[0]||{},title=a.title||clip.title;
  res.json({hook:pickHook(a.hook,title,people),titleOptions:titleOptions(clip.title,a.title?[a.title]:[],a.altTitles||[]),model:result.model});
 });
 // Meme-edit action labels for one clip, written from its own transcript; returns the effects list with old automatic labels replaced.
 app.post('/api/jobs/:id/clips/:clipId/labels/ai',async(req,res)=>{
  const job=store.get(req.params.id),clip=job.clips.find(c=>c.id===req.params.clipId);if(!clip)throw fail('Clip not found',404);
  if(!metadataProviders(env).length&&!client)throw fail('Set up AI in .env (a free Gemini or Groq key, or Ollama) to write action labels with AI');
  const range={...clip,start:Number.isFinite(req.body?.start)?req.body.start:clip.start,end:Number.isFinite(req.body?.end)?req.body.end:clip.end};
  const folder=store.folder(job.id),file=path.join(folder,'transcript.json'),words=(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).words||[]:[]).map((w,i)=>({...w,text:clip.wordEdits?.[i]??w.text}));
  let result;try{result=await writeClipBatchAI({format:clip.settings?.outputFormat||job.options?.outputFormat||'shorts',sourceTitle:job.title,contextText:'',clips:[{index:0,category:clip.category,duration:range.end-range.start,people:clipPeople(streamPeople(job,{folder}),textIn(words,range.start,range.end)),transcript:textIn(words,range.start,range.end),labels:true}]},{env,...(fetchImpl?{fetchImpl}:{}),...(client?{client}:{})});}
  catch(error){throw fail(`The AI couldn't write labels right now (${error.message}). Try again in a minute.`,502);}
  const labels=placeLabels(result.clips[0]?.labels,words,range);res.json({labels,effects:withLabels(Array.isArray(req.body?.effects)?req.body.effects:clip.effects,labels),model:result.model});
 });
 const mainVideo=id=>{const p=posting.get(id);if(p.format!=='video')throw fail('Shorts thumbnails can only be chosen in the YouTube mobile app');return p;};
 app.post('/api/posting/:id/thumbnail',async(req,res)=>{
  const p=mainVideo(req.params.id);if(posting.public(p).locked)throw fail('This post already started uploading; set the thumbnail in YouTube Studio',409);
  const time=Number(req.body?.time),text=typeof req.body?.text==='string'?req.body.text:'';if(!Number.isFinite(time)||time<0)throw fail('Choose a frame time');if(text.length>40)throw fail('Keep thumbnail text to 40 characters');
  const temp=path.join(posting.folder(p.id),'thumbnail.next.jpg');
  try{const out=await renderThumbnail(p.file,temp,{time,text});res.json(posting.public(posting.setThumbnail(p.id,{...out,file:temp})));}finally{fs.rmSync(temp,{force:true});}
 });
 // Automatic thumbnail from the clip's project: expressive face cut-out over gameplay, big words, game name.
 // Regular videos get it as their custom thumbnail; Shorts get an image to set in the YouTube app (the API cannot).
 const shortThumb=p=>path.join(posting.folder(p.id),'thumbnail-short.jpg');
 app.post('/api/posting/:id/thumbnail/auto',async(req,res)=>{
  const p=posting.get(req.params.id),src=p.source||{};if(posting.public(p).locked)throw fail('This post already started uploading; set the thumbnail in YouTube Studio',409);
  const text=typeof req.body?.text==='string'?req.body.text.trim():undefined;if(text!==undefined&&text.length>40)throw fail('Keep thumbnail text to 40 characters');
  let job;try{job=store.get(src.jobId);}catch{throw fail('This post is not linked to a project, so pick a frame instead',409);}
  const clip=job.clips?.find(c=>c.id===src.clipId);if(!clip)throw fail('This post is not linked to a clip, so pick a frame instead',409);
  const temp=path.join(posting.folder(p.id),'thumbnail.auto.jpg');
  try{const made=await autoThumbnail(job,store.folder(job.id),clip,temp,{text,live:req.body?.live===true});
   if(p.format==='video')return res.json(posting.public(posting.setThumbnail(p.id,{time:null,text:made.text,file:temp,auto:true})));
   fs.copyFileSync(temp,shortThumb(p));res.json({...posting.public(p),shortThumbnail:{url:`/api/posting/${p.id}/thumbnail/short?v=${Date.now()}`,text:made.text}});}
  finally{fs.rmSync(temp,{force:true});}
 });
 // Preview picture of a post: its custom thumbnail, its Shorts thumbnail image, or a frame of its video.
 app.get('/api/posting/:id/poster',async(req,res)=>{const p=posting.get(req.params.id);let file=[posting.thumbnailFile(p.id),shortThumb(p)].find(f=>fs.existsSync(f));
  if(!file)try{file=await videoPoster(p.file,path.join(posting.folder(p.id),'poster.jpg'));}catch(e){throw fail(e.message,404);}
  res.set('Cache-Control','no-cache').sendFile(file,{dotfiles:'allow'});});
 // Preview picture of a finished clip, for the Post dialog: the render's own still, or a frame of the export.
 app.get('/api/jobs/:id/clips/:clipId/poster',async(req,res)=>{const job=store.get(req.params.id),output=(job.exports||[]).find(e=>e.clipId===req.params.clipId);if(!output||!/^[\w-]+$/.test(output.clipId))throw fail('This clip has no video yet',404);
  const dir=path.join(store.folder(job.id),'exports'),still=path.join(dir,`${output.clipId}.jpg`),video=path.join(dir,`${output.clipId}.mp4`);let file=still;
  try{if(!fs.existsSync(still)||fs.statSync(still).mtimeMs<fs.statSync(video).mtimeMs)file=await videoPoster(video,path.join(dir,`${output.clipId}.poster.jpg`));}catch(e){throw fail(e.message,404);}
  res.set('Cache-Control','no-cache').sendFile(file,{dotfiles:'allow'});});
 app.get('/api/posting/:id/thumbnail/short',(req,res)=>{const file=shortThumb(posting.get(req.params.id));if(!fs.existsSync(file))throw fail('No thumbnail image yet',404);res.set('Cache-Control','no-store').sendFile(file,{dotfiles:'allow'});});
 app.get('/api/posting/:id/thumbnail',(req,res)=>{const file=posting.thumbnailFile(posting.get(req.params.id).id);if(!fs.existsSync(file))throw fail('No custom thumbnail yet',404);res.set('Cache-Control','no-store').sendFile(file,{dotfiles:'allow'});});
 app.delete('/api/posting/:id/thumbnail',(req,res)=>res.json(posting.public(posting.clearThumbnail(mainVideo(req.params.id).id))));
}

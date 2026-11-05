import {placeLabels,withLabels} from './meme-edit.mjs';import {validateOptions} from './options.mjs';
import {writeClipBatchAI,metadataProviders} from './metadata-ai.mjs';import {publicationMetadata,sourceName,templateMetadata,packageWithTemplate,shapeTitle,stripEmoji,hostName} from './context.mjs';import {EDIT_TEMPLATES} from './templates.mjs';
import {streamPeople,clipPeople} from './people.mjs';import {localTitles} from './selection.mjs';import {maskProfanity} from './moments.mjs';import {cueSums} from './moments.mjs';
// Hooks, clip titles and YouTube packaging for every clip in a project: one batched AI request when a key is set,
// local who-did-what titles otherwise. Owner edits (titleEdited, hookEdited, owner-edited metadata) are never replaced.
const textIn=(words,a,b)=>words.filter(w=>w.end>a&&w.start<b).map(w=>w.text).join(' ').replace(/\s+/g,' ').trim();
const hashtag=s=>'#'+String(s||'').replace(/[^\p{L}\p{N}]/gu,'');

/** Local packaging: who-did-what title, short clean description with credit, people-based tags. */
export function localMetadata(clip,job,people,{templates=EDIT_TEMPLATES}={}){
 const base=publicationMetadata(clip,job,{},{templates}),host=people[0]?.name,isShort=(clip.settings?.outputFormat||job.options?.outputFormat||'shorts')!=='video',source=maskProfanity(sourceName(job.title).replace(/[^\p{L}\p{N}\s'&!?.,:-]/gu,'').replace(/\s+/g,' ').trim());
 const lines=[clip.title,host?`${host}${source?` · ${source}`:''}`:source].filter(Boolean);
 if(job.source?.url)lines.push('',`Full stream: ${job.source.url}`,host?`All credit to ${host}.`:'All credit to the streamer.');
 const tags=[...new Set([...people.flatMap(p=>[p.name,`${p.name} clips`]),'stream highlights','funny stream moments',...(base.tags||[]).filter(t=>!/^(?:yeah|like|that|what)$/i.test(t))])].slice(0,15);
 const hashtags=[...new Set([...(host?[hashtag(host)]:[]),...(isShort?['#Shorts']:[])])].slice(0,3);
 const out={...base,title:clip.title,description:[...lines,'',hashtags.join(' ')].join('\n').trim(),tags,categoryId:'24',generatedBy:'local who-did-what'};
 // Template packaging (case, emoji, hashtags, description layout) when the clip's edit template defines it.
 const meta=templateMetadata(clip,job,templates);
 return meta?packageWithTemplate(out,meta,{host:hostName(job,people),people,seed:clip.id||clip.title,context:clip.contextText||job.options?.contextText||'',source:[host,source].filter(Boolean).join(' · '),sourceUrl:job.source?.url||'',isShort}):out;
}
/** YouTube-facing title in the clip's template shape (unchanged without template metadata); `k` varies the emoji per option. */
export const youtubeTitle=(title,clip,job,people=[],{templates=EDIT_TEMPLATES,k=0,max=100}={})=>{const meta=templateMetadata(clip,job,templates);return meta?shapeTitle(title,{...meta,maxLength:Math.min(meta.maxLength,max)},{seed:`${clip.id||clip.title}${k?`:${k}`:''}`,people}):title;};

// The on-screen hook must say who did what. Quote-only or nameless hooks fall back to a shortened title.
const tidy=t=>String(t||'').replace(/\b([Aa]) (?=[aeiouAEIOU])/g,'$1n ').replace(/\s+/g,' ').trim();
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),wordRe=w=>new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}(?=$|[^\\p{L}\\p{N}])`,'iu');
function usableHook(hook,people){const h=tidy(hook);if(!h||/^["“'‘]/.test(h)||/["”]$/.test(h)||/^(\S+ ){1,2}reacts( live)?( on stream)?$/i.test(h))return false;const names=people.flatMap(p=>[p.name,p.short]).filter(Boolean);return !names.length||names.some(n=>wordRe(n).test(h));}
function hookFromTitle(title,people){let h=tidy(title);for(const p of people)if(p.short&&p.short!==p.name)h=h.replace(wordRe(p.name),m=>m.replace(new RegExp(escapeRe(p.name),'i'),p.short));h=h.replace(/\s+(on stream|live on stream|at the (amp )?(halloween )?party)$/i,'');const w=h.split(' ');return w.length>7?w.slice(0,7).join(' '):h;}
// Hooks are drawn by the renderer, whose fonts have no emoji glyphs, so emoji never reach them.
export const pickHook=(candidate,title,people)=>{const c=stripEmoji(candidate),t=stripEmoji(title);return usableHook(c,people)?tidy(c):hookFromTitle(t,people);};

// Title choices for the editor: the current title first, then distinct alternatives, each at most 60 characters.
export const titleOptions=(...list)=>{const seen=new Set();return list.flat().map(t=>tidy(t)).filter(t=>{const key=stripEmoji(t).toLowerCase();return t&&t.length<=60&&!seen.has(key)&&seen.add(key);}).slice(0,3);};
/** Whether a clip's edit asks for meme action labels (its own settings over the project's, template defaults included). */
export const wantsLabels=(clip,job)=>{try{return validateOptions({...job.options,...clip.settings}).actionLabels;}catch{return false;}};
export async function titleClips(job,clips,transcript,{folder,env=process.env,fetchImpl,client,onStage,templates=EDIT_TEMPLATES}={}){
 const words=transcript.words||[],stream=streamPeople(job,{folder}),cues=cueSums(words),yt=(t,c,people,k)=>youtubeTitle(t,c,job,people,{templates,k,max:60});
 const items=clips.map((c,index)=>{
  const nearby=textIn(words,c.start-30,c.end+15),people=clipPeople(stream,nearby),text=textIn(words,c.start,c.end);
  const peak=Number.isFinite(c.peakAt)?c.start+c.peakAt:(c.start+c.end)/2,peakLine=textIn(words,peak-4,peak+3);
  const i=words.findIndex(w=>w.end>c.start),j=words.findLastIndex(w=>w.start<c.end),laughs=i>=0&&j>=i?cues.range('laugh',i,j+1):0;
  const local=localTitles(text,{category:c.category,peakText:peakLine,people,counts:{laughs}});
  return {index,people,text,peakLine,local};
 });
 // Local titles first, so every clip has a who-did-what title even if the AI call fails.
 let out=clips.map((c,k)=>{const {local,people}=items[k],title=c.titleEdited?c.title:tidy(local.title),hook=c.hookEdited?c.hook:pickHook(local.hook,title,people);const next={...c,title,hook,titleOptions:titleOptions(yt(title,c,people)),titleSource:c.titleEdited?'owner':'local',settings:{...c.settings,...(c.hookEdited?{}:{hookText:hook})}};return {...next,metadata:c.metadata?.generatedBy==='owner edited'?c.metadata:localMetadata(next,job,people,{templates})};});
 let aiTitles={status:'skipped',provider:null,model:null};
 if(!metadataProviders(env).length&&!client)return {clips:out,aiTitles:{...aiTitles,error:'No AI key set; using local titles'}};
 onStage?.('Writing hooks and titles');
 try{
  const result=await writeClipBatchAI({format:job.options?.outputFormat||'shorts',sourceTitle:sourceName(job.title),contextText:job.options?.contextText||'',sourceUrl:job.source?.url||'',clips:clips.map((c,k)=>{const template=templateMetadata(c,job,templates);return {index:k,category:c.category,duration:c.end-c.start,people:items[k].people,peakLine:items[k].peakLine,transcript:items[k].text,...(template?{template,seed:c.id||k}:{}),...(wantsLabels(c,job)?{labels:true}:{})};})},{env,...(fetchImpl?{fetchImpl}:{}),...(client?{client}:{})});
  out=out.map((c,k)=>{const a=result.clips[k]||{};const title=!c.titleEdited&&a.title?tidy(a.title):c.title,hook=c.hookEdited?c.hook:pickHook(a.hook||c.hook,title,items[k].people);const next={...c,title,hook,titleOptions:titleOptions(yt(title,c,items[k].people),(c.titleEdited&&a.title?[a.title]:[]).map(t=>yt(t,c,items[k].people,1)),(a.altTitles||[]).map((t,n)=>yt(t,c,items[k].people,n+2))),titleSource:c.titleEdited?'owner':a.title?'ai':c.titleSource,settings:{...c.settings,...(c.hookEdited?{}:{hookText:hook})}};
   const people=items[k].people,meta=templateMetadata(c,job,templates),ai=a.metadata&&{...localMetadata(next,job,people,{templates}),...a.metadata,categoryId:'24',generatedBy:`ai:${result.model}`};
   // AI packaging goes through the same template shaping, so case, emoji, length and hashtags hold even if the model ignored them.
   const shaped=ai&&meta?packageWithTemplate(ai,meta,{host:hostName(job,people),people,seed:c.id||c.title,source:[people[0]?.name,sourceName(job.title)].filter(Boolean).join(' · '),sourceUrl:job.source?.url||'',isShort:(c.settings?.outputFormat||job.options?.outputFormat||'shorts')!=='video'}):ai;
   const metadata=c.metadata?.generatedBy==='owner edited'?c.metadata:shaped||localMetadata(next,job,people,{templates});const labels=a.labels&&wantsLabels(c,job)?placeLabels(a.labels,words,c):null;return {...next,metadata,...(labels?{effects:withLabels(c.effects,labels)}:{})};});
  aiTitles={status:'done',provider:result.provider,model:result.model,...(result.partial?{error:`Some clips kept local titles: ${result.error}`}:{})};
 }catch(error){aiTitles={status:'failed',provider:metadataProviders(env)[0]||null,model:null,error:error.message};}
 return {clips:out,aiTitles};
}

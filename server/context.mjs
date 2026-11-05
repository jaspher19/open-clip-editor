import {EDIT_TEMPLATES} from './templates.mjs';import {titleCase} from './selection.mjs';
const stop=new Set('the a an and or but this that these those with from into have has are was were they them their your you we our its it is to of for on in at as be been not just like what how can will'.split(' '));
for(const word of 'do does did say says said gonna gotta wanna uh um yeah bro man hey okay alright yo look oh know really well get got fuck fucking shit bitch damn ass'.split(' '))stop.add(word);
/** The stream's name as viewers should see it: no working labels like "[TEST]" or "(copy)", no emoji. */
export const sourceName=title=>String(title||'').replace(/[[(](?:test|copy|draft|wip|old|new|v\d+)[\])]/gi,' ').replace(/[^\p{L}\p{N}\s'&!?.,:#-]/gu,' ').replace(/\s+/g,' ').trim();
const content=text=>(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]).filter(w=>!stop.has(w));
const textOf=words=>words.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim();
function short(value,max){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max);}
export function enrichClip(clip,transcript,job){
 const words=(transcript.words||[]).map((w,i)=>({...w,text:clip.wordEdits?.[i]??w.text})),inside=words.filter(w=>w.end>clip.start&&w.start<clip.end),text=textOf(inside);
 const sentences=text.match(/[^.!?,]+[.!?]?/g)||[text],counts=new Map();for(const w of content(text))counts.set(w,(counts.get(w)||0)+1);const useful=sentences.map(s=>s.trim()).filter(s=>s.split(/\s+/).length>=5&&new Set(content(s)).size>=2).sort((a,b)=>{const score=s=>[...new Set(content(s))].reduce((n,w)=>n+1+Math.min(3,counts.get(w)||0),0)-Math.max(0,s.length-100)*.08;return score(b)-score(a);});
 // Picker and AI titles (who-did-what) are kept; only untitled legacy clips fall back to the most useful sentence.
 const title=clip.titleEdited||clip.titleSource?short(clip.title,100):short(clip.title,100).split(/\s+/).length>=5&&new Set(content(clip.title)).size>=2?short(clip.title,100):short(useful[0]||text,90)||'Selected moment';
 const sourceContext={before:textOf(words.filter(w=>w.end<=clip.start&&w.start>=clip.start-20)).slice(-650),after:textOf(words.filter(w=>w.start>=clip.end&&w.start<clip.end+15)).slice(0,500),transcript:text.slice(0,2400)};
 // Older clips saved the raw stream title as context; show it the way viewers should see it.
 const given=clip.settings?.contextText||job.options?.contextText||clip.contextText,contextText=short((given&&given===job.title?sourceName(given):given)||((job.title&&!/\.(mp4|mov|mkv|webm)$/i.test(job.title))?sourceName(job.title):sourceContext.before.split(/[.!?]/).filter(s=>s.trim().split(/\s+/).length>=5).at(-1)),140);
 const enriched={...clip,title,contextText,sourceContext};return {...enriched,metadata:clip.metadata?.generatedBy==='owner edited'||/^(?:ai:|local who-did-what)/.test(clip.metadata?.generatedBy||'')?clip.metadata:publicationMetadata(enriched,job)};
}
export function publicationMetadata(clip,job={},rules={},{templates=EDIT_TEMPLATES}={}){
 const isShort=(rules.format||clip.settings?.outputFormat||job.options?.outputFormat||'shorts')!=='video';const values={title:clip.title||'Selected moment',context:clip.contextText||job.options?.contextText||'',sourceTitle:job.title||'',sourceUrl:job.source?.url||'',start:String((Number(clip.start||0)+Number(job.source?.section?.start||0)).toFixed(1)),end:String((Number(clip.end||0)+Number(job.source?.section?.start||0)).toFixed(1)),transcript:clip.sourceContext?.transcript||clip.words?.map(w=>w.text).join(' ')||''};
 const expand=template=>String(template).replace(/\{([a-zA-Z]+)\}/g,(_,key)=>{if(!Object.hasOwn(values,key))throw new Error(`Unknown metadata placeholder: ${key}`);return values[key];});
 const title=short((rules.titlePrefix||'')+expand(rules.titleTemplate||'{title}')+(rules.titleSuffix||''),100).replace(/[<>]/g,'');
 let description=expand(rules.descriptionTemplate||'{context}\n\n{transcript}\n\nSource: {sourceTitle}\n{sourceUrl}\nSource range: {start}–{end}s'+(isShort?'\n\n#Shorts':'' )).trim();while(Buffer.byteLength(description,'utf8')>5000)description=description.slice(0,-1);
 const counts=new Map();for(const term of `${title} ${values.context} ${values.transcript}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[])if(!stop.has(term))counts.set(term,(counts.get(term)||0)+1);
 const tags=[...new Set([...(rules.tags||[]).map(t=>short(t,50)),...[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([t])=>t),...(isShort?['Shorts']:[])])].filter(Boolean);while(tags.join(',').length>440)tags.pop();
 const out={title:title||'Selected moment',description,tags,categoryId:String(rules.categoryId||'22'),language:job.transcriptSummary?.language||job.options?.language||'en',generatedBy:'local extractive metadata',needsReview:true};
 // A recipe's own title/description templates win; otherwise the clip's edit template packaging applies.
 const meta=rules.titleTemplate||rules.descriptionTemplate?null:templateMetadata(clip,job,templates);
 return meta?packageWithTemplate(out,meta,{host:hostName(job),seed:clip.id||clip.title,context:values.context,source:sourceName(job.title),sourceUrl:values.sourceUrl,isShort}):out;
}

// Per-template YouTube packaging (presets/edits.json → `metadata`): case, trailing emoji, length, hashtags and the
// description layout. Only YouTube titles get emoji; on-screen hooks never do (the renderer's fonts are monochrome).
const EMOJI_SRC='\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*)*',EMOJI=new RegExp(EMOJI_SRC,'gu'),ONE_EMOJI=new RegExp(`^(?:${EMOJI_SRC})$`,'u');
export const stripEmoji=s=>!/[\p{Extended_Pictographic}‍️]/u.test(String(s||''))?String(s||''):String(s).replace(EMOJI,' ').replace(/[️‍]/gu,'').replace(/\s+([!?.,…])/g,'$1').replace(/\s+/g,' ').trim();
const CASES=['title','upper','sentence'],clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
/** Validated template metadata, or null when the template has none. */
export function normalizeTemplateMeta(m){
 if(!m||typeof m!=='object'||Array.isArray(m))return null;const list=a=>Array.isArray(a)?a.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):[];
 const emoji=[...new Set(list(m.emoji).filter(e=>ONE_EMOJI.test(e)))].slice(0,12),count=Number.isInteger(m.emojiCount)?clamp(m.emojiCount,0,3):Math.min(2,emoji.length);
 return {titleGuide:typeof m.titleGuide==='string'?m.titleGuide.trim().slice(0,300):'',emoji,emojiCount:Math.min(count,emoji.length),case:CASES.includes(m.case)?m.case:null,maxLength:Number.isFinite(Number(m.maxLength))&&m.maxLength!==null&&m.maxLength!==''?clamp(Math.round(Number(m.maxLength)),20,100):60,hashtags:list(m.hashtags).slice(0,15),descriptionTemplate:typeof m.descriptionTemplate==='string'&&m.descriptionTemplate.trim()?m.descriptionTemplate.slice(0,3000):null};
}
/** The packaging rules of the clip's edit template (clip setting first, then the project option). */
export function templateMetadata(clip,job,templates=EDIT_TEMPLATES){const id=clip?.settings?.editTemplate||job?.options?.editTemplate;if(!id||id==='custom')return null;return normalizeTemplateMeta((templates||[]).find(t=>t.id===id)?.metadata);}
export const hostName=(job={},people=[])=>people.find(p=>/host/.test(p.evidence||''))?.name||job.host?.name||(typeof job.host==='string'?job.host:'')||'';
const seedOf=s=>{let h=2166136261;for(const c of String(s??''))h=Math.imul(h^c.codePointAt(0),16777619)>>>0;return h;};
// Lengths are UTF-16 units, as the upload validator counts them, so an emoji costs 2.
const cut=(s,max)=>{if(s.length<=max)return s;const head=s.slice(0,max+1),words=head.replace(/\s+\S*$/,'');let out=(words&&words!==head?words:s.slice(0,max).replace(/[\uD800-\uDBFF]$/,'')).replace(/[\s,;:–—-]+$/,'');for(let t;(t=out.replace(/\s+(?:a|an|the|by|of|to|in|on|at|for|with|and|or|but|his|her|my|your|their|is|was)$/i,''))!==out&&t;)out=t.replace(/[\s,;:–—-]+$/,'');return out;};
function applyCase(text,mode,people=[]){
 if(mode==='upper')return text.toUpperCase();if(mode==='title')return titleCase(/\p{Ll}/u.test(text)?text:text.toLowerCase());if(mode!=='sentence')return text;
 const names=new Map(people.flatMap(p=>`${p.name||''} ${p.short||''}`.split(/\s+/)).filter(Boolean).map(w=>[w.toLowerCase(),w])),base=/\p{Ll}/u.test(text)?text:text.toLowerCase();
 const s=base.replace(/[\p{L}\p{N}'’]+/gu,w=>names.get(w.toLowerCase())||(w==='I'||/\p{Ll}\p{Lu}|\d/u.test(w)?w:w.toLowerCase()));return s.replace(/\p{L}/u,c=>c.toUpperCase());
}
/** YouTube title in the template's shape: no hashtags, the template's case, then `emojiCount` emoji at the end, at most
 * `maxLength` characters without cutting a word. Emoji already in the title are kept when they fit the rule (idempotent). */
export function shapeTitle(title,meta,{seed,people=[]}={}){
 const m=normalizeTemplateMeta(meta);if(!m)return String(title||'');const raw=String(title||''),found=[...new Set(raw.match(EMOJI)||[])];
 const text=applyCase(stripEmoji(raw).replace(/(^|\s)#[\p{L}\p{N}_]+/gu,'$1').replace(/\s+/g,' ').trim(),m.case,people);
 const start=seedOf(seed??text)%(m.emoji.length||1),picked=found.length===m.emojiCount&&found.every(e=>m.emoji.includes(e))?found:Array.from({length:m.emojiCount},(_,i)=>m.emoji[(start+i)%m.emoji.length]);
 const tail=picked.join(''),body=cut(text,m.maxLength-(tail?tail.length+1:0));return tail?`${body} ${tail}`.trim():body;
}
/** Template hashtags with `{host}` filled (dropped when the host is unknown), deduped, at most 5, `#Shorts` kept for Shorts. */
export function resolveHashtags(list,{host,isShort}={}){
 const h=String(host||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),out=[];
 for(const raw of list||[]){if(/\{host\}/i.test(raw)&&!h)continue;const tag='#'+String(raw).replace(/\{host\}/gi,h).replace(/^#+/,'').replace(/[^\p{L}\p{N}_]/gu,'');if(tag.length>1&&!(isShort===false&&tag.toLowerCase()==='#shorts')&&!out.some(t=>t.toLowerCase()===tag.toLowerCase()))out.push(tag);}
 if(isShort){const i=out.findIndex(t=>t.toLowerCase()==='#shorts');if(i<0||i>=5)out.unshift(i<0?'#Shorts':out.splice(i,1)[0]);}
 return out.slice(0,5);
}
const tagCost=tags=>tags.reduce((n,t,i)=>n+t.length+(t.includes(' ')?2:0)+(i?1:0),0);
/** Applies template packaging to a {title, description, tags} draft. Without `context`, the draft's own description
 * (minus a repeated title line, hashtag lines and the credit link) becomes `{context}`. */
export function packageWithTemplate(metadata,meta,{host,people=[],seed,context,source='',sourceUrl='',isShort=true}={}){
 const m=normalizeTemplateMeta(meta);if(!m)return metadata;const title=(shapeTitle(metadata.title,m,{seed,people})||metadata.title).replace(/[<>]/g,''),hashtags=resolveHashtags(m.hashtags,{host,isShort});
 const lines=String(metadata.description||'').split('\n'),plain=stripEmoji(metadata.title).trim().toLowerCase(),repeat=l=>{const s=stripEmoji(l).trim().toLowerCase();return s===plain||(s.length>=10&&plain.startsWith(s));};
 const body=context??lines.filter((l,i)=>!(i===0&&repeat(l))&&!/^\s*(?:#[\p{L}\p{N}_]+\s*)+$/u.test(l)&&!(sourceUrl&&l.includes(sourceUrl))).join('\n').trim();
 let description=m.descriptionTemplate?m.descriptionTemplate.replace(/\{([a-zA-Z]+)\}/g,(_,k)=>({title,context:body,source:source||host||'',hashtags:hashtags.join(' '),sourceUrl})[k]??''):[...lines.filter(l=>!/^\s*(?:#[\p{L}\p{N}_]+\s*)+$/u.test(l)),'',hashtags.join(' ')].join('\n');
 description=description.replace(/[<>]/g,'').replace(/^[^\n:]{1,30}:[ \t]*$/gm,'').replace(/[ \t]+$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
 if(sourceUrl&&!description.includes(sourceUrl))description+=`\n\nFull stream: ${sourceUrl}`;if(isShort&&!/#shorts\b/i.test(description))description+='\n\n#Shorts';
 while(Buffer.byteLength(description,'utf8')>5000)description=description.slice(0,-1);
 const words=new Set(hashtags.map(t=>t.slice(1).toLowerCase())),tags=[];for(const t of [...(metadata.tags||[]),...hashtags.map(t=>t.slice(1))].map(t=>short(t,50)).filter(Boolean))if(!tags.some(x=>x.toLowerCase()===t.toLowerCase()))tags.push(t);
 while(tagCost(tags)>440){const i=tags.findLastIndex(t=>!words.has(t.toLowerCase()));tags.splice(i<0?tags.length-1:i,1);}
 return {...metadata,title,description,tags,hashtags};
}

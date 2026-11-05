import Anthropic from '@anthropic-ai/sdk';import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';import {z} from 'zod';
import {dropProfanity} from './moments.mjs';import {titleCase} from './selection.mjs';import {unsupportedNames} from './people.mjs';import {shapeTitle,stripEmoji,normalizeTemplateMeta} from './context.mjs';
// AI writes YouTube packaging from what was actually said in the clip; local code re-enforces YouTube's hard limits.
const MODEL='claude-opus-5-5';
const Draft=z.object({
 title:z.string().describe('Who-did-what hook title in Title Case, ideally 45-70 characters, never over 100'),
 description:z.string().describe('First two lines are the hook shown in search; then a short summary; then any chapters exactly as given'),
 hashtags:z.array(z.string()).describe('Up to 3 hashtags, most relevant first'),
 tags:z.array(z.string()).describe('8-15 relevant search tags'),
 rationale:z.string().describe('One or two sentences on why this packaging should perform, for the creator')
});
export const WHO_DID_WHAT=`Titles say WHO did WHAT, matching the actual video, like top clip channels:
  "Kai Cenat Gets Scared By A Fake Spider", "Speed Climbs A Pole On Stream", "Duke Dennis Roasts Kai's Costume".
  Pattern: <Person> <does/gets/reacts…> <specific thing>, Title Case, 4-9 words, at most 60 characters.
  Use only the people listed for that clip (the host is always allowed). Use the name fans use (e.g. "Speed", "Kai Cenat"). If nobody is listed, use a neutral subject such as "Streamer" — never guess a name.
  Never use category labels or filler as a title ("WORTH IT", "CLIP THIS", "FUN MOMENT", "Ayo") and never paste a raw transcript line. No swearing or slurs in titles or hooks.`;
const SYSTEM=`You package livestream clips for YouTube. Write metadata that makes the right viewers click and keeps the promise the title makes.

Rules:
- Stay truthful to the transcript and context you are given. No invented events, quotes, guests, results, years, dates, places, platforms or claims (do not add a year unless the given text states it). Names may come only from the people list, the transcript, the source title or the creator's context.
- ${WHO_DID_WHAT}
- The title is a hook: lead with the most surprising, funny or high-stakes part of the moment, in plain words people search for. Curiosity is good; misleading bait is not. Avoid an all-caps title (one emphasized word is fine) and emoji spam.
- The first two description lines appear in search results, so make them a second hook plus who and what it is. Keep the description short and readable, and credit the streamer.
- Use at most 3 hashtags; YouTube shows the first three above the title.
- Tags should be specific search phrases (people, show, game, event, topic), not repeats of one word, and never words like "profanity", "insult" or "drama". Tag stuffing breaks YouTube's spam policy.
- If trending titles are provided, borrow their style and phrasing patterns only. Do not copy them and do not claim connections that are not in the clip.
- Write in the language of the transcript.`;

const clean=s=>String(s||'').replace(/<\/?[a-z][^>]*>/gi,'').replace(/[<>]/g,'').trim();
const cutWords=(s,max)=>s.length<=max?s:s.slice(0,max+1).replace(/\s+\S*$/,'').replace(/[,;:\s]+$/,'');
/** Enforce YouTube's hard limits no matter what the model returned. */
export function finishDraft(draft,{chapters=[]}={}){
 const title=cutWords(dropProfanity(clean(draft.title)).replace(/\s+/g,' '),100);
 const hashtags=[...new Set((draft.hashtags||[]).map(h=>'#'+clean(h).replace(/^#+/,'').replace(/[^\p{L}\p{N}_]/gu,'')).filter(h=>h.length>1))].slice(0,3);
 const tags=[];let chars=0;for(const t of (draft.tags||[]).map(t=>clean(t).replace(/,/g,' ').replace(/\s+/g,' ')).filter(Boolean)){if(tags.some(x=>x.toLowerCase()===t.toLowerCase()))continue;const cost=t.length+(t.includes(' ')?2:0)+(tags.length?1:0);if(chars+cost>440)break;tags.push(t);chars+=cost;}
 let description=clean(draft.description);const missing=chapters.filter(c=>!description.includes(c.line));if(missing.length===chapters.length&&chapters.length)description+='\n\nChapters\n'+chapters.map(c=>c.line).join('\n');
 if(hashtags.length&&!hashtags.every(h=>description.includes(h)))description+='\n\n'+hashtags.join(' ');
 while(Buffer.byteLength(description)>5000)description=description.slice(0,-100);
 return {title,description,tags,hashtags,rationale:clean(draft.rationale).slice(0,400)};
}

const peopleLine=people=>people?.length?people.map(p=>`${p.name}${p.short&&p.short!==p.name?` ("${p.short}")`:''} — ${p.evidence}`).join('; '):'nobody identified (use a neutral subject)';
export function metadataPrompt({kind,format,sourceTitle,contextText,transcript,moments=[],chapters=[],trending=[],sourceUrl,people}){
 const lines=[`Package this as a YouTube ${format==='shorts'?'Short (vertical, under 3 minutes)':'regular video (16:9)'}.`,`Source stream: ${clean(sourceTitle)||'unknown'}`,`People with evidence: ${peopleLine(people)}`];
 if(contextText)lines.push(`Creator's context: ${clean(contextText)}`);if(sourceUrl)lines.push(`Credit link for the description: ${sourceUrl}`);
 if(kind==='summary'){lines.push('This is a recap of the best moments of the stream, in order:',...moments.map((m,i)=>`${i+1}. ${clean(m.title)}`));if(chapters.length)lines.push('Include these chapters in the description exactly, one per line:',...chapters.map(c=>c.line));}
 lines.push('','Transcript of what is said in the video:',clean(transcript).slice(0,12000)||'(no speech)');
 if(trending.length)lines.push('','Currently trending in this category and region (style reference only):',...trending.slice(0,12).map(t=>`- ${clean(t.title)}${t.tags.length?` [tags: ${t.tags.slice(0,6).join(', ')}]`:''}`));
 return lines.join('\n');
}

// Free tiers first (Gemini, then Groq) unless METADATA_AI names one; Claude when only its key is set.
const OPEN_PROVIDERS={
 // Gemini's free tier often answers "high demand" for its newest model, so a lighter model is tried next.
 gemini:{label:'Gemini',key:'GEMINI_API_KEY',url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',model:env=>env.GEMINI_MODEL||'gemini-3.8-flash',fallbacks:env=>String(env.GEMINI_FALLBACK_MODELS??'gemini-3.5-flash-lite').split(',').map(s=>s.trim()).filter(Boolean)},
 groq:{label:'Groq',key:'GROQ_API_KEY',url:'https://api.groq.com/openai/v1/chat/completions',model:env=>env.GROQ_MODEL||'openai/gpt-oss-120b',fallbacks:()=>[]}
};
const modelsOf=(p,env)=>[...new Set([p.model(env),...p.fallbacks(env)])];
const hasClaude=env=>!!(env.ANTHROPIC_API_KEY||env.ANTHROPIC_AUTH_TOKEN);
/** Providers to try in order; a busy or rate-limited one hands over to the next. */
export function metadataProviders(env=process.env){
 const pick=String(env.METADATA_AI||'').toLowerCase();
 if(pick==='claude')return hasClaude(env)?['claude']:[];if(OPEN_PROVIDERS[pick])return env[OPEN_PROVIDERS[pick].key]?[pick]:[];
 return [...Object.keys(OPEN_PROVIDERS).filter(id=>env[OPEN_PROVIDERS[id].key]),...(hasClaude(env)?['claude']:[])];
}
export const metadataProvider=env=>metadataProviders(env)[0]||null;
const busy=message=>Object.assign(new Error(message),{busy:true});

async function askOpenProvider(id,{schema,system,user,env,fetchImpl,retryDelays,timeout,model}){
 const p=OPEN_PROVIDERS[id],shape=JSON.stringify(z.toJSONSchema(schema));let response,temperature=.8,jsonRetry=false;model||=p.model(env);
 for(let attempt=0;;attempt++){
  try{response=await fetchImpl(p.url,{method:'POST',signal:AbortSignal.timeout(timeout),headers:{Authorization:`Bearer ${env[p.key]}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature,response_format:{type:'json_object'},messages:[{role:'system',content:`${system}\n\nReply with ONLY a JSON object matching this schema:\n${shape}`},{role:'user',content:user}]})});}
  catch{throw busy(`Could not reach ${p.label}. Check your internet connection.`);}
  // Free tiers: wait out a short rate-limit hint once; retry overloaded (5xx) replies with backoff.
  const hint=response.status!==429?0:Number(response.headers?.get?.('retry-after'))||Number((typeof response.clone==='function'?await response.clone().text().catch(()=>''):'').match(/try again in ([\d.]+)s/i)?.[1])||0;
  if(response.status===429&&hint>0&&hint<=20&&attempt<1){await new Promise(r=>setTimeout(r,hint*1000+250));continue;}
  // Groq's JSON mode sometimes rejects its own reply ("Failed to validate JSON"); one cooler retry usually fixes it.
  if(response.status===400&&!jsonRetry&&typeof response.clone==='function'&&/validate JSON/i.test(await response.clone().text().catch(()=>''))){jsonRetry=true;temperature=.3;continue;}
  if(response.status<500||attempt>=retryDelays.length)break;await new Promise(r=>setTimeout(r,retryDelays[attempt]));
 }
 const detail=response.ok||typeof response.text!=='function'?'':await response.text().then(t=>{try{return JSON.parse(t).error?.message||t;}catch{return t;}}).then(t=>String(t).replace(/\s+/g,' ').slice(0,160)).catch(()=>'');
 if(response.status===401||response.status===403)throw new Error(`${p.label} rejected the API key. Check ${p.key} in your .env file.`);
 if(response.status===413)throw busy(`${p.label}'s free tier can't take a request this large right now. Trying the next provider.`);
 if(response.status===429)throw busy(`${p.label}'s free tier limit was reached. Wait a minute (or until tomorrow for the daily limit) and try again.`);
 if(response.status>=500)throw busy(`${p.label} is overloaded right now (HTTP ${response.status}). Try again in a minute.`);
 if(!response.ok)throw new Error(`${p.label} request failed (HTTP ${response.status})${detail?`: ${detail}`:''}.`);
 const data=await response.json(),text=String(data.choices?.[0]?.message?.content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 let parsed;try{parsed=schema.safeParse(JSON.parse(text));}catch{parsed={success:false};}
 if(!parsed.success)throw new Error(`${p.label} returned metadata in an unexpected shape. Try again.`);
 return {data:parsed.data,model:data.model||model,provider:id};
}

/** One structured request through the configured providers: free ones first, falling over when busy, then Claude. */
export async function askAI({schema,system,user,maxTokens=16000,timeout=90000},{client,env=process.env,fetchImpl=fetch,retryDelays=[1000,3000],skip}={}){
 const providers=client?['claude']:metadataProviders(env);
 if(!providers.length)throw new Error('No AI key is set. Add a free GEMINI_API_KEY (or GROQ_API_KEY) to .env and restart the app.');
 let lastError;
 // `skip` lets a multi-request batch stop retrying a provider that already proved busy.
 for(const provider of providers.filter(p=>p!=='claude'&&!skip?.has(p))){
  const models=modelsOf(OPEN_PROVIDERS[provider],env);
  for(const [k,model] of models.entries()){try{return await askOpenProvider(provider,{schema,system,user,env,fetchImpl,retryDelays:k<models.length-1?retryDelays.slice(0,1):retryDelays,timeout,model});}catch(error){if(!error.busy)throw error;lastError=error;}}
  skip?.add(provider);
 }
 if(skip&&!lastError&&!providers.includes('claude'))throw new Error('Every AI provider is busy right now.');
 if(!providers.includes('claude'))throw lastError;
 client??=new Anthropic();let response;
 try{response=await client.beta.messages.parse({model:MODEL,max_tokens:maxTokens,betas:['server-side-fallback-2026-07-01'],fallbacks:'default',output_config:{effort:'medium',format:zodOutputFormat(schema)},system,messages:[{role:'user',content:user}]});}
 catch(error){
  if(error instanceof Anthropic.AuthenticationError)throw new Error('Claude rejected the API key. Check ANTHROPIC_API_KEY in your .env file.');
  if(error instanceof Anthropic.RateLimitError)throw new Error('Claude is rate limiting requests right now. Try again in a minute.');
  if(error instanceof Anthropic.APIConnectionError)throw new Error('Could not reach Claude. Check your internet connection.');
  if(error instanceof Anthropic.APIError)throw new Error(`Claude request failed (${error.status}): ${error.message}`);
  throw error;
 }
 if(response.stop_reason==='refusal')throw new Error('Claude declined to write metadata for this clip. Write the title and description yourself.');
 if(!response.parsed_output)throw new Error('Claude returned metadata in an unexpected shape. Try again.');
 return {data:response.parsed_output,model:response.model,provider:'claude'};
}

export async function writeMetadataAI(input,options={}){
 const {data,model}=await askAI({schema:Draft,system:SYSTEM,user:metadataPrompt(input)},options);
 const out=finishDraft(data,{chapters:input.chapters});
 if(input.people&&unsupportedNames(out.title,input.people).length)out.title=input.fallbackTitle||out.title.replace(new RegExp(unsupportedNames(out.title,input.people).join('|'),'gi'),'').replace(/\s{2,}/g,' ').trim();
 return {...out,model};
}

// Batched hooks and titles for every clip of a project in one request, so a free tier spends one call per stream.
const BatchClip=z.object({
 index:z.coerce.number().int().describe('The clip number given in the prompt'),
 hook:z.string().describe('On-screen hook, at most 6 words, who-did-what or a curiosity line, no swearing'),
 title:z.string().describe('Who-did-what clip title, Title Case, 4-9 words, at most 60 characters'),
 altTitles:z.array(z.string()).optional().describe('1-2 alternative clip titles with a different angle (one reaction-led, one curiosity-led), same who-did-what and no-invention rules, at most 60 characters each'),
 youtubeTitle:z.string().optional().describe('YouTube title: who-did-what hook, 45-70 characters'),
 description:z.string().default('').describe('Two-line hook, one-line summary, credit to the streamer with the link if given'),
 hashtags:z.array(z.string()).default([]).describe('Up to 3 hashtags'),
 tags:z.array(z.string()).default([]).describe('8-15 specific search tags'),
 labels:z.array(z.object({text:z.string().describe('1-3 word action in caps, no asterisks'),after:z.string().describe('The exact 2-5 consecutive transcript words spoken right before the action')})).optional().describe('Only when the clip asks for action labels')
});
const Batch=z.preprocess(v=>Array.isArray(v)?{clips:v}:v?.clip&&!v.clips?{clips:[v.clip]}:v,z.object({clips:z.array(BatchClip)}));
// Meme-edit labels narrate what the speaker does, the way clip editors write *GETS FAT*; they must come from the clip's own words.
export const LABEL_RULE='Action labels: also return 1-4 labels naming a physical action or reveal that the speaker says or plainly shows by their own words (like GETS FAT, RUNS, FALLS, SHOWS PHONE), 1-3 words each, never an opinion, name or insult; each with `after`, copied exactly from the transcript: the 2-5 consecutive words spoken just before it happens. Return no labels when nothing physical happens.';
export function batchPrompt({format='shorts',sourceTitle,contextText,sourceUrl,clips}){
 const lines=[`Write packaging for ${clips.length} clip${clips.length>1?'s':''} cut from one livestream, each as a YouTube ${format==='video'?'regular video (16:9)':'Short (vertical)'}.`,`Source stream: ${clean(sourceTitle)||'unknown'}`];
 if(contextText)lines.push(`Creator's context: ${clean(contextText)}`);if(sourceUrl)lines.push(`Credit link for descriptions: ${sourceUrl}`);
 lines.push('Return one entry per clip with the same index. Each title must match what happens in that clip.');
 for(const c of clips)lines.push('',`Clip ${c.index} (${c.category||'moment'}, ${Math.round(c.duration||0)}s)`,`People with evidence: ${peopleLine(c.people)}`,...(c.template?[templateStyle(c.template)]:[]),...(c.peakLine?[`Peak line: ${clean(c.peakLine).slice(0,200)}`]:[]),...(c.labels?[LABEL_RULE]:[]),`Transcript: ${clean(c.transcript).slice(0,1100)||'(no speech)'}`);
 return lines.join('\n');
}
/** The edit template's title rules as one prompt line (the pattern is abstract; it is never a real title to copy). */
export function templateStyle(meta){
 const t=normalizeTemplateMeta(meta);if(!t)return '';const guide=t.titleGuide.replace(/</g,'[').replace(/>/g,']').replace(/\s+/g,' ');
 return 'YouTube title style: '+[guide&&`follow the pattern ${guide} (a pattern only, fill it with this clip's real people and events)`,t.case&&{title:'Title Case',upper:'ALL CAPS',sentence:'Sentence case'}[t.case],t.emojiCount?`end youtubeTitle and altTitles with ${t.emojiCount} emoji from ${t.emoji.join(' ')}`:'no emoji',`at most ${t.maxLength} characters`,'no hashtags in titles','hook and title stay plain text without emoji'].filter(Boolean).join('; ')+'.';
}
const wordsOf=s=>String(s||'').split(/\s+/).filter(Boolean).length;
// Models sometimes misspell a name by one letter ("Kai Cenet"); snap such words back to the evidence spelling.
const near=(a,b)=>{if(Math.abs(a.length-b.length)>1||a===b)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}return edits+(a.length-i)+(b.length-j)<=1;};
export function fixNames(text,people=[]){const known=[...new Set(people.flatMap(p=>`${p.name} ${p.short||''}`.split(/\s+/)).filter(w=>w.length>=4))];return String(text||'').replace(/[\p{L}\p{N}]{4,}/gu,w=>known.find(k=>near(w.toLowerCase(),k.toLowerCase()))||w);}
/** Returns per-clip packaging; any field that breaks the rules (too long, unsupported name) is left out so callers keep local text. */
export async function writeClipBatchAI(input,{chunk=6,...options}={}){
 const skip=new Set();
 // Chunks keep each request inside free-tier token-per-minute limits; a failed chunk leaves its clips on local titles.
 const byIndex=new Map();let model=null,provider=null,lastError=null;
 for(let k=0;k<input.clips.length;k+=chunk){try{const r=await askAI({schema:Batch,system:SYSTEM,user:batchPrompt({...input,clips:input.clips.slice(k,k+chunk)}),maxTokens:16000,timeout:60000},{...options,skip});const asked=input.clips.slice(k,k+chunk),fit=r.data.clips.length===asked.length&&!r.data.clips.every(c=>asked.some(x=>x.index===c.index));r.data.clips.forEach((c,n)=>byIndex.set(fit?asked[n].index:c.index,c));model??=r.model;provider??=r.provider;}catch(error){lastError=error;}}
 if(!byIndex.size)throw lastError||new Error('The AI returned no titles.');
 const clips=input.clips.map(c=>{
  const a=byIndex.get(c.index);if(!a)return {index:c.index};
  const allowed=c.people||[],named=t=>!unsupportedNames(t,allowed).length;
  // Hooks and clip titles are drawn on screen and name files, so emoji are removed; the template shapes YouTube titles.
  const fix=t=>fixNames(t,allowed),hook=titleCase(fix(dropProfanity(clean(stripEmoji(a.hook))).replace(/^["“]|["”]$/g,'').trim())),title=titleCase(fix(cutWords(dropProfanity(clean(stripEmoji(a.title))).replace(/\s+/g,' '),60)));
  const shape=(t,k,max=100)=>c.template?shapeTitle(t,{...c.template,maxLength:Math.min(normalizeTemplateMeta(c.template).maxLength,max)},{seed:`${c.seed??c.index}${k?`:${k}`:''}`,people:allowed}):t;
  const draft=finishDraft({title:fix(a.youtubeTitle||a.title),description:fix(a.description),hashtags:a.hashtags,tags:(a.tags||[]).map(fix).filter(t=>!/\b(?:profanity|curs(?:e|ing)|swear\w*|insult\w*|drama|cancel\w*)\b/i.test(t)),rationale:''});
  if(input.sourceUrl&&!draft.description.includes(input.sourceUrl))draft.description=`${draft.description}\n\nFull stream: ${input.sourceUrl}`.slice(0,4900);
  draft.title=shape(draft.title,0);
  const alts=[...new Set((a.altTitles||[]).slice(0,2).map(t=>titleCase(fix(cutWords(dropProfanity(clean(t)).replace(/\s+/g,' '),60)))))].filter(t=>wordsOf(stripEmoji(t))>=3&&named(t)&&stripEmoji(t)!==title).map((t,n)=>shape(t,n+2,60));
  return {index:c.index,...(c.labels&&Array.isArray(a.labels)?{labels:a.labels.slice(0,6)}:{}),...(alts.length?{altTitles:alts}:{}),...(hook&&wordsOf(hook)<=6&&named(hook)?{hook}:{}),...(wordsOf(title)>=3&&named(title)?{title}:{}),...(named(draft.title)&&draft.title.length>=10?{metadata:{title:draft.title,description:draft.description,tags:draft.tags}}:{})};
 });
 return {clips,model,provider,partial:!!lastError,error:lastError?.message};
}

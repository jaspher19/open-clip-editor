import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {CACHE} from '../server/config.mjs';import {run} from '../server/process.mjs';
import {parseSourceUrl,jobSource,isRemote} from '../server/sources.mjs';
import {importSource,importMode,formatFor,ensureSection,prefetchSections,readSections,PROXY_AFTER,SECTION_PAD} from '../server/remote.mjs';
import {sourceClip,platformTitle} from '../server/source-clip.mjs';
import {buildClipEdl} from '../server/edl.mjs';import {validateOptions} from '../server/options.mjs';

test('links: YouTube, Twitch and Kick VODs and clips parse to canonical URLs',()=>{
 assert.deepEqual(parseSourceUrl('https://www.twitch.tv/videos/2929997205?t=1h2m3s'),{platform:'twitch',kind:'video',id:'2929997205',url:'https://www.twitch.tv/videos/2929997205'});
 assert.equal(parseSourceUrl('https://m.twitch.tv/summit1g/v/2929997205').url,'https://www.twitch.tv/videos/2929997205');
 assert.deepEqual(parseSourceUrl('https://clips.twitch.tv/FaintLightGullWholeWheat'),{platform:'twitch',kind:'clip',id:'FaintLightGullWholeWheat',url:'https://clips.twitch.tv/FaintLightGullWholeWheat'});
 assert.equal(parseSourceUrl('https://www.twitch.tv/xqc/clip/Brave-Slug-123abc?filter=clips').url,'https://clips.twitch.tv/Brave-Slug-123abc');
 assert.equal(parseSourceUrl('https://clips.twitch.tv/embed?clip=FaintLightGullWholeWheat&parent=x').kind,'clip');
 const kick=parseSourceUrl('https://kick.com/xqc/videos/01A1CC9B-BD28-7038-A94F-2C31B1D48FF4');assert.equal(kick.platform,'kick');assert.equal(kick.kind,'video');assert.equal(kick.url,'https://kick.com/xqc/videos/01a1cc9b-bd28-7038-a94f-2c31b1d48ff4');
 assert.deepEqual(parseSourceUrl('https://kick.com/xqc?clip=clip_01JABCDEF123'),{platform:'kick',kind:'clip',id:'clip_01JABCDEF123',url:'https://kick.com/xqc/clips/clip_01JABCDEF123'});
 assert.equal(parseSourceUrl('https://kick.com/xqc/clips/clip_01JABCDEF123').kind,'clip');
 const yt=parseSourceUrl('https://youtu.be/R6gKMvetXUU');assert.equal(yt.platform,'youtube');assert.equal(yt.url,'https://www.youtube.com/watch?v=R6gKMvetXUU');
 assert.deepEqual(jobSource(kick),{type:'kick',kind:'video',url:kick.url,id:kick.id});assert.equal(jobSource(yt).type,'youtube','YouTube jobs keep their old type');
 assert.ok(isRemote({type:'twitch'})&&isRemote({type:'youtube'})&&!isRemote({type:'upload'})&&!isRemote({type:'local'}));
});
test('links: a Twitch channel imports its live stream so far',()=>{
 assert.deepEqual(parseSourceUrl('https://www.twitch.tv/XQC?sr=a'),{platform:'twitch',kind:'channel',id:'xqc',url:'https://www.twitch.tv/xqc'});
 assert.deepEqual(jobSource(parseSourceUrl('https://m.twitch.tv/jynxzi')),{type:'twitch',kind:'channel',url:'https://www.twitch.tv/jynxzi',id:'jynxzi'});
});
test('links: Kick channels, site pages, lists, look-alike hosts and other sites are refused',()=>{
 for(const [url,why] of [['https://www.twitch.tv/directory',/Twitch channel/],['https://kick.com/xqc',/Kick channel.*last few seconds/],['https://www.twitch.tv/summit1g/videos',/single Twitch/],['https://kick.com/xqc/videos',/single Kick/],['https://kick.com/xqc/clips',/single Kick/],
  ['https://www.twitch.tv/collections/abc',/single Twitch/],['https://www.twitch.tv/videos/abc',/Twitch VOD/],['https://kick.com/xqc/videos/not-a-uuid',/Kick VOD/],['https://twitch.tv.evil.test/videos/2929997205',/Paste a public/],
  ['https://evil.test/kick.com/xqc/videos/01a1cc9b-bd28-7038-a94f-2c31b1d48ff4',/Paste a public/],['https://user:pw@www.twitch.tv/videos/2929997205',/Paste a public/],['https://www.twitch.tv:8443/videos/2929997205',/Paste a public/],
  ['file:///etc/passwd',/Paste a public/],['http://www.youtube.com/watch?v=R6gKMvetXUU',/Paste a public/],['https://youtube.com/playlist?list=abc',/single YouTube video/],['not a url',/Paste a public/]])
  assert.throws(()=>parseSourceUrl(url),why,url);
});
test('import mode: long streams get a light copy, short videos and clip links download whole',()=>{
 assert.equal(importMode({kind:'video'},PROXY_AFTER+1),'proxy');assert.equal(importMode({kind:'video'},PROXY_AFTER),'full');assert.equal(importMode({kind:'clip'},PROXY_AFTER*4),'full');
 assert.match(formatFor('twitch','proxy',360),/height<=360/);assert.match(formatFor('kick','section'),/height<=1080/);assert.match(formatFor('youtube','proxy',360),/\+ba/);
 assert.doesNotMatch(formatFor('twitch','proxy',360),/audio/,'the light copy keeps video, so the editor can preview it');
});

const tmp=name=>{fs.mkdirSync(CACHE,{recursive:true});return fs.mkdtempSync(path.join(CACHE,`${name}-`));};
const info=(over={})=>({title:'GTA RP heist night',uploader:'summit1g',uploader_id:'summit1g',duration:37965,is_live:false,live_status:'was_live',chapters:[{start_time:0,end_time:12752,title:'Grand Theft Auto V'}],categories:['Grand Theft Auto V'],webpage_url:'https://www.twitch.tv/videos/2929997205',...over});
test('import: a 10-hour Twitch VOD downloads a 360p light copy and records how to fetch 1080p sections',async()=>{
 const folder=tmp('import');const calls=[];
 const runCommand=async(cmd,args)=>{calls.push(args);fs.writeFileSync(path.join(folder,'source.mp4'),'x');return {stdout:''};};
 const probeFile=async()=>({duration:37965.2,audioDuration:37965.2,width:640,height:360,fps:30});
 const r=await importSource({type:'twitch',kind:'video',url:'https://www.twitch.tv/videos/2929997205',id:'2929997205'},folder,{runCommand,probeFile,inspect:async()=>info()});
 const download=calls.find(a=>a.includes('-f'));assert.match(download[download.indexOf('-f')+1],/height<=360/);assert.ok(download.includes('--concurrent-fragments'));assert.ok(!download.includes('--max-filesize'));assert.equal(download.at(-1),'https://www.twitch.tv/videos/2929997205');
 assert.deepEqual(r.remote,{platform:'twitch',url:'https://www.twitch.tv/videos/2929997205',proxy:true,proxyHeight:360,duration:37965.2,sourceHeight:null});
 assert.equal(r.title,'GTA RP heist night');assert.equal(r.sourceInfo.uploader,'summit1g');assert.equal(r.sourceInfo.platform,'twitch');assert.deepEqual(r.sourceInfo.chapters,[{start:0,end:12752,title:'Grand Theft Auto V'}]);
 const saved=JSON.parse(fs.readFileSync(path.join(folder,'source.info.json'),'utf8'));assert.equal(saved.uploader,'summit1g');assert.equal(saved.formats,undefined);
 // A short video or a clip downloads whole, with no light copy.
 const clipFolder=tmp('import-clip');const clip=await importSource({type:'twitch',kind:'clip',url:'https://clips.twitch.tv/Abc',id:'Abc'},clipFolder,{runCommand:async()=>{fs.writeFileSync(path.join(clipFolder,'source.mp4'),'x');return {stdout:''};},probeFile:async()=>({duration:30,width:1920,height:1080}),inspect:async()=>info({duration:30})});assert.equal(clip.remote,null);
});
test('import: live, upcoming and over-long streams are refused before downloading',async()=>{
 const folder=tmp('import-live');let downloads=0;const runCommand=async()=>{downloads++;return {stdout:''};};const source={type:'kick',kind:'video',url:'https://kick.com/x/videos/01a1cc9b-bd28-7038-a94f-2c31b1d48ff4'};
 await assert.rejects(importSource(source,folder,{runCommand,inspect:async()=>info({is_live:true})}),/still live/);
 await assert.rejects(importSource(source,folder,{runCommand,inspect:async()=>info({live_status:'post_live'})}),/still being processed/);
 await assert.rejects(importSource(source,folder,{runCommand,inspect:async()=>info({duration:31*3600})}),/30 hours/);
 await assert.rejects(importSource(source,folder,{runCommand,inspect:async()=>info({duration:null})}),/how long/);
 assert.equal(downloads,0);
});

function sectionJob(folder){return {id:'x',sourcePath:path.join(folder,'source.mp4'),remote:{proxy:true,platform:'twitch',url:'https://www.twitch.tv/videos/2929997205',duration:3600}};}
test('sections: one download per window, reused for later clips, shared while in flight, aligned by audio',async()=>{
 const folder=tmp('sections');fs.writeFileSync(path.join(folder,'audio.wav'),'');const job=sectionJob(folder);let downloads=0;
 const probeFile=async f=>{const [,a,b]=path.basename(f,'.mp4').split('-').map(Number);return {duration:b-a,width:1920,height:1080,fps:60};};
 const runCommand=async(cmd,args)=>{downloads++;await new Promise(r=>setTimeout(r,30));const sec=args[args.indexOf('--download-sections')+1].slice(1),[a,b]=sec.split('-');fs.writeFileSync(path.join(folder,'hires',`s-${a}-${b}.mp4`),'x');return {stdout:''};};
 const align=async({expected})=>({start:expected-.12,confidence:.98,aligned:true});
 const [one,two]=await Promise.all([ensureSection(job,folder,100,160,{runCommand,align,probeFile}),ensureSection(job,folder,101,159,{runCommand,align,probeFile})]);
 assert.equal(downloads,1,'the second request waits for the first download');assert.equal(one.file,two.file);
 assert.equal(one.start,100-SECTION_PAD-.12,'the measured start, not the requested one');assert.ok(one.end>=160);
 const again=await ensureSection(job,folder,110,150,{runCommand,align,probeFile});assert.equal(downloads,1,'cached');assert.equal(again.start,one.start);
 await ensureSection(job,folder,900,950,{runCommand,align,probeFile});assert.equal(downloads,2);assert.equal(readSections(folder).length,2);
 // At the very end of the stream, the last second is not required.
 await ensureSection(job,folder,3550,3600.5,{runCommand,align,probeFile});assert.equal(downloads,3);
 await assert.rejects(ensureSection({...job,remote:null},folder,1,2,{runCommand,align,probeFile}),/full-quality source already/);
});
test('sections: a low-quality section (YouTube listed only 144p for a moment) is fetched again, cached ones too',async()=>{
 const folder=tmp('sections-low');fs.writeFileSync(path.join(folder,'audio.wav'),'');const job={...sectionJob(folder),remote:{...sectionJob(folder).remote,sourceHeight:1080}};
 let downloads=0;const heights=[144];const probeFile=async f=>{const [,a,b]=path.basename(f,'.mp4').split('-').map(Number);return {duration:b-a,width:Math.round(heights[0]*16/9),height:heights[0],fps:30};};
 const runCommand=async(cmd,args)=>{downloads++;const sec=args[args.indexOf('--download-sections')+1].slice(1),[a,b]=sec.split('-');fs.writeFileSync(path.join(folder,'hires',`s-${a}-${b}.mp4`),'x');return {stdout:''};};
 const align=async({expected})=>({start:expected,confidence:.98,aligned:true});
 // First answer 144p, the retry 1080p.
 let calls=0;const probe2=async f=>{calls++;return {...(await probeFile(f)),...(calls>1?{width:1920,height:1080}:{})};};
 const got=await ensureSection(job,folder,100,160,{runCommand,align,probeFile:probe2});assert.equal(downloads,2);assert.equal(got.height,1080);
 // Both tries low: kept (better than the 360p copy) and not fetched again.
 const low=async f=>({...(await probeFile(f)),width:426,height:240});
 const kept=await ensureSection(job,folder,900,950,{runCommand,align,probeFile:low});assert.equal(downloads,4);assert.equal(kept.lowAccepted,true);
 await ensureSection(job,folder,905,945,{runCommand,align,probeFile:low});assert.equal(downloads,4,'accepted low section is reused');
 // A low section cached by an older version is fetched again once.
 fs.writeFileSync(path.join(folder,'hires','s-2000-2050.mp4'),'x');
 const list=JSON.parse(fs.readFileSync(path.join(folder,'hires','sections.json'),'utf8'));list.push({file:'s-2000-2050.mp4',requested:[2000,2050],start:2000,end:2050,width:256,height:144,framesChecked:true});fs.writeFileSync(path.join(folder,'hires','sections.json'),JSON.stringify(list));
 const fresh=await ensureSection(job,folder,2010,2040,{runCommand,align,probeFile:async f=>({...(await probeFile(f)),width:1920,height:1080})});assert.equal(downloads,5);assert.equal(fresh.height,1080);
});
test('sections: a cached section whose picture is hidden by a bad edit list is repaired into a new file once',async()=>{
 const folder=tmp('sections-fix');fs.mkdirSync(path.join(folder,'hires'),{recursive:true});const job=sectionJob(folder);
 const name='s-92-138.mp4',src=path.join(folder,'hires',name);
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc=size=64x36:rate=10:duration=2','-f','lavfi','-i','sine=duration=2','-c:v','libx264','-c:a','aac','-shortest',src]);
 fs.writeFileSync(path.join(folder,'hires','sections.json'),JSON.stringify([{file:name,requested:[92,138],start:91.9,end:139,aligned:true,confidence:.98}]));
 let calls=0;const frames=async file=>{calls++;return path.basename(file)===name?{read:1,stored:20}:{read:20,stored:20};};
 const got=await ensureSection(job,folder,100,130,{frames});
 assert.match(got.file,/s-92-138\.fixed\.mp4$/);assert.ok(fs.existsSync(src),'the original is kept');assert.equal(got.start,91.9);
 const list=readSections(folder);assert.equal(list.length,1);assert.equal(list[0].file,'s-92-138.fixed.mp4');assert.equal(list[0].repairedFrom,name);assert.ok(list[0].framesChecked);
 const before=calls;await ensureSection(job,folder,100,130,{frames});assert.equal(calls,before,'checked only once');
});
test('sections: a weak audio match falls back to the requested start; prefetch swallows errors for the render to report',async()=>{
 const {alignSection}=await import('../server/remote.mjs');const folder=tmp('align');
 assert.deepEqual(await alignSection({folder,file:'x',expected:42,runCommand:async()=>({stdout:'{"start":45.1,"shift":3.1,"confidence":0.12}'})}),{start:42,confidence:.12,aligned:false});
 assert.deepEqual(await alignSection({folder,file:'x',expected:42,runCommand:async()=>({stdout:'{"start":41.9,"shift":-0.1,"confidence":0.97}'})}),{start:41.9,confidence:.97,aligned:true});
 assert.equal((await alignSection({folder,file:'x',expected:42,runCommand:async()=>({stdout:'{"start":30,"shift":-12,"confidence":0.99}'})})).aligned,false,'a shift larger than the padding is not trusted');
 assert.equal((await alignSection({folder,file:'x',expected:42,runCommand:async()=>{throw new Error('boom');}})).start,42);
 const seen=[];await prefetchSections(sectionJob(folder),folder,[{start:1,end:2},{start:5,end:6},{start:9,end:10}],{concurrency:2,ensure:async(j,f,a)=>{seen.push(a);if(a===5)throw new Error('network');}});
 assert.deepEqual(seen.sort((a,b)=>a-b),[1,5,9]);await prefetchSections({remote:null},folder,[{start:1,end:2}],{ensure:()=>assert.fail('not a light-copy project')});
});
test('clip links: one clip with pauses kept and the clipper title cleaned for YouTube',()=>{
 const clip=sourceClip({title:'he CRASHED the plane 💀 #gta6 2026-11-17 17:18',source:{type:'twitch',kind:'clip'},options:{}},{duration:42.4},{words:[]});
 assert.equal(clip.start,0);assert.equal(clip.end,42.4);assert.equal(clip.title,'he CRASHED the plane');assert.equal(clip.hook,clip.title);assert.equal(clip.settings.keepPauses,true);assert.match(clip.reasons[1],/without speech/);
 assert.equal(sourceClip({title:'x',source:{type:'kick'},options:{}},{duration:95},{}).end,59.9,'a Short plays at most a minute');
 assert.equal(sourceClip({title:'x',source:{type:'kick'},options:{outputFormat:'video'}},{duration:95},{}).end,95);
 // Real clip titles seen on Kick and Twitch: keyboard mash is not used, words are.
 for(const mash of ['rsetdryftgyhuiojipokp','fgnxtnfxgtfn',',tymdgndnntynty','hcmmcgcgg','zewxrctvybuniomp','etsutrdts'])assert.equal(platformTitle(mash),'',mash);
 for(const real of ['Preach','Level 60 cheeks','summit is done with wow','Look at this clown','Grand Theft Auto'])assert.equal(platformTitle(real),real);
 assert.equal(sourceClip({title:'hcmmcgcgg',sourceInfo:{uploader:'xQc',categories:['Grand Theft Auto V (GTA)']},source:{type:'kick'},options:{}},{duration:40}).title,'xQc in Grand Theft Auto V');
 assert.ok(platformTitle('word '.repeat(20)).length<=60);assert.equal(platformTitle('what the fuck happened'),'what happened');
});
test('keep pauses: the whole range plays even with no words, minus manual cuts',()=>{
 const words=[{start:10,end:10.4,text:'go'},{start:25,end:25.5,text:'now!'}],clip={start:5,end:35,cuts:[{start:20,end:22}]};
 const tight=buildClipEdl(words,clip,validateOptions({}));assert.ok(tight.every(s=>s.end-s.start<10),'normal clips still trim the long pause');
 const kept=buildClipEdl(words,clip,validateOptions({keepPauses:true}));assert.deepEqual(kept.map(s=>[s.start,s.end]),[[5,20],[22,35]]);
 assert.equal(buildClipEdl([],{start:0,end:30},validateOptions({keepPauses:true})).length,1,'a clip with no speech still renders');
 assert.throws(()=>validateOptions({keepPauses:'yes'}),/keepPauses/);
});
test('timeline: a copy whose timestamps start late (Twitch: 62 s) is stream-copied to start at zero',async()=>{
 const {zeroStart}=await import('../server/remote.mjs');const folder=tmp('zero'),file=path.join(folder,'source.mp4');fs.writeFileSync(file,'old');const calls=[];
 const runCommand=start=>async(cmd,args)=>{calls.push([cmd,args]);if(cmd==='ffprobe')return {stdout:`${start}\n`};fs.writeFileSync(args.at(-1),'new');return {stdout:''};};
 assert.equal(await zeroStart(file,{runCommand:runCommand('62.017000')}),62.017);
 const remux=calls.find(c=>c[0]==='ffmpeg')[1];assert.ok(remux.includes('copy'),'no re-encode');assert.equal(fs.readFileSync(file,'utf8'),'new');assert.equal(fs.readdirSync(folder).length,1,'no temp file left');
 calls.length=0;assert.equal(await zeroStart(file,{runCommand:runCommand('0.000000')}),0);assert.equal(calls.filter(c=>c[0]==='ffmpeg').length,0,'already at zero: untouched');
 assert.equal(await zeroStart(file,{runCommand:async()=>{throw new Error('no ffprobe');}}),0);
});

// ---- Streams that are still live ----
const grabbed=(file,{start=0,duration=41000,elapsed=41000}={})=>{fs.writeFileSync(file,'x');return JSON.stringify({done:true,start,duration,elapsed});};
const isGrab=args=>String(args[0]).endsWith('live_grab.py');
test('live: a YouTube stream that is still live imports everything streamed so far',async()=>{
 const folder=tmp('live-yt');const calls=[];
 const runCommand=async(cmd,args,opts={})=>{calls.push(args);if(isGrab(args)){opts.onLine?.(JSON.stringify({stage:'download',progress:.5}));opts.onLine?.(grabbed(args[2]));}return {stdout:''};};
 const progress=[];const r=await importSource({type:'youtube',kind:'video',url:'https://www.youtube.com/watch?v=VZqAPdUvqnQ',id:'VZqAPdUvqnQ'},folder,{runCommand,probeFile:async()=>({duration:41000,width:640,height:360}),inspect:async()=>info({is_live:true,live_status:'is_live',duration:null,release_timestamp:Math.floor(Date.now()/1000)-41000,title:'PLAYING GTA 6 FOR THE FIRST TIME 2026-11-19 08:22'}),onProgress:(p,mode)=>progress.push([p,mode])});
 const grab=calls.find(isGrab);assert.ok(grab,'uses the live worker');
 assert.equal(grab[grab.indexOf('--platform')+1],'youtube');assert.equal(grab[grab.indexOf('--height')+1],'360');assert.ok(!grab.includes('--from'),'from the start');
 assert.equal(r.remote.live,true);assert.equal(r.remote.proxy,true);assert.equal(r.remote.duration,41000);assert.ok(r.remote.liveAt);
 assert.equal(r.title,'PLAYING GTA 6 FOR THE FIRST TIME','the live date stamp is dropped');assert.equal(r.sourceInfo.live.seconds,41000);
 assert.deepEqual(progress,[[.5,'live']]);
});
test('live: a Twitch channel follows its in-progress broadcast; offline channels and channels without broadcasts explain why',async()=>{
 const listing=vod=>async(cmd,args,opts={})=>{if(args.includes('--flat-playlist'))return {stdout:vod?`https://www.twitch.tv/videos/${vod}\n`:''};if(isGrab(args))opts.onLine?.(grabbed(args[2],{duration:21000}));return {stdout:''};};
 const channel={type:'twitch',kind:'channel',id:'jynxzi',url:'https://www.twitch.tv/jynxzi'};
 const folder=tmp('live-tw');
 const r=await importSource(channel,folder,{runCommand:listing('2932568279'),probeFile:async()=>({duration:21000,width:640,height:360}),inspect:async s=>info({is_live:true,live_status:'is_live',duration:21000,webpage_url:s.url})});
 assert.deepEqual(r.resolved,{type:'twitch',kind:'video',id:'2932568279',url:'https://www.twitch.tv/videos/2932568279',channel:'jynxzi'});
 assert.equal(r.remote.url,'https://www.twitch.tv/videos/2932568279');assert.equal(r.remote.live,true);
 // The newest broadcast is an old one: offline, or live without saving broadcasts.
 await assert.rejects(importSource(channel,tmp('live-tw2'),{runCommand:listing('2900000000'),inspect:async s=>info({is_live:false})}),/not live right now/);
 await assert.rejects(importSource(channel,tmp('live-tw3'),{runCommand:listing(null),inspect:async s=>info({is_live:s.url.endsWith('/jynxzi')})}),/does not save past broadcasts/);
});
test('live: sections come straight from the live fragments, and from the normal download once the stream has ended',async()=>{
 const folder=tmp('live-sec');fs.writeFileSync(path.join(folder,'audio.wav'),'');
 const job={id:'x',sourcePath:path.join(folder,'source.mp4'),remote:{proxy:true,live:true,platform:'youtube',url:'https://www.youtube.com/watch?v=VZqAPdUvqnQ',duration:41000}};
 const used=[];const probeFile=async()=>({duration:76,width:1920,height:1080,fps:60});
 const runCommand=async(cmd,args,opts={})=>{if(isGrab(args)){used.push('live');const from=Number(args[args.indexOf('--from')+1]);opts.onLine?.(grabbed(args[2],{start:from+.4}));return {stdout:''};}
  used.push('vod');const sec=args[args.indexOf('--download-sections')+1].slice(1);fs.writeFileSync(path.join(folder,'hires',`s-${sec}.mp4`),'x');return {stdout:''};};
 let expected=null;const align=async a=>{expected=a.expected;return {start:a.expected,confidence:.9,aligned:true};};
 const one=await ensureSection(job,folder,1000,1060,{runCommand,align,probeFile});
 assert.deepEqual(used,['live']);assert.equal(expected,1000-SECTION_PAD+.4,'the fragments\' own start time is the starting point');assert.ok(one.start<=1000);
 // Stream over: the worker reports not-live and the yt-dlp section download takes over.
 const ended=async(cmd,args,opts={})=>{if(isGrab(args)){used.push('live');opts.onLine?.(JSON.stringify({error:'not-live'}));throw new Error('exit 3');}return runCommand(cmd,args,opts);};
 await ensureSection(job,folder,5000,5060,{runCommand:ended,align,probeFile});
 assert.deepEqual(used,['live','live','vod']);
});

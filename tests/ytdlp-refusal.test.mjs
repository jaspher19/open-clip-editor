import test from 'node:test';import assert from 'node:assert/strict';
import {refusalKind,errorDetail,explainRefusal,updateDownloader,resetDownloaderUpdate} from '../server/ytdlp.mjs';
import {inspectSource} from '../server/remote.mjs';import {run} from '../server/process.mjs';

// The exact stderr a user got (yt-dlp on Windows, 2026-11): YouTube refused the connection, not the video.
const BOT=`D:\\open-clip-editor\\.venv\\Scripts\\python.exe failed (1): WARNING: [youtube] No title found in player responses; falling back to title from initial data. Other metadata may also be missing
ERROR: [youtube] 5tdj53ioJ-c: Sign in to confirm you’re not a bot. This helps protect our community. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`;

test('a bot check is explained as a connection problem, without cookie advice',()=>{
 assert.equal(refusalKind(BOT),'bot');
 const msg=explainRefusal('YouTube',BOT);
 assert.match(msg,/blocking downloads from this internet connection/);
 assert.match(msg,/VPN/);assert.match(msg,/Retry/);
 assert.doesNotMatch(msg,/private|subscriber-only|region-locked/i,'not blamed on the video');
 assert.doesNotMatch(msg,/cookies?/i,'OpenClip never uses cookies');
 assert.doesNotMatch(msg,/python\.exe|WARNING/,'no raw command dump');
 assert.equal(errorDetail(BOT),'[youtube] 5tdj53ioJ-c: Sign in to confirm you’re not a bot.');
});

test('other refusals get their own plain reason',()=>{
 const cases={
  'ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access to this video':'private',
  'ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader':'removed',
  'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.':'age',
  'ERROR: [youtube] abc: Join this channel to get access to members-only content like this video':'members',
  'ERROR: [youtube] abc: The uploader has not made this video available in your country':'region',
  'ERROR: [youtube] abc: This live event will begin in 3 hours.':'upcoming',
  'ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing; please report this issue':'outdated',
  'ERROR: unable to download video data: <urlopen error [Errno 11001] getaddrinfo failed>':'',
 };
 for(const [text,kind] of Object.entries(cases)){assert.equal(refusalKind(text),kind,text);assert.ok(explainRefusal('YouTube',text).length>20);}
});

test('on a bot check the downloader is updated once and the import retried',async()=>{
 resetDownloaderUpdate();let calls=0,updates=0;
 const runCommand=async()=>{calls++;if(calls===1)throw new Error(BOT);return {stdout:'{"id":"5tdj53ioJ-c","title":"ok"}',stderr:''};};
 const info=await inspectSource({type:'youtube',url:'https://www.youtube.com/watch?v=5tdj53ioJ-c'},{runCommand,update:async()=>{updates++;return true;}});
 assert.equal(info.title,'ok');assert.equal(calls,2);assert.equal(updates,1);
});

test('when the retry is refused too, the message says the update already happened',async()=>{
 const runCommand=async()=>{throw new Error(BOT);};
 await assert.rejects(inspectSource({type:'youtube',url:'https://www.youtube.com/watch?v=5tdj53ioJ-c'},{runCommand,update:async()=>true}),
  e=>/blocking downloads/.test(e.message)&&/already updated its downloader/.test(e.message));
});

test('a private video is not retried and no update is attempted',async()=>{
 let updates=0;
 await assert.rejects(inspectSource({type:'youtube',url:'https://www.youtube.com/watch?v=5tdj53ioJ-c'},{runCommand:async()=>{throw new Error('ERROR: [youtube] x: Private video');},update:async()=>{updates++;return true;}}),/private/);
 assert.equal(updates,0);
});

test('the downloader update runs at most once every 6 hours, one at a time',async()=>{
 resetDownloaderUpdate();let t=1_000_000,ran=0;const runCommand=async cmd=>{ran++;if(cmd==='uv')throw new Error('no uv');return {stdout:'',stderr:''};};
 const [a,b]=await Promise.all([updateDownloader({runCommand,now:()=>t}),updateDownloader({runCommand,now:()=>t})]);
 assert.equal(a,true);assert.equal(b,true,'the second caller shares the running update');assert.equal(ran,2,'uv tried, then pip');
 t+=3600*1000;assert.equal(await updateDownloader({runCommand,now:()=>t}),false,'too soon');
 t+=6*3600*1000;assert.equal(await updateDownloader({runCommand,now:()=>t}),true);
 resetDownloaderUpdate();
});

test('Python output is read as UTF-8 (no mangled apostrophes on Windows)',async()=>{
 const {PYTHON}=await import('../server/config.mjs');
 const r=await run(PYTHON,['-c','import sys;sys.stderr.write("you\\u2019re not a bot\\n");print("caf\\u00e9 \\u2014 ok")'],{timeout:30000});
 assert.equal(r.stdout.trim(),'café — ok');assert.equal(r.stderr.trim(),'you’re not a bot');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {pickClips,gameSignal} from '../server/selection.mjs';import {judgeMoments,judgeShape} from '../server/meme-judge.mjs';
import {buildClipEdl} from '../server/edl.mjs';import {validateOptions} from '../server/options.mjs';import {applyTemplate} from '../server/templates.mjs';

// 20 minutes of flat chatter; a quiet stretch around 610 s where the game explodes and nobody says anything.
function stream(){const words=[];let t=0;const say=text=>{for(const w of text.split(' ')){words.push({text:w,start:+t.toFixed(2),end:+(t+.28).toFixed(2)});t+=.34;}t+=.05;};
 while(t<1200){if(t>600&&t<616){t+=16;say('so what do we do now.');continue;}say('we are just driving around the city looking for the next mission right now.');}return {words,duration:t};}
const quietBlast=secs=>{const action=Array(secs).fill(.2);for(let s=604;s<=612;s++)action[s]=3;return {action};};

test('on-screen action: a chase the streamer watches in silence becomes a moment and stays in the edit',()=>{
 const tr=stream(),secs=Math.ceil(tr.duration)+1,signals=quietBlast(secs),options=validateOptions({count:3});
 const g=gameSignal(signals,secs);assert.equal(g[602],3,'best within ±2 s');assert.ok(g[300]<1,'ordinary driving stays low');
 const plain=pickClips(tr,options),withGame=pickClips(tr,options,{signals});
 const hits=list=>list.filter(c=>c.start<=607&&c.end>=609);
 assert.equal(hits(plain).length,0,'speech alone misses it');assert.equal(hits(withGame).length,1,'the game signals find it');
 assert.match(hits(withGame)[0].reasons[0],/busy on-screen action/);
});
test('the AI judge runs for every template: a general gaming-Short brief, the pool marks game moments, the AI ranking wins',async()=>{
 const tr=stream(),secs=Math.ceil(tr.duration)+1,options=validateOptions(applyTemplate('cam-split',{count:3}));let prompt='';
 assert.deepEqual(judgeShape(options).play,[30,59]);
 const ask=async({user})=>{prompt=user;const pool=[...user.matchAll(/^#(\d+) window [\d.]+-[\d.]+ · local pick ([\d.]+)-([\d.]+), peak ([\d.]+)(.*)$/gm)].map(m=>({id:+m[1],start:+m[2],end:+m[3],peak:+m[4],game:/on-screen action/.test(m[5])}));
  return {provider:'gemini',model:'test',data:{picks:pool.map(c=>({id:c.id,start:c.start,payoff:c.peak,end:c.end,score:c.game?96:c.id===3?80:20,why:c.game?'the car explodes out of nowhere':`moment ${c.id}`}))}};};
 const {clips,status}=await judgeMoments(tr,options,{ask,signals:quietBlast(secs)});
 assert.equal(status.status,'done');assert.ok(status.pool<=18,'smaller pool for longer moments');assert.match(prompt,/GAMING SHORT/);assert.match(prompt,/on-screen action at the peak/);
 assert.equal(clips[0].reasons[0],'AI pick: the car explodes out of nowhere');assert.equal(clips[0].score,96);assert.ok(clips[0].start<=607&&clips[0].end>=609);
});
test('Twitch chat: PRIVMSG text is read, a chat spike becomes a moment about 6 s earlier, recorded without usernames',async()=>{
 const {privmsg,chatSignal,recordChat,loadChat,CHAT_DELAY}=await import('../server/twitch-chat.mjs');
 assert.equal(privmsg('@badge-info=;color=#FF0000 :someone!someone@someone.tmi.twitch.tv PRIVMSG #jynxzi :KEKW KEKW'),'KEKW KEKW');assert.equal(privmsg(':tmi.twitch.tv 001 justinfan1 :Welcome'),null);
 const msgs=[];for(let t=0;t<1200;t+=4)msgs.push({t,m:'hi'});for(let k=0;k<60;k++)msgs.push({t:906+k/10,m:k%2?'KEKW':'LMAO'});
 const s=chatSignal(msgs,1200);assert.ok(s[900]>=2,'spike, moved back by the viewer delay');assert.equal(s[500],0);assert.equal(CHAT_DELAY,6);
 const tr=stream(),options=validateOptions({count:3}),picks=pickClips(tr,options,{chat:msgs});const hit=picks.find(c=>c.start<=900&&c.end>=902);
 assert.ok(hit,'the chat spike is picked');assert.match(hit.reasons[0],/chat went wild/);
 // A fake socket: the recorder logs in anonymously, joins the channel, answers PING and writes time and text only.
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');const dir=fs.mkdtempSync(path.join(process.cwd(),'.cache','tmp','chat-'));const sent=[];
 class WS{constructor(url){this.url=url;WS.last=this;setTimeout(()=>this.onopen(),0);}send(x){sent.push(x);}close(){}}
 const rec=recordChat({channel:'Jynxzi',id:'123',startedAt:1000,file:path.join(dir,'twitch-123.jsonl'),WS,now:()=>1100e3});await new Promise(r=>setTimeout(r,5));
 WS.last.onmessage({data:'PING :tmi.twitch.tv\r\n@x=1 :fan!fan@fan.tmi.twitch.tv PRIVMSG #jynxzi :no way\r\n'});rec.stop();
 assert.match(sent[0],/^NICK justinfan\d+$/);assert.equal(sent[1],'JOIN #jynxzi');assert.equal(sent[2],'PONG :tmi.twitch.tv');
 assert.deepEqual(loadChat('123',dir),[{t:100,m:'no way'}]);assert.ok(!fs.readFileSync(path.join(dir,'twitch-123.jsonl'),'utf8').includes('fan'),'no usernames');
 fs.rmSync(dir,{recursive:true,force:true});
});
test('source time of an output time: main segments map back, gaps do not',async()=>{
 const {sourceTime}=await import('../server/edl.mjs');const edl=[{kind:'main',start:100,end:140,outputStart:0,outputEnd:40},{kind:'main',start:145,end:160,outputStart:40,outputEnd:55}];
 assert.equal(sourceTime(edl,10),110);assert.equal(sourceTime(edl,45),150);assert.equal(sourceTime(edl,99),null);
});
test('file checks: silence, clipping, black and frozen picture become warnings; intended holds do not',async()=>{
 const {parseChecks,warningsFor,checkExport}=await import('../server/qc.mjs');
 const err='[blackdetect @ 0] black_start:0 black_end:2.5 black_duration:2.5\n[blackdetect @ 0] black_start:10 black_end:11.5\n[freezedetect @ 0] lavfi.freezedetect.freeze_duration: 4.2\n  Integrated loudness:\n    I:         -45.3 LUFS\n  True peak:\n    Peak:        0.2 dBFS\n';
 const p=parseChecks(err);assert.deepEqual(p,{lufs:-45.3,peak:.2,black:[2.5,1.5],freezes:[4.2]});
 assert.deepEqual(warningsFor(p,{duration:40}),['Nearly silent: check the sound before posting','Sound clips at its loudest moment','Black picture for 4.0 s','Picture frozen for 4.2 s']);
 assert.deepEqual(warningsFor({...p,lufs:-15,peak:-3,black:[]},{duration:40,held:2.9}),[],'a 2.9 s skull hold plus 1.3 s is fine');
 assert.deepEqual(await checkExport('x.mp4',{duration:40},{runCommand:async()=>{throw new Error('no ffmpeg');}}),[],'a failed check never fails the export');
});

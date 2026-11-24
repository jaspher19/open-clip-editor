import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseChatLine,loadYouTubeChat,fetchYouTubeChat,youtubeChatFile} from '../server/youtube-chat.mjs';import {jobChat,chatSignal} from '../server/twitch-chat.mjs';

const action=(ms,item)=>JSON.stringify({replayChatItemAction:{videoOffsetTimeMsec:String(ms),actions:[{addChatItemAction:{item}}]}});
test('youtube chat: replay lines become {t, m}; emoji keep their shortcut; Super Chats count as hype',()=>{
 assert.deepEqual(parseChatLine(action(12345,{liveChatTextMessageRenderer:{message:{runs:[{text:'NO WAY '},{emoji:{shortcuts:[':face-with-tears-of-joy:']}}]}}})),[{t:12.35,m:'NO WAY :face-with-tears-of-joy:'}]);
 assert.deepEqual(parseChatLine(action(5000,{liveChatPaidMessageRenderer:{message:{runs:[{text:'gg'}]}}})),[{t:5,m:'gg !!!'}]);
 assert.deepEqual(parseChatLine(action(5000,{liveChatMembershipItemRenderer:{}})),[]);assert.deepEqual(parseChatLine('not json'),[]);assert.deepEqual(parseChatLine(JSON.stringify({replayChatItemAction:{actions:[]}})),[]);
});
test('youtube chat: stored per project and used as the picker’s chat; Twitch chat unchanged',async()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMP||os.tmpdir(),'ytc-'));
 const job={source:{type:'youtube',kind:'video',url:'https://www.youtube.com/watch?v=x'}};
 const n=await fetchYouTubeChat(job,dir,{runCommand:async(cmd,args)=>{const out=args[args.indexOf('-o')+1].replace('%(ext)s','live_chat.json');fs.writeFileSync(out,[action(1000,{liveChatTextMessageRenderer:{message:{runs:[{text:'LOL'}]}}}),action(2000,{liveChatTextMessageRenderer:{message:{runs:[{text:'W'}]}}})].join('\n'));}});
 assert.equal(n,2);assert.deepEqual(jobChat(job,dir).map(m=>m.m),['LOL','W']);assert.equal(fs.existsSync(path.join(dir,'ytchat')),false,'the raw download is cleaned up');
 assert.equal(await fetchYouTubeChat(job,dir,{runCommand:async()=>{throw new Error('should reuse');}}),2,'fetched once');
 const none=fs.mkdtempSync(path.join(process.env.TMP||os.tmpdir(),'ytc-'));assert.equal(await fetchYouTubeChat(job,none,{runCommand:async()=>{}}),null,'no chat (a normal upload)');assert.equal(await fetchYouTubeChat(job,none,{runCommand:async()=>{throw new Error('asked again');}}),null,'not asked again');
 assert.equal(await fetchYouTubeChat({source:{...job.source,section:{start:0,end:60}}},none),null,'sections skip');
 assert.deepEqual(jobChat({source:{type:'kick'}},dir),[]);
 for(const d of [dir,none])fs.rmSync(d,{recursive:true,force:true});
 assert.ok(chatSignal(Array.from({length:60},(_,k)=>({t:100+k/20,m:'LMAO'})).concat(Array.from({length:40},(_,k)=>({t:k*10,m:'hi'}))),400)[100-6+1]>0,'a burst of laughs is a chat spike');
});

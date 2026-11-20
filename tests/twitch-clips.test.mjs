import test from 'node:test';import assert from 'node:assert/strict';
import {vodClips,collectCrowd,parseDuration,crowdWeight,crowdReady} from '../server/twitch-clips.mjs';import {pickClips} from '../server/selection.mjs';import {validateOptions} from '../server/options.mjs';

const env={TWITCH_CLIENT_ID:'abc123',TWITCH_CLIENT_SECRET:'shh'};
function fakeTwitch({clipsPages,token='tok'}){
 const calls=[];return {calls,fetchImpl:async(url,init={})=>{calls.push({url:String(url),init});const u=new URL(url);
  if(u.hostname==='id.twitch.tv'){assert.equal(init.method,'POST');assert.equal(init.body.get('grant_type'),'client_credentials');return Response.json({access_token:token,expires_in:3600});}
  assert.equal(init.headers.Authorization,`Bearer ${token}`);assert.equal(init.headers['Client-Id'],env.TWITCH_CLIENT_ID);
  if(u.pathname==='/helix/videos')return Response.json({data:[{id:u.searchParams.get('id'),user_id:'42',created_at:'2026-11-10T18:00:00Z',duration:'5h15m40s'}]});
  if(u.pathname==='/helix/clips'){assert.equal(u.searchParams.get('broadcaster_id'),'42');const page=Number(u.searchParams.get('after')||0);return Response.json(clipsPages[page]);}
  throw new Error('unexpected '+url);}};
}
test('crowd: viewers’ clips of one VOD come from the official Helix API, across pages, most viewed first',async()=>{
 const tw=fakeTwitch({clipsPages:[{data:[{video_id:'2921164270',vod_offset:600,duration:30,view_count:120,title:'a',url:'u1'},{video_id:'999',vod_offset:5,duration:30,view_count:9999},{video_id:'2921164270',vod_offset:null,duration:30,view_count:50}],pagination:{cursor:'1'}},{data:[{video_id:'2921164270',vod_offset:9000,duration:26,view_count:4500,title:'b',url:'u2'}],pagination:{}}]});
 const clips=await vodClips('2921164270',{env,fetchImpl:tw.fetchImpl});
 assert.deepEqual(clips.map(c=>[c.start,c.end,c.views]),[[9000,9026,4500],[600,630,120]],'other VODs and clips without an offset are dropped');
 assert.equal(tw.calls.filter(c=>c.url.includes('/helix/clips')).length,2);
 assert.equal(parseDuration('5h15m40s'),18940);assert.equal(parseDuration('42s'),42);assert.equal(parseDuration('nope'),0);
 await assert.rejects(vodClips('../x',{env,fetchImpl:tw.fetchImpl}),/Invalid/);
});
test('crowd: optional and never fatal; only Twitch VOD jobs ask',async()=>{
 assert.equal(crowdReady({}),false);
 assert.equal(await collectCrowd({source:{type:'kick',kind:'video'}},'.',{env}),null);
 assert.equal(await collectCrowd({source:{type:'twitch',kind:'clip'}},'.',{env}),null);
 assert.equal((await collectCrowd({source:{type:'twitch',kind:'video',id:'2921164270'}},'.',{env:{}})).status,'skipped');
 const refused=await collectCrowd({source:{type:'twitch',kind:'video',id:'2921164270'}},'.',{env:{...env,TWITCH_CLIENT_ID:'other'},fetchImpl:async()=>new Response('',{status:403})});
 assert.equal(refused.status,'failed');assert.match(refused.reason,/rejected/);
 assert.ok(crowdWeight(10000)>crowdWeight(10)&&crowdWeight(1e9)<=8);
});

// Twenty minutes of even chatter: nothing stands out until viewers' clips say where the moment was.
function flat(minutes=20){const words=[];let t=0,k=0;while(t<minutes*60){words.push({start:+t.toFixed(2),end:+(t+.3).toFixed(2),text:k%9===8?'then.':'word'});t+=.55;k++;}return {words,duration:minutes*60,energy:[]};}
test('crowd: the moment viewers clipped is picked, with the view count in the reasons',()=>{
 const transcript=flat(),crowd=[{start:700,end:730,views:3200}];
 const clips=pickClips(transcript,validateOptions({count:3}),{crowd});
 const hit=clips.find(c=>c.start<=725&&c.end>=725);assert.ok(hit,'a clip covers the clipped moment');assert.equal(clips[0],hit,'and it ranks first');
 assert.ok(hit.reasons.some(r=>r==='Viewers clipped this · 3,200 views'));
 assert.ok(clips.filter(c=>c!==hit).every(c=>!c.reasons.some(r=>r.startsWith('Viewers'))));
 assert.ok(pickClips(transcript,validateOptions({count:3})).every(c=>!c.reasons.some(r=>r.startsWith('Viewers'))),'no crowd, no claim');
});

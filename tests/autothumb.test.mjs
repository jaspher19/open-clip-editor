import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {CACHE} from '../server/config.mjs';import {thumbText,gameLabel,autoThumbnail} from '../server/autothumb.mjs';

test('thumbnail words: short and punchy, without the streamer\'s name',()=>{
 const job={host:{name:'Jynxzi'},sourceInfo:{uploader:'Jynxzi'}};
 assert.equal(thumbText({title:'Jynxzi Shocked by GTA 6 Realism'},job),'GTA 6 Realism','numbers keep their neighbours');
 assert.equal(thumbText({title:'I Got 6 Stars In GTA 6!'},{}),'Got 6 Stars');
 assert.equal(thumbText({hook:'Jynxzi Loses It',title:'Something longer here'},job),'Loses It','the hook wins over the title');
 assert.equal(thumbText({title:'Kai Cenat: “No Way, My Man”'},{host:{name:'Kai Cenat'}}),'No Way My Man');
 assert.ok(thumbText({title:'Jynxzi Struggles with the Terrible Driving in the City'},job).split(' ').length<=4);
});
test('game label: our own lettering for the game name, nothing for non-game categories',()=>{
 assert.equal(gameLabel({sourceInfo:{categories:['Grand Theft Auto VI']}}),'GTA 6');
 assert.equal(gameLabel({sourceInfo:{categories:['Grand Theft Auto V']}}),'GTA V');
 assert.equal(gameLabel({sourceInfo:{categories:['Just Chatting']}}),'');
 assert.equal(gameLabel({sourceInfo:{categories:['Fortnite']}}),'Fortnite');
 assert.equal(gameLabel({}),'');
});
test('auto thumbnail: 1080p section, facecam box, reaction frames and the words go to the worker',async()=>{
 fs.mkdirSync(CACHE,{recursive:true});const folder=fs.mkdtempSync(path.join(CACHE,'thumb-'));fs.mkdirSync(path.join(folder,'clips'));fs.mkdirSync(path.join(folder,'hires'));
 // A facecam already found for this clip, and a section covering it.
 const clip={id:'c1',start:100,end:130,title:'Jynxzi Shocked by GTA 6 Realism'};
 fs.writeFileSync(path.join(folder,'clips','c1.facecam.json'),JSON.stringify({found:true,box:[0,.44,.23,.31],start:100,end:130}));
 fs.writeFileSync(path.join(folder,'hires','s-92-138.mp4'),'x');
 fs.writeFileSync(path.join(folder,'hires','sections.json'),JSON.stringify([{file:'s-92-138.mp4',requested:[92,138],start:91.9,end:139,aligned:true,confidence:.98}]));
 const job={id:'j',sourcePath:path.join(folder,'source.mp4'),metadata:{width:640,height:360},remote:{proxy:true,platform:'twitch',url:'https://www.twitch.tv/videos/1',duration:5000},host:{name:'Jynxzi'},sourceInfo:{categories:['Grand Theft Auto VI']}};
 let spec;const runWorker=async(cmd,args)=>{spec=JSON.parse(fs.readFileSync(args[1],'utf8'));return {stdout:JSON.stringify({faceAt:112,faceScore:1.4,gameplayAt:120,side:'left',person:true})};};
 const out=path.join(folder,'thumb.jpg'),r=await autoThumbnail(job,folder,clip,out,{live:true,runWorker});
 assert.match(spec.video,/s-92-138\.mp4$/);assert.equal(spec.shift,91.9);assert.deepEqual(spec.cam,[0,.44,.23,.31]);
 assert.equal(spec.text,'GTA 6 Realism');assert.equal(spec.game,'GTA 6');assert.equal(spec.badge,'LIVE');assert.equal(spec.arrow,false);
 assert.ok(spec.times.length>=10&&spec.times.every(t=>t>=100&&t<=130));
 assert.deepEqual(r,{file:out,text:'GTA 6 Realism',faceAt:112,person:true});
 assert.ok(!fs.existsSync(out.replace(/\.jpg$/,'.spec.json')),'the spec file is cleaned up');
 // Owner's own words win; a worker error surfaces.
 await autoThumbnail(job,folder,clip,out,{text:'Day 1',runWorker});assert.equal(spec.text,'Day 1');assert.equal(spec.badge,'');
 await assert.rejects(autoThumbnail(job,folder,clip,out,{runWorker:async()=>({stdout:JSON.stringify({error:'No frames could be read from the clip'})})}),/No frames/);
});

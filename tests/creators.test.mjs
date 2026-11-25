import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {creatorOf,ogImage,imageType,CreatorPhotos} from '../server/creators.mjs';import {CACHE} from '../server/config.mjs';import {JobStore,publicJob} from '../server/jobs.mjs';

const PNG=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),Buffer.alloc(40)]);
const yt={id:'x',source:{type:'youtube',url:'https://www.youtube.com/watch?v=abcdefghijk'},sourceInfo:{platform:'youtube',uploader:'Kai Cenat Live',channel:'Kai Cenat Live',uploaderId:'@KaiCenatLive'}};

test('the creator comes from the public channel details of each platform',()=>{
 assert.deepEqual(creatorOf(yt),{key:'youtube-kaicenatlive',name:'Kai Cenat',platform:'youtube',handle:'@KaiCenatLive',page:'https://www.youtube.com/@KaiCenatLive'});
 assert.equal(creatorOf({...yt,host:{name:'Kai'}}).name,'Kai Cenat','the channel name wins over the short host name');assert.equal(creatorOf({source:{type:'upload'},host:{name:'Kai'}}).name,'Kai');
 assert.equal(creatorOf({source:{type:'youtube'},sourceInfo:{platform:'youtube',uploader:'X',uploaderId:'UCabcdefghijklmnopqrstuv'}}).page,'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv');
 const twitch=creatorOf({source:{type:'twitch',kind:'video',url:'https://www.twitch.tv/videos/123'},sourceInfo:{platform:'twitch',uploader:'TheBurntPeanut',uploaderId:'theburntpeanut'}});
 assert.equal(twitch.page,'https://www.twitch.tv/theburntpeanut');assert.equal(twitch.name,'TheBurntPeanut');
 assert.equal(creatorOf({source:{type:'twitch',kind:'channel',id:'caseoh_',url:'https://www.twitch.tv/caseoh_'},sourceInfo:{}}).key,'twitch-caseoh_');
 assert.equal(creatorOf({source:{type:'kick',kind:'video',url:'https://kick.com/xqc/videos/1f2e'},sourceInfo:{platform:'kick',uploader:'xQc'}}).page,'https://kick.com/xqc');
 const local=creatorOf({id:'y',source:{type:'upload',name:'stream.mp4'}});assert.equal(local.key,null);assert.equal(local.name,'');assert.equal(local.page,'');
 assert.equal(creatorOf({source:{type:'youtube'},sourceInfo:{platform:'youtube',uploaderId:'../../etc'}}).page,'','odd ids never become a URL');
 assert.deepEqual(publicJob({...yt,id:'z',source:{type:'youtube'}}).creator,{name:'Kai Cenat',platform:'youtube'});
});

test('only an https profile picture from the platform image hosts is used',()=>{
 assert.equal(ogImage('<meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900-c-k&amp;x=1">'),'https://yt3.googleusercontent.com/abc=s900-c-k&x=1');
 assert.equal(ogImage('<meta content="https://static-cdn.jtvnw.net/jtv_user_pictures/a-profile_image-300x300.png" property="og:image"/>'),'https://static-cdn.jtvnw.net/jtv_user_pictures/a-profile_image-300x300.png');
 assert.equal(ogImage('<meta property="og:image" content="https://evil.example/x.png">'),'');
 assert.equal(ogImage('<meta property="og:image" content="http://yt3.ggpht.com/x">'),'');
 assert.equal(imageType(PNG),'image/png');assert.equal(imageType(Buffer.from('<html>not an image</html>')),'');
});

test('the photo is fetched once, a miss waits a day, and a picked photo wins',async t=>{
 const root=path.join(CACHE,'creators-'+randomUUID());t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=Date.parse('2026-11-25T00:00:00Z'),pages=0,html='<meta property="og:image" content="https://yt3.googleusercontent.com/me">';
 const fetchImpl=async url=>{if(url.startsWith('https://www.youtube.com/')){pages++;return new Response(html);}if(url==='https://yt3.googleusercontent.com/me')return new Response(PNG);return new Response('',{status:404});};
 const photos=new CreatorPhotos({root,fetchImpl,now:()=>now});
 const [p1,p2]=await Promise.all([photos.photo(yt),photos.photo(yt)]);
 assert.equal(pages,1,'two rows of the same creator share one fetch');assert.equal(p1.type,'image/png');assert.equal(p2.custom,false);
 await photos.photo(yt);assert.equal(pages,1,'cached after that');
 const other={...yt,sourceInfo:{...yt.sourceInfo,uploaderId:'@Nobody'}};html='<title>no picture</title>';
 assert.equal(await photos.photo(other),null);assert.equal(await photos.photo(other),null);assert.equal(pages,2,'a miss is not retried at once');
 now+=25*3600e3;await photos.photo(other);assert.equal(pages,3,'retried the next day');
 assert.throws(()=>photos.setCustom('youtube-kaicenatlive',Buffer.from('nope, text')),/JPG, PNG/);
 photos.setCustom('youtube-kaicenatlive',PNG);assert.equal((await photos.photo(yt)).custom,true);
 photos.clearCustom('youtube-kaicenatlive');assert.equal((await photos.photo(yt)).custom,false);
 assert.throws(()=>photos.file('../x','auto'),/Invalid/);
});

test('photo routes: show, replace with a picked picture, and go back',async t=>{
 const {createApp}=await import('../server/app.mjs');const {YouTubeClient}=await import('../server/youtube.mjs');
 const store=new JobStore(path.join(CACHE,'api-creators-'+randomUUID()));t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const photos=new CreatorPhotos({root:path.join(store.root,'creators'),fetchImpl:async()=>new Response('',{status:503})});
 const app=createApp({store,queue:{isBusy:()=>false,enqueue(){},cancel(){}},creatorPhotos:photos,youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;const job=store.create({type:'youtube',url:'https://www.youtube.com/watch?v=abcdefghijk'},{});store.update(job.id,{sourceInfo:yt.sourceInfo});
 assert.equal((await fetch(`${base}/api/jobs/${job.id}/creator/photo`)).status,204,'no photo: the list shows initials');
 const bad=new FormData();bad.append('photo',new Blob(['hello']),'x.png');assert.equal((await fetch(`${base}/api/jobs/${job.id}/creator/photo`,{method:'POST',body:bad})).status,400);
 const form=new FormData();form.append('photo',new Blob([PNG]),'me.png');assert.equal((await fetch(`${base}/api/jobs/${job.id}/creator/photo`,{method:'POST',body:form})).status,200);
 const r=await fetch(`${base}/api/jobs/${job.id}/creator/photo`);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
 assert.equal((await fetch(`${base}/api/jobs/${job.id}/creator/photo`,{method:'DELETE'})).status,200);
 assert.equal((await fetch(`${base}/api/jobs/${job.id}/creator/photo`)).status,204);
 const list=await (await fetch(`${base}/api/jobs`)).json();assert.equal(list[0].creator.name,'Kai Cenat');
});

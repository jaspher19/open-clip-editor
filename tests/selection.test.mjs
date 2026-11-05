import test from 'node:test';import assert from 'node:assert/strict';
import {pickClips,clipCount,localTitles,titleCase} from '../server/selection.mjs';import {streamPeople,clipPeople,unsupportedNames} from '../server/people.mjs';
import {maskProfanity,dropProfanity} from '../server/moments.mjs';import {validateOptions} from '../server/options.mjs';

// A long synthetic stream: calm chatter, with two real reaction peaks (laughs + hype + a loud spike).
function stream(minutes=30){
 const words=[],energy=[];let t=0;
 const say=(text,{gap=.25,loud=false}={})=>{for(const w of text.split(' ')){words.push({start:+t.toFixed(2),end:+(t+.3).toFixed(2),text:w,loud});t+=.3+gap;}};
 while(t<minutes*60){
  const m=Math.floor(t/60);
  if(m===7&&!words.some(w=>w.text==='TRIGGER7')){say('so we walk in and he puts on the mask. TRIGGER7');say('Oh my god! No way! Hahaha bro I am dying! Hahaha that is insane!',{loud:true});say('okay okay he really did that.');}
  else if(m===21&&!words.some(w=>w.text==='TRIGGER21')){say('chat look at this right here. TRIGGER21');say('Let\'s go! Clip that! Let\'s go!',{loud:true});say('that was crazy, alright.');}
  else say('and then we just talk about the plan for later today with everyone here.',{gap:.3});
 }
 for(let s=0;s<t;s+=.5){const w=words.find(x=>x.start<=s+.5&&x.end>=s);energy.push({time:+s.toFixed(1),rms:w?.loud?.4:.05});}
 return {duration:t,words:words.map(({loud:_,...w})=>w),energy};
}

test('auto clip count scales with length; explicit counts are kept',()=>{
 assert.equal(clipCount('auto',600),3);assert.equal(clipCount('auto',8030),12);assert.equal(clipCount('auto',40000),12);assert.equal(clipCount(5,8030),5);
 assert.equal(validateOptions({}).count,'auto');assert.equal(validateOptions({}).autoExport,true);assert.equal(validateOptions({model:'large-v3-turbo'}).model,'large-v3-turbo');
 assert.throws(()=>validateOptions({count:2}),/auto or 3–12/);assert.throws(()=>validateOptions({count:13}),/auto or 3–12/);
});

test('the picker lands on real reaction peaks with setup before and an ending after, at varied lengths and scores',()=>{
 const t=stream(30),people={host:{name:'Kai Cenat',short:'Kai'},named:[]},clips=pickClips(t,{count:3,minDuration:20,maxDuration:60},{people});
 assert.equal(clips.length,3);
 const at=id=>t.words.find(w=>w.text===id).start;
 for(const peak of [at('TRIGGER7'),at('TRIGGER21')]){
  const c=clips.find(c=>c.start<peak+3&&c.end>peak+3);assert.ok(c,`a clip covers the peak at ${peak}`);
  const pos=(c.start+c.peakAt-c.start)/(c.end-c.start);assert.ok(pos>=.3&&pos<=.9,`payoff sits after a setup (position ${pos.toFixed(2)})`);
  assert.ok(c.end-c.start>=20&&c.end-c.start<=60);assert.ok(['funny','highlight','clippable'].includes(c.category));assert.ok(c.reasons[0].startsWith('Peak'));
 }
 assert.ok(new Set(clips.map(c=>Math.round(c.end-c.start))).size>1||new Set(clips.map(c=>c.score)).size>1,'not a fixed length and score');
 assert.ok(clips[0].score>clips.at(-1).score,'scores discriminate');
 assert.ok(clips.every(c=>/Kai Cenat/.test(c.title)&&c.title.length<=60),'who-did-what titles name the host');
});

test('local who-did-what titles use evidence only and keep swearing off screen',()=>{
 const kai=[{name:'Kai Cenat',short:'Kai',evidence:'host (channel)'}];
 assert.equal(localTitles('I am dying. Hahaha. Hahaha that is so funny!',{people:kai,counts:{laughs:3}}).title,"Kai Cenat Can't Stop Laughing");
 const q=localTitles('Should we start? Yo, what the fuck are you doing? My bad.',{people:kai,peakText:'Yo, what the fuck are you doing?'});
 assert.equal(q.title,'Kai Cenat Asks “What Are You Doing?”');assert.ok(!/fuck/i.test(q.title+q.hook));
 const nobody=localTitles('Ayo.',{people:[]});assert.match(nobody.title,/^Streamer /,'no guessed names');assert.notEqual(nobody.title,'Ayo');
 assert.ok(!/“/.test(localTitles('Go okay alright alright what?',{people:kai,peakText:'Go okay alright alright what?'}).title),'filler chatter is never quoted as a title');
 assert.ok(!/Celebrates/.test(localTitles("let's go to Cascades later.",{people:kai,peakText:"let's go to Cascades later."}).title),'"let\'s go to" is not a celebration');
 assert.equal(titleCase('kai gets scared by a fake spider'),'Kai Gets Scared by a Fake Spider');
 assert.equal(maskProfanity('what the fuck'),'what the f***');assert.equal(dropProfanity('That nigga is crazy'),'That is crazy');
});

test('people come from the channel, the title and names spoken nearby; unknown names are flagged',()=>{
 const s=streamPeople({title:'🎃AMP HALLOWEEN PARTY🎃',options:{contextText:''}},{info:{uploader:'Kai Cenat Live',channel:'Kai Cenat Live'}});
 assert.equal(s.host.name,'Kai Cenat');assert.deepEqual(s.groups,['AMP']);
 const near=clipPeople(s,'yo Duke Dennis come here');assert.deepEqual(near.map(p=>p.name),['Kai Cenat','Duke Dennis']);
 assert.deepEqual(clipPeople(s,'he has speed and a duke').map(p=>p.name),['Kai Cenat'],'ordinary words are not names');
 assert.deepEqual(unsupportedNames('Kai Cenat Roasts Duke',[{name:'Kai Cenat',short:'Kai'}]),['Duke Dennis']);
 assert.equal(streamPeople({title:'x'},{info:{uploader:'Tyler Streams Live'}}).host.name,'Tyler','an unlisted channel still names its host');
 assert.equal(streamPeople({title:'x'},{info:{}}).host,null);
});
test('default clips play close to a minute after pause trimming, never over 60 s',async()=>{
 const {playedLength,fitPlayed}=await import('../server/edl.mjs'),o=validateOptions({}),t=stream(30),clips=pickClips(t,{...o,count:3},{people:{host:{name:'Kai Cenat',short:'Kai'},named:[]}});
 assert.ok(clips.length>=2);for(const c of clips){const plays=playedLength(t.words,c,o);assert.ok(plays>=45&&plays<=60,`plays ${plays.toFixed(1)} s`);assert.ok(c.end-c.start<=90);}
 // An over-long pick (e.g. from the AI picker) is pulled back to a word end inside the limit.
 const long={start:400,end:480},fitted=fitPlayed(t.words,long,o);assert.ok(playedLength(t.words,fitted,o)<=60&&fitted.end<480&&fitted.start===400);
});

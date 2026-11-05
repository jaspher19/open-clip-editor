import test from 'node:test';import assert from 'node:assert/strict';
import {enrichClip,publicationMetadata} from '../server/context.mjs';import {validateOptions} from '../server/options.mjs';import {makeAss} from '../server/captions.mjs';
const words='We are comparing three costume ideas. This costume uses a handmade mask. The next idea is a robot.'.split(' ').map((text,i)=>({text,start:i*.8,end:i*.8+.6}));
test('context and metadata stay grounded in the clip and user supplied context',()=>{
 const clip=enrichClip({id:'test',start:5,end:15,title:'This',hook:'This',settings:{}},{words},{title:'Costume challenge',source:{url:'https://youtu.be/R6gKMvetXUU'},options:{contextText:'A costume challenge at the party'}});
 assert.ok(clip.title.split(' ').length>=4);assert.match(clip.contextText,/costume challenge/);assert.ok(clip.sourceContext.before.includes('comparing'));assert.equal(clip.metadata.description.includes('https://youtu.be/R6gKMvetXUU'),true);assert.ok(clip.metadata.tags.length>0);
 const m=publicationMetadata(clip,{title:'Source',source:{},options:{}},{titleTemplate:'{title} #Shorts',descriptionTemplate:'{context}\n{transcript}',tags:['costumes'],titlePrefix:'Best: '});assert.match(m.title,/Best:/);assert.ok(m.tags.includes('costumes'));assert.ok(Buffer.byteLength(m.description)<=5000);
 assert.throws(()=>publicationMetadata(clip,{}, {titleTemplate:'{unknown}'}),/placeholder/);
 const owned=enrichClip({...clip,title:'My short title',titleEdited:true,metadata:{title:'Owner upload title',description:'Edited description',tags:['owned'],generatedBy:'owner edited'}},{words},{options:{}});assert.equal(owned.title,'My short title');assert.equal(owned.metadata.title,'Owner upload title');
 const repaired=enrichClip({...clip,title:'What do you what do you say',titleEdited:false,metadata:undefined},{words},{options:{}});assert.match(repaired.title,/costume|handmade|robot/i);
});
test('reference layouts expose persistent titles, context labels and optional speech captions',()=>{
 const opts=validateOptions({titleMode:'persistent',contextText:'A handmade costume reveal',seriesLabel:'Part 2',captionsEnabled:false,hookEnabled:true,hookText:'The costume challenge',framing:'editorial'});
 const ass=makeAss(words,{...opts,title:opts.hookText,duration:25});assert.match(ass,/0:00:25.00/);assert.match(ass,/handmade costume reveal/);assert.match(ass,/Part 2/);assert.ok(!ass.includes('comparing'));
 assert.throws(()=>validateOptions({contextText:'x'.repeat(141)}),/context/i);assert.throws(()=>validateOptions({titleMode:'forever'}),/titleMode/);
});

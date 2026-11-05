import fs from 'node:fs';import path from 'node:path';
// Who is in a clip, from evidence only: the uploader/channel, the stream title, the creator's context and names spoken
// near the moment. `spoken` patterns are strict (full names or unambiguous nicknames) because transcripts contain ordinary
// words like "speed" or "duke"; `source` patterns may be looser since they only run on titles and channel names.
const PEOPLE=[
 {name:'Kai Cenat',short:'Kai',source:/\bkai\s*cenat\b|\bkaicenat\b/i,spoken:/\bkai\b|\bkai\s*cenat\b/i},
 {name:'Speed',short:'Speed',source:/\bi\s*show\s*speed\b|\bishowspeed\b|\bspeed\b/i,spoken:/\bishowspeed\b|\bi show speed\b/i},
 {name:'Duke Dennis',short:'Duke',source:/\bduke\s*dennis\b/i,spoken:/\bduke dennis\b/i},
 {name:'Fanum',short:'Fanum',source:/\bfanum\b/i,spoken:/\bfanum\b/i},
 {name:'Agent 00',short:'Agent',source:/\bagent\s*(?:00|zero zero|double o)\b/i,spoken:/\bagent (?:00|zero zero|double o)\b/i},
 {name:'ImDavisss',short:'Davis',source:/\bimdavis+\b/i,spoken:/\bimdavis+\b/i},
 {name:'Adin Ross',short:'Adin',source:/\badin\s*ross\b|\badin\b/i,spoken:/\badin(?: ross)?\b/i},
 {name:'Sketch',short:'Sketch',source:/\bsketch\b/i,spoken:/\bsketch\b/i},
 {name:'Jynxzi',short:'Jynxzi',source:/\bjynxzi\b/i,spoken:/\bjynxzi\b/i},
 {name:'xQc',short:'xQc',source:/\bxqc\b/i,spoken:/\bx ?q ?c\b/i},
 {name:'Druski',short:'Druski',source:/\bdruski\b/i,spoken:/\bdruski\b/i},
 {name:'Plaqueboymax',short:'Max',source:/\bplaqueboymax\b/i,spoken:/\bplaqueboymax\b/i},
 {name:'Lacy',short:'Lacy',source:/\blacy\b/i,spoken:/\blacy\b/i},
 {name:'N3on',short:'N3on',source:/\bn3on\b|\bneon\b/i,spoken:/\bn3on\b/i},
 {name:'Jidion',short:'Jidion',source:/\bjidion\b/i,spoken:/\bjidion\b/i},
 {name:'Ludwig',short:'Ludwig',source:/\bludwig\b/i,spoken:/\bludwig\b/i},
 {name:'Pokimane',short:'Poki',source:/\bpokimane\b/i,spoken:/\bpokimane\b|\bpoki\b/i},
 {name:'Valkyrae',short:'Rae',source:/\bvalkyrae\b/i,spoken:/\bvalkyrae\b/i},
 {name:'MrBeast',short:'MrBeast',source:/\bmr\.?\s*beast\b/i,spoken:/\bmr\.? ?beast\b/i},
 {name:'Kevin Hart',short:'Kevin Hart',source:/\bkevin\s*hart\b/i,spoken:/\bkevin hart\b/i},
 {name:'Snoop Dogg',short:'Snoop',source:/\bsnoop\s*dogg?\b/i,spoken:/\bsnoop\b/i}
];
const word=s=>new RegExp(`(?<![\\p{L}\\p{N}])${String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'iu');
const GROUPS=[{name:'AMP',source:/\bamp\b|\bany means possible\b/i}];

/** Uploader and channel details yt-dlp saved next to the download (older jobs have no copy on the job itself). */
export function sourceInfo(job,folder){
 if(job.sourceInfo)return job.sourceInfo;
 try{const meta=fs.readdirSync(folder).find(f=>f.endsWith('.info.json'));if(meta){const i=JSON.parse(fs.readFileSync(path.join(folder,meta),'utf8'));return {uploader:i.uploader||i.channel||'',channel:i.channel||'',uploaderId:i.uploader_id||'',tags:(i.tags||[]).slice(0,20)};}}catch{}
 return {};
}
const cleanChannel=s=>String(s||'').replace(/\b(?:live|clips?|tv|official|vods?|streams?|archive|highlights?)\b/gi,'').replace(/[^\p{L}\p{N}\s.'-]/gu,'').replace(/\s+/g,' ').trim();

/** Stream-wide people: the host (from the channel) and anyone named in the title or the creator's context. */
export function streamPeople(job,{folder,info=folder?sourceInfo(job,folder):job.sourceInfo||{}}={}){
 const channel=`${info.uploader||''} ${info.channel||''} ${info.uploaderId||''}`,written=`${job.title||''} ${job.options?.contextText||''}`;
 const known=PEOPLE.find(p=>p.source.test(channel));let host=known?{name:known.name,short:known.short,spoken:known.spoken,evidence:'channel'}:null;
 if(!host){const name=cleanChannel(info.uploader||info.channel);if(name&&name.split(' ').length<=3&&!/\d{3,}/.test(name))host={name,short:name.split(' ')[0],spoken:word(name.split(' ')[0]),evidence:'channel'};}
 const named=PEOPLE.filter(p=>p.source.test(written)&&p.name!==host?.name).map(p=>({name:p.name,short:p.short,spoken:p.spoken,evidence:'title or context'}));
 const groups=GROUPS.filter(g=>g.source.test(written)).map(g=>g.name);
 return {host,named,groups};
}

/** People with evidence for one moment: the host always (it is their stream), others only when named nearby or in the title. */
export function clipPeople(stream,nearbyText){
 const text=String(nearbyText||''),out=[];
 if(stream.host)out.push({name:stream.host.name,short:stream.host.short,evidence:'host (channel)'});
 for(const p of stream.named)out.push({name:p.name,short:p.short,evidence:p.evidence});
 for(const p of PEOPLE)if(!out.some(o=>o.name===p.name)&&p.spoken.test(text))out.push({name:p.name,short:p.short,evidence:'named in the clip'});
 return out;
}

/** Known people a title names without evidence for this clip (guards AI output against guessed names). */
export function unsupportedNames(text,allowed=[]){
 const ok=new Set(allowed.map(p=>p.name));return PEOPLE.filter(p=>!ok.has(p.name)&&(p.source.test(text)||word(p.short).test(text))&&!allowed.some(a=>word(a.short).test(p.short))).map(p=>p.name);
}

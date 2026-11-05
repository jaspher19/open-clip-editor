import fs from 'node:fs';import {captionFont} from './templates.mjs';
export const CAPTION_STYLES=JSON.parse(fs.readFileSync(new URL('../presets/captions.json',import.meta.url),'utf8'));
export function groupWords(words,{maxWords=3,maxChars=27,maxGap=.45}={}){
 const groups=[];let current=[];
 for(const w of words){if(current.length&&(current.length>=maxWords||current.map(x=>x.text).join(' ').length+w.text.length+1>maxChars||/[.!?]$/.test(current.at(-1).text)||w.start-current.at(-1).end>maxGap)){groups.push(current);current=[];}current.push(w);}if(current.length)groups.push(current);return groups;
}
const escape=s=>String(s).replaceAll('\\','＼').replaceAll('{','｛').replaceAll('}','｝').replace(/[\r\n]/g,' ').replace(/\s+/g,' ').trim();
const time=t=>{const n=Math.max(0,Math.round(t*100));return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};
const assColor=hex=>'&H00'+hex.slice(5,7)+hex.slice(3,5)+hex.slice(1,3)+'&';
// Burned-in text masks slurs and swearing (keep first and last letter); the .srt sidecar keeps the real words.
const PROFANE=/(motherfuck|fuck|shit|bitch|nigga|nigger|cunt|pussy|asshole|faggot|dick)/gi;
export function maskProfanity(text){return String(text).replace(PROFANE,m=>m[0]+'*'.repeat(m.length-2)+m.at(-1));}
const TITLE_STOP=new Set('a an the and or but of on in at to for with from by is are was were be been it its this that his her their my your our as up out off over into vs gets got goes went has have had does did just'.split(' '));
const STRONG=/^(viral|famous|angry|mad|wild|hilarious|broke|scared|jump|wins?|loses?|lost|fails?|cries|crying|rages?|raging|banned|caught|exposed|shocked|destroys?|roasts?|pranks?|breaks?|meets?|finds?|climbs?|falls?|crashes|explodes?|insane|crazy|first|never|last|ends?|quits?|fights?|kicked|arrested|cooks?|dunks?|saves?|steals?)$/i;
/** Index of the word to colour: prefer the action word, then a strong word, then the name at the start. */
export function emphasisIndex(words){let best=-1,score=-Infinity;words.forEach((raw,i)=>{const w=raw.replace(/[^\p{L}\p{N}']/gu,'');if(!w||TITLE_STOP.has(w.toLowerCase()))return;let s=w.length/20;if(STRONG.test(w))s+=4;else if(i>0&&/(ed|ing)$/i.test(w)&&w.length>4)s+=3;else if(i>0&&/[^s]s$/i.test(w)&&w.length>3)s+=2.5;else if(i===0)s+=1;if(/^\d/.test(w))s+=2;if(s>=score){score=s;best=i;}});return best;}
// Average advance per character as a share of the libass font size, measured from the bundled fonts.
const glyphWidth=(font,upper)=>({Anton:.28,'Barlow Condensed':.35,'Red Hat Mono':.45,'Montserrat Black':.38,'Montserrat ExtraBold':upper?.52:.45}[font]??(upper?.47:.37));
// Vertical metrics as shares of the libass font size (= winAscent+winDescent): baseline from the line top, and cap height.
const METRICS={Anton:{asc:2876/3550,cap:1760/3550},'Montserrat ExtraBold':{asc:1109/1562,cap:700/1562},'Montserrat Black':{asc:1109/1562,cap:700/1562},'Work Sans':{asc:1105/1448,cap:660/1448}};
// Stable pseudo-random pick for the `cycle` colour rule, never repeating the previous colour.
const pick=(k,n,prev)=>{if(n<2)return 0;const r=Math.floor(Math.abs(Math.sin(k*12.9898+1)*43758.5453))%(prev<0?n:n-1);return prev>=0&&r>=prev?r+1:r;};
const TITLE_FONTS={'meme-phrase':{font:'Montserrat Black',upper:true,size:88,min:64},impact:{font:'Anton',upper:true,size:156,min:110},gaming:{font:'Anton',upper:true,size:156,min:110}};
const titleFace=style=>TITLE_FONTS[style]||{font:'Montserrat Black',upper:false,size:122,min:88};
export function makeAss(words,{style='clean',title='',progressBar=false,duration=0,font='auto',accentColor='auto',captionPosition='lower',motionIntensity='balanced',hookEnabled=true,hookDuration=2.8,titleMode='opening',contextText='',seriesLabel='',captionsEnabled=true,rankItems=[],rankActive=0,framing='center',captionReveal='progressive',outputFormat='shorts',maskProfanity:mask=true,watermark='',watermarkY=.82,hookReveal='pop',hookPosition='top'}={}){
 const source=CAPTION_STYLES[style];if(!source)throw new Error('Invalid caption style');const preset={...source,font:captionFont(font)||source.font,active:accentColor==='auto'?source.active:assColor(accentColor)};const wide=outputFormat==='video',cx=wide?960:540;const clean=t=>mask?maskProfanity(t):String(t);
 // Captions sit in the lower-middle band (about 65-70% height on 9:16) so they never cover the face.
 // `middle` centres the caption block on the frame's horizontal midline (\an5, or \an8 from the block top for 2-line phrases).
 const position=(wide?{lower:940,middle:540,center:870,upper:460}:{lower:1330,middle:960,center:1250,upper:860})[captionPosition]||(wide?900:1330),middle=captionPosition==='middle',solid=preset.boxStyle==='solid';
 const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${wide?1920:1080}\nPlayResY: ${wide?1080:1920}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Work Sans,72,&H00FFFFFF,&H0077FFAA,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,5,1,2,70,70,440,1\nStyle: Title,Work Sans,62,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,8,90,90,190,1\n${solid?'Style: Box,Work Sans,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,12,0,2,0,0,0,1\n':''}\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
 const groups=captionsEnabled?groupWords(words,{maxWords:preset.maxWords,maxChars:preset.maxChars}):[];const lines=[];
 // Reference-template fields (docs/EDIT-CONTRACT.md): case, colorRule+palette, solid box, hard/soft shadow, glow, spacing, lines, minSize.
 const kase=preset.case||(preset.uppercase?'upper':'none'),upper=kase==='upper',cased=t=>upper?t.toUpperCase():kase==='lower'?t.toLowerCase():t,gw=glyphWidth(preset.font,upper);
 const rule=preset.colorRule||'active',palette=rule==='keywords'&&accentColor!=='auto'?[preset.active]:preset.palette?.length?preset.palette:[preset.active],flat=groups.flat(),tint=new Map();
 if(rule==='alternate')flat.forEach((w,k)=>tint.set(w,palette[k%palette.length]));
 // Turns: the colour changes at each sentence end, a stand-in for a change of speaker (yellow for one voice, cyan for the reply).
 if(rule==='turns'){let k=0;flat.forEach((w,n)=>{if(n&&/[.?!]["”]?$/.test(flat[n-1].text))k++;tint.set(w,palette[k%palette.length]);});}
 if(rule==='cycle'){let prev=-1;flat.forEach((w,k)=>{prev=pick(k,palette.length,prev);tint.set(w,palette[prev]);});}
 // Keywords: per phrase, the longest content word plus any word ending in ! or ?, in the phrase's palette colour (rotating per phrase).
 if(rule==='keywords')(preset.maxWords>=3?groups:groupWords(flat,{maxWords:6,maxChars:48})).forEach((p,pi)=>{const bare=p.map(w=>w.text.replace(/[^\p{L}\p{N}']/gu,''));let hot=-1;bare.forEach((b,i)=>{if(b.length>=4&&!TITLE_STOP.has(b.toLowerCase())&&(hot<0||b.length>bare[hot].length))hot=i;});p.forEach((w,i)=>{if(i===hot||/[!?]$/.test(w.text))tint.set(w,palette[pi%palette.length]);});});
 const colour=(x,w)=>rule==='active'?(x===w?preset.active:preset.inactive):tint.get(x)||preset.inactive;
 // Phrase styles (lines>1) wrap the whole group into 2 balanced rows once it is too wide; the break stays fixed while words build up.
 const rowBreak=d=>{if((preset.lines||1)<2||d.length<2||d.join(' ').length*gw*preset.size<=(wide?1600:980))return 0;let best=0,longest=Infinity;for(let i=1;i<d.length;i++){const l=Math.max(d.slice(0,i).join(' ').length,d.slice(i).join(' ').length);if(l<longest){longest=l;best=i;}}return best;};
 // A title in the middle of the frame owns that spot: captions start once it is gone (as on the skull-ending reference).
 const hookEnd=title&&hookEnabled&&hookPosition==='middle'&&framing!=='editorial'&&titleMode!=='persistent'?Math.min(hookDuration,duration||hookDuration):0;
 for(let gi=0;gi<groups.length;gi++){const g=groups[gi],full=g.map(x=>clean(cased(x.text))),cut=captionReveal==='word'?0:rowBreak(full);for(let i=0;i<g.length;i++){
  // `hold`: one-word styles keep the word up a little past its end (never over the next word), like the references.
  const w=g[i],end=Math.min(Math.max(w.end+(preset.hold||0),w.start+.04),g[i+1]?.start??Infinity,groups[gi+1]?.[0].start??Infinity);
  const from=Math.max(w.start,hookEnd);if(end<=from)continue;const visible=captionReveal==='word'?[w]:captionReveal==='phrase'?g:g.slice(0,i+1);const display=visible.map(x=>clean(cased(x.text)));const chars=(preset.lines||1)>1?(cut?Math.max(full.slice(0,cut).join(' ').length,full.slice(cut).join(' ').length):full.join(' ').length):display.join(' ').length;const size=Math.min(preset.size,Math.max(preset.minSize??70,Math.floor((preset.fitWidth||900)/(Math.min(chars,28)*gw))));
  const join=(parts)=>parts.map((p,j)=>(j?(cut&&g.indexOf(visible[j])===cut?'\\N':' '):'')+p).join('');
  const text=join(visible.map((x,j)=>`{\\c${colour(x,w)}}${escape(display[j]).replace(/(.{25})(?=.)/g,'$1\\N')}`));
  const motion=motionIntensity==='off'?'':motionIntensity==='subtle'?'\\fad(60,45)':motionIntensity==='punchy'?'\\fscx82\\fscy82\\t(0,80,\\fscx112\\fscy112)\\t(80,170,\\fscx100\\fscy100)':preset.pop==='small'?'\\fscx95\\fscy95\\t(0,250,\\fscx100\\fscy100)':preset.pop?'\\fscx92\\fscy92\\t(0,95,\\fscx104\\fscy104)\\t(95,180,\\fscx100\\fscy100)':'\\fad(40,30)';
  // Single-line `middle` captions centre the capitals (not the font's line box) on the midline when the font's metrics are known.
  const m=METRICS[preset.font],mid=position-(m&&!cut?Math.round(size*(m.asc-.5-m.cap/2)):0),pad=preset.boxPad??12;
  const at=(dx=0,dy=0)=>middle?(cut?`\\an8\\pos(${cx+dx},${position-size+dy})`:`\\an5\\pos(${cx+dx},${mid+dy})`):`\\an2\\pos(${cx+dx},${position+dy})`;
  // libass draws the BorderStyle 3 box over the whole line box; clip it to the capitals plus the padding so it hugs the word.
  const lineTop=middle?mid-size/2:position-size,trim=solid&&m&&!text.includes('\\N')?`\\clip(0,${Math.round(lineTop+size*(m.asc-m.cap)-pad)},${wide?1920:1080},${Math.round(lineTop+size*m.asc+pad)})`:'',face=`\\fn${preset.font}\\fs${size}${preset.spacing?`\\fsp${preset.spacing}`:''}`;
  const soft=preset.shadow&&preset.shadowBlur,shade=preset.shadowColor||'&H00000000&';
  const look=solid?`\\bord${pad}\\3c${preset.boxColor||'&H00000000&'}\\3a&H00&\\shad0${trim}`:`\\bord${preset.outline}${preset.outlineColor?`\\3c${preset.outlineColor}`:''}${preset.box?'\\3c&H0F2118&\\4c&H0F2118&\\shad0\\bord10':soft?'\\shad0':preset.shadow?`\\shad${preset.shadow}\\4c${shade}\\4a${preset.shadowAlpha||'&H00&'}`:'\\shad3\\4a&H50&'}`;
  const overrides=`{${at()}${face}${look}${motion}}`,under=soft||preset.glow?1:0,stamp=`${time(from)},${time(end)}`;
  // Soft shadow: a blurred, offset, translucent copy one layer down. Glow: a blurred copy in each glowing word's colour.
  if(soft)lines.push(`Dialogue: 0,${stamp},Default,,0,0,0,,{${at(preset.shadow,preset.shadow)}${face}\\bord0\\shad0\\c${shade}\\alpha${preset.shadowAlpha||'&H80&'}\\blur${preset.shadowBlur}${motion}}${join(display.map(d=>escape(d)))}`);
  if(preset.glow)lines.push(`Dialogue: 0,${stamp},Default,,0,0,0,,{${at()}${face}\\shad0\\blur${preset.glow}${motion}}${join(visible.map((x,j)=>{const c=colour(x,w),on=rule!=='keywords'||tint.has(x);return `{${on?`\\alpha${preset.glowAlpha||'&H66&'}\\c${c}\\3c${c}\\bord${Math.round(preset.glow/2)}`:'\\alpha&HFF&'}}${escape(display[j])}`;}))}`);
  lines.push(`Dialogue: ${under},${stamp},${solid?'Box':'Default'},,0,0,0,,${overrides}${text}`);
 }}
 // Faded channel handle for the whole clip, under the captions.
 if(watermark&&duration>0)lines.push(`Dialogue: -1,${time(0)},${time(duration)},Default,,0,0,0,,{\\an5\\pos(${cx},${Math.round(Number(watermarkY)*(wide?1080:1920))})\\fn${preset.font}\\fs${wide?30:38}\\c&H00FFFFFF&\\1a&H8C&\\3c&H00000000&\\3a&HB4&\\bord2\\shad0}${escape(clean(watermark))}`);
 // Safe zone: stream overlays (viewer counters, platform icons, chat) live in the top ~13% and at the right edge.
 const safeTop=wide?96:250,labelGap=seriesLabel?(wide?54:66):0;
 let titleBottom=0;
 // Modern hook title (all templates except editorial): heavy font, white with a thick black outline and drop shadow,
 // one action/name word in the accent colour, at most two balanced lines, pop-in, held for the whole clip.
 if(title&&hookEnabled&&framing!=='editorial'){const face=titleFace(style),maxWidth=wide?1100:900,words=escape(clean(title)).split(' ').filter(Boolean).map(w=>face.upper?w.toUpperCase():w);
  const fit=(rows,fs)=>Math.max(...rows.map(r=>r.join(' ').length))*fs*glyphWidth(face.font,face.upper)<=maxWidth;
  const split=list=>{if(list.join(' ').length<=14||list.length<2)return [list];let best=null;for(let i=1;i<list.length;i++){const r=[list.slice(0,i),list.slice(i)],longest=Math.max(...r.map(x=>x.join(' ').length));if(!best||longest<best.longest)best={rows:r,longest};}return best.rows;};
  const start=Math.round(face.size*(wide?.85:1)),floor=Math.round(face.min*(wide?.85:1));let kept=words,rows=wide&&fit([words],start)?[words]:split(kept),size=start;while(!fit(rows,size)&&size>floor)size-=2;
  while(!fit(rows,size)&&kept.length>2){kept=kept.slice(0,-1);rows=split([...kept.slice(0,-1),kept.at(-1)+'…']);}
  const flat=rows.flat(),hot=emphasisIndex(flat.map(w=>w.replace(/…$/,''))),white='&H00FFFFFF&';let n=0;
  const body=rows.map(r=>r.map(w=>{const i=n++;return i===hot?`{\\c${preset.active}}${w}{\\c${white}}`:w;}).join(' ')).join('\\N');
  const end=titleMode==='persistent'&&duration>0?duration:Math.min(hookDuration,duration||hookDuration),top=hookPosition==='middle'?Math.round((wide?1080:1920)*.47-rows.length*size*1.08/2):safeTop+labelGap;titleBottom=top+Math.round(rows.length*size*1.08);
  const pop=motionIntensity==='off'?'':'\\fscx80\\fscy80\\t(0,140,\\fscx106\\fscy106)\\t(140,260,\\fscx100\\fscy100)\\fad(40,0)';
  // Typewriter: letters appear one by one over ~0.7 s (karaoke \ko with an invisible unsung colour), a second row in the accent colour.
  if(hookReveal==='typewriter'){const chars=rows.flat().join(' ').length,k=Math.max(2,Math.round(70/Math.max(1,chars)));const typed=rows.map((r,ri)=>`{\\c${ri&&rows.length>1?preset.active:white}}`+[...r.join(' ')].map(ch=>`{\\ko${k}}${ch}`).join('')).join('\\N');
   lines.push(`Dialogue: 2,${time(0)},${time(end)},Title,,0,0,0,,{\\an8\\pos(${cx},${top})\\fn${face.font}\\fs${size}\\2a&HFF&\\3c&H00000000&\\bord${face.font==='Anton'?6:7}\\shad0}${typed}`);}
  else lines.push(`Dialogue: 2,${time(0)},${time(end)},Title,,0,0,0,,{\\an8\\pos(${cx},${top})${pop}\\fn${face.font}\\fs${size}\\c${white}\\3c&H00000000&\\bord${face.font==='Anton'?7:8}\\shad5\\4c&H00000000&\\4a&H40&}${body}`);
 }
 // Editorial keeps its own dark headline on the white canvas.
 if(title&&hookEnabled&&framing==='editorial'){const full=escape(clean(title)),cut=full.length>80?full.slice(0,81).replace(/\s+\S*$/,'')+'…':full,text=cut.split(' ');const count=cut.length<22?1:cut.length<=44?2:3,line=(a,b)=>text.slice(a,b).join(' ');let rows=[cut];
 // Balanced breaks: pick the split points that keep the longest row shortest (long titles get a third row, not a smaller font).
 if(count>1&&text.length>1){let best=Infinity;for(let i=1;i<text.length;i++)for(let j=count===3?i+1:text.length;j<=text.length;j++){const r=count===3&&j<text.length?[line(0,i),line(i,j),line(j)]:[line(0,i),line(i)];const longest=Math.max(...r.map(x=>x.length))+(r.length<count?.5:0);if(longest<best){best=longest;rows=r;}}}const size=Math.min(90,Math.floor(840/(Math.max(...rows.map(r=>r.length))*(preset.font==='Anton'?.48:preset.font==='Barlow Condensed'?.45:.58))));const end=titleMode==='persistent'&&duration>0?duration:Math.min(hookDuration,duration||hookDuration);const top=(wide?36:150)+(seriesLabel?(wide?50:70):0);titleBottom=top+Math.round(rows.length*size*1.12);const entrance=motionIntensity==='off'?`\\pos(${cx},${top})`:`\\move(${cx},${top+30},${cx},${top},0,180)\\fad(80,160)`;
  lines.push(`Dialogue: 2,${time(0)},${time(end)},Title,,0,0,0,,{\\an8${entrance}\\fn${preset.font}\\fs${size}\\c${framing==='editorial'?'&H00202020&':preset.active}\\3c${framing==='editorial'?'&H00FFFFFF&':'&H00101010&'}${framing==='editorial'?'\\bord0\\shad0':'\\bord5\\shad4\\4c&H00101010&'}}${rows.join('\\N')}`);
 }
 if(contextText&&duration>0){const safe=escape(clean(contextText));const split=safe.length>46?safe.lastIndexOf(' ',Math.ceil(safe.length/2)):-1;const rows=split>0?[safe.slice(0,split),safe.slice(split+1)]:[safe];const size=Math.min(46,Math.floor(900/(Math.max(...rows.map(r=>r.length))*.55)));lines.push(`Dialogue: 2,${time(0)},${time(duration)},Title,,0,0,0,,{\\an8\\pos(${cx},${titleBottom?titleBottom+14:(framing==='editorial'?150:safeTop)})\\fnWork Sans\\fs${size}\\c${framing==='editorial'?'&H00404040&':'&H00FFFFFF&'}\\3c${framing==='editorial'?'&H00FFFFFF&':'&H00101010&'}\\bord${framing==='editorial'?0:3}}${rows.join('\\N')}`);}
 if(seriesLabel&&duration>0)lines.push(`Dialogue: 2,${time(0)},${time(duration)},Title,,0,0,0,,{\\an8\\pos(${cx},${framing==='editorial'?(wide?20:155):safeTop})\\fnWork Sans\\b1\\fs${wide?40:44}\\c${preset.active}\\3c&H00000000&\\bord4\\shad2}${escape(clean(seriesLabel))}`);
 if(rankActive>0&&rankItems.length&&duration>0){rankItems.forEach((text,i)=>{const selected=i+1===rankActive,label=escape(clean(text)),rankSize=Math.min(selected?50:42,Math.floor(850/((label.length+3)*.45)));lines.push(`Dialogue: 3,${time(0)},${time(duration)},Title,,0,0,0,,{\\an7\\pos(90,${(wide?380:620)+i*70})\\fnBarlow Condensed\\fs${rankSize}\\c${selected?preset.active:'&H00FFFFFF&'}\\bord4}${i+1}. ${label}`);});}
 if(progressBar&&duration>0){lines.push(`Dialogue: -1,${time(0)},${time(duration)},Default,,0,0,0,,{\\an7\\pos(0,${wide?1068:1908})\\p1\\bord0\\shad0\\c${preset.active}\\clip(0,${wide?1068:1908},0,${wide?1080:1920})\\t(0,${Math.round(duration*1000)},\\clip(0,${wide?1068:1908},${wide?1920:1080},${wide?1080:1920}))}m 0 0 l ${wide?1920:1080} 0 l ${wide?1920:1080} 12 l 0 12`);}
 return header+lines.join('\n')+'\n';
}
export function makeSrt(words){const stamp=t=>{const n=Math.round(t*1000);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};return groupWords(words).map((g,i)=>`${i+1}\n${stamp(g[0].start)} --> ${stamp(g.at(-1).end)}\n${g.map(w=>w.text).join(' ')}\n`).join('\n');}

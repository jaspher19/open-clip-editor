// Video cutter captions, shared by the browser preview and the export (server/cut.mjs) so both agree on fonts,
// grouping and sizes. The export draws them with libass, which sizes a font by its Windows ascent + descent; the
// browser sizes by the em. `em` is unitsPerEm / (usWinAscent + usWinDescent) per font file (web/public/fonts), so
// libass size = em pixels / em. Measured from the font files; tests/cutter-captions.test.mjs re-reads them.

/** Fonts for cutter text and captions: id, name, CSS/ASS family, weight, file, em ratio. */
export const CUT_FONTS=[
 {id:'anton',name:'Anton',family:'Anton',weight:400,file:'Anton-Regular.ttf',em:.5769},
 {id:'montserrat-black',name:'Montserrat Black',family:'Montserrat Black',weight:400,file:'Montserrat-Black.ttf',em:.6402},
 {id:'montserrat',name:'Montserrat ExtraBold',family:'Montserrat ExtraBold',weight:400,file:'Montserrat-ExtraBold.ttf',em:.6402},
 {id:'barlow',name:'Barlow Condensed',family:'Barlow Condensed',weight:700,file:'BarlowCondensed-Bold.ttf',em:.7413},
 {id:'work',name:'Work Sans Bold',family:'Work Sans',weight:700,file:'WorkSans-Bold.ttf',em:.6906},
 {id:'luckiest',name:'Luckiest Guy',family:'Luckiest Guy',weight:400,file:'LuckiestGuy-Regular.ttf',em:.8159},
 {id:'bangers',name:'Bangers',family:'Bangers',weight:400,file:'Bangers-Regular.ttf',em:.5692},
 {id:'comic',name:'Comic Neue Bold',family:'Comic Neue',weight:700,file:'ComicNeue-Bold.ttf',em:.7407},
];
export const cutFont=id=>CUT_FONTS.find(f=>f.id===id)||CUT_FONTS[0];

/** Caption look: like a text item (font, size as a share of the video width, colours, outline/box/shadow, position), plus the spoken word's highlight and how many words show at once. */
export const CAPTION_DEFAULT={font:'anton',size:.075,color:'#ffffff',highlight:'#ffe600',style:'outline',boxColor:'#000000',upper:true,words:3,x:.5,y:.7};
export const CAPTION_PRESETS=[
 {id:'bold',name:'Bold pop',look:{font:'anton',size:.08,color:'#ffffff',highlight:'#ffe600',style:'outline',upper:true,words:3}},
 {id:'boxed',name:'Boxed',look:{font:'anton',size:.075,color:'#ffffff',highlight:'#ffe600',style:'box',boxColor:'#000000',upper:true,words:2}},
 {id:'comic',name:'Comic',look:{font:'luckiest',size:.07,color:'#ffffff',highlight:'#4cff6a',style:'outline',upper:true,words:3}},
 {id:'one',name:'One word',look:{font:'bangers',size:.11,color:'#ffffff',highlight:'#ffffff',style:'outline',upper:true,words:1}},
 {id:'clean',name:'Clean',look:{font:'montserrat',size:.055,color:'#ffffff',highlight:'#7ee0ff',style:'shadow',upper:false,words:4}},
 {id:'yellow',name:'Lowercase yellow',look:{font:'work',size:.065,color:'#ffd800',highlight:'#ffffff',style:'outline',upper:false,words:2}},
];
const hex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const num=(v,a,b,d)=>{const n=Number(v);return Number.isFinite(n)?Math.min(b,Math.max(a,n)):d;};
/** A caption look from anything (saved drafts, requests): known fonts and styles, numbers clamped. */
export function cleanCaption(c={}){
 return {font:CUT_FONTS.some(f=>f.id===c.font)?c.font:CAPTION_DEFAULT.font,size:num(c.size,.025,.2,CAPTION_DEFAULT.size),color:hex(c.color)?c.color:CAPTION_DEFAULT.color,highlight:hex(c.highlight)?c.highlight:CAPTION_DEFAULT.highlight,
  style:['outline','box','shadow'].includes(c.style)?c.style:'outline',boxColor:hex(c.boxColor)?c.boxColor:CAPTION_DEFAULT.boxColor,upper:c.upper!==false,words:Math.round(num(c.words,1,6,3)),x:num(c.x,.05,.95,.5),y:num(c.y,.05,.95,.7)};
}

/** Key of a transcript word for caption corrections (its start, to the hundredth of a second). */
export const wordKey=w=>Number(w.start).toFixed(2);
const clean=t=>String(t||'').replace(/[{}\\]/g,'').trim();
/**
 * Caption groups for one part: `per` words at most, a new group after a pause (≥ 0.6 s) or a sentence end. Each group
 * shows from its first word until the next group starts (or 0.25 s after its last word when a pause follows).
 */
export function captionGroups(words,{per=3,edits={},upper=true}={}){
 // Pieces the transcriber splits off ("$17" ",000", "don" "'t") join the word before, so they show and highlight as one word.
 const list=[];for(const w of words.map(w=>({...w,text:clean(edits[wordKey(w)]??w.text)})).filter(w=>w.text&&w.end>w.start)){const prev=list.at(-1);
  if(prev&&w.start-prev.end<.3&&/^[,.!?;:%)’'-]/.test(w.text))Object.assign(prev,{text:prev.text+w.text,end:w.end});else list.push({...w});}
 const groups=[];let cur=[];
 for(let i=0;i<list.length;i++){const w=list[i],prev=cur.at(-1);if(cur.length&&(cur.length>=per||w.start-prev.end>=.6||/[.!?]$/.test(prev.text))){groups.push(cur);cur=[];}cur.push(w);}
 if(cur.length)groups.push(cur);
 return groups.map((g,k)=>{const next=groups[k+1]?.[0],last=g.at(-1),end=next&&next.start-last.end<.6?next.start:last.end+.25;
  return {start:g[0].start,end:Math.max(end,g[0].start+.1),words:g.map(w=>({start:w.start,end:w.end,text:upper?w.text.toUpperCase():w.text}))};});
}
/** The group on screen at time t and the index of its spoken word (the last word started), or null. */
export function captionAt(groups,t){const g=groups.find(x=>t>=x.start&&t<x.end);if(!g)return null;let i=0;g.words.forEach((w,k)=>{if(w.start<=t+.01)i=k;});return {group:g,active:i};}

/** Pixel sizes both renderers use, for a video `width` pixels wide: em size, libass size, line height, outline, box padding, shadow. */
export function captionMetrics(c,width){const f=cutFont(c.font),em=c.size*width,ass=em/f.em;return {em,ass,line:ass,bord:em*.08,pad:em*.18,shadow:em*.07};}

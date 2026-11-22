import {CUT_FONTS,captionMetrics,cutFont} from './cutCaptions.mjs';
// Text on Video cutter exports. The same function draws the live preview and the full-size transparent PNG the
// server lays over the video, so the export matches the preview exactly (font, size, outline, position).

export type TextItem={id:string;text:string;font:string;size:number;color:string;style:'outline'|'box'|'plain';boxColor:string;upper:boolean;x:number;y:number};
export const TEXT_FONTS:{id:string;name:string;family:string;weight:number}[]=CUT_FONTS;
const fontOf=(id:string)=>TEXT_FONTS.find(f=>f.id===id)||TEXT_FONTS[0];
const cssFont=(t:TextItem,px:number)=>{const f=fontOf(t.font);return `${f.weight} ${px.toFixed(2)}px "${f.family}"`;};
export const newText=(n:number):TextItem=>({id:Math.random().toString(36).slice(2,9),text:n?'More text':'YOUR CAPTION HERE',font:'anton',size:.075,color:'#ffffff',style:'outline',boxColor:'#000000',upper:true,x:.5,y:n?.3+.08*n:.2});

/** Wait until the fonts these texts use are loaded, so the canvas doesn't draw a fallback font. */
export async function loadFonts(texts:TextItem[]){await Promise.all([...new Set(texts.map(t=>t.font))].map(id=>{const f=fontOf(id);return document.fonts.load(`${f.weight} 48px "${f.family}"`).catch(()=>[]);}));}

/** Draws every text on a canvas of cw × ch; returns each text's bounds as shares [x, y, w, h] (for dragging). */
export function drawTexts(ctx:CanvasRenderingContext2D,texts:TextItem[],cw:number,ch:number):Record<string,[number,number,number,number]>{
 const bounds:Record<string,[number,number,number,number]>={};
 for(const t of texts){const raw=(t.upper?t.text.toUpperCase():t.text).split('\n'),lines=raw.map(l=>l.trimEnd());if(!lines.some(l=>l.trim()))continue;
  const px=Math.max(4,t.size*cw),lead=px*1.12;ctx.save();ctx.font=cssFont(t,px);ctx.textAlign='center';ctx.textBaseline='middle';
  const widths=lines.map(l=>ctx.measureText(l).width),wide=Math.max(...widths),tall=lead*lines.length,cx=t.x*cw,cy=t.y*ch,top=cy-tall/2;
  const pad=t.style==='box'?px*.32:t.style==='outline'?px*.12:0;
  if(t.style==='box'){ctx.fillStyle=t.boxColor;const r=px*.22,x=cx-wide/2-pad,y=top-pad*.6,w=wide+pad*2,h=tall+pad*1.2;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  lines.forEach((l,i)=>{const y=top+lead*(i+.5);
   if(t.style==='outline'){ctx.lineJoin='round';ctx.miterLimit=2;ctx.lineWidth=px*.16;ctx.strokeStyle='#000000';ctx.strokeText(l,cx,y);}
   if(t.style==='plain'){ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=px*.18;ctx.shadowOffsetY=px*.05;}
   ctx.fillStyle=t.color;ctx.fillText(l,cx,y);});
  ctx.restore();
  bounds[t.id]=[(cx-wide/2-pad)/cw,(top-pad*.6)/ch,(wide+pad*2)/cw,(tall+pad*1.2)/ch];}
 return bounds;
}

/** The text layer at export size, as a PNG data URL; null when there is no text. */
export async function textLayer(texts:TextItem[],width:number,height:number):Promise<string|null>{
 const shown=texts.filter(t=>t.text.trim());if(!shown.length)return null;await loadFonts(shown);
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('This browser cannot draw the text layer');
 drawTexts(ctx,shown,width,height);return canvas.toDataURL('image/png');
}

export type CaptionLook={font:string;size:number;color:string;highlight:string;style:'outline'|'box'|'shadow';boxColor:string;upper:boolean;words:number;x:number;y:number};
export type CaptionNow={group:{words:{text:string}[]};active:number}|null;
/**
 * Draws the caption on screen the way libass will (server/cut.mjs captionsAss): same em size, line height (the font's
 * ascent + descent), outline width, per-line box and hard shadow, greedy wrapping inside 6% margins, centred on (x, y).
 * With no caption at this moment and `sample`, a faded sample shows where captions will go. Returns the bounds as shares.
 */
export function drawCaption(ctx:CanvasRenderingContext2D,c:CaptionLook,now:CaptionNow,cw:number,ch:number,{sample=false}={}):[number,number,number,number]|null{
 const words=now?now.group.words.map(w=>w.text):sample?(c.upper?['YOUR','CAPTIONS','HERE']:['your','captions','here']).slice(0,Math.max(1,Math.min(3,c.words))):[];if(!words.length)return null;
 const f=cutFont(c.font),m=captionMetrics(c,cw),max=cw*(1-.12);ctx.save();ctx.font=`${f.weight} ${m.em.toFixed(2)}px "${f.family}"`;ctx.textAlign='left';ctx.textBaseline='middle';if(!now)ctx.globalAlpha=.45;
 const space=ctx.measureText(' ').width,rows:{i:number;w:string;x:number}[][]=[];let row:{i:number;w:string;x:number}[]=[],width=0;
 words.forEach((w,i)=>{const ww=ctx.measureText(w).width;if(row.length&&width+space+ww>max){rows.push(row);row=[];width=0;}row.push({i,w,x:width+(row.length?space:0)});width+=(row.length>1?space:0)+ww;});rows.push(row);
 const lineW=rows.map(r=>{const last=r.at(-1)!;return last.x+ctx.measureText(last.w).width;}),top=c.y*ch-rows.length*m.line/2;
 rows.forEach((r,k)=>{const y=top+m.line*(k+.5),left=c.x*cw-lineW[k]/2;
  if(c.style==='box'){ctx.fillStyle=c.boxColor;ctx.fillRect(left-m.pad,y-m.line/2-m.pad*.25,lineW[k]+m.pad*2,m.line+m.pad*.5);}
  for(const p of r){const x=left+p.x,color=now&&p.i===now.active?c.highlight:c.color;
   if(c.style==='outline'){ctx.lineJoin='round';ctx.miterLimit=2;ctx.lineWidth=m.bord*2;ctx.strokeStyle='#000';ctx.strokeText(p.w,x,y);}
   if(c.style==='shadow'){ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillText(p.w,x+m.shadow,y+m.shadow);}
   ctx.fillStyle=color;ctx.fillText(p.w,x,y);}});
 ctx.restore();const wide=Math.max(...lineW)+m.pad*2,tall=rows.length*m.line+m.pad;return [(c.x*cw-wide/2)/cw,(top-m.pad/2)/ch,wide/cw,tall/ch];
}

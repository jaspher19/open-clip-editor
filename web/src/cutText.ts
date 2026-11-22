// Text on Video cutter exports. The same function draws the live preview and the full-size transparent PNG the
// server lays over the video, so the export matches the preview exactly (font, size, outline, position).

export type TextItem={id:string;text:string;font:string;size:number;color:string;style:'outline'|'box'|'plain';boxColor:string;upper:boolean;x:number;y:number};
export const TEXT_FONTS:{id:string;name:string;family:string;weight:number}[]=[
 {id:'anton',name:'Anton',family:'Anton',weight:400},
 {id:'montserrat-black',name:'Montserrat Black',family:'Montserrat Black',weight:400},
 {id:'montserrat',name:'Montserrat ExtraBold',family:'Montserrat ExtraBold',weight:400},
 {id:'barlow',name:'Barlow Condensed',family:'Barlow Condensed',weight:700},
 {id:'work',name:'Work Sans Bold',family:'Work Sans',weight:700},
 {id:'luckiest',name:'Luckiest Guy',family:'Luckiest Guy',weight:400},
 {id:'bangers',name:'Bangers',family:'Bangers',weight:400},
 {id:'comic',name:'Comic Neue Bold',family:'Comic Neue',weight:700},
];
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

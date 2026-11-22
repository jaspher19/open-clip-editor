// Video cutter layouts (camera + gameplay), shared by the browser preview and the tests. Boxes are [x, y, w, h] as
// shares of their frame: source boxes of the source video, panels ("Out") of the exported video. A source box always
// has the same shape as its panel, so what you box on the source is exactly what shows in that panel.

export const OUTPUT={shorts:{width:1080,height:1920},video:{width:1920,height:1080}};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const r4=v=>+v.toFixed(4);
export const roundBox=b=>b.map(r4);

/** Pixel aspect (width / height) of a box inside a frame of w × h pixels. */
export const pixelAspect=(box,w,h)=>(box[2]*w)/(box[3]*h);

/** The largest box of `aspect` (pixels) that fits the source, scaled by `scale`, centred on (cx, cy) and kept inside. */
export function boxOf(aspect,sw,sh,{scale=1,cx=.5,cy=.5}={}){
 let w=1,h=(sw/aspect)/sh;if(h>1){h=1;w=(sh*aspect)/sw;}
 w*=scale;h*=scale;
 return roundBox([clamp(cx-w/2,0,1-w),clamp(cy-h/2,0,1-h),w,h]);
}

/** Re-shape a source box to `aspect` (pixels), keeping its centre and about the same area, inside the frame. */
export function refit(box,aspect,sw,sh){
 const area=box[2]*sw*box[3]*sh,cx=box[0]+box[2]/2,cy=box[1]+box[3]/2;
 let wp=Math.sqrt(area*aspect),hp=Math.sqrt(area/aspect);const shrink=Math.min(1,sw/wp,sh/hp);wp*=shrink;hp*=shrink;
 const w=wp/sw,h=hp/sh;return roundBox([clamp(cx-w/2,0,1-w),clamp(cy-h/2,0,1-h),w,h]);
}

/** Panels for each preset, per shape. */
export const PRESETS={
 shorts:[
  {id:'cam-top',name:'Camera on top',camOut:[0,0,1,.34],gameOut:[0,.34,1,.66],camOnTop:true},
  {id:'game-top',name:'Gameplay on top',camOut:[0,.66,1,.34],gameOut:[0,0,1,.66],camOnTop:true},
  {id:'cam-corner',name:'Camera in a corner',camOut:[.05,.04,.44,.17],gameOut:[0,0,1,1],camOnTop:true},
 ],
 video:[
  {id:'cam-corner',name:'Camera in a corner',camOut:[.70,.05,.27,.27],gameOut:[0,0,1,1],camOnTop:true},
  {id:'side',name:'Side by side',camOut:[0,0,.36,1],gameOut:[.36,0,.64,1],camOnTop:true},
  {id:'cam-big',name:'Big camera, small game',camOut:[0,0,1,1],gameOut:[.62,.05,.34,.34],camOnTop:false},
 ],
};

/** A preset applied to a layout: new panels, and each source box re-shaped to its panel (keeping where it was). */
export function applyPreset(layout,preset,format,sw,sh){
 const {width,height}=OUTPUT[format];
 return {...layout,camOut:[...preset.camOut],gameOut:[...preset.gameOut],camOnTop:preset.camOnTop,
  cam:refit(layout.cam,pixelAspect(preset.camOut,width,height),sw,sh),game:refit(layout.game,pixelAspect(preset.gameOut,width,height),sw,sh)};
}

/** Starting layout for a shape: the first preset, the camera in the top-left corner and the gameplay centred and as big as fits. */
export function defaultLayout(format,sw=1920,sh=1080){
 const preset=PRESETS[format][0],{width,height}=OUTPUT[format],camAspect=pixelAspect(preset.camOut,width,height),gameAspect=pixelAspect(preset.gameOut,width,height);
 const cam=boxOf(camAspect,sw,sh,{scale:.26,cx:.14,cy:.16});
 return {cam,game:boxOf(gameAspect,sw,sh),camOut:[...preset.camOut],gameOut:[...preset.gameOut],camOnTop:true,camHidden:false};
}

/** When a panel changes shape, its source box follows. */
export function withPanel(layout,which,panel,format,sw,sh){
 const {width,height}=OUTPUT[format],src=which==='cam'?'cam':'game',out=which==='cam'?'camOut':'gameOut';
 return {...layout,[out]:roundBox(panel),[src]:refit(layout[src],pixelAspect(panel,width,height),sw,sh)};
}

/**
 * A detected camera (source box) becomes the camera: its panel takes the camera's shape (same width, or the same
 * height for a full-width band), the other panel fills what is left of a stacked layout, and both source boxes follow.
 */
export function withCamera(layout,camBox,format,sw,sh){
 const {width,height}=OUTPUT[format],aspect=pixelAspect(camBox,sw,sh),out=[...layout.camOut],full=out[2]>=.99;
 let next={...layout,cam:roundBox(camBox),camHidden:false};
 if(full&&format==='shorts'){
  const h=clamp((width/aspect)/height,.2,.5),top=out[1]<.01;
  const camOut=top?[0,0,1,h]:[0,1-h,1,h],gameOut=top?[0,h,1,1-h]:[0,0,1,1-h];
  if(layout.gameOut[2]>=.99&&layout.gameOut[3]<.99)next={...next,camOut:roundBox(camOut),gameOut:roundBox(gameOut),game:refit(layout.game,pixelAspect(gameOut,width,height),sw,sh)};
  else next={...next,camOut:roundBox(camOut)};
 }else{const h=clamp((out[2]*width/aspect)/height,.05,1-out[1]);next={...next,camOut:roundBox([out[0],out[1],out[2],h])};}
 return {...next,cam:refit(next.cam,pixelAspect(next.camOut,width,height),sw,sh)};
}

/** Move a box by (dx, dy) shares, kept inside the frame, snapping its edges and centre to `lines` within `snap`. */
export function moveBox(box,dx,dy,{lines=[0,.5,1],snap=.012}={}){
 let x=clamp(box[0]+dx,0,1-box[2]),y=clamp(box[1]+dy,0,1-box[3]);
 const near=(v,size)=>{for(const l of lines)for(const edge of [0,size/2,size])if(Math.abs(v+edge-l)<snap)return l-edge;return v;};
 x=clamp(near(x,box[2]),0,1-box[2]);y=clamp(near(y,box[3]),0,1-box[3]);
 return roundBox([x,y,box[2],box[3]]);
}

/**
 * Resize from a corner (`nw`, `ne`, `sw`, `se`) by (dx, dy) shares; the opposite corner stays put. With `ratio` (box
 * width / height in shares) the shape is kept. Never smaller than `min`, never outside the frame.
 * @param {number[]} box @param {string} corner @param {number} dx @param {number} dy
 * @param {{ratio?:number|null,min?:number,snap?:number,lines?:number[]}} [options]
 */
export function resizeBox(box,corner,dx,dy,{ratio=null,min=.05,snap=.012,lines=[0,1]}={}){
 const left=corner.includes('w'),top=corner.includes('n'),ax=left?box[0]+box[2]:box[0],ay=top?box[1]+box[3]:box[1];
 const snapTo=v=>{for(const l of lines)if(Math.abs(v-l)<snap)return l;return v;};
 let ex=snapTo(clamp(left?box[0]+dx:box[0]+box[2]+dx,0,1)),ey=snapTo(clamp(top?box[1]+dy:box[1]+box[3]+dy,0,1));
 let w=Math.max(min,left?ax-ex:ex-ax),h=Math.max(min,top?ay-ey:ey-ay);
 if(ratio){h=w/ratio;if(h<min){h=min;w=h*ratio;}
  const roomW=left?ax:1-ax,roomH=top?ay:1-ay;if(w>roomW){w=roomW;h=w/ratio;}if(h>roomH){h=roomH;w=h*ratio;}}
 else{w=Math.min(w,left?ax:1-ax);h=Math.min(h,top?ay:1-ay);}
 return roundBox([left?ax-w:ax,top?ay-h:ay,w,h]);
}

/** A source box resized with its panel's shape locked: ratio in shares = pixel aspect × (source height / width). */
export const shareRatio=(aspect,sw,sh)=>aspect*sh/sw;

/** Where cover-scaling puts a source rectangle into a panel: the centred part of the source with the panel's shape. */
export function coverSource(sx,sy,sw,sh,dw,dh){const pa=dw/dh;if(sw/sh>pa){const n=sh*pa;return [sx+(sw-n)/2,sy,n,sh];}const n=sw/pa;return [sx,sy+(sh-n)/2,sw,n];}

/** Checks a saved layout (browser storage can hold anything). */
export function sameShapeLayout(l){const ok=b=>Array.isArray(b)&&b.length===4&&b.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&b[2]>.01&&b[3]>.01;return !!l&&['cam','game','camOut','gameOut'].every(k=>ok(l[k]));}

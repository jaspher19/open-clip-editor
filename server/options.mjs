import {EDIT_TEMPLATES,captionFont} from './templates.mjs';
export const MUSIC_NAME=/^(?!\.)[\w ().,'&-]{1,120}\.(?:mp3|wav|m4a|aac|ogg|flac)$/i;
export const RETIRED_TEMPLATES=['impact','podcast','explain','story','gaming'];
export function validateOptions(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid options');
 // Retired templates (no reference video): saved projects keep their stored look as a custom edit.
 if(RETIRED_TEMPLATES.includes(input.editTemplate))input={...input,editTemplate:'custom'};
 const template=input.editTemplate&&input.editTemplate!=='custom'?EDIT_TEMPLATES.find(t=>t.id===input.editTemplate):null;
 if(input.editTemplate&&input.editTemplate!=='custom'&&!template)throw new Error('Invalid edit template');
 const out={count:'auto',autoExport:true,minDuration:45,maxDuration:90,threshold:.6,padding:.12,style:'clean',picker:'heuristic',model:'small',language:'auto',punchIn:false,progressBar:false,faceTrack:false,framing:'center',musicEnabled:false,musicVolume:-29,editTemplate:'custom',font:'auto',accentColor:'auto',captionPosition:'lower',motionIntensity:'balanced',punchInterval:2.8,punchZoom:1.08,hookEnabled:false,hookText:'',hookDuration:2.8,titleMode:'persistent',contextText:'',seriesLabel:'',captionsEnabled:true,rankItems:[],rankActive:0,outputFormat:'shorts',captionReveal:'progressive',captionOffsetMs:0,vfx:'none',soundEffects:'off',soundVolume:-27,autoEffects:true,coldOpen:false,coldOpenSeconds:1.6,coldOpenAt:null,loopEnding:false,profanityAudio:'keep',cropX:null,musicTrack:'',letterboxAspect:'3:4',watermark:'',watermarkY:.82,flashColor:'auto',grade:'none',revealFx:false,cutFlash:false,tintFlashes:false,skullEnding:false,actionLabels:false,hookReveal:'pop',hookPosition:'top',...template?.settings,...input};
 if(out.count!=='auto'&&(!Number.isInteger(out.count)||out.count<3||out.count>12))throw new Error('Invalid count: expected auto or 3–12');
 for(const [key,min,max] of [['minDuration',20,90],['maxDuration',20,90],['threshold',.2,2],['padding',.04,.25]])if(typeof out[key]!=='number'||!Number.isFinite(out[key])||out[key]<min||out[key]>max)throw new Error(`Invalid ${key}: expected ${min}–${max}`);
 if(out.minDuration>out.maxDuration)throw new Error('Invalid duration range');
 if(!['clean','creator','focus','impact','podcast','explain','story','gaming','editorial','reaction','boxed','boxed-yellow','facecam','rainbow','rainbow-rapid','neon-phrase','lowercase','raw-small','meme-word','meme-phrase'].includes(out.style))throw new Error('Invalid caption style');if(!['heuristic','openai','anthropic'].includes(out.picker))throw new Error('Invalid picker');
 if(!['small','small.en','medium','medium.en','base','base.en','large-v3-turbo'].includes(out.model))throw new Error('Invalid transcription model');
 if(typeof out.language!=='string'||!/^auto$|^[a-z]{2,3}$/.test(out.language))throw new Error('Invalid language');
 for(const k of ['punchIn','progressBar','faceTrack','musicEnabled','hookEnabled','captionsEnabled','autoExport'])if(typeof out[k]!=='boolean')throw new Error(`Invalid ${k}`);
 if(!['shorts','video'].includes(out.outputFormat))throw new Error('Invalid output format');
 if(!['progressive','word','phrase'].includes(out.captionReveal))throw new Error('Invalid caption reveal');
 if(!['none','accent','reaction'].includes(out.vfx)||!['off','soft','impact'].includes(out.soundEffects))throw new Error('Invalid effects');
 for(const [key,min,max]of [['captionOffsetMs',-1500,1500],['soundVolume',-40,-20]])if(!Number.isFinite(out[key])||out[key]<min||out[key]>max)throw new Error(`Invalid ${key}`);
 if(!['opening','persistent'].includes(out.titleMode))throw new Error('Invalid titleMode');
 if(typeof out.contextText!=='string'||out.contextText.length>140)throw new Error('Context must be 140 characters or fewer');
 if(typeof out.seriesLabel!=='string'||out.seriesLabel.length>24)throw new Error('Series label must be 24 characters or fewer');
 if(!Array.isArray(out.rankItems)||out.rankItems.length>5||out.rankItems.some(t=>typeof t!=='string'||t.length>60))throw new Error('Invalid rank items');
 if(!Number.isInteger(out.rankActive)||out.rankActive<0||out.rankActive>5)throw new Error('Invalid active rank');
 if(out.font!=='auto'&&!captionFont(out.font))throw new Error('Invalid caption font');
 if(out.accentColor!=='auto'&&(typeof out.accentColor!=='string'||!/^#[0-9a-f]{6}$/i.test(out.accentColor)))throw new Error('Invalid accent color');
 if(!['lower','middle','center','upper'].includes(out.captionPosition))throw new Error('Invalid caption position');
 if(!['off','subtle','balanced','punchy'].includes(out.motionIntensity))throw new Error('Invalid motion intensity');
 if(typeof out.hookText!=='string'||out.hookText.length>80)throw new Error('Keep the hook text to 80 characters');
 for(const [key,min,max]of [['punchInterval',1.5,8],['punchZoom',1,1.2],['hookDuration',1,5]])if(typeof out[key]!=='number'||!Number.isFinite(out[key])||out[key]<min||out[key]>max)throw new Error(`Invalid ${key}: choose ${min}–${max}`);
 if(!['center','face','fit','editorial','letterbox'].includes(out.framing))throw new Error('Invalid framing');
 // Template contract (docs/EDIT-CONTRACT.md): black letterbox band, faded @handle watermark, flash tint and colour grade.
 if(!['4:5','3:4'].includes(out.letterboxAspect))throw new Error('Invalid letterboxAspect');
 if(typeof out.watermark!=='string'||out.watermark.length>32||/[{}\\]/.test(out.watermark))throw new Error('Watermark must be 32 characters or fewer');
 if(typeof out.watermarkY!=='number'||!Number.isFinite(out.watermarkY)||out.watermarkY<.5||out.watermarkY>.95)throw new Error('Invalid watermarkY: choose 0.5–0.95');
 if(out.flashColor!=='auto'&&!/^#[0-9a-f]{6}$/i.test(String(out.flashColor)))throw new Error('Invalid flashColor');
 if(!['none','vivid','mono-peaks'].includes(out.grade))throw new Error('Invalid grade');
 // Automatic meme edit (server/meme-edit.mjs): reveal combo at the peak, flashes on cuts and shouted words, action labels, skull ending.
 if(!['top','middle'].includes(out.hookPosition))throw new Error('Invalid hookPosition');
 for(const k of ['revealFx','cutFlash','tintFlashes','skullEnding','actionLabels'])if(typeof out[k]!=='boolean')throw new Error(`Invalid ${k}`);
 if(!['pop','typewriter'].includes(out.hookReveal))throw new Error('Invalid hookReveal');
 if(input.framing!==undefined)out.faceTrack=out.framing==='face';else if(out.faceTrack)out.framing='face';
 if(typeof out.musicVolume!=='number'||!Number.isFinite(out.musicVolume)||out.musicVolume< -35||out.musicVolume> -20)throw new Error('Invalid musicVolume: choose -35 to -20 LUFS');
 for(const k of ['autoEffects','coldOpen','loopEnding'])if(typeof out[k]!=='boolean')throw new Error(`Invalid ${k}`);
 if(typeof out.coldOpenSeconds!=='number'||!Number.isFinite(out.coldOpenSeconds)||out.coldOpenSeconds<1||out.coldOpenSeconds>3)throw new Error('Invalid coldOpenSeconds: choose 1–3');
 if(out.coldOpenAt!==null&&(typeof out.coldOpenAt!=='number'||!Number.isFinite(out.coldOpenAt)||out.coldOpenAt<0))throw new Error('Invalid coldOpenAt');
 if(out.cropX!==null&&(typeof out.cropX!=='number'||!Number.isFinite(out.cropX)||out.cropX<0||out.cropX>1))throw new Error('Invalid cropX: choose 0–1');
 if(!['keep','beep','mute'].includes(out.profanityAudio))throw new Error('Invalid profanityAudio');
 // Music library entries are plain file names inside work/music-library; anything path-like is rejected.
 if(typeof out.musicTrack!=='string'||(out.musicTrack&&!MUSIC_NAME.test(out.musicTrack)))throw new Error('Invalid music track');
 return out;
}

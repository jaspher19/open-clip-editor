export type Word={start:number;end:number;text:string;probability?:number};
export type Settings={count:number|'auto';model:string;language:string;picker:string;style:string;threshold:number;punchIn:boolean;progressBar:boolean;faceTrack:boolean;
 // Reference template contract (docs/EDIT-CONTRACT.md).
 // (string&{}) keeps the known values as hints while App.tsx still assigns plain strings from form controls.
 captionPosition?:'lower'|'middle'|'center'|'upper'|(string&{});framing?:'center'|'face'|'fit'|'editorial'|'letterbox'|(string&{});letterboxAspect?:'3:4'|'4:5'|(string&{});watermark?:string;watermarkY?:number;flashColor?:'auto'|`#${string}`;grade?:'none'|'vivid'|'mono-peaks'|(string&{});[key:string]:unknown};
// Editing contract (docs/EDIT-CONTRACT.md): all times are source seconds.
export type Range={start:number;end:number};
export type EffectType='zoom'|'shake'|'flash'|'freeze'|'replay'|'sfx'|'pop'|'label';
export type Effect={id:string;type:EffectType;at:number;duration?:number;sound?:string;text?:string;emoji?:string;auto?:boolean};
export type Sound={id:string;name:string;group:string};
export type EngagementSettings={autoEffects?:boolean;coldOpen?:boolean;coldOpenSeconds?:number;coldOpenAt?:number|null;loopEnding?:boolean;profanityAudio?:'keep'|'beep'|'mute';cropX?:number|null;musicTrack?:string};
export type Clip={id:string;start:number;end:number;title:string;hook:string;score:number;reasons:string[];category?:'funny'|'highlight'|'clippable';exportError?:string;kept:boolean;dirty?:boolean;wordEdits?:Record<string,string>;settings:Partial<Settings>&EngagementSettings;contextText?:string;sourceContext?:{before:string;after:string;transcript:string};metadata?:UploadMetadata;peakAt?:number;cuts?:Range[];parts?:Range[];effects?:Effect[];titleOptions?:string[]};
export type Export={clipId:string;filename:string;sidecars?:string[];duration:number;bytes:number;createdAt:string;style:string;framing?:string;editTemplate?:string;font?:string;motionIntensity?:string;hookEnabled?:boolean};
export type MomentShape={label:string;about?:string;play:[number,number];min:number;max:number;payoff:[number,number];cut?:boolean;ending?:boolean;after?:number};
export type Job={moments?:Record<string,MomentShape>;id:string;title?:string;source:{type:string;name?:string;url?:string;section?:{start:number;end:number}};status:string;stage:string;progress:number;message:string;error?:string;createdAt:string;options:Settings;metadata?:{duration:number;width:number;height:number};clips:Clip[];exports:Export[];sourceUrl?:string;compilation?:Export;summary?:StreamSummary;musicName?:string;people?:string[];aiTitles?:{status:'done'|'skipped'|'failed';provider?:string;model?:string;error?:string};aiMoments?:{status:'done'|'skipped'|'failed';provider?:string;model?:string;pool?:number;error?:string};transcriptSummary?:{wordCount:number;language:string;model:string}};
export type Health={pythonReady:boolean;providers:Record<string,boolean>&{judge?:string|null};cachedModels:string[];styles:string[];templates:EditTemplate[];fonts:{id:string;name:string;family:string}[];features?:{faceTrack:boolean;music:boolean;creatorStyles:boolean}};

export type EditTemplate={id:string;name:string;category:string;description:string;sample:string;accent:string;fontFamily:string;settings:Partial<Settings>;referenceUrl?:string;reference?:ReferenceSample|null;requiresCompilation?:boolean;group?:string;moment?:MomentShape};

export type UploadMetadata={title:string;description:string;tags:string[];categoryId?:string};

export type ReferenceSample={available:boolean;loading:boolean;error:string;videoId:string;sourceUrl:string;videoUrl:string;posterUrl:string;timelineUrl:string;fidelity:string;duration:number;width:number;height:number;fps:number;videoDuration:number;audioDuration:number;frameCount:number;hasAudio:boolean;videoCodec:string;audioCodec:string;sha256:string;timingNotes:string};
export type ReferenceCue={id:string;kind:string;start:number;end:number;label:string;confidence:string};

export type SummaryMoment={start:number;end:number;category:'funny'|'highlight'|'clippable';label:string;title:string;score:number;duration:number;index:number};
export type StreamSummary={clipId:'stream-summary';filename:string;format:'video'|'shorts';width:number;height:number;duration:number;targetSeconds:number;moments:SummaryMoment[];chapters:{time:number;text:string;line:string}[];metadata:UploadMetadata;createdAt:string};

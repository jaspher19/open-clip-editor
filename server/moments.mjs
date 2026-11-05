// Shared moment signals for the clip picker and the stream summary: reaction cues in the words,
// loudness against the stream's own baseline, and on-screen text that stays advertiser friendly.
export const laugh=/\b(?:ha(?:ha)+h?|hah|lol|lmao|lmfao|hehe+|laugh\w*|i'?m dead|dying)\b|\(laugh/i;
export const strong=/\b(?:let'?s go+|no way|oh my god|oh my gosh|omg|insane|holy|we did it|unbelievable|clutch|what the)\b/i;
export const weak=/\b(?:crazy|wow|bro|dude|yo+|wait|yes+|hell no|nah)\b/i;
export const clipCue=/\b(?:clip (?:that|it|this)|clipped|that'?s a clip)\b/i;
export const hook=/\b(?:how|why|stop|mistake|secret|first|never|always|what|here|because|guess|watch)\b/i;
export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

// Slurs are removed outright; swearing keeps its first letter so the line still reads.
const SLURS=/\b(?:nigg(?:a|as|er|ers|ah)|faggots?|fags?|retards?|retarded)\b/gi;
const SWEARS=/\b(?:motherfuck\w*|fuck\w*|shit\w*|bitch\w*|bullshit|asshole\w*|dick(?:head)?s?|pussy|cunt\w*|damn|goddamn|hoes?)\b/gi;
/** Mask profanity for text burned into the video or used as a title. */
export function maskProfanity(text){
 return String(text||'').replace(SLURS,'').replace(SWEARS,w=>w[0]+'*'.repeat(Math.min(3,w.length-1))).replace(/\s+([,.!?])/g,'$1').replace(/\s{2,}/g,' ').replace(/^[\s,]+/,'').trim();
}
/** Drop swearing and slurs entirely for titles and hooks ("what the fuck are you doing" -> "what are you doing"). */
export function dropProfanity(text){
 return String(text||'').replace(SLURS,'').replace(/\b(?:the\s+)?(?:motherfuck\w*|fuck\w*|shit\w*|bitch\w*|bullshit|asshole\w*|dick(?:head)?s?|pussy|cunt\w*|goddamn|damn|hoes?)\b/gi,'').replace(/\s+([,.!?])/g,'$1').replace(/\s{2,}/g,' ').replace(/^[\s,]+/,'').trim();
}
export const hasProfanity=text=>{SWEARS.lastIndex=0;SLURS.lastIndex=0;const out=SWEARS.test(text)||SLURS.test(text);SWEARS.lastIndex=0;SLURS.lastIndex=0;return out;};

/** Loudness helper over the worker's 0.5 s RMS bins: ratio to the stream median, peak against its 90th percentile. */
export function loudness(transcript){
 const energy=transcript.energy||[],rms=energy.map(e=>e.rms),sorted=[...rms].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]||0,p90=sorted[Math.floor(sorted.length*.9)]||0;
 const sum=[0];rms.forEach((v,i)=>{sum[i+1]=sum[i]+v;});const bin=energy.length>1?energy[1].time-energy[0].time:.5;
 const span=(a,b)=>{const i=clamp(Math.floor(a/bin),0,Math.max(0,rms.length-1)),j=clamp(Math.ceil(b/bin),i+1,rms.length);return [i,j];};
 return {
  available:!!(rms.length&&median),
  at(a,b){if(!rms.length||!median)return {ratio:1,peak:1};const [i,j]=span(a,b);let max=0;for(let k=i;k<j;k++)max=Math.max(max,rms[k]);return {ratio:(sum[j]-sum[i])/(j-i)/median,peak:p90?max/p90:1};}
 };
}

/** Prefix sums of reaction cues per word, so any word range is scored in O(1). */
export function cueSums(words){
 const sums={laugh:[0],strong:[0],weak:[0],clip:[0],exclaim:[0]};
 words.forEach((w,i)=>{const t=w.text||'',pair=`${words[i-1]?.text||''} ${t}`;sums.laugh[i+1]=sums.laugh[i]+(laugh.test(t)?1:0);sums.strong[i+1]=sums.strong[i]+(strong.test(t)||strong.test(pair)?1:0);sums.weak[i+1]=sums.weak[i]+(weak.test(t)?1:0);sums.clip[i+1]=sums.clip[i]+(clipCue.test(pair)?1:0);sums.exclaim[i+1]=sums.exclaim[i]+(/[!?]$/.test(t)?1:0);});
 return {range:(k,a,b)=>sums[k][b]-sums[k][a]};
}

/** Category scores shared by the summary and the clip picker. */
export function categoryScores({cues,i,j,ratio,peak,opening,density}){
 return {
  funny:22*Math.min(3,cues.range('laugh',i,j+1))+5*Math.min(4,cues.range('weak',i,j+1))+8*clamp(ratio-1,0,2),
  highlight:14*Math.min(3,cues.range('strong',i,j+1))+18*clamp(peak-1,0,1.5)+10*clamp(ratio-1,0,2)+3*Math.min(4,cues.range('exclaim',i,j+1)),
  clippable:30*Math.min(1,cues.range('clip',i,j+1))+(hook.test(opening)?14:0)+(opening.includes('?')?8:0)+Math.min(12,density*4)
 };
}

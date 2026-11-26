// yt-dlp refusals in plain words, and keeping yt-dlp current.
// A user saw "YouTube did not return this video. It may be private…" followed by yt-dlp's whole stderr, when YouTube had
// actually refused their connection ("Sign in to confirm you're not a bot"): the video was fine. YouTube changes often
// and setup installs yt-dlp once, so on a refusal OpenClip updates yt-dlp (at most every few hours) and tries again.
// OpenClip only fetches public content and never uses browser cookies, so yt-dlp's cookie advice is dropped.
import {run} from './process.mjs';import {PYTHON} from './config.mjs';

const KINDS=[
 ['bot',/confirm you.{0,3}re not a bot|HTTP Error 429|Too Many Requests/i],
 ['age',/confirm your age|age.restricted|inappropriate for some users/i],
 ['members',/members.only|join this channel|subscriber.only|requires? (a )?subscription/i],
 ['private',/private video|this video is private/i],
 ['region',/available in your country|blocked it in your country|geo.?restrict/i],
 ['removed',/video unavailable|has been removed|account .* terminated|no longer available|does not exist|HTTP Error 404/i],
 ['upcoming',/premieres in|live event will begin|this live event will begin|is upcoming/i],
 ['outdated',/unable to extract|signature extraction failed|nsig extraction failed|requested format is not available|unsupported url|please report this issue|confirm you are on the latest version/i],
];
/** What kind of refusal this yt-dlp output describes, or '' when it is something else (network, disk…). */
export function refusalKind(text){const s=String(text||'');for(const [kind,re] of KINDS)if(re.test(s))return kind;return '';}

/** yt-dlp's own ERROR line, without its cookie and FAQ advice (OpenClip never uses cookies). */
export function errorDetail(text){
 const s=String(text||'');const line=s.split(/\r?\n/).reverse().find(l=>/\bERROR:/.test(l))||s.split(/\r?\n/).filter(Boolean).at(-1)||'';
 return line.replace(/^.*?ERROR:\s*/,'').replace(/\s*(Use --cookies|See\s+https?:|Also see\s+https?:|This helps protect our community)[\s\S]*$/i,'').replace(/\s+/g,' ').trim().slice(0,300);
}

/** The message to show when `platform` (YouTube, Twitch, Kick) refused or failed; `updated` = yt-dlp was just updated. */
export function explainRefusal(platform,text,{updated=false}={}){
 const kind=refusalKind(text),detail=errorDetail(text);
 const tail=`${updated?' OpenClip already updated its downloader (yt-dlp) and tried again.':''}${detail?` Details: ${detail}`:''}`;
 switch(kind){
  case 'bot':return `${platform} is blocking downloads from this internet connection right now ("confirm you're not a bot"). The video itself is fine. This happens on VPNs and proxies, on shared, school or office networks, and after many downloads in a row. Turn off any VPN or proxy, wait 30 to 60 minutes, then press Retry. Uploading a local file always works.${tail}`;
  case 'age':return `${platform} only shows this video to signed-in adults, and OpenClip only imports public videos. Download it yourself and upload the file instead.${tail}`;
  case 'members':return `This video is for channel members or subscribers only, and OpenClip only imports public videos.${tail}`;
  case 'private':return `This video is private, so OpenClip can't import it. Ask for a public link, or upload the file.${tail}`;
  case 'region':return `${platform} doesn't show this video in your country.${tail}`;
  case 'removed':return `${platform} says this video is unavailable: it may have been deleted or taken down. Check the link opens in your browser.${tail}`;
  case 'upcoming':return `This stream or premiere hasn't started yet. Try again once it's live.${tail}`;
  case 'outdated':return `${platform} changed something and the downloader (yt-dlp) couldn't read this video.${updated?' OpenClip updated it and tried again, but the fix may not be out yet: try again in a day or two.':' Run npm run setup to update it, then press Retry.'}${detail?` Details: ${detail}`:''}`;
  default:return `${platform} didn't return this video.${detail?` Details: ${detail}`:''}`;
 }
}

/** Refusals that a newer yt-dlp often fixes. */
export const updateMayHelp=text=>['bot','outdated'].includes(refusalKind(text));

const EVERY=6*3600*1000;let lastUpdate=-Infinity,pending=null;
/**
 * Update yt-dlp inside OpenClip's Python environment (uv when present, else pip), at most once every 6 hours and one
 * at a time. Resolves true when the update ran without error. Never throws: a failed update just means no retry.
 */
export function updateDownloader({runCommand=run,now=Date.now,log=()=>{}}={}){
 if(pending)return pending;
 if(now()-lastUpdate<EVERY)return Promise.resolve(false);
 lastUpdate=now();
 const spec='yt-dlp[default,curl-cffi]';
 pending=(async()=>{
  log('Updating the downloader (yt-dlp)…');
  try{await runCommand('uv',['pip','install','--upgrade','--python',PYTHON,spec],{timeout:5*60*1000});return true;}catch{/* no uv: use pip */}
  try{await runCommand(PYTHON,['-m','pip','install','--upgrade','--disable-pip-version-check',spec],{timeout:5*60*1000});return true;}catch(e){log(`Downloader update failed: ${String(e.message).slice(0,200)}`);return false;}
 })().finally(()=>{pending=null;});
 return pending;
}
/** Tests only. */
export function resetDownloaderUpdate(){lastUpdate=-Infinity;pending=null;}

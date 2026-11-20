// Public video links the app imports: single YouTube videos (live ones too), Twitch VODs, clips and live channels,
// Kick VODs and clips. Kick channels, playlists and collections are refused; each link is rebuilt in a canonical form,
// so nothing but the validated ID reaches yt-dlp.
import {parseYouTubeUrl} from './ingest.mjs';

export const PLATFORMS={youtube:'YouTube',twitch:'Twitch',kick:'Kick'};
const TWITCH_HOSTS=['twitch.tv','www.twitch.tv','m.twitch.tv','go.twitch.tv'];
const KICK_HOSTS=['kick.com','www.kick.com'];
const CLIP_SLUG=/^[A-Za-z0-9_-]{3,120}$/,LOGIN=/^[A-Za-z0-9_]{1,40}$/,KICK_SLUG=/^[A-Za-z0-9_-]{1,40}$/;
const KICK_VOD=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i,KICK_CLIP=/^clip_[A-Za-z0-9]{6,60}$/;
// Twitch site pages that look like a channel name.
const TWITCH_PAGES=new Set(['directory','search','settings','videos','downloads','jobs','turbo','subscriptions','inventory','wallet','drops','friends','following','messages','p','store','prime','login','signup','u','team','broadcast','moderator','dashboard']);
const SUPPORTED='Paste a public YouTube video, Twitch VOD or clip, or Kick VOD or clip link';

function parseTwitch(u){
 const host=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean);
 if(host==='clips.twitch.tv'){const slug=parts[0]==='embed'?u.searchParams.get('clip'):parts[0];if(parts.length>1&&parts[0]!=='embed'||!CLIP_SLUG.test(slug||''))throw new Error('Enter a single Twitch clip link');return {platform:'twitch',kind:'clip',id:slug,url:`https://clips.twitch.tv/${slug}`};}
 // twitch.tv/videos/123, twitch.tv/<login>/v/123 or /video/123
 let vod=parts[0]==='videos'&&parts.length===2?parts[1]:LOGIN.test(parts[0]||'')&&['v','video'].includes(parts[1])&&parts.length===3?parts[2]:null;
 if(vod){if(!/^\d{6,14}$/.test(vod))throw new Error('Enter a single Twitch VOD link (twitch.tv/videos/…)');return {platform:'twitch',kind:'video',id:vod,url:`https://www.twitch.tv/videos/${vod}`};}
 // twitch.tv/<login>/clip/<slug>
 if(parts.length===3&&LOGIN.test(parts[0])&&parts[1]==='clip'&&CLIP_SLUG.test(parts[2]))return {platform:'twitch',kind:'clip',id:parts[2],url:`https://clips.twitch.tv/${parts[2]}`};
 // A channel: while it is live, the stream so far is imported from its in-progress past broadcast.
 if(parts.length===1&&LOGIN.test(parts[0])&&!TWITCH_PAGES.has(parts[0].toLowerCase()))return {platform:'twitch',kind:'channel',id:parts[0].toLowerCase(),url:`https://www.twitch.tv/${parts[0].toLowerCase()}`};
 if(parts.length<=1)throw new Error('Paste a Twitch channel, past broadcast (twitch.tv/videos/…) or clip link');
 throw new Error('Enter a single Twitch VOD or clip link, not a list of videos');
}
function parseKick(u){
 const parts=u.pathname.split('/').filter(Boolean),clipParam=u.searchParams.get('clip');
 if(parts.length===1&&clipParam){if(!KICK_SLUG.test(parts[0])||!KICK_CLIP.test(clipParam))throw new Error('Enter a single Kick clip link');return {platform:'kick',kind:'clip',id:clipParam,url:`https://kick.com/${parts[0]}/clips/${clipParam}`};}
 if(parts.length===3&&KICK_SLUG.test(parts[0])&&parts[1]==='videos'){if(!KICK_VOD.test(parts[2]))throw new Error('Enter a single Kick VOD link (kick.com/<channel>/videos/…)');return {platform:'kick',kind:'video',id:parts[2].toLowerCase(),url:`https://kick.com/${parts[0]}/videos/${parts[2].toLowerCase()}`};}
 if(parts.length===3&&KICK_SLUG.test(parts[0])&&parts[1]==='clips'){if(!KICK_CLIP.test(parts[2]))throw new Error('Enter a single Kick clip link');return {platform:'kick',kind:'clip',id:parts[2],url:`https://kick.com/${parts[0]}/clips/${parts[2]}`};}
 if(parts.length===1)throw new Error('That is a Kick channel. While a stream is live, Kick only shares its last few seconds, so it cannot be clipped yet: paste the past broadcast (kick.com/<channel>/videos/…) once the stream ends, or a clip.');
 throw new Error('Enter a single Kick VOD or clip link, not a list of videos');
}
/** Validate a pasted link and return {platform, kind:'video'|'clip'|'channel', id, url} with a canonical URL. */
export function parseSourceUrl(value){
 let u;try{u=new URL(String(value||'').trim());}catch{throw new Error(SUPPORTED);}
 if(u.protocol!=='https:'&&u.protocol!=='http:'||u.username||u.password||u.port)throw new Error(SUPPORTED);
 const host=u.hostname.toLowerCase();
 if(TWITCH_HOSTS.includes(host)||host==='clips.twitch.tv')return parseTwitch(u);
 if(KICK_HOSTS.includes(host))return parseKick(u);
 if(u.protocol!=='https:')throw new Error(SUPPORTED);
 try{const yt=parseYouTubeUrl(u.href);return {platform:'youtube',kind:'video',...yt};}
 catch(e){if(/single YouTube video/.test(e.message))throw e;throw new Error(SUPPORTED);}
}
/** Job source record for a parsed link. YouTube keeps type 'youtube' so older projects and automations stay compatible. */
export function jobSource(parsed){return {type:parsed.platform,kind:parsed.kind,url:parsed.url,id:parsed.id};}
export const isRemote=source=>!!source&&Object.hasOwn(PLATFORMS,source.type);

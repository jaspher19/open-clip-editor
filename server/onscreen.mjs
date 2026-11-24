// Text burned into the video must never be the stream's title or a link. Projects showed both: the stream title came
// in through the clip editor (it pre-filled the on-screen context with the clip's stored context, which falls back to
// the stream title), and a pasted link sat in the project's Source context. Every on-screen hook and context line
// goes through `screenText`, so existing projects are fixed on their next render too.

const URL_RE=/\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|tv|gg|net|org|io|co|be|ly|me|app)(?:\/\S*)?/gi;
/** Text without links (and the punctuation they leave behind). */
export function stripLinks(text){return String(text||'').replace(URL_RE,' ').replace(/\s*[·|:,-]\s*$/,'').replace(/^\s*[·|:,-]\s*/,'').replace(/\s{2,}/g,' ').trim();}
const norm=t=>String(t||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Stream titles as they appear in projects: the full title, without emoji and date stamps, without the file extension. */
function titleForms(title){const t=String(title||'');return [t,t.replace(/\.(mp4|mov|mkv|webm|m4v)$/i,''),t.replace(/\s+\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/,'')].map(norm).filter(x=>x.length>=3);}
/** On-screen text with links removed, and empty when what is left is just the stream's title. */
export function screenText(text,job={}){const t=stripLinks(text);if(!t)return '';const n=norm(t);return titleForms(job.title).includes(n)?'':t;}

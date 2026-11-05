// Download public reference Shorts and extract inspection evidence for building edit templates.
// Usage: node scripts/analyze-reference.mjs <videoId> [<videoId> ...]
// Writes .cache/references/<id>/: source.mp4, analysis/{meta.json,cuts.json,sheet-*.jpg,open-*.jpg,frames/*.jpg}
import fs from 'node:fs';import path from 'node:path';import {CACHE} from '../server/config.mjs';import {importYouTube} from '../server/ingest.mjs';import {run} from '../server/process.mjs';

async function analyze(id){
 const folder=path.join(CACHE,'references',id),out=path.join(folder,'analysis'),frames=path.join(out,'frames');fs.mkdirSync(frames,{recursive:true});
 let source=path.join(folder,'source.mp4');
 if(!fs.existsSync(source))source=(await importYouTube(`https://www.youtube.com/watch?v=${id}`,folder)).path;
 const probe=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',source])).stdout),v=probe.streams.find(s=>s.codec_type==='video'),duration=Number(probe.format.duration);
 const [n,d]=String(v.avg_frame_rate).split('/').map(Number);
 let info={};const meta=fs.readdirSync(folder).find(f=>f.endsWith('.info.json'));if(meta)try{info=JSON.parse(fs.readFileSync(path.join(folder,meta),'utf8'));}catch{}
 // Hard cuts: scene-change score above 0.3 (zoom punches and flashes also register; read them against the frames).
 const scene=await run('ffmpeg',['-hide_banner','-i',source,'-vf',"select='gt(scene,0.3)',showinfo",'-an','-f','null','-']).catch(e=>({stderr:String(e.message)}));
 const cuts=[...String(scene.stderr||scene.stdout||'').matchAll(/pts_time:([\d.]+)/g)].map(m=>+(+m[1]).toFixed(2));
 // One frame per second (tiled 5×2 = 10 s per sheet) and the opening at 4 fps.
 await run('ffmpeg',['-v','error','-y','-i',source,'-vf','fps=1,scale=360:-2',path.join(frames,'%03d.jpg')]);
 await run('ffmpeg',['-v','error','-y','-i',source,'-vf',"fps=1,scale=270:-2,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=5x2",path.join(out,'sheet-%02d.jpg')]);
 await run('ffmpeg',['-v','error','-y','-t','3','-i',source,'-vf','fps=4,scale=540:-2',path.join(out,'open-%02d.jpg')]);
 const loud=await run('ffmpeg',['-hide_banner','-i',source,'-af','ebur128','-f','null','-']).catch(e=>({stderr:String(e.message)}));
 const lufs=(String(loud.stderr||'').match(/I:\s+(-?[\d.]+) LUFS/g)||[]).at(-1);
 const result={id,url:`https://www.youtube.com/shorts/${id}`,title:info.title,description:info.description,tags:info.tags||[],channel:info.channel,views:info.view_count,likes:info.like_count,comments:info.comment_count,uploadDate:info.upload_date,duration,width:v.width,height:v.height,fps:d?n/d:n,cuts,cutsPerMinute:+(cuts.length/duration*60).toFixed(1),loudness:lufs||'',frames:fs.readdirSync(frames).length};
 fs.writeFileSync(path.join(out,'meta.json'),JSON.stringify(result,null,1));
 console.log(`${id}: ${v.width}x${v.height} ${duration.toFixed(1)}s, ${cuts.length} cuts, "${(info.title||'').slice(0,60)}"`);
}
for(const id of process.argv.slice(2)){if(!/^[A-Za-z0-9_-]{11}$/.test(id)){console.error('Skipping invalid id',id);continue;}try{await analyze(id);}catch(e){console.error(`${id}: ${e.message}`);}}

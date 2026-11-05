import {listSounds,soundFile} from './effects.mjs';
export {listSounds};
/** GET /api/sounds lists the bundled sounds; GET /api/sounds/:group/:name streams one WAV for previews in the editor. */
export function registerSoundRoutes(app){
 app.get('/api/sounds',(req,res)=>res.json(listSounds()));
 app.get('/api/sounds/:group/:name',(req,res)=>{const id=`${req.params.group}/${String(req.params.name).replace(/\.wav$/i,'')}`,file=listSounds().some(s=>s.id===id)&&soundFile(id);if(!file)return res.status(404).json({error:'Sound not found'});res.type('audio/wav').set('Cache-Control','public, max-age=86400').sendFile(file);});
}

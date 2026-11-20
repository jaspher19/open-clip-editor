import 'dotenv/config';import {JobStore} from './jobs.mjs';import {JobQueue} from './queue.mjs';import {createApp} from './app.mjs';import {followLiveChat,chatRecorders} from './twitch-chat.mjs';
const store=new JobStore();store.recover();const queue=new JobQueue(store),app=createApp({store,queue});const port=Number(process.env.PORT)||5173;
app.locals.automation.recover();
// Live Twitch imports keep recording their chat across restarts (until 24 h after the stream started).
for(const job of store.list())try{followLiveChat(job,{log:console.warn});}catch{}
const server=app.listen(port,'127.0.0.1',()=>console.log(`Open Clip Editor: http://localhost:${port}`));
function stop(){for(const r of chatRecorders())r.stop();app.locals.posting.stop();app.locals.references.shutdown();app.locals.automation.shutdown();if(queue.active)queue.active.controller.abort();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

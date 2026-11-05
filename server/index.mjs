import 'dotenv/config';import {JobStore} from './jobs.mjs';import {JobQueue} from './queue.mjs';import {createApp} from './app.mjs';
const store=new JobStore();store.recover();const queue=new JobQueue(store),app=createApp({store,queue});const port=Number(process.env.PORT)||5173;
app.locals.automation.recover();
const server=app.listen(port,'127.0.0.1',()=>console.log(`Open Clip Editor: http://localhost:${port}`));
function stop(){app.locals.posting.stop();app.locals.references.shutdown();app.locals.automation.shutdown();if(queue.active)queue.active.controller.abort();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

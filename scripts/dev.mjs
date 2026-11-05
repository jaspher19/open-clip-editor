import {spawn} from 'node:child_process';import path from 'node:path';import {ROOT,localEnv} from '../server/config.mjs';
const api=spawn(process.execPath,['server/index.mjs'],{cwd:ROOT,env:localEnv({PORT:'5174'}),stdio:'inherit',windowsHide:true});const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','web/vite.config.ts'],{cwd:ROOT,env:localEnv(),stdio:'inherit',windowsHide:true});
const stop=()=>{api.kill();ui.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);api.on('exit',stop);ui.on('exit',stop);

import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import path from 'node:path';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:dir,plugins:[react()],cacheDir:path.join(dir,'../.cache/vite'),server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:5174'}},build:{outDir:'dist',emptyOutDir:true}});

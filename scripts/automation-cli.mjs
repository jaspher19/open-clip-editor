import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2),base=`http://localhost:${process.env.PORT||5173}`;
async function api(url,body){const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
try{if(!args.length)throw new Error('Usage: npm run automate -- recipe.json [--watch] | --resume ID | --stop ID');let script;
 if(args[0]==='--stop'){const result=await api(`/api/automations/${args[1]}/stop`,{});console.log(result.id,result.status);process.exit(0);}
 if(args[0]==='--resume')script={id:args[1]};else{const recipe=JSON.parse(fs.readFileSync(path.resolve(args[0]),'utf8'));script=await api('/api/automations',recipe);}
 script=await api(`/api/automations/${script.id}/start`,{});console.log(`Workflow ${script.id} started. App: ${base}`);if(args.includes('--watch')){let last='';while(true){const current=(await api('/api/automations')).find(a=>a.id===script.id);const line=`${current.status}: ${current.message}`;if(line!==last){console.log(line);last=line;}if(!current.enabled){if(current.status==='failed')process.exitCode=1;break;}await new Promise(resolve=>setTimeout(resolve,2000));}}
}catch(error){console.error(error.message+(error.cause?' · Start the app with npm start first.':''));process.exitCode=1;}

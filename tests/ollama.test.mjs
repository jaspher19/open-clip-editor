import test from 'node:test';import assert from 'node:assert/strict';import {z} from 'zod';
import {askAI,metadataProviders,ollamaBase} from '../server/metadata-ai.mjs';

const reply=json=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({model:'llama3.1',choices:[{message:{content:JSON.stringify(json)}}]})});
test('ollama: set up with a model (this computer), a host, or a cloud key; picked after the free keys',()=>{
 assert.deepEqual(metadataProviders({OLLAMA_MODEL:'llama3.1'}),['ollama']);assert.deepEqual(metadataProviders({OLLAMA_HOST:'localhost:11434'}),['ollama']);
 assert.deepEqual(metadataProviders({GROQ_API_KEY:'g',OLLAMA_API_KEY:'o'}),['groq','ollama']);assert.deepEqual(metadataProviders({METADATA_AI:'ollama',GEMINI_API_KEY:'x',OLLAMA_MODEL:'m'}),['ollama']);
 assert.deepEqual(metadataProviders({METADATA_AI:'ollama'}),[]);
 assert.equal(ollamaBase({}),'http://localhost:11434');assert.equal(ollamaBase({OLLAMA_API_KEY:'k'}),'https://ollama.com');
 assert.equal(ollamaBase({OLLAMA_HOST:'0.0.0.0:11434'}),'http://localhost:11434');assert.equal(ollamaBase({OLLAMA_HOST:'https://box.example/v1/'}),'https://box.example');
});
test('ollama: this computer gets no key header; the cloud gets the bearer key; JSON replies are parsed',async()=>{
 const calls=[],fetchImpl=async(url,init)=>{calls.push({url,headers:init.headers,body:JSON.parse(init.body)});return reply({title:'Hi'});};const schema=z.object({title:z.string()});
 const local=await askAI({schema,system:'s',user:'u'},{env:{OLLAMA_MODEL:'llama3.1'},fetchImpl});
 assert.equal(local.provider,'ollama');assert.deepEqual(local.data,{title:'Hi'});assert.equal(calls[0].url,'http://localhost:11434/v1/chat/completions');
 assert.equal(calls[0].headers.Authorization,undefined);assert.equal(calls[0].body.model,'llama3.1');assert.deepEqual(calls[0].body.response_format,{type:'json_object'});
 await askAI({schema,system:'s',user:'u'},{env:{OLLAMA_API_KEY:'sk-1'},fetchImpl});
 assert.equal(calls[1].url,'https://ollama.com/v1/chat/completions');assert.equal(calls[1].headers.Authorization,'Bearer sk-1');assert.equal(calls[1].body.model,'gpt-oss:120b');
});
test('ollama: a stopped Ollama app says so',async()=>{
 await assert.rejects(askAI({schema:z.object({}),system:'s',user:'u'},{env:{OLLAMA_MODEL:'m'},fetchImpl:async()=>{throw new Error('ECONNREFUSED');},retryDelays:[]}),/Is the Ollama app running\?/);
});

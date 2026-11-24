import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {YouTubeClient} from '../server/youtube.mjs';import {CACHE} from '../server/config.mjs';
import {clientFromJson,googleFix,googleApiError} from '../server/youtube-errors.mjs';

const desktop={installed:{client_id:'1-abc.apps.googleusercontent.com',client_secret:'GOCSPX-x'}};

test('client JSON: each usual wrong file gets its own fix',()=>{
 assert.deepEqual(clientFromJson(desktop),{client_id:'1-abc.apps.googleusercontent.com',client_secret:'GOCSPX-x'});
 assert.throws(()=>clientFromJson({web:desktop.installed}),/Web application.*Desktop app/);
 assert.throws(()=>clientFromJson({type:'service_account',private_key:'k'}),/service account/);
 assert.throws(()=>clientFromJson({installed:{client_id:'1-abc.apps.googleusercontent.com'}}),/Add secret/);
 assert.throws(()=>clientFromJson({installed:{client_id:'nope',client_secret:'s'}}),/client ID/);
 assert.throws(()=>clientFromJson(null),/Download JSON/);
});

test('Google errors are explained in plain words',async()=>{
 assert.match(googleFix('access_denied'),/Test users/);assert.match(googleFix('client_user_mismatch'),/different Google account/);
 assert.equal(googleFix('something_new'),null);
 const off=new Response(JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',errors:[{reason:'accessNotConfigured'}]}}),{status:403});
 assert.match((await googleApiError(off,'x')).message,/Enable/);
 const odd=new Response(JSON.stringify({error:{code:500,errors:[{reason:'backendError'}]}}),{status:500});
 assert.match((await googleApiError(odd,'YouTube refused the upload')).message,/YouTube refused the upload \(backendError\).*YOUTUBE-SETUP/);
});

test('connecting: a refused sign-in, a missing upload permission and a missing channel each say what to do',async()=>{
 const root=fs.mkdtempSync(path.join(CACHE,'yt-setup-'));
 try{
  let scope='https://www.googleapis.com/auth/youtube.readonly',items=[];
  const fetchImpl=async url=>String(url).includes('oauth2.googleapis.com/token')?Response.json({access_token:'A',refresh_token:'R',expires_in:3600,scope}):Response.json({items});
  const client=new YouTubeClient({folder:root,fetchImpl});client.configure(desktop);
  const state=()=>new URL(client.authorizeUrl('http://localhost:5173/api/youtube/callback')).searchParams.get('state');
  await assert.rejects(client.callback({state:state(),error:'access_denied'}),/Test users/);
  await assert.rejects(client.callback({state:state(),code:'c'}),/tick every box/);
  scope+=' https://www.googleapis.com/auth/youtube.upload';
  await assert.rejects(client.callback({state:state(),code:'c'}),/no YouTube channel/);
  items=[{id:'UC1',snippet:{title:'My channel'}}];
  assert.equal((await client.callback({state:state(),code:'c'})).channelTitle,'My channel');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('the page Google returns to explains a failed sign-in instead of showing raw JSON',async t=>{
 const {createApp}=await import('../server/app.mjs');const {JobStore}=await import('../server/jobs.mjs');const {randomUUID}=await import('node:crypto');
 const store=new JobStore(path.join(CACHE,'api-yt-'+randomUUID()));const queue={isBusy:()=>false,enqueue(){},cancel(){}};
 const app=createApp({store,queue,youtube:new YouTubeClient({folder:path.join(store.root,'youtube-auth')})});
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/youtube/callback?state=old&error=access_denied`);
 assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/html/);const html=await r.text();
 assert.match(html,/isn’t connected yet/);assert.match(html,/Connect again|Connect YouTube/);assert.match(html,/YOUTUBE-SETUP\.md/);assert.doesNotMatch(html,/<script/);
});

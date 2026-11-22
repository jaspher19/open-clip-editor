// "Check for updates": compares this copy with GitHub using git (read-only: fetch, never pull), and lists what's new.
import fs from 'node:fs';import path from 'node:path';
import {run} from './process.mjs';import {ROOT} from './config.mjs';

export const REPO_URL='https://github.com/jaspher19/open-clip-editor';
const git=(args,opts={})=>run('git',args,{cwd:ROOT,timeout:45000,...opts}).then(r=>String(r.stdout).trim());

/** {status:'current'|'behind'|'ahead'|'diverged'|'unknown', current, latest, behind, ahead, commits, dependencies, dirty, message} */
export async function checkUpdates({runGit=git}={}){
 if(!fs.existsSync(path.join(ROOT,'.git')))return {status:'unknown',message:'This copy was not downloaded with git, so it can’t check by itself. Download the newest version from GitHub.',repo:REPO_URL};
 try{
  const upstream=await runGit(['rev-parse','--abbrev-ref','--symbolic-full-name','@{u}']).catch(()=>'origin/master');
  await runGit(['fetch','--quiet',upstream.split('/')[0]||'origin']);
  const [current,latest]=await Promise.all([runGit(['rev-parse','--short','HEAD']),runGit(['rev-parse','--short',upstream])]);
  const [behind,ahead]=(await runGit(['rev-list','--left-right','--count',`${upstream}...HEAD`])).split(/\s+/).map(Number);
  const log=behind?await runGit(['log','--format=%h%x09%s%x09%cr','-n','15',`HEAD..${upstream}`]):'';
  const commits=log?log.split('\n').map(l=>{const [hash,subject,when]=l.split('\t');return {hash,subject,when};}):[];
  // New packages mean `npm ci` too; local edits mean `git pull` may refuse.
  const changed=behind?(await runGit(['diff','--name-only',`HEAD...${upstream}`])).split('\n'):[];
  const dependencies=changed.some(f=>/^(package(-lock)?\.json|workers\/requirements\.txt)$/.test(f));
  const dirty=!!(await runGit(['status','--porcelain','--untracked-files=no']));
  const status=behind&&ahead?'diverged':behind?'behind':ahead?'ahead':'current';
  return {status,current,latest,behind,ahead,commits,dependencies,python:changed.includes('workers/requirements.txt'),dirty,repo:REPO_URL};
 }catch(e){return {status:'unknown',message:`Couldn’t reach GitHub to check (${String(e.message).split('\n')[0].slice(0,160)}). Check your internet connection and try again.`,repo:REPO_URL};}
}

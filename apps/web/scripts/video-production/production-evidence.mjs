/** Production-owned source captures. Discovery observations remain immutable. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureSavedSources,buildDeterministicDossier} from './research-job-evidence.mjs';
import {searchStudioSources} from './studio-search.mjs';

const ROOT=fileURLToPath(new URL('../../../../data/production-evidence',import.meta.url));
const ID=/^production-[a-f0-9]{24}$/u;
const sha=value=>createHash('sha256').update(value).digest('hex');
function identity(id){if(!ID.test(id??''))throw Error('Invalid production identity.');return id;}
async function localJson(path,{signal}={}){
  const base=new URL(process.env.CONTENTGEN_LOCAL_API_URL??process.env.CONTENTGEN_RESEARCH_ORIGIN??process.env.CONTENTGEN_JOBS_ORIGIN??'http://127.0.0.1:8787');
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||
    base.username||base.password||base.pathname!=='/'||base.search||base.hash)
    throw Error('Production API must be an HTTP loopback server.');
  const response=await fetch(base.origin+path,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error(`Cannot load saved production evidence context (HTTP ${response.status}).`);
  return response.json();
}
async function readJson(file){
  if((await stat(file)).size>512*1024)throw Error('Production evidence exceeds its storage limit.');
  return JSON.parse(await readFile(file,'utf8'));
}
async function atomic(file,document){
  const bytes=JSON.stringify(document);
  if(Buffer.byteLength(bytes)>512*1024)throw Error('Production evidence exceeds its storage limit.');
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,file);}
  finally{await rm(temporary,{force:true});}
}
export function createProductionEvidenceStore({root=ROOT,
  loadProduction=(id,options)=>localJson('/api/productions/'+encodeURIComponent(id),options),
  loadIdeas=async (production,options)=>(await localJson('/api/research/discovery/projects/'+encodeURIComponent(production.projectId)+
    '/sessions/'+encodeURIComponent(production.sessionId)+'/ideas',options)).ideas,
  fetchPage,search=searchStudioSources}={}){
  const active=new Set();
  async function canonical(id,signal){
    identity(id);
    const production=await loadProduction(id,{signal});
    signal?.throwIfAborted();
    if(production?.id!==id||!production.projectId||!production.sessionId||!production.ideaId||!production.brief?.title)
      throw Error('Saved production has invalid ownership or brief.');
    return production;
  }
  function match(document,production){
    if(document?.version!==1||document.productionId!==production.id||document.projectId!==production.projectId||
      document.ideaId!==production.ideaId||!Array.isArray(document.captures)||!Array.isArray(document.evidence)||
      !Array.isArray(document.sources)||!document.evidence.length||
      document.evidence.some(item=>!document.captures.some(capture=>capture.id===item.sourceId&&
        capture.url===item.sourceUrl&&capture.text.includes(item.quote))))
      throw Error('Saved evidence does not match this production and its captured sources.');
    return document;
  }
  async function get(id){
    const production=await canonical(id);
    let pointer;
    try{pointer=await readJson(join(root,id+'.json'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!/^[a-f0-9]{64}$/u.test(pointer?.snapshot??''))throw Error('Invalid production evidence snapshot.');
    const document=await readJson(join(root,id+'-'+pointer.snapshot+'.json'));
    if(sha(JSON.stringify(document))!==pointer.snapshot)throw Error('Production evidence digest mismatch.');
    const saved=match(document,production);
    const {captures,...publicDocument}=saved;
    void captures;
    return publicDocument;
  }
  async function capture(id,{allowNetwork,locale,signal}={}){
    identity(id);
    if(allowNetwork!==true)throw Error('Approve public network source collection before drafting.');
    if(!['en','ja'].includes(locale))throw Error('Choose an English or Japanese script locale.');
    if(active.has(id))throw Error('Evidence collection is already running for this production.');
    active.add(id);
    try{
      signal?.throwIfAborted();
      const production=await canonical(id,signal);
      const idea=(await loadIdeas(production,{signal}))?.find(item=>item.id===production.ideaId);
      signal?.throwIfAborted();
      if(!idea)throw Error('The selected production idea could not be loaded. Reopen its saved discovery session.');
      const brief={title:production.brief.title,viewerQuestion:production.brief.topic||production.brief.title,
        audience:'Learners researching '+production.brief.title,locale:locale==='ja'?'ja-JP':'en-US'};
      brief.audience=brief.audience.slice(0,160);
      // Video metadata establishes demand, not the facts narrated in a script.
      const leads=(idea.sources??[]).filter(source=>!/(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/iu.test((()=>{
        try{return new URL(source.url).hostname;}catch{return 'youtube.com';}
      })())).slice(0,10);
      let extracted;
      try{
        const captured=await captureSavedSources({results:leads},brief,{fetchPage,signal,maxSources:4});
        extracted=buildDeterministicDossier(brief,captured.captures,captured.gaps);
      }catch(error){
        signal?.throwIfAborted();
        const snapshot=await search(brief,{signal});
        const captured=await captureSavedSources(snapshot,brief,{fetchPage,signal,maxSources:4});
        extracted=buildDeterministicDossier(brief,captured.captures,captured.gaps);
      }
      signal?.throwIfAborted();
      const {dossier,quotes,captures,warnings}=extracted;
      const sources=captures.map(source=>({id:source.id,title:source.title,url:source.url,
        provider:'captured-web',evidenceState:'captured',observedAt:Math.floor(Date.parse(source.retrievedAt)/1000)}));
      const evidence=quotes.map(quote=>({claimId:quote.claimId,
        claimText:dossier.claims.find(claim=>claim.id===quote.claimId).text,sourceId:quote.sourceId,
        sourceUrl:captures.find(source=>source.id===quote.sourceId).url,quote:quote.quote,reviewStatus:'unverified'}));
      const document={version:1,productionId:id,projectId:production.projectId,ideaId:production.ideaId,
        evidence,sources,warnings,captures};
      match(document,production);
      const snapshot=sha(JSON.stringify(document));
      await mkdir(root,{recursive:true,mode:0o700});
      await atomic(join(root,id+'-'+snapshot+'.json'),document);
      signal?.throwIfAborted();
      await atomic(join(root,id+'.json'),{snapshot});
      const {captures:ownedCaptures,...result}=document;void ownedCaptures;
      return result;
    }finally{active.delete(id);}
  }
  return {get,capture};
}
export const productionEvidenceStore=createProductionEvidenceStore();

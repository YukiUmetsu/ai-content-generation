import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionEvidenceStore} from './production-evidence.mjs';

const productionId='production-'+ 'a'.repeat(24);
const production={id:productionId,projectId:'brand-one',ideaId:'idea-one',sessionId:'session-one',
  brief:{title:'Why insurance premiums change',topic:'Why do insurance premiums change?'},platforms:['youtube']};
const idea={id:'idea-one',sources:[{id:'lead-one',url:'https://example.org/insurance',title:'Insurance premium guide'}]};
const sourceText='Insurance premiums can change when rebuilding costs and local risks increase. Coverage terms can also change insurance premiums for homeowners. '.repeat(3);
async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'contentgen-evidence-'));
  try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const deps={loadProduction:async()=>production,loadIdeas:async()=>[idea],
  fetchPage:async()=>({html:sourceText,type:'text/plain'}),
  search:async()=>{throw Error('Existing leads should be enough');}};

test('captures actual selected-production passages, persists and restores without another network request',()=>fixture(async root=>{
  const store=createProductionEvidenceStore({root,...deps});
  assert.equal(await store.get(productionId),null);
  const saved=await store.capture(productionId,{allowNetwork:true,locale:'en'});
  assert.ok(saved.evidence.length);
  assert.ok(saved.evidence.every(item=>item.reviewStatus==='unverified'&&sourceText.includes(item.quote)));
  assert.ok(saved.sources.every(source=>Number.isSafeInteger(source.observedAt)));
  assert.deepEqual(await createProductionEvidenceStore({root,...deps,fetchPage:()=>{throw Error('No refetch');}}).get(productionId),saved);
}));

test('requires consent, rejects missing/wrong ownership and preserves prior evidence on a failed recapture',()=>fixture(async root=>{
  const store=createProductionEvidenceStore({root,...deps});
  await assert.rejects(()=>store.capture(productionId,{allowNetwork:false,locale:'en'}),/approve|network/i);
  await assert.rejects(()=>store.capture('../secret',{allowNetwork:true,locale:'en'}),/identity|production/i);
  const saved=await store.capture(productionId,{allowNetwork:true,locale:'en'});
  const failed=createProductionEvidenceStore({root,...deps,fetchPage:async()=>{throw Error('Offline');},search:async()=>{throw Error('Offline');}});
  await assert.rejects(()=>failed.capture(productionId,{allowNetwork:true,locale:'en'}),/Offline|capture|source/i);
  assert.deepEqual(await store.get(productionId),saved);
  const wrong=createProductionEvidenceStore({root,...deps,loadProduction:async()=>({...production,ideaId:'another-idea'})});
  await assert.rejects(()=>wrong.get(productionId),/match|production|idea/i);
}));

test('falls back to source search for video-only ideas without inventing evidence from titles or snippets',()=>fixture(async root=>{
  let searched=0;
  const store=createProductionEvidenceStore({root,...deps,loadIdeas:async()=>[{...idea,sources:[]}],search:async brief=>{
    searched++;assert.equal(brief.title,production.brief.title);
    return {results:idea.sources};
  }});
  const saved=await store.capture(productionId,{allowNetwork:true,locale:'en'});
  assert.equal(searched,1);
  assert.ok(saved.evidence.every(item=>sourceText.includes(item.quote)));
}));

test('cancellation never persists incomplete evidence',()=>fixture(async root=>{
  const controller=new AbortController();controller.abort(Error('Cancelled'));
  const store=createProductionEvidenceStore({root,...deps});
  await assert.rejects(()=>store.capture(productionId,{allowNetwork:true,locale:'en',signal:controller.signal}),/cancel/i);
  assert.deepEqual(await readdir(root),[]);
}));

test('cancelling during canonical production lookup releases the collection so it can be retried',()=>fixture(async root=>{
  let started;
  const ready=new Promise(resolve=>{started=resolve;});
  const controller=new AbortController();
  const store=createProductionEvidenceStore({root,...deps,loadProduction:async(_id,options)=>{
    started();
    assert.ok(options?.signal,'Ownership lookup must receive collection cancellation');
    await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  const pending=store.capture(productionId,{allowNetwork:true,locale:'en',signal:controller.signal});
  await ready;controller.abort(Error('Cancelled ownership lookup'));
  await assert.rejects(()=>pending,/cancel/i);
  // A new request must reach ownership lookup, rather than be rejected by active collection state.
  const next=new AbortController();
  const retry=store.capture(productionId,{allowNetwork:true,locale:'en',signal:next.signal});
  await new Promise(resolve=>setImmediate(resolve));next.abort(Error('Cancelled retry'));
  await assert.rejects(()=>retry,/cancel/i);
}));

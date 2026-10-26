/** Offline vertical acceptance: actual source capture/extraction → HTTP script API → Director → renderer job. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionEvidenceStore} from './production-evidence.mjs';
import {handleDirectorRequest} from '../director-studio-vite.mjs';
import {compileApprovedScriptDirector} from './approved-script-director.mjs';
import {compilePreproductionRenderJob} from './preproduction-render-bridge.mjs';

test('a video-only discovery idea can collect evidence and produce five sourced renderable script sections',async t=>{
  const root=await mkdtemp(join(tmpdir(),'production-flow-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const production={id:'production-'+ 'a'.repeat(24),projectId:'brand-one',sessionId:'session-one',ideaId:'idea-one',
    brief:{title:'Why insurance premiums change',topic:'Why insurance premiums change'}};
  const store=createProductionEvidenceStore({root,loadProduction:async()=>production,
    loadIdeas:async()=>[{id:production.ideaId,sources:[]}],search:async()=>({results:[{title:'Insurance guide',url:'https://example.org/insurance'}]}),
    fetchPage:async()=>({type:'text/plain',html:'Insurance premiums change when rebuilding costs and insured risks change. Insurance premiums also reflect the coverage and policy terms selected by the homeowner. '.repeat(2)})});
  const snapshot=await store.capture(production.id,{allowNetwork:true,locale:'en'});
  const model=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const envelope=JSON.parse(raw),input=JSON.parse(envelope.messages[1].content);
    assert.equal(input.platform,'youtube');
    const narration=`${input.heading}: Insurance premiums change when rebuilding costs and insured risks change. The homeowner can compare coverage and policy terms to understand what changed.`;
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({narration,
      claimRefs:[snapshot.evidence[0].claimId],sourceRefs:[snapshot.evidence[0].sourceId]})}}]}));
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{model.closeAllConnections();model.close(resolve);}));
  const modelSettings={model:'fixture-model',endpoint:`http://127.0.0.1:${model.address().port}/v1/chat/completions`};
  const sections=[];
  for(const sectionId of ['hook','context','mechanism','practical','closing']){
    const request={sectionId,heading:'Insurance '+sectionId,purpose:'Explain insurance premium changes with captured sources.',mode:'initial',
      title:production.brief.title,viewerQuestion:production.brief.topic,audience:'Homeowners',angle:'Risks and coverage',brandVoice:'Clear',
      locale:'en',platform:'youtube',requestedDurationSeconds:106,previousSection:sections.at(-1)?.text??'',nextSection:'',
      currentText:'',extraInstructions:'',evidence:snapshot.evidence};
    const req=Readable.from([Buffer.from(JSON.stringify(request))]);
    Object.assign(req,{method:'POST',url:'/script-generate',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','x-contentgen-director':'local-only'}});
    let status,result;
    await handleDirectorRequest(req,{writeHead(code){status=code;},end(raw){result=JSON.parse(raw);}},{model:async()=>modelSettings});
    assert.equal(status,200,JSON.stringify(result));
    assert.equal(result.status,'generated-draft');
    sections.push({id:sectionId,heading:request.heading,purpose:request.purpose,text:result.narration,claimRefs:result.claimRefs,sourceRefs:result.sourceRefs});
  }
  const script={status:'approved',approvedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    input:{productionId:production.id,projectId:production.projectId,platform:'youtube',locale:'en',title:production.brief.title,
      viewerQuestion:production.brief.topic,audience:'Homeowners'},sections};
  const {dossier,bundle}=compileApprovedScriptDirector({productionId:production.id,script,evidence:snapshot.evidence,sources:snapshot.sources});
  const {job}=compilePreproductionRenderJob(dossier,bundle);
  assert.equal(job.beats.length,5);
  assert.deepEqual(job.beats.map(beat=>beat.narration),sections.map(section=>section.text));
  assert.equal(dossier.review.status,'draft');
});

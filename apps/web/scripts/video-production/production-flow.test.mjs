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
  const narrative={
    hook:"Your home may look unchanged when an insurance renewal arrives. Which part of the insured risk or coverage could explain the difference?",
    context:"A useful comparison begins with the same policy terms. Otherwise a change in coverage can be mistaken for a change in the risks around the property.",
    mechanism:"Rebuilding expenses and insured risks contribute to insurance pricing. Changes in those inputs can affect a renewal even when the house itself looks unchanged.",
    practical:"Apply that distinction when comparing the renewal: examine the coverage terms alongside information about rebuilding expenses and local risks, and ask which inputs changed.",
    closing:"The answer is that the house alone does not determine the renewal. Separate the contract from the risk being insured, then investigate the cause instead of treating every increase as the same problem.",
  };
  const requestedSections=[];
  const model=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const envelope=JSON.parse(raw),input=JSON.parse(envelope.messages[1].content);
    assert.equal(input.platform,'youtube');
    requestedSections.push(input.sectionId);
    const narration=narrative[input.sectionId];
    if(input.sectionId==="closing")assert.ok(input.scriptSections.find(section=>section.sectionId==="hook").text.includes("Your home"));
    res.writeHead(200,{'Content-Type':'application/json'});
    // Exercise a plausible rejected response, corrective retry, and metadata
    // emitted by a local model through the actual HTTP adapter.
    const answer={narration,claimRefs:[snapshot.evidence[0].claimId],sourceRefs:[snapshot.evidence[0].sourceId],
      sectionId:input.sectionId,heading:input.heading};
    if(requestedSections.length===1)answer.narration=[narration];
    else if(requestedSections.length===2)assert.match(envelope.messages[0].content,/FORMAT REPAIR/);
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{model.closeAllConnections();model.close(resolve);}));
  const modelSettings={model:'fixture-model',endpoint:`http://127.0.0.1:${model.address().port}/v1/chat/completions`};
  const sections=[];
  for(const sectionId of ['hook','context','mechanism','practical','closing']){
    const request={sectionId,heading:'Insurance '+sectionId,purpose:'Explain insurance premium changes with captured sources.',mode:'initial',
      title:production.brief.title,viewerQuestion:production.brief.topic,audience:'Homeowners',angle:'Risks and coverage',brandVoice:'Clear',
      locale:'en',platform:'youtube',requestedDurationSeconds:106,previousSection:sections.at(-1)?.text??'',nextSection:'',
      currentText:'',extraInstructions:'',evidence:snapshot.evidence,
      scriptSections:['hook','context','mechanism','practical','closing'].map(id=>({sectionId:id,heading:'Insurance '+id,
        purpose:'Explain a distinct part of the insurance decision.',text:sections.find(section=>section.id===id)?.text??''}))};
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
  assert.deepEqual(requestedSections,['hook','hook','context','mechanism','practical','closing']);
  assert.deepEqual(job.beats.map(beat=>beat.narration),sections.map(section=>section.text));
  assert.equal(dossier.review.status,'draft');
});

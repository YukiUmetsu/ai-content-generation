import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createStudioResearchDraft, loadStudioResearchDraft } from "./studio-research.mjs";

const capturedText="Insulation resists the flow of heat in a building envelope. Insulation resists heat flow so heating loads can change with installation and weather. ";
const dossier={schemaVersion:1,kind:"research-dossier",id:"research_proof",topic:{title:"Insulation",viewerQuestion:"Why use it?",audience:"Homeowners",locale:"en-US"},
  evidence:[{id:"source_01",title:"Energy department",sourceUri:"https://www.energy.gov/",retrievedAt:"2026-10-23T00:00:00.000Z",passageLocator:"captured-text:[0,35)",snapshotSha256:createHash("sha256").update(capturedText).digest("hex")}],
  claims:[{id:"claim_01",text:"Insulation resists heat flow.",status:"unverified",sourceRefs:["source_01"]}],assets:[],gaps:["Costs depend on region."],review:{status:"draft"}};
const research={dossier,captures:[{id:"source_01",url:"https://www.energy.gov/",title:"Energy department",text:capturedText,retrievedAt:"2026-10-23T00:00:00.000Z"}],
  quotePreviews:[{claimId:"claim_01",sourceId:"source_01",quote:"Insulation resists the flow of heat"}],
  claimSupport:[{claimId:"claim_01",sourceId:"source_01",quote:"Insulation resists the flow of heat"}],
  warnings:["Unverified"],provider:"searxng",model:"local"};
const plan={schemaVersion:1,kind:"preproduction-plan",researchId:"research_proof",shots:[{id:"shot1",family:"question",purpose:"hook"}]};
const brief={title:"Insulation",viewerQuestion:"Why use it?",audience:"Homeowners",locale:"en-US"};
const settings={model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};

test("explicit Studio research stores immutable source text and matching quotes before returning draft",async()=>{
  const root=await mkdtemp(join(tmpdir(),"cg-studio-research-"));
  try{
    let researchCalls=0,planCalls=0;
    const deps={root,searchEndpoint:"http://127.0.0.1:58023/search",research:async(_brief,opts)=>{researchCalls++;assert.equal(opts.allowNetwork,true);assert.equal(opts.provider,"searxng");return research;},
      generate:async(d,opts)=>{planCalls++;assert.equal(d.id,"research_proof");assert.equal(opts.model,"local");return plan;}};
    const result=await createStudioResearchDraft(brief,settings,deps);
    assert.deepEqual(result.quotes,[{claimId:"claim_01",sourceId:"source_01",quote:"Insulation resists the flow of heat"}]);
    assert.equal(result.snapshotId,"research_proof");
    assert.match(result.artifactId,/^research_proof-[a-f0-9]{12}$/u);
    const names=await readdir(root);assert.equal(names.length,1);
    assert.match(names[0],/^research_proof-[a-f0-9]{12}\.json$/u);
    const saved=JSON.parse(await readFile(join(root,names[0]),"utf8"));
    assert.equal(saved.captures[0].text,capturedText);
    assert.equal(saved.dossier.evidence[0].snapshotSha256,dossier.evidence[0].snapshotSha256);
    assert.equal(researchCalls,1);assert.equal(planCalls,1);
    const restored=await loadStudioResearchDraft(result.artifactId,{root});
    assert.deepEqual(restored.dossier,result.dossier);
    assert.deepEqual(restored.quotes,result.quotes);
    assert.equal(restored.plan.shots[0].id,"shot1");
    await createStudioResearchDraft(brief,settings,deps);
    assert.deepEqual(await readdir(root),names);
    const alternate={...deps,generate:async()=>({...plan,shots:[{...plan.shots[0],visualChange:"Different research-based cutaway"}]})};
    await createStudioResearchDraft(brief,settings,alternate);
    const versions=await readdir(root);
    assert.equal(versions.length,2,"a different creative plan must get a new immutable snapshot");
  }finally{await rm(root,{recursive:true,force:true});}
});
test("restoring a snapshot rejects unsafe artifact identifiers and missing files",async()=>{
  await assert.rejects(loadStudioResearchDraft("../../etc/passwd"),/artifact ID/i);
  const root=await mkdtemp(join(tmpdir(),"cg-studio-research-"));
  try{await assert.rejects(loadStudioResearchDraft("research_missing-aaaaaaaaaaaa",{root}),/ENOENT/);}
  finally{await rm(root,{recursive:true,force:true});}
});
test("edited snapshot bytes cannot masquerade as their old immutable plan digest",async()=>{
  const root=await mkdtemp(join(tmpdir(),"cg-studio-research-"));
  try{
    const result=await createStudioResearchDraft(brief,settings,{root,searchEndpoint:"http://127.0.0.1:58023/search",research:async()=>research,generate:async()=>plan});
    const file=join(root,result.artifactId+".json");
    const saved=JSON.parse(await readFile(file,"utf8"));
    saved.plan.shots[0].onScreenText="Invented headline";
    await writeFile(file,JSON.stringify(saved));
    await assert.rejects(loadStudioResearchDraft(result.artifactId,{root}),/digest|hash|tamper/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("failed planning or inconsistent quote produces no successful persisted draft",async()=>{
  const root=await mkdtemp(join(tmpdir(),"cg-studio-research-"));
  try{
    await assert.rejects(createStudioResearchDraft(brief,settings,{root,searchEndpoint:"http://127.0.0.1:58023/search",research:async()=>research,generate:async()=>{throw Error("Model invalid JSON");}}),/Model invalid JSON/);
    assert.deepEqual(await readdir(root),[]);
    await assert.rejects(createStudioResearchDraft(brief,settings,{root,searchEndpoint:"http://127.0.0.1:58023/search",research:async()=>({...research,claimSupport:[{claimId:"claim_01",sourceId:"source_01",quote:"invented number"}]}),generate:async()=>plan}),/quote|support/i);
    assert.deepEqual(await readdir(root),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("research-to-story Studio pipeline uses separate selected text models",async t=>{
  const root=await mkdtemp(join(tmpdir(),"cg-two-models-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[];
  await createStudioResearchDraft(brief,settings,{root,searchEndpoint:"http://127.0.0.1:58023/search",
    storyModelSettings:{model:"story-model",endpoint:"http://127.0.0.1:10100/inference/v1/chat/completions"},
    research:async(_brief,opts)=>{calls.push(["research",opts.model,opts.endpoint]);return research;},
    generate:async(_dossier,opts)=>{calls.push(["story",opts.model,opts.endpoint]);return plan;}});
  assert.deepEqual(calls,[["research","local","http://127.0.0.1:11434/v1/chat/completions"],
    ["story","story-model","http://127.0.0.1:10100/inference/v1/chat/completions"]]);
});

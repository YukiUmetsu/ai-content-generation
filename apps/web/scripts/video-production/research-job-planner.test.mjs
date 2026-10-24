import test from "node:test";
import assert from "node:assert/strict";
import {generateOutline,generateSceneUnit,assembleResumablePlan} from "./research-job-planner.mjs";
import {parsePreproductionPlan} from "./preproduction.mjs";

const dossier={schemaVersion:1,kind:"research-dossier",id:"research_abc123",topic:{title:"Heat pump costs",viewerQuestion:"Why do installations cost so much?",audience:"Homeowners",locale:"en-US"},evidence:[{id:"source_01",title:"Energy guide",sourceUri:"https://energy.example.org/guide",retrievedAt:"2026-10-23T00:00:00.000Z",passageLocator:"captured-text:[0,82)",snapshotSha256:"a".repeat(64)}],claims:[{id:"claim_01",text:"Installation requires equipment and labor.",status:"unverified",sourceRefs:["source_01"]}],assets:[],gaps:[],review:{status:"draft"}};
const quotes=[{claimId:"claim_01",sourceId:"source_01",quote:"Installation requires equipment and labor."}];
const outline={pattern:"cost-dissection",premise:"Why cost differs from sticker price",hook:"Why is installation expensive?",beats:[{question:"What is being paid for?",claimIds:["claim_01"],purpose:"Reveal cost components",payoff:"Equipment and labor both matter"},{question:"Why can labor change?",claimIds:["claim_01"],purpose:"Explain the installation job",payoff:"Installation includes work beyond the unit"}]};
const unit=(kind)=>({subject:"Installation work",before:"Unit price shown alone",action:"Reveal equipment and labor components",after:"Total includes equipment and labor",parts:["Equipment","Labor"],operator:"split",phases:[
  {visualAction:"Show the price label hiding its parts",learningChange:"Viewers see that the price is incomplete",onScreenText:"The sticker price",narration:"The unit has a sticker price, but that is only part of the cost.",visualElements:[{label:"Price label",detail:"Shows the advertised unit cost"},{label:"Covered breakdown",detail:"Additional components are initially hidden"}]},
  {visualAction:"Split the installation into equipment and labor",learningChange:"Viewers learn the two cost categories",onScreenText:"What the bill includes",narration:"Equipment and labor both contribute to installation.",visualElements:[{label:"Equipment",detail:"The physical heat pump hardware"},{label:"Labor",detail:"The work required for installation"}]},
  {visualAction:"Bring both categories together into the final cost",learningChange:"Viewers understand the combined bill",onScreenText:kind,narration:"The final cost combines the unit and installation work.",visualElements:[{label:"Equipment cost",detail:"Hardware portion of the bill"},{label:"Labor cost",detail:"Installation work portion of the bill"}]},
]});
const settings={model:"small-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};
const transportFor=body=>async (_endpoint,options)=>{
  const sent=JSON.parse(options.body);
  assert.ok(sent.max_tokens>0&&sent.max_tokens<=1400);
  assert.ok(options.signal);
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(body)}}]})};
};

test("short outline request validates known claim IDs",async()=>{
  const result=await generateOutline(dossier,quotes,settings,{transport:transportFor(outline)});
  assert.equal(result.beats.length,2);
  await assert.rejects(generateOutline(dossier,quotes,settings,{transport:transportFor({...outline,beats:[{...outline.beats[0],claimIds:["invented_claim"]},outline.beats[1]]})}),/claim/i);
});

test("scene task only needs its beat, and assembled plan passes full contract",async()=>{
  const first=await generateSceneUnit(outline,0,dossier,quotes,settings,{transport:transportFor(unit("Price = equipment + labor"))});
  const second=await generateSceneUnit(outline,1,dossier,quotes,settings,{transport:transportFor(unit("Installation work matters"))});
  const plan=assembleResumablePlan(dossier,outline,[first,second]);
  assert.equal(plan.shots.length,6);
  assert.equal(plan.teachingSequences.length,2);
  assert.equal(parsePreproductionPlan(plan,dossier).ok,true);
  assert.equal(plan.shots[0].purpose,"hook");
  assert.equal(plan.shots.at(-1).purpose,"answer");
});

test("invalid scene output cannot invent unapproved quantities or empty visuals",async()=>{
  await assert.rejects(generateSceneUnit(outline,0,dossier,quotes,settings,{transport:transportFor({...unit("The cost"),parts:["$5,000","Labor"]})}),/parts|quantity/i);
  await assert.rejects(generateSceneUnit(outline,0,dossier,quotes,settings,{transport:transportFor({...unit("The cost"),phases:unit("The cost").phases.map(x=>({...x,visualElements:[]}))})}),/visual|visible/i);
});

test("oversized streaming model output is stopped before consuming the whole response",async()=>{
  let reads=0,cancelled=false;
  const transport=async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array(64000)};},
    cancel:async()=>{cancelled=true;},releaseLock:()=>{},
  })}});
  await assert.rejects(generateOutline(dossier,quotes,settings,{transport}),/oversized|exceeds/i);
  assert.ok(reads<=3);
  assert.equal(cancelled,true);
});

test("local model fenced JSON is recovered without changing the content",async()=>{
  const transport=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
    finish_reason:"stop",message:{content:"```json\n"+JSON.stringify(outline)+"\n```"}}]})});
  assert.equal((await generateOutline(dossier,quotes,settings,{transport})).beats.length,2);
});

test("safe trailing-comma repair preserves commas inside quoted text",async()=>{
  const malformed=JSON.stringify({...outline,premise:"Hardware, labor, and permits matter"})
    .replace('"payoff":"Installation includes work beyond the unit"}',
      '"payoff":"Installation includes work beyond the unit",}')
    .replace('}]}','},]}');
  const transport=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
    finish_reason:"stop",message:{content:malformed}}]})});
  const result=await generateOutline(dossier,quotes,settings,{transport});
  assert.equal(result.premise,"Hardware, labor, and permits matter");
  assert.equal(result.beats.length,2);
});

test("truncated model output exposes safe finish reason without leaking generated text",async()=>{
  const transport=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
    finish_reason:"length",message:{content:'{"private":"secret passage"'}}]})});
  await assert.rejects(generateOutline(dossier,quotes,settings,{transport}),error=>{
    assert.equal(error.code,"output_truncated");
    assert.equal(error.field,"response");
    assert.doesNotMatch(error.message,/secret passage/);
    return true;
  });
});

test("schema errors identify the invalid field with no source text",async()=>{
  await assert.rejects(generateSceneUnit(outline,0,dossier,quotes,settings,{
    transport:transportFor({...unit("The cost"),phases:unit("The cost").phases.map((phase,i)=>i===1?{...phase,visualElements:[]}:phase)})
  }),error=>{
    assert.equal(error.code,"schema_invalid");
    assert.equal(error.field,"phases[1].visualElements");
    assert.doesNotMatch(error.message,/Installation requires equipment/);
    return true;
  });
});

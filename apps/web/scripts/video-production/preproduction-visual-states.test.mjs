import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {generatePreproductionPlan} from "./preproduction-generator.mjs";

const fixture=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
const model=plan=>async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}),{status:200});
const options={model:"installed-local",endpoint:"http://127.0.0.1:11500/v1/chat/completions"};
test("new local-model plans require visual states so actions have something concrete to render",async()=>{
  const dossier=fixture("preproduction-research-smoke.json"),plan=fixture("preproduction-plan-smoke.json");
  for(const shot of plan.shots)shot.visualElements=[
    {label:"Purchase price",detail:"The purchase begins with an initial quoted amount"},
    {label:"Ownership costs",detail:"Costs continue over time beyond purchase"},
    {label:"Conditions",detail:"Financing and ownership assumptions matter"}
  ];
  await assert.rejects(generatePreproductionPlan(dossier,options,{transport:model(plan)}),/visualStates/);
  plan.teachingSequences[0].visualStates={before:"Only the asking price is visible",
    action:"Reveal financing and ongoing costs",after:"The budget includes more than the price"};
  await assert.rejects(generatePreproductionPlan(dossier,options,{transport:model(plan)}),/visualMechanic/);
  plan.teachingSequences[0].visualMechanic={version:1,operator:"accumulate",subjectId:"house",
    actors:[{id:"house",label:"Home ownership",role:"subject",claimIds:["claim_illustrative"]},
      {id:"tax",label:"Property tax",role:"part",claimIds:["claim_illustrative"]},
      {id:"insurance",label:"Home insurance",role:"part",claimIds:["claim_illustrative"]},
      {id:"total",label:"Ownership cost",role:"result",claimIds:["claim_illustrative"]}],
    operands:["tax","insurance"],outcomeId:"total"};
  const result=await generatePreproductionPlan(dossier,options,{transport:model(plan)});
  assert.deepEqual(result.teachingSequences[0].visualStates,plan.teachingSequences[0].visualStates);
  assert.deepEqual(result.teachingSequences[0].visualMechanic,plan.teachingSequences[0].visualMechanic);
});

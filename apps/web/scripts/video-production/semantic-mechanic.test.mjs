import test from "node:test";
import assert from "node:assert/strict";
import {VISUAL_OPERATORS, validateVisualMechanic} from "./semantic-mechanic.mjs";

const baseActors = [
  {id:"system",label:"Heating system",role:"subject",claimIds:["claim_1"]},
  {id:"one",label:"Equipment",role:"part",claimIds:["claim_1"]},
  {id:"two",label:"Installation labor",role:"part",claimIds:["claim_1"]},
  {id:"result",label:"Installed system",role:"result",claimIds:["claim_1"]},
  {id:"origin",label:"Sender",role:"source",claimIds:["claim_1"]},
  {id:"target",label:"Receiver",role:"destination",claimIds:["claim_1"]},
];
const context={technicalSubjectId:"system",knownClaimIds:new Set(["claim_1"]),knownAssetKeys:new Set(["safe-house"])};
function mechanic(operator){
  const spec={version:1,operator,subjectId:"system",actors:structuredClone(baseActors),operands:["one","two"],outcomeId:"result"};
  if(operator==="split") spec.outcomeId="system";
  if(operator==="transfer") {spec.operands=["origin","target"];spec.outcomeId="system";}
  if(operator==="compare") spec.outcomeId="system";
  if(operator==="reveal") {spec.operands=["origin","one"];spec.outcomeId="one";}
  const visible=new Set([spec.subjectId,...spec.operands,spec.outcomeId]);
  spec.actors=spec.actors.filter(a=>visible.has(a.id));
  return spec;
}
const codes=(spec,ctx=context)=>validateVisualMechanic(spec,ctx).findings.map(x=>x.code);

test("all six semantic operators have valid, distinct typed relationships",()=>{
  assert.deepEqual(VISUAL_OPERATORS,["split","assemble","transfer","accumulate","compare","reveal"]);
  for(const operator of VISUAL_OPERATORS){
    const verdict=validateVisualMechanic(mechanic(operator),context);
    assert.equal(verdict.ok,true,`${operator}: ${JSON.stringify(verdict.findings)}`);
  }
});
test("reject unknown, duplicate, missing or mismatched actor identity and subjects",()=>{
  const x=mechanic("split");x.actors[2].id="one";
  assert.ok(codes(x).includes("mechanic-duplicate-id"));
  const y=mechanic("transfer");y.subjectId="different";
  assert.ok(codes(y).includes("mechanic-subject"));
  const z=mechanic("assemble");z.operands[1]="missing";
  assert.ok(codes(z).includes("mechanic-actor-ref"));
  const unknown=mechanic("split");unknown.javascript="alert(1)";
  assert.ok(codes(unknown).includes("mechanic-unknown-field"));
  const unused=mechanic("split");unused.actors.push({id:"distraction",label:"Meaningless decoration",role:"part",claimIds:["claim_1"]});
  assert.ok(codes(unused).includes("mechanic-unused-actor"));
});
test("reject URLs, script markup, unsolicited numbers, unlicensed keys and invented claims",()=>{
  const url=mechanic("split");url.actors[1].assetKey="https://untrusted.test/icon.svg";
  assert.ok(codes(url).includes("mechanic-asset"));
  const markup=mechanic("split");markup.actors[1].label="<script>alert(1)</script>";
  assert.ok(codes(markup).includes("mechanic-label"));
  const quantity=mechanic("accumulate");quantity.actors[1].label="$25,000 equipment";
  assert.ok(codes(quantity).includes("mechanic-quantity"));
  const claim=mechanic("assemble");claim.actors[1].claimIds=["unverified"];
  assert.ok(codes(claim).includes("mechanic-claim"));
  const key=mechanic("assemble");key.actors[1].assetKey="unknown-icon";
  assert.ok(codes(key).includes("mechanic-asset"));
});
test("wrong operator roles and meaningless operand relationships fail closed",()=>{
  const transfer=mechanic("transfer");transfer.operands=["one","two"];
  assert.ok(codes(transfer).includes("mechanic-roles"));
  const split=mechanic("split");split.operands=["origin","target"];
  assert.ok(codes(split).includes("mechanic-roles"));
  const reveal=mechanic("reveal");reveal.outcomeId="result";
  assert.ok(codes(reveal).includes("mechanic-roles"));
  const empty=mechanic("accumulate");empty.operands=["one"];
  assert.ok(codes(empty).includes("mechanic-operands"));
});
test("bounded arrays, actor identifiers, meaningful text and nested unknown properties",()=>{
  const many=mechanic("compare");many.operands=Array(7).fill("one");
  assert.ok(codes(many).includes("mechanic-operands"));
  const x=mechanic("compare");x.actors[1].label="Part";x.actors[1].onClick="execute()";
  assert.ok(codes(x).includes("mechanic-unknown-field"));
  const text=mechanic("compare");text.actors[2].label="x".repeat(60);
  assert.ok(codes(text).includes("mechanic-label"));
  const bad=mechanic("compare");bad.actors[1].id="../../file";
  assert.ok(codes(bad).includes("mechanic-actor-id"));
});

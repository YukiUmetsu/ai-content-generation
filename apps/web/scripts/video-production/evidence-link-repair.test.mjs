import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectCapturedLinks, repairCapturedLinks } from "./evidence-link-repair.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const passage = "Heat-pump installation often requires electrical and ductwork adjustments.";
function fixture() {
  const text = "A captured report states: " + passage + " Further explanation follows.";
  return {
    dossier: { claims: [{ id:"claim_02", text:passage, status:"unverified", sourceRefs:["source_old"] }],
      evidence:[{id:"source_01",snapshotSha256:hash(text)}] },
    quotes:[{claimId:"claim_02",sourceId:"source_old",quote:passage}],
    captures:[{id:"source_01",text}],
    plan:{shots:[{id:"shot_a",claimIds:["claim_02"]}]},
  };
}
test("relinks only a unique exact quote with a validated digest", async () => {
  const input=fixture();
  const repaired=await repairCapturedLinks(input);
  assert.equal(repaired.autoFixed,1);
  assert.equal(repaired.unresolved.length,0);
  assert.deepEqual(repaired.document.dossier.claims[0].sourceRefs,["source_01"]);
  assert.equal(repaired.document.quotes[0].sourceId,"source_01");
  assert.equal(input.dossier.claims[0].sourceRefs[0],"source_old");
  const again=await repairCapturedLinks(repaired.document);
  assert.equal(again.autoFixed,0);
});
test("changed captured text or hash never yields an automatic citation", async () => {
  const input=fixture();
  input.captures[0].text+=" Modified";
  const repaired=await repairCapturedLinks(input);
  assert.equal(repaired.autoFixed,0);
  assert.equal(repaired.unresolved.length,1);
  assert.equal(repaired.document.quotes[0].sourceId,"source_old");
});
test("ambiguous duplicate passages are not auto-repaired",async()=>{
  const input=fixture();
  input.captures.push({id:"source_02",text:input.captures[0].text});
  input.dossier.evidence.push({id:"source_02",snapshotSha256:hash(input.captures[1].text)});
  const result=await repairCapturedLinks(input);
  assert.equal(result.autoFixed,0);
  assert.equal(result.unresolved[0].reason,"ambiguous_capture");
});
test("hallucinated candidate IDs remain suggestions, not truth",async()=>{
  const input=fixture();
  input.captures[0].text="An unrelated passage that does not prove the claim.";
  input.dossier.evidence[0].snapshotSha256=hash(input.captures[0].text);
  const result=await repairCapturedLinks(input,{suggestCandidates:async()=>({sourceId:"source_hallucinated"})});
  assert.equal(result.autoFixed,0);
  assert.equal(result.unresolved.length,1);
  assert.equal(result.proposals.length,0);
});
test("source-linked unverified claims are not incorrectly repaired",async()=>{
  const input=fixture();
  input.dossier.claims[0].sourceRefs=["source_01"];
  input.quotes[0].sourceId="source_01";
  const inspect=inspectCapturedLinks(input);
  assert.equal(inspect.issues.length,0);
  assert.equal(inspect.linked,1);
  assert.equal((await repairCapturedLinks(input)).autoFixed,0);
});

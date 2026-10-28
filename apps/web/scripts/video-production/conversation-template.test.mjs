import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createConversationNarrationTemplate} from "./conversation-template.mjs";
import {compilePreproductionBundle} from "./preproduction.mjs";
import {compilePreproductionRenderJob} from "./preproduction-render-bridge.mjs";

const fixture=name=>JSON.parse(readFileSync(new URL(`../../../../examples/${name}`,import.meta.url),"utf8"));

test("one-click conversation template adds Pip, Quill, and narrator without discarding a sourced scene",()=>{
  const dossier=fixture("preproduction-research-smoke.json");
  const original=compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"));
  const next=createConversationNarrationTemplate(dossier,original);
  assert.equal(next.plan.shots.length,original.plan.shots.length);
  assert.deepEqual(next.plan.shots,original.plan.shots);
  assert.equal(next.plan.sound[0].narration,original.plan.sound[0].narration);
  assert.equal(next.plan.sound.at(-1).narration,original.plan.sound.at(-1).narration);
  assert.deepEqual(next.plan.sound[1].speechTurns.map(turn=>turn.speaker?.id??"narrator"),["pip","quill","narrator"]);
  assert.equal(next.plan.sound[1].speechTurns[2].narration,original.plan.sound[1].narration);
  assert.deepEqual(compilePreproductionRenderJob(dossier,next).job.beats[1].speechTurns.map(turn=>turn.speaker?.id??"narrator"),
    ["pip","quill","narrator"]);
  assert.equal(original.plan.sound[1].speechTurns,undefined,"the original research artifact is immutable");
});

test("conversation template rejects tampered source documents before changing any scenes",()=>{
  const dossier=fixture("preproduction-research-smoke.json");
  const original=compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"));
  const tampered=structuredClone(original);tampered.plan.sound[1].narration="No longer source-bound";
  assert.throws(()=>createConversationNarrationTemplate(dossier,tampered),/untampered|source|research/i);
});

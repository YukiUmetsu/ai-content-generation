import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
import { buildSampleTimeline } from "./timeline.mjs";
import { compileGeneralVisuals, getGeneralFrame } from "./general-visual-plan.mjs";
import { compileLiveVisualPreview,estimateNarrationSamples } from "./live-visual-preview.mjs";
const fixture=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
function original(){
 const dossier=fixture("preproduction-research-smoke.json");
 return {dossier,bundle:compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"))};
}
test("visual preview compiles exactly the production scene plan with only estimated narration samples",()=>{
 const {dossier,bundle}=original(),view=compileLiveVisualPreview(dossier,bundle);
 const output=compilePreproductionRenderJob(dossier,bundle);
 const timeline=buildSampleTimeline(output.job.beats.map(beat=>({
  id:beat.id,samples:estimateNarrationSamples(beat.narration,output.job.locale),
  pauseAfterMs:beat.pauseAfterMs,eventIds:beat.eventIds
 })),{fps:output.job.destination.fps,events:output.job.events});
 assert.deepEqual(view.plan,compileGeneralVisuals(output.job,timeline));
 assert.equal(view.kind,"live-renderer-preview/v1");
 assert.equal(view.plan.kind,"general-explainer-visual-plan");
 assert.equal(view.shotMap.length,bundle.plan.shots.length);
 assert.equal(view.shotMap[0].shotId,bundle.plan.shots[0].id);
 assert.deepEqual(view.shotMap.map(x=>x.startFrame),view.plan.chapters.map(x=>x.startFrame));
 assert.equal(view.shotMap.at(-1).endFrame,view.plan.manifest.durationFrames);
 assert.equal(view.timing.measuredNarration,false);
 assert.match(view.timing.note,/estimated/);
 assert.equal(view.plan.commercialReady,false);
 assert.match(view.renderPlanSha256,/^[a-f0-9]{64}$/);
});
test("previews are reproducible at arbitrary frames, with a locked first payoff frame",()=>{
 const {dossier,bundle}=original();
 const a=compileLiveVisualPreview(dossier,bundle);
 const b=compileLiveVisualPreview(dossier,bundle);
 assert.deepEqual(a,b);
 const payoff=a.plan.events[a.plan.payoffEventId];
 assert.equal(getGeneralFrame(a.plan,payoff).visibleItems,0);
 assert.ok(getGeneralFrame(a.plan,Math.min(payoff+30,a.plan.manifest.durationFrames-1)).visibleItems>0);
 const p=a.plan.chapters[1];
 assert.deepEqual(getGeneralFrame(a.plan,p.startFrame+2),getGeneralFrame(a.plan,p.startFrame+2));
});
test("editing one visual action changes the scene fingerprint but keeps unrelated scene data",()=>{
 const {dossier,bundle}=original();
 const before=compileLiveVisualPreview(dossier,bundle);
 const updated=structuredClone(bundle.plan);
 const phase=updated.teachingSequences[0].phases[1];
 phase.visualAction="Move the same fictional house through a series of clearly separated cost groups.";
 const revised=compilePreproductionBundle(dossier,updated);
 const after=compileLiveVisualPreview(dossier,revised);
 assert.notEqual(after.renderPlanSha256,before.renderPlanSha256);
 assert.notDeepEqual(after.plan.chapters[1].visual,before.plan.chapters[1].visual);
 assert.deepEqual(after.plan.chapters[0],before.plan.chapters[0]);
 assert.deepEqual(after.plan.chapters[2],before.plan.chapters[2]);
 assert.deepEqual(after.plan.chapters[1].visual.direction.visualAction,phase.visualAction);
});
test("no fabricated timing accuracy or unsupported malformed source is accepted",()=>{
 const {dossier,bundle}=original();
 assert.ok(estimateNarrationSamples("A very small phrase.")>=3*48000);
 assert.ok(estimateNarrationSamples("日本語の説明です", "ja-JP")>=3*48000);
 assert.ok(estimateNarrationSamples("A sentence.", "en-US",95)>estimateNarrationSamples("A sentence.", "en-US",210));
 assert.throws(()=>compileLiveVisualPreview(dossier,bundle,{spokenWpm:2}),/pace/);
 const changed=structuredClone(bundle);
 changed.plan.shots[0].onScreenText="Tampered unsourced claim";
 assert.throws(()=>compileLiveVisualPreview(dossier,changed),/untampered/);
 const other=structuredClone(dossier);other.topic.audience="Other audience";
 assert.throws(()=>compileLiveVisualPreview(other,bundle),/untampered/);
});

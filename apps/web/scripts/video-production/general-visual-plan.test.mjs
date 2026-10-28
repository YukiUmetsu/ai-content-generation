import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSampleTimeline, toFrame } from "./timeline.mjs";
import { compileGeneralVisuals, getGeneralFrame } from "./general-visual-plan.mjs";

const source = JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json", import.meta.url), "utf8"));
const timeline = buildSampleTimeline(source.beats.map((beat) => ({ id: beat.id, samples: 4 * 48000, pauseAfterMs: beat.pauseAfterMs, eventIds: beat.eventIds })), { fps: source.destination.fps, events: source.events });

test("generic storyboard compiles to sample-driven chapters with meaningful diagrams", () => {
  const plan = compileGeneralVisuals(source, timeline);
  assert.equal(plan.kind, "general-explainer-visual-plan");
  assert.equal(plan.chapters.length, 4);
  assert.deepEqual(plan.chapters[1].visual.items, ["Phone", "Router", "Network", "Destination"]);
  assert.equal(plan.manifest.durationFrames, timeline.totalFrames);
  assert.equal(plan.commercialReady, false);
});

test("compiled visuals preserve the script locale so Kumiki charts choose the right text segmentation", () => {
  const localized = { ...source, locale: "ja-JP", voice: { ...source.voice, locale: "ja-JP" } };
  const result = compileGeneralVisuals(localized, timeline);
  assert.equal(result.locale, "ja-JP");
});

test("generic payoff starts hidden; sequential content reveals deterministically on direct seeks", () => {
  const plan = compileGeneralVisuals(source, timeline);
  const start = getGeneralFrame(plan, plan.chapters[1].startFrame);
  const later = getGeneralFrame(plan, Math.min(plan.chapters[1].endFrame - 1, plan.chapters[1].startFrame + 80));
  assert.ok(later.visibleItems > start.visibleItems);
  const at = getGeneralFrame(plan, plan.events[plan.payoffEventId]);
  const after = getGeneralFrame(plan, plan.events[plan.payoffEventId] + 30);
  assert.equal(at.visibleItems, 0);
  assert.ok(after.visibleItems > 0);
  assert.equal(after.visual.headline, "THE MESSAGE ARRIVES");
  assert.throws(() => getGeneralFrame(plan, timeline.totalFrames), /frame/i);
});

test("generic compiler rejects incompatible source, mismatched beats and short long-form", () => {
  assert.throws(() => compileGeneralVisuals({ ...source, visualFamily: "house-math-v1" }, timeline), /invalid|family|job/i);
  assert.throws(() => compileGeneralVisuals(source, { ...timeline, beats: timeline.beats.slice(1) }), /beat|chapter/i);
  assert.throws(() => compileGeneralVisuals({ ...source, mode: "youtube-long", destination: { ...source.destination, minimumDurationSeconds: 480, targetDurationSeconds: [480, 900] } }, timeline), /480|duration/i);
});

test("compiled chapters retain the exact source snapshot locator behind verified narration", () => {
  const job = structuredClone(source);
  job.evidence = [{ id: "study", title: "Named article", sourceUri: "https://example.org/reading",
    retrievedAt: "2026-10-22T14:00:00.000Z", passageLocator: "§2 ¶5", snapshotSha256: "b".repeat(64) }];
  job.claims[0] = { id: "finding", status: "verified", text: "An author-reviewed statement", sourceRefs: ["study"] };
  job.beats.forEach((beat) => { beat.claimRefs = []; });
  job.beats[1].claimRefs = ["finding"];
  job.beats[1].visual.chart = {
    kind: "quantitative-chart-v1", categories: ["Before", "After"],
    series: [{ id: "observations", label: "Recorded count", values: [8, null] }],
    unit: "events", provenance: { basis: "measured", disclosure: "Measured test-fixture values only.",
      claimRefs: ["finding"], evidenceRefs: ["study"] },
  };
  const plan = compileGeneralVisuals(job, timeline);
  assert.deepEqual(plan.chapters[1].evidenceRefs, ["study"]);
  assert.deepEqual(plan.evidence, job.evidence);
  assert.deepEqual(plan.chapters[0].evidenceRefs, []);
  assert.deepEqual(plan.chapters[1].visual.chart, job.beats[1].visual.chart);
  // Never confuse provenance-record presence with human validation of the render.
  assert.equal(plan.commercialReady, false);
});

test("measured dialogue audio drives exact per-turn actor frames; inconsistent voice identity fails closed", () => {
  const job=structuredClone(source), beat=job.beats[1];
  const turns=[
    {id:"ask",narration:"Pip asks a question about the network.",pauseAfterMs:120,
      speaker:{id:"pip",role:"character",voiceId:"pip-voice"}},
    {id:"reply",narration:"Quill answers and points to the router.",pauseAfterMs:150,
      speaker:{id:"quill",role:"character",voiceId:"quill-voice"}},
    {id:"narrate",narration:"Narrator explains the same scene while the others listen.",pauseAfterMs:0},
  ];
  beat.narration=turns.map(turn=>turn.narration).join(" ");
  beat.speechTurns=turns;
  const speech=job.beats.map((item,index)=>index===1?{
    id:item.id,samples:3*48000+(120+150)*48,
    turns:turns.map(turn=>({id:`${beat.id}.${turn.id}`,text:turn.narration,samples:48000,
      pauseAfterMs:turn.pauseAfterMs,speakerId:turn.speaker?.id??"narrator",
      speakerRole:turn.speaker?.role??"narrator",voiceId:turn.speaker?.voiceId??job.voice.voiceId})),
  }:{id:item.id,samples:4*48000});
  const measuredTimeline=buildSampleTimeline(speech.map((item,index)=>({id:item.id,samples:item.samples,
    pauseAfterMs:job.beats[index].pauseAfterMs,eventIds:job.beats[index].eventIds})),{
    fps:job.destination.fps,events:job.events});
  const plan=compileGeneralVisuals(job,measuredTimeline,speech);
  const dialogue=plan.chapters[1].dialogue;
  assert.deepEqual(dialogue.turns.map(turn=>turn.speakerId),["pip","quill","narrator"]);
  assert.equal(dialogue.turns[0].startFrame,measuredTimeline.beats[1].startFrame);
  assert.equal(dialogue.turns[1].startFrame,toFrame(measuredTimeline.beats[1].startSample+48000+120*48,job.destination.fps));
  assert.equal(dialogue.turns[2].startFrame,toFrame(measuredTimeline.beats[1].startSample+2*48000+(120+150)*48,job.destination.fps));
  const editor=compileGeneralVisuals(job,measuredTimeline);
  assert.ok(editor.chapters[1].dialogue.turns.every(turn=>turn.startFrame===undefined),
    "editor visual preview must not pretend approximate timings are measured speech");
  const wrong=structuredClone(speech);
  wrong[1].turns[1].speakerId="pip";
  assert.throws(()=>compileGeneralVisuals(job,measuredTimeline,wrong),/voice identity|measured/u);
  wrong[1].turns[1].speakerId="quill";
  wrong[1].turns[1].samples-=480;
  assert.throws(()=>compileGeneralVisuals(job,measuredTimeline,wrong),/speech range|measured/u);
});

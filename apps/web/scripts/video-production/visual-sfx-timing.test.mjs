import test from "node:test";
import assert from "node:assert/strict";
import {buildSampleTimeline,toFrame} from "./timeline.mjs";
import {resolveVisualSfxTimeline} from "./visual-sfx-timing.mjs";

const fps={num:30,den:1};
const measured=firstSamples=>buildSampleTimeline([
  {id:"explain",samples:firstSamples,pauseAfterMs:0,eventIds:["visual-cue"]},
  {id:"answer",samples:96000,pauseAfterMs:0,eventIds:["payoff"]}
],{fps,events:[{id:"visual-cue",beatId:"explain",anchor:"first-visual-reveal"},
  {id:"payoff",beatId:"answer"}]});
const job={visualFamily:"general-explainer-v1",
  topic:{payoffEventId:"payoff"},
  events:[{id:"visual-cue",beatId:"explain",anchor:"first-visual-reveal"},
    {id:"payoff",beatId:"answer"}]};
const visualPlan=timeline=>({
  kind:"general-explainer-visual-plan",payoffEventId:"payoff",events:{...timeline.eventFrames},
  manifest:{durationFrames:timeline.totalFrames,fps},
  chapters:timeline.beats.map((beat,index)=>({id:beat.id,
    intent:index===0?"general-breakdown":"general-payoff",startFrame:beat.startFrame,
    endFrame:index===0?timeline.beats[1].startFrame:timeline.totalFrames,
    visual:{items:["document","retrieval","answer"]}}))
});

test("a real visible-item increase after the opening frame sets the cue's exact sample",()=>{
  const original=measured(96000),refined=resolveVisualSfxTimeline(job,original,visualPlan(original));
  assert.equal(original.eventSamples["visual-cue"],0,"resolver must not mutate original measured timing");
  assert.equal(refined.eventFrames["visual-cue"],20);
  assert.equal(refined.eventSamples["visual-cue"],32000);
  assert.equal(toFrame(refined.eventSamples["visual-cue"],fps),20);
  assert.equal(refined.eventSamples.payoff,96000);
  assert.equal(refined.eventFrames.payoff,60);
});

test("cue retimes with measured speech duration while staying synced to the rendered frame",()=>{
  const longer=measured(144000),result=resolveVisualSfxTimeline(job,longer,visualPlan(longer));
  assert.equal(result.eventFrames["visual-cue"],24);
  assert.equal(result.eventSamples["visual-cue"],38400);
  assert.equal(result.eventSamples.payoff,144000);
});

test("missing visual transition and unsupported bespoke recipes fail rather than guessing a time",()=>{
  const timing=measured(96000),plan=visualPlan(timing);
  plan.chapters[0].visual.items=[];
  assert.throws(()=>resolveVisualSfxTimeline(job,timing,plan),/visible|reveal|transition/i);
  plan.chapters[0].visual.items=["document","retrieval","answer"];
  plan.chapters[0].visual.sceneRecipe="bespoke-hidden-scene";
  assert.throws(()=>resolveVisualSfxTimeline(job,timing,plan),/bespoke|unsupported|recipe/i);
  assert.throws(()=>resolveVisualSfxTimeline({...job,visualFamily:"house-math-v1"},timing,plan),/general|unsupported/i);
});

test("dynamic journey, chart and semantic-mechanic visuals never masquerade as visible-item cues",()=>{
  const timing=measured(96000),plan=visualPlan(timing);
  plan.chapters[0].intent="general-flow";
  assert.throws(()=>resolveVisualSfxTimeline(job,timing,plan),/unsupported|journey|visual/i);
  plan.chapters[0].intent="general-breakdown";
  plan.chapters[0].visual.chart={kind:"quantitative-chart-v1"};
  assert.throws(()=>resolveVisualSfxTimeline(job,timing,plan),/unsupported|chart|visual/i);
  delete plan.chapters[0].visual.chart;
  plan.chapters[0].visual.direction={phase:"mechanism",visualMechanic:{}};
  assert.throws(()=>resolveVisualSfxTimeline(job,timing,plan),/unsupported|mechanic|visual/i);
  delete plan.chapters[0].visual.direction;
  plan.chapters[0].intent="general-intro";
  plan.chapters[0].visual.hookStrategy="unexpected-reveal";
  assert.throws(()=>resolveVisualSfxTimeline(job,timing,plan),/unsupported|hook|visual/i);
});

test("unchanged jobs never require visual state and never shift beat-start events",()=>{
  const unchanged={...job,events:[{id:"visual-cue",beatId:"explain"},{id:"payoff",beatId:"answer"}]};
  const timeline=measured(96000);
  assert.deepEqual(resolveVisualSfxTimeline(unchanged,timeline,null),timeline);
});

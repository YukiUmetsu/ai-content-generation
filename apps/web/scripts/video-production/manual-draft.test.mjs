import assert from "node:assert/strict";
import test from "node:test";
import { createManualVideoDraft } from "./manual-draft.mjs";
import { parseVideoProductionJob } from "./job.mjs";

const scenes = [
  { headline: "Where does the heat go?", narration: "A heat pump moves energy between indoor and outdoor air rather than making heat by burning fuel.",
    subhead: "The same mechanism can work in both seasons.", items: ["Outdoor air", "Indoor coil"] },
  { headline: "Follow the refrigerant", narration: "Refrigerant carries heat through a compressor and coils, changing pressure and temperature as it circulates.",
    intent: "general-flow", items: ["Outdoor coil", "Compressor", "Indoor coil"] },
  { headline: "Energy is moved", narration: "The electrical input runs a compressor, while the delivered heating can also include energy moved from outdoors.",
    subhead: "Actual efficiency depends on conditions.", items: ["Electricity input", "Moved heat"] },
];
const brief = { title: "How a heat pump moves energy", viewerQuestion: "Why use electricity to move heat?",
  audience: "Homeowners", locale: "en-US", length: "smoke", hookStrategy: "unexpected-reveal",
  typographyStyle: "overshoot", scenes };

test("manual video story is a valid editable general-job without contacting an AI model", () => {
  const result = createManualVideoDraft(brief);
  assert.equal(result.generator.provider, "human");
  assert.equal(result.job.visualFamily, "general-explainer-v1");
  assert.equal(result.job.mode, "smoke");
  assert.equal(result.job.destination.width, 1920);
  assert.equal(result.job.destination.height, 1080);
  assert.equal(result.job.policy.commercialRightsVerified, false);
  assert.equal(result.job.beats.length, 3);
  assert.equal(result.job.beats[0].visualIntent, "general-intro");
  assert.equal(result.job.beats[1].visualIntent, "general-flow");
  assert.equal(result.job.beats[2].visualIntent, "general-payoff");
  assert.equal(result.job.beats[0].visual.hookStrategy, "unexpected-reveal");
  assert.ok(result.job.beats.every(beat => beat.visual.typographyStyle === "overshoot"));
  assert.equal(result.job.beats.at(-1).eventIds[0], "topic-payoff");
  assert.equal(parseVideoProductionJob(result.job).ok, true);
});

test("manual drafting is stable and never changes the human's narration or manufactures evidence", () => {
  const a = createManualVideoDraft(brief), b = createManualVideoDraft(brief);
  assert.deepEqual(a, b);
  assert.deepEqual(a.job.beats.map(x => x.narration), scenes.map(x => x.narration));
  assert.equal(a.job.claims[0].status, "unverified");
  assert.equal(a.job.evidence, undefined);
});

test("Japanese scene copy is accepted without Latin word count requirements", () => {
  const input = { ...brief, locale: "ja-JP",
    scenes: scenes.map((s, i) => ({ ...s,
      headline: ["なぜ熱を運べる？", "冷媒の動き", "熱を移動する仕組み"][i],
      narration: "ヒートポンプは電気で熱を作るだけでなく、屋外の熱を室内へ運ぶことによって暖房します。" })) };
  assert.equal(createManualVideoDraft(input).job.locale, "ja-JP");
});

test("unsafe or incomplete manual content is rejected before synthesis", () => {
  assert.throws(() => createManualVideoDraft({ ...brief, scenes: scenes.slice(0, 2) }), /3–40/);
  assert.throws(() => createManualVideoDraft({ ...brief, scenes: scenes.map((s,i) => i === 1 ? { ...s, intent: "house-intro" } : s) }), /intent/);
  assert.throws(() => createManualVideoDraft({ ...brief, scenes: scenes.map((s,i) => i === 1 ? { ...s, items: ["single"] } : s) }), /2–5/);
  assert.throws(() => createManualVideoDraft({ ...brief, scenes: scenes.map((s,i) => i === 1 ? { ...s, narration: "too short" } : s) }), /narration/);
  assert.throws(() => createManualVideoDraft({ ...brief, hookStrategy: "impact-statistic" }), /hook/);
  assert.throws(() => createManualVideoDraft({ ...brief, typographyStyle: "word-highlight" }), /typography/);
  assert.throws(() => createManualVideoDraft({ ...brief, title: "<script>\nattack</script>" }), /title/i);
});

test("human script supports many scene types but forbids fake 8+ minute claims", () => {
  const longInput = { ...brief, length: "youtube-long" };
  assert.throws(() => createManualVideoDraft(longInput), /at least 10/);
  const long = createManualVideoDraft({ ...longInput, scenes: [scenes[0], ...Array.from({ length: 8 }, (_,i) =>
    ({ ...scenes[1], headline: "Stage " + i })), scenes[2]] });
  assert.equal(long.job.destination.minimumDurationSeconds, 480);
  assert.equal(long.job.mode, "youtube-long");
});

test("portrait modes are independently authored 1080x1920 outputs, not cropped landscape", () => {
  for (const preset of ["youtube-shorts", "instagram-reels", "tiktok"]) {
    const result = createManualVideoDraft({ ...brief, platform: preset });
    assert.equal(result.job.destination.presetId, preset);
    assert.equal(result.job.destination.width, 1080);
    assert.equal(result.job.destination.height, 1920);
    assert.deepEqual(result.job.destination.targetDurationSeconds, [20, 180]);
    assert.equal(result.job.destination.minimumDurationSeconds, null);
    assert.equal(parseVideoProductionJob(result.job).ok, true);
  }
  assert.notEqual(createManualVideoDraft(brief).job.id,
    createManualVideoDraft({ ...brief, platform: "youtube-shorts" }).job.id);
});
test("rejects long-form vertical output and mismatched or unsupported short presets", () => {
  assert.throws(() => createManualVideoDraft({ ...brief, platform: "youtube-shorts", length: "youtube-long" }), /long videos/i);
  assert.throws(() => createManualVideoDraft({ ...brief, platform: "tiktok-ads" }), /unsupported|platform/i);
  const portrait = createManualVideoDraft({ ...brief, platform: "youtube-shorts" }).job;
  const bad = structuredClone(portrait);
  bad.destination.width = 1920;
  assert.ok(parseVideoProductionJob(bad).findings.some(x => x.code === "preset-raster-mismatch"));
  const chart = structuredClone(portrait);
  chart.beats[1].visual.chart = { kind: "quantitative-chart-v1" };
  assert.ok(parseVideoProductionJob(chart).findings.some(x => x.code === "portrait-chart-unavailable"));
});

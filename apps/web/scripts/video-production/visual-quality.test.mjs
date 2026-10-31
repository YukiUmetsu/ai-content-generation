import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { compileLiveVisualPreview } from "./live-visual-preview.mjs";
import { analyzeRenderedSceneQuality } from "./visual-quality.mjs";

const fixture = name => JSON.parse(readFileSync(new URL("../../../../examples/" + name, import.meta.url), "utf8"));
function sample() {
  const dossier = fixture("preproduction-research-smoke.json");
  const bundle = compilePreproductionBundle(dossier, fixture("preproduction-plan-smoke.json"));
  return compileLiveVisualPreview(dossier, bundle);
}
function analyzed(view, narrations) {
  return analyzeRenderedSceneQuality({ plan: view.plan, shotMap: view.shotMap,
    beats: view.shotMap.map((_, i) => ({ narration: narrations?.[i] ?? "Each portion of this example has a different consequence for the viewer." })) });
}
function generic(view) {
  const value = structuredClone(view);
  value.plan.chapters.forEach((chapter, index) => {
    chapter.intent = "general-flow";
    chapter.visual = {
      headline: ["Permits and ductwork are hidden", "Permits and ductwork add costs", "Hidden costs: permits and ductwork"][index],
      subhead: "A specialized installation has extra labor and infrastructure.",
      emphasis: "MECHANISM", items: ["Permit fees", "Ductwork", "Specialized labor"],
      direction: { phase: "mechanism", subjectIds: ["hvac"],
        visualAction: "Show permits and ductwork in a split screen for the heat pump." },
    };
  });
  return value;
}

test("quality report is deterministic, does not modify the export plan, and honors bespoke three-phase recipes", () => {
  const view = sample();
  const snapshot = JSON.stringify(view.plan);
  const report = analyzed(view);
  assert.equal(report.kind, "rendered-scene-quality/v1");
  assert.equal(report.summary.totalShots, view.plan.chapters.length);
  assert.deepEqual(report, analyzed(view));
  assert.equal(JSON.stringify(view.plan), snapshot);
  assert.ok(!report.findings.some(f => f.code === "repeated-schematic"));
  assert.match(report.limitation, /browser/i);
});

test("non-adjacent duplicate headlines and narration are identified by stable shot ID", () => {
  const view = generic(sample());
  const first = "Specialized ductwork and permit inspections add labor to the installation quote before the heat pump can operate.";
  const report = analyzed(view, [first, "Some homeowners must upgrade their service panel before choosing equipment.", first]);
  assert.ok(report.findings.some(f => f.code === "repeated-headline" && f.shotId === view.shotMap[2].shotId));
  assert.ok(report.findings.some(f => f.code === "repeated-narration" && f.shotId === view.shotMap[2].shotId));
  assert.equal(report.status, "needs-review");
  assert.equal(report.summary.affectedShots > 0, true);
});

test("three generic scenes with the same diagram and elements are flagged, and a semantic mechanic clears only that warning", () => {
  const view = generic(sample());
  let report = analyzed(view);
  assert.ok(report.findings.some(f => f.code === "repeated-schematic" && f.shotId === view.shotMap[2].shotId));
  view.plan.chapters.forEach(chapter => {
    chapter.visual.direction.visualMechanic = { version: 1, operator: "accumulate" };
  });
  report = analyzed(view);
  assert.ok(!report.findings.some(f => f.code === "repeated-schematic"));
});

test("exact renderer SVG card-fit failure is reported with a specific shot instead of crashing preview", () => {
  const view = generic(sample());
  view.plan.chapters[1].intent = "general-comparison";
  view.plan.chapters[1].visual.items = ["A", "B", "C"];
  view.plan.chapters[1].visual.itemNotes = [
    "住宅所有者の長期保守管理費用と予想外の修繕費用を詳しく比較するための追加の内訳説明です",
    "Short", "Short",
  ];
  const report = analyzed(view);
  assert.ok(report.findings.some(f => f.code === "renderer-text-overflow" && f.shotId === view.shotMap[1].shotId));
  assert.ok(report.summary.errors >= 1);
});

test("placeholder elements and unsupported split-screen directions receive distinct actionable findings", () => {
  const view = generic(sample());
  view.plan.chapters[1].visual.items = ["Main idea", "How it changes"];
  const report = analyzed(view);
  assert.ok(report.findings.some(f => f.code === "placeholder-visual" && f.shotId === view.shotMap[1].shotId));
  assert.ok(report.findings.some(f => f.code === "unrealized-direction" && f.shotId === view.shotMap[0].shotId));
  assert.ok(report.findings.every(f => f.message && f.suggestion && f.shotId));
});

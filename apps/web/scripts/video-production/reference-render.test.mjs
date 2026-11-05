import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileReferenceJob, renderReference, screenTextReport, writeContactSheet } from "./reference-render.mjs";
import { parseVideoProductionJob } from "./job.mjs";

const fixturePath = new URL("../../fixtures/reference/invoice-receipt-gap.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const voice = { endpoint: "http://127.0.0.1:8123" };

test("the reference script compiles to a valid test-only job with a local draft voice", () => {
  const { job, shotMap } = compileReferenceJob(fixture, voice);
  assert.equal(parseVideoProductionJob(job).ok, true);
  assert.equal(job.voice.provider, "local");
  assert.equal(job.voice.licenseStatus, "test-only");
  assert.equal(job.approval, "test-only");
  assert.equal(job.beats.length, fixture.script.sections.length);
  assert.equal(shotMap.length, job.beats.length);
  assert.deepEqual(job.beats.map(beat => beat.narration), fixture.script.sections.map(section => section.text));
});

test("rejects a file that is not a reference production", () => {
  assert.throws(() => compileReferenceJob({ ...fixture, kind: "something-else" }, voice), /reference production/u);
});

const plan = { manifest: { fps: { num: 30, den: 1 }, durationFrames: 300 }, chapters: [
  { id: "beat-01", intent: "general-flow", startFrame: 0, endFrame: 150, visual: { emphasis: "THE QUESTION", headline: "A", subhead: "B", items: ["x", "y"], itemNotes: ["n"] } },
  { id: "beat-02", intent: "general-comparison", startFrame: 150, endFrame: 300, visual: { headline: "C", subhead: "D", items: [] }, interactions: { source: "rules" } },
] };

test("the screen text report lists what each scene shows and when", () => {
  const scenes = screenTextReport(plan);
  assert.deepEqual(scenes.map(scene => [scene.id, scene.startSeconds, scene.endSeconds]), [["beat-01", 0, 5], ["beat-02", 5, 10]]);
  assert.deepEqual(scenes[0], { id: "beat-01", intent: "general-flow", startSeconds: 0, endSeconds: 5, emphasis: "THE QUESTION",
    headline: "A", subhead: "B", items: ["x", "y"], itemNotes: ["n"], interactionSource: null });
  assert.equal(scenes[1].interactionSource, "rules");
});

test("the contact sheet takes one frame inside each scene and cleans up its work folder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reference-sheet-"));
  try {
    const calls = [];
    const run = async (command, args) => { calls.push(args); return { stdout: "" }; };
    const result = await writeContactSheet({ video: "/v/video.mp4", plan, output: join(dir, "sheet.png"), position: 0.5, columns: 2 }, { run });
    assert.equal(result.scenes, 2);
    const seeks = calls.filter(args => args.includes("-ss")).map(args => Number(args[args.indexOf("-ss") + 1]));
    assert.deepEqual(seeks, [2.5, 7.5]);
    assert.ok(calls.at(-1).includes("tile=2x1:padding=4"));
    await assert.rejects(writeContactSheet({ video: "/v/video.mp4", plan, output: join(dir, "sheet.png"), position: 1 }, { run }), /between 0 and 1/u);
    assert.deepEqual((await import("node:fs/promises").then(fs => fs.readdir(dir))), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a render writes a report, uses sentence rules by default and always stops the draft voice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reference-render-"));
  let closed = 0, seen;
  const deps = {
    startDraftVoiceServer: async () => ({ origin: "http://127.0.0.1:8123", engineVersion: "draft-test/1", engineId: "test", close: async () => { closed++; } }),
    findChromium: async () => "/browser",
    produceVideo: async (job, options, produceDeps) => {
      seen = { job, options, produceDeps };
      await mkdir(join(options.out, "release"), { recursive: true });
      const chapters = job.beats.map((beat, index) => ({ id: beat.id, intent: beat.visualIntent, narration: beat.narration,
        startFrame: index * 90, endFrame: (index + 1) * 90, visual: beat.visual }));
      await writeFile(join(options.out, "release", "render-manifest.json"), JSON.stringify({ plan: { kind: "general-explainer-visual-plan",
        manifest: { fps: { num: 30, den: 1 }, durationFrames: chapters.length * 90, width: 1920, height: 1080 }, chapters } }));
      return {};
    },
    writeContactSheet: async ({ output }) => ({ output, scenes: 5 }),
  };
  try {
    const { report } = await renderReference({ fixture: fixturePath.pathname, out: join(dir, "run") }, deps);
    assert.equal(seen.options.provider, "local");
    assert.equal(seen.options.providerRevision, "draft-test/1");
    assert.equal(typeof seen.produceDeps.planSceneLayouts, "function");
    assert.equal(report.layouts, "sentence-rules");
    assert.equal(report.voice.kind, "draft");
    assert.equal(report.scenes.length, 5);
    assert.equal(report.durationSeconds, 15);
    assert.ok(Array.isArray(report.findings));
    assert.deepEqual(JSON.parse(await readFile(join(dir, "run", "reference-report.json"), "utf8")).scenes, report.scenes);
    assert.equal(closed, 1);
    await assert.rejects(renderReference({ fixture: fixturePath.pathname, out: join(dir, "bad") }, { ...deps, produceVideo: async () => { throw Error("render failed"); } }), /render failed/u);
    assert.equal(closed, 2);
    await assert.rejects(renderReference({ fixture: fixturePath.pathname, out: join(dir, "x"), voiceEndpoint: "http://127.0.0.1:1" }, deps), /engine revision/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

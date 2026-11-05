#!/usr/bin/env node
/** Render a reference script through the real script → plan → job → MP4 path, then describe what the viewer sees.
 * The output is a test draft for comparing one change against the last. It is never a release.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { compileApprovedScriptDirector } from "./approved-script-director.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
import { startDraftVoiceServer } from "./draft-voice-server.mjs";
import { produceVideo } from "./produce.mjs";
import { planExplainerLayouts } from "./script-layout-plan.mjs";
import { findChromium } from "./try.mjs";
import { analyzeRenderedSceneQuality } from "./visual-quality.mjs";

const exec = promisify(execFile);

/** Compile a reference production exactly as the Studio compiles a saved script.
 * @param {{productionId:string,script:object,evidence:object[],sources:object[],storyboard?:object}} fixture
 * @param {{endpoint:string,voiceId?:string,modelId?:string}} voice
 */
export function compileReferenceJob(fixture, voice) {
  if (fixture?.kind !== "contentgen-reference-production" || fixture.schemaVersion !== 1)
    throw Error("A reference production (kind contentgen-reference-production, schemaVersion 1) is required.");
  const { dossier, bundle } = compileApprovedScriptDirector({ productionId: fixture.productionId, script: fixture.script,
    evidence: fixture.evidence, sources: fixture.sources, ...(fixture.storyboard ? { storyboard: fixture.storyboard } : {}) });
  const compiled = compilePreproductionRenderJob(dossier, bundle);
  const job = { ...compiled.job, voice: { profileId: "reference-draft-voice", provider: "local", modelId: voice.modelId ?? "draft-voice",
    voiceId: voice.voiceId ?? "default", locale: compiled.job.locale, endpoint: voice.endpoint, licenseStatus: "test-only" } };
  return { job, shotMap: compiled.shotMap, warnings: compiled.warnings };
}

/** Every piece of text a scene puts on screen, so a reviewer can read the film without playing it. */
export function screenTextReport(plan) {
  const { num, den } = plan.manifest.fps;
  const seconds = frame => Math.round(frame * den / num * 100) / 100;
  return plan.chapters.map(chapter => ({
    id: chapter.id, intent: chapter.intent, startSeconds: seconds(chapter.startFrame), endSeconds: seconds(chapter.endFrame),
    emphasis: chapter.visual?.emphasis ?? null, headline: chapter.visual?.headline ?? null, subhead: chapter.visual?.subhead ?? null,
    items: chapter.visual?.items ?? [], itemNotes: chapter.visual?.itemNotes ?? [],
    interactionSource: chapter.interactions?.source ?? null,
  }));
}

/** One frame per scene at a chosen point in the scene, tiled into a single image.
 * @param {{video:string,plan:object,output:string,position?:number,columns?:number,tileWidth?:number,ffmpeg?:string}} options
 */
export async function writeContactSheet({ video, plan, output, position = 0.7, columns = 3, tileWidth = 800, ffmpeg = "ffmpeg" }, { run = exec } = {}) {
  if (!(position >= 0 && position < 1)) throw Error("Contact sheet position must be between 0 and 1.");
  const { num, den } = plan.manifest.fps;
  const dir = await mkdtemp(join(resolve(output, ".."), ".contact-sheet-"));
  try {
    const frames = [];
    for (const [index, chapter] of plan.chapters.entries()) {
      const frame = Math.min(chapter.endFrame - 1, Math.floor(chapter.startFrame + (chapter.endFrame - chapter.startFrame) * position));
      const file = join(dir, `scene-${String(index).padStart(3, "0")}.png`);
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", String(frame * den / num), "-i", video,
        "-frames:v", "1", "-vf", `scale=${tileWidth}:-2`, file], { timeout: 120000 });
      frames.push(file);
    }
    const rows = Math.ceil(frames.length / columns);
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-framerate", "1", "-i", join(dir, "scene-%03d.png"),
      "-frames:v", "1", "-vf", `tile=${columns}x${rows}:padding=4`, output], { timeout: 120000 });
    return { output, scenes: frames.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Stretches of the finished film where the picture barely changes, from FFmpeg's freeze detector.
 * This measures pixels, so it also catches stillness the plan did not declare.
 */
export async function measureStillness(video, { ffmpeg = "ffmpeg", minSeconds = 1, noise = .004 } = {}, { run = exec } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", video, "-vf", `freezedetect=n=${noise}:d=${minSeconds},metadata=mode=print:file=-`, "-an", "-f", "null", "-"],
    { maxBuffer: 1 << 24, timeout: 600000 }).catch(error => { throw Error(`Stillness measurement failed: ${error.message}`); });
  const stretches = [...String(stderr).matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/gu)].map(match => ({ startSeconds: Number(match[1]), seconds: Number(match[2]) }));
  return { thresholdSeconds: minSeconds, stretches, longestSeconds: stretches.reduce((longest, item) => Math.max(longest, item.seconds), 0) };
}

/** Sentence rules only: the same input always gives the same layouts, with no model running. */
const rulesOnlyLayouts = (plan, options) => planExplainerLayouts(plan, { ...options,
  readModel: async () => ({ model: "rules-only", endpoint: "http://127.0.0.1:9/v1/chat/completions" }),
  inference: async () => { throw Error("The reference render uses sentence rules."); } });

/**
 * @param {{fixture:string,out:string,voiceEndpoint?:string,voiceRevision?:string,voiceEngine?:string,voice?:string,useModel?:boolean,browserExecutable?:string}} options
 */
export async function renderReference(options, deps = {}) {
  const fixture = JSON.parse(await readFile(resolve(options.fixture), "utf8"));
  const out = resolve(options.out);
  if (Boolean(options.voiceEndpoint) !== Boolean(options.voiceRevision))
    throw Error("A local TTS endpoint needs its engine revision, and the reverse.");
  const draftVoice = options.voiceEndpoint ? null
    : await (deps.startDraftVoiceServer ?? startDraftVoiceServer)({ engine: options.voiceEngine, voice: options.voice });
  try {
    const endpoint = options.voiceEndpoint ?? draftVoice.origin;
    const { job, shotMap, warnings } = compileReferenceJob(fixture, { endpoint });
    const produced = await (deps.produceVideo ?? produceVideo)(job, {
      out, provider: "local", providerRevision: options.voiceRevision ?? draftVoice.engineVersion, localEndpoint: endpoint,
      localVoiceAuthorized: true, allowTestAssets: true, storyModel: options.useModel === true, onProgress: deps.onProgress,
      browserExecutable: options.browserExecutable ?? await (deps.findChromium ?? findChromium)(),
    }, options.useModel ? {} : { planSceneLayouts: rulesOnlyLayouts });
    const release = join(out, "release");
    const manifest = JSON.parse(await readFile(join(release, "render-manifest.json"), "utf8"));
    const plan = manifest.plan;
    const quality = analyzeRenderedSceneQuality({ plan, shotMap, beats: job.beats });
    const sheet = await (deps.writeContactSheet ?? writeContactSheet)({ video: join(release, "video.mp4"), plan, output: join(out, "contact-sheet.png"), columns: 2 });
    const stillness = await (deps.measureStillness ?? measureStillness)(join(release, "video.mp4"));
    const pacing = (produced.storyReport ?? []).map(item => item.pacing).filter(Boolean);
    const report = {
      schemaVersion: 1, kind: "contentgen-reference-render-report", fixture: fixture.productionId, title: job.topic?.title ?? null,
      voice: draftVoice ? { kind: "draft", engine: draftVoice.engineId, notice: "Test-only operating-system voice. Never publish." }
        : { kind: "local-endpoint" },
      layouts: options.useModel ? "configured-model" : "sentence-rules",
      durationSeconds: plan.manifest.durationFrames * plan.manifest.fps.den / plan.manifest.fps.num,
      pacing: { stillness, longestDeclaredStillSeconds: pacing.reduce((longest, item) => Math.max(longest, item.longestStillSeconds), 0),
        stories: produced.storyReport ?? [] },
      scenes: screenTextReport(plan), findings: quality.findings, compileWarnings: warnings,
      video: join(release, "video.mp4"), contactSheet: sheet.output,
    };
    await writeFile(join(out, "reference-report.json"), JSON.stringify(report, null, 1));
    return { report, produced };
  } finally {
    await draftVoice?.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: {
    fixture: { type: "string" }, out: { type: "string" }, "voice-endpoint": { type: "string" }, "voice-revision": { type: "string" },
    "voice-engine": { type: "string" }, voice: { type: "string" }, "use-model": { type: "boolean", default: false }, chromium: { type: "string" },
  } });
  if (!values.fixture || !values.out) {
    console.error("Usage: pnpm video:reference -- --fixture <reference.json> --out <new directory> [--voice-engine say|espeak-ng|flite] [--voice <name>] [--voice-endpoint <loopback origin> --voice-revision <id>] [--use-model] [--chromium <path>]");
    process.exit(2);
  }
  await mkdir(resolve(values.out, ".."), { recursive: true });
  const { report } = await renderReference({ fixture: values.fixture, out: values.out, voiceEndpoint: values["voice-endpoint"], voiceRevision: values["voice-revision"],
    voiceEngine: values["voice-engine"], voice: values.voice, useModel: values["use-model"], browserExecutable: values.chromium },
  { onProgress: event => { if (event.phase && event.phase !== "rendering") console.log(`[${event.phase}] ${event.message ?? ""}`); } });
  console.log(JSON.stringify({ video: report.video, contactSheet: report.contactSheet, seconds: report.durationSeconds,
    longestDeclaredStillSeconds: report.pacing.longestDeclaredStillSeconds, measuredStillStretches: report.pacing.stillness.stretches.length, longestMeasuredStillSeconds: report.pacing.stillness.longestSeconds,
    findings: report.findings.map(item => `${item.severity}:${item.code}:${item.shotId}`) }, null, 1));
}

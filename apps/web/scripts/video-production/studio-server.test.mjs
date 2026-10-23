import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createStudioJob, startVideoStudio } from "./studio-server.mjs";

const fishConfig = {
  mode: "smoke", provider: "fish", voiceId: "my-licensed-reference", apiKey: "SUPER-SECRET-FISH-KEY",
  providerRevision: "fish-api-v1", voiceConsent: true, transmitText: true,
};
const localConfig = {
  mode: "long", provider: "local", voiceId: "my-voice", modelId: "installed-local-model",
  providerRevision: "local-build-1", endpoint: "http://127.0.0.1:8765", localVoiceAuthorized: true,
};
const topicConfig = { ...fishConfig, mode: "topic", draftId: "", topicLength: "smoke" };
const generic = JSON.parse((await import("node:fs")).readFileSync(new URL("../../../../examples/video-production-general-smoke.json", import.meta.url), "utf8"));

async function harness(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "contentgen-studio-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const counts = { build: 0, inspect: 0, produce: 0 };
  const calls = [];
  const studio = await startVideoStudio({
    port: 0,
    outputRoot: root,
    build: async () => { counts.build++; },
    findBrowser: async () => "/usr/bin/mock-browser",
    inspect: async (job, options) => {
      counts.inspect++;
      calls.push({ kind: "inspect", job, options });
      return { ready: true, findings: [], provider: options.provider, tools: { browser: { available: true } } };
    },
    produce: async (job, options) => {
      counts.produce++;
      calls.push({ kind: "produce", job, options });
      options.onProgress?.({ phase: "rendering", completedFrames: 150, totalFrames: 300 });
      const releaseDir = join(options.out, "release");
      await mkdir(join(releaseDir, "stills"), { recursive: true });
      await writeFile(join(releaseDir, "video.mp4"), "0123456789abcdef");
      await writeFile(join(releaseDir, "master.wav"), "wave");
      await writeFile(join(releaseDir, "voice.wav"), "speech");
      await writeFile(join(releaseDir, "captions.srt"), "captions");
      await writeFile(join(releaseDir, "qa-report.json"), JSON.stringify({ technicalPass: true, commercialReady: false }));
      await writeFile(join(releaseDir, "render-manifest.json"), "{}");
      await writeFile(join(releaseDir, "stills", "frame-000000.png"), "fake-png");
      return { releaseDir, videoPath: join(releaseDir, "video.mp4"), qa: { technicalPass: true, commercialReady: false } };
    },
    ...overrides,
  });
  t.after(() => studio.close());
  const send = (path, method = "GET", body, headers = {}) => fetch(`${studio.url}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "X-ContentGen-Studio-Token": studio.token }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...studio, root, counts, calls, send };
}

async function until(studio, predicate) {
  for (let i = 0; i < 100; i++) {
    const state = await (await studio.send("/api/status")).json();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("studio state did not settle");
}

test("fixture selection changes the validated job duration and provider without mutating checked-in examples", () => {
  const smoke = createStudioJob(fishConfig);
  const long = createStudioJob(localConfig);
  assert.equal(smoke.mode, "smoke");
  assert.equal(smoke.voice.modelId, "s2.1-pro-free");
  assert.equal(smoke.voice.voiceId, "my-licensed-reference");
  assert.equal(long.mode, "youtube-long");
  assert.equal(long.destination.minimumDurationSeconds, 480);
  assert.equal(long.voice.provider, "local");
  assert.equal(long.voice.endpoint, "http://127.0.0.1:8765");
  assert.equal(JSON.stringify(long).includes("SUPER-SECRET-FISH-KEY"), false);
});

test("custom topic generation creates an unverified source job, then readiness and render use precisely that draft", async (t) => {
  const studio = await harness(t, { generateTopic: async (input) => ({ schemaVersion: 1, kind: "topic-video-draft", editorialStatus: "unverified-draft",
    packaging: [{ strategy: "mechanism", title: "How Messages Travel", thumbnail: "network", hook: "route" }],
    job: { ...structuredClone(generic), id: "topic-generated-001", topic: { ...generic.topic, title: input.topic } } }) });
  const generated = await studio.send("/api/topic", "POST", { topic: "How messages move", viewerQuestion: "Where do they go?", audience: "beginners",
    notes: "No trusted references supplied", locale: "en-US", mode: "smoke", endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "my-local-model" });
  assert.equal(generated.status, 200);
  const draft = (await generated.json()).draft;
  assert.equal(draft.job.topic.title, "How messages move");
  assert.equal(draft.job.policy.commercialRightsVerified, false);
  const config = { ...topicConfig, draftId: draft.job.id };
  assert.equal((await studio.send("/api/preflight", "POST", config)).status, 200);
  assert.equal((await studio.send("/api/render", "POST", { ...config, confirmRender: true })).status, 202);
  const final = await until(studio, (s) => s.status === "completed");
  assert.equal(studio.calls.at(-1).job.topic.title, "How messages move");
  assert.equal(studio.calls.at(-1).job.visualFamily, "general-explainer-v1");
  assert.equal(final.qa.commercialReady, false);
});

test("a human storyboard produces a general video draft and follows the existing consent pipeline", async (t) => {
  const studio = await harness(t);
  const scenes = [
    { headline: "Heat is moving", narration: "A heat pump moves thermal energy between two places rather than producing all of it from electricity.", items: ["Outdoor air", "Indoor air"] },
    { headline: "How refrigerant travels", narration: "The compressor and coils exchange thermal energy as the refrigerant moves through the closed loop.", intent: "general-flow", items: ["Evaporator", "Compressor", "Condenser"] },
    { headline: "Follow the energy", narration: "Heat gets moved by refrigerant and electrical work, but actual efficiency depends on the surrounding conditions.", items: ["Electrical input", "Transported energy"] },
  ];
  const input = { title: "How heat pumps move energy", viewerQuestion: "Where does the heat come from?",
    audience: "Homeowners", locale: "en-US", length: "smoke", hookStrategy: "action-first",
    typographyStyle: "snap", scenes };
  const draftResponse = await studio.send("/api/manual", "POST", input);
  assert.equal(draftResponse.status, 200);
  const { draft } = await draftResponse.json();
  assert.equal(draft.generator.provider, "human");
  assert.equal(draft.job.beats.length, 3);
  assert.equal(draft.job.beats[0].visual.hookStrategy, "action-first");
  assert.equal(draft.job.claims[0].status, "unverified");
  assert.equal(studio.counts.produce, 0);
  const config = { ...fishConfig, mode: "manual", draftId: draft.job.id };
  assert.equal((await studio.send("/api/preflight", "POST", config)).status, 200);
  assert.equal((await studio.send("/api/render", "POST", { ...config, confirmRender: true })).status, 202);
  const done = await until(studio, state => state.status === "completed");
  assert.equal(done.qa.commercialReady, false);
  assert.equal(studio.calls.at(-1).job.topic.title, input.title);
});

test("invalid human scenes cannot replace an existing checked storyboard", async (t) => {
  const studio = await harness(t);
  const broken = await studio.send("/api/manual", "POST", {
    title: "Empty film", scenes: [{ headline: "Only one scene", narration: "Not enough scenes", items: ["A", "B"] }],
  });
  assert.equal(broken.status, 400);
  assert.equal((await studio.send("/api/draft")).status, 200);
  const draft = await (await studio.send("/api/draft")).json();
  assert.equal(draft.draft, null);
  assert.equal(studio.counts.produce, 0);
});

test("topic edits reject forged approval and invalidate preflight before reuse", async (t) => {
  const studio = await harness(t, { generateTopic: async () => ({ kind: "topic-video-draft", editorialStatus: "unverified-draft", packaging: [], job: structuredClone(generic) }) });
  await studio.send("/api/topic", "POST", { topic: "Networks", audience: "students", mode: "smoke", locale: "en-US",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "my-local-model" });
  const config = { ...topicConfig, draftId: generic.id };
  await studio.send("/api/preflight", "POST", config);
  const blocked = await studio.send("/api/draft", "POST", { job: { ...generic, approval: "approved" } });
  assert.equal(blocked.status, 400);
  assert.equal((await studio.send("/api/draft", "POST", { job: { ...generic, topic: { ...generic.topic, title: "Edited network topic" } } })).status, 200);
  assert.equal((await studio.send("/api/render", "POST", { ...config, confirmRender: true })).status, 409);
});

test("preflight is side-effect-free for Fish TTS, reports actual findings, and keeps the key out of status", async (t) => {
  const studio = await harness(t);
  const response = await studio.send("/api/preflight", "POST", fishConfig);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ready, true);
  assert.equal(studio.counts.build, 1);
  assert.equal(studio.counts.inspect, 1);
  assert.equal(studio.counts.produce, 0);
  assert.equal(studio.calls[0].options.env.FISH_AUDIO_API_KEY, fishConfig.apiKey);
  const state = await (await studio.send("/api/status")).text();
  assert.equal(state.includes(fishConfig.apiKey), false);
  assert.equal(state.includes("ready"), true);
});

test("render is blocked before preflight and after voice changes; explicit confirmed matching render returns real artifact links", async (t) => {
  const studio = await harness(t);
  assert.equal((await studio.send("/api/render", "POST", { ...fishConfig, confirmRender: true })).status, 409);
  await studio.send("/api/preflight", "POST", fishConfig);
  assert.equal((await studio.send("/api/render", "POST", { ...fishConfig, voiceId: "different", confirmRender: true })).status, 409);
  assert.equal((await studio.send("/api/render", "POST", { ...fishConfig, apiKey: "different-key", confirmRender: true })).status, 409);
  assert.equal((await studio.send("/api/render", "POST", fishConfig)).status, 400);
  const response = await studio.send("/api/render", "POST", { ...fishConfig, confirmRender: true });
  assert.equal(response.status, 202);
  const result = await until(studio, (state) => state.status === "completed");
  assert.equal(result.progress.completedFrames, 150);
  assert.equal(result.artifacts.stills.length, 1);
  assert.match(result.artifacts.video, /\/artifact\//);
  assert.equal(result.qa.technicalPass, true);
  assert.equal(result.qa.commercialReady, false);
  assert.equal(studio.counts.produce, 1);
  const saved = JSON.parse(await readFile(join(result.outputDir, "job.json"), "utf8"));
  assert.equal(saved.voice.voiceId, fishConfig.voiceId);
  assert.equal(JSON.stringify(saved).includes(fishConfig.apiKey), false);
  assert.equal(JSON.stringify(studio.calls[1].options).includes(fishConfig.apiKey), true);
});

test("readiness failure exposes concrete findings without starting a render", async (t) => {
  const studio = await harness(t, { inspect: async () => ({ ready: false,
    findings: [{ severity: "error", code: "tool-unavailable", message: "ffmpeg is missing" }] }) });
  const response = await studio.send("/api/preflight", "POST", fishConfig);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ready, false);
  const state = await (await studio.send("/api/status")).json();
  assert.equal(state.status, "blocked");
  assert.match(state.findings[0].message, /ffmpeg/i);
  assert.equal((await studio.send("/api/render", "POST", { ...fishConfig, confirmRender: true })).status, 409);
  assert.equal(studio.counts.produce, 0);
});

test("worker errors redact any provider key and never expose incomplete media", async (t) => {
  const studio = await harness(t, { produce: async () => { throw new Error(`Provider failed: ${fishConfig.apiKey}`); } });
  await studio.send("/api/preflight", "POST", fishConfig);
  await studio.send("/api/render", "POST", { ...fishConfig, confirmRender: true });
  const state = await until(studio, (s) => s.status === "failed");
  assert.match(state.message, /\[redacted\]/);
  assert.equal(JSON.stringify(state).includes(fishConfig.apiKey), false);
  assert.equal(state.artifacts, null);
});

test("studio reports bounded Fish request diagnostics without secrets or worker payloads", async (t) => {
  const studio = await harness(t, { produce: async (_job, options) => {
    for (let i = 0; i < 35; i++) options.onProgress({
      kind: "fish-diagnostic", event: i === 34 ? "failure" : "response",
      attempt: 1, maxAttempts: 3, beatId: "beat-1", model: "s2.1-pro-free",
      requestedFormat: "pcm", sampleRate: 44100,
      httpStatus: 200, contentType: "audio/pcm", receivedBytes: 4400 + i,
      declaredBytes: 9000, elapsedMs: 18, audioSignature: "unrecognized-or-raw-PCM",
      requestId: i === 34 ? "req-test-35" : fishConfig.apiKey,
      text: "SHOULD-NOT-APPEAR", apiKey: fishConfig.apiKey,
    });
    throw new Error("Fish returned invalid PCM from the stream");
  } });
  await studio.send("/api/preflight", "POST", fishConfig);
  await studio.send("/api/render", "POST", { ...fishConfig, confirmRender: true });
  const state = await until(studio, (s) => s.status === "failed");
  assert.equal(state.fishDiagnostics.length, 32);
  assert.equal(state.fishDiagnostics.at(-1).event, "failure");
  assert.equal(state.fishDiagnostics.at(-1).requestId, "req-test-35");
  assert.equal(state.fishDiagnostics[0].requestId, undefined);
  assert.equal(state.fishDiagnostics.at(-1).receivedBytes, 4434);
  assert.equal(state.artifacts, null);
  const report = JSON.stringify(state);
  assert.equal(report.includes(fishConfig.apiKey), false);
  assert.equal(report.includes("SHOULD-NOT-APPEAR"), false);
  assert.equal(report.includes("apiKey"), false);
});

test("studio renders provider diagnostics using text content, not HTML", async (t) => {
  const dom = await localStudioPage(t);
  dom.window.__diagnosticFixture = { status: "failed", phase: "failed",
    message: "Fish returned an invalid PCM response.",
    fishDiagnostics: [{ event: "failure", requestId: "<img src=x onerror=alert(1)>",
      contentType: "audio/pcm", receivedBytes: 512 }] };
  dom.window.eval("showStatus(window.__diagnosticFixture)");
  const details = dom.window.document.getElementById("fish-diagnostics");
  assert.equal(details.hidden, false);
  assert.equal(details.open, true);
  assert.match(dom.window.document.getElementById("fish-diagnostics-text").textContent, /receivedBytes/);
  assert.equal(dom.window.document.querySelector("#fish-diagnostics img"), null);
});

test("local voice setup requires loopback and explicit authorization", async (t) => {
  const studio = await harness(t);
  assert.equal((await studio.send("/api/preflight", "POST", { ...localConfig, endpoint: "https://remote.example" })).status, 400);
  assert.equal((await studio.send("/api/preflight", "POST", { ...localConfig, localVoiceAuthorized: false })).status, 400);
  const response = await studio.send("/api/preflight", "POST", localConfig);
  assert.equal((await response.json()).ready, true);
  assert.equal(studio.calls.at(-1).job.voice.modelId, localConfig.modelId);
});

test("mutations require token and same origin; no wildcard CORS or echoing credentials", async (t) => {
  const studio = await harness(t);
  assert.equal((await fetch(`${studio.url}/api/preflight`, { method: "POST", body: JSON.stringify(fishConfig), headers: { "Content-Type": "application/json" } })).status, 403);
  assert.equal((await studio.send("/api/preflight", "POST", fishConfig, { Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await studio.send("/api/preflight", "POST", fishConfig, { Origin: studio.url })).status, 200);
  assert.equal((await studio.send("/api/preflight", "POST", { ...fishConfig, apiKey: "A".repeat(1024 * 1024 + 1) })).status, 413);
  const invalid = await (await studio.send("/api/status")).text();
  assert.equal(invalid.includes(fishConfig.apiKey), false);
});

test("artifact serving uses an allowlist and supports byte-range video playback", async (t) => {
  const studio = await harness(t);
  await studio.send("/api/preflight", "POST", fishConfig);
  await studio.send("/api/render", "POST", { ...fishConfig, confirmRender: true });
  const done = await until(studio, (s) => s.status === "completed");
  assert.equal((await studio.send(done.artifacts.video)).status, 200);
  const partial = await studio.send(done.artifacts.video, "GET", undefined, { Range: "bytes=2-5" });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/16");
  assert.equal(await partial.text(), "2345");
  assert.equal((await studio.send("/artifact/bad-token/video.mp4")).status, 403);
  assert.equal((await studio.send(`/artifact/${studio.token}/../../package.json`)).status, 404);
  assert.equal((await studio.send(`/artifact/${studio.token}/private.txt`)).status, 404);
});

test("cancel interrupts only the current render, does not fabricate a completed release", async (t) => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const studio = await harness(t, { produce: async (_job, options) => {
    entered();
    await new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("cancelled by user")), { once: true });
    });
  } });
  await studio.send("/api/preflight", "POST", localConfig);
  assert.equal((await studio.send("/api/render", "POST", { ...localConfig, confirmRender: true })).status, 202);
  await started;
  assert.equal((await studio.send("/api/render", "POST", { ...localConfig, confirmRender: true })).status, 409);
  assert.equal((await studio.send("/api/cancel", "POST", {})).status, 202);
  const state = await until(studio, (s) => s.status === "cancelled");
  assert.equal(state.artifacts, null);
  assert.equal(state.qa, null);
});

test("serves an interactive accessible frontend with local-only script and styling", async (t) => {
  const studio = await harness(t);
  const html = await (await studio.send("/")).text();
  assert.match(html, /Video Test Studio/);
  assert.match(html, /Check readiness/);
  assert.match(html, /Render test video/);
  assert.match(html, /type="password"/);
  assert.match(html, /id="topic-locale"/);
  assert.match(html, /value="ja-JP"/);
  assert.match(html, /studio-token/);
  const js = await studio.send("/studio.js");
  assert.equal(js.status, 200);
  const client = await js.text();
  assert.match(client, /\/api\/preflight/);
  assert.match(client, /\$\("topic-locale"\)\.value/);
  assert.equal((await studio.send("/studio.css")).status, 200);
});

async function localStudioPage(t) {
  const html = await readFile(new URL("./studio-ui/index.html", import.meta.url), "utf8");
  const client = await readFile(new URL("./studio-ui/app.js", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ status: "idle", message: "Idle" }) });
  dom.window.setInterval = () => 0;
  dom.window.eval(client);
  dom.window.document.querySelector('input[name="mode"][value="topic"]').checked = true;
  return dom;
}

test("Studio manual scene cards can be reordered and duplicated without changing bookend roles", async (t) => {
  const dom = await localStudioPage(t);
  const d = dom.window.document;
  const make = (name, intent = "general-flow") => ({
    headline: name, narration: "A narrated explanation of how one component connects to another during the process.",
    subhead: "Each frame shows the next step.", intent, items: ["Start", "Finish"],
  });
  const story = {
    kind: "contentgen-manual-storyboard", schemaVersion: 1,
    title: "How a message travels", viewerQuestion: "Where does it go?", audience: "Learners",
    length: "smoke", platform: "youtube-shorts", locale: "en-US",
    hookStrategy: "unexpected-reveal", typographyStyle: "wipe",
    scenes: [make("Opening"), make("Connection A"), make("Connection B"), make("Conclusion")],
  };
  dom.window.__storyForTest = story;
  dom.window.eval("applyImportedStory(window.__storyForTest)");
  const cards = () => [...d.querySelectorAll("#manual-scenes .manual-scene")];
  const names = () => cards().map(el => el.querySelector(".manual-headline").value);
  assert.deepEqual(names(), ["Opening", "Connection A", "Connection B", "Conclusion"]);
  assert.equal(cards()[0].querySelector(".manual-up-button").hidden, true);
  assert.equal(cards().at(-1).querySelector(".manual-duplicate-button").hidden, true);
  cards()[2].querySelector(".manual-up-button").click();
  assert.deepEqual(names(), ["Opening", "Connection B", "Connection A", "Conclusion"]);
  cards()[1].querySelector(".manual-duplicate-button").click();
  assert.deepEqual(names(), ["Opening", "Connection B", "Connection B", "Connection A", "Conclusion"]);
  cards()[2].querySelector(".manual-remove-button").click();
  assert.deepEqual(names(), ["Opening", "Connection B", "Connection A", "Conclusion"]);
  assert.equal(d.getElementById("manual-platform").value, "youtube-shorts");
  assert.equal(d.querySelector('input[name="mode"][value="manual"]').checked, true);
  assert.equal(d.getElementById("render-button").disabled, true);
});

test("portable Studio storyboard JSON is content-only, supports incomplete drafts and imports atomically", async (t) => {
  const dom = await localStudioPage(t);
  const d = dom.window.document;
  d.getElementById("fish-key").value = "DO-NOT-EXPORT-ME";
  d.getElementById("voice-id").value = "PRIVATE-VOICE-ID";
  d.getElementById("manual-title").value = "Work in progress";
  const json = dom.window.eval('JSON.stringify({ kind: STORY_KIND, schemaVersion: 1, ...validateImportedStory({ kind: STORY_KIND, schemaVersion: 1, ...manualInput() }) })');
  const story = JSON.parse(json);
  assert.equal(story.scenes.length, 3);
  assert.equal(story.scenes[0].narration, "");
  assert.equal(json.includes("DO-NOT-EXPORT-ME"), false);
  assert.equal(json.includes("PRIVATE-VOICE-ID"), false);
  assert.equal(json.includes("apiKey"), false);
  assert.equal(json.includes("voiceId"), false);
  dom.window.__storyForTest = story;
  dom.window.eval("applyImportedStory(window.__storyForTest)");
  assert.equal(d.getElementById("manual-title").value, "Work in progress");
  assert.equal(d.getElementById("fish-key").value, "DO-NOT-EXPORT-ME");
  assert.equal(d.getElementById("voice-id").value, "PRIVATE-VOICE-ID");

  dom.window.__storyForTest = { ...story, scenes: [...story.scenes] };
  dom.window.__storyForTest.scenes[1] = { ...story.scenes[1], headline: "<img src=x onerror=alert(1)>" };
  dom.window.eval("applyImportedStory(window.__storyForTest)");
  assert.equal(d.querySelectorAll("#manual-scenes img").length, 0);
  assert.equal(d.querySelectorAll("#manual-scenes .manual-headline")[1].value, "<img src=x onerror=alert(1)>");

  dom.window.__storyForTest = { ...story, voiceId: "malicious-secret" };
  assert.throws(() => dom.window.eval("applyImportedStory(window.__storyForTest)"), /Unknown storyboard field/);
  assert.equal(d.getElementById("manual-title").value, "Work in progress");
  assert.equal(d.querySelectorAll("#manual-scenes .manual-headline")[1].value, "<img src=x onerror=alert(1)>");
});
test("generated topic claims show declared statuses, source provenance and clear unsourced warnings safely", async (t) => {
  const dom = await localStudioPage(t);
  const draft = { job: { id: "topic-claim-review", topic: { title: "Heat pumps" }, beats: [{ id: "beat-01" }],
    claims: [
      { id: "c1", status: "verified", text: "<img src=x onerror=alert(1)> Heat moves.", sourceRefs: ["src-1"] },
      { id: "c2", status: "unverified", text: "No source attached" },
      { id: "c3", status: "illustrative", text: "Diagram is schematic" },
      { id: "c4", status: "disputed", text: "The estimate is contested", sourceRefs: ["missing-source"] },
    ], evidence: [{ id: "src-1", title: "<script>Source title</script>",
      passageLocator: "Section 2, paragraph 3", sourceUri: "https://example.org/report" }] } };
  dom.window.__testDraft = draft;
  dom.window.eval("showDraft(window.__testDraft)");
  const document = dom.window.document;
  assert.equal(document.getElementById("topic-review").hidden, false);
  assert.deepEqual([...document.querySelectorAll(".draft-claim")].map((row) => row.dataset.status),
    ["verified", "unverified", "illustrative", "disputed"]);
  const summary = document.getElementById("draft-claims").textContent;
  for (const label of ["Verified (declared)", "Unverified", "Illustrative", "Disputed",
    "src-1", "<script>Source title</script>", "Section 2, paragraph 3", "https://example.org/report",
    "No source linked", "missing-source", "Human review required"]) assert.ok(summary.includes(label), label);
  assert.equal(document.querySelector("#draft-claims img, #draft-claims script"), null);
  assert.match(document.getElementById("draft-json").value, /"claims"/);
});

test("generated topic claims review explains an empty claim registry", async (t) => {
  const dom = await localStudioPage(t);
  dom.window.__testDraft = { job: { id: "empty-claims", topic: { title: "Topic" }, beats: [], claims: [] } };
  dom.window.eval("showDraft(window.__testDraft)");
  assert.match(dom.window.document.getElementById("draft-claims").textContent, /No claims declared/);
  assert.match(dom.window.document.getElementById("draft-claims").textContent, /Human review required/);
});

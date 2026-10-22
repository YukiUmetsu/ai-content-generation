# Headless Video Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From one validated ContentGen job, automatically synthesize narration using Fish Audio or an explicitly configured local TTS service, synchronize visuals/SFX/captions, and produce a reviewed, bounded-resource, **8+-minute 16:9 YouTube MP4** without a UI or imported narration file.

**Architecture:** Add a dependency-light Node ESM worker and CLI to the existing `apps/web` workspace, leaving Rust domain/job ownership unchanged until the headless path is proven. Use a versioned job, per-beat synthesis/cache, sample-domain timeline, FFmpeg audio processing, pinned Kumiki `VideoExportStage` rendered in a local-only browser, and incremental frame-chunk encoding. A short fixture proves each connection cheaply; the full 8+-minute episode is the product acceptance gate.

**Tech Stack:** Node >=22.12, native `node:test`, React 19/Vite 8/TypeScript 5.9, vendored Kumiki, Playwright Core with an already installed Chromium-compatible browser, FFmpeg/FFprobe, Fish Audio HTTP API, SHA-256, 48 kHz PCM WAV, 1920×1080 at 30/1 fps. Prefer built-in Node APIs; do not install a browser/model without approval.

**Spec:** [`docs/superpowers/specs/2026-10-22-headless-video-production-design.md`](../specs/2026-10-22-headless-video-production-design.md).

## Global Constraints

- Respect repository `AGENTS.md`, `docs/INDEX.md`, `docs/13-audio-production.md`, `docs/14-kumiki-integration.md`; preserve existing feature/Storyboard Planner work. One independently tested slice and one focused commit per task.
- CLI must be useful without the GUI. Proposed command: `cd apps/web && pnpm video:produce -- --job ../../examples/video-production-house-math-long.json --provider fish --allow-network --out ../../outputs/house-math`.
- Remote requests require explicit `--allow-network`, `FISH_AUDIO_API_KEY` supplied at runtime and a separately approved model/cost budget. `--dry-run` makes **no network/model call**. Never log credentials, voice samples or full provider responses.
- The first real-provider release may use **either** Fish or a functioning configured local engine; tests must mock both. There is no imported-WAV-only success or silent provider/model substitution.
- Fish evaluation uses the documented `/v1/tts` endpoint and configured voice reference; treat `s2.1-pro-free` as an opt-in **evaluation** choice subject to current availability and rights checks. Free pricing does not prove commercial rights.
- Long-form acceptance: **at least 480 seconds measured finished runtime**, editorially aim for 540–900 seconds without padding. A 30–60-second run is a smoke test **only**. First production profile is YouTube `16:9`, `1920×1080`, `30/1` FPS; keep destination duration target metadata separately from platform hard limits.
- Use one canonical sample-domain timeline at **48,000 samples/sec** and rational frame conversion; segment-level captions only unless measured word alignment is available. Required stable event: `lifetime-total-reveal`.
- No concurrent accumulation of the entire long-form film as PNGs. Limit each capture batch to **at most 150 frames (5 seconds at 30 fps)**, probe/commit a verified encoded segment, then reclaim **only that job's** PNGs. Track peak scratch bytes, memory, tool versions and failures.
- Fail closed on unknown commercial rights, unsupported visual intent, corrupted/missing audio, bad frame seek, missing payoff, absent browser/FFmpeg and unreviewed release. The initial fictional house-cost fixture must be unmistakably **illustrative/test-only**.
- Do not download >250 MB, invoke paid models, publish a video, install a model, use real voice cloning, merge PRs or modify an unrelated repo without separate approval. Actual listening/playback review cannot be marked automatic PASS.

## Review Focus

1. **Remote denial and partial bytes:** a Fish 401/402/429/5xx, timeout or truncated body must produce a typed actionable error; never cache corrupt speech or leak a token (Task 2).
2. **Local endpoint safety:** a configured local TTS address using anything other than loopback or redirecting off loopback must fail without making a request (Task 3).
3. **Sample-to-frame boundaries:** silent gaps and fractional frame positions must neither overlap speech/captions nor shift a named SFX event (Task 4).
4. **Interrupted long capture:** a failed frame, FFmpeg crash or Ctrl-C must retain only validated segments; never publish an incomplete MP4 or delete unrelated directories (Tasks 7–8).
5. **Misleading approvals:** a test-only script, unverified claims, unknown voice/music license or <480-second final film must never gain `commercialReady: true` (Tasks 1 and 8).

## File Map and Interface Boundaries

| File(s) | Responsibility |
| --- | --- |
| `apps/web/scripts/video-production/job.mjs`, `job.test.mjs` | Versioned job parsing, policy/duration/rights/reference validation, typed findings |
| `apps/web/scripts/video-production/cli.mjs`, `cli.test.mjs` | Flags, dry-run, executable plan, progress/cancellation, final atomic publication |
| `apps/web/scripts/video-production/fish.mjs`, `fish.test.mjs` | Fish-specific HTTP synthesis and safe error handling |
| `apps/web/scripts/video-production/local.mjs`, `local.test.mjs` | Controlled loopback TTS bridge; engine may be unavailable until installed |
| `apps/web/scripts/video-production/speech.mjs`, `speech.test.mjs` | Provider-neutral per-beat speech/cache, format probing/normalization |
| `apps/web/scripts/video-production/timeline.mjs`, `timeline.test.mjs` | Exact sample offsets, event-to-frame mapping and SRT generation |
| `apps/web/scripts/video-production/audio.mjs`, `audio.test.mjs` | FFmpeg mastering, licensed/synthetic SFX cue, audio QA |
| `apps/web/video-export.html`, `apps/web/src/video-export/{main,house-math-scene}.tsx`, `house-math-scene.test.tsx` | Dedicated local-only export page; meaningful frame-addressed scene and stage contract |
| `apps/web/scripts/video-production/{stage-server,render}.mjs`, `render.test.mjs` | Static built page + per-job data server; browser seek, bounded PNG batch → verified video segments |
| `apps/web/scripts/video-production/report.mjs`, `report.test.mjs` | Hashes, FFprobe diagnostics, resource/rights QA, immutable release manifest |
| `examples/video-production-house-math-{smoke,long}.json` | Two documented, synthetic, independently valid narrative fixtures |
| `apps/web/{package.json,pnpm-lock.yaml,vite.config.ts}`, `apps/web/README.md` | CLI script, pinned optional browser driver, multi-page build, invocation/prerequisites |

Runtime worker modules are `.mjs` so the existing Node version can execute them without another transpiler. Use JSDoc typedefs and strict runtime validation at the boundary. Browser scene modules remain TypeScript and use the existing Vite/Vitest configuration. No changes to `src/components/video/video-export-stage.tsx` or vendored Kumiki files are expected unless a verified integration defect requires one.

## Tasks

### Task 1: Validate one video job and implement no-network dry-run

**Files:** Create `scripts/video-production/job.mjs`, `job.test.mjs`, `cli.mjs`, `cli.test.mjs`, and smoke JSON fixture; update `package.json` for `video:produce`.

**Interfaces:**
- `parseVideoProductionJob(value: unknown): {ok:true,job:VideoProductionJob,findings:Finding[]} | {ok:false,findings:Finding[]}`. Enforce `schemaVersion:1`, `kind:'video-production-job'`, unique beat IDs, named events, voice profile, locale, reference status, `youtube` preset, `fps`, rights metadata, `durationPolicy:{minSeconds:480,targetSeconds:[540,900]}` for long mode and `mode:'smoke'|'youtube-long'`.
- `parseCliArgs(argv:string[]):CliOptions`; `inspectProduction(job,options):Promise<PreflightReport>` reads local tools/config without synthesizing or rendering. When `--dry-run`, report network/cost/voice/rights and command prerequisites; exit nonzero for invalid schema.

- [ ] **Step 1 — Write red tests:** `job.test.mjs` asserts one valid smoke fixture passes; a duplicate beat ID, missing `lifetime-total-reveal`, unknown schema, invalid duration tuple, missing provider identity and unverified rights marked commercial all fail. `cli.test.mjs` stubs process I/O and asserts `--dry-run` performs zero fetches/subprocess rendering and redacts keys.
- [ ] **Step 2 — Run to confirm RED:** `cd apps/web && node --test scripts/video-production/{job,cli}.test.mjs`; expect missing exports/tests to fail.
- [ ] **Step 3 — Implement minimal validators/CLI:** actual input shape is authoritative; reject unknown critical fields, distinguish `approval:'test-only'|'approved'`; no mutation of `EpisodeDraft` v1. Reuse `video` preset dimensions from `src/components/video/platform-presets.json`; **do not change its universal `minSeconds`**.
- [ ] **Step 4 — Confirm GREEN and commit:** same `node --test` plus `pnpm lint && pnpm typecheck`; commit `feat(video): validate headless jobs and dry-run`.

### Task 2: Generate actual Fish Audio narration safely

**Files:** Create `fish.mjs`, `fish.test.mjs`; document `FISH_AUDIO_API_KEY` in `apps/web/README.md` without adding secrets.

**Interfaces:** `synthesizeFishBeat({text,locale,voiceId,modelId,direction,allowNetwork,rightsContext},{fetchImpl,apiKey,signal}):Promise<{audio:Uint8Array,provider:'fish',modelId:string,voiceId:string,encoding:'wav',usage?:object}>`.

- [ ] **Step 1 — Write red tests:** local fake fetch receives documented `POST https://api.fish.audio/v1/tts` headers/body; refusal without `allowNetwork`/API key; 401, 402 and license denial not retried; 429/5xx retry at most twice with bounded backoff; invalid content-type, oversize response, timeout, partial audio, and redacted errors. Never access a live provider during CI.
- [ ] **Step 2 — RED:** `node --test scripts/video-production/fish.test.mjs`.
- [ ] **Step 3 — Implement:** verify current Fish request/response format against linked official API docs before coding; explicitly select configured model (initial evaluation `s2.1-pro-free` if available) and voice; never infer commercial rights from price or silently fall back to a paid model.
- [ ] **Step 4 — GREEN and commit:** same test, `pnpm lint && pnpm typecheck`; commit `feat(video): add opt-in Fish narration adapter`. With a separately authorized key, do one sample request and document true provider/terms; otherwise record real integration as **UNVERIFIED**, not PASS.

### Task 3: Add a local TTS alternative without automatic installs

**Files:** Create `local.mjs`, `local.test.mjs`; add bridge contract to `apps/web/README.md`.

**Interfaces:** `synthesizeLocalBeat({text,locale,voiceId,modelId,direction,endpoint,rightsContext},{fetchImpl,signal}):Promise<{audio:Uint8Array,provider:'local',modelId:string,voiceId:string,encoding:'wav',engineVersion:string}>`. Own the bridge protocol: `POST /v1/speech` JSON with exact text/locale/voice/model; return WAV bytes and `X-TTS-Engine-Version`; the bridge must be explicitly configured and served on `127.0.0.1`, `::1` or `localhost`.

- [ ] **Step 1 — Write red tests:** mock bridge returns WAV/version; non-loopback, unexpected 30x redirect, absent engine/model/version, malformed WAV, refused connection and timeout all fail with setup/safety errors. No model download or auto-fallback to Fish.
- [ ] **Step 2 — RED:** `node --test scripts/video-production/local.test.mjs`.
- [ ] **Step 3 — Implement:** request handler with strict URL/redirect policy, explicit capability identity and bounded bytes. Local model implementation (e.g. a user-installed Qwen3-TTS-MLX bridge) is **not claimed available** until its actual installed interface is probed and an opt-in audible sample passes.
- [ ] **Step 4 — GREEN and commit:** same test, `pnpm typecheck`; commit `feat(video): accept configured loopback TTS`. One real working provider—Fish **or** local—is required for the final acceptance, not both.

### Task 4: Cache narration per beat and compile an exact timeline

**Files:** Create `speech.mjs`, `speech.test.mjs`, `timeline.mjs`, `timeline.test.mjs`.

**Interfaces:**
- `synthesizeNarration(job,{provider,cacheRoot,ffmpeg,ffprobe,signal}):Promise<BeatAudio[]>`, where `BeatAudio` includes ID, normalized 48 kHz WAV path, measured `samples`, provider/version, SHA-256 and license.
- `buildSampleTimeline(beats:BeatAudio[],pauses:PauseSpec[],fps:{num:number,den:number}):Timeline` with half-open `[startSample,endSample)` ranges, monotonic beat offsets, `eventSamples` and `eventFrames`; `toFrame(sample,fps)` rounds once via `Math.round(sample * fps.num / (48000 * fps.den))`.
- `writeSrt(timeline,beatTexts):string` uses segment boundaries and excludes intentional silence.

- [ ] **Step 1 — Red tests:** mocked WAVs with known sample counts show exact offsets and SRT; changing one beat changes only its cache key/dependents; cache hit makes zero provider calls; orphan events, zero-length speech, corrupted FFprobe output, negative/overlapping intervals, fractional frame boundaries and silent gaps fail precisely.
- [ ] **Step 2 — RED:** `node --test scripts/video-production/{speech,timeline}.test.mjs`.
- [ ] **Step 3 — Implement:** SHA-256 cache key includes normalized text, locale, provider/model/version/voice, direction/prosody, encoding and consent/rights scope. Probe real samples via FFprobe, convert with FFmpeg argument arrays; no predicted reading speed or fake word-level alignment.
- [ ] **Step 4 — GREEN and commit:** same test plus an FFmpeg-enabled synthetic WAV test when installed; commit `feat(video): cache measured speech and compile sample timeline`.

### Task 5: Mix semantic sound and generate synchronized captions

**Files:** Create `audio.mjs`, `audio.test.mjs`; reuse `timeline.mjs` and the existing `examples/audio-production-job.json` only as a conceptual reference.

**Interfaces:** `renderMasterAudio({timeline,beats,sfx:{eventId,assetPath,license},music?},{ffmpeg,ffprobe,outputDir,signal}):Promise<{wavPath,srtText,samples,loudness,peak,stems,findings}>`.

- [ ] **Step 1 — Red tests:** `lifetime-total-reveal` cue starts at the correct sample; a deliberately shifted/orphan cue, clipped peak, mismatched duration, missing rights, unexpected full silence and invalid sample rate fail. A seeded, self-authored reveal chime is fixture-only; do not label third-party stock as CC0 without checking.
- [ ] **Step 2 — RED:** `node --test scripts/video-production/audio.test.mjs`.
- [ ] **Step 3 — Implement:** concatenate generated 48 kHz speech with declared pauses; mix event-timed cue and optional rights-checked bed with voice ducking; retain voice stem, run FFprobe + loudness/peak analysis and save SRT; subprocesses always use argument vectors and timeouts.
- [ ] **Step 4 — GREEN and commit:** test a 30–60s audible WAV with timed reveal plus seeded failure; `pnpm test`; commit `feat(video): master narration and semantic SFX`.

### Task 6: Render a meaningful, frame-addressed House Math visual story

**Files:** Create `apps/web/video-export.html`, `src/video-export/main.tsx`, `src/video-export/house-math-scene.tsx`, `src/video-export/house-math-scene.test.tsx`, `examples/video-production-house-math-long.json`; update `vite.config.ts` for explicit multi-page build.

**Interfaces:** `compileHouseMathVisuals(job,timeline):HouseMathVisualPlan`; `getHouseMathFrame(plan,absoluteFrame):HouseMathFrameState` (pure, deterministic); `<HouseMathExportScene plan frame />` drives one existing `<VideoExportStage>` and respects `onSeek(frame)` async readiness; `GET /__video_job` returns the validated plan from the local stage server (Task 7).

- [ ] **Step 1 — Red tests:** seeking first, middle, reveal and last frames produces distinct coherent scene states; payoff label/value is absent at frame 0 and visible at event frame; source/assumption caveat always visible when figures display; invalid cost arithmetic, unsupported scene intent and camera crop fail rather than quietly default.
- [ ] **Step 2 — RED:** `pnpm vitest run src/video-export/house-math-scene.test.tsx`.
- [ ] **Step 3 — Implement:** adapt proven Kumiki source components (e.g. cost waterfall, lifecycle timeline/comparison, MotionDirector/camera) with a single semantic clock. Author enough **different explanatory chapters and worked illustrations** in the long fixture to support a genuinely coherent 8+-minute spoken episode; let measured narration determine scene durations. No repeating loop just to reach 8 minutes, no fake sourced housing statistics and no blind 9:16 crop.
- [ ] **Step 4 — GREEN and commit:** `pnpm vitest run src/video-export/house-math-scene.test.tsx && pnpm typecheck && pnpm build`; commit `feat(video): add deterministic House Math export stage`.

### Task 7: Capture/browser-export in bounded segments

**Files:** Create `stage-server.mjs`, `render.mjs`, `render.test.mjs`; pin `playwright-core` if needed and update `pnpm-lock.yaml`. Reuse existing `VideoExportStage` handshake and inspect the pinned Kumiki exporter before implementation.

**Interfaces:** `startLocalStageServer({distRoot,validatedPlan,host:'127.0.0.1'}):Promise<{url,close}>`; `renderVideoSegments({stageUrl,manifest,outDir,maxBatchFrames:150,browserExecutable,signal}):Promise<{videoOnlyPath,frameCount,segmentHashes,peakScratchBytes,renderSeconds}>`.

- [ ] **Step 1 — Red tests:** fake browser driver proves seeks use absolute integer frames; 151-frame request splits 150+1; bad fonts/image/readiness, missing frame, subprocess failure and cancellation cannot publish a partial artifact. Segment resume accepts matching manifest/hash/frame-count only and rejects mismatched/corrupt segments; path traversal denied.
- [ ] **Step 2 — RED:** `node --test scripts/video-production/render.test.mjs`.
- [ ] **Step 3 — Implement:** serve built `video-export.html` and immutable job JSON via loopback; capture at most 150 PNGs into a job-owned batch, encode with FFmpeg, FFprobe-check count/FPS, then clear only that batch and continue. Concatenate verified video-only segments (no re-timed voice), preserve seek precision, record real peak disk/time, close browser/server on all exits. Use an existing local browser; browser/model downloads over 250 MB require approval.
- [ ] **Step 4 — GREEN and commit:** same test; if browser/FFmpeg preinstalled, opt-in actual 30–60s render; otherwise report **BLOCKED real export**, not PASS. Commit `feat(video): encode bounded browser frame segments`.

### Task 8: One-command orchestration, release gates and 8+-minute acceptance

**Files:** Expand `cli.mjs`, `cli.test.mjs`; create `report.mjs`, `report.test.mjs`; add `README.md` commands/rights table; add `.gitignore` for worker outputs only if not already covered.

**Interfaces:** `produceVideo(job,options):Promise<ProductionResult>` called by CLI; `writeQaReport({job,timeline,audio,render,rights,toolVersions,reviewStatus}):QaReport`; result staging atomically publishes `video.mp4`, `master.wav`, `captions.srt`, `render-manifest.json`, `qa-report.json`, selected start/payoff/end PNGs and SHA-256 hashes only after successful validation.

- [ ] **Step 1 — Red tests:** mock end-to-end short fixture reaches all named outputs; missing payoff, MP4 probe mismatch, >one-frame A/V drift, rights denial, hash mismatch, double-run cache behavior, dangerous `--out` target and cancelled job fail with diagnostic paths. `mode:'youtube-long'` with duration `<480s` is **not release-ready**, even if it encodes successfully; `commercialReady` also requires explicit external human sign-off/rights.
- [ ] **Step 2 — RED:** `node --test scripts/video-production/{cli,report}.test.mjs`.
- [ ] **Step 3 — Implement:** CLI calls validated providers, beat cache, timeline, mix, local stage, bounded render, final mux/probe and report in that order. Files go first into a uniquely job-owned staging directory; idempotent resume verifies hashes; a failure never publishes a `video.mp4` as successful. Separate `draft/fixture` and `approved` statuses.
- [ ] **Step 4 — GREEN:** `pnpm test && pnpm lint && pnpm typecheck && pnpm build`, `pnpm video:produce -- --job ../../examples/video-production-house-math-smoke.json --provider local --dry-run --out ../../outputs/house-math-smoke`; run actual mocked smoke with permitted test bridge and local FFmpeg/browser, and compare reported FFprobe/container samples/frame counts.
- [ ] **Step 5 — Opt-in real acceptance:** with **user-supplied permission and a configured Fish or working local engine**, synthesize and fully render `examples/video-production-house-math-long.json`; assert measured `>=480s`, visually meaningful opening/middle/reveal/end, nonrepeating chapters, generated voice/SFX, correct captions, bounded peak scratch, matched FPS/AV drift, full file hashes and documented rights. **Watch/listen to the complete video at normal speed**; record this manual sign-off separately. If account, local model, browser or permission is absent, mark this test BLOCKED; do not silently substitute imported narration.
- [ ] **Step 6 — Commit:** `feat(video): orchestrate narrated headless export with QA gates` and record exact commands/results, capabilities/rights, license limitations, temporary disk peak, and next portrait-profile milestone.

## Verification Matrix

| Tier | Command / observation | Success |
| --- | --- | --- |
| Always-offline unit | `cd apps/web && node --test scripts/video-production/*.test.mjs` | Parser, policy, mock provider, timing, cache, mux/render orchestration and negative fixtures pass |
| Existing regression | `cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm build` | No regressions to React/Kumiki/episode-draft work |
| CLI policy | `pnpm video:produce -- --job ../../examples/video-production-house-math-long.json --provider fish --dry-run --out ../../outputs/house-math` | Reports prerequisites and rights without network/model invocation |
| Browser smoke | Real Chromium + FFmpeg, short fixture, approved test voice | Playable 30–60s 16:9 MP4, SRT, generated/mastered audio and SFX, snapshots and hashes |
| R1 real product | Fish or installed local voice, opted in, long fixture | Coherent **>=480s** 16:9 film, full normal-speed human viewing, verified QA, bounded scratch, explicit rights/commercial status |

## Explicitly Deferred

- True 9:16 reauthoring and individually tuned Shorts/TikTok/Instagram/Facebook profiles (R2). Existing platform preset catalog remains the delivery-format source, but editorial time targets remain adjustable job metadata.
- General-purpose script/research generation, automatic hook optimization and unverified numerical claims; EpisodeDraft/Storyboard Planner integration beyond fixture handoff.
- Scheduler-based Rust worker dispatch, background queue/UI, automated publishing, transcription-based word alignment, model downloads, voice cloning, broad visual recipe coverage and automatic commercial-approval decisions.

## Self-Review Notes

- **Spec coverage:** Sections 1–9 map to job/policy (1), provider split (2–3), per-beat audio/cache (4), SFX/captions (5), Kumiki visual stage (6), bounded capture (7), artifacts/QA/rights and long acceptance (8). Portrait profile remains intentionally deferred as approved.
- **Interfaces:** Node worker consumes immutable versioned job, beats and frame plan; browser only consumes validated plan over local stage server; FFmpeg owns media, Rust does not gain duplicate rendering APIs.
- **Known blockers:** real-provider request requires permission/credentials; actual browser installation and FFmpeg presence require checks. No task claims these tests ran merely by writing this plan.


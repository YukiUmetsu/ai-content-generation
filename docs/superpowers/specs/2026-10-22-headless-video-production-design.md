# Headless Video Production MVP — Design

**Date:** 2026-10-22  
**Status:** Approved direction in conversation; written specification awaiting review  
**Scope:** First working CLI-first production slice of ContentGen, without a new UI.

## 1. Intent and finish line

The first major product goal is to automate original explainer-video production. One command must turn an authored, validated episode fixture into a **30–60-second, 16:9 playable MP4 with automatically synthesized human narration**, semantically relevant visual motion, at least one correctly timed SFX, segment-level captions, and a machine-readable QA/provenance report. There must be no manual audio-file preparation. The reference fixture is the fictional $500,000 House Math scenario; calculations and values are visibly labeled as illustrative assumptions. Its stable payoff event is **lifetime-total-reveal**.

This is a video-output-first integration path, not a general script writer or autonomous publishing service. UI authoring, 9:16 adaptation, real research, word-level forced alignment, automatic voice cloning, generative assets and platform upload are not prerequisites. No result is called commercial-ready solely because encoding succeeded.

## 2. Decisions and ownership

- **Rust / ContentGen:** owns persisted job and artifact models, approvals, provenance, rights and eventual durable orchestration. Existing Rust jobs currently persist DAG transitions but do not execute media steps. The first worker is deliberately invoked from a CLI; integrating it with the Rust scheduler follows a verified render.
- **Node/TypeScript worker in the existing apps/web workspace:** owns CLI, provider adapters, per-beat audio preparation, temporal compiler, local stage server/Playwright invocation and FFmpeg orchestration. Reuse the existing package manager and vendored Kumiki pin; do not create a separate application or copy Kumiki's design system.
- **Kumiki:** owns visual/motion composition and absolute integer-frame evaluation via implemented source-vendored primitives, the VideoExportStage handshake and capture surface. Adapt only confirmed APIs; unsupported scene intents fail explicitly. Do not introduce a competing generic Composition format.
- **FFmpeg/FFprobe:** owns resampling, SFX/music mixing, encoding, muxing and media probes. All subprocess calls use argument arrays, no shell interpolation, fixed timeouts and owned temporary paths. Pin/report tool versions.

## 3. User-facing CLI and output

Proposed invocation (final flags may be adjusted in the implementation plan):

    cd apps/web
    pnpm video:produce -- --job ../../examples/video-production-house-math.json --provider fish --allow-network --out ../../outputs/house-math

A local provider is selected with --provider local and explicit loopback endpoint/model configuration. A --dry-run performs validation and displays provider, network, budget, rights and tool prerequisites without synthesizing or rendering. Default behavior never contacts a remote provider unless --allow-network is explicit. Paid model selection is separately opt-in with a nonzero budget; there is no silent paid fallback.

Successful production writes versioned immutable output paths under an explicitly selected directory: **video.mp4**, **master.wav**, **captions.srt**, **render-manifest.json**, **qa-report.json**, plus beginning/payoff/ending PNG snapshots and hashes. Write to job-owned staging first and publish the final directory only after verification. An incomplete run retains actionable failure metadata; it never masquerades as a finished release. No API keys, voice samples or unlicensed assets enter Git or manifest logs.

## 4. Versioned job contract

Introduce a minimal **video-production-job/v1** document with job ID, locale, approved-or-test-only state, stable episode/storyboard/BrandKit revision references, selected packaging/payoff ID, output layout/preset, resolved visual recipe/beat inputs, ordered narration beats with IDs/text/event anchors, logical voice profile and explicit provider configuration, rights-checked SFX/music references, and source/assumption IDs. Validate unknown fields and duplicate/missing references. The checked-in fixture can inline synthetic source data but must carry test-only status, and must not pretend its example revision IDs resolve to approved persisted entities.

Consume the EpisodeDraft v1 handoff when actual referenced brand, thumbnail and storyboard revisions exist. The independently open Storyboard Planner PR is not a prerequisite for this fixture and must not be modified. Audio and visual events use one stable semantic identifier, including lifetime-total-reveal. Resolve BrandKit tokens to the pinned Kumiki theme and author one supported cost-reveal recipe with real cost decomposition, progression and final caveat. Do not output a static screenshot montage or silent video as successful completion.

## 5. Automated narration — required in v1

A provider-neutral **SpeechSynthesize** interface accepts beat text, locale, logical voice profile mapping, direction/prosody, output format and usage policy, and returns audio bytes plus provider/model/voice/version/provenance. Each real provider must generate speech automatically from text; importing a WAV is an optional future override, never the only path.

- **Fish Audio:** implement its documented POST /v1/tts JSON endpoint with Bearer auth read at runtime from FISH_AUDIO_API_KEY, explicit model header (initial evaluation model s2.1-pro-free), configured voice reference and WAV request. No hard-coded credentials; request/response size and timeout limits, handling for 401/402/429/5xx, bounded retries on transient failures, no token leakage. Exact model and output-rights status are recorded. The currently advertised free model may have commercial restrictions: any unverified license blocks commercial-ready release. A provider being priced at $0 does not constitute rights approval.
- **Local TTS:** implement the same port backed by one explicitly configured local loopback TTS endpoint/bridge, with a versioned request/response contract and verified engine/model identity. Intended first target is a user-installed Apple Silicon TTS engine (for example Qwen3-TTS-MLX), but its runtime-specific API must be probed before writing an adapter; never invent CLI flags or silently download >250 MB. If unavailable, return a typed setup error. Tests exercise a deterministic local mock, and an opt-in integration test exercises a real installed engine when present.
- Provider selection is explicit; Fish outages never silently switch voices/models, commercial terms or cost tier. The user may select a local alternative; substitutions require an audible review and invalidate alignment-dependent rendering.

Synthesize **per semantic beat**, cache by normalized text, language/pronunciation, provider/model/version/voice, prosody, audio encoding and rights scope; changing one beat invalidates only its own audio plus dependent timeline/scene outputs. Normalize to measured 48 kHz processing WAV via FFmpeg, derive exact sample counts with FFprobe and create segment-accurate captions. Do not claim word/phoneme alignment from predicted speaking rates.

## 6. Audio and visual synchronization

- Establish the speech/sample timeline from actual generated durations, explicit pauses and named event anchors. Convert to rational-FPS visual frame indices once using a documented rounding rule. Derive every Kumiki seek from an absolute integer frame (not elapsed browser time).
- Mix a rights-recorded semantic SFX at lifetime-total-reveal; allow intentional silence and optionally a licensed music bed with voice ducking. At minimum the fixture contains generated speech and one event-timed sound. Keep original narration as a stem and produce a normalised mastered WAV with measured peak/loudness, not a mere --audio file attachment.
- Serve one deterministic export page with exactly one VideoExportStage. Reuse the pinned VideoExportStage capture protocol and adapt the existing Kumiki Playwright→PNG→FFmpeg exporter, which currently takes one premixed audio file. Honor font/image readiness and visual geometry guards.
- Build first, middle, payoff and last frame seek assertions before full export. Only 16:9 30/1 fps is required now; no blind 9:16 crop. Collect actual rendering time and temporary frame disk usage. Clean only owned scratch after outputs verify.

## 7. Gates, failure modes and tests

Preflight: valid schema, unique beat/event/claim IDs, all required references, rights/consent declarations, configured provider and target capability, local FFmpeg/FFprobe/browser availability, safe output paths and budget permission. Test-only synthetic materials produce a **draft/fixture** output; verified source, font, music, narrator and commercial-usage rights plus explicit reviewer approval are mandatory for a commercial-ready release.

Automated QA must reject missing/zero-length speech, bad WAV/codec, impossible or overlapping beat timings, missing payoff, unsupported Kumiki intent, missing font/image, blank or frozen critical scene, clipped/cropped essential text, missing captions, audio/video drift beyond one video frame at 30 fps, failed FFprobe/container probe and final output hash mismatch. Record diagnostics as structured findings with severity and affected beat/frame/event. Fail closed on unknown rights. Do not report screenshot-only geometry checks as proof of creative quality.

**Offline unit/integration:** mock TTS produces predictable test audio without Internet or paid calls; seeded invalid schema, authorization failure, rate-limit, invalid response, missing endpoint, wrong sample rate/duration, orphan event and rights denial produce actionable errors. Cache-hit test confirms no second synthesis; changing a single beat regenerates only its dependents. Timestamp/frame-seek tests are deterministic.

**Opt-in real acceptance:** an authorized Fish API key or installed local TTS provider synthesizes the full fixture; real browser/FFmpeg produces a 30–60s playable narrated MP4, nontrivial cost-reveal motion, timed SFX, SRT and verified hashes/FFprobe report. Listen/watch the complete output at normal speed and inspect beginning, reveal and ending snapshots. No automatic CI declaration that this human inspection occurred.

Run existing lint/typecheck/test/build and Rust checks where tools are available; report any unavailable tool as unverified, not passed. Dependency/browser installation exceeding the repo's 250 MB threshold requires separate approval.

## 8. Delivery sequence and exclusions

1. **Speech slice:** typed TTS port, Fish adapter, explicit local bridge contract/adapter, beat cache, exact WAV probing and seeded negative tests. Demonstrate automatically generated speech from text, not imported audio.
2. **Render slice:** one supported House Math cost-reveal recipe compiled through pinned Kumiki, deterministic frame seek, semantic SFX/mix, FFmpeg export and captions, with negative QA fixtures.
3. **One-command orchestration:** versioned input/output, atomic staging, cache reuse, provenance/rights and report, real human review of the exported fixture. Only after this does the product have a working headless video-production MVP.

The first slice is deliberately limited to one complete factual visual recipe and one output profile. General-purpose autonomous topic research, script generation, all visual intentions, true 9:16 compositions, GUI editor integration, scheduler-based background workers, auto-publication and automatic model installs are separate milestones. A second provider may be configured but unavailable until its real engine is installed and integration-tested; no fake fallback success.

## 9. Dependencies, risks and references

- Repository: AGENTS.md; docs/02-runtime.md, 06-media.md, 08-assurance.md, 10-build-plan.md, 12-brand-studio.md, 13-audio-production.md, 14-kumiki-integration.md; apps/web/src/components/video/video-export-stage.tsx; apps/web/src/lib/episode-draft.
- Kumiki: pinned registry revision in apps/web/kumiki.config.json; upstream scripts/export-video.mjs is a reference, not a stable ContentGen runtime import.
- Fish API: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech and https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits ; commercial conditions: https://fish.audio/blog/s2-1-pro-free-api/ and https://fish.audio/terms/.
- Risks: browser disk/CPU cost of PNG-per-frame, non-deterministic remote voice timing, unavailable local TTS, Fish free-tier commercial terms, quality variance across voices and preview-versus-release rights. Measure first and fail explicitly, then optimize or change provider.

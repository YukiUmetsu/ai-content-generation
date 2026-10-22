# Headless Video Production MVP — Design

**Date:** 2026-10-22  
**Status:** User-approved written design (2026-10-22); [implementation plan](../plans/2026-10-22-headless-video-production.md)  
**Scope:** First working CLI-first production slice of ContentGen, without a new UI.

## 1. Intent and finish line

The first major product goal is to automate original explainer-video production. One command must turn an authored, validated episode into a **full-length YouTube landscape explainer (at least 8 minutes; initial editorial target 9–15 minutes) with automatically synthesized human narration**, semantically relevant visual motion, correctly timed SFX, segment-level captions, and a machine-readable QA/provenance report. A 30–60-second fixture is permitted only as a cheap integration smoke test; it is not a production-video acceptance substitute. There must be no manual audio-file preparation. The reference fixture is the fictional $500,000 House Math scenario; calculations and values are visibly labeled as illustrative assumptions. Its stable payoff event is **lifetime-total-reveal**.

This is a video-output-first integration path, not a general script writer or autonomous publishing service. UI authoring, 9:16 adaptation, real research, word-level forced alignment, automatic voice cloning, generative assets and platform upload are not prerequisites for the first **landscape** release. The contract must nonetheless support future independently scripted portrait videos and duration changes without schema or worker redesign. No result is called commercial-ready solely because encoding succeeded.

## 1a. Duration and destination profiles (research reviewed 2026-10-22)

**Duration is editorial, not a fixed render constant.** Store `destinationProfileId`, aspect ratio, FPS, `targetDurationSeconds` (advisory range), `minimumDurationSeconds` (only when the user/destination requires it), and measured narration-derived `actualDurationSeconds`. Duration must follow the approved story and real generated voice timing; never silently pad, truncate, accelerate or loop material to meet a monetization threshold. Hard platform eligibility/caps are validated independently from adjustable creative targets. Profiles are versioned so platform changes do not rewrite historical jobs.

| Destination | Initial **editorial** target, not a universal optimum | Relevant platform constraint / evidence |
| --- | --- | --- |
| YouTube regular 16:9 | **9–15 minutes** as a starting range; **8 minutes minimum** for this product goal; longer where the explanation earns it | YouTube makes videos 8 minutes or longer eligible for mid-roll ads, without guaranteeing placement or revenue: https://support.google.com/youtube/answer/2467968 |
| YouTube Shorts 9:16 | **45–120 seconds** initially, up to 180 seconds where useful | YouTube accepts square/vertical Shorts up to 3 minutes. Official help updated September 2026 says newer Shorts over one minute with Content ID claims are **not automatically blocked** (older localized guidance conflicts); claims and music rights still need individual checks: https://support.google.com/youtube/answer/15424877?hl=en-ws |
| TikTok 9:16 | **90–180 seconds**, test 90 and 150 seconds initially | TikTok Creator Rewards requires original videos of at least one minute (not a reach guarantee): https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program ; 2026 observed view medians rose through 120–180 seconds in a large brand-account sample: https://www.socialinsider.io/blog/how-long-are-tiktok-videos/ |
| Instagram Reels 9:16 | **45–60 seconds** for discovery; **120–180 seconds** when substance benefits | Reels longer than 3 minutes are not recommended to new audiences: https://help.instagram.com/2720958398006062/ ; 2026 original brand-account analysis favored 45–60 seconds: https://www.socialinsider.io/blog/instagram-reels-length/ |
| Facebook Reels 9:16 | **120–180 seconds** as an initial test | Meta removed fixed format/length distinctions for Facebook video/Reels; 2026 brand-account sample found strong 2–3-minute engagement: https://www.socialinsider.io/social-media-benchmarks/social-media-video-statistics ; https://about.fb.com/news/2025/06/facebook-video-reels/ |

These are *hypotheses* for the user's educational/ad-funded channels, not guarantees. The social-media benchmarks are observational and may not predict a new creator's performance. Record retention, average view duration, qualified views and ad revenue per destination/length after publishing; optimize using actual channel data. Source-derived limits and rights must be rechecked before automatic uploads.

**Story architecture:** a long explainer needs sustained setup, mechanisms, worked examples, visual variety, source caveats, and a payoff/takeaway; do not simply repeat a 45-second story. A portrait short gets a separate hook, compressed but complete claim, redesigned 9:16 visual staging, and target profile. Sharing research assets, brand and source IDs is encouraged; speed-changing, blind cropping or automatically chopping the long video is not sufficient.

**Acceptance tiers:** (1) 30–60-second offline mock integration smoke; (2) 8+-minute 16:9 complete production using *real* automatically generated Fish or local TTS, full playback, QA and manifest; (3) later 9:16 destination tests independently authored to the platform-specific range. A smoke test cannot be reported as tier 2. The 8-minute floor is the user's chosen long-form product requirement, not a universal YouTube recommendation.

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

Introduce a minimal **video-production-job/v1** document with job ID, locale, approved-or-test-only state, stable episode/storyboard/BrandKit revision references, selected packaging/payoff ID, output destination profile/aspect/FPS and advisory duration range with optional policy minimum, resolved visual recipe/beat inputs, ordered narration beats with IDs/text/event anchors, logical voice profile and explicit provider configuration, rights-checked SFX/music references, and source/assumption IDs. Validate unknown fields and duplicate/missing references. The checked-in fixture can inline synthetic source data but must carry test-only status, and must not pretend its example revision IDs resolve to approved persisted entities.

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
- Build first, middle, payoff and last frame seek assertions before full export. The first production profile is 16:9 30/1 fps; no blind 9:16 crop. Support the eventual portrait profile at the contract boundary. Long videos must use **bounded frame capture/segment encoding or equivalent streaming**, not accumulate the entire 8–15-minute clip as lossless PNG files in one directory (14,400–27,000 frames at 30 fps). Measure peak scratch bytes, peak memory, elapsed time, output/container integrity and cancellation behavior. Resumption or restart reuses only verified completed segments, and cleans only owned scratch after outputs verify.

## 7. Gates, failure modes and tests

Preflight: valid schema, unique beat/event/claim IDs, all required references, rights/consent declarations, configured provider and target capability, local FFmpeg/FFprobe/browser availability, safe output paths and budget permission. Test-only synthetic materials produce a **draft/fixture** output; verified source, font, music, narrator and commercial-usage rights plus explicit reviewer approval are mandatory for a commercial-ready release.

Automated QA must reject missing/zero-length speech, bad WAV/codec, impossible or overlapping beat timings, missing payoff, unsupported Kumiki intent, missing font/image, blank or frozen critical scene, clipped/cropped essential text, missing captions, audio/video drift beyond one video frame at 30 fps, failed FFprobe/container probe and final output hash mismatch. Record diagnostics as structured findings with severity and affected beat/frame/event. Fail closed on unknown rights. Do not report screenshot-only geometry checks as proof of creative quality.

**Offline unit/integration:** mock TTS produces predictable test audio without Internet or paid calls; seeded invalid schema, authorization failure, rate-limit, invalid response, missing endpoint, wrong sample rate/duration, orphan event and rights denial produce actionable errors. Cache-hit test confirms no second synthesis; changing a single beat regenerates only its dependents. Timestamp/frame-seek tests are deterministic.

**Opt-in real acceptance:** an authorized Fish API key or installed local TTS provider synthesizes an **8+-minute, coherently scripted YouTube landscape episode**; real browser/FFmpeg produces a playable narrated MP4 with sustained non-repetitive explanatory motion, timed SFX, SRT, verified hashes/FFprobe report and **bounded scratch use**. Separately, a 30–60-second deterministic smoke fixture proves the integration cheaply but cannot pass this product gate. Listen/watch the complete output at normal speed and inspect beginning, reveal and ending snapshots. No automatic CI declaration that this human inspection occurred.

Run existing lint/typecheck/test/build and Rust checks where tools are available; report any unavailable tool as unverified, not passed. Dependency/browser installation exceeding the repo's 250 MB threshold requires separate approval.

## 8. Delivery sequence and exclusions

1. **Speech slice:** typed TTS port, Fish adapter, explicit local bridge contract/adapter, beat cache, exact WAV probing and seeded negative tests. Demonstrate automatically generated speech from text, not imported audio.
2. **Render slice:** one supported House Math cost-reveal recipe compiled through pinned Kumiki, deterministic frame seek, semantic SFX/mix, bounded-chunk FFmpeg export and captions, with negative QA fixtures. Begin with a 30–60-second smoke run but validate a full-length script as the release gate.
3. **One-command orchestration:** versioned input/output, atomic staging, cache reuse, provenance/rights and report, real human review of a full **8+-minute** export and resource usage. Only after this does the product have a working headless long-form video-production MVP. A later portrait milestone adds independently authored short profiles.

The first slice is deliberately limited to one complete factual visual recipe and the first landscape output profile, including enough planned variation to sustain a coherent full-length narrative. General-purpose autonomous topic research, script generation, all visual intentions, true 9:16 compositions, GUI editor integration, scheduler-based background workers, auto-publication and automatic model installs are separate milestones. A second provider may be configured but unavailable until its real engine is installed and integration-tested; no fake fallback success.

## 9. Dependencies, risks and references

- Repository: AGENTS.md; docs/02-runtime.md, 06-media.md, 08-assurance.md, 10-build-plan.md, 12-brand-studio.md, 13-audio-production.md, 14-kumiki-integration.md; apps/web/src/components/video/video-export-stage.tsx; apps/web/src/lib/episode-draft.
- Kumiki: pinned registry revision in apps/web/kumiki.config.json; upstream scripts/export-video.mjs is a reference, not a stable ContentGen runtime import.
- Fish API: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech and https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits ; commercial conditions: https://fish.audio/blog/s2-1-pro-free-api/ and https://fish.audio/terms/.
- Risks: browser disk/CPU cost of long-form PNG-per-frame (must be bounded before product acceptance), non-deterministic remote voice timing, unavailable local TTS, Fish free-tier commercial terms, quality variance across voices and preview-versus-release rights. Measure first and fail explicitly, then optimize or change provider.

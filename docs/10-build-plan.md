# Executable build plan for OpenCode

**Status:** implementation roadmap, not shipped features. **Primary goal:** produce original, evidence-grounded, premium **branded** explainers on YouTube landscape and Shorts/Reels/TikTok portrait, with provider-swappable narration, synchronized music/SFX, editable thumbnails, and an economical local-first production pipeline.

**Working mode:** one task ID per OpenCode execution. Inspect the repository and actual installed Kumiki APIs first; make the smallest working change, run acceptance fixtures, report evidence and stop. **Do not silently invoke Codex, ChatGPT Work, paid APIs or large model downloads.** Repositories/services may be read or edited only through explicitly available/approved tools. All ContentGen code mentioned below is **planned**, not assumed to exist.

**Normative references:** [01 architecture](01-system.md), [02 runtime](02-runtime.md), [03 data](03-data.md), [05 content](05-content.md), [06 media](06-media.md), [08 QA](08-assurance.md), [12 Brand Studio](12-brand-studio.md), [13 audio](13-audio-production.md), [14 Kumiki](14-kumiki-integration.md), [15 Creative Intelligence](15-video-performance-system.md), [16 Creative Pattern Library](16-creative-pattern-library.md). [Dated video research](research/2026-10-21-video-market-scan.md) informs creative hypotheses, **not** current immutable facts.

## 1. Delivery strategy and finish lines

**Default sequence:** M0 foundation → M1 Brand Studio → M2 creative planning/packaging → M3 speech and sound → M4 Kumiki video rendering → M5 portrait/destination adaptation → M6 regeneration/analytics → optional M7 research/articles/products. This **replaces the earlier instruction to ship an article before video**; the old A–L features remain in the optional backlog at the end.

**First useful release (R1):** using checked-in synthetic, *clearly labeled* inputs, create one approved BrandKit, choose one of three genuinely different title/thumbnail/hook hypotheses, explain a specific home-cost mechanism with a meaningful animated transformation, import or synthesize narrator audio offline, add at least one semantically anchored SFX, mix it, render a **30–60s 16:9 MP4**, export a distinct mobile-legible thumbnail and caption file, and generate an audit/QA report. A mocked speech adapter is fine for automated CI; a human-provided audio clip proves audible production. **Do not mark R1 complete with silent video, static screenshot montage, generic title cards or fake evidence.**

**Second useful release (R2):** re-author that concept for a true **9:16** platform layout and **short-form narrative**; switch brand presets and narrator backends without rewriting media logic, and demonstrate targeted rerendering instead of rebuilding every artifact. TikTok, Instagram and Facebook may use versioned local export presets before any upload integration.

**First scalable release (R3):** editable UI for brand/storyboard/thumbnail, restart-safe queue, bounded disk use, provider capabilities/rights tracking, non-destructive revisions, measurable experiment imports and transparent human publishing approval. Online trends, automatic upload, payments, character lip sync and generative video are **not** R1 requirements.

### Rules for scope, paths and external actions

- **Paths are suggested, not guaranteed:** the repository may still consist only of docs and fixtures. Before each task, inspect actual files and edit existing appropriate modules; never create 12 empty crates or imaginary Kumiki imports to match a diagram.
- **Rust owns** typed source-of-truth models, DB, jobs, approvals, content hashes, rights and provider routing. **React/TypeScript owns** editing, previews and optional render worker. Kumiki-UI owns visuals, deterministic animation/camera, infographic logic and production constraints. **FFmpeg/local workers** own DSP/encoding; ContentGen owns their orchestration.
- Existing Kumiki still/media and MG1/MD1/CC1/VT1/video-export surfaces are usable **only after inspecting exact pinned APIs**. Full Composition/document/audio-lane APIs described elsewhere may be proposals; do not invent runtime support.
- **Offline first:** mock/fake research, approved local WAV, generated tones/CC0 test samples and built-in SVG graphics suffice through R1. Never silently call Fish Audio, SEO APIs, upload platforms, install >250 MB, purchase media, clone third-party voices or fetch unlicensed fonts.
- **No false completion:** each task includes a real result and negative test; absent tools/tests produce **BLOCKED** with evidence rather than “passed.” Never present hypothetical number, algorithmic viral score, CTR or RPM as measured.
- **Never delete** unrelated user files, shared model caches, old approved brand revisions or approved releases. Ignore local secrets/DB/assets and use owned temporary directories with cleanup only after verified output.

## 2. Task protocol: copy into every OpenCode session

Before editing: read \`AGENTS.md\`, \`docs/INDEX.md\`, this plan, the task's linked owner docs and only required source modules. Report **what exists**, what is missing, current branch and git status. Preserve unrelated changes.

Use this instruction, replacing only the task identifier:

\`\`\`text
Implement ONLY task <ID> from docs/10-build-plan.md.
Read AGENTS.md, docs/INDEX.md and the task's named source-of-truth docs.
First inspect the repository, branch, actual Kumiki imports/APIs and tests.
State prerequisites (pass / missing); if unmet, stop and report BLOCKED.
Implement the smallest complete vertical slice; add realistic success and
failure tests. No speculative stubs, renamed duplicate components or large
scaffold. Keep brand/voice/renderer providers replaceable. No Codex, Work,
paid/network provider calls, publishing, or >250 MB download without my
separate approval. Do not claim unrun tests passed.
Run the task's targeted checks plus existing repo lint/typecheck/build where
applicable; measure output and disk footprint. Show exact commands/results,
changed files, persisted schema impact, fixture outputs, QA failures,
license/cost/network activity and next unlocked task. STOP after this ID.
\`\`\`

**Task status:** \`NOT_STARTED | IN_PROGRESS | PASS | BLOCKED\`. Task IDs are permanent; do not mark complete because a file or UI placeholder exists. Each task should be small enough for one reviewable commit/PR with its own tests. Where an upstream foundation exists, reuse it and close only the missing acceptance criteria.

**Universal completion conditions:**
1. A demonstrable operation runs end-to-end for that task's scope, with versioned/validated input/output.
2. A **seeded failure** is detected and returned in an actionable typed error or QA finding (not caught and ignored).
3. No hidden model, provider, rights, credential, compatibility or dependency assumption remains.
4. Existing changed code builds/tests, sample fixture is documented and deterministic, and no unrelated features or unapproved external calls were introduced.
5. Report includes exact commands and outcome; do not check off tasks when commands were skipped.

**Commands are contingent on scaffold:** after Rust/React actually exist, run \`cargo fmt --check\`, \`cargo clippy --workspace --all-targets -- -D warnings\`, \`cargo test --workspace\`; frontend typecheck/unit/build from the **actual** package scripts. For render work also run the documented local fixture and FFprobe/FFmpeg probe; screenshot/preview selected times only, not every frame in CI. If tests aren't installed yet, say so rather than inventing a script.

### Shared fixture: one original house-cost video

Use a fictional sample scenario, not a claim about an actual US market: a **$500,000 home** and parameterized purchase/down-payment/mortgage/tax/insurance/maintenance/rate changes. Until sourced, **ALL numbers are labeled as illustrative assumptions**. Maintain one named semantic event across all outputs: \`lifetime-total-reveal\`. Use this scenario throughout so task-to-task fixtures reuse artifacts and provide real regressions:

- Base narrative: “The sticker price is only the beginning” → decompose cost categories → show calculated cumulative cost → explain assumption sensitivity → conclude with **conditions and caveat**.
- Example creative variants: **visible-cost reversal**, **mechanism/cost cutaway**, and **comparison/break-even**. The latter may require a separate rent model; if not implemented, its promise must remain unapproved rather than fabricating a break-even.
- Brands for isolation testing: \`House Math\` (modern analytical) and \`Archive Lab\` (calm documentary/historical). Names/colors/voices are demo data, not final trademark-cleared channel brands.
- Render targets: e.g., local \`1920×1080, 30/1 fps\` and \`1080×1920, 30/1 fps\` fixtures. Actual YouTube/Reels/TikTok publishing constraints belong to versioned platform profiles, never hardcoded assumptions.
- Required identifiers: \`brandKitRef\`, \`storyRevision\`, \`hypothesisId\`, \`eventId\`, \`source/assumptionRefs\`, \`voiceProfileRef\`, \`layoutVariantId\`, \`renderManifestId\`. Reference existing examples rather than maintaining a second incompatible schema.

## 3. M0 — foundation (execute in order)

**F01 — Runnable local skeleton**
- **Depends on:** none. **Read:** 01,02,08.
- **Deliver:** minimal one-workspace Rust/Axum executable with \`GET /healthz\`, one React/Vite page that shows actual API health, one pinned JS lockfile, loopback-only bind, .gitignore and documented run/test commands. No unused “future” crates.
- **Pass:** cold start, valid health JSON and responsive UI; integration test rejects unapproved origin or malformed request. Run fmt/clippy/test and actual frontend scripts. **Stop before DB/provider/media integration.**

**F02 — Minimal versioned SQLite storage**
- **Depends on:** F01. **Read:** 03; \`examples/core-schema.sql\` as *reference*, not automatic migration.
- **Deliver:** ordered migrations for only F03–M2 essentials (brands, brand revisions, projects, artifacts, jobs/steps, QA/approvals); FK on every connection, fresh/open-existing migrations, repo interfaces and transaction helper. Defer unrelated catalog/SEO/character tables until needed.
- **Pass:** fresh DB and reopen preserve data; invalid FK, same-brand hierarchy violation, stale approved revision and failed migration fixture are rejected. Capture migration version and backup/recovery policy.

**F03 — Hash-addressed artifact store**
- **Depends on:** F02. **Read:** 02,03,08.
- **Deliver:** local configurable artifact root, SHA-256 content addressing, atomic write/rename, metadata, path containment, quotas and typed load/write; distinguish immutable outputs and per-job temporary scratch.
- **Pass:** identical bytes deduplicate, incorrect hash and path escape fail, cancelled owned scratch cleans safely; existing approved/reference bytes survive simulated cache cleanup.

**F04 — Provider capability registry and deterministic mock**
- **Depends on:** F01,F03. **Read:** 02,13,14, \`examples/provider-profiles.json\`.
- **Deliver:** versioned capability manifest and \`Unavailable\` error; mock structured text/voice/media operations with explicit duration/content and fixed fixtures, configuration separate from domain. No real model installation.
- **Pass:** caller picks provider by capability; disabled cloud provider returns actionable refusal; no outbound requests, credentials or models are required; provenance includes provider/profile/version.

**F05 — Durable resumable job engine**
- **Depends on:** F02–F04. **Read:** 02,08.
- **Deliver:** persisted DAG steps/dependencies, idempotency key, \`PENDING/READY/RUNNING/SUCCEEDED/FAILED/CANCELLED\`, bounded retry, interrupt/resume and progress from real step state; expose read and cancel APIs.
- **Pass:** simulated process crash resumes without double-committing artifact, cycle refused, child failure blocks descendants, cancellation stops only owned workers, retry limit enforced. No fake percent progress.

**F06 — Minimal workflow UI**
- **Depends on:** F02,F05. **Read:** 07,08.
- **Deliver:** brand/project selector, job launch/status/log view, actual error and cancellation states, stored selection and accessible inputs. Avoid a huge empty dashboard.
- **Pass:** launch a mock DAG from UI, reload and see persisted job state; keyboard-only flow and one failure message work on narrow/wide viewport.

**M0 exit:** app starts with no external accounts, stores durable artifacts and a resumable mock job; basic tests pass. No media claims.

## 4. M1 — Brand Studio and visual identity

**B01 — BrandKit schemas + inheritance**
- **Depends on:** F02,F04. **Read:** 12,03, \`examples/brand-kit.json\`, \`examples/brand-style-presets.json\`.
- **Deliver:** typed \`BrandKit\`, \`Mood\`, \`VoiceProfileRef\`, \`DeliveryProfileRef\` and approved revision refs; validation and draft/approve flow. Approved snapshots immutable, project override rules explicit.
- **Pass:** valid kits round-trip; unknown token, unauthorized cross-brand asset, invalid override and mutation of approved revision fail.

**B02 — Palette and font token compiler**
- **Depends on:** B01. **Read:** 07,12,14; verify Kumiki \`--km-*\` token contract.
- **Deliver:** DTCG-to-pinned Kumiki theme mapping for semantic surfaces/text/accent/chart colors and typography roles; font loading/fallback and light/dark preview. Use verified license-safe sample fonts; no font bundling without rights.
- **Pass:** render English/Japanese/numeral sample, check token refs and declared text contrast, test missing glyphs and intentionally illegible palette. No custom parallel design-token system.

**B03 — Distinct starter art directions**
- **Depends on:** B02. **Read:** 12,16 and brand-style presets.
- **Deliver:** seed/import named starting directions (analytical, geeky, calm, investigative, historical/Japanese-inspired, etc.) as editable data; generate five canonical **brand diagnostic stills** (hook, cost reveal, comparison, chart, thumbnail).
- **Pass:** two brands show visibly different tokens and motion preferences; preset changes never mutate an approved version; brand identity persists across multiple scene recipes, not just a logo card.

**B04 — Brand approval and provenance**
- **Depends on:** B01–B03,F03. **Read:** 03,12,08.
- **Deliver:** approval records/hashes, assets/license refs, brand revision pinning in render requests, clone/fork and rollback-to-draft actions.
- **Pass:** approved v1 remains byte-identical after v2 changes; an unresolved font/voice asset blocks commercial-ready status; projects inherit without mutating v1.

**B05 — Brand wizard + usable previews**
- **Depends on:** B03,B04,F06. **Read:** 07,12,08.
- **Deliver:** guided brand name/audience → art direction → palette/typography → voice mood (mock audition) → 16:9/9:16 sample gallery → explicit approve; advanced settings remain optional.
- **Pass:** user creates and previews two independent brands via keyboard, revises palette without losing edits, receives clear validation errors. Measure task friction; **do not claim two-minute completion unless tested**.

**M1 exit:** brand can be defined, previewed, persisted and pinned; media work can consume its exact revision.

## 5. M2 — Creative Intelligence, titles, thumbnails and story

**C01 — Dated opportunity signals**
- **Depends on:** F02,F03. **Read:** 04,15 and the dated market scan.
- **Deliver:** versioned \`MarketSignalSnapshot\` for manual/offline CSV/JSON topic signals: URL, title/video ID, published/observed timestamps, views, format, channel, evidence type and missing-value semantics. No web scraping required in MVP.
- **Pass:** import two dated snapshots of one video while retaining title history; reject malformed dates, duplicate record and false CTR/RPM fields; never infer private retention.

**C02 — Source-grounded topic brief**
- **Depends on:** C01. **Read:** 04,05,15,08.
- **Deliver:** \`OpportunityBrief\` with question, audience stakes, evidence/assumption IDs, originality angle, visual teachability and uncertainties. Start with the synthetic house scenario; show sourced vs assumed distinctly.
- **Pass:** brief cannot claim unverified dollar totals or an unsupported universal outcome; all displayed figures link to inputs and arithmetic; uncited assumption displays as hypothetical.

**C03 — Three genuinely distinct title + thumbnail hypotheses**
- **Depends on:** B03,C02. **Read:** 15,16, \`examples/packaging-experiment.json\`.
- **Deliver:** versioned \`PackagingHypothesis\`: curiosity type, working title, complementary thumbnail composition, opening visual promise, payoff event, claim refs and provenance. Offer **three strategies**, not synonym swaps.
- **Pass:** cost-reversal vs cutaway vs A/B comparator have distinct composition/curiosity types; unsupported break-even stays unapproved; duplicated variant IDs/claims rejected. No fake viral score.

**C04 — Editable thumbnail composition renderer**
- **Depends on:** B02,C03. **Read:** 06,12,14,16; inspect actual Kumiki media/infographic source.
- **Deliver:** adapter rendering editable object/text layouts with source IDs and BrandKit tokens to PNG/SVG; e.g., hero-object, split-comparison, cutaway and number-reversal. Keep master editable and assets licensed.
- **Pass:** three perceptually *different* variants produced, inspected at **160×90 and 320×180** previews; deterministic checks catch text clipping, contrast and hidden critical object; human selects aesthetic quality. No unapproved copyrighted thumbnail copying.

**C05 — Hook/payoff/story engine validator**
- **Depends on:** C03. **Read:** 15,16,05,08.
- **Deliver:** typed \`StoryPlan\` with engine selection (mystery/experiment/cost/decision/failure/history), \`HookContract\`, setup/questions/payoff IDs, evidence refs, and ordered semantic beats. Distinguish long vs short intentions.
- **Pass:** missing payoff, title/thumbnail promise contradicted by opening, decorative no-object scene and out-of-order necessary explanation are flagged; one valid cost-reveal plan passes. No universal cut-rate or forced sensationalism.

**C06 — Versioned storyboard and narrative editor**
- **Depends on:** C05,F06,B04. **Read:** 05,06,14,15,16, \`examples/visual-scene.json\`.
- **Deliver:** editable semantic storyboard where each beat declares \`objective, inputObjects, transformation, outputObjects, evidenceIds, narration, namedEvents\`. Persist revisions, allow reorder/undo, generate script text from authored beats/mock provider.
- **Pass:** changing a beat preserves stable IDs for unaffected beats; input→mechanism→visible result required when intent is causal; fail on orphan audio/visual event. **Do not create a second MG1/Kumiki keyframe wire format.**

**M2 exit:** select a real viewer question and one of three truthful, distinct packages; export a good thumbnail and an internally consistent story plan.

## 6. M3 — Speech, alignment, SFX and mastering

**A01 — Logical VoiceProfile + offline/imported narration**
- **Depends on:** B01,F04,C06. **Read:** 13,02, \`examples/audio-production-job.json\`.
- **Deliver:** \`SpeechSynthesize\` and \`SpeechImport\` ports with locale/profile/provider mapping; real WAV import, exact sample count, format probe, immutable artifact and consent/rights metadata. Mock speech for CI.
- **Pass:** 2 beat WAVs audible in local fixture, mismatch/unsupported format refused, provider disabled returns \`Unavailable\`. Do not clone voices or load a huge model.

**A02 — Optional Fish Audio or installed local speech provider**
- **Depends on:** A01. **Read:** 13,02 and verified current provider terms.
- **Deliver:** **only with separate network/model/usage approval**, a single adapter that maps logical voice profile to real provider IDs, records usage/version/rights and fails closed. Local TTS and Fish are alternatives; import/mock remains functional.
- **Pass:** opt-in real sample plus unavailable/rate-limit/denied-license tests; switching provider preserves script but explicitly invalidates generated audio/alignment timing. **Optional for R1**, required only when enabling production TTS.

**A03 — Segment-accurate timing and alignment**
- **Depends on:** A01,C06. **Read:** 13,14.
- **Deliver:** speech beat samples → canonical segment offsets; optionally measured word-level alignment from real supported aligner; exact sample-domain timing with frame conversion at final render boundary. Never synthesize fake phoneme accuracy.
- **Pass:** sentence timing audibly matches source, inserted silence is retained, negative/overlapping/unsupported alignment is flagged, conversion to 30/1 frame rate remains stable across repeated seeks.

**A04 — Licensed sound and music bank**
- **Depends on:** B04,F03,C06. **Read:** 13,08.
- **Deliver:** local semantic sound categories, CC0/self-made test media or silence, per-asset license/provenance, BrandKit sonic palette and bounded density/volume. SFX trigger on a **named semantic event**, not every scene transition.
- **Pass:** lifetime-total-reveal fires one relevant cue, intentional silence allowed, asset without commercial permission blocked, unrelated mood preserves voice/visual brand identity.

**A05 — Offline FFmpeg mix/master**
- **Depends on:** A01,A03,A04. **Read:** 13,02,08.
- **Deliver:** typed multi-lane WAV mixing for voice/music/SFX, trims/fades, voice-triggered music ducking, peak/loudness analysis and versioned output profile; record command/tool versions and stems. FFmpeg installed/approved separately if absent.
- **Pass:** a 30–60s listenable stereo WAV with real speech and timed SFX, no clipping, detectable silence/error and configurable ducking. Verify with FFprobe/audio analysis and human listen. Never represent plain \`--audio\` muxing as multitrack mixing.

**A06 — Captions and sync quality**
- **Depends on:** A03,A05. **Read:** 13,08,12.
- **Deliver:** SRT/VTT from *actual* segments/words, script coverage QA, caption-safe geometry requests to renderer and delay offset diagnostics.
- **Pass:** a known silence gap doesn't receive speech captions, no missing spoken beat or drift beyond a **documented configurable** tolerance, deliberate shifted cue fails. Do not claim word timing where only segment timing exists.

**M3 exit:** audible licensed/mastered narration, semantic SFX, optional music, captions and sample-precision event IDs—entirely without a required cloud TTS provider.

## 7. M4 — Kumiki integration and first complete video

**K01 — Pin and probe actual Kumiki source contracts**
- **Depends on:** F04,B02. **Read:** 14 and the **actual current** Kumiki registry files/video exporter.
- **Deliver:** record tested commit/version, install only needed registry source modules/dependencies under approved terms, small local compatibility probe for one infographic, MD1/MG1 frame sampling, CC1/visual geometry and VideoExportStage. No generic visual library rewrite.
- **Pass:** real imported API compiles, reproducible version pin, direct-seek first/middle/last frames agree on repeated runs, missing capability reports explicit error; no import from demo-only \`src/\` as a production contract.

**K02 — SemanticStoryboard → Kumiki adapter**
- **Depends on:** K01,C06,B04,A03. **Read:** 06,14,16.
- **Deliver:** translate approved semantic objects, BrandKit tokens, narration cues, named events and target profile to **implemented** Kumiki primitives. Scene/animation state derives from one rational-FPS absolute frame clock.
- **Pass:** same event IDs connect price/cost counter, narrator and visual reveal; unsupported visual intent fails clearly, brand change alters appearance without changing mathematical meaning; no duplicate transform/timeline schema.

**K03 — Meaningful cost-reveal animation**
- **Depends on:** K02,C02. **Read:** 06,14,15,16, Kumiki visual QA contract.
- **Deliver:** opening hook with house price, source-labeled component cost waterfall, monthly/30-year progression (or other calculable state transition), sensitivity or limitation, and conclusion. Text is stable during critical camera movement; motion has a narrated reason.
- **Pass:** beginning, key reveal and ending convey the intended explanation even as selected silent screenshots; seeded cost arithmetic mismatch, hidden numeral, camera crop and wrong reveal order fail; meaningful final takeaway appears after the setup, not from frame 1.

**K04 — MP4 exporter + audio mux**
- **Depends on:** K03,A05,A06. **Read:** 14 and current exporter script.
- **Deliver:** a served stage exposing \`VideoExportStage\` handshake, deterministic frame capture, duration/fps manifest, mastered WAV mux, MP4 plus subtitle file, artifact hashes and FFprobe report. Use existing Kumiki export entry point.
- **Pass:** local **30–60s 16:9 playable MP4** with synchronized speech/SFX, sound and captions; repeat render seeks reproduce frames, missing font/image/3D readiness fails, video/audio durations validated. Measure temp PNG/storage/time and clean only owned scratch.

**K05 — First release and QA gate**
- **Depends on:** K04,C04,B04. **Read:** 08,12,13,15.
- **Deliver:** preview player and selected beginning/reveal/end stills, complete release manifest binding BrandKit/script/hypothesis/voice/asset/tool versions, rights and error/warning findings. Explicit final approve/export, never automatic upload.
- **Pass:** opening fulfills title, promised number is computed, licensed assets exist, no missing voice/caption/audio, valid cover image, QA rejects seeded defects. **Human watches full final video and signs off on clarity, interest, color, timing, speech, and sonic balance.**

**M4 = R1 exit:** one true authored narrated explainer and thumbnail is demonstrably good and reproducible, not a slideshow or “generated video” claim based on screenshots alone.

## 8. M5 — Short-form, platform formats and variation

**P01 — Portrait layout resolver**
- **Depends on:** K05,B04. **Read:** 12,14,16.
- **Deliver:** versioned platform-safe regions and object composition variants; reflow chart/labels/safe caption bands for portrait, sequentialize wide comparison when needed.
- **Pass:** render at 1080×1920 with subject/essential text visible at final resolution, not a 16:9 crop; seeded safe-zone and subtitle-over-object defects fail.

**P02 — Short story adaptation**
- **Depends on:** P01,C05. **Read:** 15,16.
- **Deliver:** select an appropriate “instant result → cause → payoff,” “experiment → explanation” or “A vs B → threshold” short engine; rewrite *script and shot plan* for a compact complete claim, not a speed-up of long-form. Keep source/payoff trace.
- **Pass:** 20–60s fixture communicates one defensible result, strong first visual, actual answer and limitation; human sees full short; no deceptive unresolved curiosity gap.

**P03 — Destination export profiles**
- **Depends on:** P01,P02,K04. **Read:** 09,12,13.
- **Deliver:** separately versioned local export profiles for YouTube landscape/Shorts, TikTok, Instagram and Facebook; codec/fps/dimensions, title/caption/cover and UI overlays are configurable/verified at time of export.
- **Pass:** at least one landscape and one portrait target export, subtitles either correctly burned in or deliverable as sidecar; explicit unsupported profile/error. No claim that all social publishers accept a file without checking their changing rules.

**P04 — Brand/creative variation gallery**
- **Depends on:** C04,B05,P01. **Read:** 12,15,16.
- **Deliver:** three title-thumbnail pairs, associated opening preview and reasoned differentiation, with per-platform inspection size; preserve A/B variants and editability.
- **Pass:** one topic yields 3 meaningful alternatives, bad combination fails promise/claim QA, presentation remains brand-coherent and mobile-legible. Selection remains editorial, not a pretend viral predictor.

**M5 = R2 exit:** one authoritative concept yields original long-form plus portrait adaptation with distinct layouts, truthful hooks, good audio and reviewable title/thumbnail options.

## 9. M6 — Reliability, cost control and outcome learning

**S01 — Dependency graph and selective regeneration**
- **Depends on:** F05,B04,C06,A05,K04. **Read:** 02,03,13,14.
- **Deliver:** content-addressed DAG cache with typed edge declarations: text → speech/alignment → sound/mix → visual timing → render → package; brand palette → affected visual renders only; soundtrack change → mix/mux only. Track exact tool/model/license versions.
- **Pass:** modify one sentence and show which nodes rerun; music-only change must not rerender visual frames; approved old releases remain immutable; no invalid stale cue reuse.

**S02 — Bounded production queue and storage hygiene**
- **Depends on:** S01. **Read:** 02,08.
- **Deliver:** resource claim limits for RAM/disk/concurrency, pause/resume, per-job owned scratch quotas/TTL, cache eligibility tags and honest job progress.
- **Pass:** insufficient disk fails before large frame capture; repeated cancelled renders leave no owned orphan temp; shared models, user input and approved releases untouched; report peak memory and disk from a representative run.

**S03 — Observed analytics and experiments**
- **Depends on:** C01,P04. **Read:** 15,03,09.
- **Deliver:** manual/CSV authorized imports for public and private metrics **with distinct scopes** (views, impressions, CTR, 30s retention, watch time, RPM, platform native watch-time-share winners); observation dates and null/unknown.
- **Pass:** 3 competing hypotheses can be compared against actual recorded data, inconclusive test remains inconclusive, Shorts get no fake native thumbnail-test win, competitor views cannot be interpreted as revenue/CTR.

**S04 — Release approval and portable archival**
- **Depends on:** K05,P03,S01. **Read:** 08,09,12,13.
- **Deliver:** source manifests, rights/provenance ledger, immutable approved export revision, zipped local package, render/asset hashes and safe no-network prepare/publish interface. Publication adapters only after separately authorized.
- **Pass:** missing rights or evidence blocks approval; updating brand/voice/source doesn't mutate published package; verified export is playable without project source; no account/network required.

**M6 = R3 exit:** repeatable multi-brand media workflow, measurable failures, selective rerender, verified offline packages and optional observed feedback. Expand scale **after** demonstrating quality and manageable production effort.

## 10. Optional backlogs after video is real (former A–L scope preserved)

Do **not** obscure video progress by bootstrapping these in parallel. Select an individual backlog ID only when the video-first checkpoints are working or explicit business priority changes.

| ID | Feature from original roadmap | Implementable unit | Acceptance |
|---|---|---|---|
| R01 | Research Hub | import versioned source docs/passages, FTS5 and exact citations; durable source snapshots | two versions, conflicting claims, offline retrieval, duplicate and path permission failures |
| R02 | Research/SEO intelligence | dated, source-labeled SEO CSV/optional provider observations and keyword grouping; original evidence graph bounded | unknown vs zero, locale/device/date differences, source→claim→content navigation |
| R03 | Original articles | claim-backed brief → outline → sections → local Markdown/MDX editor/export and citations | readable original article from two supported sources; reject unsupported security/financial claims |
| R04 | Editor productivity | project tree moves, undo/redo, bulk asset linking and safe deletion preview | 1,000-node hierarchy cycle/brand checks, keyboard and unsaved-revision recovery |
| R05 | Real demo capture | authorized local demo of a **synthetic** app, truthful screen/audio syncing | reproducible click flow and genuine captured result; no invented features/screens |
| R06 | Characters | identity/pose/voice bible, approved cross-video appearances and optional audio-driven animation | two videos maintain same character ID and visible traits; rights and drift checks |
| R07 | Courses | objective map → lesson → exercise → answer key, package and offline approvals | a small complete lesson with checkable exercise and immutable release |
| R08 | Products/catalog | compose products from referenced artifacts; approved immutable manifests, versioned variants | modifying source doesn't modify released package; no Stripe by default |
| R09 | Publishing | user-authorized draft export → explicit human approve → idempotent publisher adapter | no duplicate remote post and no publication without permission |
| R10 | Internationalization | English/Japanese editorial/audio/caption variants with licensed CJK fonts and cultural review | proper glyph layout, truthful localization, stable claim refs and comparable runtime |
| R11 | Growth | source freshness queue, experiment history, related short→long viewer hypothesis | real dated analytics and traceable proposed revisions; no invented lift |

If the business priorities shift back to articles, follow **F01–F05 → R01 → R03**, then add R02/R04 as needed. This is an **explicit alternate track**, not a second default plan.

## 11. Dependency shortcut and next-task selector

**Critical path to first real video:** \`F01 F02 F03 F04 F05 → B01 B02 B03 B04 → C02 C03 C04 C05 C06 → A01 A03 A04 A05 A06 → K01 K02 K03 K04 K05\`. F06/B05 provide the UI; for the earliest offline CLI fixture, defer UI and persist via typed API. C01 market import and A02 real cloud TTS are valuable but **not blockers** for a labeled synthetic concept + imported approved narration.

**Critical path to portrait:** \`K05 → P01 → P02 → P03\`. **Quality/scale:** \`P03 → S01 → S02 S04\`; analytics \`C01 + P04 → S03\`.

**Choose next ID deterministically:** inspect git status and implementation, compare task acceptance against *actually running tests*. If prerequisites pass, choose the first incomplete task on the critical path. If a task is partially implemented, **finish its negative tests and fixture** before advancing. Only one task per OpenCode turn; stop at a missing capability instead of fabricating a mock "production renderer."

Suggested first command to OpenCode:

\`\`\`text
Read AGENTS.md, docs/INDEX.md and docs/10-build-plan.md.
Implement F01 only. Determine if the repository already has a runnable Rust
backend, React frontend and test tooling; preserve anything present. If F01
is already genuinely complete, report its tests and STOP, recommending F02.
Do not launch Codex or Work, make remote paid calls or install large models.
\`\`\`

## 12. Required handoff and review checkpoints

After each task, return a short reproducible report:

\`\`\`text
Task ID / status: PASS | BLOCKED
Existing state and base revision:
Changed files / migrations / public contracts:
Fixture executed and actual output paths:
Commands actually executed: success / failure / skipped (+ why):
Negative tests and QA findings:
Brand/voice/Kumiki versions and content hashes (if applicable):
Provider/network calls, rights status, downloads, dollar cost:
Disk use / peak RAM / temp cleanup:
Known gaps, regressions and reversibility:
Recommended next unlocked ID (do not start it):
\`\`\`

**Review and commit gates:** approve migrations/rights/creative direction before irreversible downstream work; don't merge generated files that fail real checks. Keep explicit tests and fixture assets small. Review at M0/M1/M2/M3/M4/M5/M6 boundaries with **actual previews and audible output**, not just passing TypeScript. The final decision of whether a video is premium, original, comprehensible or marketable requires editorial judgment; a validator must never present an invented "viral confidence" metric.

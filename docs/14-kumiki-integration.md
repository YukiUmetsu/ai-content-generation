# Kumiki-UI integration — contracts, not duplicate renderers

**Owner split:** ContentGen = research, script, BrandKit, assets, rights, voice/SFX/music generation, timeline orchestration, jobs, mastering, versioned packaging and publishing. Kumiki-UI = DTCG tokens, source-distributed visual registry, deterministic media/motion/infographic composition, camera direction and visual production safeguards. External adapter = frame capture, FFmpeg, optional 3D. **Never** introduce another media clock, semantic scene schema or branded copy of the Kumiki component library.

## Confirmed implemented surfaces (reviewed 2026-10-21)

- registry/media: still ArtboardDocument/MediaDocument, typography/geometry, SVG exporters, guides and layer stacks. **These are currently still-document subsets**, not a full persisted movie composition.
- registry/motion: MG1 integer-frame evaluator, storyboard, MotionDirector MD1, VT1 transformations, CC1 cinematic camera, ProcessJourney, diagram/reveal recipes; independent capabilities, not one production-qualified universal scene format.
- registry/visual: semantic production constraints, text exclusion, critical camera-framing/tracking checks; these measure declared geometry, not artistic quality.
- registry/video/video-export-stage.tsx provides local page handshake through window.__kmVideoExport (manifest + asynchronous seek(frame)) and [data-km-video-capture].
- scripts/export-video.mjs captures PNG frames using Playwright and encodes via FFmpeg; it accepts optional --audio for **already mixed** audio, not multiple lanes. It may use large temporary frame storage.

**Still proposed/deferred:** comprehensive docs/11 Composition schema, generalized audio lane playback/mixing, automatic provider TTS, full headless 2D/3D compositor and complete cinematic quality qualification. Do not generate unimplemented imports or pretend successful release gates.

## Versioned adapter contract

Build a **KumikiRenderAdapter** in ContentGen's optional TS worker, not the Rust domain layer. It consumes an approved SemanticStoryboard + BrandKit/DeliveryProfile snapshot + stable asset refs, resolves currently supported Kumiki source registry versions, then emits:
1. compiled/validated Kumiki authoring fragments and a locally served export page using VideoExportStage
2. a JSON export manifest with rational FPS, width/height, durationFrames, pinned fonts/assets/token hashes and capability diagnostics
3. a visual-only MP4 (or frame stream later), plus selected diagnostic snapshots and machine-readable QA findings.

Rust orchestrates this worker via typed IPC, verifies output hashes and owns content-addressed artifacts. Install only selected Kumiki registry items using source-distribution workflow, pin commit/release and dependency closure, and review diffs before upgrading. Never depend on Kumiki showcase/demo paths as stable production contracts.

**Temporal ownership:** ContentGen holds sample-precision speech/SFX data and semantic event IDs; Kumiki evaluates picture for absolute integer frame at rational FPS. Transform speech cue times to frame indices once; preserve original sample timestamps for music/SFX. One script change recomputes only dependent timelines and affected scene renders.

**Brand compilation:** BrandKit DTCG tokens → --km-* semantic theme overrides and pinned local fonts; scene recipe + aspect-specific layout (not blind crop) → registry components + MD1/MG1 timeline + CC1/visual preflight. Identity and layout decisions are editable, so generated video is reproducible.

**Render risks and priorities:** test deterministic direct-seek first/mid/last; explicitly await fonts/3D/image readiness; no CI per-frame screenshot analysis; human-watch a full representative output. The existing PNG-per-frame export is useful for first delivery, but optimize later with stream/incremental segment capture if disk/time benchmarks justify it. FFmpeg LGPL/GPL dependencies and codecs require separate distribution review.

## First integration fixture

Create a 30–60s illustrated cost-reveal explainer: verified numeric/example claims → script beats → Fish or mock TTS → alignment → meaningful Kumiki animations → semantic impacts, under-voice music ducking → mastered WAV → --audio export MP4 → QA. Re-render independently in YouTube 16:9 and a **recomposed** Shorts/TikTok 9:16 layout. Verify targeted regeneration after narrator/music/brand-kit changes, rights checks and no imported Kumiki runtime dependency in ordinary ContentGen editor UI.

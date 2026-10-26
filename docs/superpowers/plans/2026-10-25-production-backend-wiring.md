# Production backend wiring

Goal: selecting a saved idea can produce a source-linked script, storyboard and Director draft; each control reports actual results or an actionable failure.

Keep the existing Rust production/discovery ownership and Node local-media adapters. Reuse source search, bounded public-page capture, deterministic evidence extraction, script drafting and the existing renderer. Do not introduce another job runner, model download or publisher.

- [x] Reproduce missing evidence and script lifecycle failures with regression tests.
- [x] Add explicit production-owned evidence collection/restoration. Read canonical production/idea from Rust, reuse public-source capture and persist captured passages separately from immutable discovery. Never fabricate citations from public video metadata.
- [x] Connect the Script screen to collected evidence with loading, retry/cancel and saved-draft preservation.
- [x] Enforce script citations before accepting output and serialize local inference; propagate editor cancellation to model requests.
- [x] Exercise approved script → storyboard → Director → renderable job, including narration length boundaries.
- [x] Audit stage state and export controls against real render files. Avoid promising unsupported portrait/article rendering.
- [x] Run local frontend typecheck, lint, tests, headless contracts and build. Rust checks unavailable (no cargo); native browser visual QA and live installed-model/TTS verification remain unexecuted.
- [x] Review the final diff and prepare one PR without relying on GitHub Actions.

Review focus: navigation during generation, evidence arriving after mount, unavailable source/model/server, scripts whose narration crosses renderer limits, and stale media from an older script revision.

Validation: 593 frontend tests, 638 Node headless contracts, frontend typecheck, ESLint and build passed locally. Independent review found a cancellation propagation issue, fixed with a failing-then-passing regression; the final focused review found no important regressions. Existing build warnings remain for large chunks and Tailwind sourcemaps. No added packages or schema changes; checkout including dependencies/build is about 334 MB.

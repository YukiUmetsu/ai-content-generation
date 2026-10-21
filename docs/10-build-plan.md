# Implementation sequence and OpenCode tasks

**Rule:** complete one demonstrable vertical slice, execute checks, stop for review. The first release must **create a useful evidence-backed article offline**, not display a polished empty dashboard or 30 feature placeholders. The plan supersedes the prior overlapping M0–M22 numbering; **feature scope remains**, milestones are merged.

| Stage | Build and deliver | Concrete acceptance fixture |
|---|---|---|
| **A. Foundation** | Rust workspace/Axum/React, SQLite migrations, artifact store, provider profiles/mock, DAG skeleton, local startup/health and disk monitoring | Clean startup on Mac; typed API + DB write, mock article task; tests and `du` reported; no large downloads |
| **B. Durable Research Hub (P0)** | source import, immutable snapshots/passages, FTS5, research collections, notes, evidence links, cited retrieval | Two revisions of same source, exact cite, conflicting claim, offline search, duplicate prevention, permission denial |
| **C. First article (P0)** | local inference adapter when installed, structured brief/outline/sections, editor and Markdown/MDX export, citations and QA | Topic → original evidence-backed readable article; unsupported security claim blocked; provider unavailable yields actionable message |
| **D. Visual foundations (P0/P1)** | design tokens, editorial UI, SVG/diagram/infographic scene spec and reusable templates; deterministic renderer + QA | Three-panel explanatory diagram with deliberate overlap/clipping fixture; English/JA and mobile-size preview |
| **E. Graph + SEO memory (P0/P1)** | approved/inferred entity/claim edges, hybrid search optional, keywords/clusters/datable snapshots, optional GSC/OpenSEO adapters | source → claim → article trace; CSV keyword import/offline opportunity queue, date/market/provider disambiguation; no invented search volume |
| **F. Productive editor (P1)** | project tree, article/canvas editor, undo/versioning, progress/QA navigator, accessibility and visual regression | drag/move/undo, save and selective regeneration, keyboard and reduced motion, no clipped labels at 360/768/1280px |
| **G. Script + sound (P1)** | storyboard, beat/scene specs, local TTS adapter, real timing, captions/STT and segmented regeneration | 30s narrated lesson; regenerate one phrase; inserted missing narration detected |
| **H. Explanatory video (P1)** | slides, motion renderer adapter, exported video, sampled frame/timeline QA, portrait composition | 45s relevant instructional animation, offscreen-label/black-frame defects caught; independent 9:16 layout; targeted rerender |
| **I. Real demonstration and thumbnails (P1)** | dummy-app automation/recording/annotations; thumbnail template editor with multiple variants, mobile preview | assert real UI operation, capture/sync, no fabricated frames; generate 3 legible variants without diffusion model |
| **J. Reusable identity + catalog (P1)** | brand/project consistency, character bibles/approved assets, names/voices, reusable sprite gestures, product versioned bundles | same approved mascot across two outputs; lipsync/rights tests; freeze exported release, verify upstream edits don't mutate it |
| **K. Growth and reuse (P1)** | performance imports, SEO experiments, English/JA adaptations, scheduled briefs, stale-source impact detection, safe PR publishing | one content topic → article/Short/infographic; source change produces review queue; dated metrics retain completeness; publishing gated |
| **L. Interactive products (P1/P2)** | course objectives/prerequisites, exercises/simulations, packaged lessons, offerings and optional future commerce | complete objective → lesson → exercise with verifiable test → immutable course release; no payment dependency |

**Priorities when constrained:** A → B → C → D → E → F, then real demos/thumbnails/media based on actual audience value. Data ownership for brands, projects, characters and immutable releases must be established in A even if UI ships later. Do not prioritize generative character video or a dedicated graph server over research/search correctness.

## Per-stage delivery protocol

1. Read `AGENTS.md` and domain owner docs from `INDEX.md`; enumerate files and observed existing state before proposing edits.
2. Write a short implementation plan listing interfaces, migrations, adapters, tests, expected model/download size and definition of done.
3. Implement a working fixture using deterministic/mock providers; only integrate real optional tool after checking platform/API/license and user approval for download/cost.
4. Test: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, frontend typecheck/test/build as applicable, plus targeted media/database/visual checks. Do not claim a skipped check passed.
5. Run the fixture and inspect result (screenshots/frames/citations/SQL history), report disk/cache sizes and any external actions. Stop; let next task be explicit.

## Copyable initial agent prompt

```text
Read AGENTS.md, docs/INDEX.md and docs/10-build-plan.md. Work on stage A only.
Inspect the repository first. Preserve existing code/data. Use Rust Axum +
SQLite migrations and React, typed capability interfaces, mock providers,
small dependencies, and disk-efficient Cargo profiles. Do not install media
models or make remote/paid calls. Implement one runnable demonstration and
show actual fmt/clippy/tests/build output, changed files, disk usage, gaps.
```

## Focused follow-up task templates

- **Research:** “Implement stage B using `03-data`, `04-research-seo`, `08-assurance`. Demonstrate snapshot→passages→FTS5→exact citations, including contradiction and no-network fixture.”
- **SEO:** “Add only dated, provider-sourced keyword/market metrics and one offline opportunity query. No volume inference, no paid API use; test null/locale/device distinctions.”
- **Visual:** “Implement one editable explanatory SVG template and the seeded geometry QA fixture; preview at final display sizes and provide screenshots.”
- **Video:** “Render one script with meaningful visuals synchronized to real audio, detect at least two seeded frame/scene defects, and rerender only affected scene.”
- **Catalog:** “Create draft product and immutable release snapshot from exact artifact hashes, with offline rights validation and approved-release mutation test. Do not connect Stripe.”
- **Quality review:** “Find violations against the relevant spec, prioritize blockers, run targeted tests, fix minimal set, then report evidence and remaining known risks.”

**Handoff format:** `Implemented / Modified files / Fixture output and location / Commands actually executed and results / QA evidence / Disk & RAM impact / New licenses and external calls / Gaps / Next recommended stage`. Maintain compatibility notes if the older 38-document specification has already influenced generated code.

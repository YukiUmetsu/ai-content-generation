# Current implementation status — ContentGen

**Code audit:** 2026-10-31, ContentGen `main` baseline `cc0f013` plus draft PR #135's visual-copy QA. This is a source-level inventory, **not** proof that a user's particular machine, provider credentials or full-length MP4 works. Recheck after merges. The exact Kumiki vendor revision is always `apps/web/kumiki.config.json`, not a commit copied into prose.

## What runs in this repository

| Area | Implemented boundary | Important limitation |
| --- | --- | --- |
| Local application | Rust/Axum server, SQLite migrations, React/Vite Studio, project/research/content/settings/navigation, persisted Jobs API | Some tools remain local-browser or standalone test workflows; opening a page is not proof that a background worker ran. |
| Discovery and evidence | Local YouTube observations, best-effort unofficial Google Trends, saved research capture/search, script/storyboard generation and safe source-link repair | Public views/relative Trends indices do not prove search volume, CTR, retention, earnings or factual truth; providers can fail. |
| Production | Seven-step project workspace with inline Video Director, **Generate draft video**, per-scene editing, status/progress, saved render revisions and downloads | No separate Director sidebar is required. Complete UI-edited scene → authorized narration → full MP4 and real process-restart recovery still need live acceptance. |
| Jobs and recovery | Rust/SQLite Jobs DAG and Node adapter with node ledgers, per-beat speech cache, verified encoded scene segments, cancel/retry and production history | Some stages still execute in the invoking Node process; durable ledger evidence is not automatic process resurrection. |
| Speech and sound | Opt-in Fish/local TTS interfaces, sample-precise narration timing, SFX/mixed WAV, captions, Sound Studio and imported reviewed CC0 ambience/music | Actual voice/rights authorization and provider availability must be checked. Standalone `audio.mjs` music input is unsupported; reviewed music enters as an ambience track. |
| Video output | Pinned Kumiki `VideoExportStage`, native general-explainer landscape and **manual general-explainer portrait**, Chromium frame capture, bounded FFmpeg H.264 segments, FFprobe/QA, per-scene review stills | House Math/test-topic and destination capabilities differ; portrait availability does **not** mean every template supports portrait. Tests do not establish cinematic quality or a published release. |
| Assets | Openverse suggestions, optional independently validated Commons CC0 still preparation, Pexels single-page/local import, reviewed scene photo/H.264 bindings, hashed media serving | Poly Haven is not an auto-search dependency; 3D model imports are not general-scene composited; license review remains required. ComfyUI-generated asset packs are **not implemented**. |
| Characters | Character Studio ZIP inspection/saved revisions, calibration, project Pip/Quill cast bindings, real Kumiki `CharacterPresenter` export paths and focused browser smoke | No universal arbitrary-character production binding, guaranteed phoneme lipsync, or automatic incorporation of pose-correction sidecars into MP4. |
| Packaging | Three automatic Kumiki thumbnail PNG/SVG concepts in completed video releases; saved packaging-hypothesis API returns actual latest SQLite content or **204** when absent | No synthetic packaging fallback, guaranteed finished premium thumbnail or automated publishing. |

## Kumiki-UI rule

The project owner **approves the existing Kumiki-UI components for production use**. That is a design decision; do not re-impose aesthetic approval on the upstream library. ContentGen currently vendors commit **`e1f0d04e826c551a6e6c50c42ab4416cb51cf133`** (inspect config for changes). Upstream scene templates such as ST1, FS1, environment parallax and CC1 **may be approved but absent from this pinned vendor closure**. Integrate required components with `pnpm --dir apps/web kumiki:update` and verify source dependencies, typecheck, frame-seek, headless export and actual ContentGen MP4. Do not claim a missing component is already available.

The next visual-quality implementation is detailed in [23 — visual quality foundation](23-visual-quality-foundation.md). The initial `audienceCopy`/editorial-leak/repeated-schematic guardrails in draft PR #135 **do not** produce a premium scene by themselves. No first premium desk/invoice demonstration MP4 has been produced by that PR.

## Source of truth and documentation categories

- **Run and troubleshoot:** [root README](../README.md), [app README](../apps/web/README.md), [Production guide](production-workflow.md), [one-click delivery notes](22-one-click-video-production.md), [Character ZIP guide](how-to-import-character-pack.md).
- **Design/acceptance contracts:** numbered [specification index](INDEX.md), including [10 — build-plan](10-build-plan.md). These express target quality and tasks, **not** feature-completion flags.
- **Historical design work:** `docs/superpowers/specs/` and `docs/superpowers/plans/` preserve decisions and investigation **as of the file's date**. Do not follow an old “not implemented” or obsolete approval gate when current code contradicts it. Follow current code, migration tests and then the domain owner.
- **Dated market research:** `docs/research/2026-10-21-video-market-scan.md` is a point-in-time snapshot. Refresh market/platform/price claims before use.

## Basic verification commands

From repository root with installed dependencies:

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web test
pnpm --dir apps/web test:video:headless
pnpm --dir apps/web build
pnpm --dir apps/web kumiki:verify
cargo test --workspace
```

`test:video:headless` needs its documented FFmpeg/FFprobe dependencies; actual browser capture additionally requires an installed Chromium. `cargo` and frontend dependencies must be installed locally. Do not report a test as passing unless it was run. Real media release checks still require a complete authorized MP4, actual playback and artwork/voice rights review.

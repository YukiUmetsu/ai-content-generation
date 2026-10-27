# One-click private video draft (incremental delivery)

The **Generate draft video** action in a saved YouTube production now:

1. Locates only that production's completed YouTube script (other destination drafts are independent).
2. Refreshes its saved storyboard, preserving unaffected scene edits and backing up the previous document before any overwrite.
3. Compiles a renderable Director plan without requiring script or scene-plan approval. Unsupported factual claims are draft warnings, not publishing clearance.
4. Opens the actual production controls with an automatic-start intent. Preflight starts immediately. If a voice, consent, FFmpeg or Chromium requirement is missing, the corresponding setup stays visible with a retry action.
5. Submits the real render's dependent stages to the Rust Jobs scheduler before starting TTS or media work. The renderer records state transitions through the local worker endpoints and can be cancelled. The same jobs appear in Jobs and their IDs are linked from Director.
6. Shows rendered-frame progress and, on success, the playable MP4. It never publishes automatically.

## Runtime dependencies

The local Rust server on `127.0.0.1:8787` must be running; production jobs intentionally fail closed if persistent tracking cannot be created. Override only with a loopback `CONTENTGEN_JOBS_ORIGIN`. The Node renderer uses its existing Chromium, FFmpeg and authorized Fish/local TTS integrations. Provider credentials must not be persisted in Jobs.

Worker transition routes are `POST /api/jobs/{job_id}/nodes/{node_id}/{start|succeed|fail}`. They are local-process-only; they validate the bound job/node and reject Origin-bearing browser requests. The Rust scheduler serializes transitions in SQLite. On server restart, its existing orphan-reconciliation routine marks interrupted attempts failed rather than presenting phantom running work.

## Current scope and limitations

This increment tracks the existing scene planning, visual preflight, narration, timeline, audio mix, frame rendering, mux, quality checks, and export. A single local render worker carries out those stages; it is **not** yet a resumable per-asset executor. Failed attempts are terminal for this draft revision rather than creating an unclaimed automatic retry. Manual per-node retry and resumable execution still need a dedicated worker/resume contract.

The existing asset discovery screens, sound library, thumbnail alternatives, rig studio, visual scene editor, and Kumiki renderer remain separate tools. This increment **does not** wire Pexels/Pixabay/Wikimedia/Freesound searches, stock downloads, thumbnail generation, caption export, or character animation as individually executable Jobs nodes. No provider should be presented as having verified commercial rights merely because an API returned an asset.

Provider integration should require per-result attribution/source/license metadata, restrictive download and media-type validation, optional human selection, provider-specific caching/rate limits, and manual publication review. Unsplash's API rules around image URLs and tracking are different from Pexels and Pixabay; Wikimedia Commons and Freesound carry file-specific licensing. Mixkit is typically a browsing/download catalog rather than a generic authenticated search API. Reevaluate current vendor terms before implementing automated downloads.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:video:headless`, and the frontend Vitest suite from `apps/web`. Rust tests require the Cargo toolchain: `cargo test -p contentgen-server production_worker_attempts_are_durable_and_authorized`.

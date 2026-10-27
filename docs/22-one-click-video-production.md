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

This increment tracks the existing scene planning, visual preflight, narration, timeline, audio mix, frame rendering, mux, quality checks, and export. A single local render worker carries out those stages; it is **not** yet a resumable per-asset executor. Failed attempts are terminal until the user explicitly retries Generate draft video. That operation re-arms only the failed node in a SQLite transaction while preserving completed step records, although a new local render may repeat earlier work if its outputs cannot be reused. Independent per-asset retries and resumable execution still need a dedicated worker/resume contract.

The existing asset discovery screens, sound library, thumbnail alternatives, rig studio, visual scene editor, and Kumiki renderer remain separate tools. This increment **does not** wire Pexels/Pixabay/Wikimedia/Freesound searches, stock downloads, thumbnail generation, caption export, or character animation as individually executable Jobs nodes. No provider should be presented as having verified commercial rights merely because an API returned an asset.

Provider integration should require per-result attribution/source/license metadata, restrictive download and media-type validation, optional human selection, provider-specific caching/rate limits, and manual publication review. Unsplash's API rules around image URLs and tracking are different from Pexels and Pixabay; Wikimedia Commons and Freesound carry file-specific licensing. Mixkit is typically a browsing/download catalog rather than a generic authenticated search API. Reevaluate current vendor terms before implementing automated downloads.

| Source | Practical production use | Integration caution |
| --- | --- | --- |
| [Pexels](https://www.pexels.com/api/documentation/) | Photo/footage search is already exposed by the separate scene-asset discovery tool | Require a developer API key; preserve creator/source and review the [Pexels License](https://www.pexels.com/license/) before publication. |
| [Pixabay](https://pixabay.com/service/about/api/) | Candidate photos, footage, illustration, sound | Review its [Content License](https://pixabay.com/service/license-summary/) and API limits; an API result does not certify trademarks or releases. |
| [Unsplash](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines) | Photo search and preview | API integration requires specified hotlinked URLs, download tracking and photographer attribution; its current guidelines discourage unattended bulk experiences. Do not treat it as a drop-in offline cache. |
| [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) | Historical/scientific imagery | License is per file (CC variants, public domain, etc.); store author, license version and attribution conditions. |
| [Freesound](https://freesound.org/docs/api/) | Scene-matched SFX | Filter by the actual clip's CC license and archive creator/source; avoid NC material when drafting for commercial video. |
| [Mixkit](https://mixkit.co/license/) | Manual stock-video/music/SFX selection | Product categories have **different** terms, including restricted stock-video variants. Free SFX can generally be used in videos, but raw-asset redistribution is not allowed. |

The current automatic draft uses Kumiki-generated visual scenes and the existing authorized sound pipeline. None of the proposed additional stock sources above is silently downloaded or marked release-ready.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:video:headless`, and the frontend Vitest suite from `apps/web`. Rust tests require the Cargo toolchain: `cargo test -p contentgen-server production_worker_attempts_are_durable_and_authorized`.

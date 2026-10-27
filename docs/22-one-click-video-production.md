# One-click private video draft (incremental delivery)

The **Generate draft video** action in a saved YouTube production now:

1. Locates only that production's completed YouTube script (other destination drafts are independent).
2. Refreshes its saved storyboard, preserving unaffected scene edits and backing up the previous document before any overwrite.
3. Compiles a renderable Director plan without requiring script or scene-plan approval. Unsupported factual claims are draft warnings, not publishing clearance.
4. Opens the actual production controls with an automatic-start intent. Preflight starts immediately. If a voice, consent, FFmpeg or Chromium requirement is missing, the corresponding setup stays visible with a retry action.
5. Submits the real render's dependent stages to the Rust Jobs scheduler before starting TTS or media work. The renderer records state transitions through the local worker endpoints and can be cancelled. The same jobs appear in Jobs and their IDs are linked from Director.
6. If **Search free scene media** is enabled, records an `asset-search` Jobs node after browser preflight. It sends bounded scene-subject searches to Poly Haven and configured Pexels, stores metadata-only ranked suggestions in the job-owned output folder, and shows them again in Director → Find the right visuals. Search errors fall back to Kumiki visuals without holding narration hostage. Downloads and stock placement still require separate review.
7. Shows rendered-frame progress and, on success, the playable MP4 with direct MP4, SRT caption, and renderer-captured cover-frame PNG downloads. The cover is not presented as a designed thumbnail. It never publishes automatically.

## Runtime dependencies

The local Rust server on `127.0.0.1:8787` must be running; production jobs intentionally fail closed if persistent tracking cannot be created. Override only with a loopback `CONTENTGEN_JOBS_ORIGIN`. The Node renderer uses its existing Chromium, FFmpeg and authorized Fish/local TTS integrations. Provider credentials must not be persisted in Jobs.

Worker transition routes are `POST /api/jobs/{job_id}/nodes/{node_id}/{start|succeed|fail}`. They are local-process-only; they validate the bound job/node and reject Origin-bearing browser requests. The Rust scheduler serializes transitions in SQLite. On server restart, its existing orphan-reconciliation routine marks interrupted attempts failed rather than presenting phantom running work.

## Current scope and limitations

This increment tracks scene planning, visual preflight, **optional scene media search**, narration, timeline, audio mix, frame rendering, mux, quality checks, and export. A single local render worker carries out those stages; it is **not** yet a resumable per-asset executor. Failed attempts are terminal until the user explicitly chooses **Retry draft video**. Retry rechecks current requirements and re-arms only the failed Jobs node in a SQLite transaction while preserving completed step records. New Jobs store the original run UUID in immutable node input: even after a restart, a retry of the exact same render identity can reuse individually hash-verified narration beats from the interrupted run's owned cache. This never treats failed video segments as an approved release or bypasses voice authorization. Earlier jobs without a run UUID and unavailable/damaged cache entries regenerate speech normally. Unchanged renderer stages may still repeat work; independent per-asset retries and true step-level resume need a dedicated worker contract.

Terminal failures record a stage-specific code and recovery instruction in Jobs, without copying raw provider diagnostics or credentials to that durable record. The Export screen exposes a single retry action. Media imports, after explicit per-asset rights approval, retry idempotent GET transfers twice on transient network/server failures (bounded backoff), but stop on rate limits, invalid hosts, media validation errors and cancellation. No partially downloaded file is registered as an approved asset.

The existing asset discovery screens, sound library, thumbnail alternatives, rig studio, visual scene editor, and Kumiki renderer remain separate tools. **The `asset-search` node only searches Pexels/Poly Haven metadata** and records ranked alternatives; it is not a downloader or an automated footage compositor. This increment **does not** wire Pixabay/Wikimedia/Freesound searches, stock downloads, thumbnail generation, caption export, or character animation as individually executable Jobs nodes. No provider should be presented as having verified commercial rights merely because an API returned an asset.

Sound Studio now offers an opt-in, bounded Openverse **CC0 music** search by mood/instrument alongside sound-effects search. Both return metadata and previews first, require checking the source plus explicit approval before local import, and re-fetch authoritative detail to verify the category. Hash-verified imported music can be selected as the single quiet looping background bed using the existing ambience track, gain, fade and local audio-master pipeline. Music is never silently reclassified as a short sound effect or substituted in automatic shot suggestions. Audio downloads remain bounded by the approved library's file limits; long tracks must be edited externally first. This is **not** unattended selection or a separately resumable music-download Jobs node.

Approved Openverse SFX/music GET transfers now use a shared 45-second deadline and at most three attempts for temporary network/server errors or truncated declared downloads. HTTP 429, invalid metadata, wrong licensing, cancelled requests and invalid WAV content are not retried into apparent success. Cancellation is also checked during FFmpeg normalization and before the import becomes visible in the approved sound bank. The import stays unregistered until verification, normalization and local manifest commit finish.

The exported `cover-still.png` is a verified first frame of the Kumiki render, also indexed for a direct download on the Production Export page. It is a useful base for artwork, **not** one of the promised editable designed thumbnail variants. Automatic design generation, connecting saved Publish Kit artwork to renderer-owned releases, and separately retryable thumbnail Jobs remain to be implemented.

The existing standalone Create → Thumbnail Composer now persists its three editable variants, active selection and palette by project/owner ID in browser storage, and reloads them after navigating away. If a saved document fails validation, it is left untouched; deliberate recovery copies the original into a timestamped recovery entry before initializing a new draft. This is **not** automatic production-specific thumbnail design or an independent Jobs stage. Publish Kit's existing thumbnail editor remains the production destination; no duplicate editor was added there.

Publish Kit's thumbnail editor now retains manual copy, artwork, palette and layout **per production and destination** when a script is regenerated. Unedited headline suggestions follow the newest script title. Matching legacy revision-scoped drafts are migrated without deleting their old copy. A corrupt saved thumbnail is never silently overwritten: controls pause until the creator explicitly backs it up and starts fresh.

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

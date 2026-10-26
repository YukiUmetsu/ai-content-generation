# Character Studio & Character-led Production — ContentGen Implementation Brief

**Status:** proposed, documentation only. **Priority:** reusable 2D/2.5D characters; optional 3D/imported rigs. **Goal:** produce consistent talking/acting characters affordably across video, interactive lessons, stories, ads, tutorials, avatars and other content—not one channel or character style.

**Upstream dependency:** Kumiki-UI's [reusable character-performance proposal](https://github.com/YukiUmetsu/kumiki-ui/pull/40) and canonical [`docs/10-character-audio.md`](https://github.com/YukiUmetsu/kumiki-ui/blob/main/docs/10-character-audio.md). Pinned, implemented registry items—not an open PR or design-only API—are required before enabling render features. A static/unsupported capability must be labeled honestly.

## Ownership and no-duplication rules

| Already in ContentGen | Extend; do not build a parallel subsystem |
|---|---|
| [`docs/production-workflow.md`](../../production-workflow.md), `apps/web/src/app/production-workspace.tsx`, `video-director-workspace.tsx` | Add optional cast/dialogue/action controls to existing Script → Plan Scenes → Create Video, retaining revision handoffs; no separate video-making wizard. |
| [`docs/13-audio-production.md`](../../13-audio-production.md), `apps/web/scripts/video-production/{speech,fish,audio}.mjs` | Reuse provider-neutral `VoiceProfile`, beat synthesis, alignment and mixing designs. No character-specific TTS client, duplicated voice registry, or lip-sync recognizer in the UI. |
| [`docs/21-scene-asset-discovery.md`](../../21-scene-asset-discovery.md) | Reuse content hashes, rights/provenance and explicit human approval patterns. Character rigs require persistent identity/versioning beyond scene-specific stock assets. |
| [`docs/14-kumiki-integration.md`](../../14-kumiki-integration.md), `apps/web/kumiki.config.json`, `scripts/vendor-kumiki.mjs` | Consume Kumiki's pinned character presenter through the existing source-vendoring/export adapter. Never fork MG1, build a second render clock, or edit vendored component sources in place. |
| `crates/core/src/jobs.rs`, `crates/server/src/jobs/`, [`migrations/0001_evidence_packaging_jobs.sql`](../../../migrations/0001_evidence_packaging_jobs.sql) | Every expensive character/voice/preview/render task goes through the **generic durable job DAG** and appears in Jobs. No character-specific worker queue or hidden untracked progress state. |
| Project/BrandKit, storyboard and production persistence | Keep brand palettes, editorial source evidence, immutable script versions and approved scene edits intact. Characters are reusable project-linked assets, not research claims or brand colors. |

**Current gap (2026-10-26 review):** no durable character catalog, published rig revisions, production cast/performer bindings or generic dialogue/action editor was found. Reinspect `main` before implementation; skip any functionality already added upstream.

## Chosen approach and alternatives

- **Chosen — reusable character catalog + existing Director.** Author/approve a character once; reference its immutable revision in any project/shot. Script and scene direction select speakers, expressions and actions. Kumiki animates, ContentGen supplies voice/audio cues and renders. Lowest repeated generation cost and least duplication.
- **Rejected as default — generate every speaking scene with image/video AI.** Useful as an *optional* reviewed special shot, but expensive, hard to reproduce, and prone to identity/pose drift.
- **Later — automated rig authoring/3D.** Assisted segmentation or third-party rigs can propose parts, anchors and views after a manually approved layered-2D/2.5D path works. No promise of one-click fidelity from a flattened image.

## Consumer workflow

1. **Characters library:** create/import a character from a prepared transparent layer pack/atlas (PNG/WebP/sanitized SVG), optional approved rig manifest and source reference; choose scope (reusable library plus permitted project links).
2. **Validate & rig:** inspect layers, part hierarchy, pivots, anchors, masks, poses, visemes and supported actions in a preview. Unsupported actions/views require manual art or an explicit fallback; never hallucinate hidden geometry.
3. **Voice & personality:** bind an existing logical voice profile (provider mapping, locale/pronunciation, consent) and optional writing/personality guidance. Audition real dialogue; keep fictional persona guidance separate from research facts and citations.
4. **Publish revision:** visually approve the rig and voice association. Store immutable definition version, asset hashes, license/consent state, preview reference and approval audit. Later edits create new revisions; old productions stay pinned.
5. **Assign cast:** in a project/production choose one or more registered actors and optional outfits/skins. Set `castId`/`instanceId` independently of `characterId` so one character can appear twice in a scene without sharing animation state.
6. **Direct scenes:** optionally convert approved narration into explicit speaker turns, dialogue lines, emotions, gestures, gaze and prop targets. Edit per shot in the current Video Director; preserve unscripted narration and visual-only scenes. Preview the actual target renderer before acceptance.
7. **Produce/reuse:** synthesize only changed speech beats, align mouth cues, compile actions to pinned Kumiki frames, render changed shots, mix/mux, inspect QA, and export platform-specific outputs. Revisions invalidating preview/render readiness require recheck; no silent regeneration or publish.

## Durable data and interfaces (proposal)

Add validated Rust domain types and SQLite migrations; store bulky media as local content-addressed files with DB metadata, not inline DB blobs or browser localStorage. Apply project ownership/authorization to every catalog link and shot reference.

| Entity | Minimum fields/invariants |
|---|---|
| `Character` | Stable ID, display name, optional description/tags, owner/scope, created/updated timestamps, archived flag. Not tied to project or anatomical type. |
| `CharacterRevision` | `(characterId, revision)`, `draft/approved/retired` status, Kumiki-compatible definition/rig ref and SHA-256, mode `sprite-2d/puppet-2.5d/optional-adapter`, capabilities, immutable approval provenance. Approved revisions never mutate. |
| `CharacterAsset` | Content hash, approved local path/resolver key, MIME/dimensions, license/source/attribution, consent/voice rights where applicable, size, validation result, reference count/retention policy. |
| `CharacterProjectLink` | Character visibility/role scoped to project; explicit add/remove, no cross-project read leakage. |
| `ProductionCast` | Production/approved-script revision, `castId`, pinned `characterId@revision`, logical `voiceProfileId@revision`, optional skin/view and constrained appearance overrides. |
| `PerformanceBeat` | Stable `beatId`, `shotId`, optional script-section/claim refs, `castId`, dialogue text/locale, delivery/expression, semantic action/gaze/prop events, time/cue bindings and draft/accepted status. |
| `RenderSnapshot` | Exact script/storyboard/cast/rig/voice/audio/alignment/brand/asset hashes, renderer and export-profile versions, approved rights and QA receipts. |

Expose consistent project-aware endpoints conceptually: `GET/POST /api/characters`, `GET /api/characters/{id}/revisions`, `POST /api/characters/{id}/revisions/{rev}/approve`, `GET/PUT /api/productions/{id}/cast`, `GET/PUT /api/productions/{id}/performance`; choose exact routes per existing server conventions. Validate content type/size, JSON depth, IDs, revision conflicts, dependency capabilities and asset/path allowlists. Side effects require authenticated, authorized, same-origin or token-validated requests; never trust client-provided disk paths or download URLs.

**App layout suggestion:** `crates/core/src/characters.rs` for validated shared types; `crates/server/src/characters/{api,store}.rs` for persistence/authorization; `apps/web/src/features/character-studio/` for the catalog and rig inspector; existing `video-director-workspace.tsx` for cast/action bindings; existing production workers/renderer for compilation. Prefer additive migrations and tests. Do not create a duplicate editor shell, BrandKit or motion library.

## Script, animation and audio handoff

- **Structured dialogue:** preserve section-level editorial evidence and accepted text; add speaker/beat metadata rather than parsing character names from prose at render time. Source-linked factual claims must remain source-linked after adaptation. Changes to speaker, text or delivery invalidate dependent audio/visemes/action timing; unrelated shots remain cached.
- **Actions:** emit generic semantic instructions (`idle`, `blink`, `speak`, `look-at`, `point`, `wave`, `walk-path`, `react`, `hold-prop`) plus user-defined names verified against the pinned rig capabilities. Allow concurrent channels, magnitudes, easing, interruption, action presets, target anchors, scene-relative placement and animation bounds. Never hard-code human limbs, owl wings, or a fixed gesture set.
- **Speech:** resolve logical voice to an approved provider/local voice mapping, synthesize/import beat-level audio, perform external alignment, retain sample-domain timing, and convert to Kumiki frame cues **once**. Label viseme accuracy (`exact`, `phoneme-mapped`, `approximate`, `none`), support optional pronunciation preview and manual mouth-cue corrections. Local/offline preprocessing is preferred where adequate; provider keys and voice samples never enter scene JSON or frontend logs.
- **Render:** only pass immutable, rights-checked character/voice/rig/scene refs into the pinned Kumiki adapter. Use current preview and FFmpeg/export infrastructure; its frame clock remains authoritative. The product must not claim an imported 2D or 3D character is composite-ready while the current generic renderer only saves it as a scene reference.
- **Cache:** key speech by beat text/locale/voice mapping/pronunciation settings/rights scope; animation by rig revision/actions/alignments/frame range; scene output by all dependent visual/audio hashes. Include cache invalidation for voice, rig, outfit, dialogue, backdrop, masks, aspect ratio and renderer upgrades.

## Interactive and personalized output (optional consumer extension)

Author *branch metadata*, not a second video engine: question ID, pause frame, answer choices, correct/incorrect or arbitrary outcome branch cue IDs, reaction segment refs and resume target. Export conventional linear video without runtime quiz controls; an interactive website player may consume the same approved shots and play conditional reaction segments. Pre-render shared footage once and use short personalized TTS/viseme/overlay segments when permitted; do not generate an entire MP4 for every name by default.

`viewerName`, rank, badge, title and progress are **consumer-supplied, typed, bounded slots** with explicit defaults and a pronunciation-preview path—not unrestricted template evaluation. Viewer accounts, billing, parental consent, privacy retention/deletion and customer-specific media access belong to the hosting website, not ContentGen or Kumiki. No real viewer identifiers in fixtures, thumbnails, logs or shared renders.

## Jobs, reliability and UX

- **One job path:** `character.validate-assets → character.preview-rig → voice.synthesize → speech.align → performance.compile → shot.render → audio.mix → export.verify`. Declare dependencies only for steps used; empty/unchanged nodes are reused or skipped visibly. Submit through the generic DAG scheduler with input-hash idempotency, bounded retries, cancellations and persisted attempts. Every run is selectable in Jobs; don't spawn hidden long-running HTTP workers.
- **Failure behavior:** preserve approved revisions and accepted scene edits; report missing layers/anchors, unsupported rig actions, malformed phonemes, voice rights, provider timeout, clipping, frame drift and invalid media with specific actionable error codes. Retry only safely idempotent tasks; never silently replace a voice/rig, publish a partial render, or consume paid credits without clear budget/consent.
- **Editor design:** Characters entry in reusable assets/project cast; compact registration wizard (Import → Map parts → Voice → Test → Approve). In Create Video, one cast selector and per-shot dialogue/action timeline with quick presets, live preview, optional advanced inspector, easy clear/revert, visible saved state, and keyboard/accessibility support. Avoid competing character pages or duplicate color pickers; reuse Kumiki components and project BrandKit.
- **Asset security:** enforce file limits, MIME signature probes, non-executable sanitized SVG, archive traversal protection, path/URL allowlists, content hashes and provenance; never implicitly upload local private images or clone voices without permission. Require explicit commercial/output rights and consent before public export; flag uncertain AI-generated source-art rights for review.

## Implementation order and acceptance

| Phase | Deliverable | Gate before proceeding |
|---|---|---|
| **P0 — proof** | Two generic rights-cleared original layered 2D/2.5D characters with distinct voices, validated manifests, 30–45 s multi-speaker scene and independent body/face/mouth actions through pinned Kumiki | Normal-speed review; character identity stable; mouth pauses close; deterministic random seek/preview-export parity; no clipping/collisions; assets & voices cleared. No hard-coded mascot logic. |
| **P1 — reusable Character Studio** | Durable catalog/revision approvals, safe asset upload and rights metadata, rig inspector, voice binding, project cast/Director controls | Reload/restart retains state; references cannot cross project access boundaries; approved revision immutability; per-shot action overrides and undo; Storybook + frontend/unit/server integration tests. |
| **P2 — production-ready jobs** | Speech/align/compile/render DAG nodes, cache invalidation, verified segment reuse, cancellation, QA manifests, landscape/portrait variants | Every job appears in Jobs; retries don't duplicate paid requests or corrupt files; representative 8+ minute export under measured bounded scratch/memory; audit frame/audio sync and 16:9/9:16 framing. |
| **P3 — optional extensions** | Assisted layer segmentation, custom advanced puppet/mesh-deformation adapters, imported 3D/third-party rigs, interactive branch/personalization manifests | Capabilities/versioning/rights checked; static and unsupported fallbacks explicit; core 2D consumer still works without optional dependencies. |

**Tests:** Rust validation/migration/authorization and race-safe approve/publish; malformed or oversized art; broken part tree/anchor/asset hash; voice consent and provider-failure mocks; interrupted DAG resume/cancel; clip and cue timing at start/middle/end; cache invalidation; same character in two independent instances; unknown custom action; audio pauses and seek; content injection via character metadata/names; desktop/mobile UI states; Storybook character/scene examples; visual comparison of normal-speed exported videos. Use local checks; do not rely on paid GitHub Actions as the sole release gate.

**Definition of done:** from the existing ContentGen Production workflow, register and approve a neutral character once, assign it in two unrelated projects, make it speak and gesture naturally with another character, re-edit one sentence without rerendering unaffected scenes, export an auditable MP4, and use the same serialized approved performance in an interactive consumer—without another animation clock, job queue, or TTS provider integration.

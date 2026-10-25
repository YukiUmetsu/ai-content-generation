# ContentGen Studio Redesign — One-PR Implementation Plan

**Goal:** Ship one coherent, locally verified production workflow matching the approved ContentGen mockups. No GitHub Actions result is a release gate while the account has exhausted Actions credits.

**Stage order:** Setup → Discover → Select Idea → Script → Storyboard → Produce → Optimize → Export. The complete navigator remains visible on every production screen; saved stages can be revisited without erasing later work.

**Required semantics:** Projects own reusable brand identity; discovery sessions own research and saved ideas; productions belong to a project/session/idea (creating a production never creates a project). AI drafts scripts by default, each section supports bounded custom-instruction regeneration and accept/discard of suggestions. Optimize auto-prepares platform-specific upload packages for review. Project Brand & Appearance is a single tab with a unified five-role color editor (not duplicate color strips/headings), and colors flow into outputs.

## Parallel slices and ownership

- [ ] **Backend / sessions and productions** (owner: backend_sessions). Files: Rust server/core, migration 0010 and Rust tests only. Add session and production APIs while preserving all legacy routes. Test independent sessions, restart persistence, rejecting cross-project references, legacy data backfill and no five-idea cap. No invented opportunity scores.
- [ ] **Project appearance** (owner: brand_catalog). Files: catalog model/workspace and isolated appearance components/tests. Save `{primary,secondary,accent,background,text,custom[]}` as project brand appearance, map to existing Kumiki/thumbnail palettes, revision-safe and accessible. Do not edit app shell/production workspace.
- [ ] **Discovery workflow** (owner: discovery_ui). Files: discovery-specific workspaces, typed API client and tests, modify project discovery panel only. Session selector/create/rename/history and idea ranking/selection. Retain keyword/watchlist project panels but remove legacy five-ideas action. No duplicate production state.
- [ ] **AI script review** (owner: script_review). Files: isolated script review model/workspace, provider-neutral local script generator and tests; may add two script routes in director-studio Vite proxy. Source-backed, small retryable requests; manual edits and accept/discard revision history. No automatic overwriting approved sections.
- [ ] **Platform optimization** (owner: platform_optimization). Files: isolated platform-optimization feature and tests. Auto-prepared editable titles/descriptions/captions/thumbnails/hashtags where relevant, per-platform QA, durable draft and export manifests. No upload/publishing without explicit user action.
- [ ] **Integration** (owner: root). Files: top-level shell, production workspace/router, stage navigation and integration tests. Mount the above slices, wire existing storyboard/director/export tools, preserve step state and browse-back semantics, handle fallback/unavailable providers.

## Shared API contracts

All new JSON fields are `camelCase`. Session routes:

- `POST/GET /api/research/discovery/projects/{projectId}/sessions`
- `GET/PATCH /api/research/discovery/projects/{projectId}/sessions/{sessionId}`
- `POST /api/research/discovery/projects/{projectId}/sessions/{sessionId}/discover` with `{inputRevision}`
- `GET /api/research/discovery/projects/{projectId}/sessions/{sessionId}/runs`
- `GET /api/research/discovery/projects/{projectId}/sessions/{sessionId}/ideas`
- `POST /api/research/discovery/projects/{projectId}/sessions/{sessionId}/ideas/{ideaId}/decision` with `{decision,reason?}`
- `POST/GET /api/productions` and `GET /api/productions/{productionId}`.

Session properties: `id,projectId,name,platforms,settingsSnapshot,status,createdAt,updatedAt,archivedAt,lastRun?`. Idea properties: legacy candidate properties plus `sessionId,runId`, saved decision and nullable `opportunityScore,scoreVersion,scoreInputs,platformFit,sources`. Production create request: `{projectId,sessionId,ideaId,brief,platforms}`; response includes stable `id` and timestamps. Frontend may surface unknown rankings as 'Not measured', never as invented performance numbers.

Frontend integration contracts:

- `DiscoverySessionWorkspace` receives a project and optional session selection callback; `DiscoveryIdeaSelection` receives `projectId,sessionId,onStartProduction(idea,brief)`.
- `ScriptReviewWorkspace` receives `productionId,projectId,platforms,locale,title,viewerQuestion,audience,angle,brandVoice,evidence,onApprove`.
- `PlatformOptimization` receives an explicit normalized `PlatformOptimizationInput` with production/project identifiers, script sections, current title, brand colors, platforms and available assets; emits approved/review-ready manifest.
- Brand appearance lives in one Project tab; project palette data are read by production/thumbnail/platform tools via an adapter, not duplicated stores.

## Verification (local only)

- [ ] `cargo fmt --check`
- [ ] Targeted Rust session/production tests, then workspace tests and clippy if cached dependencies allow.
- [ ] `pnpm --dir apps/web run typecheck`
- [ ] Targeted frontend Vitest tests and `pnpm --dir apps/web run build`, subject to existing installed/cached dependencies.
- [ ] Check navigation across all eight stages, refresh/reopen persistence, script revision isolation, saved palette reuse and read-only export package generation.
- [ ] Assemble ONE commit and ONE pull request with all implemented slices, plus tested limitations. GitHub Actions credit-related failure is explicitly not treated as code failure; do not add skip-CI flags.

# Saved Search Before Storyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio search results independently visible, durable and reusable when later storyboard generation fails.

**Architecture:** A new local search-snapshot module performs SearXNG-only searches and writes bounded immutable JSON to the existing Studio research directory. The director bridge exposes search/save/list/load routes, while the Research UI loads/display saved leads and passes a validated snapshot ID into the original research→plan flow. Exact capture/quote validation remains unchanged.

**Tech Stack:** Node 24 ESM, node:test, Vite middleware, React/TypeScript, Vitest, local filesystem.

**Spec:** `docs/superpowers/specs/2026-10-23-saved-search-before-storyboard-design.md`

## Global Constraints
- Search must work without any local LLM.
- Source leads are not Evidence Library verified passages; never assign verified status.
- No external writes, dependencies, new migrations or secret exposure.
- Existing loopback same-origin guard, checked public HTTPS URLs and exact quote validator remain strict.
- Bounded local immutable snapshots with stable IDs; user must be able to restore after browser reload.

## Review Focus
- Empty SearXNG results: explicit empty state, no bogus saved item (Task 1).
- Reused search doesn't match edited viewer question/locale: reject before generation (Task 2).
- Read/search API with invalid or tampered ID: path guard and hash check (Task 1).
- Local model failure or cancellation: saved search remains visible, generation can retry without new search (Tasks 2, 4).
- Different topic while request is in flight: old results cannot be attached to edited brief (Task 4).

---

### Task 1: Search-only immutable snapshots
**Files:**
- Create: `apps/web/scripts/video-production/studio-search.mjs`
- Create: `apps/web/scripts/video-production/studio-search.test.mjs`
- Modify: `apps/web/scripts/video-production/research-agent.mjs`
- Test: `apps/web/scripts/video-production/research-agent.test.mjs`

**Interfaces:**
- Produces: `searchStudioSources(brief, {root,searchEndpoint,search,signal,now}) -> {schemaVersion,kind,artifactId,topic,query,audience,locale,provider,searchedAt,results}`
- Produces: `loadStudioSearch(artifactId,{root})`, `listStudioSearches({root,limit})`, `validateStudioSearchMatch(snapshot,brief)`
- `searchCandidates` gains optional sanitized bounded `snippet`.

- [ ] Test SearXNG-only search returns a saved immutable snapshot with 1–10 safe title/url/snippet results and no LLM access.
- [ ] Run `node --test apps/web/scripts/video-production/studio-search.test.mjs` and observe expected failure from missing module.
- [ ] Implement minimal snapshot module and optional result snippet; keep file size, filenames, URLs and brief validation bounded.
- [ ] Re-run focused tests; verify restore/list, empty results, tampered hash, and malformed URL errors pass.

### Task 2: Generate from saved search without re-searching
**Files:**
- Modify: `apps/web/scripts/video-production/studio-research.mjs`
- Test: `apps/web/scripts/video-production/studio-research.test.mjs`

**Interfaces:**
- Consumes: `loadStudioSearch`, `validateStudioSearchMatch`.
- `createStudioResearchDraft(candidate,settings,{searchArtifactId,loadSearch,root,...})` passes the validated list to `researchVideoTopic` as its injected search dependency.

- [ ] Write test: saved search plus model quote/planning failure still exists; valid saved leads are used without SearXNG; mismatched brief fails.
- [ ] Run focused Node test and observe RED.
- [ ] Add optional saved-search dependency injection to existing research function, leaving direct/CLI callers unchanged.
- [ ] Run focused Node test GREEN; original quote validator rejection still passes.

### Task 3: Same-origin Studio API
**Files:**
- Modify: `apps/web/scripts/director-studio-vite.mjs`
- Test: `apps/web/scripts/director-studio-vite.test.mjs`

**Interfaces:**
- `POST /api/contentgen-director/research-search` searches/persists without resolving a model.
- `GET /api/contentgen-director/research-search` lists recent snapshots.
- `GET /api/contentgen-director/research-search/:artifactId` loads validated snapshot.
- `POST /api/contentgen-director/research-draft` accepts optional `searchArtifactId`.

- [ ] Test route contracts, read-only list/load, no-model search, and origin protection.
- [ ] Run Node route tests RED.
- [ ] Implement routes with existing origin guard, signal cancellation and busy control.
- [ ] Run route suite GREEN.

### Task 4: Search review and recovery UI
**Files:**
- Modify: `apps/web/src/app/research-workspace.tsx`
- Test: `apps/web/src/app/research-workspace.test.tsx`

**Interfaces:**
- UI shows `Search & save sources`, saved results, compact previous searches and generation action.
- Combined Generate first searches if no matching snapshot; later retries reuse ID.

- [ ] Test search-only UI works when models unavailable, lists source URLs and saved state.
- [ ] Test combined flow retains results after storyboard generation failure, retries without another search, restores saved item and blocks stale-topic reuse.
- [ ] Run targeted Vitest RED.
- [ ] Implement accessible bilingual source cards/loading/errors and restoration; no evidence-verification claims.
- [ ] Run targeted Vitest GREEN.

### Task 5: Documentation and full verification
**Files:**
- Modify: `docs/how-to-research-to-storyboard.md`

- [ ] Document two-stage flow, restore/search-only behavior, provenance limits and retry.
- [ ] Run Node suites (`node --test apps/web/scripts/director-studio-vite.test.mjs apps/web/scripts/video-production/{studio-search,studio-research,research-agent}.test.mjs`).
- [ ] Run `pnpm --dir apps/web test`, `pnpm --dir apps/web build`, and repository preflight where available.
- [ ] Inspect PR diff and note environment blockers honestly. Keep one cohesive PR.


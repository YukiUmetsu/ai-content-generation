# Resumable Local AI Research Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a saved search into a resumable, source-linked storyboard via bounded local-AI requests and durable per-stage checkpoints.

**Architecture:** Keep existing saved-search and completed-research formats. Introduce deterministic captured evidence, a persistent single-worker job orchestrator, compact outline/scene inference and deterministic full-plan assembly; replace the Studio's blocking request with job polling and resume/retry controls.

**Tech Stack:** Node 20+ ESM, built-in `node:test`, Vite middleware, React/TypeScript, existing JSON artifact storage and preproduction schema.

**Spec:** `docs/superpowers/specs/2026-10-23-resumable-local-ai-research-jobs-design.md`

## Global Constraints

- Local AI only, one active inference; no automatic provider download or cloud fallback.
- Per-stage persisted checkpoints, bounded payloads, private file permissions, retries with explicit attempt caps.
- Existing `search_*.json` and completed `research_*.json` remain readable.
- Citation quotes are exact captured substrings but never imply factual verification.
- Explicit user action is required for capture and for resuming interrupted jobs after restart.
- One larger PR rather than many small PRs; preserve unrelated work.

## Review Focus

- Inference timeout with an earlier completed scene leaves the valid scene checkpoint untouched (Task 3).
- A browser disconnect does not cancel an accepted job; explicit cancel does (Task 4).
- Captured pages with blocked, short, or malformed content are reported as gaps and do not appear as citations (Task 1).
- An invalid model passage ID or scene claim ID cannot pass validation or be silently fabricated (Tasks 1 and 2).
- Restart during `running` recovers to `paused`, never launches surprise inference (Task 3).

---

### Task 1: Durable capture and deterministic evidence

**Files:**
- Create: `apps/web/scripts/video-production/research-job-evidence.mjs`
- Test: `apps/web/scripts/video-production/research-job-evidence.test.mjs`
- Modify: `apps/web/scripts/video-production/research-agent.mjs` (expose existing helpers if appropriate)

**Interfaces:**
- `captureSavedSources(savedSearch, brief, {signal, fetchPage?, now?, maxSources?}) -> Promise<{captures,gaps}>`
- `buildDeterministicDossier(brief, captures, gaps) -> {dossier, quotes, captures, warnings}`
- `selectEvidenceForScene(dossier, quotes, selectedClaimIds) -> bounded evidence array`

- [ ] Write tests for saved source selection, stale/blocked captures, exact quote equality, stable rank/IDs and no zero-evidence success.
- [ ] Run `node --test apps/web/scripts/video-production/research-job-evidence.test.mjs`; confirm red.
- [ ] Implement capture/ranking/dossier with immutable source content and source IDs.
- [ ] Re-run focused tests; confirm green.
- [ ] Commit to feature branch if git is available; otherwise stage via the GitHub branch/PR adapter.

### Task 2: Bounded outline/scene model tasks and composition

**Files:**
- Create: `apps/web/scripts/video-production/research-job-planner.mjs`
- Test: `apps/web/scripts/video-production/research-job-planner.test.mjs`

**Interfaces:**
- `generateOutline(dossier, settings, {transport?, signal?}) -> outline`
- `generateSceneUnit(outline, index, dossier, settings, {transport?, signal?}) -> unit`
- `assembleResumablePlan(dossier, outline, units) -> preproductionPlan`

- [ ] Test finite prompt budgets, `max_tokens`, forbidden claim/asset IDs, invalid JSON, and assembly's complete `parsePreproductionPlan` gate.
- [ ] Run planner test, confirm red.
- [ ] Implement small JSON calls, contract-aware scene units, normalized IDs and deterministic assembly.
- [ ] Run planner test, confirm green.
- [ ] Commit/stage changes.

### Task 3: Persistent job coordinator and retry/failover

**Files:**
- Create: `apps/web/scripts/video-production/research-job-queue.mjs`
- Test: `apps/web/scripts/video-production/research-job-queue.test.mjs`

**Interfaces:**
- `createResearchJob(request, models, opts) -> Promise<{jobId,status}>`
- `getResearchJob(jobId, opts) -> Promise<publicStatus>`
- `resumeResearchJob(jobId, models, opts) -> Promise<publicStatus>`
- `cancelResearchJob(jobId, opts) -> Promise<publicStatus>`
- `retryResearchScene(jobId, sceneId, models, opts) -> Promise<publicStatus>`

- [ ] Test stage checkpoint recovery, serialization of inference, targeted scene retry, cancel, restart recovery, and opt-in secondary local model after bounded transient failures.
- [ ] Run queue test, confirm red.
- [ ] Implement durable job states, per-stage files, single active worker, bounded retry classification, safe error codes and dependency checks.
- [ ] Run queue test, confirm green.
- [ ] Commit/stage changes.

### Task 4: HTTP API and Studio interaction

**Files:**
- Modify: `apps/web/scripts/director-studio-vite.mjs`
- Modify: `apps/web/scripts/director-studio-vite.test.mjs`
- Modify: `apps/web/src/app/research-workspace.tsx`
- Modify: `docs/how-to-research-to-storyboard.md`

**Interfaces:**
- `POST /research-jobs`, `GET /research-jobs/:id`, `POST /research-jobs/:id/resume`, `POST /research-jobs/:id/cancel`, `POST /research-jobs/:id/scenes/:sceneId/retry`.
- Existing `ResearchDraftResult` consumed after job completion; browser polls state and restores latest job ID.

- [ ] Test routes and acceptance after disconnect; update UI state interactions.
- [ ] Run route test, confirm red.
- [ ] Implement routes + Studio progress/failed-stage controls, preserve old `/research-draft` artifact loading.
- [ ] Run route/UI checks, confirm green.
- [ ] Commit/stage changes.

### Task 5: Final verification and one-PR delivery

- [ ] Run all four new and existing focused test groups and repo-available type checks.
- [ ] Verify deliberately failing stage then targeted retry using stubbed model, without repeating capture/valid scene work.
- [ ] Check diff for secrets, untrusted source text entering logs, and unintended changes.
- [ ] Open one draft PR against `main` and describe manual Mac + Magnitude smoke steps and any environment-limited checks.

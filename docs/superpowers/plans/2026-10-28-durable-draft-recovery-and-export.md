# Durable Draft Recovery and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume authorized interrupted drafts, make failures traceable in Jobs, and require confirmation for regenerated video versions while keeping the first draft one-click.

**Architecture:** The existing Vite Node coordinator persists a version-bound, nonsecret render intent before starting its Rust/SQLite DAG, then uses the same preflight/claim/producer code for recovery. Server-side verified release history determines whether a new version needs confirmation; the React Director preserves its single-button path and shows exact stages/Jobs. No new renderer or job scheduler.

**Tech Stack:** Node 24 ESM, React 19/TypeScript, Rust/Axum/SQLite Jobs, pinned Kumiki, FFmpeg, Vitest, node:test.

**Spec:** `docs/superpowers/specs/2026-10-28-durable-draft-recovery-and-export-design.md`

## Global Constraints

- Keep PR #134 draft/unmerged; no publishing, external provider calls or secrets persisted.
- No new dependencies or large downloads; run native offline tests before networked checks.
- First completed version requires no added confirmation; later regenerated versions require one.
- Jobs is authoritative; never steal a live lease, revive cancelled work or publish unverified media.
- Only claimed, completed verified artifacts may be reused after restart.

## Review Focus

1. A RUNNING Jobs record after Studio restart must not be labeled FAILED solely because the local Node process changed (Task 1).
2. Failures with provider credentials or paths must never persist raw strings in Jobs/UI (Task 1).
3. A failed first generation cannot accidentally be counted as the second video version (Task 2).
4. Direct API callers cannot bypass the later-version confirmation (Task 2).
5. Stale/malformed/symlinked recovery snapshots or missing Keychain credentials cannot trigger voice/network work (Task 3).

---

### Task 1: Accurate failure and status records

**Files:**
- Modify: `apps/web/scripts/director-production-vite.mjs`
- Test: `apps/web/scripts/director-production-vite.test.mjs`
- Test: `apps/web/src/app/video-production-panel.test.tsx`

**Interfaces:**
- Consumes: existing `latestProductionJob(productionId)`, `status`, `tracker.fail(code,detail)`.
- Produces: restored `state: rendering|failed|cancelled|done`, consistent `jobId`, safe user error detail and actionable message.

- [ ] **Step 1: Write failing tests** for persisted RUNNING status after server restart, failed attempt detail, and error/Jobs link on a failed Director export; demonstrate password/path redaction.
- [ ] **Step 2: Run** `node --test scripts/director-production-vite.test.mjs` and focused Vitest; **Expected:** relevant assertions fail.
- [ ] **Step 3: Update** `createDirectorProduction` status restoration and catch failure details with allowlisted, bounded, redacted codes/messages; preserve the Job ID even on failure.
- [ ] **Step 4: Run** focused tests; **Expected:** all pass.
- [ ] **Step 5: Commit** `fix: show durable draft failures and truthful Jobs status`.

### Task 2: First-video fast path and later-version confirmation

**Files:**
- Modify: `apps/web/scripts/director-production-vite.mjs`
- Modify: `apps/web/src/app/video-production-panel.tsx`
- Test: `apps/web/scripts/director-production-vite.test.mjs`
- Test: `apps/web/src/app/video-production-panel.test.tsx`

**Interfaces:**
- Produces: `GET /version-policy/:productionId -> {requiresConfirmation:boolean}` derived from verified existing MP4 releases; `POST /start` requires `confirmUpdatedVersion:true` only when this is an edited new release with earlier completed version.
- Consumes: `generateDraft(confirmedUpdate?:boolean)`; the UI asks once then preflights/starts without a separate review wizard.

- [ ] **Step 1: Write failing tests** for no prior release, completed release, damaged record, failed first attempt and server rejection of missing confirmation; UI first-start vs second confirmation and preserved settings.
- [ ] **Step 2: Run** native and focused UI tests; **Expected:** new assertions fail.
- [ ] **Step 3: Implement** verified release detection, server guard, concise accessible confirm UI and automatic progress continuation.
- [ ] **Step 4: Run** focused tests; **Expected:** all pass.
- [ ] **Step 5: Commit** `feat: confirm regenerated videos while keeping first draft one click`.

### Task 3: Restart-safe production intent and edited export proof

**Files:**
- Create: `apps/web/scripts/video-production/recovery-intent.mjs`
- Test: `apps/web/scripts/video-production/recovery-intent.test.mjs`
- Modify: `apps/web/scripts/director-production-vite.mjs`
- Test: `apps/web/scripts/director-production-vite.test.mjs`
- Modify: `docs/22-one-click-video-production.md`

**Interfaces:**
- Produces: `writeRecoveryIntent(outputRoot,runId,intent)`, `listRecoveryIntents(outputRoot)` with bounded, validated 0600 no-symlink JSON snapshots and replay count; `createDirectorProduction().recover()` invoked from plugin startup.
- Consumes: existing `POST /check` then `POST /start` through one shared coordinator path, Jobs idempotency and artifact hash verification; a persisted authorized revision, never an API key.

- [ ] **Step 1: Write failing tests** for private snapshot round-trip, credential omission, symlink/tamper denial, ineligible status/cancelled job, one restart-only claim, and actual edited-scene-to-full narrated export fixture.
- [ ] **Step 2: Run** focused Node tests; **Expected:** new assertions fail for missing implementation.
- [ ] **Step 3: Persist** safe intent before production, replay eligible jobs at Studio startup with one-flight ownership, avoid repeated uncertain remote TTS without recorded consent; retain actionable failure state.
- [ ] **Step 4: Run** native tests and real FFprobe/Chromium fixture where available; **Expected:** passing media hashes, caption and audio timeline; record unavailable provider/browser honestly.
- [ ] **Step 5: Commit** `feat: recover interrupted full video production after Studio restart`.

### Final verification and review

- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:video:headless` from `apps/web`, plus Rust Jobs and browser/FFmpeg checks when installed; distinguish blocked from pass.
- [ ] Skeptically inspect replay costs, lease races, path containment, preflight versions, voice consent, error exposure, UI focus/keyboard and 360/768/1280px layouts.
- [ ] Request fresh-context code review; fix verified high-impact findings with regression tests.
- [ ] Push coherent commits to `feat/production-one-click-jobs` and update PR #134 with measured verification and remaining gaps, keeping it draft.

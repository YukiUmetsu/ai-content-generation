# Jobs & QA Activity Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented Jobs page with a compact, unified activity monitor for discovery and DAG jobs.

**Architecture:** Project discovery sessions and DAG jobs remain separate API sources and are normalized only for presentation into a discriminated-union view model. The current DAG details/cancellation path stays intact. A single selected entry controls a responsive detail panel; background polling retains cached content.

**Tech Stack:** React 19, TypeScript, Tailwind 4, existing UI components, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-25-jobs-activity-monitor-design.md`

## Global Constraints

- No backend/schema changes, new dependencies, or fabricated progress.
- Preserve English/Japanese labels and accessible keyboard selection/focus.
- Keep active items visible through partial API failures; polling should not wipe or scroll lists.
- Use design system tokens, honor reduced motion; no large introductory banners.

## Review Focus

- A discovery session without `lastRun` does not appear as a job.
- Unknown server statuses remain readable and safely categorized.
- Two jobs with identical IDs across different APIs do not collide.
- Polling while selection is open does not reset the details or list position.
- A failed DAG request never hides a previously loaded discovery run, and vice versa.

---

### Task 1: Unified list and selection

**Files:**
- Modify: `apps/web/src/app/jobs-workspace.test.tsx`
- Modify: `apps/web/src/app/jobs-workspace.tsx`

**Interfaces:**
- Produces: `MonitorEntry` discriminated union (`kind: "discovery" | "pipeline"`, stable `key`, status bucket, timestamp); `selectedEntryKey` state; status/search-filtered entries.
- Consumes: Existing `DiscoverySession`, `Job`, `listJobs`, `listDiscoverySessions`, and status labels.

- [x] Write tests for mixed sources ordered with active first, selectable discovery, filters, missing run and status variants.
- [x] Run `pnpm --dir apps/web exec vitest run src/app/jobs-workspace.test.tsx` and see expected failures.
- [x] Implement normalized list, shared compact job rows, and accessible status/search controls with stable keys.
- [x] Run targeted tests to green; preserve discovery polling/partial-error assertions.

### Task 2: Contextual details and responsive behavior

**Files:**
- Modify: `apps/web/src/app/jobs-workspace.test.tsx`
- Modify: `apps/web/src/app/jobs-workspace.tsx`

**Interfaces:**
- Consumes: Task 1 `MonitorEntry`, selected entry and existing `getJob`/`cancelJob`.
- Produces: Discovery detail with truthful run fields; preserved DAG detail with compact heading, steps, progress and attempts; mobile Back navigation.

- [x] Write tests for discovery details, automatic desktop selection, polling selection persistence, DAG fetch/cancel, and mobile Back control.
- [x] Run targeted tests and verify expected failures.
- [x] Implement details and responsive panel; avoid duplicate intro and unverified timeline.
- [x] Run targeted tests to green.

### Task 3: Polish and local verification

**Files:**
- Modify: `apps/web/src/app/jobs-workspace.tsx` only if required by tests/visual inspection.

**Interfaces:** No new APIs.

- [x] Test empty, loading, error, keyboard focus, partial outages, cancellation, and reduced-motion classes with available tooling.
- [x] Run full frontend `typecheck`, `lint`, `test`, `build` and `git diff --check` locally; fix any caused regressions.
- [x] Obtain an independent skeptical review, fix its important findings, and create a single branch PR; do not depend on GitHub Actions.

**Visual QA note:** Browser screenshot review at 360/768/1280/1600px remains manual: the checkout environment has no Chromium/Firefox binary. Check dark/JA layout and overflow interactively before merging.

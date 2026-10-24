# Progressive Local Keyword Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show validated local-AI keyword suggestions incrementally, without waiting for the full six-lens generation cycle.

**Architecture:** Reuse the quality-filtered serial generator and its single-model inference gate. Emit small two-item batches through a same-origin NDJSON response; the browser displays each accepted batch immediately and can cancel the remaining calls without discarding reviewed suggestions. Preserve the existing JSON endpoint for callers that need all results together.

**Tech Stack:** Node ESM, React/TypeScript, Node test, Vitest; no new dependencies, database changes, or external services.

**Spec:** `docs/07-experience.md`, `docs/02-runtime.md`, `docs/superpowers/specs/2026-10-23-contentgen-project-knowledge-graph-design.md`.

## Global Constraints

- Bound each local model request to two keyword candidates; serialize model calls, keep the existing global request budget.
- Never persist or activate unreviewed suggestions; show unverified demand and explicit request/quality metrics.
- Cancel must abort only the owned stream, leave earlier suggestions visible, and release inference when the provider stops.
- Existing nonstreaming route remains usable; keep loopback/same-origin/CSRF enforcement.

## Review Focus

- First useful batch arrives before the second local inference finishes.
- Failed later batch retains earlier suggestions, and end-of-stream distinguishes success from truncation.
- Split UTF-8/JSON lines decode correctly, malformed frames fail visibly, cancellation does not erase suggestions.
- User can accept/skip available suggestions during generation; controls distinguish working from stopped.
- No second heavy model is launched concurrently, cancellation and unmount stop further generation.

### Task 1: Generator emits bounded partial batches

**Files:** `apps/web/scripts/video-production/project-keyword-generator.mjs`, `.test.mjs`.

- [x] RED: callback receives accepted suggestions from batch 1 while batch 2 waits, and receives bounded progress after rejected/malformed batches.
- [x] GREEN: add `onBatch` callback to `generateProjectKeywords`, request at most two per batch, preserve result shape and retry constraints.
- [x] Re-run generator and inference-lock tests.

### Task 2: Same-origin progressive HTTP boundary

**Files:** `apps/web/scripts/director-studio-vite.mjs`, `.test.mjs`.

- [x] RED: incremental NDJSON chunks arrive before completion, successful stream emits `done`, cancellation/error ends honestly.
- [x] GREEN: add `/project-keyword-suggestions/stream` while keeping previous JSON endpoint.
- [x] Re-run Studio route suite.

### Task 3: Browser reader and live review UI

**Files:** `apps/web/src/lib/api/discovery.ts`, `apps/web/src/app/project-discovery-panel.tsx`, `apps/web/src/app/project-discovery-panel.test.tsx`.

- [x] RED: first batch renders and remains actionable while next batch waits; Stop retains it and prevents later additions.
- [x] GREEN: bounded NDJSON parser with callbacks and AbortSignal; separate generation state from editing, show live status/Stop.
- [x] Re-run targeted Vitest.

### Task 4: Local verification and PR

**Files:** `docs/how-to-discover-project-ideas.md`.

- [x] Update user-facing workflow notes.
- [x] Run Node tests, frontend Vitest, ESLint, TypeScript check and build locally; no GitHub Actions.
- [ ] Review only intended files, open one PR against latest GitHub main.

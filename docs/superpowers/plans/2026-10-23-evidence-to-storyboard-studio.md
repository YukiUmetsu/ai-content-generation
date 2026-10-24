# Evidence-to-Storyboard Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Research a Studio topic from public sources, automatically create a sourced draft/shot plan, let a creator review it, then save an editable storyboard without presenting unverified text as fact.

**Architecture:** Reuse the opt-in research agent and preproduction generator behind an explicitly clicked, same-origin Vite bridge endpoint; persist source snapshots locally before returning. Keep a separate typed TypeScript adapter converting validated plans into storyboard authoring documents; wire a research-result review surface into Studio Research and handoff into the existing new-project transaction.

**Tech Stack:** Node ESM with node:test, Vite middleware, TypeScript/React/Vitest, existing local SearXNG + local model.

**Spec:** `docs/superpowers/specs/2026-10-23-evidence-to-storyboard-studio-design.md`

## Global Constraints

- No new runtime dependencies, downloads, extra third-party requests, auto-publish or voice calls.
- Keep source snapshots immutable under ignored `data/` with narrow bounded content; no clobber.
- Every draft claim remains unverified even with an exact matching quote.
- No client-supplied model endpoint, filesystem paths or paid search provider options.
- Preserve unchanged existing editorial draft/project path and active projects.
- Never display public YouTube observed views as source support for researched claims.

## Review Focus

1. A second POST while a research job is running should not invoke a competing heavy model call: cover request-state/UI disabled interaction.
2. Page capture yielding a valid dossier but generation failing must be visibly an error, not a success-looking story: cover in bridge test.
3. After topic edits, old results must not save a mismatched project: cover in UI test.
4. Source quote extraction with multiple distinct claims on one page must retain their correct quotes: cover in research adapter test.
5. Saving a research-backed storyboard that violates the project size/schema ceiling must leave existing projects unchanged: cover in project test.

---

### Task 1: Local researched draft endpoint and immutable snapshots

**Files:** `apps/web/scripts/director-studio-vite.mjs`, `apps/web/scripts/video-production/studio-research.mjs`, `apps/web/scripts/video-production/research-agent.mjs`; tests `apps/web/scripts/video-production/director-studio.test.mjs`, `studio-research.test.mjs`.

**Interfaces:**
- Produces `POST /api/contentgen-director/research-draft` from `{title,viewerQuestion,audience,locale}`.
- Success `{ dossier, plan, quotes:[{claimId,sourceId,quote}], warnings, snapshotId }`, with immutable persisted captured text/dossier/plan.

- [ ] Write tests for explicit same-origin invocation, no model error, source+quote/plan persistence and failures/no partial success.
- [ ] Run `node --test apps/web/scripts/video-production/studio-research.test.mjs apps/web/scripts/video-production/director-studio.test.mjs` to verify RED.
- [ ] Add a controller with fixed local SearXNG/settings, immutable bounded `data/studio-research/<researchId>` snapshot, validated quote support, and bridge endpoint.
- [ ] Run the above tests to verify GREEN; run Node script suite.

### Task 2: Typed research → semantic storyboard conversion

**Files:** `apps/web/src/app/researched-storyboard.ts`, `apps/web/src/app/researched-storyboard.test.ts`, `apps/web/src/app/editorial-project.ts`, `apps/web/src/app/editorial-project.test.ts`.

**Interfaces:**
- Produces `ResearchDraftResult` and `researchToStoryboard(result, projectId,locale): SemanticStoryboard`.
- Extends `createEditorialProject(catalog,draft,locale,researchResult?)` for non-destructive handoff.

- [ ] Write tests for claim+source stability, factual narration and shot visual changes, rejected invalid references, and non-clobber transaction.
- [ ] Run `pnpm --dir apps/web exec vitest run src/app/researched-storyboard.test.ts src/app/editorial-project.test.ts` to verify RED.
- [ ] Implement strict validation/plan projection; keep unverified statuses and source manifest notes.
- [ ] Run the above tests to verify GREEN.

### Task 3: Research UI generation, citation review and storyboard handoff

**Files:** `apps/web/src/app/research-workspace.tsx`, `apps/web/src/app/research-workspace.test.tsx`, `apps/web/src/app/shell.tsx`, `docs/how-to-studio-researched-storyboard.md`.

**Interfaces:**
- Explicit button starts `/api/contentgen-director/research-draft`, returning review cards with sources, quote, timestamp, risks, generated shots; click creates researched board using existing project callback.
- The original unresearched draft option remains distinct and honest.

- [ ] Write interaction tests: click/fetch/review/create; cancel, error, disabled double click and stale topic changes.
- [ ] Run `pnpm --dir apps/web exec vitest run src/app/research-workspace.test.tsx` to verify RED.
- [ ] Implement minimal clear EN/JA review UI with cited cards and error states; update shell callback.
- [ ] Run targeted tests then `pnpm --dir apps/web run test` and `pnpm --dir apps/web run build`.
- [ ] Run Node tests and `cargo fmt --check` where relevant. Document operational requirements and manual walkthrough. Report untested real-network/video boundaries.

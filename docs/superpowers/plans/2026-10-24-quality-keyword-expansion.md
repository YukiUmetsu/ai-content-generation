# Quality-first Project Keyword Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suggest 10–15 diverse, concrete, review-only search phrases for a project using several small local AI calls, with honest quality and evidence signals.

**Architecture:** The Node local-AI adapter orchestrates short, sequential, topic-lens batches and checks each proposed keyword deterministically. The existing React review UI presents the final accepted suggestions and provenance; accepting a suggestion is still a separate creator action. No database or provider changes.

**Tech Stack:** Node ESM, `node:test`, React/TypeScript, Vitest.

**Spec:** `docs/04-research-seo.md` (seed-topic expansion, intent clusters, unknown-versus-measured values). Approved product direction: small AI batches, meaningful topic variety, rejects vague/boilerplate/duplicate suggestions, return 10–15 good candidates when possible.

## Global Constraints

- One locally configured research model, at most one inference request at a time.
- Bounded attempts and payload sizes; never claim measured search demand without a provider observation.
- Rejected output must never overwrite manually entered keywords; suggestions remain review-only.
- Generic pipeline: no homeowner-only hard-coded topic catalog.
- Keep API compatibility: `suggestions` array remains available; diagnostics are additive.

## Review Focus

- No project description or keywords: actionable error without invoking AI (Task 2).
- Truncated/invalid batch: retry smaller and retain independently validated suggestions (Task 2).
- Broad words, project-name echo, boilerplate rationales and unverified metrics: filtered (Task 1).
- Near-identical wording across batches or existing keywords: not repeated (Task 1/2).
- Only a few valid suggestions: honest partial result; never synthesize fake filler (Task 2/3).

---

### Task 1: Deterministic quality and diversity gate

**Files:**
- Modify: `apps/web/scripts/video-production/project-keyword-generator.mjs`
- Test: `apps/web/scripts/video-production/project-keyword-generator.test.mjs`

**Interfaces:** `qualityKeywordSuggestions(rows,{name,existing,accepted})` returns accepted suggestions and rejection count, preserving `validateKeywordSuggestions` for schema validation.

- [x] Test: vague House Math suggestions, instruction-echo rationales, unsupported trend claims and near-duplicates are rejected; specific cross-facet suggestions survive.
- [x] Verify RED with `node apps/web/scripts/video-production/project-keyword-generator.test.mjs`.
- [x] Implement bounded lexical screening and cross-batch normalization.
- [x] Verify GREEN with the same command.

### Task 2: Small-batch topical expansion

**Files:**
- Modify: `apps/web/scripts/video-production/project-keyword-generator.mjs`
- Test: `apps/web/scripts/video-production/project-keyword-generator.test.mjs`

**Interfaces:** `generateProjectKeywords(candidate,{modelSettings,transport,signal,sleep,targetCount?})` returns `{suggestions,quality}`. Batch prompts select different reusable lenses; `targetCount` allows faster deterministic test fixtures.

- [x] Test: sequential varied requests accumulate distinct 10–15 candidates (including original topic intent), never exceed bounded calls, and expose partial progress honestly.
- [x] Test: retry one malformed batch with smaller output without abandoning accepted batches; cancellation stops further requests.
- [x] Verify RED via Node test.
- [x] Implement batch orchestration using existing inference gate.
- [x] Verify GREEN via Node test.

### Task 3: Review UI and product notes

**Files:**
- Modify: `apps/web/src/lib/api/discovery.ts`
- Modify: `apps/web/src/app/project-discovery-panel.tsx`
- Test: `apps/web/src/app/project-discovery-panel.test.tsx`
- Modify: `docs/how-to-discover-project-ideas.md`

**Interfaces:** Optional `quality` response metadata; existing accepted keyword workflow unchanged.

- [x] Test: unverified-local-AI label and partial/rejection summary appear; accepting remains manual.
- [x] Verify RED with targeted Vitest.
- [x] Implement additive UI metadata and brief documentation.
- [x] Verify GREEN via targeted Vitest.

### Task 4: Verify and prepare one PR

- [x] Run Node keyword and director route suites.
- [x] Run full frontend Vitest, lint, TypeScript and build without GitHub Actions.
- [x] Review intended file diff and create one GitHub PR against latest main.

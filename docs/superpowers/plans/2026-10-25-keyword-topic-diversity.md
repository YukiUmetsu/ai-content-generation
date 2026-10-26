# Keyword Topic Diversity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent broad ContentGen projects from receiving mostly variations of the same core keyword subject.

**Architecture:** Extend the synchronous keyword quality gate with a normalized two-term concept anchor and a two-per-subject diversity cap. Preserve generation, semantic review, and retry budgets; model prompts encourage alternative subjects and existing refill requests replace rejected suggestions.

**Tech Stack:** Node.js ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-25-keyword-topic-diversity-design.md`

## Global Constraints

- Keep the shared 12-local-inference-call budget and partial results.
- Do not make new model or network calls for diversity checks.
- No tax-specific special casing, data migration, new dependency, or keyword activation.
- Preserve unrelated user worktree edits and open a focused PR; do not auto-merge or manually trigger CI.

## Review Focus

- Short project names that happen to mention one concept: keep other distinct keywords.
- Broad descriptions listing a subject among many: still enforce the cap.
- Focused, brand-named projects whose description explicitly targets a subject: allow more variations.
- Previously rejected model rows: prevent repeat review but do not consume diversity quota.
- Exclusions and old manual keywords: exclusions do not consume slots; manual topics do.

---

### Task 1: Concept diversity quality gate and refill

**Files:**
- Modify: `apps/web/scripts/video-production/project-keyword-generator.mjs`
- Modify: `apps/web/src/lib/api/discovery.ts` and `apps/web/src/app/project-discovery-panel.tsx` to preserve active exclusion kinds
- Test: `apps/web/scripts/video-production/project-keyword-generator.test.mjs` and `apps/web/src/lib/api/discovery-keyword-stream.test.ts`
- Update: `docs/how-to-discover-project-ideas.md`

**Interfaces:**
- Consumes: `qualityKeywordSuggestions(rows,{name,description?,existing?,excluded?,accepted?,applyDiversity?})`; `generateProjectKeywords(candidate,options)` with optional `candidate.excludedKeywords`.
- Produces: Same `suggestions` and `rejected` return contract, with topic-diverse output; no API changes.

- [x] **Step 1: Write a failing quality-gate test.** Broad `Homeownership` project: four distinct `property tax …` phrases plus three other topics, only first two tax phrases retained. Assert no tax-specific vocabulary is necessary with another repeated subject.
- [x] **Step 2: Verify red.** `node scripts/video-production/project-keyword-generator.test.mjs` must fail on diversity assertions (not syntax).
- [x] **Step 3: Add boundary tests.** Verify focused-name and focused-description exemptions (including negation and multi-subject names), prior manual coverage, preexisting typed exclusions, rejected-history isolation, and capitalized product prefixes; watch new tests fail.
- [x] **Step 4: Implement the smallest deterministic gate.** Core anchor = first two meaningful normalized words; permit two per anchor for broad projects, with explicit-focus exemption. Run the diversity gate after optional semantic checks; pass active exclusion keywords separately from positive topic seeds. Add one short diversity reminder to generation prompt.
- [x] **Step 5: Verify green.** Same Node test file must pass.
- [x] **Step 6: Add an integration red/green test for refill and request budget.** Model initially repeats one subject, then offers other concepts; assert two-per-subject, incremental accepted batches, and at most 12 requests.
- [x] **Step 7: Update documentation and run checks.** `node scripts/video-production/discovery-job-queue.test.mjs`, `pnpm exec vitest run`, `pnpm run lint`, `pnpm exec tsc -b --noEmit`, `pnpm run build` from `apps/web`. Keep full results and blockers visible.
- [ ] **Step 8: Independent review and handoff.** Compare only intended files to remote `main`, open one focused PR using the GitHub connector without including unrelated worktree changes; do not merge.

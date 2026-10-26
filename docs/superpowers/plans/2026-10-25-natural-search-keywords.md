# Natural Search Keywords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use test-driven development.

**Goal:** Filter unnaturally long, analytical project keyword suggestions and continue bounded small-batch discovery.

**Architecture:** Tighten `qualityKeywordSuggestions` deterministically before optional meaning checks. Remove contaminating negative phrases from local-model prompts; retain incremental results and existing request limits.

**Tech Stack:** Node ESM / `node:test`; existing React UI unchanged.

**Spec:** `docs/superpowers/specs/2026-10-25-natural-search-keywords-design.md`

## Global Constraints

- Keep model requests at 12 or fewer and do not increase per-batch size.
- Do not make live model/network calls or add dependencies.
- Preserve accepted/manual keywords and do not fabricate replacement entries.
- Skip GitHub Actions because user reached credit limit; verify locally.

## Review Focus

- Invalid long phrases, including long `X vs Y`, rejected even with model-positive judgments.
- Compact natural comparisons retained only after meaning check.
- `VS Code` and other phrases starting with `VS` are not misclassified as comparisons.
- Four-word concrete terminology retained; four-word filler rejected.
- Dotted framework names and canonical four-word technical terms are not overcounted or rejected for integral connectors.
- Previously accepted verbose phrases do not contaminate prompts; empty, punctuation-only and broad one-word suggestions are screened out.
- Prior rejected model examples absent from subsequent model prompts.
- Empty refill, model truncation and partial success continue to obey global budget.

---

## Task 1: Enforce search phrase length and shape

**Files:** Modify `apps/web/scripts/video-production/project-keyword-generator.mjs`; test `apps/web/scripts/video-production/project-keyword-generator.test.mjs`.

- [x] Write a regression test with all eight user examples as unacceptable, plus natural two/three/four-word alternatives as acceptable.
- [x] Run `node scripts/video-production/project-keyword-generator.test.mjs`; verify the new regression fails.
- [x] Tighten deterministic validation (`verboseKeyword` and `weakSuggestion`) for no more than four concrete words, three for comparisons, and common editorial filler/jargon.
- [x] Update legacy fixture expectations for the approved narrow keyword contract and run the full keyword suite green.

## Task 2: Keep negative examples out of prompt context

**Files:** Same generator and test; docs `docs/how-to-discover-project-ideas.md`.

- [x] Write a test that captures successive generation prompts and rejects both known negative examples and a prior rejected phrase.
- [x] Run the test and verify it fails for prompt contamination.
- [x] Replace literal bad examples and `rejectedExamples` with abstract constraints/feedback while preserving successful batches and shared budget.
- [x] Run keyword suite and `node scripts/video-production/discovery-job-queue.test.mjs`, `pnpm exec vitest run`, `pnpm run lint`, `pnpm exec tsc -b --noEmit`, `pnpm run build` from `apps/web`.
- [x] Inspect focused diff, update guide accurately, publish one scoped GitHub PR without running Actions.

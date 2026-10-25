# Keyword semantic quality and refill implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Each task runs RED → GREEN before moving forward.

**Goal:** Improve semantic coherence and retry until enough good project keywords exist or bounded budget ends.

**Architecture:** Add a short local-model verdict only for comparison candidates; reuse the keyword generator's transport, single-model inference gate and global 12-request cap. Expand the six static lenses with up to four varied refill passes and expose accurate bounded progress.

**Tech Stack:** Node ES modules and `node:test`, existing React/Vitest client.

**Spec:** `docs/superpowers/specs/2026-10-25-keyword-semantic-refill-design.md`

## Global Constraints

- No extra provider, dependencies, DB schema or external data collection.
- Global generation/critique call cap: 12; max four refill passes; 1–2 suggestions per batch; no auto-Accept.
- Errors/cancellation must preserve earlier streamed suggestions; no fabricated SEO metrics.

## Review Focus

- Local evaluator sends malformed JSON or times out: drop only uncertain comparisons.
- Several batches all duplicates: stop within bounds with honest partial results.
- Valid short alternatives remain eligible even if unfamiliar to deterministic heuristics.
- Noncomparison accepted entries stream before later refill/inference completes.
- An abort while evaluating or refilling prevents all later calls.

### Task 1: Comparison meaning and prompts

**Files:** `apps/web/scripts/video-production/project-keyword-generator.mjs`, `.test.mjs`

**Interface:** `generateProjectKeywords(candidate,options)` stays stable; `qualityKeywordSuggestions` remains deterministic; model transport is reused for extra small comparison requests.

- [x] Add RED tests: meaningful versus bogus comparisons, invalid evaluator response, no extra evaluator calls for noncomparisons, cancellation.
- [x] Run failing test command: `node scripts/video-production/project-keyword-generator.test.mjs` from `apps/web`.
- [x] Implement bounded nonthinking JSON comparison judgment and stronger generator instructions.
- [x] Run test again to GREEN.

### Task 2: Refill and user progress

**Files:** same generator/tests; `apps/web/src/app/project-discovery-panel.tsx`; `docs/how-to-discover-project-ideas.md`.

- [x] Add RED tests: refill reaches target after rejected/duplicate proposals; <=12 inference calls and <=4 extra passes; earlier results arrive first.
- [x] Run failing keyword suite.
- [x] Add refill lenses, fixed call budget, rejected-intent feedback and three-empty-refills cutoff; update UI progress language and guide.
- [x] Run keyword/discovery suites, full Vitest, lint, typecheck and build; read exit codes.

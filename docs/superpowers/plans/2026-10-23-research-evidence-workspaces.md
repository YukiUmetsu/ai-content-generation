# Research and Evidence Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Research and the saved Evidence Library independently understandable, navigable and professional without modifying ContentGen's evidence-generation semantics.

**Architecture:** In `ResearchWorkspace`, split the former Evidence tab into Research and Evidence Library, retaining independent `topic` and `evidenceQuery` state. Refine the Evidence panel's presentation and separate normal empty-index state from genuinely degraded search. Preserve source provenance and API behavior.

**Tech Stack:** React, TypeScript, Tailwind, Base UI tabs, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-23-research-evidence-workspaces-design.md`

## Global Constraints

- Keep current research, packaging, YouTube and storyboard APIs unchanged.
- No fake evidence, citation inference or pretend ingestion of research drafts.
- Bilingual UI, keyboard accessible, source metadata available without clutter.
- Target exactly one PR, no added runtime dependency.

## Review Focus

- Editing Evidence Library query must not mutate project topic: covered by Task 1 test.
- Hidden tabs unmount and lose an in-flight research draft: preserve Research panel with `keepMounted`, Task 1 test.
- Empty index incorrectly displays warning: Task 2 test.
- No matches or stale index misclassified as normal empty: Task 2 test.
- Results lose source metadata or unsafe links: Task 2 test.

---

### Task 1: Split navigation and query state

**Files:**
- Modify: `apps/web/src/app/research-workspace.tsx`
- Modify: `apps/web/src/i18n/messages.ts`
- Test: `apps/web/src/app/research-workspace.test.tsx` (new)

**Interfaces:**
- Research topic: existing `topic` / `changeTopic(value: string)` state.
- Evidence query: new local `evidenceQuery` / `setEvidenceQuery(value: string)` state, passed to `<EvidencePanel query={evidenceQuery} onQueryChange={setEvidenceQuery}/>`.

- [ ] Write regression test for four navigable tabs and independent Research topic/Evidence Library query.
- [ ] Run `pnpm --dir apps/web test -- research-workspace.test.tsx` and confirm expected pre-change failure.
- [ ] Separate the tabs, keep Research mounted, move `EvidencePanel` to its own panel and clean up Research input hierarchy.
- [ ] Run focused test; verify no topic mutation and other tabs unaffected.
- [ ] Commit with Task 2 in a single PR.

### Task 2: Evidence Library professional design

**Files:**
- Modify: `apps/web/src/app/evidence-panel.tsx`
- Modify: `apps/web/src/i18n/messages.ts`
- Test: `apps/web/src/app/evidence-panel.test.tsx` (new)

**Interfaces:**
- Same `EvidencePanel` props, `searchEvidence` client and `EvidenceSearchResponse` contract.
- `ResultCard`: excerpt and source citation summary immediately visible, provenance details in native `<details>`.

- [ ] Test initial view, normal empty index vs stale/no matches, and accessible source version/license details.
- [ ] Run focused test and confirm expected pre-change failure.
- [ ] Refactor layout: professional search header, results summary, honest status strip and neutral empty state.
- [ ] Retain contradictions, numeric values, provenance, locator and rights status.
- [ ] Run focused test and larger Web lint/typecheck/test/build suite.
- [ ] Review final diff for localization, accessible labels, responsive overflow and no sample data.
- [ ] Commit the design, plan, tests and code to an isolated branch; open one PR.

## Verification constraints

The provided workspace currently contains only a partial source mirror, without `apps/web/package.json`, installed dependencies or TypeScript/Vitest runners. Make the test-first intent explicit, run every available static/local check, and report any unexecutable suite rather than claiming it passed. GitHub Actions was previously blocked by account billing, not test output.

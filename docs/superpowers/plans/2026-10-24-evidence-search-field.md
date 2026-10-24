# Evidence SearchField Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the real Kumiki `SearchField` into ContentGen Evidence Library.

**Architecture:** Keep `EvidencePanel` as the owner of query, validation and API lifecycle. Vendor the component from a reviewed Kumiki commit through the app's existing registry manifest and lock.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, pinned Kumiki-UI source registry.

**Spec:** `docs/superpowers/specs/2026-10-24-evidence-search-field-design.md`

## Global Constraints

- Do not invent, fabricate, or auto-index evidence.
- Do not hand-edit existing vendored component code.
- Keep existing result/provenance rendering, Japanese text, and slow-request cancellation.

## Review Focus

- Enter and action-button submission must each search exactly once.
- The clear control must restore focus and clear stale results.
- The input must retain correct accessible name, hint and validation associations.
- Loading must prevent duplicate search while still allowing query edits.
- The independent Consumer source pin and lock must agree with generated vendored bytes.

---

### Task 1: Consumer search interactions

**Files:**
- Modify: `apps/web/src/app/evidence-panel.tsx`
- Test: `apps/web/src/app/evidence-panel.test.tsx`

**Interfaces:** Use `SearchField({query, onQueryChange, onSearch, onClear, label, hint, error, loading, showSubmit, submitLabel})`; keep `searchEvidence(trimmed, {signal})` and the `EvidencePanel` public props unchanged.

- [x] Add tests for the accessible searchbox, Enter submit, clear/focus/result reset, and existing empty state.
- [x] Verify regression sensitivity with a reversible text-input mutation; test fails when native search semantics disappear. A separate abort-on-clear test was observed failing before implementation and passing after.
- [x] Replace the form/Field/Button with SearchField. Route callbacks to the existing request lifecycle without duplicate submission.
- [x] Run isolated targeted tests (7 passed); original project-wide build/typecheck cannot run from the available partial local source snapshot.

### Task 2: Reproducible registry dependency

**Files:**
- Modify: `apps/web/kumiki.config.json`
- Modify: `apps/web/vendor/kumiki.lock.json`
- Create: `apps/web/src/components/ui/search-field.tsx` (exact registry source, generated/vendor-managed)

**Interfaces:** Pin the merged Kumiki source commit `9bce74d78ee40bb62a838ac5ce79002de60662d9`; add registry item `search-field` and its `field-input` closure. The existing installed source files are unchanged by this pin.

- [x] Update pin and item list, then regenerate the lock and vendored file using vendor script.
- [x] Verify source sha256, registry closure and account for three additional upstream media source updates from the new pin.
- [x] Run local vendoring verification and disclose that no full ContentGen checkout was available in the environment.

### Task 3: Delivery

- [ ] Review branch diff for unrelated changes.
- [ ] Commit changes on an isolated branch and open one PR without merging.

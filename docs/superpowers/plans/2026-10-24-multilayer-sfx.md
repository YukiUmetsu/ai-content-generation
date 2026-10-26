# Studio Multilayer SFX Implementation Plan

> Implementation record. Completed work used test-first development and local verification. React/Vitest execution remains pending in a full checkout.

**Goal:** Add up to four supplemental reviewed sound cues per storyboard shot and one verified looping ambience bed, with individual gain and fades.

**Architecture:** Persist an independent project-local audio design, resolve its assets from the trusted CC0 bank at readiness, bind it into typed job events/sounds, and render all layers with bounded FFmpeg filters on the measured sample clock. The existing primary per-shot automatic cue remains backwards-compatible.

**Tech Stack:** Node ESM, FFmpeg, React/TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-10-24-multilayer-sfx-design.md`

## Global Constraints

- Existing auto/pin/mute choices and previous jobs remain valid without migrations.
- No unreviewed asset paths or unbounded filters accepted; no background downloads.
- Only local tests; skip GitHub Actions. Extend the existing SFX PR when possible.

## Review Focus

- Repeated effects in a shot use separate event IDs without moving the narrative payoff.
- A saved layer with a missing/changed approved hash cannot be exported.
- Offset crossing the movie boundary fails with a clear error; no invisible cue is claimed audible.
- Ambience loops to the exact total frame/sample length without clipping or masking speech.
- Changing any additional layer after Check requires a new readiness check.

### Task 1: Trusted local audio-design persistence

**Files:** Create `apps/web/scripts/video-production/sound-design.mjs` and `sound-design.test.mjs`; modify `apps/web/scripts/sfx-discovery-vite.mjs` and its test.

**Interfaces:** `setSoundDesign(input,{root?})`, `resolveSoundDesign({projectId,bundle},{root?})`.

- [x] Write failing tests for upsert/remove, project isolation, rights/hash verification, limits and ambience; run RED.
- [x] Implement atomic saved design and trusted asset resolution; run GREEN.
- [x] Add same-origin endpoints and route tests, including cross-site rejection; run GREEN.

### Task 2: Exact job and mixer support

**Files:** Modify `sfx-render-bindings.mjs`, `job.mjs`, `audio.mjs`, `produce.mjs` and their existing tests.

**Interfaces:** `bindApprovedSfxToRenderJob(compiled,sceneChoices,design?)`; new optional sound metadata as specified. `resolveAndBindApprovedSfx` also resolves the saved design.

- [x] Write failing binding/job tests for multiple cue events, ambience, invalid dynamics and revocation; run RED.
- [x] Implement typed binding and validation; run GREEN.
- [x] Write failing real-FFmpeg audio tests for offset, independent gain/fades, loop and no-change legacy behavior; run RED.
- [x] Implement bounded filters and effective cue samples, then manifest metadata; run GREEN.

### Task 3: Reviewable editor controls and documentation

**Files:** Modify `sfx-discovery-panel.tsx` and `docs/13-audio-production.md`; add/update React UI tests.

- [x] Write editor tests for adding a cue and enabling/disabling ambience; React tests are not executable in the sparse local checkout.
- [x] Implement simple reviewed-library selectors, numeric gain/fade/offset controls and cue listing; no external search side effects.
- [x] Run the available Node regression tests and perform strict self-review.
- [ ] Execute React/Vitest tests and visually inspect the editor in a full checkout before merging.

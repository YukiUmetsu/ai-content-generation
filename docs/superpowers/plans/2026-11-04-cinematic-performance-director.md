# Cinematic Performance Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution is native: the user asked for no subagents by default.

**Goal:** Turn a narrated scene into a reusable, cinematic Blender-rendered shot where characters physically act on shared objects, and prove it with a real 10-second 1080p30 MP4.

**Architecture:** ContentGen authors a validated intent. `kumiki-ui` compiles it to MD1/CC1 and emits one per-frame `ShotBake`. `kumiki-blender` renders that bake to an H.264 clip, which returns through ContentGen's existing footage, overlay, audio and MP4 path.

**Tech Stack:** Node ESM and React/TS (ContentGen, Kumiki). Python and Blender 5.2.3 headless (`kumiki-blender`). FFmpeg. Rust Jobs. No new runtime dependency in the export bundle.

**Spec:** `docs/superpowers/specs/2026-11-04-cinematic-performance-director-design.md`

## Global Constraints

- One owner per capability, as in spec section 2. No `bpy` outside `kumiki-blender`. No consumer names in `kumiki-ui` or `kumiki-blender`.
- Every behavior that differs between scenes is data: look profile, set manifest, cast manifest, timing preset, render profile.
- Kumiki resolves all frames. Blender authors no timing.
- Units are metres, Kumiki Y-up. Conversion to Z-up happens once, in `kumiki-blender`.
- No silent fallback. Failure names the shot and the reason.
- `src/video-export` must not import `three`.
- One heavy process at a time. Under 5 GB for this work. Pause under 8 GB free. Delete nothing of the user's.
- Fish stays off without explicit consent. Draft voices are local.
- Keep every previous-best render.

## Review Focus

1. A bake whose fps or frame count differs from the clip placement: the build must stop with a named diagnostic, not drift.
2. An action that starts during another actor's grasp of the same object: the validator must reject it.
3. A cast asset that lacks an effector the intent needs: the block must happen before any narration or render work starts.
4. Edited narration that changes a measured speech window: only the affected shot may re-render, and stale clips must not be reused.
5. Cancel during `build-shot`: the Blender process must exit, partial frames must not enter the cache, and the owned temp directory must go away.

---

## Phase 1: Look-dev spike (human gate)

Output is an answer. Keep what proves useful in Phase 2, and label the rest throwaway. Work under `kumiki-blender/.review/look-dev/`.

### Task 1: Desk look frame

**Files:** Create `.review/look-dev/desk_look.py` in `kumiki-blender`.

- [ ] **Step 1:** Fetch CC0 wood PBR and an interior HDRI (under 250 MB total) into `.review/look-dev/assets/` and record source, license and SHA-256 in `provenance.json`.
- [ ] **Step 2:** Build the desk, lamp, invoice and receipt with exact printed text from data rows.
- [ ] **Step 3:** Render one 1920×1080 EEVEE frame and inspect it at full size. Revise up to three times.

### Task 2: Character A and B stills

**Files:** Create `.review/look-dev/actor_a_puppet.py` and `.review/look-dev/actor_b_mesh.py`.

- [ ] **Step 1:** Option A: place existing Quill PNG parts on alpha planes in the set, with a wing posed to hold the receipt.
- [ ] **Step 2:** Option B: build a Quill mesh with hair curves and a feather and coat treatment, rig the wing, and pose the same action.
- [ ] **Step 3:** Render both in the same light and camera. Record seconds per frame for draft and review profiles.

### Task 3: Decision report

- [ ] **Step 1:** Report paths, timings, honest defects and a recommendation. **Stop for the user's choice.**

## Phase 2: `kumiki-blender` shot commands

### Task 4: Shot plan

**Files:** Create `src/kumiki_blender/shot_plan.py`, `tests/test_shot_plan.py`. Modify `src/kumiki_blender/cli.py`.

**Interfaces:**
- Produces: `parse_shot_plan(raw: Any) -> ShotPlan`, `ShotPlanError(ValueError)`, CLI `plan-shot --spec`.

- [ ] **Step 1:** Write failing tests: `test_rejects_unknown_fields`, `test_rejects_fps_mismatch_between_bake_and_render`, `test_rejects_frame_count_mismatch`, `test_rejects_missing_effector`, `test_rejects_paths_outside_root`.
- [ ] **Step 2:** Implement with no Blender dependency, matching `deformation_plan.py`. Run `pytest tests/test_shot_plan.py -v`, expect PASS. Commit.

### Task 5: Actor rig and set assets

**Files:** Create `src/kumiki_blender/blender_actor.py`, `src/kumiki_blender/blender_shot_set.py`, `tests/test_blender_actor_contract.py`.

**Interfaces:**
- Produces: effector names `effector.<id>`, joints `joint.<id>`, expression channels `expr.<id>`, grips `grip.<id>`, surfaces `surface.<id>`, for either actor kind chosen in Phase 1.

- [ ] **Step 1:** Write a failing contract test on a small generated actor: required names exist, and an effector target at a known point is reached within 5 mm.
- [ ] **Step 2:** Implement from manifests, with no character names in code. Add document faces from data rows. Run the test, expect PASS. Commit.

### Task 6: `build-shot`

**Files:** Create `src/kumiki_blender/blender_shot.py`, `tests/test_blender_shot_contract.py`. Modify `src/kumiki_blender/cli.py`.

**Interfaces:**
- Consumes: `ShotPlan`, Task 5 names, `ShotBake` v1.
- Produces: CLI `build-shot --spec --output`, writing `shot.blend`, `shot.mp4`, `shot-manifest.json` with input hashes, Blender version, per-frame contact distances, seconds per frame.

- [ ] **Step 1:** Write failing tests: `test_bake_channels_apply_per_frame`, `test_z_up_conversion_happens_once`, `test_cancel_stops_blender_and_removes_temp`, `test_frame_count_mismatch_fails_named`.
- [ ] **Step 2:** Implement. Render to an owned temp directory, encode, then commit by rename. Run tests, expect PASS. Commit and open the PR.

## Phase 3: `kumiki-ui` interaction and bake

### Task 7: Interaction evaluator

**Files:** Modify `registry/craft/everyday-interactions.ts`. Test `tests/everyday-interactions.test.ts`. Modify `docs/10-character-audio.md`.

**Interfaces:**
- Produces: `compileInteraction(spec: InteractionSpec): InteractionCompilation`, `evaluateInteraction(plan, frame): InteractionFrame` with `objects`, `effectors`, `gaze`, `contacts`.

- [ ] **Step 1:** Write failing tests: `shuffled seek equals linear`, `object is continuous across grasp and release`, `gaze leads the hand`, `double grasp is a diagnostic`, `timing preset changes pacing only`.
- [ ] **Step 2:** Implement. Keep it free of `three`. Run `npx vitest run tests/everyday-interactions.test.ts`, expect PASS. Commit.

### Task 8: `ShotBake` export

**Files:** Create `registry/motion/shot-bake.ts`, `tests/shot-bake.test.ts`. Modify `registry.json`.

**Interfaces:**
- Consumes: `InteractionCompilation`, `compileCinematicCamera`, `evaluateCameraPose3D`.
- Produces: `bakeShot(input: ShotBakeInput): ShotBakeV1`, `parseShotBake(json: string)`.

- [ ] **Step 1:** Write failing tests: `round trip is stable`, `camera tracks a carried object`, `contact events keep their frames`, `rational fps survives`.
- [ ] **Step 2:** Implement. Run the tests, `npm run typecheck`, `npm run catalog:check`, `npm run registry:validate`. Commit.

### Task 9: Shot list editor

**Files:** Create `registry/video/shot-list-editor.tsx`, `docs/component-specs/shot-list-editor.md`, `src/video/shot-list-editor.stories.tsx`, `tests/shot-list-editor.test.tsx`.

**Interfaces:**
- Produces: `ShotListEditor` with props `shots`, `onChange`, `labels`, `readOnly`, `diagnostics`. Generic data only, keyboard operable.

- [ ] **Step 1:** Write failing tests for reorder, keyboard use, diagnostic display, long and Japanese labels.
- [ ] **Step 2:** Implement with existing tokens. Run tests, Storybook build, `npm run registry:fixture -- --item=shot-list-editor`. Inspect a screenshot. Commit and open the PR.

## Phase 4: ContentGen intent

### Task 10: Intent contract

**Files:** Create `apps/web/scripts/video-production/performance-intent.mjs`, `.d.mts`, `.test.mjs`. Modify `apps/web/scripts/video-production/job.mjs`.

**Interfaces:**
- Produces: `validatePerformanceIntent(intent, context): {ok, findings}`, with `context` holding `knownClaimIds`, `cast`, `objects`, `speechWindows`.

- [ ] **Step 1:** Write failing tests: unknown object, `place` before `grasp`, grasp with no grip, missing effector, invented number, action outside its speech window, double grasp.
- [ ] **Step 2:** Implement in the style of `semantic-mechanic.mjs`. Older jobs without the field stay valid. Run `node --test`, expect PASS. Commit.

### Task 11: Director

**Files:** Create `apps/web/scripts/video-production/performance-director.mjs`, `.test.mjs`.

**Interfaces:**
- Produces: `proposePerformance(input, {inference}): Promise<{intent, source, findings}>`, `ruleDirector(input)`.

- [ ] **Step 1:** Write failing tests: rule director output validates, a bad model reply is reported as a finding, retrieved text cannot add verbs, repeat runs match.
- [ ] **Step 2:** Implement with the existing inference gate and profiles. Commit.

## Phase 5: ContentGen integration

### Task 12: Shot render stage

**Files:** Create `apps/web/scripts/video-production/shot-render.mjs`, `.test.mjs`. Modify `produce.mjs`, `crates/server` Jobs labels as needed.

**Interfaces:**
- Consumes: `bakeShot`, CLI `build-shot`.
- Produces: `renderPerformanceShot(shot, deps): Promise<{clipPath, sha256, cacheHit}>`, `shotCacheKey(shot): string`.

- [ ] **Step 1:** Write failing tests: changed narration window changes the key, unchanged shot is a cache hit, missing tool fails before narration, cancel leaves no cache entry, safe subprocess arguments.
- [ ] **Step 2:** Implement. Check `src/video-export` for `three` imports in a test. Commit.

### Task 13: Composite, audio, Director

**Files:** Create `apps/web/src/video-export/performance-clip-scene.tsx`, test. Modify `general-scene.tsx`, `sound-design.mjs`, `kumiki.config.json`, Director UI.

- [ ] **Step 1:** Write failing tests: clip frames match plan frames, label stays in a safe region, contact events map to foley samples.
- [ ] **Step 2:** Implement through the existing frozen footage path. Add Rhubarb mouth cues as `precision: "approximate"`. Mount `ShotListEditor`.
- [ ] **Step 3:** Run `pnpm kumiki:verify`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the cargo checks. Commit and open the PR.

## Phase 6: Benchmark

### Task 14: Real render and defect loop

- [ ] **Step 1:** Add the fixture script with illustrative numbers and render with local voices.
- [ ] **Step 2:** Run ffprobe and full decode. Make a contact sheet per key action. Watch frames in sequence for contact, foot slide, lighting and lip timing.
- [ ] **Step 3:** Log timecoded defects. Fix, re-render the affected shot, compare to previous best. Up to three attempts per defect.
- [ ] **Step 4:** Ask for Fish consent before any final voice render.

## Phase 7: Reuse proof

### Task 15: Second scene

- [ ] **Step 1:** Author a different scene using only data: different props, look profile and action order.
- [ ] **Step 2:** Render it. A code change needed for this scene counts as a defect in the general system: fix it there.
- [ ] **Step 3:** Report capabilities, evidence, limits and remaining work, with technical QA and human approval kept separate.

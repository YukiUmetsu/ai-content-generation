# Cinematic Performance Director — design

**Status:** approved, 2026-11-04. Phase 1 chose inflated actors built from Character Studio packs.
**Repos:** `content-gen`, `kumiki-ui`, `kumiki-blender`.

## 1. Intent

Turn a researched, narrated scene into a cinematic shot where characters physically act on shared objects, and the camera, light and sound reinforce one teaching point.

**Stated by the user:** reuse existing systems, no duplicate renderers, timelines, animation engines or scene schemas. No hardcoded single-purpose code. Blender work goes to `kumiki-blender`. General UI and motion work goes to `kumiki-ui`. Everything must be general and customizable. Passing tests is not proof of quality.

**Success:** one real 10-second 1080p30 MP4 (section 8), plus a second scene that changes only data.

**Non-goals for this slice:** 9:16 output, scenes with more than two characters, walking across large distances, Three.js in the ContentGen export bundle, new scene recipes.

## 2. Ownership

Each capability has one owning repo.

| Capability | Owner | Must not contain |
|---|---|---|
| Shot build, rigging, set dressing, materials, lighting rigs, Blender render, deformation bakes, Blender-side QA | `kumiki-blender` | Teaching logic, consumer names, timing decisions |
| Interaction evaluation (gaze, reach, grasp, carry, place, release), MD1/CC1 compilation, baked channel export, shot list and timeline UI components, clip composition | `kumiki-ui` | `bpy`, business vocabulary, Pip or Quill names |
| Director intent, teaching objective links, claim and asset validation, model prompts, Jobs, cache identity, narration, audio mix, Director screen wiring, cast manifests, fixtures | `content-gen` | `bpy`, keyframes, pose math, 3D geometry, new visual components |

Consumer names such as Pip, Quill and invoice appear only in ContentGen manifests and fixtures. Library code uses roles such as `actor`, `prop`, `surface`, `effector`.

## 3. Data flow

```text
ContentGen                 kumiki-ui                       kumiki-blender
beat + cast + assets
  -> PerformanceIntent v1  -> compile to MD1 + CC1
     (validated)           -> ShotBake v1 (per-frame) -->  plan-shot / build-shot
                                                           -> H.264 clip + shot manifest
existing frozen footage path  <-------------------------------+
  + overlays + audio mix -> existing MP4 export
```

The clock stays in one place. Kumiki resolves every frame. Blender receives baked channels and renders them. Blender authors no timing. Bake outputs from `kumiki-blender` (cloth settle, contact measurements) go back as data with a frame index.

## 4. Contracts

### 4.1 `PerformanceIntent` v1 (`content-gen`)

An optional field at `visual.direction.performance`. It extends the existing direction object. It is not a new scene schema.

- **Teaching:** `objective`, `visualChange`, `claimIds`.
- **Cast and objects:** `actors[]`, `objects[]`. Each reference pins an asset revision and hash.
- **Actions:** ordered items with an actor, a verb, a target, and an anchor to a spoken phrase or an earlier action. Verbs come from a closed list: `enter`, `look-at`, `reach`, `grasp`, `carry`, `place`, `release`, `examine`, `point-at`, `react`, `speak`.
- **Shots:** ordered intents from a closed list: `establish`, `follow`, `push-in`, `rack-focus`, `insert`, `reveal-hold`. Each names the subject it makes clearer.
- **Light and sound:** `key-shift`, `surround-dim`, `foley-on-contact`, `room-tone`, `silence`, `accent`.
- **Look:** a reference to a named look profile, plus bounded overrides.

A model may propose this object. Code does all frame math. A validator rejects unknown objects, a `place` with no earlier `grasp`, a grasp on an object with no grip, an action that does not fit the speech window, invented numbers, and any capability that the pinned assets do not declare.

### 4.2 Interaction choreography (`kumiki-ui`)

A pure, frame-addressable evaluator at `registry/motion/interaction-choreography.ts`. It does not extend `everyday-interactions.ts`, because that file imports Three.js through `hero-action`. It implements the `character-interaction` row in `docs/10-character-audio.md`.

- **Input:** actors with named effectors and head joints, objects with named grips and rest surfaces, ordered operations, world-space start poses, and timing presets.
- **Behavior:** an object is either at rest on a surface or attached to one effector. Attachment changes only on a declared contact frame. The object pose is continuous across that frame. Gaze leads the hand. Reach uses anticipation and follow-through from a named timing preset.
- **Determinism:** state is a pure function of frame. Shuffled seek equals linear playback.
- **Output:** MD1 nodes, MD1 events for contact, and CC1 target samples so the camera can track moving subjects through the existing solver.

### 4.3 `ShotBake` v1 (`kumiki-ui` emits, `kumiki-blender` consumes)

JSON with `schemaVersion`, rational `fps`, `durationFrames`, and per-frame channels. It holds camera pose (from `evaluateCameraPose3D`), focus distance, object world transforms, effector targets, gaze targets, joint or expression channels, light levels, and contact events. Units are metres in Kumiki Y-up space. Conversion to Blender Z-up happens once, in `kumiki-blender`.

Node code compiles the bake. CC1 declares `three`. It is used in that Node step only. A test asserts that `src/video-export` does not import `three`, which keeps the decision in `docs/14-kumiki-integration.md`.

### 4.4 Shot spec (`kumiki-blender`)

New `plan-shot` and `build-shot` commands that follow the existing `plan-*` and `build-*` pattern. `plan-shot` validates without Blender. `build-shot` runs headless.

- **Input:** set manifest, actor assets, prop assets, look profile, render profile, `ShotBake`.
- **Output:** `.blend`, H.264 clip, `shot-manifest.json` with input hashes, Blender version, per-frame contact distances, and timing.
- **Actors:** a Character Studio pack plus a staging profile. Layers become inflated meshes with bone chains that follow the drawn limbs. Phase 1 rejected a from-scratch mesh because it did not hold the character design.
- **Failure:** missing assets, wrong effector names or bake mismatch stop the build with a named diagnostic.

### 4.5 Reusable UI (`kumiki-ui`)

A shot list and timing editor component that takes generic shots and actions. ContentGen mounts it in Director and supplies labels and persistence. `frame-accurate-clip` is vendored for clip placement if the existing footage path cannot hold the overlays.

## 5. Customization

Each item below is data. No code change is needed to swap one.

- **Look profiles:** palette, lens, depth of field, key direction, grade, grain.
- **Set manifests:** surfaces, props, placement slots, reference scale.
- **Cast manifests:** asset revision, effectors, joints, visemes, voice ID.
- **Timing presets:** restrained, natural, expressive.
- **Render profiles:** draft, review, final. Each sets engine, samples, and resolution.
- **Document faces:** data rows rendered to texture, so printed numbers are exact.

## 6. Failure behavior

No silent fallback. An unsupported action, missing rig capability or failed render blocks that shot and reports the shot ID and reason in Director and Jobs. An explicit draft mode may use a labelled low-sample render. It may not switch a 3D shot to a diagram without the user's choice.

Render work runs as Jobs attempts. It is cancellable, bounded, and resumes from verified cache entries. A cache key covers the plan slice, the asset hashes, the tool versions and the render profile. Editing one shot re-renders only that shot. Previous outputs stay on disk until the user removes them.

## 7. Verification

**Automated:** intent validator cases, shuffled seek, contact continuity, contact distance within tolerance on every contact frame, no prop below a surface, bake round trip, cache identity, cancel and failure paths, and the `three` import guard.

**Rendered:** real MP4, full decode, contact sheet at each key action, timecoded defect log, and a side-by-side against the previous best. Up to three attempts per defect, then change strategy or report a blocker.

**Human:** the user judges the look at Phase 1 and the final MP4. Technical QA and aesthetic approval stay separate in every report.

**Resources:** one heavy process at a time. Scene work stays under 5 GB. Work pauses if free disk drops below 8 GB. No deletion of user files or shared caches.

## 8. First benchmark

10 seconds, 1920×1080, 30 fps, illustrative numbers.

| Frames | Picture | Sound |
|---|---|---|
| 0–74 | Low wide shot in warm lamp light. Pip carries the invoice in and places it. The paper settles. | Pip line, paper foley on contact |
| 75–164 | Quill lifts the receipt, leans in, and looks between the two documents. | Quill line, paper rustle |
| 165–239 | The camera pushes in and racks focus to the two totals. The light narrows. | Room tone drops |
| 240–299 | Hold on $120 and $100 with one small $20 label. Both characters react. | Restrained accent, silence |

## 9. Phases

0. This spec and an implementation plan.
1. Look-dev spike: desk look frame and A/B character stills, real render timing. **The user chooses.**
2. `kumiki-blender`: shot commands, rigging, set and props.
3. `kumiki-ui`: interaction evaluator, `ShotBake`, shot list UI.
4. `content-gen`: intent, validator, rule director, model proposer.
5. `content-gen`: Jobs node, cache, clip integration, foley and mouth cues, Director wiring.
6. All repos: benchmark render and defect loop.
7. Second scene with data changes only.

## 10. Known risks

- Agent-built fur and feathers may not hold the character design. Phase 1 exists to find this out.
- Real shots will render slower than the trivial test, which took about 2 s per frame. A full-length film must use 3D selectively.
- Mouth cues from Rhubarb are English-first and estimated. Reports must say so.
- Hands overlap held objects. They do not close around them.
- A flat rig's `walk` action fakes depth, so 3D shots use `gait`, which follows real ground travel.
- `three` in a Node-only step must stay out of the export bundle.

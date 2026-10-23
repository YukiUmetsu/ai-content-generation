# Visible learning states — design

## Intent

Generated videos should show how a researched subject changes, not animate a sequence of unrelated labels. The viewer should be able to infer the mechanism from a silent scene. ContentGen remains responsible for research, narration and semantic direction; the existing Kumiki-backed renderer remains responsible for actual visuals.

## Chosen approach and alternatives

- **Chosen: small structured visual-state contract plus one generalized rendered transformation.** This makes the existing teaching sequence genuinely visible with deterministic checks and no new model calls, domains, dependencies or asset assumptions.
- Prompt-only polish is cheaper, but unrendered `visualAction` text would remain decorative metadata.
- Domain-specific bespoke animation libraries could be more expressive, but would not generalize and would add licensing, asset and QA burdens. Those can be added separately once generic scenes are trustworthy.

## Behavior

- An LLM-generated teaching sequence includes `visualStates:{before,action,after}`. Each string is a concrete, concise, distinct visible state or operation; source claims remain separate and unverified.
- The validator rejects missing/empty/duplicate/placeholder states in new generation; legacy saved plans lacking `visualStates` remain loadable.
- The render bridge forwards these states only to technical-subject shots, alongside the existing phase and subject ID. Analogy shots and bespoke recipes retain their existing renderer.
- General scenes render one persistent subject with a problem state, an animated causal transition, and the resulting state. The problem cannot reveal the conclusion early; the first payoff frame stays hidden. Every scene stays within the 1920×1080 canvas and is deterministic at an absolute frame.
- The source claim IDs, review state, narration and rights gates remain unchanged; no fabricated numbers or values are introduced.

## Non-goals

- Arbitrary physical simulations or 3D assets based on free-form text.
- Guaranteeing that an LLM's conceptual explanation is true. All facts and metaphors remain review-required.
- Automatically generating audio or MP4s, publishing, or adding YouTube view statistics as evidence.

## UX and verification

Video Director's existing live preview and MP4 exporter use the same scene component. Tests must check validation, legacy compatibility, propagation to the job, both problem and mechanism states, payoff reveal timing, and bounds by layout constants. Normal-speed playback and real browser-to-FFmpeg export remain manual sign-off items.

The separately merged Research-tab sourced storyboard path uses a browser-local static StoryboardPlanner preview, not Video Director's MP4 renderer. Preserve and expose the state labels there for user editing; prevent the static planner from displaying hardcoded HVAC-example dollar values for research-generated topics. Neither static planning view nor its Kumiki storyboard projection is an MP4 renderer.

# Resumable small-model scene generation

## Intent

`output_truncated` has persisted after increasing the scene output allowance. One local AI response currently must supply the scene's subject, structural states, three full visual phases, and three narrations. A single incomplete response loses all of that work. The goal is to make a Qwen-sized local model complete short requests and preserve every accepted result.

## Approach

Use the existing research job queue and checkpoint directory, but split each scene into one structure request and six independent requests (one visual and one narration for each of three phases). Validate each item before writing its checkpoint. Assemble the existing scene schema deterministically; never ask the model to rewrite the whole scene. A resumed job skips existing validated checkpoints. A manual scene retry uses the existing revision mechanism to invalidate only the selected scene.

We considered raising the token limit again (known to be insufficient), and splitting scenes into three phase requests with narration included (smaller but still more likely to truncate). Separate visuals and narration yield small fixed-size JSON and reuse the current output validators.

## Requirements

- Keep saved source evidence and model settings snapshots unchanged; no new external service or raw model-output logging.
- Preserve previously checkpointed whole scenes from older jobs.
- Each subtask uses the existing three-attempt retry and optional secondary local model. On truncation, use a more compact prompt and never discard already accepted subtasks.
- Outline retries also shrink to an explicitly requested two-beat response; Qwen3-style local models receive a no-thinking hint, without relying on provider-specific request fields.
- Keep the final `preproduction-plan` schema and validation unchanged.
- Keep the existing `scene:<number>` stage for UI compatibility; expose an optional safe substep label for progress.
- Completion, restart, cancellation, model identity changes, and manual scene retries retain their current guarantees.

## Non-goals

- Replacing the local model backend or assuming one model-specific thinking-disable flag.
- Guessing how to close truncated JSON or treating partial output as correct evidence.

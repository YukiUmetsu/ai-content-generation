# Research Scene Micro-jobs Design

## Intent

An installed local model (reported Qwen3.5 9B Q4) is still returning `output_truncated` on the first scene's `structure` request, even though outline and phase generation were previously separated. Reduce the size of every remaining multi-field AI response without changing the final teaching-plan contract, research evidence safeguards, or model settings.

## Approach and Tradeoffs

- **Chosen:** Split both structure and visual generation into independently validated, checkpointed fragments. This adds a few local inference calls, but each has a tiny output contract and a natural resume boundary.
- Raising output limits alone is insufficient: settings already control token/timeout budgets, and a length finish can still occur when the local provider spends output tokens on other text or reasoning.
- Splitting narration is not useful: it already asks for one short string. Do not add extra jobs for an atomic response.

## Contracts

For each scene revision, create `structure_core` ({subject,parts,operator}) followed by `structure_states` ({before,action,after}), and assemble the same validated `structure` artifact used downstream. Preserve existing complete `structure` checkpoints.

For each of three phases, create `visual_direction` ({visualAction,learningChange,onScreenText}) followed by `visual_elements` ({visualElements:[{label,detail},{label,detail}]}), assemble the same validated `visual` artifact, then generate narration as before. Preserve existing complete `visual` checkpoints.

Each new fragment gets the existing local AI timeout/token settings, sequential inference lock, bounded retries, secondary model fallback, atomic file checkpoint, and safe diagnostics. On resume, skip all completed fragments. Manual scene revision or model-identity change starts fresh checkpoint names, without deleting prior checkpoints.

No captured source text, URLs, model prompts, or raw replies enter logs or status. Existing `scene`/`structure`/`visual` injection points remain compatible with tests and older integrations.

## Verification

- Planner tests prove short, valid JSON requests and deterministic reconstruction; validation rejects malformed actor/state combinations or repeated visual actions.
- Queue tests prove `structure_states` truncation resumes after saved `structure_core`; `visual_elements` truncation resumes after saved direction, without rerunning accepted phases.
- Legacy full-scene, full-structure, and full-visual checkpoints are reused without invoking new fragments.
- All available video-production tests pass. Live Magnitude inference and full frontend CI are separate manual checks.

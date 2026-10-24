# Schema-Aware Storyboard Retries

## Intent

Let a small local model correct the actual schema failure instead of making near-identical attempts. Preserve meaningful variation between problem, mechanism, and payoff and keep evidence constraints intact.

## Behavior

- A duplicate `learningChange` or `visualAction` receives the safe issue code `duplicate_previous` and repair feedback that names the current phase's distinct instructional job, warns against paraphrasing a prior phase, and points the model to the already provided prior visuals.
- Missing or wrong-type scene-direction fields carry safe `missing`/`wrong_type` issue codes; malformed `visualElements` receives required shape/type feedback directing the model to two distinct concrete `{label,detail}` objects. Output truncation receives compact-complete-JSON instructions. Temporary provider errors continue normal backoff without suggesting a schema fix.
- Valid short visual element labels stay bounded at 44 characters for layout; an internal `detail` description may reach 160 characters. Keep model prompts recommending short labels/details. Never truncate content or fabricate an accepted answer.
- Retry behavior, job checkpoints, evidence inputs, model selection, and maximum attempts stay unchanged. Only field/issue codes go to public job state and routine logs; no generated content is leaked.

## Alternatives

1. Blindly raise retry counts: rejected; wastes memory and does not address repeated content.
2. Remove uniqueness checks: rejected; accepts repetitive storyboard scenes.
3. **Chosen:** classify the failure, target the retry prompt and phase goal, retain validation.

## Verification

Tests must show real duplicate errors carry a machine code, retry feedback changes by error and by phase, a repeated attempt can recover, a 47-character internal detail is valid, and existing jobs remain crash-resumable.

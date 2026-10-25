# Natural project search keywords — narrow fix

## Intent

Project discovery should suggest concise, natural **search phrases**, not video titles, viewer questions or invented analytical comparisons. Keep rationales separate and preserve useful incremental batches/retries.

## Accepted behavior

- Prefer two or three meaningful words. Four words are acceptable for concrete phrases such as `heat pump installation cost`; anything longer is filtered before it can reach review.
- Reject punctuation-only text and one-word generic topics rather than counting them as useful search phrases.
- Four-word phrases must not contain unnecessary editorial framing. Preserve established technical terms with integral connectors (`cost of living adjustment`) and dotted names (`Node.js vs Bun`); filter vague jargon, including the user's reported `lifecycle maintenance timing`.
- `X vs Y` is eligible only as a compact three-word comparison, such as `rent vs buy` or `fixed vs ARM`, then subject to the existing optional semantic judgment. Long comparisons cannot pass even if the local model approves them.
- A `vs` separator must have alternatives on **both sides**. Product names such as `VS Code` and `VS Code extensions` are ordinary keywords and must not be mistaken for comparisons.
- Do not place bad examples or rejected phrases into later generation prompts: smaller models have visibly echoed them. Use abstract exclusion instructions and rejection counts instead.
- Keep previously accepted long-form keywords untouched for project data and deduplication, but filter them out of the model's contextual `existingKeywords` list.
- Refill under the existing 12-call global budget. Never fabricate replacement phrases or alter saved/manual keywords. Show partial suggestions immediately.

## Approaches and tradeoffs

1. **Chosen: deterministic acceptance and clean prompting.** Fast, provider-independent cap and clear grammar rules; retain conservative optional meaning check for compact comparisons. Some legitimate longer search phrases will be omitted.
2. Per-suggestion AI rewrites and judgments: slower on the user's local 9B model, consumes extra calls, and can still approve unnatural phrases. Not selected.

## Scope

Change the existing keyword generator/quality tests and the project-discovery guide only. No persistence, API, UI, external service or schema changes. Cover the user's eight reported outputs, accepted natural equivalents, retry/refill and cancellation using deterministic tests.

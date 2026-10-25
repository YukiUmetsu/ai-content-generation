# Concise discovery keywords — design

## Intent

Project keyword suggestions should be short, useful search phrases rather than sentence-length video concepts. A separate rationale can explain the viewer's question. The local model still supplies review-only suggestions in small serial batches with no invented demand data.

## Chosen approach

- Target 2–5 words; allow at most 7 for an established technical term or comparison. Reject longer candidates in the existing quality gate rather than trimming their meaning arbitrarily.
- Put explicit short/long examples and limits in every local-model keyword prompt, including revision feedback when a prior batch was too verbose.
- Filter redundant ideas using existing intent matching plus a small list of clearly repeated concept anchors (e.g. opportunity cost), without conflating unrelated cost topics.
- Preserve `topic`, `query` and `exclusion` kinds, distinct rationales, Accept/Skip/Stop, bounded inference and the no-auto-activation rule. Full video questions belong in later idea development, not keyword text.

## Approaches considered

1. **Compact text at generation + deterministic screening (chosen):** small change, predictable output and review UI; weak results may be rejected instead of displayed.
2. Keep verbose AI phrases and shorten only when searching: original UI stays noisy and search behavior becomes opaque.
3. Add separate video-topic/keyword dual fields now: flexible but requires premature schema, UI and migration changes.

## Boundaries and verification

No persistence migration or external service changes. Test verbose rejection, concise technical acceptance, overlapping opportunity-cost proposals, short prompt and incremental batches; run keyword tests plus web checks. Previously accepted user keywords must not be silently modified.

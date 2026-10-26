# Keyword semantic quality and refill — short design

## Goal

Keep project keywords relevant, natural and useful for search, without pretending that keyword suggestions are demand measurements. A meaningful short comparison such as `rent vs buy` should be eligible; a false comparison such as `mortgage interest vs property tax` should not reach the review list. When quality screening discards a batch, keep trying within a strict local-inference budget while publishing each successful batch immediately.

## Approach and tradeoffs

1. **Chosen: hybrid screening and bounded refill.** Deterministic validation catches malformed/verbose/duplicate entries. For ambiguous `X vs Y` phrases, a tiny local-model suitability check judges whether both sides are genuine alternative choices serving one decision. The generator does not discard ordinary keywords while waiting for the check. Failed/unclear comparison checks fail closed; subsequent refill may replace them. This adds occasional small model requests, but no new provider or global token budget.
2. Prompt-only improvements: cheapest but the same unreliable model could confidently produce meaningless comparisons.
3. Full semantic review for every suggestion: potentially more reliable but doubles heavy-model latency and crowds out refill capacity.

## Requirements

- Generate 1–2 candidates at a time; retain earlier valid suggestions across failed later calls. Avoid automatic Accept or persistence changes.
- Evaluate comparisons *as alternatives*, not by length alone; short sensible `vs` topics remain possible.
- Refill after the original six lenses, using rejected examples and accepted keywords as context; stop at the existing **12 total local model calls**, an additional **four refill passes**, repeated-empty-streak cutoff, target count, or cancellation, whichever happens first.
- The optional comparison check consumes the same total inference budget, uses at most one small nonstreaming JSON request per candidate batch, and does not claim empirical search popularity. Missing/invalid comparison verdicts reject only the uncertain comparison rows; normal rows still progress.
- UI copy communicates an upper bound rather than promising exactly six batches. No schema migration, network provider setup or auto-activation.

## Verification

RED→GREEN tests: accepted `fixed vs adjustable mortgage` and `rent vs buy`, rejected `mortgage interest vs property tax`, comparison evaluator unavailable but ordinary terms survive; refill eventually gets target, never exceeds 12 calls; interrupted/refill results remain available.

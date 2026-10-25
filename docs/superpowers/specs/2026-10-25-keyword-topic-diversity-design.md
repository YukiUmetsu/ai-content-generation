# Keyword suggestion topic diversity — design

## Intent

For broad educational projects, local keyword generation should explore different core subjects. The current duplicate-intent check rightly preserves distinct searches such as `property tax assessment` and `property tax exemption rules`, but also lets a whole batch become variations of `property tax`.

## Contract

- Keep the existing 2–4 word natural-language and duplicate-intent checks.
- In broad projects, admit at most **two** suggestions sharing the same first two normalized meaningful terms (their core subject). Count prior manually selected topics and approved suggestions, but do not count excluded suggestions or rejected model output as topical coverage.
- A project explicitly specialized in that core subject may admit additional distinct searches. Focus comes from a dominant single-subject name or affirmative focused description; a multi-topic list or negated focus statement does not override the cap.
- Exclusions do not occupy topical coverage slots; accepted or manually seeded topic/query terms do. The client sends active exclusions separately from positive keyword seeds.
- Subject coverage is calculated after optional semantic review so rejected ambiguous wording cannot occupy a slot ahead of valid alternatives.
- Locally reject overrepresented subjects; use the existing refill lenses and shared 12-call budget. Keep incremental accepted results and honest partial results. Do not send rejected literal wording back to the local model.
- The rule must work for topics outside housing, including technology, and must not rely on a tax-specific vocabulary or an extra LLM call.

## Approaches

1. **Chosen: deterministic subject-anchor cap.** Fast, predictable and testable offline. It will occasionally group different questions sharing a short subject phrase, so allow two and exempt clear niche specialization.
2. Model-only diversity prompt: cheap to add but cannot reliably constrain small local models, as the current example demonstrates.
3. Embedding/topic clustering: more flexible synonyms but new model latency, memory and false-neighbor risks disproportionate to this review workflow.

## Boundaries and acceptance

No schema, settings, UI, persistent data or search volume changes. Existing manual choices stay untouched. A seven-suggestion broad home-budget batch with four `property tax …` suggestions must retain only the first two and seek other areas in later batches. A focused tax-only project may keep multiple distinct tax searches. Tests exercise screening, rejected-history separation and refill behavior.

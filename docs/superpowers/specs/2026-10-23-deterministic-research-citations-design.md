# Deterministic source passage references

## Intent

Research & generate storyboard currently asks the local model to copy exact quotations from captured pages. Small models frequently paraphrase or alter punctuation, causing a fatal `Claim N has an unsupported or non-verbatim source quote` even after search succeeded and its results were saved. The user approved replacing this fragile step with source-derived passage IDs.

## Constraints and non-goals

- Search snapshots, public-source capture security, local inference, downstream dossier and quote-preview shapes remain unchanged.
- No fabricated quotes, fuzzy substring matches, external LLM, or unsupported claims become source-backed evidence.
- Captured material is untrusted and citations remain `unverified` until editorial review.
- Keep local inference to one request and bound prompt size; do not repeatedly retry the model.

## Approach selected

**Selected: deterministic passage IDs.** The server splits each *actual captured text snapshot* into short, contiguous verbatim passages, assigns stable IDs, and sends those passages to the model. The model returns claim text and selected passage IDs (not generated quote strings). The server maps IDs to exact source text and produces the existing `sourceId` + `quote` claim support shape. Invalid references are omitted; the corresponding claim is excluded if it has no valid support, with a transparent research gap. If no claims retain valid references, the research fails closed with an actionable message. A valid passage ID is necessary but is not a semantic fact check, so every claim remains unverified.

**Considered: automatic model retries.** Rejected because it increases latency and model-memory pressure, may reproduce the same malformed quote, and does not address free-text quotation drift.

**Considered: approximate text matching.** Rejected because guessed citations could attach unrelated or incorrect page text to an AI assertion.

## Boundaries

- `research-agent.mjs` owns deterministic passage extraction, prompt schema, ID resolution and strict existing quote checks. It preserves the external dossier contract.
- `research-agent.test.mjs` covers accurate ID resolution, mixed valid/invalid references, unknown-only references, and unchanged exact-quote rejection for legacy/injected analyzers.
- `studio-research.mjs`, saved-search APIs, and Studio frontend need no functional change. They continue to receive literal, hashable source excerpts.

## Success criteria

1. The model never needs to type a verbatim quote to cite captured source material.
2. Unknown passage IDs cannot create citations; a valid subset of claims can generate a dossier with visible gaps for omitted claims.
3. With no supported claims, generation fails explicitly and leaves saved searches intact.
4. Existing tests and public-source security constraints remain intact.

## Follow-up: local inference timeout reported during implementation

The user confirmed that storyboard creation from saved search also aborts after the Mac works hard. Both research and storyboard-planning requests currently use a three-minute local inference timeout. The response does not say which stage elapsed. Scope this fix to two small safeguards: send at most 4,000 characters of captured text per source to the research model (the full snapshots remain captured for provenance) and report Research AI vs Storyboard planning AI timeout distinctly. Do not silently change model selection, claim verification, pricing, or machine-level timeout settings. These measures reduce research prompt pressure and improve diagnosis; they cannot guarantee that a memory-starved local model will complete a complex story plan.

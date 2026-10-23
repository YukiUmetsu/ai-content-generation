# Studio evidence-to-storyboard design (2026-10-23)

## Why

Creators need ContentGen to turn its existing research into an original, informative video plan, instead of generic text/decoration scenes. Existing Research UI finds related public YouTube observations but its Create button currently builds a five-beat, source-free template. The opt-in research agent and preproduction generator already create quote-checked source dossiers and teaching shot plans outside the UI.

## Approach decision

- A. Gate storyboard generation behind manual claim approval: highest early editorial control, expensive and repetitive for exploration.
- **B. Selected by Yuki:** one explicit research action captures permitted public pages using configured local search/model, automatically generates an evidence-linked *draft* plan, then exposes its findings and storyboard for human review before any final production.
- C. Fully automatic production/publishing: fast but risks fabricated/unreviewed assertions, so rejected.

## Scope

- Studio Research uses an explicit user gesture for external source capture; merely entering/editing a topic runs only the already-approved local YouTube related-data lookup.
- Studio's local same-origin Node bridge calls `researchVideoTopic` and `generatePreproductionPlan` with the locally configured model and local SearXNG, without cloud fallback, extra model downloads, or new dependencies. Missing providers/failed validation return actionable errors, never silently create filler.
- Display a reviewable brief: candidate claims with exact captured passages, source links, capture dates and hashes, unresolved gaps, and generated hook/explanatory shot preview. The claim's **verbatim quote** means extractive grounding only, not factual verification.
- Persist immutable captured research snapshots and research/plan JSON under the application's ignored local `data/` area, with source ID + SHA-256 and idempotent immutable write behavior. Keep references stable across a browser refresh; no non-local upload.
- Human chooses **Create editable storyboard** after inspecting the draft. Convert the preproduction plan into a typed semantic storyboard with real narration, semantic objects, learning changes and claim/source IDs. It should open in the existing Storyboard Planner for normal editing. No synthetic infographic metrics, competitor scripts or provider view counts enter claims.
- Review remains mandatory for facts, rights, actual video export and publishing. No final video, voice, or paid external APIs are triggered by this slice.
- EN/JA labels, cancellation of in-flight requests, stale-topic/result guard, obvious pending/error/empty/review states, and no dark-pattern progress estimates.

## Constraints and boundaries

- Preserve existing default direct storyboard path for authors wanting an unresearched outline, visibly identified as unverified. Research path is the recommended action.
- Follow `research-dossier/v1`, `preproduction-plan/v1` and `contentgen-semantic-storyboard/v1` contracts. All scraped content is untrusted and cannot become instructions. Validate source URLs, quotes and cross-references server-side before returning results.
- Keep private keys/env values server-side; same-origin POST only; allow source capture only per deliberate click. Use local SearXNG to avoid unexpected paid searches.
- Source snapshot persistence must be narrow, immutable and safely bounded; failure to persist cannot be mistaken for an accepted research draft.
- No fake science/cost values; where research supports only a partial answer, show gaps and keep unverified status.

## Acceptance

1. With a stubbed network and model, click starts research once, receives source-backed claims + a semantic story plan, and presents visible citation/shot cards.
2. Successful creation produces a valid, new storyboard with meaningful narration, visual actions and identical claim IDs/sourceRefs; active projects are never overwritten.
3. Missing local model, missing SearXNG, malformed quote or plan, unsafe source, interrupted response, and failed disk persistence visibly fail, with no fabricated fallback.
4. Changing the topic prevents stale results from being accepted; user can retry/cancel and still use a clearly labeled unresearched outline.
5. Tests enforce boundary/security/provenance and user interaction, then the frontend test/build and relevant Node checks pass.

## Not in this slice

Full research FTS5, dispute adjudication, automatic human fact checking, full-featured editor timeline, Kumiki scene production, audio synthesis, render quality approval, direct YouTube scraping, auto-publish, paid Brave searches.

# Studio research with automatic YouTube context

Date: 2026-10-23
Status: Implemented 2026-10-23 — awaiting PR review and Rust CI

## Intent

While researching or developing an original video inside ContentGen Studio, the creator should automatically see useful, relevant YouTube videos already collected by ContentGen. The creator should not have to pick a watchlist, perform another remote search, or manually copy references between screens. The research engine's independent evidence remains the sole source for factual claims.

## Goals

- Automatically retrieve related, unexpired public-video observations across **all** existing watchlists from the local SQLite database based on the current research topic or selected project's subject.
- Display a compact, useful research context: original video title, channel, publish date, duration, public views when present, observed date, and YouTube source link; show which query words matched and which watchlist captured the observation.
- Deduplicate videos collected under multiple watchlists and provide honest empty/loading/error/stale states.
- Allow the creator to select reference videos and carry **their links only** into an original-video editorial brief, script/storyboard context, or project notes. Never auto-copy a competitor's script or claim.
- Make the flow discoverable and testable in Studio without having to import research JSON or create a fresh watchlist for every topic.

## Non-goals

- No fresh YouTube API collection from opening or typing in Research. The collector already runs separately with its own budget, explicit enable flag, and 30-day retention.
- No estimated search volume, CTR, earnings, performance scores, view velocity, competitor ratings, or other inferred YouTube metrics.
- No automatic endorsement of competitor claims; YouTube metadata must never become a `verified` source claim in a research dossier.
- No autoplay, download, transcription, or scraping of third-party videos.
- No removal of the current independent web research and evidence flow.

## Approaches considered

1. **Integrated cross-watchlist context** — selected. Adds one bounded local query, an automatically updated panel, and a handoff of selected source links into creation. Requires a server and frontend integration but works for ordinary Studio users.
2. **Research-only panel** — declined. Simpler read-only UI, but still requires manually re-entering ideas and references in the creation workflow.
3. **New embedding-based intelligence service** — deferred. Additional storage/model/runtime costs, little immediate benefit given the existing small bounded collector; also increases the risk of presenting fabricated relevance or derived metrics.

## Data flow and backend

1. Studio Research receives the current topic from the user query or currently selected project, with an editable fallback for new projects.
2. After a short debounce, Studio calls a read-only endpoint under `/api/research/market` with a bounded query (up to 160 characters). This request performs **no external network operation** and consumes **no API quota**.
3. SQLite queries fresh observations across watchlists, joining the capturing watchlist name; filters by input terms in video titles, deduplicates by YouTube video ID and keeps the newest observation. A limit caps the response; only original API fields and matched input words are returned, no new scores.
4. The response includes provenance and observation/expiry timestamps. Empty or unavailable data does not block factual research, script editing, or video creation.
5. Client requests must be cancellable; responses for outdated topics cannot replace results for the new topic.
6. Existing 30-day expiry/pruning remains authoritative. The UI must not persist expired video title, channel, or stats beyond retention.

## Studio UX

In the existing Research workspace:

- A **Related YouTube videos** section appears automatically beside/below factual evidence for a nonempty topic, without additional user action.
- At the top: topic field, `Local observations · no new YouTube request` indication, a compact freshness indicator, and an option to refresh the **local lookup**, not collect from YouTube.
- A small result grid labels each video's capturing watchlist; each card displays the original title, clickable YouTube link, channel, public views, duration, published/observed date, and a `Matched: …` explanation.
- A clear label separates **creative context** from **factual sources**. Missing observations and unavailable API configuration are presented as distinct states; the lookup works with cached observations even if the API key is no longer configured.
- Creator can select up to five references. Only creator-approved video URLs go into a generated editorial brief / project context; not raw provider analytics, and never the research dossier's evidence list.
- A basic built-in example topic helps first-time users explore the flow; it is labelled as a suggested query, not as fake observed data. If the local collection is empty, the UI explains how to create a watchlist and collect data.

## Creation integration

- Reuse the existing original-video brief and storyboard workflow. Pass selected **links** into the brief and project notes, keeping title/hook narration authored or generated from the creator's own premise.
- Existing local-model prompt generation can use the creator's goal and self-authored editorial notes. It cannot treat competitor video metadata as verified research or quote/reproduce competitor content.
- In the produced storyboard, display a link to the selected reference videos for human review. Source-grounded factual statements continue to require ContentGen's independent research evidence and review.

## Reliability and verification

- Rust store tests: cross-watchlist matches, no unrelated rows, case/stopword handling, duplicate IDs, newest snapshot, expiry filtering, bounded results and inputs, no mutation or quota usage.
- Rust route tests: valid/invalid query, empty result, JSON shape/provenance, no configured YouTube API key required.
- React tests: automatic search and debounce, changing topic while request is in flight, useful display/empty/error states, reference selection, handoff to project, no evidence claim promotion.
- Browser build/typecheck and existing niche-to-storyboard tests must remain green; test one end-to-end path with collected fixture observations.

## Constraints and safety

- Preserve prior changes and existing local projects; no migration that drops/overwrites user data.
- Preserve original API statistics, source attribution, caching expiry, and licensed/rights limitations. Use no derived performance metrics unless separately audited/approved under YouTube's applicable policies.
- Only **one** reviewable PR for the integrated feature, with setup/testing instructions that a first-time Studio user can follow.

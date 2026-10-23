# Niche to storyboard: editorial creative brief

## Outcome

In Research → YouTube Intelligence, a creator can take an authored niche query, supply an original audience question and payoff, compare three editable packaging/hook treatments, then create a fresh local video project and open an editable semantic storyboard. The workflow works without an API key or model; a separately opted-in installed local model can propose richer alternatives.

## Boundaries

- The YouTube Data API observations remain read-only. No score, ranking, estimated search volume, trend forecast or derivative metrics are generated. No observed video title, description, statistics or channel metadata enters an AI prompt or generated brief.
- User-picked video URLs are labelled **inspiration references**, not evidence for a factual claim. The creator writes the topic, target viewer, question, promise, context and optional evidence notes explicitly.
- AI generation is initiated by button, runs on a configured loopback model only, uses the existing configurable `hooks` stage prompt, and emits three *unverified draft* packaging alternatives. If the model is unavailable, deterministic starter alternatives always work.
- Every generated scene is an unverified editorial plan: no unconfirmed numerical claims, invented study citations or approved voice rights. First frame establishes audience relevance and unresolved question; final beat visibly answers that question. Visual actions are semantic instructions for the editor, **not** a rendered video.
- Creating a storyboard makes a new local project instead of overwriting any existing storyboard. Save failure is reported and the previous active project is preserved.

## UX and data flow

1. Select tracked niche; `query` is suggested as an editable original topic (even when observations are empty). Optionally attach a public video as *inspiration only*.
2. Fill audience, topic, viewer question, planned payoff and factual-review notes. Click **Create 3 approaches** for zero-cost, deterministic patterns; optionally **Generate with local AI** if the user configured a model. ContentGen never auto-sends the YouTube API payload to the model.
3. Edit title, narration hook, first-frame animation, on-screen label, thumbnail idea, sound intent and payoff connection of any approach. Select an approach and choose **Open as storyboard**.
4. A new project appears in the catalog with draft metadata; its semantic storyboard contains five editable beats (hook, setup, explanation, evidence/review, takeaway), semantic objects/events, a question opened/answered, and unresolved claims. Navigate to Create → Storyboard.

## Persistence

Versioned browser-local draft keyed by watchlist ID, capped and validated. No network writes other than explicit local-model generation. Saved storyboard uses the existing local project storyboard schema and storage. Notes in Content are short, explicitly unverified, with optional reference URL; references are not evidence.

## Acceptance tests

- Empty-observation watchlist still supports brief drafting.
- Public video metrics/title/channel never enter the local-model request or generated storyboard.
- Three distinct, editable patterns; local AI schema and loopback endpoint are verified; rejection leaves existing draft untouched.
- Storyboard validates, has a first-frame hook with motion intent, unanswered question until payoff, and no falsely sourced claim.
- New project isolation; failures never overwrite another project's storyboard.
- React interaction tests, model endpoint tests, typecheck, build, existing web suite.

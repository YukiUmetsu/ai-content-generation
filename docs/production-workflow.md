# Guided Production workspace

Production is the primary, project-scoped entry point for making a video. It shows six stages in a slim left rail:

1. **Brief** — define the video question, audience and intended payoff.
2. **Research** — search, capture sources, generate saved teaching units, and check references.
3. **Storyboard** — inspect the editable explanation and issue groups; open Storyboard Planner for changes.
4. **Visuals** — open the existing Video Director and Kumiki-backed visual tools.
5. **Audio** — prepare narration and sound effects in the existing production tools.
6. **Preview & Export** — inspect playback and produce the final artifact in the existing director.

Each stage is navigable. Its status comes from saved project/storyboard or research-job state, not a timer, a guessed completion percentage or a successful page load. Stages without a canonical media artifact remain `Not started`; the new page does not pretend rendering has happened.

## Evidence is not approval

- A search result alone is not a captured citation.
- A valid captured quote links a claim to a particular source snapshot. It **does not verify the factual claim**.
- Imported storyboard claims stay `unverified` until a person reviews them.
- Missing source references, invalid quote/source mappings, and human fact review have separate labels. The claim review panel groups repeated references across beats by unique claim ID.
- Production displays the saved quotation beside the claim and allows a person to explicitly record or undo local review. A receipt is tied to the exact claim wording, cited source IDs, source snapshot hashes and research artifact ID; edited or replaced evidence invalidates that receipt.
- Local review receipts affect the Production step indicator only. They do **not** edit the source material, mark the AI's claim as true, or replace publishing/export approval gates.
- Downstream commercial readiness still requires the existing independent human-review gates.

## Automatic source-link repair

The server runs deterministic evidence-link inspection during a user-started research job. It can relink a claim only when both a source SHA-256 digest and an exact per-claim quotation match a **single** stored capture. Ambiguous, unsupported, or modified material remains flagged for review. The repair result is checkpointed, so a refresh or resume does not discard completed research fragments.

A paused evidence-repair job can be explicitly retried, which re-captures public sources into a new checkpoint revision (up to two manual retries) and preserves older captured material. The click may contact the source websites; opening or refreshing Production never starts a source search or local-model inference.

For an existing storyboard, Production offers **Auto-fix safe source links** when unresolved claims and the matching saved research draft are available. It can restore missing source IDs on exact, unedited claims from the same research artifact, but does not replace nonempty user-edited references or approve factual truth.

## Resume and existing tools

The page reuses the current project catalog, browser-local storyboard, last saved research pointers, durable local research jobs, and existing editor routes. Selected step is a UI preference, not a second copy of the content. Research snapshots are immutable. Changing an upstream research artifact makes derived storyboard/visual/audio/export stages stale when their stored lineage can be compared; prior edits must be preserved.

The Production page is a guided entry point; it does not replace Research, Create, Video Director, or their release gates.

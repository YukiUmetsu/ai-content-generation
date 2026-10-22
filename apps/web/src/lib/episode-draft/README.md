# Episode Draft v1 — shared handoff

This module binds approved creative decisions across Brand & Appearance, Thumbnail Composer, Storyboard Planner and destination-specific compositions. It is **not** another thumbnail/scene/storyboard format.

Each editor owns its document. EpisodeDraft stores only its versioned `{id, revision}` references and editorial alignment IDs; it never copies or reinterprets Kumiki's `StoryboardShot` or `MediaDocument`.

```ts
import { illustrativeHvacEpisode } from "./fixture";
import { choosePackaging, serializeEpisodeDraft, readEpisodeDraft } from "./episode-draft";
const next = choosePackaging(illustrativeHvacEpisode, "concept-breakdown");
if (next) {
  const result = serializeEpisodeDraft(next);
  if (result.ok) {
    const reopened = readEpisodeDraft(result.json);
    // Only use reopened.draft if reopened.ok.
  }
}
```

**Handoff sequence:** resolve a pinned brand revision → choose a title+thumbnail+hook hypothesis → link the storyboard revision and payoff/claim IDs → independently author 16:9/9:16 layouts using actual Kumiki presets → collect sourced evidence and explicit human approvals.

Approval is blocked if the selected packaging or storyboard is missing, the promised payoff has drifted, evidence is unresolved, platform layouts are not independently authored, or editorial/rights/visual reviews are incomplete.

**Important limits:** validation verifies schema, consistency, source references and recorded review decisions, not the underlying factual truth, license authenticity, actual exports, video rendering, or platform compliance. It does not call APIs or persist data.

The HVAC fixture is intentionally synthetic, unverified and unapproved. Do not treat example costs, revisions or review flags as real assets.

Future adapters should resolve these IDs against the actual outputs of the two concurrently implemented editor PRs, and compare revisions optimistically before saving. This contract does not modify either editor, their registry, or the Create workspace.

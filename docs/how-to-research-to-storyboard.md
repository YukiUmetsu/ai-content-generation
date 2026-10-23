# Research → source-linked storyboard in ContentGen Studio

This flow creates an **unapproved, editable video draft** from an original topic. It does not publish, synthesize a voice, approve facts, or claim any YouTube performance outcome.

1. Start the Rust API and `apps/web` Studio as usual. In `apps/web`, run `pnpm research:up` once if local SearXNG is not configured, and select an already-installed local research model in Settings.
2. Open **Video Director**. Enter a topic, viewer question, audience and narration language.
3. Check **Allow public web research** to explicitly permit local SearXNG searches and public HTTPS page capture. Click **Research & generate draft** once.
4. ContentGen captures sources, checks the model's quoted phrases against captured text, builds an unverified research dossier, then uses that dossier to generate a visual/narrative storyboard. Neither action uses Fish Audio, FFmpeg, a commercial SEO provider, or a rendering service.
5. Review source titles, links, IDs, verbatim quote previews per candidate claim, research gaps, proposed scenes, narration, visual changes, and claim IDs. **Quote matches are not fact verification.** Resolve unsupported or disputed claims independently; never infer financial figures or visual measurements from a public video's view count.
6. Click **Open editable storyboard** to enter Video Director's shot editor and silent real-renderer preview. This is a review handoff, not an approval. Saving/exporting the project preserves existing source IDs and draft status.

## Inspect the actual visual explanation

New research-generated teaching sequences specify three concise, visible states for one technical subject: **before** (what is initially shown), **action** (what changes), and **after** (the result the viewer should learn). ContentGen passes these states into the existing generic video renderer. In the silent preview and MP4 scene, the same subject remains identifiable, the mechanism animates toward an initially hidden result, and the payoff becomes visible only after its opening event frame.

- Watch the **problem → mechanism → payoff** scenes at normal speed. Ask whether the result follows visibly from the action; polished motion alone is not evidence that the scene teaches the correct mechanism.
- Compare the visible before/action/after claims with their linked captured sources. A renderer cannot verify that a model invented no conceptual mistakes.
- Check all text at the edges, the first frame of the payoff, and the actual browser-to-FFmpeg MP4. These are **manual sign-off checks**; the fast deterministic tests cover contract shape, timing, state visibility and authored bounds, not visual taste or every font/system combination.
- Existing saved plans without structured states still use their previous generic diagrams. Analogy scenes, custom home-cost scenes, charts and unrelated shots keep their current rendering. The generic state animation is a labeled concept transition, **not** arbitrary 2D/3D illustration or physical simulation.

The structured state labels are currently generated as part of the research-linked plan. Video Director's shot form does not yet expose separate before/action/after inputs; a user changing those semantics must regenerate/revise the plan upstream. Ordinary shot narration and on-screen copy remain editable in the Studio editor.

If the local planning model fails after source capture, the page keeps the research evidence visible. Choose **Retry storyboard generation** to retry planning without another web search. Changing a brief field clears the previous research and storyboard on screen so the old claims cannot silently attach to a new topic.

## Boundaries

- Public YouTube videos accumulated by **YouTube Intelligence** may suggest an angle or hook; they must not be treated as proof for claims or copied as a script.
- The review quote previews are transient UI context derived from exact captured passages, not a durable, full-text snapshot viewer. The research dossier retains source IDs, URLs, capture hashes and locators; the existing preproduction bundle retains claim IDs.
- External page capture requires explicit consent each time. The installed LLM handles evidence and story generation locally.
- An unreviewed draft stays `draft-needs-review`. The existing render preflight and separate voice/rights consent gates still apply before any MP4 can be made.

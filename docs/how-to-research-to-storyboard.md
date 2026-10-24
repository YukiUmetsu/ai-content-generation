# Research → source-linked storyboard in ContentGen Studio

This flow creates an **unapproved, editable video draft** from an original topic. It does not publish, synthesize a voice, approve facts, or claim any YouTube performance outcome.

## Research tab: search, save, then generate

1. Enter a research topic and (optionally) adjust the audience and viewer question in the **Research** tab.
2. Click **Search & save sources** to ask local SearXNG for public-source leads and save the result list immediately. **This does not require or invoke a local AI model.** You can open each result, see its title, URL and available search excerpt, and inspect the search time. Results are *discovery leads*, not verified citations or fetched pages.
3. Open **Saved searches** to restore a previous query and its links after refreshing the page. Each immutable bounded search snapshot is stored under local `data/studio-research`, separate from the Evidence Library's full-text SQLite index.
4. Click **Research & generate storyboard** to capture selected pages, ask the local research model to select **server-generated exact source passage IDs** for its claims, and generate the story plan. The model no longer needs to type quotations. The server resolves exact quote text from captured pages, excludes claims without valid references, and reports omissions as research gaps. If **all** local-model references are unusable, the research stage can fall back to short, topic-relevant sentences copied verbatim from the actual captured pages. It explicitly labels these as fallback excerpts requiring review; it never reuses an unsupported model-written claim. If the captured pages offer no relevant excerpts, the stage still fails closed. If you skipped step 2, this action searches and saves first before starting the models.
5. If the local model times out or story planning fails, **the saved search survives**. The error identifies **Research AI** versus **Storyboard planning AI** and suggests switching to a smaller/faster installed model in Settings → Local AI. Retry to reuse the source links without another SearXNG request; **page capture and local AI inference still run again**. The research prompt is capped at 4,000 captured characters per source; source captures remain intact for provenance. Saved-search generation works if SearXNG later goes offline. Editing the topic/audience/question invalidates the selected search for the new brief, but does not delete it.
6. Only successfully captured, exact-quote-backed, still-unverified claims or verbatim fallback excerpts can enter a generated research dossier and editable storyboard. The Studio validates claim-to-source quote previews from the research result before generating a plan. Do not treat SearXNG snippets or topic-matched excerpts as fact verification; review the surrounding source context before publishing.

1. Start the Rust API and `apps/web` Studio as usual. In `apps/web`, run `pnpm research:up` once if local SearXNG is not configured, and select an already-installed local research model in Settings.
2. Open **Video Director**. Enter a topic, viewer question, audience and narration language.
3. Check **Allow public web research** to explicitly permit local SearXNG searches and public HTTPS page capture. Click **Research & generate draft** once.
4. ContentGen captures sources, checks the model's quoted phrases against captured text, builds an unverified research dossier, then uses that dossier to generate a visual/narrative storyboard. Neither action uses Fish Audio, FFmpeg, a commercial SEO provider, or a rendering service.
5. Review source titles, links, IDs, verbatim quote previews per candidate claim, research gaps, proposed scenes, narration, visual changes, and claim IDs. **Quote matches are not fact verification.** Resolve unsupported or disputed claims independently; never infer financial figures or visual measurements from a public video's view count.
6. From **Video Director**, click **Open editable storyboard** to enter its shot editor and silent real-renderer preview. This is a review handoff, not an approval. Saving/exporting the project preserves existing source IDs and draft status.

The **Research → Evidence → Create editable sourced storyboard** action uses a separate browser-local **Storyboard Planner**. Its preview is a **static planning sketch**, not the Video Director/Kumiki video renderer or an MP4. It now carries research-generated before/action/after labels as editable fields, depicts the current teaching phase without prematurely revealing the after-state, and never reuses the unrelated sample HVAC dollar amounts. Saving, reopening, importing and exporting a storyboard preserve those labels. The two editors do **not** yet share a live media-export adapter.

## Inspect the actual visual explanation

New research-generated teaching sequences specify three concise, visible states for one technical subject: **before** (what is initially shown), **action** (what changes), and **after** (the result the viewer should learn). ContentGen passes these states into the existing generic video renderer. In the silent preview and MP4 scene, the same subject remains identifiable, the mechanism animates toward an initially hidden result, and the payoff becomes visible only after its opening event frame.

- Watch the **problem → mechanism → payoff** scenes at normal speed. Ask whether the result follows visibly from the action; polished motion alone is not evidence that the scene teaches the correct mechanism.
- Compare the visible before/action/after claims with their linked captured sources. A renderer cannot verify that a model invented no conceptual mistakes.
- Check all text at the edges, the first frame of the payoff, and the actual browser-to-FFmpeg MP4. These are **manual sign-off checks**; the fast deterministic tests cover contract shape, timing, state visibility and authored bounds, not visual taste or every font/system combination.
- Existing saved plans without structured states still use their previous generic diagrams. Analogy scenes, custom home-cost scenes, charts and unrelated shots keep their current rendering. The generic state animation is a labeled concept transition, **not** arbitrary 2D/3D illustration or physical simulation.

The structured state labels are generated as part of the research-linked plan. The Research-tab Storyboard Planner exposes separate before/action/after editing fields; Video Director's production shot form does not yet expose them individually. Ordinary shot narration and on-screen copy remain editable. Research-tab static previews do not establish that the associated scene has been exported as a video.

If the local planning model fails after source capture, the page keeps the **saved search links** visible, not an incomplete captured dossier. Choose **Retry storyboard generation** to avoid another web search. It still re-captures pages and re-runs the local research model before planning; intermediate research is not currently persisted separately. Changing a brief field clears the previous research and storyboard on screen so old claims cannot silently attach to a new topic.

## Boundaries

- Public YouTube videos accumulated by **YouTube Intelligence** may suggest an angle or hook; they must not be treated as proof for claims or copied as a script.
- The review quote previews are transient UI context derived from exact captured passages, not a durable, full-text snapshot viewer. The research dossier retains source IDs, URLs, capture hashes and locators; the existing preproduction bundle retains claim IDs.
- External page capture requires explicit consent each time. The installed LLM handles evidence and story generation locally.
- An unreviewed draft stays `draft-needs-review`. The existing render preflight and separate voice/rights consent gates still apply before any MP4 can be made.


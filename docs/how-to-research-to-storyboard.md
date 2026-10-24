# Research → source-linked storyboard in ContentGen Studio

This flow creates an **unapproved, editable video draft** from an original topic. It does not publish, synthesize a voice, approve facts, or claim any YouTube performance outcome.

## Research tab: search, save, then generate

1. Enter a research topic and (optionally) adjust the audience and viewer question in the **Research** tab.
2. Click **Search & save sources** to ask local SearXNG for public-source leads and save the result list immediately. **This does not require or invoke a local AI model.** You can open each result, see its title, URL and available search excerpt, and inspect the search time. Results are *discovery leads*, not verified citations or fetched pages.
3. Open **Saved searches** to restore a previous query and its links after refreshing the page. Each immutable bounded search snapshot is stored under local `data/studio-research`, separate from the Evidence Library's full-text SQLite index.
4. Click **Generate storyboard from saved sources** to create a durable background job. The server captures pages once, selects exact, topic-relevant source excerpts **without local AI**, then makes separate bounded local AI calls for the narrative outline and for each three-phase teaching unit. A quoted excerpt is *unverified* source data, not a proven factual claim. If you skipped step 2, ContentGen searches and saves before starting the background job.
5. The Research panel shows **job stage** and **saved teaching units**. A timeout, malformed model response, browser refresh or server restart keeps completed source captures, evidence, outline and teaching units. A failure stops only the affected job stage. Click **Resume saved job**, or **Regenerate failed scene only** to replace one scene and reassemble the plan. Jobs running during a server restart become paused and wait for an explicit Resume action. Saved searches work if SearXNG later goes offline.
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

If the local planning model fails after source capture, the job retains each successful intermediate artifact. The retry resumes at the incomplete stage; changing the Story model invalidates dependent outline/scene generation but preserves source captures and deterministic evidence. Changing a brief field clears the current job from the visible editor; its original immutable job remains local and can be restored for the matching topic.

### Optional local-only fallback model

By default, the job uses the model assigned to **Story** in Settings → Local AI. To opt in to automatic failover, select an installed **secondary local model profile** in the same settings, note its profile ID, and set `CONTENTGEN_STORY_FALLBACK_PROFILE_ID` to that ID before starting the Studio server. This must be a previously configured loopback model profile; the job does not select a cloud service or download models. Temporary local transport errors and timeouts have at most one same-model retry. After the bounded attempts, an explicitly configured fallback may take over. The job pauses with a safe error code if neither model succeeds. The legacy synchronous `/research-draft` API remains for older integrations, but the Research tab now creates `/research-jobs` and polls progress.

## Boundaries

- Public YouTube videos accumulated by **YouTube Intelligence** may suggest an angle or hook; they must not be treated as proof for claims or copied as a script.
- The review quote previews are transient UI context derived from exact captured passages, not a durable, full-text snapshot viewer. The research dossier retains source IDs, URLs, capture hashes and locators; the existing preproduction bundle retains claim IDs.
- External page capture requires explicit consent each time. The installed LLM handles evidence and story generation locally.
- An unreviewed draft stays `draft-needs-review`. The existing render preflight and separate voice/rights consent gates still apply before any MP4 can be made.


# Guided Production workspace

Production is the project-scoped entry point for making content. The persistent navigator exposes eight stages:

1. **Setup** — choose the project/brand and destinations.
2. **Discover** — start or reopen a durable discovery session.
3. **Select Idea** — compare preserved observations and prepare a production brief.
4. **Script** — collect missing factual sources, generate sections with the configured local script model, review/edit/regenerate and approve each destination's draft.
5. **Plan Scenes** — turn the approved script into editable scene cards, check the flow and move forward with one clear action. Previous edits are backed up when the script changes.
6. **Create Video** — three tasks open the existing YouTube Director in visuals, audio or preview/export mode. Other formats are directed to the publishing kit with limitations explained.
7. **Publish Kit** — prepare editable title/caption metadata, local graphic covers, illustrations and article exports by destination.
8. **Export** — download actual local render files and metadata manifests.

## Script generation and source recovery

A measured public video is evidence of an observation, not a factual source for narration. An idea can therefore be selectable while still lacking captured passages. **Collect sources and draft script** explicitly invokes `POST /api/contentgen-director/production-evidence/{productionId}`. The local adapter reads the canonical production and selected idea from Rust, attempts their public HTTPS source leads, and falls back to the existing local SearXNG search if necessary. It reuses bounded public-page capture and deterministic verbatim excerpt extraction; no model is needed to collect evidence.

Successful captures are content-addressed in `data/production-evidence`, with an atomically replaced production pointer. Raw capture text stays on the server; the editor receives source records, excerpts and unverified claims. Reloading restores that evidence through GET without repeating public requests. Failure or cancellation preserves the previous snapshot. Collection never rewrites the immutable discovery result or automatically verifies facts.

The Script editor generates missing YouTube sections sequentially through the existing `/script-generate` API. Other platform tabs (Shorts, TikTok, Instagram, Facebook, Blog and Website) show **Generate full [platform] script**, which writes all missing sections only when explicitly requested; a partially saved draft shows **Generate remaining [platform] sections**. Each platform has an independent saved draft, so generating a blog does not overwrite reviewed YouTube text. Regeneration uses `/script-regenerate-section`; proposals require explicit acceptance. Both select the script task's configured local model. The shared local-inference gate prevents simultaneous heavy inference. Clearly pre-connect local-model failures receive one bounded retry; dropped responses are not replayed because a model may still be computing. Both failure cases return a setup diagnostic pointing to Settings → Local AI; accepted sections are preserved. Disconnecting or stopping an editor request aborts its model request. **Stop writing** pauses generation; **Continue writing missing sections** resumes from accepted, browser-saved sections. This remains an editor request workflow, not a newly introduced durable job runner. Closing the editor preserves completed sections but stops its active request.

For completed Shorts, TikTok, Instagram or Facebook scripts, **Copy to other platforms** offers the other selected short-form outputs. Empty destinations are selected by default; existing edited or approved versions are not selected and need an explicit replacement confirmation. The action copies all accepted narration sections (including user-inserted sections) and their claim/source links locally without calling a model; pending suggestions and approval do not transfer. Previous destination revisions are retained with copy provenance; **Revision history** inside each section lets an author preview and restore an earlier version as a fresh accepted revision. Destinations changed in another browser tab after opening the picker are rejected rather than silently overwritten. If occupied source and destination section structures differ, copying is rejected to avoid discarding unmatched edits. Each destination must be adapted and reviewed before its own approval. Unreadable saved destinations are never overwritten. Longer YouTube videos, blogs and website copy are intentionally excluded from short-form copying.

Script response parsing projects only `narration`, `claimRefs` and `sourceRefs`: harmless echoed metadata is discarded, and a JSON code fence surrounding the entire answer is accepted. Format failures receive one corrective retry with a field-specific contract hint instead of replaying the same prompt. Missing assistant answers and token-truncated output are distinguished from invalid fields; reasoning content is never used as narration. The server logs `[contentgen-script-format]` with the section, attempt, fixed failure codes and structural field types/counts only, without prompts, citations, unknown field names or generated prose. HTTP, cancellation and grounding failures do not trigger format repair.

Each section request now carries the complete ordered script outline (1–20 sections) and existing section text (up to 6,500 characters per section), with explicit non-overlapping narrative roles and transition instructions. Full regeneration feeds earlier proposed rewrites into later requests, preserving accepted text until review, and stops if a section fails. A response based on text edited while inference was running is discarded. Regeneration also avoids a bounded list of the last two discarded or currently pending candidates, including the suggestion being replaced during repeated full regeneration. Discard history resets when the editor is closed.

Normalized identical text and conservative whole-passage near-copies trigger one continuity-specific repair instead of becoming an accepted section or suggestion. The guard supports text without spaces, including Japanese. This detects obvious copying, not semantic equivalence or overall writing quality; distinct prose and brief callbacks still require editorial review. Thinking settings are unchanged by this continuity fix.

Scripts must contain known linked claim/source references before accepting model output. Long project notes and production directions use compatible frontend/backend limits. A script approval creates an editable outline; it does not approve publication. The same captured quotations are available for explicit, reversible Storyboard claim-review receipts, even when no legacy research plan exists.

## Add sections and import a complete script

Each script section has **Add before** and **Add after** controls. Supply a heading, role and purpose, then paste narration or leave it blank to write/generate later. Choose **Promotion / call to action** to append a FileQuell message after the main answer. Product features still need captured evidence; adding a product name does not supply facts. Existing section IDs and accepted revision histories stay intact. Structural edits reset approval and clear pending AI suggestions. Opening manual editing, insertion or import pauses and cancels active AI writing; use the missing-section writing controls to resume.

**Import full script** accepts pasted text or a `.txt`/`.json` file. Preview the ordered narration, then choose **Replace current script**. Preview and cancel do not modify saved text. Replacement affects only the selected platform and saves one recovery copy, including its accepted history. **Restore previous script** swaps back the previous copy as a draft requiring renewed review. A failed save keeps the active script and restores the prior recovery copy. These copies remain in this browser's local storage.

Numbered text uses consecutive markers starting at `[1]`, each at the start of a line. Narration can begin beside the marker or on the following line; paragraph breaks remain intact:

```text
[1] Opening narration goes here.
More narration for the same section.

[2]
The next section goes here.
```

JSON accepts a top-level array or `{"sections":[...]}`. Each section requires `text` (or `narration`); optional fields are `heading`, `purpose`, `role`, `claimRefs` and `sourceRefs`. Omitted headings become “Section N”; omitted roles become `custom`. Available roles: `hook`, `context`, `mechanism`, `practical`, `closing`, `custom`, `promotion`. Example:

```json
{
  "sections": [
    {"heading": "Opening", "role": "hook", "text": "Your opening narration."},
    {"heading": "The workflow", "text": "Your explanation."},
    {"heading": "FileQuell", "role": "promotion", "text": "Your reviewed product message and call to action."}
  ]
}
```

Imports support 1–20 nonempty sections, at most 6,500 characters per section and 512 KB per input. Duplicate/skipped numbers, unsupported fields, empty narration and unknown or mismatched citation IDs are rejected. Ownership, approval and other production metadata cannot be imported. Edit a section to select supporting captured evidence. Imported narration is manual text: it is not rewritten by AI, and uncited passages remain unverified in Storyboard and Director.

Director still requires real captured research context and 3–40 renderable shots. One- or two-section outlines are divided at speech boundaries into at least three shots before the main answer, preserving the narration. Insufficient narration receives an actionable error; no filler is generated. Explicit summary postscripts may follow the actual answer and its teaching payoff. Research context alone never becomes a citation for uncited narration, and draft authoring does not clear publication review.

Blog output defaults to five source-linked sections with a longer editorial-writing target (about 2,500–3,000 useful English words in total when the evidence supports it). The model is instructed to write less if sources are insufficient, rather than adding filler or invented facts. The editor shows word count and approximate reading time.

## Render identity and supported outputs

The current script-to-Director path renders landscape YouTube video. Dedicated portrait video exporters remain unavailable. Other selected destinations now receive actual locally downloadable Kumiki-designed PNG cover images and metadata; blogs receive illustrated HTML and Markdown/article images. These graphics depict approved script wording and section order, not invented photographic scenes, measurements or externally sourced artwork. Cited source links are included in the exported blog for verification, and publication remains manual.

The static-image producer uses the pinned Kumiki infographic layout/PNG export contract, so preview and download come from one deterministic visual model. The source revision is pinned and hashed; it is updated deliberately after local review, never fetched afresh during a video render. Real render assets take priority over generated covers. Deliberately cleared media choices stay cleared.

The render index records the imported script/outline revision alongside each production's MP4 and captions. Produce and Export completion are derived from a real MP4 matching that revision. Older/untracked files remain downloadable with a revision label, and are excluded from automatically prepared current-output asset choices. A readiness check, a page visit, or an approved script is never a completed render.

Project colors apply to metadata and generated static covers; Director retains its built-in video palette. Imported footage, images and models can be approved/downloaded and saved as scene references; the generic renderer does not yet composite them. The asset action is named **Save as scene reference** so it does not promise placement in the MP4.

## Evidence is not approval

- A search result alone is not a captured citation.
- A valid captured quote links a claim to a particular source snapshot. It **does not verify the factual claim**. Quotes are shown only when the storyboard is bound to that exact saved research artifact (legacy boards may use a matching immutable snapshot ID).
- Imported storyboard claims stay `unverified` until a person reviews them.
- Missing source references, invalid quote/source mappings, and human fact review have separate labels. The claim review panel groups repeated references across beats by unique claim ID.
- Production displays the saved quotation beside the claim and allows a person to explicitly record or undo local review. A receipt is tied to the exact claim wording, cited source IDs, source snapshot hashes and research artifact ID; edited or replaced evidence invalidates that receipt.
- Local review receipts affect the Production step indicator only. They do **not** edit the source material, mark the AI's claim as true, or replace publishing/export approval gates.
- Downstream commercial readiness still requires the existing independent human-review gates.

## Automatic source-link repair

The server runs deterministic evidence-link inspection during a user-started research job. It can relink a claim only when both a source SHA-256 digest and an exact per-claim quotation match a **single** stored capture. Ambiguous, unsupported, or modified material remains flagged for review. The repair result is checkpointed, so a refresh or resume does not discard completed research fragments.

A paused evidence-repair job can be explicitly retried, which re-captures public sources into a new checkpoint revision (up to two manual retries) and preserves older captured material. The click may contact the source websites; opening or refreshing Production never starts a source search or local-model inference.

For an existing storyboard, Production offers **Auto-fix safe source links** when unresolved claims and the matching saved research draft are available. It can restore missing source IDs on exact, unedited claims from the same research artifact, but does not replace nonempty user-edited references or approve factual truth.

## Saved research into Video Director

From **Visuals**, **Audio**, or **Preview & Export**, Production sends the selected project's matching immutable research artifact ID to Video Director. A same-origin, user-triggered `POST /api/contentgen-director/compile-saved-research` loads the snapshot on the local server, checks dossier/plan lineage and compiles the ordinary fingerprinted preproduction bundle. It never calls a model, searches the web, or changes the stored research. The destination opens actual rendered visuals, voice settings or render controls respectively; a preview/plan failure is shown honestly.

If a storyboard has no matching stored research, Production opens manual Video Director setup rather than selecting another project's snapshot. For a matching saved storyboard, the compiler transfers **edited narration, on-screen text, and visual objectives** to a new, fingerprinted draft; the original research and plan remain unchanged. The storyboard must match the selected project, immutable research and original shot order. Claim-reference changes are rejected. When the combined visual objective contains semicolons, the bridge preserves the original shot/motion boundary if it can identify it; ambiguous multi-part edits are rejected so wording is not reassigned between fields. Camera, timing, semantic-mechanic and other storyboard-only changes are flagged for manual review and are **not silently treated as rendered media**. A changed source remains subject to evidence review; compilation never approves claims or rights.

Video Director saves **applied shot edits** for the same project, research artifact, source fingerprint and storyboard revision in this browser tab's session storage, so switching between guided stages can resume those edits without changing the immutable snapshot. Unapplied form edits, manually imported projects and voice credentials are not auto-saved; use **Save project** to download durable editable JSON before closing the tab. **Start another project** discards that tab's saved session for the selected source. The generated preview is not itself a saved MP4, and a readiness check is not rendered audio. Production stage indicators only advance when the saved render index contains an actual MP4 with matching script/outline lineage; legacy artifacts without lineage remain untracked. Do not infer completion from a button click, a plan or a source snapshot.

## Resume and existing tools

The page reuses the current project catalog, browser-local storyboard, last saved research pointers, durable local research jobs, and existing editor routes. Selected step is a UI preference, not a second copy of the content. Research snapshots are immutable. Changing an upstream research artifact makes derived storyboard/visual/audio/export stages stale when their stored lineage can be compared; prior edits must be preserved.

The Production page is a guided entry point; it does not replace Research, Create, Video Director, or their release gates.

## Local verification gate (without GitHub Actions)

From the repository root, run these checks after installing the existing dependencies:

```sh
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run lint
pnpm --dir apps/web run test
pnpm --dir apps/web run test:video:headless
pnpm --dir apps/web run build
```

The headless-video command includes source-link repair, storyboard synchronization, the saved-research API, and the Director production/readiness route tests. These checks are local and do not request a GitHub Actions runner.

Then use a project with a saved captured-research artifact to open **Production → Plan Scenes → Create Video → Publish Kit**. Check scenes and output, download a generated PNG for each destination, open the blog HTML offline and inspect its diagrams and cited sources. Confirm Director output, rights and disclosure requirements manually; a saved plan or passing test is not a completed media artifact.

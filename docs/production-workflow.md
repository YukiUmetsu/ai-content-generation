# Guided Production workspace

Production is the project-scoped entry point for making content. The persistent navigator exposes eight stages:

1. **Setup** — choose the project/brand and destinations.
2. **Discover** — start or reopen a durable discovery session.
3. **Select Idea** — compare preserved observations and prepare a production brief.
4. **Script** — collect missing factual sources, generate sections with the configured local script model, review/edit/regenerate and approve each destination's draft.
5. **Storyboard** — map the approved primary script into an editable outline and review its captured quotations.
6. **Produce** — transfer the approved YouTube script, citations and outline to Director for visual editing, narration and sound.
7. **Optimize** — prepare and review destination-specific metadata and file selections.
8. **Export** — download actual local render files and metadata manifests.

## Script generation and source recovery

A measured public video is evidence of an observation, not a factual source for narration. An idea can therefore be selectable while still lacking captured passages. **Collect sources and draft script** explicitly invokes `POST /api/contentgen-director/production-evidence/{productionId}`. The local adapter reads the canonical production and selected idea from Rust, attempts their public HTTPS source leads, and falls back to the existing local SearXNG search if necessary. It reuses bounded public-page capture and deterministic verbatim excerpt extraction; no model is needed to collect evidence.

Successful captures are content-addressed in `data/production-evidence`, with an atomically replaced production pointer. Raw capture text stays on the server; the editor receives source records, excerpts and unverified claims. Reloading restores that evidence through GET without repeating public requests. Failure or cancellation preserves the previous snapshot. Collection never rewrites the immutable discovery result or automatically verifies facts.

The Script editor generates missing sections sequentially through the existing `/script-generate` API. Regeneration uses `/script-regenerate-section`; proposals require explicit acceptance. Both select the script task's configured local model. The shared local-inference gate prevents simultaneous heavy inference. Disconnecting or stopping an editor request aborts its model request. **Stop writing** pauses automatic section generation; **Continue writing missing sections** resumes from accepted, browser-saved sections. This remains an editor request workflow, not a newly introduced durable job runner. Closing the editor preserves completed sections but stops its active request.

Script response parsing projects only `narration`, `claimRefs` and `sourceRefs`: harmless echoed metadata is discarded, and a JSON code fence surrounding the entire answer is accepted. Format failures receive one corrective retry with a field-specific contract hint instead of replaying the same prompt. Missing assistant answers and token-truncated output are distinguished from invalid fields; reasoning content is never used as narration. The server logs `[contentgen-script-format]` with the section, attempt, fixed failure codes and structural field types/counts only, without prompts, citations, unknown field names or generated prose. HTTP, cancellation and grounding failures do not trigger format repair.

Scripts must contain known linked claim/source references before accepting model output. Long project notes and production directions use compatible frontend/backend limits. A script approval creates an editable outline; it does not approve publication. The same captured quotations are available for explicit, reversible Storyboard claim-review receipts, even when no legacy research plan exists.

## Render identity and supported outputs

The current script-to-Director path renders landscape YouTube video. Other selected destinations support separate script drafts and metadata preparation; their dedicated portrait/article exporters remain unavailable. Disabled video actions show the required YouTube script/storyboard prerequisites.

The render index records the imported script/outline revision alongside each production's MP4 and captions. Produce and Export completion are derived from a real MP4 matching that revision. Older/untracked files remain downloadable with a revision label, and are excluded from automatically prepared current-output asset choices. A readiness check, a page visit, or an approved script is never a completed render.

Project colors currently apply to metadata and thumbnail previews; Director retains its built-in video palette. Imported footage, images and models can be approved/downloaded and saved as scene references; the generic renderer does not yet composite them. The asset action is named **Save as scene reference** so it does not promise placement in the MP4.

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

Then use a project with a saved captured-research artifact to open **Production → Storyboard → Video Director**. Edit a shot's narration, screen copy, and visual action; confirm all three are present in Director, the source claim references remain unchanged, unsupported camera/semantic/timing edits show explicit review warnings, and a source mismatch cannot reuse an older Director session. Preview and export require actual visual/audio inspection and rights approval. A saved plan or test result is not a completed media artifact.

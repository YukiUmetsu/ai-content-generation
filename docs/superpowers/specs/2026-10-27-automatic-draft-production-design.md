# Automatic-draft Production Design

**Approved direction:** one explicit **Generate draft video** action after script approval; automatic planning, preflight, and rendering once voice/rights requirements are satisfied. No automatic publication.

## Intent

ContentGen currently makes the user discover three different editing shells, manually navigate preflight, and search for a separate fixture-based thumbnail composer. Production should explain the next action in a glance and never leave a control apparently inert or silently disabled.

## Approach

Use the pinned Kumiki `Stepper` for existing eight-stage Production navigation, preserve all completed/upstream revisions, and enter the actual rendered Video Director preview when the user requests visuals. Sound opens the voice-generation surface rather than the SFX catalog. One named action runs a checked, local-first draft pipeline; missing prerequisites are shown in the same panel with a useful path to correction. Completed MP4s remain drafts pending review.

Publishing artwork is editable **within Publish Kit**, independently of upload metadata. Produce genuinely distinct, deterministic, brand-aware compositions without inventing assets or virality measures. Keep the currently standalone Thumbnail Composer for unrelated design experiments; do not silently replace the current production's asset ID. Bring the existing Character ZIP rig-calibration editor forward as a first-class navigation target without implying it can already publish or perform lip sync.

## Boundaries

- Rust/Axum owns durable job and content records; existing JS renderer remains the adapter until a separate worker migration qualifies crash-recovery and retries. A browser-visible render status is **not** claimed to be a durable DAG job.
- Fish Audio transmissions require explicit per-session voice and text consent. Do not store credentials in localStorage or automatically call a paid/remote provider on script approval.
- Preserve the source-pinned storyboard, edits, approved scripts, BrandKit palette, SFX selections and old renders when generation fails or is cancelled.
- Automatic work starts only after an explicit user action and valid voice settings; interactive playback, factual checks, licensing, upload and release remain manual.
- The one-click action is enabled even before setup, and preflight errors are actionable rather than disabling the button without explanation.

## Considered alternatives

1. **Automatic draft (selected):** one action performs planning/preflight/render; afterward the user can edit any part. Low repetitive effort, with explicit consent gates.
2. **Guided manual stages:** step through every producer panel and click Check then Start. More control but repeats the currently confusing path.
3. **Immediate render on approval:** faster but can transmit script text or use paid TTS before voice authorization, so rejected.

## Acceptance

The stepper navigates all eight stages including stale/failure states and keyboard focus. Visual and audio shortcuts open correct controls with compiled approved script. Automatic draft runs preflight and start exactly once per click, preserves state under recoverable failures, reports cancellation/progress, and never publishes. A production's thumbnail controls offer different editable layouts and download the selected current revision. Character Studio is findable as a first-class entry, still accurately marked as an unapproved rig draft. Local typecheck/lint/tests/build and representative UI states are reviewed.

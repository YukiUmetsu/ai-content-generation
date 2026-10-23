# Niche-to-storyboard implementation plan

**Goal:** a genuinely usable, locally persisted creative brief with hook alternatives and an editable Storyboard handoff.

**Architecture:** pure browser-side schema/strategy/storyboard functions; YouTube Intelligence UI; existing local director Vite middleware for opt-in local AI; Shell transaction for new local project.

**Tasks (TDD):**

1. Add pure editorial brief, editable patterns, bounded persistence and storyboard adapter. Test generation differences, validation/provenance, storyboard diagnostics and storage roundtrips.
2. Add local-model `/brief-variants` handler using configurable hooks prompt. Test request excludes API metadata and invalid model responses are rejected without mutating drafts.
3. Add visible brief form, pattern editor, manual/AI controls, reference-only link and Create Storyboard button in YouTube Intelligence. Test the full flow without observed videos and from video reference.
4. Wire Shell → new project + storyboard with failure-safe storage, switch to Create / Storyboard; test project isolation.
5. Verify tests/typecheck/build/lint, inspect diffs, create a single PR with manual checklist and API-policy caveat.

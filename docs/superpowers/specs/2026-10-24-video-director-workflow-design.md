# Video Director Guided Workflow — Design

## Intent

Video Director already has useful scene editing, visual previews, asset search, Sound Studio and protected MP4 export, but stacks them in the wrong order and makes users scroll through several disconnected tools. Turn it into a comprehensible four-stage production workspace without inventing a new rendering system.

## Chosen approach

1. **Recommended: one guided four-stage workspace.** Storyboard → Visual assets → Sound → Preview & Export. Reuse the existing editors; only the relevant workspace occupies the main area. The stage navigator and project identity remain visible.
2. Keep the long all-in-one page. Least code but preserves discoverability and navigation problems.
3. Separate routes and persistent drafts for every stage. More scalable later, but adds routing/persistence contracts before the existing workflow has been validated.

The user asked to proceed with the recommended next-step UI improvement; choice 1 uses the previous proposal and minimizes backend risk.

## Experience

- On project load, show the project name, scene count, a save action and a clearly ordered four-stage navigator. For the interactive sample, open Preview & Export immediately to preserve the sample's animation-first welcome.
- **Storyboard:** Select a scene, edit its narration/visual explanation, save, and optionally generate creative alternatives. Keep regeneration impact visible only after edits. Use clear labels without exposing implementation artifacts.
- **Visual assets:** Show the existing reviewed asset discovery workspace and its own relevant controls.
- **Sound:** Show the Sound Studio and its scene strip, approved library and local audition player.
- **Preview & Export:** Keep the existing real-visual preview, settings, Check, Start, cancel, status, and MP4 inspection in a single persistent ProductionPanel instance. This avoids resetting render settings/readiness when changing stages.
- Returning to Preview & Export conservatively revokes an old *UI readiness approval*, but retains voice settings, preview and any running/completed render; the next Start requires a fresh Check.
- Every stage has an obvious next action; the stage navigator always allows moving backward or jumping forward when there are no unsaved edits.
- An edited but unsaved scene must not be silently discarded by switching stages or changing scenes. Block navigation and explain how to save or discard. A discard control restores the current saved scene draft; selecting a new scene then works.
- Keep all local-only/rights/preflight safeguards. Changing a bundle or sound selection still invalidates readiness via the existing production pipeline; do not create shortcuts to export.

## Constraints and non-goals

- No new cloud calls, browser automation, voice jobs or renderer changes.
- Do not run GitHub Actions; the user has reached the credit limit.
- Preserve existing import/export JSON paths, revision semantics, sample auto-open, selected-shot API and component identities.
- Do not treat an editorial preview as a verified production render.
- No new generic site navigation or Studio-wide redesign in this pass.

## Accessibility and QA

- Stage controls are actual buttons with names, active state, keyboard focus and visible focus rings; hiding inactive panels cannot disable the active editor.
- Node-test the routing/unsaved guard as pure logic, and add React integration coverage for imported project, guarded edits, stage jumps and sample preview.
- Visually inspect at normal browser width and narrow viewport when the full frontend environment is available. Frontend tests cannot be claimed as passing from a sparse checkout lacking React/Vitest.

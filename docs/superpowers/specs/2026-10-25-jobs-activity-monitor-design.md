# Jobs & QA activity monitor — design

## Intent

Operators should understand what ContentGen is doing now, identify work that needs attention, and inspect any run with one selection. The current Jobs page separates discovery searches from DAG work and makes discovery entries non-interactive. Its large blank detail panel and repeated explanatory content waste space.

## Chosen approach and alternatives

- **Chosen: activity-first list + detail panel.** A unified, status-prioritized list combines discovery runs with pipeline jobs, and a selected item reveals contextual details. Works for a few jobs and for an active queue without verbose cards.
- **Alternative: full-width operations table.** Excellent at very high volumes but excessive for the current studio and narrow layouts.
- **Alternative: chronological activity feed.** Attractive for auditing history, but less efficient when monitoring and comparing concurrent work.

## Behavior and quality bar

- Put running/queued work first, then attention-needed, then recent finished work; do not hide known active work if one backend fails.
- One compact heading, refresh control, search, and status filters. Minimize banner copy and unnecessary scrolling.
- Discovery and DAG jobs are independently selectable, keyboard accessible, and share consistent badges/metadata.
- Default to the most relevant available job on desktop; selection persists across refreshes. On phones, open details after a deliberate tap and provide Back to jobs.
- A discovery detail reports only *real* fields: session, project, current stage/status, saved ideas, timestamps, provider health and errors when present. Do not invent stage history, progress percentages, or success metrics.
- DAG details preserve cancellation confirmation, real progress counts, ordered steps, retry/error explanations and automatic polling.
- Live refresh does not clear the list or reset scroll/focus. Partial failures remain visible, with actionable retry. Maintain English/Japanese labels, reduced-motion behavior, and responsive widths.
- Reuse existing semantic tokens/components. No dependencies, new backend routes, schema changes or provider calls.

## Acceptance

Tests cover discovery selection, unified active/attention filtering, persisted selection during polling, mixed backend partial failure, DAG details/cancellation, empty and mobile-navigation states. Run frontend typecheck, lint, tests and build locally; visually inspect narrow/wide layouts where tooling permits.

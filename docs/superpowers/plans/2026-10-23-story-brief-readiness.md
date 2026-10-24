# Implementation plan

1. Add a read-only readiness inspector with injected local probes. Test absent config, healthy config, search unreachable, missing model, unsupported `/models` and de-duplicated endpoint checks. Run `node --test apps/web/scripts/research-readiness.test.mjs`.
2. Expose `GET /api/local-research-model/readiness` from the existing loopback-only Vite plugin, invoking the inspector, configured SearXNG root probe and local profile model-list probe. Test same-origin policy and response shape.
3. Redesign `ResearchWorkspace` Story Brief using shared ContentGen/Kumiki-derived design tokens: selectable approach cards, collapsible extra fields, a dominant CTA, and an early readiness panel. Maintain existing research/evidence data flow.
4. Test mount-time status, disabled source-backed action with unavailable services, successful action, manual recheck, and preserved outline creation and editorial draft controls. Run web typecheck/build and appropriate tests where dependencies are available.
5. Review changes for accidental external queries, stale state, accessibility, responsive spacing and accuracy of status copy. Publish one PR; report CI billing restrictions separately from actual code failures.

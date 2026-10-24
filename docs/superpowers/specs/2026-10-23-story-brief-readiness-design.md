# Studio Research story brief and readiness

## User problem

The Story Brief looks like a dense settings form. SearXNG failures are only discovered after a potentially lengthy research request. Users need a focused editorial entry point and immediate, truthful local-service feedback.

## Approved experience

- Keep the Research / Evidence Library / Packaging / YouTube tabs and project-topic handoff.
- Show a compact local-readiness status on initial page load, above the research topic input. Search, research model and story model each have distinct states, a manual recheck, and concise setup guidance.
- A readiness check is strictly read-only: call the local SearXNG root and each unique assigned local model's `/models` route. Never run an engine query, model inference, Docker startup or paid API as part of the check.
- Do not claim that successful root response guarantees JSON search. Keep `research:check` as the explicit end-to-end test.
- Missing search configuration, unavailable search, missing model selection, and a model explicitly absent from a successful model listing block source-backed generation. If a model server cannot enumerate models, mark it unverified and warn without incorrectly concluding that generation is impossible.
- Render Story Brief as a three-choice editorial direction selector, with optional audience/question/payoff behind a disclosure. Give source-backed generation a primary CTA; make unresearched outline a quiet secondary action.
- Preserve existing stored research restoration, explicit public search permissions, source-review requirements, inspiration URL semantics, accessible labels and Japanese translations.

## Failure states

Initial check is visibly pending. Endpoint failure is reported without fabricated sample data; manual recheck is available. A readiness API failure is `unknown`, not conflated with missing Docker. Canceling research does not change the service status. The unresearched outline stays available even if local services are offline.

## Security and privacy

Use the existing same-origin/loopback API checks and local-only endpoint validators. Return status only, not secrets. Never log provider keys or error bodies from model services.

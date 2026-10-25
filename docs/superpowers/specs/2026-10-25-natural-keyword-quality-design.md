# Natural search keyword quality — follow-up

## Intent

Project keyword suggestions must resemble useful search-box queries, not plausible-sounding research headings. The 2–4-word length fix is in place but all twelve newly reported results still clear the deterministic quality gate.

## Approaches

1. **Chosen: hybrid quality gate and cleaner generation angles.** Reject unmistakable editorial scaffolding deterministically, send ambiguous jargon to the existing small optional semantic judgment, and guide generation toward named concepts and mechanisms. Keep the global 12-inference cap and immediate partial batches.
2. Add a domain-specific housing replacement dictionary: predictable for the example but not reusable for technology, science and other channel topics. Rejected.
3. Have the model rewrite or judge every suggestion: more expensive and slower on a constrained local model, with no guarantee of better phrasing. Rejected.

## Behavior

- Reject clear editorial labels ending in generic `timeline` or standalone `cost benefit`, plus four-word compound *change risk* descriptions. Three-word `impact` queries can be legitimate in science/technology, so send them to contextual semantic review instead of blanket rejection.
- Keep established natural terms including technology products, named 2–3-word comparisons, two-word `environmental impact`, financial `cost benefit analysis`, and concrete risk searches such as `flood risk` or `credit risk`.
- Ambiguous wording such as `reserve funds`, `yield comparison`, `premium volatility` or three-word `impact` queries gets a strict small semantic check for **verbatim natural query and project-specific relevance**. A failed or unavailable check discards only the ambiguous items; do not silently turn questionable text into different search terms. Ordinary product search terms ending in `comparison` need no model check.
- Generation prompts/lenses request search-box phrases and concrete events/systems, not risk/timeline/impact headings. Do not echo the rejected examples back to the model.
- Existing review/accept/skip behavior, 12-call budget, stream callbacks, dedup, retries, early refill stop and manually saved keywords remain unchanged. Return fewer good suggestions when the cap is exhausted; never pad to 12.
- Previously rejected candidates remain excluded from later batches' local screening, preventing repeated semantic-review costs, but their literal text never enters subsequent model prompts.

## Scope and verification

Change only `project-keyword-generator.mjs` and its tests plus the project discovery guide. No new dependencies, persistence/schema/API or network calls. Test observed bad/positive phrases, ambiguity judgment and failure, partial/refill behavior, comparisons and technical false positives. Do not run GitHub Actions.

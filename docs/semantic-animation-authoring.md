# Research-linked semantic animation authoring (2D v1)

ContentGen provides *what visibly happens*; pinned Kumiki-UI controls *how it moves*
using the Video Director's existing frame clock. These are qualitative teaching
operations, **not** data charts, simulations, fact checks, or arbitrary scene code.

## Workflow

1. Gather a research dossier with claim IDs and captured evidence. Human review of
   the claims remains a separate step.
2. Generate a new preproduction plan. Each teaching sequence must include
   `visualStates` and a `visualMechanic` describing the visible objects and operation.
3. Inspect the Research storyboard. Edit operator, actor labels, roles, source claim
   associations, operand order, or outcome in the **Semantic animation (2D)** controls.
   Matching problem/mechanism/payoff phases synchronize their authored operation.
4. Resolve blocking mechanic findings before preparing the Video Director job.
5. The Video Director uses the **same `SemanticMechanicScene`** for frame preview
   and export. The Research still is intentionally *not* a playable MP4 preview.

## Six operation types

| Operator | Ordered operands | Outcome | What visibly changes |
| --- | --- | --- | --- |
| `split` | At least two `part` actors | Existing `subjectId` | Parts separate from the same whole |
| `assemble` | At least two `part` actors | `result` actor | Parts join a recognized system |
| `transfer` | One `source`, then one `destination` | Existing `subjectId` | Same persistent token travels between endpoints |
| `accumulate` | At least two `part` actors | `result` actor | Distinct contributions enter a qualitative whole |
| `compare` | At least two `part` actors | Existing `subjectId` | Parts align on an equal qualitative comparison layout |
| `reveal` | One `source` occluder, then a hidden `part` | Hidden `part` | Cover slides aside to reveal a previously obscured element |

The actor with `id === subjectId` **must** have role `subject`. Include only the
subject, named operands and outcome actor—decorative, unreferenced actors fail
preflight. Every actor must
reference at least one real research-claim ID available in the sequence. Extra
fields (coordinates, scripts, external URLs) and embedded amounts/counts/rates in
labels fail validation. Model-specified `assetKey` is currently not enabled:
the first release uses procedural 2D vectors while a reviewed, commercially
permitted local asset registry is prepared.

### Qualitative ownership-cost example

```json
{
  "version": 1,
  "operator": "accumulate",
  "subjectId": "house",
  "actors": [
    {"id":"house","label":"Ownership budget","role":"subject","claimIds":["claim_cost_categories"]},
    {"id":"tax","label":"Property tax","role":"part","claimIds":["claim_cost_categories"]},
    {"id":"insurance","label":"Home insurance","role":"part","claimIds":["claim_cost_categories"]},
    {"id":"maintenance","label":"Maintenance","role":"part","claimIds":["claim_cost_categories"]},
    {"id":"total","label":"Ownership costs","role":"result","claimIds":["claim_cost_categories"]}
  ],
  "operands":["tax","insurance","maintenance"],
  "outcomeId":"total"
}
```

`claim_cost_categories` is an **example placeholder**, not an auto-created
source. Replace it with the dossier's actual claim ID; validation must pass.
The tiles all use categorical representation, not heights scaled by a fabricated
expense amount. House Math's separate, explicitly illustrative numeric recipe
remains supported as its own restricted scene.

For network movement, use `transfer`: `subject` = packet token,
`source` = sender, `destination` = receiver, ordered operands
`["sender","receiver"]`, and `outcomeId` = packet's existing ID. Use
claim IDs supporting that description, not a fabricated router speed.

## Verification

From repository root after dependency installation:

```bash
node --test apps/web/scripts/video-production/semantic-mechanic.test.mjs apps/web/scripts/video-production/preproduction-render-bridge.test.mjs apps/web/scripts/video-production/job.test.mjs
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm --dir apps/web test:video:headless
pnpm --dir apps/web build
```

Automated tests sample transitions at 0%, 10%, 25%, 50%, 75%, 95% and the
final frame, verify exact payoff locks, subject IDs, stage bounds and seek
determinism. These checks do **not** replace reviewing the film at normal speed
or doing one real browser-to-FFmpeg export. The draft PR must remain draft
until those manual export and semantic-clarity checks are complete.

## Boundaries

- Current stage: 1920×1080 YouTube landscape, safe content region
  `x=1040..1820`, `y=230..920`.
- The engine does not call an external provider, scrape assets, grant a license,
  publish video or alter the Jobs & QA backend.
- A legacy saved plan lacking `visualMechanic` retains its historical fallback.
  A *newly generated* teaching sequence must define a supported operator.
- Unsupported subjects must receive an actionable editing/preflight issue;
  do not silently substitute an unrelated icon or fully rendered scene.

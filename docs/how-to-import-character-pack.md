# Import and save a 2D / 2.5D character ZIP draft

**Current status:** ContentGen's Assets → Character Studio panel inspects portable
layered character packages in the browser. Once checked, **Save draft locally**
stores the original ZIP in ContentGen's local Rust content-addressed artifact
store, scoped to the current Studio project. Saved drafts appear below the
inspector and can be reopened for another structural check or downloaded as
the exact original ZIP after a restart.
Saving is optional; nothing is sent to the local server until Save is selected.
Temporary sprite URLs are discarded when the file changes or the panel closes.
The report includes a **rig metadata inventory** of declared named poses,
animation actions, expression presets, image variants, speech mapping, anchors
and rest transforms. This is a checklist of authored fields, **not** evidence
that the actions play correctly or the rig is ready to publish.

The **Rig & motion editor** composes the layered puppet using the pinned
Kumiki `CharacterPresenter`. Choose a named part, then drag the gray handle to
move the whole part or the cyan joint handle to move its shoulder/hip/tail
attachment point independently. Joint relocation compensates the part's rest
transform to prevent the source artwork jumping in the setup pose. Numeric
inputs remain available for precise coordinates and keyboard work.
Adjust parent-relative X/Y position, clockwise rotation, horizontal/vertical
scale, or part-local pivot. It does not assume
human proportions or special limb names: squirrel muzzles, short hind legs,
body-hugging paws, wings, tentacles and long tails all use the same fields.
For example, increase a head's Y offset to lower it; reduce a short-legged
creature's leg `scaleY` (without collapsing it to zero); adjust each paw's X
offset to tuck it closer to its torso; set a tail's pivot at its actual base.
These numbers must be measured against the character art, not copied from a
generic human template. A trimmed sprite and its replacement expressions
still require aligned landmarks to avoid jumps. **Rig** mode always shows
the bare rest pose, even if you previously scrubbed an animation.

Choose **Animate** to preview a validated imported action when one is
available. Pause or scrub to the desired frame, then drag the purple handle
to add a local part-offset correction, or click ±5° to adjust rotation. The
selected influence window (6, 12, or 24 frames) is automatically smoothed by
Kumiki's deterministic frame evaluator. Undo and Reset are available. If
optional action metadata cannot pass Kumiki validation, the inspector safely
previews corrections over a neutral pose and says so explicitly. The image is
a preview: original, manually authored layers still determine silhouette,
occlusion and mouth-shape quality.

To keep saved drafts immutable, calibration **does not overwrite or repack**
the imported ZIP. Enter a **new revision**, select **Download revised
character.json**, replace the old `character.json` alongside the unchanged
`layers/` files, and create a new ZIP before importing again. Pose corrections
are separately downloadable as `character.pose-corrections.json`, referencing
the original revision (and any newly calibrated revision). **These correction
tracks are currently editor preview data**: the video renderer does not yet
consume this sidecar, and saving the ZIP draft does not save edits. Retain both
downloads if you need the work later; a future project animation API can adopt
the tracks without changing the original character pack. Natural-speed visual
review and exported video parity are not yet certified.

Drafts are **unverified and immutable**. In a test-only general explainer,
Production can now use the latest saved Pip or Quill revision, or the exact
revision explicitly chosen under **Narration → Scene cast → Rig revision**.
That test export uses Kumiki's pinned character presenter, verified local
image assets and the measured dialogue/speech frame windows. A saved revision
never grants publishing approval, verified lip-sync phonemes, voice consent or
artwork rights. Changing art or metadata requires a different
`revision` in `character.json`. Saving the same bytes with the same project,
character ID and revision is idempotent; conflicting bytes are rejected.

The video exporter verifies ZIP entry CRCs and archive SHA-256, PNG pixel
streams and checksums (or bounded WebP container metadata), manifest dimensions
and referenced image URLs. Chromium must decode **every** pinned image layer,
including currently hidden expressions, before frame capture. A selected
revision that is missing, corrupt or from another project blocks the render;
it never silently substitutes built-in art. The render identity includes the
exact saved draft ID, revision and archive hash, so checking one version and
rendering another requires a new preflight. Mouth shapes use approximate
cycles across measured voice timing, not true phoneme alignment. Blink, idle
and gestures run through Kumiki's existing character evaluator. In Video
Director, a character dialogue line may optionally specify an exact **Rig
action** name from its saved `character.json` (for example `walk`, `wave`,
`ask_question` or a custom name). The selected ZIP must declare that action;
an unknown name blocks the video rather than silently playing built-in
motion. A blank value retains the automatic explain gesture. This is
per-dialogue-line action timing, not yet a general per-scene animation
timeline or a substitute for importing the legacy standalone Pip v1.6 kit.

Start the ContentGen Rust server (`cargo run -p contentgen-server`) before
saving. With the Vite dev server on 127.0.0.1:5173, requests are proxied to the
local server (default 127.0.0.1:8787). If the server is unavailable, the
browser preview still works and the UI reports that saving failed.

This format follows Kumiki CharacterDefinition v1 and uses its pinned
presenter for preview. The ZIP importer performs structural checks; optional
animation playback has an additional Kumiki validation gate. Neither is an
artwork-rights approval or final-render certification.

## Folder layout

Create a ZIP, not a nested directory wrapped in a ZIP. At its root:

```text
character.json
layers/
  body.png
  left-arm.png
  right-arm.png
  face-neutral.png
  face-blink.png
  mouth-rest.png
  mouth-open.png
docs/
  README.md             (optional)
```

Every referenced PNG or WebP is a separate image file in `layers/`. Preserve
transparent backgrounds. Extra hidden/unused sprites are rejected to catch
missing manifest references. Package docs may be `.txt` or `.md` under `docs/`.

## `character.json` example

The complete runtime schema has more animation controls than the inspector
currently evaluates. This example demonstrates the minimum pack contract;
artwork beyond the visible side profile, alternate hand positions and voice
mouth shapes must be drawn separately if the requested animation needs them.

```json
{
  "schemaVersion": 1,
  "characterId": "mystery-guide",
  "revision": "1",
  "mode": "puppet-2.5d",
  "design": { "width": 1024, "height": 1024 },
  "channels": ["body", "leftArm", "rightArm", "eyes", "mouth"],
  "palette": {},
  "assets": {
    "body": {
      "kind": "image", "uri": "layers/body.png", "mediaType": "image/png",
      "width": 420, "height": 680,
      "provenance": { "source": "Original artwork by Artist Name", "license": "Artist-authorized commercial use" }
    },
    "left-arm": {
      "kind": "image", "uri": "layers/left-arm.png", "mediaType": "image/png",
      "width": 180, "height": 330,
      "provenance": { "source": "Original artwork by Artist Name", "license": "Artist-authorized commercial use" }
    }
  },
  "parts": [
    { "id": "body", "channel": "body", "asset": "body", "pivot": { "x": 210, "y": 300 }, "z": 0 },
    { "id": "left-arm", "parent": "body", "channel": "leftArm", "asset": "left-arm", "pivot": { "x": 82, "y": 30 }, "z": 1 }
  ],
  "anchors": { "head": { "part": "body", "at": { "x": 210, "y": 150 } } },
  "poses": { "idle": {} },
  "basePose": "idle",
  "actions": {},
  "expressions": { "default": "neutral", "sets": { "neutral": {} } },
  "capabilities": []
}
```

The ZIP must contain the two files referenced by this abbreviated example.
Add the additional `assets`/`parts` entries required for the richer folder
illustration. Image dimensions must match PNG header dimensions. Pivot
coordinates are in **part-local design pixels**, not page pixels. `parent`
points to another part ID; cycles or missing parents are invalid. `z` controls
front-to-back ordering. A character's `characterId` stays stable; changing
the rig or art creates a new explicit `revision`.

### Talking characters with a separate mouth or beak

If the default head image already contains a closed mouth, **do not draw a second mouth
on top of it** while talking. Add a clean head image (without its painted mouth) as a
variant of the `head` part, and put registered closed/open mouth sprites on a separate
child `mouth` or `beak` part. Keep each sprite in the same pixel coordinate frame so
only the mouth shape changes, not the head's size or position. The speech definition
can switch both parts together:

```json
"speech": {
  "mouthPart": "beak",
  "rest": "hidden",
  "activeVariants": { "head": "beakless" },
  "visemes": { "closed": "closed", "open": "open_3", "wide": "open_6" },
  "approximateCycle": ["closed", "open_3", "open_6"],
  "transitionFrames": 0,
  "approximateStepFrames": 3
}
```

Here `head` must declare a `beakless` variant, `beak` must declare the named
viseme variants, and `hidden` may be an actual transparent variant. The normal
head/expression artwork returns when speech ends. During speech, the clean head
takes priority over the painted head and blink sprites. The inspector rejects
missing companion parts, mouth stages and invalid references.

A ZIP containing only a standalone `*.rig.json` and a collection of art/scripts
is **not** the portable importer format. Convert it into root `character.json`
plus referenced `layers/` images first; imported scripts are never executed.

## Safety and package rules

| Rule | Current limit |
| --- | --- |
| ZIP file size | 16 MiB |
| Total advertised expanded contents | 64 MiB |
| One expanded file | 12 MiB |
| `character.json` | 1 MiB |
| File entries | 128 |
| ZIP encoding | Stored (method 0) or raw DEFLATE (method 8) |
| Images | Signature-checked PNG and WebP only |

The browser inspector rejects traversal/absolute paths, overlapping or duplicate
entries, ZIP64/multipart archives, symlinks, encrypted entries, broken sizes,
bad CRC-32, missing/non-owned asset references, invalid pose transforms,
unknown pose parts, invalid rest transforms, broken anchors and mismatched
image paths. If a `sha256` is present on an image
asset, it verifies the hash against the unpacked bytes. It does not execute
archive content or extract to the filesystem. Saving uploads the original ZIP
to the local Rust server, where it is stored inert without unpacking. The
server validates the upload size and ZIP signature but **does not trust the
browser's structural report** or mark the draft safe for rendering. Unknown rich
shape/3D/vector schemas are not accepted in this first vertical slice.

There is no implicit license clearance: `provenance` fields are artist claims
until reviewed. You must have permission to use the artwork and any voice
recordings before publishing or offering downloads.

## Next implementation stage

- Pinned Kumiki-compatible server-side package/rig validation and explicit
  rights decisions. Only independently validated/approved revisions may render.
- Reusable character registration and project cast links; explicit local
  catalog cleanup/retention controls. Browser-only project IDs are preserved
  as strings without depending on asynchronous Discovery project mirroring.
- Rig/pose/viseme validation through an actual *pinned* Kumiki renderer API.
- Character preview using real layer transforms, manual approval, versioned
  voice bindings and project cast linking.
- Jobs-backed performance/render/QA integration, revisions, and rights checks.

No progress toward those stages is implied by a successful ZIP inspection.

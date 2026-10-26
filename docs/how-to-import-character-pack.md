# Import and save a 2D / 2.5D character ZIP draft

**Current status:** ContentGen's Assets → Character Studio panel inspects portable
layered character packages in the browser. Once checked, **Save draft locally**
stores the original ZIP in ContentGen's local Rust content-addressed artifact
store, scoped to the current Studio project. Saved drafts appear below the
inspector and can be reopened for another structural check or downloaded as
the exact original ZIP after a restart.
Saving is optional; nothing is sent to the local server until Save is selected.
Temporary sprite URLs are discarded when the file changes or the panel closes.

Drafts are **unverified and immutable**. They are not publishing approvals,
character registrations for rendering, lip-sync previews, voice grants or
evidence of artwork rights. Changing art or metadata requires a different
`revision` in `character.json`. Saving the same bytes with the same project,
character ID and revision is idempotent; conflicting bytes are rejected.

Start the ContentGen Rust server (`cargo run -p contentgen-server`) before
saving. With the Vite dev server on 127.0.0.1:5173, requests are proxied to the
local server (default 127.0.0.1:8787). If the server is unavailable, the
browser preview still works and the UI reports that saving failed.

This format deliberately follows the proposed Kumiki CharacterDefinition v1
shape, so a later pinned renderer adapter can consume approved definitions
without guessing missing body parts. Kumiki's current Character2D work is
tracked separately; this inspector does **structural checks**, not a substitute
for the eventual runtime validator.

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
bad CRC-32 and mismatched image paths. If a `sha256` is present on an image
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

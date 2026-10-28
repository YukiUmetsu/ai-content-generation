# Automatic scene media discovery and selection

**Owner:** ContentGen discovers, reviews, imports and selects third-party media. The existing Kumiki general-scene renderer now consumes reviewed Pexels photos and compatible H.264 MP4 clips on the next video draft; Poly Haven models and textures are not yet connected to that compositor.

## User workflow

1. Open a preproduction bundle in **Video Director**, choose **Landscape 16:9** or **Portrait 9:16**, then click **Find assets for all scenes**. This is the explicit permission for outbound Poly Haven and Openverse requests. Alternatively, a saved YouTube video's **Generate draft video** action can search during the tracked `asset-search` Jobs step when **Search free scene media** is checked; the saved metadata can be reopened in Director after a successful render. Pexels API search is retired; use its website download/import workflow. The bundle is analyzed without an LLM; abstract diagrams and charts stay with Kumiki's semantic graphics.
2. Browse ranked scene suggestions. Matching uses visible subjects and `plan.sound[].narration` first, then provider-title/URL metadata, output aspect, and clip duration. The shot length is **estimated from planned narration** until measured audio timing is available; the API accepts optional positive per-shot `sceneDurationsSeconds` overrides. Scores and reasons are deterministic guidance, **not image/video understanding** or proof that footage depicts the claim. Generic or weak matches require review and are not designated top suggestions. No downloads occur during search; provider failures degrade independently.
3. For Poly Haven, open the original asset page and its license, choose **Review before import**, check the per-item consent box, then **Approve and download**. For Pexels, paste an individual original photo page URL and choose **Download photo from Pexels page**. This explicitly requested operation fetches **one public page and one corresponding verified Pexels CDN JPEG**; it does not search the website at scale or work around access-denial challenges. If that is unavailable, download the JPG/H.264 MP4 from the website yourself and use **Import downloaded Pexels file**. Supply the original page URL, optionally the creator, and confirm license/people/logo review. Uploads are same-origin and limited to 80 MB; the server validates media signatures, codecs, resolution and video duration using FFprobe, then saves SHA-256 provenance. No API key or browser-secret handling is involved.
4. Approved assets are placed in the local `data/studio-assets/<dossier-id>/<shot-id>/asset_<content-hash>/` directory beside a manifest. A manifest records the source, creator, license URL, media type, file hashes, local paths and human review status. `GET /api/contentgen-assets/approved?projectId=<dossier-id>` gives the adapter a per-scene manifest list.
5. Choose **Use in scene** on an approved asset to pin its SHA-256 reference for that shot, or **Clear selection** to remove the binding without deleting media. Scene-local `scene-media-selection.json` holds the selected provider/ID/type/hash. The selected Pexels photo/video also has **Horizontal focus** and **Vertical focus** controls (0–100%) so an editor can reposition its crop in the actual Kumiki scene; save the framing explicitly or return to Center. Focal positions are validated and persisted separately per selected shot, and their values enter the render identity so only affected visual work needs regeneration. `GET /api/contentgen-assets/selected?projectId=<dossier-id>` resolves selections against intact approved files and flags invalidated scenes; `POST /select` and `POST /clear` are same-origin local Studio actions.

6. On the next **Generate draft video** run, the worker checks the current selection fingerprint, verifies each selected local file's hash and provenance, and freezes the exact bytes into its own render directory **before narration**. Kumiki renders approved photographs with restrained pan/zoom motion or displays H.264 footage in a silent frame-synchronized visual panel. The existing explanatory text and scene layout remain editable; changing a selection requires a new draft. The render fails with a selection-specific instruction if a pinned file is missing, changed, unsupported, or rejected by FFprobe.
7. Automatic Pexels API enrichment has been disabled because new API keys are unavailable and the creator requested that integration removed. Even if an older browser preference says automatic Pexels downloads were enabled, the worker does not make API requests. Saved Pexels approvals, hashes, and manual scene selections are preserved for existing projects. Missing external media falls back to Kumiki graphics. The legacy Pexels API adapter remains as historical code/test coverage but is **not exposed** by the Settings page, asset bridge, or production worker.

Legacy automatically prepared imagery is tagged `draft-provider-license`, **not `user-reviewed`**. The current website import records explicit review as `user-reviewed`; neither state proves that footage accurately depicts a claim, that a depicted person consented to the intended use, or that publication is safe. Human publication review remains necessary. Saved Pexels assets are illustrative footage, not independent evidence for claims. Poly Haven models are selectable only through a future compatible compositor, so the current UI does not offer **Use in scene** for them.

## Providers, terms and limits

| Provider | Supported search / import | Configuration | Rights |
|---|---|---|---|
| [Poly Haven](https://polyhaven.com/our-api) | Public asset catalog: 3D models, textures and HDRIs; downloads require a small compatible variant | No key. Named `ContentGen-SceneAssets` User-Agent. Prominent provider credit in UI | Assets are [CC0](https://polyhaven.com/license); Poly Haven attribution in our UI is required for use of its live API |
| [Openverse](https://openverse.org/) | Public CC0 metadata suggestions, with manual source verification; direct import not integrated | No key | Index metadata does not establish an item's actual usage rights |
| [Pexels](https://www.pexels.com/) | Explicit one-page/one-photo website download where public metadata permits, or user downloads JPG/H.264 MP4 then imports the local file and supplies the exact source page URL | No API key, automated keyword crawling or bulk extraction. Existing imported assets remain available. | [Pexels License](https://www.pexels.com/license/), not CC0. Check recognizable people, brands, standalone redistribution and website terms. |

No keyword crawling, bulk downloads, asset-pack redistribution, access-challenge bypass or automatic publish. Searches remain bounded and metadata-only. A manual Pexels file upload **never fetches the submitted URL**: it is validated as provenance for a file the user uploads. The separate one-photo downloader fetches only the exact user-selected page and a same-ID image from `images.pexels.com`, and fails without retrying if access is denied. Uploads/downloads have an 80 MB limit, strict JPEG/MP4 signatures, FFprobe checks, SHA-256 hashes and owned temporary folders. Already-imported API-era assets remain eligible for the existing SHA-verified scene renderer; no Pexels API requests are made by Studio.

Commercial *finished videos* still need human review. Quaternius, Sketchfab, Fab and Mixamo are not automatic download providers; their per-item redistribution/download terms differ. Users can source those manually through their original sites until verified adapters exist.

## Integration boundary and follow-up

- Vite's loopback-only bridge is an interim Studio worker. For durable catalog/release ownership, promote manifests and approvals into ContentGen's Rust/SQLite asset ledger with migrations and hash verification. Keep secrets server-side.
- Promote the current Kumiki general-scene binding to richer layouts and per-scene preview/editing, with explicit crop and trim controls. The worker already includes selected-file SHA-256 and rights state in render identity, validates MP4 using FFprobe, and serves immutable bytes locally with HTTP byte-range streaming. The capture server rechecks a frozen file's hash if its inode, size or nanosecond timestamps change, rather than hashing up to 80 MB for every video frame. It does **not** yet trim/transcode footage or produce a real-browser visual QA report. Never infer that stock media proves a researched claim.
- Add a creative placement review: relevance to narration, legible at target size, 16:9/9:16 safe areas, copyright/trademark/person rights, and 3D texture/dependency completeness. Keep semantic diagrams as default when footage does not teach.
- Add an approved local upload adapter and more providers only after provider-specific contract, license and failure tests. Avoid using provider assets as training/evaluation datasets.

## Verification

From repo root:

```bash
node --test apps/web/scripts/video-production/asset-discovery.test.mjs
node --test apps/web/scripts/video-production/asset-matching.test.mjs
node --test apps/web/scripts/video-production/automatic-draft-assets.test.mjs
node --test apps/web/scripts/asset-discovery-vite.test.mjs
pnpm --dir apps/web run test:video:headless
pnpm --dir apps/web run build
```

All search and download tests use fake provider responses; no credentials, external calls or downloaded stock media are required. A manual visual check should use a saved bundle and inspect at least one 3D/texture and photo candidate, license links, approval path, and retry/error states. See [06](06-media.md), [08](08-assurance.md), and [14](14-kumiki-integration.md) for overall media, rights and renderer requirements.

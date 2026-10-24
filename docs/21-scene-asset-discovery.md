# Automatic scene asset discovery — first vertical slice

**Owner:** ContentGen discovers, licenses and imports third-party media; Kumiki-UI renders assets after an explicit scene binding. This document describes the implemented Studio slice, not an unconditional automatic render integration.

## User workflow

1. Open a preproduction bundle in **Video Director**, choose a shot, then click **Find assets for all scenes**. This is the explicit permission for outbound provider requests. The entire bundle is analyzed without an LLM. Real physical subjects are searched; charts, formulae and abstract mechanisms stay in Kumiki's semantic graphics system.
2. Browse scene-specific metadata and thumbnails, grouped by shot. The search itself does not download asset files. A missing provider fails independently and yields a warning; existing work remains.
3. Open the original asset page and its license, choose **Review before import**, check the per-item consent box, then **Approve and download**. Only this action fetches the media bytes.
4. Approved assets are placed in the local `data/studio-assets/<dossier-id>/<shot-id>/asset_<content-hash>/` directory beside a manifest. A manifest records the source, creator, license URL, media type, file hashes, local paths and human review status. `GET /api/contentgen-assets/approved?projectId=<dossier-id>` gives the adapter a per-scene manifest list.

The interface shows the imported file path. It does **not** claim the current generic Kumiki renderer automatically incorporates these files: explicit scene-level asset binding, glTF dependency handling for all supported variants and visual inspection remain subsequent integration work.

## Providers, terms and limits

| Provider | Supported search / import | Configuration | Rights |
|---|---|---|---|
| [Poly Haven](https://polyhaven.com/our-api) | Public asset catalog: 3D models, textures and HDRIs; downloads require a small compatible variant | No key. Named `ContentGen-SceneAssets` User-Agent. Prominent provider credit in UI | Assets are [CC0](https://polyhaven.com/license); Poly Haven attribution in our UI is required for use of its live API |
| [Pexels](https://www.pexels.com/api/) | Optional scene photo search; photos only in this slice | Local `PEXELS_API_KEY` environment variable; never sent to browser or stored in catalog | [Pexels License](https://www.pexels.com/license/), not CC0. Check recognizable people, brands, standalone redistribution and API usage restrictions |

No unauthenticated third-party scraping, bulk downloads, asset-pack redistribution or automatic publish. Search requests are bounded (one Poly Haven catalog request, at most twelve distinct Pexels scene searches), with a short metadata cache. Imports resolve provider IDs server-side—**never trust a client-submitted download URL**—and use a trusted HTTPS allowlist, no HTTP redirects, an 80 MB per-import ceiling, SHA-256 hashes, and an owned temporary folder. No imports occur during page load, auto-preview, readiness checks or Storybook.

Commercial *finished videos* still need human review. Quaternius, Sketchfab, Fab and Mixamo are not automatic download providers; their per-item redistribution/download terms differ. Users can source those manually through their original sites until verified adapters exist.

## Integration boundary and follow-up

- Vite's loopback-only bridge is an interim Studio worker. For durable catalog/release ownership, promote manifests and approvals into ContentGen's Rust/SQLite asset ledger with migrations and hash verification. Keep secrets server-side.
- Extend the Kumiki compiler contract to resolve an explicit approved `shotId → asset artifact` binding and include its SHA-256/rights state in render fingerprints. Never infer that a stock photo proves a researched claim.
- Add a creative placement review: relevance to narration, legible at target size, 16:9/9:16 safe areas, copyright/trademark/person rights, and 3D texture/dependency completeness. Keep semantic diagrams as default when footage does not teach.
- Add an approved local upload adapter and more providers only after provider-specific contract, license and failure tests. Avoid using provider assets as training/evaluation datasets.

## Verification

From repo root:

```bash
node --test apps/web/scripts/video-production/asset-discovery.test.mjs
node --test apps/web/scripts/asset-discovery-vite.test.mjs
pnpm --dir apps/web run test:video:headless
pnpm --dir apps/web run build
```

All search and download tests use fake provider responses; no credentials, external calls or downloaded stock media are required. A manual visual check should use a saved bundle and inspect at least one 3D/texture and photo candidate, license links, approval path, and retry/error states. See [06](06-media.md), [08](08-assurance.md), and [14](14-kumiki-integration.md) for overall media, rights and renderer requirements.

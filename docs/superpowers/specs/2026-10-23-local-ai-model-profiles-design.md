# Local AI model profiles and professional Settings — design

**Status:** Yuki selected reusable profiles (approach B) and said proceed, 2026-10-23.

## Intent

Replace ContentGen's one research-model selector with secure, explicit, reusable local text-model profiles and independent task assignments. Fix the Custom preset that cannot remain selected, support Magnitude's documented nonstandard `/inference/v1` prefix, and make Settings usable rather than a disorganized card grid.

### Current state and root cause

- The Settings select derives provider identity from `endpoint`, and choosing `custom` writes the existing endpoint back; Custom cannot persist when it matches a preset.
- `localChatEndpoint` permits only `/v1/chat/completions`, while model discovery forces `/v1/models`; Magnitude uses port `10100`, `/inference/v1/chat/completions` and `/inference/v1/models`.
- A single `data/research-model.json` is read by multiple CLI and Studio paths, so no task can select independently.
- An independent in-flight PR adds secure YouTube credentials to Settings. This feature must not duplicate or modify its secret-management API.

## Approaches and decision

1. **One default + direct per-task URLs/models:** smallest schema, but repeats endpoints and makes provider changes error-prone.
2. **Reusable named profiles + per-task assignments (chosen):** slightly more UI/schema, one saved server/model combination can serve many stages; one change updates all consumers. Explicit Custom provider identity is stored independently of endpoint.

## Contract

Canonical local config: `data/local-ai-profiles.json` (version 1) with `profiles: [{id, name, provider, endpoint, model}]`, `defaultProfileId`, `assignments: {taskId: profileId}`. IDs stable; provider one of `magnitude`, `ollama`, `lm-studio`, `custom`. No API keys or cloud URLs. Strict validation: bounded lengths/counts, unique IDs, known fields and task IDs, existing references, loopback HTTP only, no URL credentials/queries/fragments, and either `/v1/chat/completions` or Magnitude's `/inference/v1/chat/completions`. Atomic-ish replacement using an owned file mode 0600; no unauthenticated mutation from another origin.

Tasks: `research` (source analysis), `story` (research-to-story planning), `hooks` (editorial and shot variants), `script` (topic generation). Other AI prompt stages remain in Prompt Studio but must not imply they have a working per-task provider until wired. Default profile is used where assignment is absent; CLI `--model`/`--endpoint` remain explicit overrides.

Existing `data/research-model.json` is **read-only legacy fallback**, never deleted or overwritten by migration. If no new profile file exists, load a single profile from legacy settings; otherwise present an unsaved Ollama starter profile. Legacy `GET /api/local-research-model` and saved plan consumers remain compatible during transition. New same-origin API adds `GET /profiles`, `POST /profiles/save`, and `POST /models` for discovery (no auto-download or inference test); response errors are actionable without leaking local data.

Magnitude preset: `http://127.0.0.1:10100/inference/v1/chat/completions`. Ollama: `http://127.0.0.1:11434/v1/chat/completions`. LM Studio: `http://127.0.0.1:1234/v1/chat/completions`. Discovery derives `models` from each endpoint's path prefix (rather than hard-coding `/v1/models`) and caps response bytes/items, rejects redirects and non-loopback addresses.

## Settings interaction and layout

- Full-width **Local AI** primary area: profile chooser/create/remove; provider picker with persistent `Custom`; endpoint (editable); model ID (discover dropdown or manual input); connection feedback; explicit Save; no silent auto-download or launch.
- **Task assignments** alongside/below: each currently wired task has a named profile selector, with `Default` inheritance clearly distinguishable from override. Switching profile preserves each saved profile's endpoint/model. Changes are draft until Save; selection is recoverable after reload.
- Secondary **Appearance & language**; **Advanced prompts** in a collapsed, keyboard-operable disclosure; **Connections & credentials** remains owned by the other PR, its component can occupy a full-width/secondary section when merged; **Data & privacy** contains backup and visually separated destructive reset.
- Good visual hierarchy, generous whitespace, 14px+ helpers, responsive at 360/768/1280, accessible names and `role=status`/`role=alert`, focus/keyboard support, English/Japanese labels, no false connectivity claims. Research is still user-triggered and local-only for inference.

## Routing semantics

- `research` => research CLI, Research Studio source analysis.
- `story` => preproduction CLI and Research Studio's **subsequent** plan generation (distinct from source analysis).
- `hooks` => Studio brief variants and shot hook variants.
- `script` => local topic-generation CLI default when no explicit model supplied.
- In-flight UI jobs keep a resolved `{endpoint, model}` snapshot at their start; changing Settings does not silently reroute halfway through one model call. No hidden retries or multi-model simultaneous preload.

## Quality and boundaries

- Test original Custom regression; preset endpoints; exact Magnitude model discovery; blocked network/credential URLs; malformed config; duplicate IDs; missing assignments; legacy fallback; saved/reloaded profiles; independent task routing; hook and research-to-story route differences; errors/empty models; mobile/Japanese UI.
- No paid APIs, external inference calls, API credential storage, auto-install, auto-model download, model activation, changes to YouTube Keychain PR, TTS provider routing, or Jobs & QA work.
- This replaces a settings layout in one focused PR. Full real Magnitude connection requires Yuki's local running Magnitude server; CI uses bounded mocks.

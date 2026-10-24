# Evidence Library SearchField integration

## Intent

Use Kumiki-UI's newly merged, reusable SearchField in ContentGen's Evidence Library so searching saved source passages feels coherent with the rest of the studio. Preserve the distinction between an empty evidence index, a stale index, and a search with no matches; never substitute invented evidence.

## Approach

- **Selected: pin and vendor the Kumiki registry item.** Add `search-field` to the existing pinned source registry, use the real component and its tokenized styles, and keep provenance reproducible in the vendoring lock. The component owns input UI; ContentGen still owns the request and result states.
- Considered: copy the UI into the app without a registry item. Rejected because it would drift from the shared library and violate the project's vendoring contract.
- Considered: update every Evidence Library surface at once. Deferred; this delivery is specifically the search input and its immediate layout and interaction.

## Contract

- The search is labeled in English and Japanese, has an integrated icon and clear control, and accepts Enter or the explicit action button.
- The query continues to work in controlled and uncontrolled `EvidencePanel` modes, with trimmed searches and a 500-character validation boundary.
- Clearing the search resets stale results/errors while keeping keyboard focus in the search input.
- Inline help and validation are associated accessibly with the input. Pending searches indicate loading and prevent duplicate submissions; slow requests remain cancellable.
- Saved passages and provenance render exactly as returned by the server. Empty indexes are a neutral state, not an error.

## Constraints

Use the pinned Kumiki registry workflow, no extra runtime packages, no behavior change to the backend, and preserve source and search result integrity. The prior Kumiki pin and merged SearchField pin share unchanged source files for existing vendored items.

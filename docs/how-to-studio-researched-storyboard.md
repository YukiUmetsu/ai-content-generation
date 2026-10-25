# Try source-backed Studio storyboards

This workflow uses ContentGen's existing local search/model, collected **source passages**, and semantic preproduction. It does **not** produce narration audio, animations, MP4s, or independently verified claims.

## Prerequisites

1. Start a local OpenAI-compatible chat server with an already-installed model. Select it in **Studio → Settings → Local research model** (no download on startup).
2. Start the existing local SearXNG service with `pnpm --dir apps/web research:up` and verify with `pnpm --dir apps/web research:check`. This is an opt-in local search adapter; public page fetches still reach external HTTPS sites when you click Research.
3. Start Studio as usual: `pnpm --dir apps/web dev` and open the local address reported by Vite. The workflow uses Vite's same-origin `/api/contentgen-director/research-draft` bridge.

## In the Studio

1. Open **Research → Evidence**, enter a specific topic such as “Why replacing an HVAC system costs so much.” Optionally edit the intended audience and the question to answer.
2. The **Related YouTube** panel automatically shows relevant **already-collected** public video observations. Those are market inspiration, never factual support.
3. Click **Research & generate storyboard**. This intentionally authorizes fresh discovery/source capture on public HTTPS websites and calls only your configured local model. You can cancel or retry; failure displays an error rather than generating generic pretend facts.
4. Inspect the candidate claims, **exact captured quotes**, clicked-through sources and dates, gaps, and actual narration/visual-change storyboard outline. A quote appearing on a page is not a fact-check.
5. Click **Create editable sourced storyboard →** to open a new project. The existing storyboard editor permits revisions. All claims stay `unverified` until editorial review.

An explicit **Create unresearched outline** fallback still makes the original blank fact-checking scaffold and labels it unverified. That is not equivalent to researched production.

## Storyboard variety checks

A generated outline contains evidence-backed teaching beats, each expanded into **problem → mechanism → payoff** shots. The local model receives brief summaries of earlier beat outcomes and completed scenes so it can advance the explanation instead of redrawing the same cost chart or restating the same conclusion. Exact/reworded punctuation-only duplicate payoffs and repeated visual actions are rejected by the relevant small inference step and can be retried without regenerating approved earlier fragments. The storyboard projection also avoids printing the same visual action twice when shot and teaching-phase text match.

These checks cannot guarantee semantic originality; distinct wording may still express one idea. If captured evidence cannot support several distinct insights, revise the viewer question, gather more source material, or shorten the outline instead of making unsupported claims to fill runtime. Editorial review remains required.

## Data and safety

- Source snapshots and versioned preproduction JSON are written immutably under ignored `data/studio-research/` on the machine running Vite. Source IDs/URLs/hashes flow into the editable storyboard's claim references and assumptions.
- Only a user click permits public network reads; no Brave paid search, voice synthesis, video export, remote LLM or publishing is triggered.
- A missing local model/SearXNG stops research with instructions. A valid quote means it exists in captured HTML text, not that the page is accurate or commercially reusable.
- Actual video rendering and human video/playback acceptance are **later** tasks. Semantic movement instructions alone are not proof that Kumiki rendered useful animation.

## Validation

```bash
pnpm --dir apps/web run test
pnpm --dir apps/web run build
node --test apps/web/scripts/video-production/director-studio.test.mjs apps/web/scripts/video-production/studio-research.test.mjs
```

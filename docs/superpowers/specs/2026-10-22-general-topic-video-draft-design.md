# General-topic landscape video draft (milestone G1)

## Goal and boundary

From an arbitrary topic/question, generate an inspectable **draft** narration-and-visual job, then run the **existing** Fish/local-TTS → timed SFX → Chromium → FFmpeg landscape pipeline. The House Math demo keeps its current exact economics and renderer. This milestone does **not** research the web, publish, create portrait layouts, or claim commercial/factual approval.

The creator may provide short evidence notes; an unverified note is *not* a verified source. The model's facts and any unsourced numerical assertions remain editorial drafts. Output is never automatically `approved` or `commercialReady`.

## Approach

Use a configurable, already-running **local OpenAI-compatible chat-completions HTTP endpoint** for structured text generation. Avoid inference dependencies, model downloads, or new paid services. The existing Fish/local speech backends are unchanged. The topic planner is a separate, small adapter; output goes through the same `video-production-job/v1` validator as every other entry point. An offline checked-in generic script fixture verifies the renderer when no model is installed.

Alternatives rejected for G1: generating full scenes with unchecked model-authored JSX (unsafe and untestable), and grafting generic content onto the House Math cost diagram (semantically wrong). A full sourced research agent and provider registry belong to later vertical slices.

## Authoring contract

- `general-explainer-v1` is an explicit visual family. Existing House Math jobs without a family remain unchanged.
- A structured draft contains `topic`, `viewerQuestion`, an audience, `format` (`smoke` or `youtube-long`), 3 materially different packaging hypotheses, factual status (`unverified-draft`), and narration beats.
- A generic beat has a semantic intent: **introduce**, **sequence/process**, **compare**, **break down**, **pay off**. The renderer displays content-bearing, bounded diagrams made of authored labels. Every visible claim is attached to its actual narration beat and never silently represented as verified evidence.
- Rendering a long video still requires **at least 480 seconds of measured narration**. No silence padding or minimum-duration bypass. Provider responses that do not meet script length/structure expectations receive explicit findings and can be edited/regenerated.
- A payoff event exists in the final payoff beat, with an explicit generated SFX. Reveal content is hidden until its narrative event.
- Max input, response, scene text, diagram labels, node counts, API body sizes and timeouts are bounded. Model endpoint is loopback-only; raw credentials aren't sent to the generator. Treat all generated text as untrusted data and display it through text nodes, never HTML.

## Creator workflow

In local Video Test Studio: choose **Your topic**, enter a question/topic, intended audience and optional evidence notes, and supply local model endpoint/model. Click **Generate draft** (explicit local inference action), inspect title, alternative angles and editable source JSON, then **Check readiness** and **Render test video**. The previous two House Math fixtures remain selectable. Regenerating a draft invalidates preflight. No automatic model invocation on page load or while typing.

An equivalent CLI allows generating a JSON job from a topic brief; the resulting file can be run with the existing `video:produce` command. Offline tests use a fake response transport; a real model is not assumed present in CI.

## Failure and verification

- A refused/unavailable local endpoint produces a useful error with no fallback to a remote provider.
- Invalid, malformed or hallucinated model schemas fail before speech synthesis. Claim status remains explicitly illustrative/unverified.
- Unsupported generic visual semantics, missing payoff, out-of-range labels and tiny scenes are rejected.
- Generic exported frames prove correct first/middle/payoff content and never show payoff text early.
- Existing House Math regression and video production suites continue to pass; actual Fish-to-browser-to-FFmpeg export and full-length human viewing remain manual acceptance gates.

# Resumable research outline micro-jobs

## Problem

Qwen3.5 9B can exhaust its outline output tokens before returning valid JSON. In a recorded failure, a truncated first response was followed by a provider connection failure; the third retry lost the compact-output instruction. Scene micro-jobs from PR #76 do not help because the job cannot advance beyond outline.

## Chosen approach

Use the same local-only, crash-resumable queue as scenes. Request a compact story skeleton (`pattern`, `premise`, `hook`, `beatCount`), then generate and checkpoint each beat (`question`, `purpose`, `payoff`, `claimIds`) separately. Assemble and validate the original outline schema deterministically. Older whole-outline checkpoint files remain usable, and existing injected whole-outline producers continue to work in tests.

Alternatives: increasing output tokens again would leave the big all-or-nothing request; blindly retrying the same outline would waste inference. Both have failed in practice.

## Requirements

- Each successful skeleton or beat is saved immediately. Resume reuses every validated component; changing model identity starts a fresh generation.
- Preserve source claim ID validation and untrusted-source protections. Output must still pass `validateOutline` before storyboarding.
- Retry compactness is sticky after truncation, even if a later attempt fails at the provider layer. Keep the existing bounded three attempts and optional local model failover.
- Persist/log only safe provider categories (HTTP 5xx, rate-limit, connection failure), never prompts, outputs, source passages, or URLs.
- Keep the existing job status API and `outline` stage; an optional `currentStep` displays skeleton or beat progress.
- Keep the configured outline token and timeout ceilings. Do not change global defaults or force any external AI calls.

## Non-goals

- General video length management or revising the evidence collection pipeline.
- Recovering structurally incomplete JSON by inventing missing fields.

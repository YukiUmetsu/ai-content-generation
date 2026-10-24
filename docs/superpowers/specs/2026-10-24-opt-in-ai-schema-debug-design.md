# Opt-in AI Schema Failure Logging

## Intent

Enable Yuki to diagnose model-produced `schema_invalid` responses during local ContentGen storyboard jobs without weakening the schema contract or exposing content during normal operation.

## Approved Behavior

- Off by default. Enable only when `CONTENTGEN_DEBUG_AI_OUTPUT=1` is present in the Node server environment.
- For each *schema-invalid* AI attempt, emit one structured local console line with job ID, stage/substep, model name, attempt number, rejected field, and the model's original message content.
- Limit original message content to 16 KiB (UTF-8) per entry; indicate truncation explicitly.
- JSON-escape log content to prevent control characters/newlines from injecting additional terminal lines.
- Never include HTTP headers, authorization data, request bodies, prompts, or source captures as independent fields.
- Successful generations, other error categories, and all debug-disabled requests emit no raw model output.
- No persistent app storage, outgoing telemetry, or UI exposure of the raw response.

## Constraints

The original model message can itself repeat sensitive content from research or documents; enabling the flag is an explicit, temporary local debugging choice. Existing checkpoint and retry behavior must remain unchanged. Do not weaken validation or use a bigger model just to diagnose this issue.

## Approaches

1. Explicitly thread a response callback through every job and generation helper: easy to reason about but invasive and prone to missed substeps.
2. Use per-async-attempt context in the local Node inference path: **chosen** for isolation, minimal integration points, and reliable correlation to the exact job/attempt.
3. Log every response at the HTTP transport layer: rejected because it cannot reliably tell schema rejection from success and risks unconditional data disclosure.

## Acceptance

Mocked model output is logged on schema failure only with the flag enabled, limited to 16 KiB and JSON escaped; valid and disabled calls never log content; concurrent job attempts do not cross-contaminate output or metadata; existing storyboard tests pass.

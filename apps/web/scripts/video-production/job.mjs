/**
 * Headless ContentGen job v1. Runtime validation is the trust boundary:
 * fixtures are deliberately not treated as approved, persisted resources.
 *
 * @typedef {{ severity: 'error'|'warning', code: string, path: string, message: string }} Finding
 * @typedef {Record<string, unknown>} ObjectValue
 */
import presets from "../../src/components/video/platform-presets.json" with { type: "json" };

const has = (o, k) => Object.hasOwn(o, k);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v) => typeof v === "string" && v.trim().length > 0;
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const allowedIntents = new Set(["house-intro", "cost-breakdown", "cost-timeline", "cost-comparison", "cost-payoff"]);
const byPreset = new Map(presets.map((preset) => [preset.id, preset]));

/** @param {unknown} input */
export function parseVideoProductionJob(input) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (code, path, message, severity = "error") => {
    findings.push({ severity, code, path, message });
  };
  const fields = (value, path, keys) => {
    if (!object(value)) {
      add("invalid-object", path, "Expected an object.");
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) add("unknown-field", `${path}.${key}`, "Field is not part of video-production-job/v1.");
    }
    return true;
  };
  const text = (value, path) => {
    if (!string(value)) add("required-text", path, "A non-empty string is required.");
  };
  const idList = (values, path) => {
    if (!Array.isArray(values)) {
      add("invalid-list", path, "Expected an array.");
      return [];
    }
    const identifiers = [];
    values.forEach((value, index) => {
      if (!string(value)) add("required-text", `${path}[${index}]`, "A non-empty identifier is required.");
      else identifiers.push(value);
    });
    if (new Set(identifiers).size !== identifiers.length) add("duplicate-id", path, "Identifiers must be unique.");
    return identifiers;
  };
  const objects = (value, path, keys) => {
    if (!Array.isArray(value)) {
      add("invalid-list", path, "Expected an array.");
      return [];
    }
    const ids = [];
    value.forEach((item, index) => {
      if (!fields(item, `${path}[${index}]`, keys)) return;
      text(item.id, `${path}[${index}].id`);
      if (string(item.id)) ids.push(item.id);
    });
    if (new Set(ids).size !== ids.length) add("duplicate-id", path, "Identifiers must be unique.");
    return value.filter(object);
  };
  const revision = (value, path) => {
    if (!fields(value, path, ["id", "revision"])) return;
    text(value.id, `${path}.id`);
    if (!integer(value.revision, 1)) add("invalid-revision", `${path}.revision`, "Revision must be a positive integer.");
  };

  if (!fields(input, "$", ["schemaVersion", "kind", "id", "mode", "locale", "approval", "topic", "references", "destination", "voice", "policy", "claims", "beats", "events", "sounds"])) {
    return { ok: false, findings };
  }
  if (input.schemaVersion !== 1 || input.kind !== "video-production-job") {
    add("unsupported-schema", "$", "Requires video-production-job schemaVersion 1.");
  }
  text(input.id, "id");
  if (input.mode !== "smoke" && input.mode !== "youtube-long") add("invalid-mode", "mode", "Choose smoke or youtube-long.");
  if (input.locale !== "en-US" && input.locale !== "ja-JP") add("unsupported-locale", "locale", "Supported locales are en-US and ja-JP.");
  if (input.approval !== "test-only" && input.approval !== "approved") add("invalid-approval", "approval", "Choose test-only or approved.");

  if (fields(input.topic, "topic", ["title", "viewerQuestion", "payoffEventId"])) {
    for (const key of ["title", "viewerQuestion", "payoffEventId"]) text(input.topic[key], `topic.${key}`);
  }
  if (fields(input.references, "references", ["brandKit", "storyboard", "selectedPackagingId"])) {
    revision(input.references.brandKit, "references.brandKit");
    revision(input.references.storyboard, "references.storyboard");
    text(input.references.selectedPackagingId, "references.selectedPackagingId");
  }
  if (fields(input.destination, "destination", ["presetId", "width", "height", "fps", "targetDurationSeconds", "minimumDurationSeconds"])) {
    const d = input.destination;
    const preset = byPreset.get(d.presetId);
    if (!preset) add("unknown-preset", "destination.presetId", "Choose a recognized output preset.");
    else if (d.width !== preset.width || d.height !== preset.height) {
      add("preset-raster-mismatch", "destination", "Author at the preset's exact dimensions; never stretch or crop.");
    }
    if (!fields(d.fps, "destination.fps", ["num", "den"]) || !integer(d.fps.num, 1) || !integer(d.fps.den, 1) || d.fps.num / d.fps.den > 120) {
      add("invalid-fps", "destination.fps", "Positive rational FPS up to 120 is required.");
    }
    if (!Array.isArray(d.targetDurationSeconds) || d.targetDurationSeconds.length !== 2 ||
      !d.targetDurationSeconds.every((value) => integer(value, 1)) ||
      d.targetDurationSeconds[0] > d.targetDurationSeconds[1]) {
      add("invalid-duration-policy", "destination.targetDurationSeconds", "Expected ordered positive duration bounds.");
    }
    if (input.mode === "youtube-long" && (d.presetId !== "youtube" || !integer(d.minimumDurationSeconds, 480) || d.targetDurationSeconds?.[1] < 480)) {
      add("invalid-duration-policy", "destination.minimumDurationSeconds", "YouTube long production requires at least 480 seconds and a landscape profile.");
    }
    if (input.mode === "smoke" && d.minimumDurationSeconds !== null && !integer(d.minimumDurationSeconds, 0)) {
      add("invalid-duration-policy", "destination.minimumDurationSeconds", "Smoke minimum is null or a non-negative integer.");
    }
  }

  if (fields(input.voice, "voice", ["profileId", "provider", "modelId", "voiceId", "locale", "endpoint", "licenseStatus"])) {
    const v = input.voice;
    for (const key of ["profileId", "modelId", "voiceId"]) text(v[key], `voice.${key}`);
    if (v.provider !== "fish" && v.provider !== "local") add("unknown-provider", "voice.provider", "Choose fish or local explicitly.");
    if (v.locale !== input.locale) add("voice-locale-mismatch", "voice.locale", "Narration voice locale must match the job.");
    if (has(v, "endpoint") && v.provider !== "local") add("unexpected-endpoint", "voice.endpoint", "Remote endpoint overrides are not accepted.");
    if (!["test-only", "verified", "unknown"].includes(v.licenseStatus)) add("invalid-license", "voice.licenseStatus", "Explicit narrator license status required.");
  }
  if (fields(input.policy, "policy", ["commercialRightsVerified", "reviewerApproved", "maxCostUsd"])) {
    const p = input.policy;
    if (typeof p.commercialRightsVerified !== "boolean" || typeof p.reviewerApproved !== "boolean") add("invalid-policy", "policy", "Rights and approval must be explicit booleans.");
    if (typeof p.maxCostUsd !== "number" || !Number.isFinite(p.maxCostUsd) || p.maxCostUsd < 0) add("invalid-budget", "policy.maxCostUsd", "Budget must be a finite non-negative amount.");
  }

  const claims = objects(input.claims, "claims", ["id", "status", "text", "sourceRefs"]);
  for (const [index, claim] of claims.entries()) {
    text(claim.text, `claims[${index}].text`);
    if (!["illustrative", "verified", "disputed"].includes(claim.status)) add("invalid-claim-status", `claims[${index}].status`, "Claim status must be illustrative, verified or disputed.");
    if (has(claim, "sourceRefs")) idList(claim.sourceRefs, `claims[${index}].sourceRefs`);
    if (claim.status === "verified" && (!Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0)) add("missing-source", `claims[${index}].sourceRefs`, "A verified claim needs a source reference.");
  }
  const claimIds = new Set(claims.map((item) => item.id));
  const beats = objects(input.beats, "beats", ["id", "narration", "visualIntent", "claimRefs", "eventIds", "pauseAfterMs"]);
  if (beats.length === 0) add("empty-narration", "beats", "At least one narrated beat is required.");
  for (const [index, beat] of beats.entries()) {
    text(beat.narration, `beats[${index}].narration`);
    if (!allowedIntents.has(beat.visualIntent)) add("unsupported-scene-intent", `beats[${index}].visualIntent`, "No Kumiki visual recipe supports this intent yet.");
    for (const ref of idList(beat.claimRefs, `beats[${index}].claimRefs`)) {
      if (!claimIds.has(ref)) add("unknown-claim-ref", `beats[${index}].claimRefs`, "Beat references an unknown claim.");
    }
    idList(beat.eventIds, `beats[${index}].eventIds`);
    if (!integer(beat.pauseAfterMs, 0) || beat.pauseAfterMs > 60000) add("invalid-pause", `beats[${index}].pauseAfterMs`, "Pause must be 0–60,000 milliseconds.");
  }
  const beatIds = new Set(beats.map((beat) => beat.id));
  const events = objects(input.events, "events", ["id", "beatId"]);
  const eventIds = new Set(events.map((event) => event.id));
  for (const [index, event] of events.entries()) {
    text(event.beatId, `events[${index}].beatId`);
    if (!beatIds.has(event.beatId)) add("orphan-event-beat", `events[${index}].beatId`, "Event beat does not exist.");
    const beat = beats.find((item) => item.id === event.beatId);
    if (beat && (!Array.isArray(beat.eventIds) || !beat.eventIds.includes(event.id))) {
      add("event-beat-mismatch", `events[${index}]`, "Event must appear in its beat's eventIds.");
    }
  }
  for (const [index, beat] of beats.entries()) for (const id of Array.isArray(beat.eventIds) ? beat.eventIds : []) {
    if (!eventIds.has(id)) add("orphan-beat-event", `beats[${index}].eventIds`, "A beat refers to an unregistered event.");
  }
  if (!eventIds.has(input.topic?.payoffEventId)) add("missing-payoff", "topic.payoffEventId", "The declared payoff event must exist.");
  const sounds = objects(input.sounds, "sounds", ["id", "eventId", "category", "assetRef", "licenseStatus"]);
  for (const [index, sound] of sounds.entries()) {
    for (const key of ["eventId", "category", "assetRef"]) text(sound[key], `sounds[${index}].${key}`);
    if (!eventIds.has(sound.eventId)) add("orphan-sound-event", `sounds[${index}].eventId`, "SFX event does not exist.");
    if (!["test-only", "verified", "unknown"].includes(sound.licenseStatus)) add("invalid-license", `sounds[${index}].licenseStatus`, "Explicit license status required.");
  }
  if (!sounds.some((sound) => sound.eventId === input.topic?.payoffEventId)) {
    add("missing-payoff-sfx", "sounds", "The payoff must have an explicit semantic SFX.");
  }

  if (input.approval === "approved" && (!input.policy?.commercialRightsVerified || !input.policy?.reviewerApproved ||
    input.voice?.licenseStatus !== "verified" ||
    claims.some((claim) => claim.status !== "verified") || sounds.some((sound) => sound.licenseStatus !== "verified"))) {
    add("commercial-approval-blocked", "approval", "Commercial approval requires verified claims, voice/SFX rights and a human reviewer.");
  }
  return findings.some((item) => item.severity === "error")
    ? { ok: false, findings }
    : { ok: true, job: input, findings };
}

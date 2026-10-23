/**
 * Headless ContentGen job v1. Runtime validation is the trust boundary:
 * fixtures are deliberately not treated as approved, persisted resources.
 *
 * @typedef {{ severity: 'error'|'warning', code: string, path: string, message: string }} Finding
 * @typedef {Record<string, unknown>} ObjectValue
 */
import presets from "../../src/components/video/platform-presets.json" with { type: "json" };
import { isSceneMotion } from "./scene-motion.mjs";

const has = (o, k) => Object.hasOwn(o, k);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v) => typeof v === "string" && v.trim().length > 0;
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const allowedIntents = new Set(["house-intro", "cost-breakdown", "cost-timeline", "cost-comparison", "cost-payoff"]);
const genericIntents = new Set(["general-intro", "general-flow", "general-comparison", "general-breakdown", "general-payoff"]);
const byPreset = new Map(presets.map((preset) => [preset.id, preset]));
const portraitPresets = new Set(["youtube-shorts", "instagram-reels", "tiktok"]);

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

  if (!fields(input, "$", ["schemaVersion", "kind", "visualFamily", "id", "mode", "locale", "approval", "topic", "references", "destination", "voice", "policy", "evidence", "claims", "beats", "events", "sounds", "scenario"])) {
    return { ok: false, findings };
  }
  if (input.schemaVersion !== 1 || input.kind !== "video-production-job") {
    add("unsupported-schema", "$", "Requires video-production-job schemaVersion 1.");
  }
  text(input.id, "id");
  const family = input.visualFamily ?? "house-math-v1";
  if (!["house-math-v1", "general-explainer-v1"].includes(family)) add("unsupported-visual-family", "visualFamily", "Choose a supported visual recipe family.");
  if (family === "general-explainer-v1" && has(input, "scenario")) add("incompatible-scenario", "scenario", "A generic explainer cannot use House Math financial scenario data.");
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
    if (family === "general-explainer-v1" && !["youtube", ...portraitPresets].includes(d.presetId)) {
      add("unsupported-general-preset", "destination.presetId", "Generic video supports YouTube landscape, Shorts, Reels or TikTok portrait.");
    }
    if (family === "general-explainer-v1" && portraitPresets.has(d.presetId) && (input.mode !== "smoke" ||
      d.targetDurationSeconds?.[1] > 180 || d.minimumDurationSeconds !== null)) {
      add("portrait-duration-invalid", "destination", "Portrait general explainers must be short-form and within 180 seconds.");
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
  if (has(input, "scenario")) {
    const path = "scenario";
    const s = input.scenario;
    const money = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e10;
    const allowed = ["kind", "purchasePrice", "downPayment", "annualInterestRatePct", "years", "annualPropertyTax", "annualInsurance", "annualMaintenance"];
    if (fields(s, path, allowed)) {
      if (s.kind !== "house-cost-v1" || !money(s.purchasePrice) || s.purchasePrice <= 0 ||
        !money(s.downPayment) || s.downPayment > s.purchasePrice ||
        !Number.isFinite(s.annualInterestRatePct) || s.annualInterestRatePct < 0 || s.annualInterestRatePct > 25 ||
        !integer(s.years, 1) || s.years > 40 || !money(s.annualPropertyTax) ||
        !money(s.annualInsurance) || !money(s.annualMaintenance)) {
        add("invalid-scenario", path, "House cost scenario needs valid finite, non-negative economics and a bounded 1–40 year term.");
      }
    }
  }

  // Evidence records are metadata for an immutable source snapshot, not proof
  // that the linked passage supports the claim. That judgment belongs to review.
  const evidence = has(input, "evidence") ? objects(input.evidence, "evidence", ["id", "title", "sourceUri", "retrievedAt", "passageLocator", "snapshotSha256"]) : [];
  const evidenceIds = new Set(evidence.filter((entry) => string(entry.id)).map((entry) => entry.id));
  evidence.forEach((entry, index) => {
    const path = `evidence[${index}]`;
    const canonicalDate = string(entry.retrievedAt) && !Number.isNaN(Date.parse(entry.retrievedAt))
      && new Date(entry.retrievedAt).toISOString() === entry.retrievedAt;
    let httpsSource = false;
    if (string(entry.sourceUri)) {
      try {
        const uri = new URL(entry.sourceUri);
        httpsSource = uri.protocol === "https:" && !!uri.hostname && !uri.username && !uri.password;
      } catch { /* invalid URL is reported below */ }
    }
    if (!string(entry.title) || !httpsSource || !canonicalDate || !string(entry.passageLocator)
      || !/^[a-f\d]{64}$/i.test(entry.snapshotSha256 ?? "")) {
      add("invalid-evidence", path, "Evidence needs a title, HTTPS source URL, UTC snapshot time, precise passage locator and SHA-256 snapshot hash.");
    }
  });

  const claims = objects(input.claims, "claims", ["id", "status", "text", "sourceRefs"]);
  for (const [index, claim] of claims.entries()) {
    text(claim.text, `claims[${index}].text`);
    if (!["illustrative", "unverified", "verified", "disputed"].includes(claim.status)) add("invalid-claim-status", `claims[${index}].status`, "Claim status must be illustrative, unverified, verified or disputed.");
    if (has(claim, "sourceRefs")) for (const ref of idList(claim.sourceRefs, `claims[${index}].sourceRefs`)) {
      if (!evidenceIds.has(ref)) add("unknown-source-ref", `claims[${index}].sourceRefs`, `Claim references an unknown evidence snapshot: ${ref}.`);
    }
    if (claim.status === "verified" && (!Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0)) add("missing-source", `claims[${index}].sourceRefs`, "A verified claim needs a source reference.");
  }
  const claimIds = new Set(claims.map((item) => item.id));
  const claimsById = new Map(claims.filter((item) => string(item.id)).map((item) => [item.id, item]));
  const safeChartText = (value, limit) => string(value) && value.length <= limit && !/[\r\n\u0000-\u001f]/.test(value);
  const validateChart = (chart, path, beat) => {
    if (!fields(chart, path, ["kind", "categories", "series", "unit", "provenance"])) return;
    if (chart.kind !== "quantitative-chart-v1") add("invalid-chart-kind", `${path}.kind`, "Choose quantitative-chart-v1.");
    if (!safeChartText(chart.unit, 32)) add("invalid-chart-unit", `${path}.unit`, "Chart unit must be a safe, non-empty line of at most 32 characters.");

    const categories = Array.isArray(chart.categories) ? chart.categories : [];
    if (!Array.isArray(chart.categories) || categories.length < 2 || categories.length > 12) {
      add("invalid-chart-categories", `${path}.categories`, "A chart needs 2–12 category labels.");
    }
    categories.forEach((label, index) => {
      if (!safeChartText(label, 44)) add("invalid-chart-category", `${path}.categories[${index}]`, "Each category must be one safe line of at most 44 characters.");
    });
    const normalizedCategories = categories.filter((label) => safeChartText(label, 44)).map((label) => label.trim().toLocaleLowerCase());
    if (new Set(normalizedCategories).size !== normalizedCategories.length) add("duplicate-chart-category", `${path}.categories`, "Category labels must be unique.");

    const series = objects(chart.series, `${path}.series`, ["id", "label", "values"]);
    if (series.length < 1 || series.length > 4) add("invalid-chart-series", `${path}.series`, "A chart needs 1–4 data series.");
    series.forEach((item, index) => {
      const seriesPath = `${path}.series[${index}]`;
      if (!safeChartText(item.label, 44)) add("invalid-chart-series-label", `${seriesPath}.label`, "Series label must be one safe line of at most 44 characters.");
      if (!Array.isArray(item.values) || item.values.length !== categories.length) {
        add("invalid-chart-values", `${seriesPath}.values`, "Each series must have exactly one value per category.");
        return;
      }
      item.values.forEach((value, valueIndex) => {
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
          add("invalid-chart-value", `${seriesPath}.values[${valueIndex}]`, "Chart values must be finite numbers or null for missing observations.");
        }
      });
      if (!item.values.some((value) => typeof value === "number" && Number.isFinite(value))) {
        add("empty-chart-series", `${seriesPath}.values`, "A series cannot consist only of missing or invalid observations.");
      }
    });

    const provenancePath = `${path}.provenance`;
    const p = chart.provenance;
    if (!fields(p, provenancePath, ["basis", "disclosure", "claimRefs", "evidenceRefs", "assumptions"])) return;
    if (!safeChartText(p.disclosure, 180)) add("invalid-chart-disclosure", `${provenancePath}.disclosure`, "A visible, one-line chart disclosure (at most 180 characters) is required.");
    if (!["measured", "illustrative"].includes(p.basis)) {
      add("invalid-chart-provenance", `${provenancePath}.basis`, "Quantities must be explicitly measured or illustrative.");
      return;
    }
    const chartClaimRefs = idList(p.claimRefs, `${provenancePath}.claimRefs`);
    if (!chartClaimRefs.length) add("chart-missing-claims", `${provenancePath}.claimRefs`, "Quantitative data must identify supporting or illustrative claim IDs.");
    for (const ref of chartClaimRefs) {
      if (!Array.isArray(beat.claimRefs) || !beat.claimRefs.includes(ref)) {
        add("chart-claim-not-in-beat", `${provenancePath}.claimRefs`, `Chart claim ${ref} must be attached to the narrated beat.`);
      }
      const claim = claimsById.get(ref);
      if (p.basis === "measured" && (claim?.status !== "verified" || !Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0)) {
        add("chart-unverified-claim", `${provenancePath}.claimRefs`, `Measured values require an evidence-backed verified claim: ${ref}.`);
      }
      if (p.basis === "illustrative" && claim?.status !== "illustrative") {
        add("chart-claim-status-mismatch", `${provenancePath}.claimRefs`, `Illustrative values require an illustrative claim: ${ref}.`);
      }
    }
    if (p.basis === "measured") {
      if (has(p, "assumptions")) add("invalid-chart-provenance", `${provenancePath}.assumptions`, "Measured charts cannot silently mix illustrative assumptions.");
      const declared = idList(p.evidenceRefs, `${provenancePath}.evidenceRefs`);
      const expected = new Set(chartClaimRefs.flatMap((ref) => claimsById.get(ref)?.sourceRefs ?? []));
      if (declared.length === 0 || declared.length !== expected.size || declared.some((ref) => !expected.has(ref) || !evidenceIds.has(ref))) {
        add("chart-evidence-mismatch", `${provenancePath}.evidenceRefs`, "Evidence refs must exactly match the verified chart claims' registered source snapshots.");
      }
    } else {
      if (has(p, "evidenceRefs")) add("invalid-chart-provenance", `${provenancePath}.evidenceRefs`, "Illustrative values must not be presented as measured source data.");
      if (safeChartText(p.disclosure, 180) && !/^(illustrative|hypothetical|synthetic|例示|仮定|架空)/i.test(p.disclosure.trim())) {
        add("invalid-chart-disclosure", `${provenancePath}.disclosure`, "Illustrative disclosures must visibly begin with an illustrative/hypothetical/synthetic qualifier.");
      }
      if (!Array.isArray(p.assumptions) || p.assumptions.length < 1 || p.assumptions.length > 5 ||
        !p.assumptions.every((assumption) => safeChartText(assumption, 160))) {
        add("invalid-chart-assumptions", `${provenancePath}.assumptions`, "Illustrative charts require 1–5 safe, explicit value assumptions.");
      }
    }
  };
  const beats = objects(input.beats, "beats", ["id", "narration", "visualIntent", "claimRefs", "eventIds", "pauseAfterMs", "visual"]);
  if (beats.length === 0) add("empty-narration", "beats", "At least one narrated beat is required.");
  for (const [index, beat] of beats.entries()) {
    text(beat.narration, `beats[${index}].narration`);
    if (!(family === "general-explainer-v1" ? genericIntents : allowedIntents).has(beat.visualIntent)) add("unsupported-scene-intent", `beats[${index}].visualIntent`, "No visual recipe in this family supports this intent.");
    for (const ref of idList(beat.claimRefs, `beats[${index}].claimRefs`)) {
      if (!claimIds.has(ref)) add("unknown-claim-ref", `beats[${index}].claimRefs`, "Beat references an unknown claim.");
    }
    idList(beat.eventIds, `beats[${index}].eventIds`);
    if (!integer(beat.pauseAfterMs, 0) || beat.pauseAfterMs > 60000) add("invalid-pause", `beats[${index}].pauseAfterMs`, "Pause must be 0–60,000 milliseconds.");
    if (has(beat, "visual") && fields(beat.visual, `beats[${index}].visual`, family === "general-explainer-v1" ? ["headline", "subhead", "emphasis", "items", "chart", "hookStrategy", "typographyStyle", "direction", "motion"] : ["headline", "subhead", "emphasis"])) {
      for (const [key, maxLength] of [["headline", 68], ["subhead", 115], ["emphasis", 28]]) {
        const value = beat.visual[key];
        if (!string(value) || value.length > maxLength || /[\r\n\u0000-\u001f]/.test(value)) {
          add("visual-copy-overflow", `beats[${index}].visual.${key}`, `Scene ${key} must be one safe line of at most ${maxLength} characters.`);
        }
      }
      if (family === "general-explainer-v1") {
        if (has(beat.visual, "hookStrategy") && (index !== 0 || beat.visualIntent !== "general-intro" ||
          !["action-first", "unexpected-reveal", "transformation"].includes(beat.visual.hookStrategy))) {
          add("invalid-hook-strategy", `beats[${index}].visual.hookStrategy`, "Kumiki hook strategies are allowed on the opening scene only.");
        }
        if (has(beat.visual, "typographyStyle") && !["snap", "overshoot", "wipe"].includes(beat.visual.typographyStyle)) {
          add("invalid-typography-style", `beats[${index}].visual.typographyStyle`, "Choose a supported Kumiki impact typography treatment.");
        }
        if (has(beat.visual,"motion")&&!isSceneMotion(beat.visual.motion))
          add("invalid-scene-motion",`beats[${index}].visual.motion`,
            "Use a bounded scene motion preset: reveal delay, pace, camera and transition.");
        if (has(beat.visual, "direction")) {
          const path = `beats[${index}].visual.direction`;
          const dir = beat.visual.direction;
          if (fields(dir, path, ["phase", "subjectIds", "visualAction", "learningChange"])) {
            if (!["problem", "analogy", "mechanism", "payoff", "none"].includes(dir.phase))
              add("invalid-visual-phase", path+".phase", "Use an identified teaching phase.");
            if (!Array.isArray(dir.subjectIds) || dir.subjectIds.length < 1 || dir.subjectIds.length > 5 ||
              dir.subjectIds.some(x => typeof x !== "string" || !/^[a-z][a-z0-9_-]{0,80}$/iu.test(x)) ||
              new Set(dir.subjectIds).size !== dir.subjectIds.length)
              add("invalid-visual-subjects", path+".subjectIds", "Use 1-5 unique stable subject identifiers.");
            for (const [key, max] of [["visualAction", 650], ["learningChange", 650]]) {
              if (typeof dir[key] !== "string" || !dir[key].trim() || dir[key].length > max ||
                /[\u0000-\u001f]/u.test(dir[key]))
                add("invalid-visual-direction", path+"."+key, "Direction must be meaningful bounded editorial text.");
            }
          }
        }
        if (has(beat.visual, "chart")) {
          if (portraitPresets.has(input.destination?.presetId)) add("portrait-chart-unavailable", `beats[${index}].visual.chart`, "ChartStory needs a portrait-specific source disclosure and measured layout; use a qualitative scene.");
          else validateChart(beat.visual.chart, `beats[${index}].visual.chart`, beat);
        }
        if (!Array.isArray(beat.visual.items) || beat.visual.items.length < 2 || beat.visual.items.length > 5) {
          add("invalid-diagram-items", `beats[${index}].visual.items`, "A generic scene needs 2–5 specific, meaningful diagram labels.");
        } else for (const [itemIndex, label] of beat.visual.items.entries()) {
          if (!string(label) || label.length > 44 || /[\r\n\u0000-\u001f]/.test(label)) {
            add("invalid-diagram-item", `beats[${index}].visual.items[${itemIndex}]`, "Diagram labels must be one safe line of at most 44 characters.");
          }
        }
      }
    }
    if (family === "general-explainer-v1" && !has(beat, "visual")) add("missing-general-visual", `beats[${index}].visual`, "Generic scenes require authored visual copy and diagram labels.");
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
  if (family === "general-explainer-v1" && beats.length > 0 && (beats.at(-1)?.visualIntent !== "general-payoff" ||
    !beats.at(-1)?.eventIds?.includes(input.topic?.payoffEventId) || beats.slice(0, -1).some((beat) => beat.eventIds?.includes(input.topic?.payoffEventId)))) {
    add("invalid-payoff-scene", "beats", "The final generic beat must own the payoff event and use general-payoff.");
  }
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

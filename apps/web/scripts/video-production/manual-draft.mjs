/** Human-authored general video drafts. No model call, invented source, or hidden scene expansion. */
import { createHash } from "node:crypto";
import { parseVideoProductionJob } from "./job.mjs";

const fail = (message) => { throw new Error(`Manual video draft invalid: ${message}`); };
const intents = new Set(["general-flow", "general-comparison", "general-breakdown"]);
const hooks = new Set(["action-first", "unexpected-reveal", "transformation"]);
const typeStyles = new Set(["snap", "overshoot", "wipe"]);
function line(value, field, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\r\n\u0000-\u001f]/.test(value)) {
    fail(`${field} must be a single line of 1–${limit} characters.`);
  }
  return value.trim();
}
function narration(value, field) {
  if (typeof value !== "string" || value.trim().length < 20 || value.length > 1600 || /[\u0000-\u0008\u000e-\u001f]/.test(value)) {
    fail(`${field} must be 20–1,600 characters of narration.`);
  }
  return value.trim();
}
/** @returns {import('./job.mjs').ParsedJob} */
export function createManualVideoDraft(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("A story is required.");
  const title = line(input.title, "Title", 180);
  const question = line(input.viewerQuestion || input.title, "Viewer question", 240);
  const audience = line(input.audience || "General audience", "Audience", 160);
  const locale = input.locale;
  if (!["en-US", "ja-JP"].includes(locale)) fail("Narration must use English or Japanese.");
  const episodeLength = input.length === "youtube-long" ? "youtube-long" : "smoke";
  const platform = input.platform ?? "youtube";
  if (!["youtube", "youtube-shorts", "instagram-reels", "tiktok"].includes(platform)) fail("Choose a supported landscape or portrait platform.");
  if (episodeLength === "youtube-long" && platform !== "youtube") fail("Long videos require the YouTube landscape output.");
  const scenes = input.scenes;
  if (!Array.isArray(scenes) || scenes.length < 3 || scenes.length > 40) fail("Write 3–40 scenes, including an opening and a final answer.");
  if (episodeLength === "youtube-long" && scenes.length < 10) fail("Long videos require at least 10 authored scenes.");
  const hookStrategy = input.hookStrategy ?? "action-first";
  const typographyStyle = input.typographyStyle ?? "snap";
  if (!hooks.has(hookStrategy) || !typeStyles.has(typographyStyle)) fail("Select a supported Kumiki hook and typography treatment.");
  const normalized = scenes.map((scene, index) => {
    const last = index === scenes.length - 1;
    const intent = index === 0 ? "general-intro" : last ? "general-payoff" : scene.intent;
    if (index !== 0 && !last && !intents.has(intent)) fail(`Scene ${index + 1} needs a supported visual intent.`);
    const items = scene.items;
    if (!Array.isArray(items) || items.length < 2 || items.length > 5) fail(`Scene ${index + 1} must have 2–5 visual labels.`);
    return {
      id: `beat-${String(index + 1).padStart(2, "0")}`,
      narration: narration(scene.narration, `Scene ${index + 1} narration`),
      visualIntent: intent,
      visual: {
        headline: line(scene.headline, `Scene ${index + 1} headline`, 68),
        subhead: line(scene.subhead || question, `Scene ${index + 1} supporting text`, 115),
        emphasis: line(scene.emphasis || (index === 0 ? "THE HOOK" : last ? "THE ANSWER" : "HOW IT WORKS"), `Scene ${index + 1} eyebrow`, 28),
        items: items.map((item, itemIndex) => line(item, `Scene ${index + 1} label ${itemIndex + 1}`, 44)),
        typographyStyle,
        ...(index === 0 ? { hookStrategy } : {}),
      },
      claimRefs: ["editorial-claims-unverified"],
      eventIds: last ? ["topic-payoff"] : [],
      pauseAfterMs: last ? 0 : 160,
    };
  });
  const draftId = createHash("sha256").update(JSON.stringify({ title, question, audience, locale, platform, normalized })).digest("hex").slice(0, 16);
  const job = {
    schemaVersion: 1, kind: "video-production-job", visualFamily: "general-explainer-v1",
    id: `manual-${draftId}`, mode: episodeLength, locale, approval: "test-only",
    topic: { title, viewerQuestion: question, payoffEventId: "topic-payoff" },
    references: { brandKit: { id: "manual_general", revision: 1 }, storyboard: { id: `manual_${draftId}`, revision: 1 }, selectedPackagingId: "manual" },
    destination: { presetId: platform, width: platform === "youtube" ? 1920 : 1080, height: platform === "youtube" ? 1080 : 1920, fps: { num: 30, den: 1 },
      targetDurationSeconds: episodeLength === "youtube-long" ? [480, 1800] : platform === "youtube" ? [20, 360] : [20, 180],
      minimumDurationSeconds: episodeLength === "smoke" ? null : 480 },
    voice: { profileId: "general-manual-narrator", provider: "fish", modelId: "s2.1-pro-free",
      voiceId: "configure-a-licensed-reference", locale, licenseStatus: "unknown" },
    policy: { commercialRightsVerified: false, reviewerApproved: false, maxCostUsd: 0 },
    claims: [{ id: "editorial-claims-unverified", status: "unverified",
      text: "Human-authored draft. All factual statements and sources require independent review." }],
    beats: normalized, events: [{ id: "topic-payoff", beatId: normalized.at(-1).id }],
    sounds: [{ id: "topic-payoff-chime", eventId: "topic-payoff",
      category: "answer.reveal", assetRef: "self-authored-test-chime", licenseStatus: "test-only" }],
  };
  const result = parseVideoProductionJob(job);
  if (!result.ok) fail(`Job validation rejected ${result.findings.filter(f => f.severity === "error").map(f => f.code).join(", ")}`);
  return { schemaVersion: 1, kind: "topic-video-draft", editorialStatus: "unverified-draft",
    generator: { provider: "human", promptVersion: "manual-storyboard-v1" },
    packaging: [], narrationLength: { unit: "scenes", count: scenes.length }, job,
    warnings: ["All factual claims must be verified before publication.", "Voice and SFX commercial rights not approved."] };
}

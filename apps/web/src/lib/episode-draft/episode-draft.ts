/** Versioned editorial handoff between separate content authoring tools.
 * This is NOT a second graphics, motion, or storyboard schema.
 */
import { VIDEO_PLATFORM_PRESETS } from "@/components/video/platform-presets";
import type { VideoPlatformPresetId } from "@/components/video/platform-presets";

export type RevisionRef = { id: string; revision: number };
export type ReviewStatus = "pending" | "approved" | "changes-requested";
export type ClaimStatus = "verified" | "needs-verification" | "disputed";

export interface EpisodeDraft {
  schemaVersion: 1;
  kind: "episode-draft";
  id: string;
  projectId: string;
  revision: number;
  locale: "en-US" | "ja-JP";
  status: "draft" | "in-review" | "approved";
  topic: {
    subject: string;
    viewerQuestion: string;
    answerPromise: string;
    payoffEventId: string;
    claimRefs: string[];
  };
  brandRef: RevisionRef | null;
  packaging: Array<{
    id: string;
    title: string;
    thumbnailRef: RevisionRef | null;
    hook: { narration: string; payoffEventId: string };
  }>;
  selectedPackagingId: string | null;
  /** Stable reference to Kumiki/ContentGen storyboard authoring output. */
  storyboard: {
    ref: RevisionRef;
    openingBeatId: string;
    payoffEventIds: string[];
    claimRefs: string[];
  } | null;
  evidence: Array<{ id: string; status: ClaimStatus; sourceRefs: string[] }>;
  delivery: Array<{
    presetId: VideoPlatformPresetId;
    layoutIntent: string;
    status: "not-authored" | "authored";
    authoredSceneRef: RevisionRef | null;
  }>;
  approvals: { editorial: ReviewStatus; rights: ReviewStatus; visual: ReviewStatus };
}

export interface Finding {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}
export type ReadResult =
  | { ok: true; draft: EpisodeDraft; findings: Finding[] }
  | { ok: false; findings: Finding[] };
export type SaveResult =
  | { ok: true; json: string; findings: Finding[] }
  | { ok: false; findings: Finding[] };

const PRESETS = new Set<string>(VIDEO_PLATFORM_PRESETS.map((item) => item.id));
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const revision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const hasError = (findings: readonly Finding[]): boolean =>
  findings.some((finding) => finding.severity === "error");

export function validateEpisodeDraft(input: unknown): Finding[] {
  const findings: Finding[] = [];
  function add(severity: Finding["severity"], code: string, path: string, message: string): void {
    findings.push({ severity, code, path, message });
  }
  function required(value: unknown, path: string): void {
    if (!text(value)) add("error", "required-text", path, "A nonempty value is required.");
  }
  function ref(value: unknown, path: string, nullable = false): void {
    if (nullable && value === null) return;
    if (!isObject(value)) {
      add("error", "invalid-reference", path, "Expected a versioned document reference.");
      return;
    }
    required(value.id, path + ".id");
    if (!revision(value.revision)) add("error", "invalid-revision", path + ".revision", "Revision must be a positive integer.");
  }
  function list(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
      add("error", "invalid-list", path, "Expected an array.");
      return [];
    }
    return value;
  }
  function refs(value: unknown, path: string): string[] {
    const elements = list(value, path);
    elements.forEach((item, index) => required(item, path + "[" + index + "]"));
    const names = elements.filter(text) as string[];
    if (new Set(names).size !== names.length) add("error", "duplicate-id", path, "IDs must be unique.");
    return names;
  }

  if (!isObject(input)) {
    add("error", "invalid-document", "$", "Expected an object.");
    return findings;
  }
  if (input.schemaVersion !== 1 || input.kind !== "episode-draft") add("error", "unsupported-schema", "$", "Requires episode-draft schemaVersion 1.");
  required(input.id, "id");
  required(input.projectId, "projectId");
  if (!revision(input.revision)) add("error", "invalid-revision", "revision", "Revision must be a positive integer.");
  if (input.locale !== "en-US" && input.locale !== "ja-JP") add("error", "unsupported-locale", "locale", "Only en-US and ja-JP are currently supported.");
  if (!["draft", "in-review", "approved"].includes(String(input.status))) add("error", "invalid-status", "status", "Invalid draft status.");

  const topic = input.topic;
  if (!isObject(topic)) add("error", "invalid-topic", "topic", "Expected a topic and viewer promise.");
  else {
    required(topic.subject, "topic.subject");
    required(topic.viewerQuestion, "topic.viewerQuestion");
    required(topic.answerPromise, "topic.answerPromise");
    required(topic.payoffEventId, "topic.payoffEventId");
    refs(topic.claimRefs, "topic.claimRefs");
  }
  ref(input.brandRef, "brandRef", true);

  const packages = list(input.packaging, "packaging");
  const packageIds: string[] = [];
  packages.forEach((item, i) => {
    const path = "packaging[" + i + "]";
    if (!isObject(item)) {
      add("error", "invalid-package", path, "Expected a packaging concept.");
      return;
    }
    required(item.id, path + ".id");
    if (text(item.id)) packageIds.push(item.id);
    required(item.title, path + ".title");
    ref(item.thumbnailRef, path + ".thumbnailRef", true);
    if (!isObject(item.hook)) add("error", "invalid-hook", path + ".hook", "Hook is required.");
    else {
      required(item.hook.narration, path + ".hook.narration");
      required(item.hook.payoffEventId, path + ".hook.payoffEventId");
      if (isObject(topic) && text(topic.payoffEventId) && text(item.hook.payoffEventId)
        && item.hook.payoffEventId !== topic.payoffEventId) {
        add("error", "promise-drift", path + ".hook.payoffEventId", "All concepts must resolve the same viewer promise.");
      }
    }
  });
  if (new Set(packageIds).size !== packageIds.length) add("error", "duplicate-id", "packaging", "Packaging IDs must be unique.");
  if (input.selectedPackagingId !== null && !text(input.selectedPackagingId)) {
    add("error", "invalid-selection", "selectedPackagingId", "Choose a package ID or null.");
  } else if (text(input.selectedPackagingId) && !packageIds.includes(input.selectedPackagingId)) {
    add("error", "unresolved-selection", "selectedPackagingId", "Selected concept does not exist.");
  }

  if (input.storyboard !== null) {
    if (!isObject(input.storyboard)) add("error", "invalid-storyboard", "storyboard", "Expected a storyboard handoff or null.");
    else {
      ref(input.storyboard.ref, "storyboard.ref");
      required(input.storyboard.openingBeatId, "storyboard.openingBeatId");
      refs(input.storyboard.payoffEventIds, "storyboard.payoffEventIds");
      refs(input.storyboard.claimRefs, "storyboard.claimRefs");
    }
  }

  const claimIds: string[] = [];
  list(input.evidence, "evidence").forEach((item, i) => {
    const path = "evidence[" + i + "]";
    if (!isObject(item)) {
      add("error", "invalid-claim", path, "Expected an evidence claim.");
      return;
    }
    required(item.id, path + ".id");
    if (text(item.id)) claimIds.push(item.id);
    if (!["verified", "needs-verification", "disputed"].includes(String(item.status))) {
      add("error", "invalid-claim-status", path + ".status", "Unknown claim status.");
    }
    const sourceIds = refs(item.sourceRefs, path + ".sourceRefs");
    if (item.status === "verified" && sourceIds.length === 0) {
      add("error", "verified-without-source", path + ".sourceRefs", "Verified claims require source references.");
    }
  });
  if (new Set(claimIds).size !== claimIds.length) add("error", "duplicate-id", "evidence", "Claim IDs must be unique.");

  const presetIds: string[] = [];
  list(input.delivery, "delivery").forEach((item, i) => {
    const path = "delivery[" + i + "]";
    if (!isObject(item)) {
      add("error", "invalid-delivery", path, "Expected a delivery intent.");
      return;
    }
    if (!text(item.presetId) || !PRESETS.has(item.presetId)) {
      add("error", "unknown-preset", path + ".presetId", "Choose a supported Kumiki platform preset.");
    } else presetIds.push(item.presetId);
    required(item.layoutIntent, path + ".layoutIntent");
    if (item.status !== "not-authored" && item.status !== "authored") {
      add("error", "invalid-delivery-status", path + ".status", "Invalid delivery state.");
    }
    ref(item.authoredSceneRef, path + ".authoredSceneRef", true);
    if (item.status === "authored" && item.authoredSceneRef === null) {
      add("error", "missing-scene", path + ".authoredSceneRef", "An authored profile needs its own scene revision.");
    }
    if (item.status === "not-authored" && item.authoredSceneRef !== null) {
      add("error", "inconsistent-scene", path + ".authoredSceneRef", "Do not claim an un-authored profile has a scene.");
    }
  });
  if (new Set(presetIds).size !== presetIds.length) add("error", "duplicate-preset", "delivery", "Output profile IDs must be unique.");

  if (!isObject(input.approvals)) add("error", "invalid-approvals", "approvals", "Review decisions are required.");
  else for (const key of ["editorial", "rights", "visual"] as const) {
    if (!["pending", "approved", "changes-requested"].includes(String(input.approvals[key]))) {
      add("error", "invalid-approval", "approvals." + key, "Invalid review state.");
    }
  }

  // Only access typed values once the document has passed structural checks.
  if (hasError(findings)) return findings;
  const draft = input as unknown as EpisodeDraft;
  if (!draft.brandRef) add("warning", "brand-missing", "brandRef", "Link a pinned approved brand revision.");
  if (!draft.selectedPackagingId) add("warning", "select-package", "selectedPackagingId", "Select one concept before review.");
  else if (!draft.packaging.find((item) => item.id === draft.selectedPackagingId)?.thumbnailRef) {
    add("warning", "thumbnail-missing", "selectedPackagingId", "Link an authored thumbnail revision.");
  }
  if (!draft.storyboard) add("warning", "storyboard-missing", "storyboard", "Link an authored storyboard revision.");
  else {
    if (!draft.storyboard.payoffEventIds.includes(draft.topic.payoffEventId)) {
      add("error", "payoff-missing", "storyboard.payoffEventIds", "The storyboard never reveals the promised payoff.");
    }
    for (const id of draft.storyboard.claimRefs) if (!draft.topic.claimRefs.includes(id)) {
      add("error", "storyboard-claim-drift", "storyboard.claimRefs", "A storyboard claim is outside the topic promise: " + id);
    }
  }
  const states = new Map(draft.evidence.map((claim) => [claim.id, claim.status]));
  for (const id of draft.topic.claimRefs) {
    if (!states.has(id)) add("error", "unknown-claim", "topic.claimRefs", "Missing evidence record: " + id);
    else if (states.get(id) !== "verified") add("warning", "unverified-claim", "evidence", "Claim not verified: " + id);
  }
  if (draft.delivery.length === 0) add("warning", "delivery-missing", "delivery", "Choose an output profile.");
  else if (draft.delivery.some((intent) => intent.status !== "authored")) {
    add("warning", "layout-not-authored", "delivery", "Output layouts must be authored for their individual aspect ratios.");
  }
  if (draft.status === "approved") {
    // Publishing approval cannot silently override any outstanding warning.
    for (const finding of [...findings]) if (finding.severity === "warning") {
      add("error", "approval-blocked", finding.path, "Cannot approve: " + finding.message);
    }
    for (const key of ["editorial", "rights", "visual"] as const) {
      if (draft.approvals[key] !== "approved") {
        add("error", "review-incomplete", "approvals." + key, "Explicit approval is required.");
      }
    }
    if (draft.packaging.length === 0) add("error", "packaging-missing", "packaging", "Approval requires a thumbnail concept.");
    if (draft.evidence.some((claim) => claim.status !== "verified")) {
      add("error", "evidence-review-incomplete", "evidence", "All included evidence claims must be verified.");
    }
  }
  return findings;
}

export function readEpisodeDraft(json: string): ReadResult {
  let value: unknown;
  try { value = JSON.parse(json) as unknown; }
  catch {
    return { ok: false, findings: [{ severity: "error", code: "invalid-json", path: "$", message: "Invalid JSON; no changes were applied." }] };
  }
  const findings = validateEpisodeDraft(value);
  return hasError(findings)
    ? { ok: false, findings }
    : { ok: true, draft: value as EpisodeDraft, findings };
}

/** Canonical key ordering for reproducible snapshots and clean JSON diffs. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
  return result;
}
export function serializeEpisodeDraft(draft: EpisodeDraft): SaveResult {
  const findings = validateEpisodeDraft(draft);
  return hasError(findings)
    ? { ok: false, findings }
    : { ok: true, json: JSON.stringify(canonical(draft), null, 2) + "\n", findings };
}

/** Switching an approved package invalidates the editorial and visual reviews. */
export function choosePackaging(draft: EpisodeDraft, id: string): EpisodeDraft | null {
  if (!draft.packaging.some((option) => option.id === id)) return null;
  if (draft.selectedPackagingId === id) return draft;
  return {
    ...draft, selectedPackagingId: id, revision: draft.revision + 1, status: "draft",
    approvals: { ...draft.approvals, editorial: "pending", visual: "pending" },
  };
}

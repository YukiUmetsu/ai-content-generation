/** Original editorial development seeded by an author-entered niche query.
 * Public YouTube API observations must never be transformed into rankings,
 * scores, inferred trends or generated claims by this module.
 */
import { DEFAULT_FPS, STORYBOARD_KIND, STORYBOARD_SCHEMA_VERSION, type Locale, type SemanticStoryboard, type StoryboardBeat } from "@/features/storyboard-planner/model/types";

export interface EditorialInput {
  topic: string;
  audience: string;
  viewerQuestion: string;
  payoff: string;
  reviewNotes: string;
  /** Optional creator-selected reference URL, explicitly NOT evidence. */
  inspirationUrl: string;
  /** Up to five creator-selected URLs; persisted without provider metrics. */
  inspirationUrls: string[];
}

export interface EditorialApproach {
  id: "direct" | "process" | "comparison";
  strategy: string;
  title: string;
  hook: string;
  firstVisual: string;
  onScreenText: string;
  thumbnail: string;
  sfxIntent: string;
  payoffConnection: string;
}

export interface EditorialDraft {
  version: 1;
  input: EditorialInput;
  approaches: EditorialApproach[];
  selectedId: EditorialApproach["id"];
}

export const EDITORIAL_STORAGE_PREFIX = "contentgen:editorial-brief:v1:";
const MAX_DRAFT_BYTES = 28 * 1024;
const KEY = /^[a-z0-9][a-z0-9-]{1,79}$/i;
const APPROACH_IDS = ["direct", "process", "comparison"] as const;

const bounded = (value: unknown, label: string, max: number, min = 0): string => {
  if (typeof value !== "string" || value.trim().length < min || value.length > max || [...value].some(char => {
    const cp = char.codePointAt(0)!;
    return cp <= 8 || (cp >= 14 && cp <= 31);
  })) {
    throw new Error(`${label} must be ${min}–${max} safe characters.`);
  }
  return value.trim();
};
const exact = (candidate: unknown, fields: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw Error(`Invalid ${label}.`);
  const raw = candidate as Record<string, unknown>;
  if (Object.keys(raw).some(field => !fields.includes(field) && !optional.includes(field)) || fields.some(field => !(field in raw))) throw Error(`Unexpected or missing ${label} fields.`);
  return raw;
};
const urlOrEmpty = (value: unknown): string => {
  const raw = bounded(value, "Inspiration URL", 300);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com", "youtu.be"].includes(url.hostname) || url.username || url.password) throw Error("Not YouTube");
    return url.href;
  } catch { throw Error("Inspiration reference must be an HTTPS YouTube link."); }
};

export function validateEditorialInput(candidate: unknown): EditorialInput {
  const data = exact(candidate, ["topic", "audience", "viewerQuestion", "payoff", "reviewNotes", "inspirationUrl"], "editorial input", ["inspirationUrls"]);
  if (data.inspirationUrls !== undefined && (!Array.isArray(data.inspirationUrls) || data.inspirationUrls.length > 5)) {
    throw Error("Select a maximum of five inspiration links.");
  }
  const links = data.inspirationUrls === undefined ? [] : (data.inspirationUrls as unknown[]).map(urlOrEmpty);
  return {
    topic: bounded(data.topic, "Topic", 160, 3),
    audience: bounded(data.audience, "Audience", 120, 3),
    viewerQuestion: bounded(data.viewerQuestion, "Viewer question", 200, 3),
    payoff: bounded(data.payoff, "Payoff", 320, 3),
    reviewNotes: bounded(data.reviewNotes, "Review notes", 1800),
    inspirationUrl: urlOrEmpty(data.inspirationUrl),
    inspirationUrls: [...new Set(links.filter(Boolean))],
  };
}

export function starterApproaches(input: EditorialInput): EditorialApproach[] {
  const { topic, audience, viewerQuestion, payoff } = validateEditorialInput(input);
  const screen = Array.from(viewerQuestion).slice(0, 62).join("");
  return [
    { id: "direct", strategy: "Audience-first problem", title: `${topic}: What You Need to Know`.slice(0, 120),
      hook: `If you're ${audience}, here's the question worth answering: ${viewerQuestion}`,
      firstVisual: `Start with a familiar ${topic} decision. Reveal the hidden part of the question one piece at a time; keep the answer out of view.`,
      onScreenText: screen, thumbnail: `One clear ${topic} decision, with the missing piece concealed.`,
      sfxIntent: "Subtle reveal accent when the unresolved question appears.", payoffConnection: payoff },
    { id: "process", strategy: "Mechanism reveal", title: `How ${topic} Actually Works`.slice(0, 120),
      hook: `For ${audience}, the useful part is understanding the process. ${viewerQuestion}`,
      firstVisual: `Animate a ${topic} sequence, progressively revealing each step while the final step remains hidden.`,
      onScreenText: screen, thumbnail: `A simple ${topic} process with its final stage obscured.`,
      sfxIntent: "Soft ticks only on meaningful step changes.", payoffConnection: payoff },
    { id: "comparison", strategy: "Decision comparison", title: `${topic}: What Changes the Decision?`.slice(0, 120),
      hook: `If you're ${audience}, compare the options before deciding. ${viewerQuestion}`,
      firstVisual: `Split the screen into two ${topic} decision paths; reveal one factor at a time, not a premature winner.`,
      onScreenText: screen, thumbnail: `Two readable ${topic} paths and one unresolved decision factor.`,
      sfxIntent: "Optional quiet accent on each comparison state change.", payoffConnection: payoff },
  ];
}

export function createDraft(topic: string): EditorialDraft {
  const original = bounded(topic, "Niche query", 160, 3);
  const input: EditorialInput = {
    topic: original,
    audience: "people exploring this topic",
    viewerQuestion: `What should I understand about ${original}?`.slice(0, 200),
    payoff: `Explain the important parts of ${original}, including what still needs verification.`.slice(0, 320),
    reviewNotes: "", inspirationUrl: "", inspirationUrls: [],
  };
  return { version: 1, input, approaches: starterApproaches(input), selectedId: "direct" };
}

export function validateEditorialDraft(candidate: unknown): EditorialDraft {
  const data = exact(candidate, ["version", "input", "approaches", "selectedId"], "editorial draft");
  if (data.version !== 1) throw Error("Unsupported editorial draft version.");
  const input = validateEditorialInput(data.input);
  if (!Array.isArray(data.approaches) || data.approaches.length !== 3) throw Error("Draft needs three approaches.");
  const approaches = data.approaches.map((value, index): EditorialApproach => {
    const fields = ["id", "strategy", "title", "hook", "firstVisual", "onScreenText", "thumbnail", "sfxIntent", "payoffConnection"];
    const raw = exact(value, fields, `approach ${index + 1}`);
    if (raw.id !== APPROACH_IDS[index]) throw Error("Approach IDs must be distinct and stable.");
    return {
      id: APPROACH_IDS[index], strategy: bounded(raw.strategy, "Strategy", 60, 3),
      title: bounded(raw.title, "Title", 120, 3), hook: bounded(raw.hook, "Hook", 420, 3),
      firstVisual: bounded(raw.firstVisual, "Opening visual", 560, 3),
      onScreenText: bounded(raw.onScreenText, "On-screen text", 64, 1),
      thumbnail: bounded(raw.thumbnail, "Thumbnail", 400, 3),
      sfxIntent: bounded(raw.sfxIntent, "Sound intent", 200),
      payoffConnection: bounded(raw.payoffConnection, "Payoff connection", 320, 3),
    };
  });
  if (!APPROACH_IDS.includes(data.selectedId as EditorialApproach["id"])) throw Error("Invalid selected approach.");
  return { version: 1, input, approaches, selectedId: data.selectedId as EditorialApproach["id"] };
}

function storageKey(watchlistId: string): string {
  if (!KEY.test(watchlistId)) throw Error("Invalid niche ID.");
  return EDITORIAL_STORAGE_PREFIX + watchlistId;
}

export function persistEditorialDraft(watchlistId: string, candidate: EditorialDraft): void {
  const draft = validateEditorialDraft(candidate);
  const text = JSON.stringify(draft);
  if (new TextEncoder().encode(text).length > MAX_DRAFT_BYTES) throw Error("Editorial brief is too large to save locally.");
  localStorage.setItem(storageKey(watchlistId), text);
}

export function loadEditorialDraft(watchlistId: string, query: string): {draft: EditorialDraft; warning: string | null} {
  const fallback = createDraft(query);
  try {
    const raw = localStorage.getItem(storageKey(watchlistId));
    if (!raw) return { draft: fallback, warning: null };
    if (new TextEncoder().encode(raw).length > MAX_DRAFT_BYTES) throw Error("Draft exceeds local storage limit.");
    return { draft: validateEditorialDraft(JSON.parse(raw) as unknown), warning: null };
  } catch (error) {
    return { draft: fallback, warning: `Stored editorial brief is invalid: ${error instanceof Error ? error.message : "unknown error"}. It was not overwritten.` };
  }
}

export function draftToStoryboard(candidate: EditorialDraft, projectId: string, locale: Locale): SemanticStoryboard {
  if (!KEY.test(projectId)) throw Error("Invalid video project ID.");
  const draft = validateEditorialDraft(candidate);
  const { topic, audience, viewerQuestion, payoff, reviewNotes, inspirationUrl, inspirationUrls } = draft.input;
  const approach = draft.approaches.find(a => a.id === draft.selectedId)!;
  const claimRefs = ["claim-editorial-review"];
  const beat = (id: string, role: StoryboardBeat["role"], narration: string, visualIntent: StoryboardBeat["visualIntent"],
    objective: string, visualObjective: string, onScreenText: string, focusTarget: string, durationFrames: number): StoryboardBeat => ({
    id, role, objective, narration, onScreenText: Array.from(onScreenText).slice(0, 64).join(""),
    visualIntent, visualObjective, semanticObjects: [focusTarget], focusTarget, durationFrames,
    claimRefs: role === "evidence" ? claimRefs : [], namedEvents: [],
    staticFallback: `Still: ${onScreenText}. ${objective}`,
  });
  const opening = beat("beat-hook", "hook", approach.hook, "question", `Give ${audience} an immediately relevant question.`,
    approach.firstVisual, approach.onScreenText, "viewer-question", 270);
  opening.opensQuestion = "question-main";
  opening.namedEvents = ["event-question-opens"];
  opening.cameraIntent = "Track the revealed question, keep the answer outside the frame until the final beat.";
  const setup = beat("beat-setup", "setup", `First, let's define what matters when looking at ${topic}.`, "explanation",
    "Clarify the decision and define the terms without inventing facts.", "Reveal a simple labeled topic diagram, leaving an unresolved area visible.",
    topic, "subject", 240);
  const mechanics = beat("beat-mechanism", "explanation", `Next, break the question into the parts we need to investigate.`, "comparison",
    "Show how the parts of the question connect before reaching a conclusion.",
    "Move two labeled parts into view separately; show their relationship without asserting a winner.",
    "What needs comparison?", "decision-parts", 240);
  const evidence = beat("beat-evidence", "evidence", "Before concluding, check the relevant evidence and where the answer might change.", "evidence",
    "Mark open factual questions for source verification; do not depict observations as proven facts.",
    "Reveal the evidence checklist and clearly label each pending item as unverified.",
    "Evidence to verify", "review-checklist", 270);
  const end = beat("beat-payoff", "takeaway", approach.payoffConnection, "takeaway",
    `Answer the viewer question with the creator's planned, still-unverified takeaway: ${payoff}`,
    "Transform the unresolved question into the planned answer, then visibly show its verification caveat.",
    payoff, "planned-payoff", 330);
  end.answersQuestion = "question-main";
  end.namedEvents = ["event-answer-reveals"];
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION, kind: STORYBOARD_KIND, id: `storyboard-${projectId}`,
    title: approach.title, locale, fps: {...DEFAULT_FPS}, illustrativeData: false,
    questions: [{id:"question-main",text:viewerQuestion}],
    claims: [{id:"claim-editorial-review",status:"unverified",note:reviewNotes || "Fact-check all material claims before publication.",sourceRefs:[]}],
    semanticObjects: [
      {id:"viewer-question",label:viewerQuestion}, {id:"subject",label:topic},
      {id:"decision-parts",label:"Unverified decision factors"}, {id:"review-checklist",label:"Evidence to verify"},
      {id:"planned-payoff",label:payoff},
    ],
    semanticEvents: [
      {id:"event-question-opens",label:"The specific curiosity question is partially revealed",objectId:"viewer-question"},
      {id:"event-answer-reveals",label:"The planned answer is revealed with its evidence caveat",objectId:"planned-payoff"},
    ],
    beats: [opening, setup, mechanics, evidence, end],
    assumptions: [
      "Unverified editorial outline. No claims have been independently fact-checked or approved for publication.",
      `Audience: ${audience}. Intended answer: ${payoff}`,
      `Thumbnail concept: ${approach.thumbnail}. Sound intent: ${approach.sfxIntent || "None"}.`,
      ...[...new Set([inspirationUrl,...inspirationUrls].filter(Boolean))].map(url => `Public video provided for inspiration only, NOT evidence: ${url}`),
      ...(reviewNotes ? [`Creator review notes (unverified): ${reviewNotes}`] : []),
    ],
  };
}

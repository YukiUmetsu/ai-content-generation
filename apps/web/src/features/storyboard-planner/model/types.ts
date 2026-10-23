/**
 * ContentGen semantic storyboard — authoring model.
 *
 * This is deliberately *not* a Kumiki composition or keyframe format. It is the
 * compact, human-editable layer that a later adapter compiles into Kumiki's
 * implemented `Storyboard` / `StoryboardShot` contract. Time is integer frames
 * at a rational FPS and every range is end-exclusive.
 */

export type Locale = "en" | "ja";

export const NARRATIVE_ROLES = [
  "hook",
  "setup",
  "explanation",
  "evidence",
  "reveal",
  "takeaway",
] as const;
export type NarrativeRole = (typeof NARRATIVE_ROLES)[number];

export const VISUAL_INTENTS = [
  "question",
  "cost-accumulation",
  "comparison",
  "explanation",
  "evidence",
  "takeaway",
] as const;
export type VisualIntent = (typeof VISUAL_INTENTS)[number];

export const CLAIM_STATUSES = ["illustrative", "sourced", "assumption", "unverified"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface RationalFps {
  num: number;
  den: number;
}

export interface StoryboardClaim {
  id: string;
  status: ClaimStatus;
  /** Short provenance / qualification note shown in the editor and export. */
  note: string;
  /** Source identifiers; required by convention for `sourced` claims. */
  sourceRefs: string[];
}

export interface SemanticObject {
  id: string;
  label: string;
}

export interface SemanticEvent {
  id: string;
  label: string;
  /** The durable object whose state this event changes. */
  objectId: string;
}

export interface StoryboardQuestion {
  id: string;
  text: string;
}

/** Reviewable concept transition, never an inferred measured value. */
export interface TeachingVisualState {
  phase: "problem" | "mechanism" | "payoff";
  subjectId: string;
  /** Stable ID shared by the problem, mechanism and payoff beats. */
  sequenceId?: string;
  before: string;
  action: string;
  after: string;
}

export function isTeachingVisualState(value: unknown): value is TeachingVisualState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const fields = ["phase", "subjectId", "sequenceId", "before", "action", "after"];
  if (![5,6].includes(Object.keys(state).length) || Object.keys(state).some(key => !fields.includes(key)) ||
    (state.sequenceId !== undefined &&
      (typeof state.sequenceId !== "string" || !/^[a-z][a-z0-9_-]{0,80}$/iu.test(state.sequenceId))) ||
    typeof state.phase !== "string" || !["problem", "mechanism", "payoff"].includes(state.phase) ||
    typeof state.subjectId !== "string" || !/^[a-z][a-z0-9_-]{0,80}$/iu.test(state.subjectId)) return false;
  const copy = [state.before, state.action, state.after];
  if (copy.some((text, i) => typeof text !== "string" || text.trim().length < 8 ||
    text.length > (i === 1 ? 90 : 48) || Array.from(text).some(char => char.charCodeAt(0) < 32))) return false;
  return new Set(copy.map(text => (text as string).trim().toLowerCase())).size === 3;
}

export interface StoryboardBeat {
  /** Stable, author-owned id. Reordering never changes it. */
  id: string;
  role: NarrativeRole;
  /** The one thing this moment teaches. Maps to Kumiki `claim`. */
  objective: string;
  narration: string;
  /** Concise on-screen copy, never a transcript of the narration. */
  onScreenText: string;
  visualIntent: VisualIntent;
  /** The observable change the viewer should see. */
  visualObjective: string;
  /** Stable semantic object ids referenced by this beat. */
  semanticObjects: string[];
  /** Stable semantic id the viewer should follow / the camera protects. */
  focusTarget: string;
  /** Integer frames. Authoritative for the timeline. */
  durationFrames: number;
  claimRefs: string[];
  narrationCueId?: string;
  cameraIntent?: string;
  /** Stable semantic event ids performed or referenced by this beat. */
  namedEvents: string[];
  /** Useful still / reduced-motion substitute. */
  staticFallback: string;
  /** Optional source-linked before/change/after authored with this technical subject. */
  teachingState?: TeachingVisualState;
  /** Question opened by this beat (must be declared in `questions`). */
  opensQuestion?: string;
  /** Question answered by this beat. */
  answersQuestion?: string;
}

export interface SemanticStoryboard {
  schemaVersion: 1;
  kind: "contentgen-semantic-storyboard";
  id: string;
  title: string;
  locale: Locale;
  fps: RationalFps;
  beats: StoryboardBeat[];
  questions: StoryboardQuestion[];
  claims: StoryboardClaim[];
  semanticObjects: SemanticObject[];
  semanticEvents: SemanticEvent[];
  /** Human-readable assumptions / caveats carried into the final film. */
  assumptions: string[];
  /** True when the example carries synthetic numbers that must be labelled. */
  illustrativeData: boolean;
}

export const STORYBOARD_SCHEMA_VERSION = 1;
export const STORYBOARD_KIND = "contentgen-semantic-storyboard";
export const DEFAULT_FPS: RationalFps = { num: 30, den: 1 };
/** Advisory readability budget for a single on-screen label. */
export const MAX_ON_SCREEN_CHARS = 64;

export function isNarrativeRole(value: unknown): value is NarrativeRole {
  return typeof value === "string" && (NARRATIVE_ROLES as readonly string[]).includes(value);
}

export function isVisualIntent(value: unknown): value is VisualIntent {
  return typeof value === "string" && (VISUAL_INTENTS as readonly string[]).includes(value);
}

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === "string" && (CLAIM_STATUSES as readonly string[]).includes(value);
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ja";
}

/** Clamp helper used by the editor when nudging a duration. */
export function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Plain deep clone for JSON-safe authoring documents. */
export function cloneStoryboard(board: SemanticStoryboard): SemanticStoryboard {
  return JSON.parse(JSON.stringify(board)) as SemanticStoryboard;
}

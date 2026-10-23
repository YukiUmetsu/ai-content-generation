/**
 * Deterministic, versioned JSON for the authoring model.
 *
 * Export sorts object keys recursively (arrays keep authored order) and always
 * ends with a newline. Import is strict about the schema/kind, enum values and
 * field types, strips unknown properties, and never evaluates input.
 */

import {
  CLAIM_STATUSES,
  DEFAULT_FPS,
  NARRATIVE_ROLES,
  STORYBOARD_KIND,
  STORYBOARD_SCHEMA_VERSION,
  VISUAL_INTENTS,
  isClaimStatus,
  isLocale,
  isNarrativeRole,
  isPositiveInteger,
  isVisualIntent,
  isTeachingVisualState,
  type SemanticEvent,
  type SemanticObject,
  type SemanticStoryboard,
  type StoryboardBeat,
  type StoryboardClaim,
  type StoryboardQuestion,
} from "./types";

export type ImportIssueCode =
  | "invalid-json"
  | "invalid-root"
  | "schema-version"
  | "kind"
  | "missing-field"
  | "invalid-field"
  | "beats-empty"
  | "duplicate-beat-id";

export interface ImportIssue {
  code: ImportIssueCode;
  path: string;
}

export type ParseResult =
  | { ok: true; board: SemanticStoryboard }
  | { ok: false; errors: ImportIssue[] };

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      output[key] = canonicalize(source[key]);
    }
    return output;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function serializeStoryboard(board: SemanticStoryboard): string {
  return canonicalJson(board);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Browser-local editing can briefly contain an empty state text field. */
function isEditableTeachingState(value: unknown): value is NonNullable<StoryboardBeat["teachingState"]> {
  if (!isRecord(value) || ![5,6].includes(Object.keys(value).length) ||
    Object.keys(value).some(key => !["phase", "subjectId", "sequenceId", "before", "action", "after"].includes(key)) ||
    (value.sequenceId !== undefined &&
      (typeof value.sequenceId !== "string" || !/^[a-z][a-z0-9_-]{0,80}$/iu.test(value.sequenceId)))) return false;
  return typeof value.phase === "string" && ["problem", "mechanism", "payoff"].includes(value.phase) &&
    typeof value.subjectId === "string" &&
    [value.before,value.action,value.after].every((x,i) => typeof x === "string" &&
      x.length <= (i === 1 ? 90 : 48));
}

function stringField(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: ImportIssue[],
  options: { optional?: boolean; nonEmpty?: boolean } = {}
): string | undefined {
  const value = source[key];
  if (value === undefined) {
    if (!options.optional) errors.push({ code: "missing-field", path: `${path}.${key}` });
    return undefined;
  }
  if (!isString(value)) {
    errors.push({ code: "invalid-field", path: `${path}.${key}` });
    return undefined;
  }
  if (options.nonEmpty && value.trim() === "") {
    errors.push({ code: "invalid-field", path: `${path}.${key}` });
    return undefined;
  }
  return value;
}

function parseBeat(
  value: unknown,
  index: number,
  errors: ImportIssue[],
  allowIncomplete: boolean
): StoryboardBeat | null {
  const path = `beats[${index}]`;
  if (!isRecord(value)) {
    errors.push({ code: "invalid-field", path });
    return null;
  }

  const id = stringField(value, "id", path, errors, { nonEmpty: true });
  const roleValue = value.role;
  if (!isNarrativeRole(roleValue)) {
    errors.push({ code: "invalid-field", path: `${path}.role` });
  }
  const role = isNarrativeRole(roleValue) ? roleValue : NARRATIVE_ROLES[0];
  const objective = stringField(value, "objective", path, errors) ?? "";
  const narration = stringField(value, "narration", path, errors) ?? "";
  const onScreenText = stringField(value, "onScreenText", path, errors) ?? "";
  const visualIntentValue = value.visualIntent;
  if (!isVisualIntent(visualIntentValue)) {
    errors.push({ code: "invalid-field", path: `${path}.visualIntent` });
  }
  const visualIntent = isVisualIntent(visualIntentValue) ? visualIntentValue : VISUAL_INTENTS[0];
  const visualObjective = stringField(value, "visualObjective", path, errors) ?? "";
  const focusTarget = stringField(value, "focusTarget", path, errors) ?? "";
  const staticFallback = stringField(value, "staticFallback", path, errors) ?? "";
  const durationFrames = value.durationFrames;
  // A draft can include a temporarily invalid number while the author edits.
  // Completed JSON imports still require a positive integer frame count.
  const validDuration = allowIncomplete
    ? typeof durationFrames === "number" && Number.isFinite(durationFrames)
    : isPositiveInteger(durationFrames);
  if (!validDuration) {
    errors.push({ code: "invalid-field", path: `${path}.durationFrames` });
  }
  if (!isStringArray(value.semanticObjects)) {
    errors.push({ code: "missing-field", path: `${path}.semanticObjects` });
  }
  if (!isStringArray(value.claimRefs)) {
    errors.push({ code: "missing-field", path: `${path}.claimRefs` });
  }
  if (!isStringArray(value.namedEvents)) {
    errors.push({ code: "missing-field", path: `${path}.namedEvents` });
  }

  const narrationCueId = stringField(value, "narrationCueId", path, errors, { optional: true });
  const cameraIntent = stringField(value, "cameraIntent", path, errors, { optional: true });
  const opensQuestion = stringField(value, "opensQuestion", path, errors, { optional: true });
  const answersQuestion = stringField(value, "answersQuestion", path, errors, { optional: true });
  const teachingState = value.teachingState;
  const validState = isTeachingVisualState(teachingState);
  const editableState = allowIncomplete && isEditableTeachingState(teachingState);
  if (teachingState !== undefined && !validState && !editableState)
    errors.push({ code: "invalid-field", path: `${path}.teachingState` });

  if (!id) return null;

  const beat: StoryboardBeat = {
    id,
    role,
    objective,
    narration,
    onScreenText,
    visualIntent,
    visualObjective,
    semanticObjects: isStringArray(value.semanticObjects) ? [...value.semanticObjects] : [],
    focusTarget,
    durationFrames: validDuration ? (durationFrames as number) : 0,
    claimRefs: isStringArray(value.claimRefs) ? [...value.claimRefs] : [],
    namedEvents: isStringArray(value.namedEvents) ? [...value.namedEvents] : [],
    staticFallback,
  };
  if (narrationCueId !== undefined) beat.narrationCueId = narrationCueId;
  if (cameraIntent !== undefined) beat.cameraIntent = cameraIntent;
  if (opensQuestion !== undefined) beat.opensQuestion = opensQuestion;
  if (answersQuestion !== undefined) beat.answersQuestion = answersQuestion;
  if (validState || editableState) beat.teachingState = { ...teachingState };
  return beat;
}

function parseQuestion(value: unknown, index: number, errors: ImportIssue[]): StoryboardQuestion | null {
  const path = `questions[${index}]`;
  if (!isRecord(value)) {
    errors.push({ code: "invalid-field", path });
    return null;
  }
  const id = stringField(value, "id", path, errors, { nonEmpty: true });
  const text = stringField(value, "text", path, errors, { nonEmpty: true });
  if (!id || !text) return null;
  return { id, text };
}

function parseClaim(value: unknown, index: number, errors: ImportIssue[]): StoryboardClaim | null {
  const path = `claims[${index}]`;
  if (!isRecord(value)) {
    errors.push({ code: "invalid-field", path });
    return null;
  }
  const id = stringField(value, "id", path, errors, { nonEmpty: true });
  const statusValue = value.status;
  if (!isClaimStatus(statusValue) || !(CLAIM_STATUSES as readonly string[]).includes(String(statusValue))) {
    errors.push({ code: "invalid-field", path: `${path}.status` });
  }
  const note = stringField(value, "note", path, errors) ?? "";
  if (!isStringArray(value.sourceRefs)) {
    errors.push({ code: "missing-field", path: `${path}.sourceRefs` });
  }
  if (!id) return null;
  return {
    id,
    status: isClaimStatus(statusValue) ? statusValue : "unverified",
    note,
    sourceRefs: isStringArray(value.sourceRefs) ? [...value.sourceRefs] : [],
  };
}

function parseObject(value: unknown, index: number, errors: ImportIssue[]): SemanticObject | null {
  const path = `semanticObjects[${index}]`;
  if (!isRecord(value)) {
    errors.push({ code: "invalid-field", path });
    return null;
  }
  const id = stringField(value, "id", path, errors, { nonEmpty: true });
  const label = stringField(value, "label", path, errors, { nonEmpty: true });
  if (!id || !label) return null;
  return { id, label };
}

function parseEvent(value: unknown, index: number, errors: ImportIssue[]): SemanticEvent | null {
  const path = `semanticEvents[${index}]`;
  if (!isRecord(value)) {
    errors.push({ code: "invalid-field", path });
    return null;
  }
  const id = stringField(value, "id", path, errors, { nonEmpty: true });
  const label = stringField(value, "label", path, errors, { nonEmpty: true });
  const objectId = stringField(value, "objectId", path, errors, { nonEmpty: true });
  if (!id || !label || !objectId) return null;
  return { id, label, objectId };
}

/**
 * Parse and normalize a semantic storyboard document. Structural problems are
 * returned as data; no exception escapes and no partial board is applied.
 */
function parseStoryboardDocument(text: string, allowIncomplete: boolean): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ code: "invalid-json", path: "$" }] };
  }
  if (!isRecord(raw)) {
    return { ok: false, errors: [{ code: "invalid-root", path: "$" }] };
  }

  const errors: ImportIssue[] = [];
  if (raw.schemaVersion !== STORYBOARD_SCHEMA_VERSION) {
    errors.push({ code: "schema-version", path: "schemaVersion" });
  }
  if (raw.kind !== STORYBOARD_KIND) {
    errors.push({ code: "kind", path: "kind" });
  }

  const id = stringField(raw, "id", "$", errors, { nonEmpty: true });
  const title = stringField(raw, "title", "$", errors, { nonEmpty: true });
  if (!isLocale(raw.locale)) errors.push({ code: "invalid-field", path: "locale" });

  let fps = { ...DEFAULT_FPS };
  if (!isRecord(raw.fps) || !isPositiveInteger(raw.fps.num) || !isPositiveInteger(raw.fps.den)) {
    errors.push({ code: "invalid-field", path: "fps" });
  } else {
    fps = { num: raw.fps.num, den: raw.fps.den };
  }

  if (!Array.isArray(raw.beats)) {
    errors.push({ code: "missing-field", path: "beats" });
  } else if (raw.beats.length === 0 && !allowIncomplete) {
    errors.push({ code: "beats-empty", path: "beats" });
  }

  const beatValues = Array.isArray(raw.beats) ? raw.beats : [];
  const beats: StoryboardBeat[] = [];
  const seenIds = new Set<string>();
  for (const [index, value] of beatValues.entries()) {
    const beat = parseBeat(value, index, errors, allowIncomplete);
    if (!beat) continue;
    if (seenIds.has(beat.id)) {
      errors.push({ code: "duplicate-beat-id", path: `beats[${index}].id` });
      continue;
    }
    seenIds.add(beat.id);
    beats.push(beat);
  }

  const questions: StoryboardQuestion[] = [];
  if (!Array.isArray(raw.questions)) {
    errors.push({ code: "missing-field", path: "questions" });
  } else {
    for (const [index, value] of raw.questions.entries()) {
      const question = parseQuestion(value, index, errors);
      if (question) questions.push(question);
    }
  }

  const claims: StoryboardClaim[] = [];
  if (!Array.isArray(raw.claims)) {
    errors.push({ code: "missing-field", path: "claims" });
  } else {
    for (const [index, value] of raw.claims.entries()) {
      const claim = parseClaim(value, index, errors);
      if (claim) claims.push(claim);
    }
  }

  const semanticObjects: SemanticObject[] = [];
  if (!Array.isArray(raw.semanticObjects)) {
    errors.push({ code: "missing-field", path: "semanticObjects" });
  } else {
    for (const [index, value] of raw.semanticObjects.entries()) {
      const object = parseObject(value, index, errors);
      if (object) semanticObjects.push(object);
    }
  }

  const semanticEvents: SemanticEvent[] = [];
  if (!Array.isArray(raw.semanticEvents)) {
    errors.push({ code: "missing-field", path: "semanticEvents" });
  } else {
    for (const [index, value] of raw.semanticEvents.entries()) {
      const event = parseEvent(value, index, errors);
      if (event) semanticEvents.push(event);
    }
  }

  if (!isStringArray(raw.assumptions)) {
    errors.push({ code: "missing-field", path: "assumptions" });
  }
  if (typeof raw.illustrativeData !== "boolean") {
    errors.push({ code: "missing-field", path: "illustrativeData" });
  }

  if (errors.length > 0 || !id || !title || !isLocale(raw.locale)) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    board: {
      schemaVersion: STORYBOARD_SCHEMA_VERSION,
      kind: STORYBOARD_KIND,
      id,
      title,
      locale: raw.locale,
      fps,
      beats,
      questions,
      claims,
      semanticObjects,
      semanticEvents,
      assumptions: isStringArray(raw.assumptions) ? [...raw.assumptions] : [],
      illustrativeData: typeof raw.illustrativeData === "boolean" ? raw.illustrativeData : false,
    },
  };
}

/** Strict completed-document import. Rejects empty beats and invalid durations. */
export function parseStoryboard(text: string): ParseResult {
  return parseStoryboardDocument(text, false);
}

/** Validated browser draft recovery, including incomplete authoring states. */
export function parseStoryboardDraft(text: string): ParseResult {
  return parseStoryboardDocument(text, true);
}

/** Versioned, per-output AI-written script drafts. Every accepted edit is retained; suggestions never replace text automatically. */
import {MAX_SCRIPT_SECTIONS,SCRIPT_ROLES,isScriptSectionId} from "../../scripts/video-production/script-contract.mjs";

export type ScriptPlatform = "youtube" | "youtube_shorts" | "tiktok" | "instagram" | "facebook" | "blog" | "website";
export type ScriptLocale = "en" | "ja";
export type ScriptRole = typeof SCRIPT_ROLES[number];
export interface ScriptEvidence {
  claimId: string;
  claimText: string;
  sourceId: string;
  sourceUrl: string;
  quote: string;
  /** Captured passage is not by itself an independent fact check. */
  reviewStatus: "verified" | "unverified" | "illustrative" | "disputed";
}

export function scriptEvidenceFingerprint(evidence: readonly ScriptEvidence[]): string {
  const raw = JSON.stringify(evidence.map(e => [e.claimId, e.claimText, e.sourceId,
    e.sourceUrl, e.quote, e.reviewStatus]));
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619) >>> 0;
  return `sources-${hash.toString(16)}`;
}
export interface ScriptReviewInput {
  productionId: string;
  projectId: string;
  platform: ScriptPlatform;
  locale: ScriptLocale;
  title: string;
  viewerQuestion: string;
  audience: string;
  angle: string;
  brandVoice: string;
  evidenceSnapshotId: string;
}
export interface ScriptGeneratedText {
  narration: string;
  claimRefs: string[];
  sourceRefs: string[];
}
export interface ScriptSectionHistory {
  revision: number;
  text: string;
  claimRefs: string[];
  sourceRefs: string[];
  origin: "ai" | "regenerated" | "manual" | "copied" | "restored";
  /** Provenance for an accepted short-form copy; platform-specific approval never transfers. */
  copiedFrom?: { platform: ScriptPlatform; revision: number };
  restoredFromRevision?: number;
  createdAt: string;
}
export interface ScriptSection {
  id: string;
  role?: ScriptRole;
  heading: string;
  purpose: string;
  text: string;
  claimRefs: string[];
  sourceRefs: string[];
  revision: number;
  history: ScriptSectionHistory[];
}
export interface ScriptCandidate {
  sourceRevision: number;
  text: string;
  claimRefs: string[];
  sourceRefs: string[];
  instructions: string;
  createdAt: string;
}
export interface ScriptDraft {
  version: 1;
  input: ScriptReviewInput;
  status: "draft" | "approved";
  approvedAt: string | null;
  updatedAt: string;
  sections: ScriptSection[];
  pending: Partial<Record<string, ScriptCandidate>>;
}

const ID = /^[a-z0-9][a-z0-9_-]{1,79}$/i;
const REF_ID = /^[a-z0-9][a-z0-9_-]{0,100}$/i;
const PLATFORMS: ScriptPlatform[] = ["youtube", "youtube_shorts", "tiktok", "instagram", "facebook", "blog", "website"];
export const SHORT_FORM_SCRIPT_PLATFORMS: readonly ScriptPlatform[] = ["youtube_shorts", "tiktok", "instagram", "facebook"];
const SECTION_PLAN: ReadonlyArray<Pick<ScriptSection, "id" | "heading" | "purpose">> = [
  { id: "hook", heading: "Opening hook", purpose: "Show a specific audience problem, immediate visual promise and central question." },
  { id: "context", heading: "Why it matters", purpose: "Establish relatable stakes, baseline and scope without repeating the hook." },
  { id: "mechanism", heading: "How it works", purpose: "Explain the causal mechanism with sourced examples, not a generic list." },
  { id: "practical", heading: "What changes the outcome", purpose: "Compare options, sensitivity or useful next steps with limitations." },
  { id: "closing", heading: "Answer and takeaway", purpose: "Resolve the opening question and make the caveats explicit." },
];
export const SCRIPT_STORAGE_PREFIX = "contentgen:script-draft:v1:";
export const MAX_SCRIPT_DRAFT_BYTES = 1024 * 1024;

export function scriptDraftKey(productionId: string, platform: ScriptPlatform): string {
  if (!ID.test(productionId) || !PLATFORMS.includes(platform)) throw Error("Invalid script output identity.");
  return `${SCRIPT_STORAGE_PREFIX}${productionId}:${platform}`;
}

function text(value: unknown, field: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max)
    throw Error(`Invalid ${field} (limit ${max} characters).`);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 8 || (code >= 14 && code <= 31))
      throw Error(`Invalid ${field} (limit ${max} characters).`);
  }
  return value.trim();
}
function refs(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some(v => typeof v !== "string" || !REF_ID.test(v)))
    throw Error(`${label} must be a bounded list of identifiers.`);
  if (new Set(value).size !== value.length) throw Error(`Duplicate ${label}.`);
  return [...value];
}
function exact(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`Invalid ${label}.`);
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(key => !allowed.includes(key))) throw Error(`Unknown ${label} fields.`);
  return obj;
}
function time(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !/Z$/u.test(value))
    throw Error("Invalid script timestamp.");
  return value;
}
function inputDocument(candidate: ScriptReviewInput): ScriptReviewInput {
  const value = exact(candidate, ["productionId", "projectId", "platform", "locale", "title", "viewerQuestion", "audience", "angle", "brandVoice", "evidenceSnapshotId"], "script context");
  const productionId = text(value.productionId, "production ID", 80, 2);
  const projectId = text(value.projectId, "project ID", 80, 2);
  if (!ID.test(productionId) || !ID.test(projectId)) throw Error("Invalid script identity.");
  if (!PLATFORMS.includes(value.platform as ScriptPlatform) || !["en", "ja"].includes(String(value.locale)))
    throw Error("Invalid script platform or locale.");
  return { productionId, projectId, platform: value.platform as ScriptPlatform, locale: value.locale as ScriptLocale,
    title: text(value.title, "title", 200, 3), viewerQuestion: text(value.viewerQuestion, "viewer question", 400, 3),
    audience: text(value.audience, "audience", 180, 2), angle: text(value.angle, "angle", 1200),
    brandVoice: text(value.brandVoice, "brand voice", 2000), evidenceSnapshotId: text(value.evidenceSnapshotId, "evidence ID", 200) };
}
export function createScriptDraft(input: ScriptReviewInput, now = new Date().toISOString()): ScriptDraft {
  return { version: 1, input: inputDocument(input), status: "draft", approvedAt: null, updatedAt: time(now),
    sections: SECTION_PLAN.map(s => ({ ...s, text: "", claimRefs: [], sourceRefs: [], revision: 0, history: [] })), pending: {} };
}
/** A selected idea can load its captured passages after the blank Script screen has already mounted. */
export function rebindEmptyScriptEvidence(draft: ScriptDraft, evidenceSnapshotId: string,
  now = new Date().toISOString()): ScriptDraft {
  const snapshot = text(evidenceSnapshotId, "evidence ID", 200);
  if (draft.status !== "draft" || Object.keys(draft.pending).length ||
      draft.sections.some(section => section.revision || section.text || section.history.length)) return draft;
  if (draft.input.evidenceSnapshotId === snapshot) return draft;
  return { ...draft, input: { ...draft.input, evidenceSnapshotId: snapshot }, updatedAt: time(now) };
}

/** Compare every prompt/source input, not just the evidence ID. Editing the
 * brand's voice or a production brief must also invalidate prior approvals. */
export function isScriptContextCurrent(draft: ScriptDraft, input: ScriptReviewInput): boolean {
  const current = inputDocument(input);
  return Object.keys(current).every(key =>
    draft.input[key as keyof ScriptReviewInput] === current[key as keyof ScriptReviewInput]);
}

/** User-initiated lineage update: keep authored words and revision history,
 * discard pending AI candidates, and require a fresh factual approval. */
export function rebaseScriptDraftContext(draft: ScriptDraft, input: ScriptReviewInput,
  now = new Date().toISOString()): ScriptDraft {
  const next = inputDocument(input);
  if (next.productionId !== draft.input.productionId ||
      next.projectId !== draft.input.projectId || next.platform !== draft.input.platform)
    throw Error("Cannot rebase a different script production, project or platform.");
  return { ...draft, input: next, status: "draft", approvedAt: null,
    pending: {}, updatedAt: time(now) };
}
function normalizedGenerated(candidate: ScriptGeneratedText): ScriptGeneratedText {
  const value = exact(candidate, ["narration", "claimRefs", "sourceRefs"], "generated section");
  return { narration: text(value.narration, "narration", 6500, 30),
    claimRefs: refs(value.claimRefs, "claim references"), sourceRefs: refs(value.sourceRefs, "source references") };
}
function update(draft: ScriptDraft, id: string, updater: (section: ScriptSection) => ScriptSection,
  now: string): ScriptDraft {
  const position = draft.sections.findIndex(s => s.id === id);
  if (position < 0) throw Error("Unknown script section.");
  const sections = draft.sections.map((section, i) => i === position ? updater(section) : section);
  return { ...draft, status: "draft", approvedAt: null, sections, updatedAt: time(now) };
}
function version(section: ScriptSection, generated: ScriptGeneratedText, origin: ScriptSectionHistory["origin"], now: string): ScriptSection {
  const revision = section.revision + 1;
  const record: ScriptSectionHistory = { revision, text: generated.narration,
    claimRefs: generated.claimRefs, sourceRefs: generated.sourceRefs, origin, createdAt: time(now) };
  return { ...section, text: generated.narration, claimRefs: generated.claimRefs,
    sourceRefs: generated.sourceRefs, revision, history: [...section.history, record] };
}
/** Copy accepted text between short-form outputs without silently replacing work or transferring approval.
 * All existing destination revisions remain available for recovery. */
export function copyShortFormScript(source: ScriptDraft, targetInput: ScriptReviewInput, existing: ScriptDraft | null,
  options: { replaceExisting?: boolean; now?: string } = {}): ScriptDraft {
  const from = validateScriptDraft(source);
  const target = inputDocument(targetInput);
  if (!SHORT_FORM_SCRIPT_PLATFORMS.includes(from.input.platform) || !SHORT_FORM_SCRIPT_PLATFORMS.includes(target.platform))
    throw Error("Only short-form video scripts can be copied between platforms.");
  if (from.input.platform === target.platform) throw Error("Select a different short-form platform.");
  if (!isScriptContextCurrent(from, { ...target, platform: from.input.platform }))
    throw Error("Script context, project or evidence has changed. Review sources before copying.");
  if (from.sections.some(section => !section.text.trim())) throw Error("Complete every source script section before copying.");
  const now = time(options.now ?? new Date().toISOString());
  let destination = existing ? validateScriptDraft(existing) : createScriptDraft(target, now);
  if (destination.input.productionId !== target.productionId || destination.input.projectId !== target.projectId ||
      destination.input.platform !== target.platform) throw Error("Destination script identity or project does not match.");
  const occupied = destination.status === "approved" || Object.keys(destination.pending).length > 0 ||
    destination.sections.some(section => section.text || section.revision || section.history.length);
  if (occupied && !options.replaceExisting) throw Error("Destination has existing work. Confirm replace before copying.");
  if (occupied && (destination.sections.length !== from.sections.length ||
      destination.sections.some((section, index) => section.id !== from.sections[index].id)))
    throw Error("Source and destination section structures differ. Back up or align the destination before replacing it.");
  if (!isScriptContextCurrent(destination, target)) destination = rebaseScriptDraftContext(destination, target, now);
  return validateScriptDraft({ ...destination, status: "draft", approvedAt: null, pending: {}, updatedAt: now,
    sections: from.sections.map(original => {
      const section = occupied ? destination.sections.find(item => item.id === original.id)! :
        { ...original, text: "", claimRefs: [], sourceRefs: [], revision: 0, history: [] };
      const next = version({ ...section, heading: original.heading, purpose: original.purpose, ...(original.role ? { role: original.role } : {}) },
        { narration: original.text, claimRefs: original.claimRefs,
        sourceRefs: original.sourceRefs }, "copied", now);
      return { ...next, history: [...next.history.slice(0, -1), { ...next.history.at(-1)!,
        copiedFrom: { platform: from.input.platform, revision: original.revision } }] };
    }) });
}
/** An AI response from the initial draft may populate only a still-blank section at its original revision. */
export function fillScriptSection(draft: ScriptDraft, id: string, candidate: ScriptGeneratedText,
  expectedRevision: number, now = new Date().toISOString()): ScriptDraft {
  const generated = normalizedGenerated(candidate);
  return update(draft, id, section => {
    if (section.revision !== expectedRevision || section.text) throw Error("Stale AI draft response; manual edits remain unchanged.");
    return version(section, generated, "ai", now);
  }, now);
}
export function editScriptSection(draft: ScriptDraft, id: string, narration: string,
  now = new Date().toISOString(), citations?: Pick<ScriptGeneratedText,"claimRefs"|"sourceRefs">): ScriptDraft {
  const value = text(narration, "manual narration", 6500);
  const changed = update(draft, id, section =>
    section.text === value && (!citations || JSON.stringify(citations)===JSON.stringify({claimRefs:section.claimRefs,sourceRefs:section.sourceRefs})) ? section : version(section, { narration: value, claimRefs: citations?.claimRefs??section.claimRefs, sourceRefs: citations?.sourceRefs??section.sourceRefs }, "manual", now), now);
  const pending = { ...changed.pending }; delete pending[id];
  return { ...changed, pending };
}
/** Restore historical accepted words as a new revision, never erasing later edits. */
export function restoreScriptRevision(draft: ScriptDraft, id: string, revision: number,
  now = new Date().toISOString()): ScriptDraft {
  const current = validateScriptDraft(draft);
  const section = current.sections.find(item => item.id === id);
  const original = section?.history.find(item => item.revision === revision);
  if (!section || !original || revision === section.revision) throw Error("Select a previous accepted script revision to restore.");
  const updated = update(current, id, item => {
    const next = version(item, { narration: original.text, claimRefs: original.claimRefs,
      sourceRefs: original.sourceRefs }, "restored", now);
    return { ...next, history: [...next.history.slice(0, -1),
      { ...next.history.at(-1)!, restoredFromRevision: revision }] };
  }, now);
  const pending = { ...updated.pending }; delete pending[id];
  return validateScriptDraft({ ...updated, pending });
}
export function proposeScriptCandidate(draft: ScriptDraft, id: string, candidate: ScriptGeneratedText,
  expectedRevision: number, now = new Date().toISOString(), instructions = ""): ScriptDraft {
  const section = draft.sections.find(s => s.id === id);
  if (!section || !section.text || section.revision !== expectedRevision) throw Error("Stale script regeneration response; accepted text has changed.");
  const generated = normalizedGenerated(candidate);
  return { ...draft, pending: { ...draft.pending, [id]: { sourceRevision: expectedRevision,
    text: generated.narration, claimRefs: generated.claimRefs, sourceRefs: generated.sourceRefs,
    instructions: text(instructions, "extra instructions", 2000), createdAt: time(now) } } };
}
export function acceptScriptCandidate(draft: ScriptDraft, id: string, now = new Date().toISOString()): ScriptDraft {
  const candidate = draft.pending[id];
  if (!candidate) throw Error("No script candidate to accept.");
  const updated = update(draft, id, section => {
    if (section.revision !== candidate.sourceRevision) throw Error("Stale script candidate; current edits have priority.");
    return version(section, { narration: candidate.text, claimRefs: candidate.claimRefs, sourceRefs: candidate.sourceRefs }, "regenerated", now);
  }, now);
  const pending = { ...updated.pending }; delete pending[id];
  return { ...updated, pending };
}
export function discardScriptCandidate(draft: ScriptDraft, id: string): ScriptDraft {
  const pending = { ...draft.pending }; delete pending[id];
  return { ...draft, pending };
}
export function approveScriptDraft(draft: ScriptDraft, now = new Date().toISOString()): ScriptDraft {
  if (draft.sections.some(s => !s.text.trim())) throw Error("Complete all script sections before approval.");
  if (Object.keys(draft.pending).length) throw Error("Accept or discard section candidates before approval.");
  return { ...draft, status: "approved", approvedAt: time(now), updatedAt: time(now) };
}

export function validateScriptDraft(candidate: unknown): ScriptDraft {
  const root = exact(candidate, ["version", "input", "status", "approvedAt", "updatedAt", "sections", "pending"], "script draft");
  if (root.version !== 1 || (root.status !== "draft" && root.status !== "approved") ||
      !Array.isArray(root.sections) || root.sections.length<1 || root.sections.length>MAX_SCRIPT_SECTIONS) throw Error("Invalid script draft schema.");
  const input = inputDocument(root.input as ScriptReviewInput);
  const seen=new Set<string>();
  const sections = root.sections.map((raw) => {
    const r = exact(raw, ["id", "role", "heading", "purpose", "text", "claimRefs", "sourceRefs", "revision", "history"], "script section");
    if(!isScriptSectionId(r.id))throw Error("Invalid script section identity.");
    if(seen.has(r.id))throw Error("Duplicate script section identity.");
    seen.add(r.id);
    if(r.role!==undefined&&!SCRIPT_ROLES.includes(r.role as ScriptRole))throw Error("Invalid script section role.");
    if (!Number.isInteger(r.revision) || (r.revision as number) < 0 || !Array.isArray(r.history) ||
        r.history.length !== r.revision) throw Error("Script section history mismatch.");
    const history = r.history.map((rawEntry, i) => {
      const h = exact(rawEntry, ["revision", "text", "claimRefs", "sourceRefs", "origin", "createdAt", "copiedFrom", "restoredFromRevision"], "script revision");
      if (h.revision !== i + 1 || !["ai", "regenerated", "manual", "copied", "restored"].includes(String(h.origin))) throw Error("Invalid script revision.");
      if ((h.origin === "copied") !== Object.hasOwn(h, "copiedFrom")) throw Error("Missing or unexpected script copy provenance.");
      if ((h.origin === "restored") !== Object.hasOwn(h, "restoredFromRevision")) throw Error("Missing or unexpected script restoration provenance.");
      if (h.origin === "restored" && (!Number.isInteger(h.restoredFromRevision) ||
          (h.restoredFromRevision as number) < 1 || (h.restoredFromRevision as number) >= (h.revision as number)))
        throw Error("Invalid script restoration source revision.");
      let copiedFrom: ScriptSectionHistory["copiedFrom"];
      if (h.origin === "copied") {
        const source = exact(h.copiedFrom, ["platform", "revision"], "script copy provenance");
        if (!SHORT_FORM_SCRIPT_PLATFORMS.includes(source.platform as ScriptPlatform) ||
          !Number.isInteger(source.revision) || (source.revision as number) < 1)
          throw Error("Invalid script copy provenance.");
        copiedFrom = { platform: source.platform as ScriptPlatform, revision: source.revision as number };
      }
      return { revision: h.revision as number, text: text(h.text, "revision narration", 6500),
        claimRefs: refs(h.claimRefs, "revision claim references"), sourceRefs: refs(h.sourceRefs, "revision source references"),
        origin: h.origin as ScriptSectionHistory["origin"], createdAt: time(h.createdAt),
        ...(copiedFrom ? { copiedFrom } : {}),
        ...(h.origin === "restored" ? { restoredFromRevision: h.restoredFromRevision as number } : {}) };
    });
    const section = { id: r.id as string,...(r.role!==undefined?{role:r.role as ScriptRole}:{}),
      heading: text(r.heading,"section heading",140,1), purpose: text(r.purpose,"section purpose",400,10),
      text: text(r.text, "section narration", 6500), claimRefs: refs(r.claimRefs, "section claim references"),
      sourceRefs: refs(r.sourceRefs, "section source references"), revision: r.revision as number, history };
    if (history.length && (section.text !== history.at(-1)?.text ||
      JSON.stringify(section.claimRefs) !== JSON.stringify(history.at(-1)?.claimRefs) ||
      JSON.stringify(section.sourceRefs) !== JSON.stringify(history.at(-1)?.sourceRefs)))
      throw Error("Script text and last accepted version disagree.");
    return section;
  });
  const pendingRoot = exact(root.pending, sections.map(s => s.id), "script candidate list");
  const pending: ScriptDraft["pending"] = {};
  for (const [id, raw] of Object.entries(pendingRoot)) {
    const c = exact(raw, ["sourceRevision", "text", "claimRefs", "sourceRefs", "instructions", "createdAt"], "script candidate");
    const parent = sections.find(s => s.id === id)!;
    if (!Number.isInteger(c.sourceRevision) || c.sourceRevision !== parent.revision) throw Error("Stale stored script candidate.");
    pending[id] = { sourceRevision: c.sourceRevision as number, text: text(c.text, "candidate narration", 6500, 30),
      claimRefs: refs(c.claimRefs, "candidate claim references"), sourceRefs: refs(c.sourceRefs, "candidate source references"),
      instructions: text(c.instructions, "candidate instructions", 2000), createdAt: time(c.createdAt) };
  }
  const approvedAt = root.approvedAt === null ? null : time(root.approvedAt);
  if(root.status==="approved"&&(sections.some(section=>!section.text.trim())||Object.keys(pending).length))throw Error("Approved script is incomplete or has pending suggestions.");
  if ((root.status === "approved") !== !!approvedAt) throw Error("Script approval status mismatch.");
  return { version: 1, input, status: root.status as ScriptDraft["status"],
    approvedAt, updatedAt: time(root.updatedAt), sections, pending };
}

export interface NewScriptSection {
  heading:string;purpose:string;text:string;role?:ScriptRole;claimRefs?:string[];sourceRefs?:string[];
}
export function manualScriptSection(input:NewScriptSection,id="section-"+crypto.randomUUID(),now=new Date().toISOString()):ScriptSection {
  if(!isScriptSectionId(id))throw Error("Invalid section identity.");
  const role=input.role??"custom";
  if(!SCRIPT_ROLES.includes(role))throw Error("Invalid section role.");
  const section:ScriptSection={id,role,heading:text(input.heading,"section heading",140,1),
    purpose:text(input.purpose,"section purpose",400,10),text:"",claimRefs:[],sourceRefs:[],revision:0,history:[]};
  const narration=text(input.text,"section narration",6500);
  const claimRefs=refs(input.claimRefs??[],"claim references"),sourceRefs=refs(input.sourceRefs??[],"source references");
  return narration?version(section,{narration,claimRefs,sourceRefs},"manual",now):section;
}
export function insertScriptSection(draft:ScriptDraft,anchorId:string,position:"before"|"after",input:NewScriptSection,
  now=new Date().toISOString()):ScriptDraft {
  if(draft.sections.length>=MAX_SCRIPT_SECTIONS)throw Error(`A script supports at most ${MAX_SCRIPT_SECTIONS} sections.`);
  const index=draft.sections.findIndex(section=>section.id===anchorId);
  if(index<0||!["before","after"].includes(position))throw Error("Select an existing section and insertion position.");
  const sections=[...draft.sections];sections.splice(index+(position==="after"?1:0),0,manualScriptSection(input,undefined,now));
  return validateScriptDraft({...draft,sections,pending:{},status:"draft",approvedAt:null,updatedAt:time(now)});
}

/** Treat localStorage as a guarded authoring cache, not an approved media release. */
export function loadScriptDraft(productionId: string, platform: ScriptPlatform): { draft: ScriptDraft | null; warning: string | null } {
  try {
    const raw = localStorage.getItem(scriptDraftKey(productionId, platform));
    if (!raw) return { draft: null, warning: null };
    if (new TextEncoder().encode(raw).length > MAX_SCRIPT_DRAFT_BYTES) throw Error("Script draft exceeds local storage limit.");
    const draft = validateScriptDraft(JSON.parse(raw));
    if (draft.input.productionId !== productionId || draft.input.platform !== platform) throw Error("Stored script identity mismatch.");
    return { draft, warning: null };
  } catch (error) {
    return { draft: null, warning: `Saved script could not be opened; no data was deleted. ${error instanceof Error ? error.message : "Storage unavailable."}` };
  }
}
export function saveScriptDraft(draft: ScriptDraft): void {
  const checked = validateScriptDraft(draft);
  const raw = JSON.stringify(checked);
  if (new TextEncoder().encode(raw).length > MAX_SCRIPT_DRAFT_BYTES) throw Error("Script draft exceeds 1 MB; export revisions before continuing.");
  localStorage.setItem(scriptDraftKey(checked.input.productionId, checked.input.platform), raw);
}

export function estimatedNarrationSeconds(text: string, locale: ScriptLocale): number {
  if (!text.trim()) return 0;
  return locale === "ja" ? Math.ceil([...text].length / 240 * 60) :
    Math.ceil(text.trim().split(/\s+/u).length / 145 * 60);
}


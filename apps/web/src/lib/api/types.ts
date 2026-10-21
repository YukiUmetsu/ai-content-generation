/**
 * Wire contracts for the three loopback-only backend surfaces.
 *
 * These mirror the serde documents in the backend lanes exactly. Field casing
 * is deliberately inconsistent between lanes because the backends own their
 * contracts: research/jobs use camelCase, packaging uses snake_case.
 *
 * Never add an optional "score", "virality" or "expected views" field here.
 * Packaging rejects unknown fields at parse time; the client also refuses any
 * payload that carries one (see `assertNoViralityClaims`).
 */

/* ------------------------------------------------------------------ */
/* Research / evidence                                                 */
/* ------------------------------------------------------------------ */

export type ResearchSourceKind =
  | "web"
  | "pdf"
  | "note"
  | "rss"
  | "repository"
  | "test"
  | "other";

export type RightsStatus = "unknown" | "cleared" | "restricted" | "denied";

export type ClaimStance = "support" | "refute" | "unknown";

export type NumericMetric =
  | "search_volume"
  | "cpc"
  | "organic_difficulty"
  | "ctr"
  | "position"
  | "clicks"
  | "impressions"
  | "other";

/** Measured / estimated / unknown is the only provenance vocabulary. */
export type Provenance = "measured" | "estimated" | "unknown";

export type PassageLocator =
  | { kind: "page"; page: number }
  | { kind: "line"; line: number; column?: number | null }
  | { kind: "char_offset"; start: number; end: number }
  | { kind: "dom"; selector: string }
  | { kind: "timestamp"; start_ms: number; end_ms: number }
  | { kind: "section"; heading: string };

export interface EvidenceSourceRef {
  id: string;
  sourceKind: ResearchSourceKind;
  canonicalUri: string;
  title: string;
  publisher: string | null;
  rightsStatus: RightsStatus;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface EvidenceVersionRef {
  id: string;
  sourceId: string;
  contentSha256: string;
  retrievedAt: string;
  mediaType: string;
  byteSize: number;
  parserVersion: string;
  rawArtifactId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface EvidenceProvenanceRef {
  sourceVersionId: string;
  canonicalUri: string;
  retrievedAt: string;
  rightsStatus: RightsStatus;
  licenseNote: string | null;
  contentSha256: string;
  parserVersion: string;
}

export interface EvidenceClaimRef {
  claimKey: string;
  stance: ClaimStance;
}

export interface EvidenceNumericValue {
  raw: string;
  metric: NumericMetric;
  provenance: Provenance;
  /** null unless an explicit declaration classified the value. */
  value: number | null;
  basis: string;
  observedAt: string | null;
  method: string | null;
}

export interface EvidenceSearchResult {
  schemaVersion: number;
  passageId: string;
  rank: number;
  bm25: number;
  excerpt: string;
  locator: PassageLocator;
  language: string;
  bodySha256: string;
  source: EvidenceSourceRef;
  version: EvidenceVersionRef;
  provenance: EvidenceProvenanceRef;
  claims: EvidenceClaimRef[];
  numericValues: EvidenceNumericValue[];
  /** Present on contradiction-only passages that the query did not match. */
  matched?: boolean;
}

export interface EvidenceContradiction {
  claimKey: string;
  /** Backend resolution vocabulary; rendered verbatim, never invented. */
  resolution: string;
  passages: EvidenceSearchResult[];
}

export interface EvidenceDegradation {
  reason: string;
  hint: string | null;
}

export interface EvidenceIndexStatus {
  state: string;
  sourcePassageCount: number;
  indexedPassageCount: number;
}

export interface EvidenceSearchResponse {
  schemaVersion: number;
  query: string;
  tokenizer: string;
  index: EvidenceIndexStatus;
  results: EvidenceSearchResult[];
  contradictions: EvidenceContradiction[];
  degradation: EvidenceDegradation | null;
}

/* ------------------------------------------------------------------ */
/* Packaging hypotheses (dedicated creative lane, snake_case)          */
/* ------------------------------------------------------------------ */

export type PackagingFormat = "long_form" | "short_form";

export type AnswerStatus =
  | "requires_scenario_model"
  | "supported_by_evidence"
  | "open";

export type EvidenceRole =
  | "price_anchor"
  | "hidden_component"
  | "comparison_baseline"
  | "assumption"
  | "market_context";

export type MeasurementStatus = "measured" | "estimated" | "unknown";

export type CuriosityMechanism =
  | "cost_reversal"
  | "mechanism_cutaway"
  | "decision_comparison"
  | "contradiction"
  | "risk_escape";

export type StoryEngine =
  | "cost_revelation"
  | "engineering_experiment"
  | "decision_showdown"
  | "mystery_investigation"
  | "failure_investigation";

export type TitleRole = "searchable" | "intriguing";

export type ThumbnailComposition =
  | "number_reversal"
  | "exploded_cutaway"
  | "a_vs_b"
  | "hero_object"
  | "before_after";

export type HookStrategy =
  | "result_first"
  | "contradiction_first"
  | "stakes_first"
  | "mechanism_reveal"
  | "decision_threshold";

export interface PackagingBriefRef {
  brief_id: string;
  revision: number;
}

export interface PackagingAudience {
  market: string;
  intent: string;
  format: PackagingFormat;
}

export interface PackagingPromise {
  question: string;
  answer_status: AnswerStatus;
  cannot_assert: string;
  payoff_event_ids: string[];
}

export interface PackagingMeasurement {
  status: MeasurementStatus;
  value: number | null;
  unit: string | null;
  estimate_basis: string | null;
  source_kind: string;
}

export interface PackagingEvidenceRef {
  evidence_id: string;
  source_title: string;
  source_url: string;
  observed_at: string;
  locator: string;
  claim: string;
  role: EvidenceRole;
  measurement: PackagingMeasurement;
}

export interface PackagingPremise {
  premise_id: string;
  statement: string;
  claim_evidence_ids: string[];
}

export interface PackagingOpeningBeat {
  beat_id: string;
  states_premise_id: string;
  visual: string;
  narration: string;
}

export interface PackagingPayoffBeat {
  beat_id: string;
  discharges_premise_id: string;
  event_id: string;
  visual: string;
  narration: string;
  conditions: string[];
}

export interface PackagingTitleCandidate {
  role: TitleRole;
  text: string;
}

export interface PackagingThumbnailConcept {
  composition: ThumbnailComposition;
  focal_subject: string;
  visual_tension: string;
  overlay_text: string;
  color_roles: string[];
}

export interface PackagingHook {
  strategy: HookStrategy;
  line: string;
  seconds_target: number;
}

export interface PackagingHypothesis {
  hypothesis_id: string;
  variant_key: string;
  curiosity_mechanism: CuriosityMechanism;
  story_engine: StoryEngine;
  premise: PackagingPremise;
  opening_beat: PackagingOpeningBeat;
  payoff_beat: PackagingPayoffBeat | null;
  title_candidates: PackagingTitleCandidate[];
  thumbnail_concept: PackagingThumbnailConcept;
  hook: PackagingHook;
  claim_evidence_ids: string[];
}

export interface PackagingCreativeConstraints {
  genuine_variety_required: boolean;
  no_virality_claim: boolean;
}

export interface PackagingProvenance {
  generator_id: string;
  generator_version: string;
  generated_at: string | null;
  deterministic: boolean;
}

export interface PackagingHypothesisSet {
  schema_version: number;
  kind: string;
  set_id: string;
  brief_ref: PackagingBriefRef;
  audience: PackagingAudience;
  promise: PackagingPromise;
  evidence: PackagingEvidenceRef[];
  hypotheses: PackagingHypothesis[];
  creative_constraints: PackagingCreativeConstraints;
  provenance: PackagingProvenance;
}

/**
 * Generation request accepted by
 * `POST /v1/creative/packaging/hypotheses/generate`.
 * The panel sends the checked-in illustrative brief; it is not invented at
 * render time.
 */
export interface PackagingGenerationRequest {
  schema_version: number;
  requested_at: string;
  brief: {
    brief_id: string;
    revision: number;
    audience_market: string;
    audience_intent: string;
    format: PackagingFormat;
    subject_label: string;
    timeframe_label?: string | null;
    decision_pair: { a: string; b: string } | null;
    promise_question: string;
    cannot_assert: string;
    brand_kit_ref: string;
    destination_profile_id: string;
  };
  evidence: PackagingEvidenceRef[];
}

/* ------------------------------------------------------------------ */
/* Jobs / DAG                                                          */
/* ------------------------------------------------------------------ */

export type JobState =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AttemptState = "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type EdgeKind = "dependency" | "data";

export interface Job {
  schemaVersion: number;
  id: string;
  jobKind: string;
  state: JobState;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobNode {
  schemaVersion: number;
  id: string;
  jobId: string;
  nodeKey: string;
  nodeKind: string;
  state: JobState;
  attemptCount: number;
  maxAttempts: number;
  idempotencyKey: string;
  input: unknown;
  output: unknown;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEdge {
  jobId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeKind: EdgeKind;
  createdAt: string;
}

export interface JobAttempt {
  id: string;
  nodeId: string;
  attemptNumber: number;
  idempotencyKey: string;
  state: AttemptState;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Counts are real node counts. There is no percent field by design. */
export interface JobProgress {
  total: number;
  pending: number;
  ready: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

export interface JobView {
  job: Job;
  nodes: JobNode[];
  edges: JobEdge[];
  attempts: JobAttempt[];
  progress: JobProgress;
}

export interface JobListResponse {
  jobs: Job[];
}

export interface CreateJobBody {
  jobKind: string;
  idempotencyKey: string;
  nodes: Array<{
    nodeKey: string;
    nodeKind: string;
    maxAttempts?: number;
    input?: unknown;
    dependsOn?: string[];
  }>;
}

export type CreateJobResponse = JobView & { created: boolean };

/* ------------------------------------------------------------------ */
/* Shared error envelope                                               */
/* ------------------------------------------------------------------ */

export interface ApiErrorBody {
  code: string;
  message: string;
  feature?: string | null;
  resource?: string | null;
  id?: string | null;
  hint?: string | null;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

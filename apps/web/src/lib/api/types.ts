/**
 * Wire contracts for the three loopback-only backend surfaces.
 *
 * These mirror the serde documents in the backend lanes exactly. Research and
 * jobs use camelCase; packaging mirrors `crates/core/src/packaging.rs`, which is
 * also camelCase (`serde(rename_all = "camelCase", deny_unknown_fields)`).
 * Enum values keep the backend's snake_case or kebab-case spelling verbatim.
 *
 * Never add an optional "score", "virality" or "expected views" field here.
 * Packaging has no score or percent field by design; the client refuses any
 * payload that carries a virality-shaped key (see `assertNoViralityClaims`).
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
/* Packaging hypotheses (mirrors crates/core/src/packaging.rs)         */
/* ------------------------------------------------------------------ */

export type PackagingStatus = "draft" | "approved" | "rejected";

export type PackagingStrategy =
  | "visible-cost-reversal"
  | "mechanism-cutaway"
  | "decision-comparison"
  | "everyday-mystery"
  | "risk-escape"
  | "reality-check"
  | "concrete-reversal"
  | "counterintuitive-mechanism";

export type MetricProvenanceKind = "measured" | "estimated" | "unknown";

export type MetricValue =
  | { kind: "number"; value: number }
  | { kind: "range"; low: number; high: number }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "unknown" };

export interface PremiseSetup {
  question: string;
  audienceStakes: string;
  openingPromise: string;
  evidenceRefs: string[];
}

export interface PremisePayoff {
  answerEventId: string;
  payoffStatement: string;
  limitation: string;
  evidenceRefs: string[];
}

export interface PackagingHypothesis {
  hypothesisId: string;
  title: string;
  strategy: PackagingStrategy;
  thumbnailConcept: string;
  openingVisual: string;
  payoffEventId: string;
  claimRefs: string[];
}

export interface PackagingMetric {
  metricKey: string;
  provenance: MetricProvenanceKind;
  value: MetricValue;
  unit?: string | null;
  sourceVersionId?: string | null;
  observedAt?: string | null;
  method?: string | null;
}

export interface PackagingHypothesisSet {
  schemaVersion: number;
  id: string;
  projectRef: string;
  status: PackagingStatus;
  premiseSetup: PremiseSetup;
  premisePayoff: PremisePayoff;
  hypotheses: PackagingHypothesis[];
  metrics: PackagingMetric[];
  createdAt: string;
  approvedAt?: string | null;
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

/**
 * Typed loopback API client.
 *
 * - Every response is validated before it reaches a panel.
 * - Every failure becomes an `ApiError` with a stable machine code, so panels
 *   can show an honest message instead of an empty screen.
 * - Packaging payloads that contain any virality claim are refused outright.
 */

import type {
  ApiErrorEnvelope,
  AttemptState,
  ClaimStance,
  CreateJobBody,
  CreateJobResponse,
  EdgeKind,
  EvidenceClaimRef,
  EvidenceContradiction,
  EvidenceNumericValue,
  EvidenceProvenanceRef,
  EvidenceSearchResponse,
  EvidenceSearchResult,
  EvidenceSourceRef,
  EvidenceVersionRef,
  Job,
  JobAttempt,
  JobEdge,
  JobListResponse,
  JobNode,
  JobProgress,
  JobState,
  JobView,
  MetricProvenanceKind,
  MetricValue,
  NumericMetric,
  PackagingHypothesis,
  PackagingHypothesisSet,
  PackagingMetric,
  PackagingStatus,
  PackagingStrategy,
  PassageLocator,
  PremisePayoff,
  PremiseSetup,
  Provenance,
  ResearchSourceKind,
  RightsStatus,
} from "./types";

export const DEFAULT_TIMEOUT_MS = 12_000;

export type ApiErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_payload";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly status: number | null;
  readonly hint: string | null;

  constructor(
    kind: ApiErrorKind,
    code: string,
    message: string,
    options: { status?: number | null; hint?: string | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.code = code;
    this.status = options.status ?? null;
    this.hint = options.hint ?? null;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

function endpoint(path: string): string {
  return `${API_BASE}${path}`;
}

/** Merge a caller signal with the request timeout without leaking listeners. */
async function requestJson(
  path: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  try {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(endpoint(path), {
      ...init,
      signal: controller.signal,
      headers,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        // A proxy or dev server can answer with HTML or plain text. On an
        // error status that is still an HTTP failure, so report the status
        // instead of mislabelling the body as a malformed JSON document.
        if (!response.ok) {
          throw new ApiError(
            "http",
            `http_${response.status}`,
            `The server refused the request (HTTP ${response.status}).`,
            { status: response.status },
          );
        }
        throw new ApiError(
          "invalid_payload",
          "invalid_json",
          "The server returned a response that is not JSON.",
          { status: response.status },
        );
      }
    }

    if (!response.ok) {
      throw errorFromEnvelope(payload, response.status);
    }
    if (payload === null) {
      throw new ApiError(
        "invalid_payload",
        "empty_response",
        "The server returned an empty response.",
        { status: response.status },
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (timedOut) {
      throw new ApiError(
        "timeout",
        "request_timeout",
        `The ${Math.round(timeoutMs / 1000)}s request timed out before the loopback server answered.`,
      );
    }
    if (options.signal?.aborted) {
      throw new ApiError("aborted", "request_aborted", "The request was cancelled.");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("aborted", "request_aborted", "The request was cancelled.");
    }
    throw new ApiError(
      "network",
      "network_unreachable",
      "The loopback API could not be reached. Start the local backend and retry.",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function errorFromEnvelope(payload: unknown, status: number): ApiError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const body = payload.error as unknown as ApiErrorEnvelope["error"];
    if (typeof body.code === "string" && typeof body.message === "string") {
      return new ApiError("http", body.code, body.message, {
        status,
        hint: typeof body.hint === "string" ? body.hint : null,
      });
    }
  }
  return new ApiError(
    "http",
    `http_${status}`,
    `The server refused the request (HTTP ${status}).`,
    { status },
  );
}

/* ------------------------------------------------------------------ */
/* Runtime validation helpers                                          */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, expected: string): never {
  throw new ApiError(
    "invalid_payload",
    "unexpected_payload",
    `Unexpected API payload at ${path}: expected ${expected}.`,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(path, "an object");
}

function array(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(path, "an array");
}

function str(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, "a string");
}

function num(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(path, "a finite number");
}

function bool(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(path, "a boolean");
}

function nullableStr(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : str(value, path);
}

function nullableNum(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : num(value, path);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  const text = str(value, path);
  return (allowed as readonly string[]).includes(text)
    ? (text as T)
    : fail(path, `one of ${allowed.join(", ")}`);
}

/** Packaging must never carry a virality or performance prediction. */
export function assertNoViralityClaims(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoViralityClaims(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    // The contract carries one explicit negation, `no_virality_claim: true`.
    // It is a constraint, not a prediction; every other virality-shaped key
    // (a score, a forecast, a bare claim) is refused.
    if (key === "no_virality_claim" && typeof child === "boolean") {
      continue;
    }
    if (/viral/i.test(key)) {
      throw new ApiError(
        "invalid_payload",
        "unsupported_virality_claim",
        `The packaging payload contains a forbidden virality field at ${path}.${key}. The panel refuses to display it.`,
      );
    }
    assertNoViralityClaims(child, `${path}.${key}`);
  }
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

const SOURCE_KINDS: readonly ResearchSourceKind[] = [
  "web",
  "pdf",
  "note",
  "rss",
  "repository",
  "test",
  "other",
];

const RIGHTS: readonly RightsStatus[] = [
  "unknown",
  "cleared",
  "restricted",
  "denied",
];

const STANCES: readonly ClaimStance[] = ["support", "refute", "unknown"];

const METRICS: readonly NumericMetric[] = [
  "search_volume",
  "cpc",
  "organic_difficulty",
  "ctr",
  "position",
  "clicks",
  "impressions",
  "other",
];

const PROVENANCE: readonly Provenance[] = ["measured", "estimated", "unknown"];

function parseLocator(value: unknown, path: string): PassageLocator {
  const raw = record(value, path);
  const kind = str(raw.kind, `${path}.kind`);
  switch (kind) {
    case "page":
      return { kind, page: num(raw.page, `${path}.page`) };
    case "line":
      return {
        kind,
        line: num(raw.line, `${path}.line`),
        column: nullableNum(raw.column, `${path}.column`),
      };
    case "char_offset":
      return {
        kind,
        start: num(raw.start, `${path}.start`),
        end: num(raw.end, `${path}.end`),
      };
    case "dom":
      return { kind, selector: str(raw.selector, `${path}.selector`) };
    case "timestamp":
      return {
        kind,
        start_ms: num(raw.start_ms, `${path}.start_ms`),
        end_ms: num(raw.end_ms, `${path}.end_ms`),
      };
    case "section":
      return { kind, heading: str(raw.heading, `${path}.heading`) };
    default:
      return fail(`${path}.kind`, "a known locator kind");
  }
}

function parseSource(value: unknown, path: string): EvidenceSourceRef {
  const raw = record(value, path);
  return {
    id: str(raw.id, `${path}.id`),
    sourceKind: oneOf(raw.sourceKind, SOURCE_KINDS, `${path}.sourceKind`),
    canonicalUri: str(raw.canonicalUri, `${path}.canonicalUri`),
    title: str(raw.title, `${path}.title`),
    publisher: nullableStr(raw.publisher, `${path}.publisher`),
    rightsStatus: oneOf(raw.rightsStatus, RIGHTS, `${path}.rightsStatus`),
    createdAt: str(raw.createdAt, `${path}.createdAt`),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };
}

function parseVersion(value: unknown, path: string): EvidenceVersionRef {
  const raw = record(value, path);
  return {
    id: str(raw.id, `${path}.id`),
    sourceId: str(raw.sourceId, `${path}.sourceId`),
    contentSha256: str(raw.contentSha256, `${path}.contentSha256`),
    retrievedAt: str(raw.retrievedAt, `${path}.retrievedAt`),
    mediaType: str(raw.mediaType, `${path}.mediaType`),
    byteSize: num(raw.byteSize, `${path}.byteSize`),
    parserVersion: str(raw.parserVersion, `${path}.parserVersion`),
    rawArtifactId: nullableStr(raw.rawArtifactId, `${path}.rawArtifactId`),
    createdAt: str(raw.createdAt, `${path}.createdAt`),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };
}

function parseProvenanceRef(
  value: unknown,
  path: string,
): EvidenceProvenanceRef {
  const raw = record(value, path);
  return {
    sourceVersionId: str(raw.sourceVersionId, `${path}.sourceVersionId`),
    canonicalUri: str(raw.canonicalUri, `${path}.canonicalUri`),
    retrievedAt: str(raw.retrievedAt, `${path}.retrievedAt`),
    rightsStatus: oneOf(raw.rightsStatus, RIGHTS, `${path}.rightsStatus`),
    licenseNote: nullableStr(raw.licenseNote, `${path}.licenseNote`),
    contentSha256: str(raw.contentSha256, `${path}.contentSha256`),
    parserVersion: str(raw.parserVersion, `${path}.parserVersion`),
  };
}

function parseClaims(value: unknown, path: string): EvidenceClaimRef[] {
  return array(value, path).map((item, index) => {
    const raw = record(item, `${path}[${index}]`);
    return {
      claimKey: str(raw.claimKey, `${path}[${index}].claimKey`),
      stance: oneOf(raw.stance, STANCES, `${path}[${index}].stance`),
    };
  });
}

function parseNumericValues(
  value: unknown,
  path: string,
): EvidenceNumericValue[] {
  return array(value, path).map((item, index) => {
    const raw = record(item, `${path}[${index}]`);
    return {
      raw: str(raw.raw, `${path}[${index}].raw`),
      metric: oneOf(raw.metric, METRICS, `${path}[${index}].metric`),
      provenance: oneOf(
        raw.provenance,
        PROVENANCE,
        `${path}[${index}].provenance`,
      ),
      value: nullableNum(raw.value, `${path}[${index}].value`),
      basis: str(raw.basis, `${path}[${index}].basis`),
      observedAt: nullableStr(raw.observedAt, `${path}[${index}].observedAt`),
      method: nullableStr(raw.method, `${path}[${index}].method`),
    };
  });
}

function parseSearchResult(value: unknown, path: string): EvidenceSearchResult {
  const raw = record(value, path);
  return {
    schemaVersion: num(raw.schemaVersion, `${path}.schemaVersion`),
    passageId: str(raw.passageId, `${path}.passageId`),
    rank: num(raw.rank, `${path}.rank`),
    bm25: num(raw.bm25, `${path}.bm25`),
    excerpt: str(raw.excerpt, `${path}.excerpt`),
    locator: parseLocator(raw.locator, `${path}.locator`),
    language: str(raw.language, `${path}.language`),
    bodySha256: str(raw.bodySha256, `${path}.bodySha256`),
    source: parseSource(raw.source, `${path}.source`),
    version: parseVersion(raw.version, `${path}.version`),
    provenance: parseProvenanceRef(raw.provenance, `${path}.provenance`),
    claims: parseClaims(raw.claims, `${path}.claims`),
    numericValues: parseNumericValues(
      raw.numericValues,
      `${path}.numericValues`,
    ),
    matched: typeof raw.matched === "boolean" ? raw.matched : undefined,
  };
}

function parseContradiction(
  value: unknown,
  path: string,
): EvidenceContradiction {
  const raw = record(value, path);
  return {
    claimKey: str(raw.claimKey, `${path}.claimKey`),
    resolution: str(raw.resolution, `${path}.resolution`),
    passages: array(raw.passages, `${path}.passages`).map((item, index) =>
      parseSearchResult(item, `${path}.passages[${index}]`),
    ),
  };
}

export async function searchEvidence(
  query: string,
  options: RequestOptions = {},
): Promise<EvidenceSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: "20" });
  const payload = await requestJson(
    `/api/research/search?${params.toString()}`,
    { method: "GET" },
    options,
  );
  const raw = record(payload, "$");
  const index = record(raw.index, "$.index");
  return {
    schemaVersion: num(raw.schemaVersion, "$.schemaVersion"),
    query: str(raw.query, "$.query"),
    tokenizer: str(raw.tokenizer, "$.tokenizer"),
    index: {
      state: str(index.state, "$.index.state"),
      sourcePassageCount: num(
        index.sourcePassageCount,
        "$.index.sourcePassageCount",
      ),
      indexedPassageCount: num(
        index.indexedPassageCount,
        "$.index.indexedPassageCount",
      ),
    },
    results: array(raw.results, "$.results").map((item, indexValue) =>
      parseSearchResult(item, `$.results[${indexValue}]`),
    ),
    contradictions: array(raw.contradictions, "$.contradictions").map(
      (item, indexValue) =>
        parseContradiction(item, `$.contradictions[${indexValue}]`),
    ),
    degradation:
      raw.degradation === null || raw.degradation === undefined
        ? null
        : {
            reason: str(
              record(raw.degradation, "$.degradation").reason,
              "$.degradation.reason",
            ),
            hint: nullableStr(
              record(raw.degradation, "$.degradation").hint,
              "$.degradation.hint",
            ),
          },
  };
}

/* ------------------------------------------------------------------ */
/* Packaging                                                           */
/* ------------------------------------------------------------------ */

const PACKAGING_SCHEMA_VERSION = 1;
const PACKAGING_STATUSES: readonly PackagingStatus[] = [
  "draft",
  "approved",
  "rejected",
];
const PACKAGING_STRATEGIES: readonly PackagingStrategy[] = [
  "visible-cost-reversal",
  "mechanism-cutaway",
  "decision-comparison",
  "everyday-mystery",
  "risk-escape",
  "reality-check",
  "concrete-reversal",
  "counterintuitive-mechanism",
];
const METRIC_PROVENANCE_KINDS: readonly MetricProvenanceKind[] = [
  "measured",
  "estimated",
  "unknown",
];
const METRIC_VALUE_KINDS = [
  "number",
  "range",
  "text",
  "boolean",
  "unknown",
] as const;
const FORBIDDEN_METRIC_KEY_TOKENS = [
  "viralscore",
  "virality",
  "viralprobability",
  "predictedctr",
  "guaranteedctr",
  "guaranteedviews",
] as const;

function parseEvidenceRefs(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) =>
    str(item, `${path}[${index}]`),
  );
}

function parsePremiseSetup(value: unknown, path: string): PremiseSetup {
  const raw = record(value, path);
  return {
    question: str(raw.question, `${path}.question`),
    audienceStakes: str(raw.audienceStakes, `${path}.audienceStakes`),
    openingPromise: str(raw.openingPromise, `${path}.openingPromise`),
    evidenceRefs: parseEvidenceRefs(raw.evidenceRefs, `${path}.evidenceRefs`),
  };
}

function parsePremisePayoff(value: unknown, path: string): PremisePayoff {
  const raw = record(value, path);
  return {
    answerEventId: str(raw.answerEventId, `${path}.answerEventId`),
    payoffStatement: str(raw.payoffStatement, `${path}.payoffStatement`),
    limitation: str(raw.limitation, `${path}.limitation`),
    evidenceRefs: parseEvidenceRefs(raw.evidenceRefs, `${path}.evidenceRefs`),
  };
}

function parseMetricValue(value: unknown, path: string): MetricValue {
  const raw = record(value, path);
  const kind = oneOf(raw.kind, METRIC_VALUE_KINDS, `${path}.kind`);
  switch (kind) {
    case "number":
      return { kind, value: num(raw.value, `${path}.value`) };
    case "range": {
      const low = num(raw.low, `${path}.low`);
      const high = num(raw.high, `${path}.high`);
      if (low > high) {
        fail(`${path}.high`, "a number greater than or equal to low");
      }
      return { kind, low, high };
    }
    case "text":
      return { kind, value: str(raw.value, `${path}.value`) };
    case "boolean":
      return { kind, value: bool(raw.value, `${path}.value`) };
    case "unknown":
      return { kind };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** The domain forbids performance-prediction metric keys, normalized. */
function assertMetricKeyAllowed(metricKey: string, path: string): void {
  const normalized = metricKey.toLowerCase().replace(/[^a-z0-9]/g, "");
  const forbidden = FORBIDDEN_METRIC_KEY_TOKENS.find((token) =>
    normalized.includes(token),
  );
  if (forbidden !== undefined) {
    throw new ApiError(
      "invalid_payload",
      "unsupported_virality_claim",
      `The packaging payload contains the forbidden performance metric '${metricKey}' at ${path}. The panel refuses to display it.`,
    );
  }
}

function parseMetric(value: unknown, path: string): PackagingMetric {
  const raw = record(value, path);
  const metricKey = str(raw.metricKey, `${path}.metricKey`);
  assertMetricKeyAllowed(metricKey, `${path}.metricKey`);
  const provenance = oneOf(
    raw.provenance,
    METRIC_PROVENANCE_KINDS,
    `${path}.provenance`,
  );
  const metricValue = parseMetricValue(raw.value, `${path}.value`);
  if (provenance === "unknown" && metricValue.kind !== "unknown") {
    fail(`${path}.value`, '{"kind":"unknown"} for an unknown metric');
  }
  const sourceVersionId = nullableStr(
    raw.sourceVersionId,
    `${path}.sourceVersionId`,
  );
  const observedAt = nullableStr(raw.observedAt, `${path}.observedAt`);
  if (provenance === "measured" && (!sourceVersionId || !observedAt)) {
    fail(
      `${path}.sourceVersionId`,
      "a measured metric's sourceVersionId and observedAt",
    );
  }
  const method = nullableStr(raw.method, `${path}.method`);
  if (provenance === "estimated" && (!method || method.trim().length === 0)) {
    fail(`${path}.method`, "a non-empty method for an estimated metric");
  }
  return {
    metricKey,
    provenance,
    value: metricValue,
    unit: nullableStr(raw.unit, `${path}.unit`),
    sourceVersionId,
    observedAt,
    method,
  };
}

function parsePackagingHypothesis(
  value: unknown,
  path: string,
): PackagingHypothesis {
  const raw = record(value, path);
  return {
    hypothesisId: str(raw.hypothesisId, `${path}.hypothesisId`),
    title: str(raw.title, `${path}.title`),
    strategy: oneOf(raw.strategy, PACKAGING_STRATEGIES, `${path}.strategy`),
    thumbnailConcept: str(raw.thumbnailConcept, `${path}.thumbnailConcept`),
    openingVisual: str(raw.openingVisual, `${path}.openingVisual`),
    payoffEventId: str(raw.payoffEventId, `${path}.payoffEventId`),
    claimRefs: parseEvidenceRefs(raw.claimRefs, `${path}.claimRefs`),
  };
}

/**
 * Read the one packaging hypothesis set. The backend registers this route but
 * currently answers 501; the caller must render that honestly.
 */
export async function fetchPackagingHypothesisSet(
  options: RequestOptions = {},
): Promise<PackagingHypothesisSet> {
  const payload = await requestJson(
    "/api/creative/packaging",
    { method: "GET" },
    options,
  );
  // Defence in depth: the real contract has no virality key at all.
  assertNoViralityClaims(payload);

  const raw = record(payload, "$");
  const schemaVersion = num(raw.schemaVersion, "$.schemaVersion");
  if (schemaVersion !== PACKAGING_SCHEMA_VERSION) {
    fail("$.schemaVersion", String(PACKAGING_SCHEMA_VERSION));
  }
  const premiseSetup = parsePremiseSetup(raw.premiseSetup, "$.premiseSetup");
  const premisePayoff = parsePremisePayoff(raw.premisePayoff, "$.premisePayoff");
  const hypotheses = array(raw.hypotheses, "$.hypotheses").map(
    (item, index) =>
      parsePackagingHypothesis(item, `$.hypotheses[${index}]`),
  );
  if (hypotheses.length < 1 || hypotheses.length > 3) {
    fail("$.hypotheses", "1 to 3 hypotheses");
  }

  const hypothesisIds = new Set<string>();
  const strategies = new Set<PackagingStrategy>();
  const titles = new Set<string>();
  hypotheses.forEach((hypothesis, index) => {
    const path = `$.hypotheses[${index}]`;
    if (hypothesisIds.has(hypothesis.hypothesisId)) {
      fail(`${path}.hypothesisId`, "a unique hypothesis id");
    }
    if (strategies.has(hypothesis.strategy)) {
      fail(`${path}.strategy`, "a unique packaging strategy");
    }
    const normalizedTitle = hypothesis.title.trim().toLowerCase();
    if (titles.has(normalizedTitle)) {
      fail(`${path}.title`, "a unique, case-insensitive title");
    }
    if (hypothesis.payoffEventId !== premisePayoff.answerEventId) {
      fail(
        `${path}.payoffEventId`,
        `the set answerEventId '${premisePayoff.answerEventId}'`,
      );
    }
    hypothesisIds.add(hypothesis.hypothesisId);
    strategies.add(hypothesis.strategy);
    titles.add(normalizedTitle);
  });

  const rawMetrics = raw.metrics === undefined ? [] : raw.metrics;
  const metrics = array(rawMetrics, "$.metrics").map((item, index) =>
    parseMetric(item, `$.metrics[${index}]`),
  );
  const metricKeys = new Set<string>();
  metrics.forEach((metric, index) => {
    if (metricKeys.has(metric.metricKey)) {
      fail(`$.metrics[${index}].metricKey`, "a unique metric key");
    }
    metricKeys.add(metric.metricKey);
  });

  return {
    schemaVersion,
    id: str(raw.id, "$.id"),
    projectRef: str(raw.projectRef, "$.projectRef"),
    status: oneOf(raw.status, PACKAGING_STATUSES, "$.status"),
    premiseSetup,
    premisePayoff,
    hypotheses,
    metrics,
    createdAt: str(raw.createdAt, "$.createdAt"),
    approvedAt: nullableStr(raw.approvedAt, "$.approvedAt"),
  };
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

const JOB_STATES: readonly JobState[] = [
  "PENDING",
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

const ATTEMPT_STATES: readonly AttemptState[] = [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

const EDGE_KINDS: readonly EdgeKind[] = ["dependency", "data"];

function parseJob(value: unknown, path: string): Job {
  const raw = record(value, path);
  return {
    schemaVersion: num(raw.schemaVersion, `${path}.schemaVersion`),
    id: str(raw.id, `${path}.id`),
    jobKind: str(raw.jobKind, `${path}.jobKind`),
    state: oneOf(raw.state, JOB_STATES, `${path}.state`),
    idempotencyKey: str(raw.idempotencyKey, `${path}.idempotencyKey`),
    createdAt: str(raw.createdAt, `${path}.createdAt`),
    updatedAt: str(raw.updatedAt, `${path}.updatedAt`),
  };
}

function parseNode(value: unknown, path: string): JobNode {
  const raw = record(value, path);
  return {
    schemaVersion: num(raw.schemaVersion, `${path}.schemaVersion`),
    id: str(raw.id, `${path}.id`),
    jobId: str(raw.jobId, `${path}.jobId`),
    nodeKey: str(raw.nodeKey, `${path}.nodeKey`),
    nodeKind: str(raw.nodeKind, `${path}.nodeKind`),
    state: oneOf(raw.state, JOB_STATES, `${path}.state`),
    attemptCount: num(raw.attemptCount, `${path}.attemptCount`),
    maxAttempts: num(raw.maxAttempts, `${path}.maxAttempts`),
    idempotencyKey: str(raw.idempotencyKey, `${path}.idempotencyKey`),
    input: raw.input ?? null,
    output: raw.output ?? null,
    errorCode: nullableStr(raw.errorCode, `${path}.errorCode`),
    createdAt: str(raw.createdAt, `${path}.createdAt`),
    updatedAt: str(raw.updatedAt, `${path}.updatedAt`),
  };
}

function parseEdge(value: unknown, path: string): JobEdge {
  const raw = record(value, path);
  return {
    jobId: str(raw.jobId, `${path}.jobId`),
    fromNodeId: str(raw.fromNodeId, `${path}.fromNodeId`),
    toNodeId: str(raw.toNodeId, `${path}.toNodeId`),
    edgeKind: oneOf(raw.edgeKind, EDGE_KINDS, `${path}.edgeKind`),
    createdAt: str(raw.createdAt, `${path}.createdAt`),
  };
}

function parseAttempt(value: unknown, path: string): JobAttempt {
  const raw = record(value, path);
  return {
    id: str(raw.id, `${path}.id`),
    nodeId: str(raw.nodeId, `${path}.nodeId`),
    attemptNumber: num(raw.attemptNumber, `${path}.attemptNumber`),
    idempotencyKey: str(raw.idempotencyKey, `${path}.idempotencyKey`),
    state: oneOf(raw.state, ATTEMPT_STATES, `${path}.state`),
    startedAt: str(raw.startedAt, `${path}.startedAt`),
    finishedAt: nullableStr(raw.finishedAt, `${path}.finishedAt`),
    errorCode: nullableStr(raw.errorCode, `${path}.errorCode`),
    errorDetail: nullableStr(raw.errorDetail, `${path}.errorDetail`),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    createdAt: str(raw.createdAt, `${path}.createdAt`),
  };
}

function parseProgress(value: unknown, path: string): JobProgress {
  const raw = record(value, path);
  return {
    total: num(raw.total, `${path}.total`),
    pending: num(raw.pending, `${path}.pending`),
    ready: num(raw.ready, `${path}.ready`),
    running: num(raw.running, `${path}.running`),
    succeeded: num(raw.succeeded, `${path}.succeeded`),
    failed: num(raw.failed, `${path}.failed`),
    cancelled: num(raw.cancelled, `${path}.cancelled`),
  };
}

function parseJobView(value: unknown, path: string): JobView {
  const raw = record(value, path);
  return {
    job: parseJob(raw.job, `${path}.job`),
    nodes: array(raw.nodes, `${path}.nodes`).map((item, index) =>
      parseNode(item, `${path}.nodes[${index}]`),
    ),
    edges: array(raw.edges, `${path}.edges`).map((item, index) =>
      parseEdge(item, `${path}.edges[${index}]`),
    ),
    attempts: array(raw.attempts, `${path}.attempts`).map((item, index) =>
      parseAttempt(item, `${path}.attempts[${index}]`),
    ),
    progress: parseProgress(raw.progress, `${path}.progress`),
  };
}

export async function listJobs(
  options: RequestOptions = {},
): Promise<JobListResponse> {
  const payload = await requestJson("/api/jobs", { method: "GET" }, options);
  const raw = record(payload, "$");
  return {
    jobs: array(raw.jobs, "$.jobs").map((item, index) =>
      parseJob(item, `$.jobs[${index}]`),
    ),
  };
}

export async function getJob(
  jobId: string,
  options: RequestOptions = {},
): Promise<JobView> {
  const payload = await requestJson(
    `/api/jobs/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    options,
  );
  return parseJobView(payload, "$");
}

export async function cancelJob(
  jobId: string,
  options: RequestOptions = {},
): Promise<JobView> {
  const payload = await requestJson(
    `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
    options,
  );
  return parseJobView(payload, "$");
}

export async function createJob(
  body: CreateJobBody,
  options: RequestOptions = {},
): Promise<CreateJobResponse> {
  const payload = await requestJson(
    "/api/jobs",
    { method: "POST", body: JSON.stringify(body) },
    options,
  );
  const view = parseJobView(payload, "$");
  const raw = record(payload, "$");
  return {
    ...view,
    created: typeof raw.created === "boolean" ? raw.created : false,
  };
}

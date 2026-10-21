import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileDigit, Hash, Info, Scale, Search, X } from "lucide-react";
import { ApiErrorNotice } from "./api-error-notice";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface-card";
import { EmptyState } from "@/app/empty-state";
import { translate, formatDateTimeUTC, formatNumber, formatBytes, shortHash } from "@/i18n/messages";
import { searchEvidence, ApiError } from "@/lib/api/client";
import type {
  EvidenceContradiction,
  EvidenceNumericValue,
  EvidenceSearchResponse,
  EvidenceSearchResult,
  PassageLocator,
  Provenance,
  RightsStatus,
  ClaimStance,
  NumericMetric,
} from "@/lib/api/types";
import type { Locale } from "@/features/registry";

interface EvidencePanelProps {
  locale: Locale;
}

const MAX_QUERY_LENGTH = 500;

function formatLocator(locator: PassageLocator, locale: Locale): string {
  switch (locator.kind) {
    case "page":
      return locale === "ja" ? `ページ ${locator.page}` : `Page ${locator.page}`;
    case "line": {
      const col =
        locator.column != null
          ? locale === "ja"
            ? `、列 ${locator.column}`
            : `, column ${locator.column}`
          : "";
      return (locale === "ja" ? `行 ${locator.line}` : `Line ${locator.line}`) + col;
    }
    case "char_offset":
      return locale === "ja"
        ? `文字 ${locator.start}–${locator.end}`
        : `Characters ${locator.start}–${locator.end}`;
    case "dom":
      return locale === "ja" ? `セレクター: ${locator.selector}` : `Selector: ${locator.selector}`;
    case "timestamp": {
      const start = formatTimeMs(locator.start_ms, locale);
      const end = formatTimeMs(locator.end_ms, locale);
      return locale === "ja" ? `タイムスタンプ ${start}–${end}` : `Timestamp ${start}–${end}`;
    }
    case "section":
      return locale === "ja" ? `節: ${locator.heading}` : `Section: ${locator.heading}`;
    default: {
      const _exhaustive: never = locator;
      return _exhaustive;
    }
  }
}

function formatTimeMs(ms: number, locale: Locale): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  const frac = Math.floor((ms % 1000) / 10);
  if (locale === "ja") {
    return `${minutes}:${String(rem).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rem).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

function provenanceLabel(provenance: Provenance, locale: Locale): string {
  switch (provenance) {
    case "measured":
      return translate(locale, "evidenceMeasured");
    case "estimated":
      return translate(locale, "evidenceEstimated");
    case "unknown":
      return translate(locale, "evidenceUnknown");
    default: {
      const _exhaustive: never = provenance;
      return _exhaustive;
    }
  }
}

function metricLabel(metric: NumericMetric, locale: Locale): string {
  const key = {
    search_volume: "evidenceMetricSearchVolume",
    cpc: "evidenceMetricCpc",
    organic_difficulty: "evidenceMetricOrganicDifficulty",
    ctr: "evidenceMetricCtr",
    position: "evidenceMetricPosition",
    clicks: "evidenceMetricClicks",
    impressions: "evidenceMetricImpressions",
  } as const;
  if (metric === "other") return "";
  return translate(locale, key[metric]);
}

function indexStateLabel(state: string, locale: Locale): string {
  if (state === "ready") return translate(locale, "evidenceIndexReady");
  if (state === "empty") return translate(locale, "evidenceIndexEmpty");
  if (state === "stale") return translate(locale, "evidenceIndexStale");
  return state;
}

function rightsLabel(status: RightsStatus, locale: Locale): string {
  const map: Record<RightsStatus, string> = {
    unknown: locale === "ja" ? "不明" : "Unknown",
    cleared: locale === "ja" ? "クリア済み" : "Cleared",
    restricted: locale === "ja" ? "制限あり" : "Restricted",
    denied: locale === "ja" ? "拒否" : "Denied",
  };
  return map[status];
}

function stanceLabel(stance: ClaimStance, locale: Locale): string {
  switch (stance) {
    case "support":
      return translate(locale, "evidenceStanceSupport");
    case "refute":
      return translate(locale, "evidenceStanceRefute");
    case "unknown":
      return translate(locale, "evidenceStanceUnknown");
    default: {
      const _exhaustive: never = stance;
      return _exhaustive;
    }
  }
}

function degradationText(reason: string, locale: Locale): string {
  switch (reason) {
    case "index_empty":
      return translate(locale, "evidenceDegradationIndexEmpty");
    case "index_stale":
      return translate(locale, "evidenceDegradationIndexStale");
    case "no_matches":
      return translate(locale, "evidenceDegradationNoMatches");
    default:
      return reason;
  }
}

function MetricValue({ value, locale }: { value: EvidenceNumericValue; locale: Locale }) {
  const displayValue = value.value != null ? formatNumber(value.value, locale) : value.raw;
  return (
    <div className="flex flex-col gap-1 rounded-control border border-border bg-surface-subtle px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{displayValue}</span>
        <span className="rounded-full bg-track px-2 py-0.5 text-sm font-medium text-muted-foreground">
          {provenanceLabel(value.provenance, locale)}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">
        {value.metric !== "other" && (
          <span className="me-2 inline-block">{metricLabel(value.metric, locale)}</span>
        )}
        {value.basis && value.basis !== value.raw && (
          <span className="me-2 inline-block">{value.basis}</span>
        )}
      </div>
      {value.method && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">{translate(locale, "evidenceMethod")}:</span> {value.method}
        </p>
      )}
      {value.observedAt && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">{translate(locale, "evidenceObserved")}:</span>{" "}
          {formatDateTimeUTC(value.observedAt)}
        </p>
      )}
    </div>
  );
}

function ResultCard({
  result,
  locale,
  showRank = true,
  showMatchedPill = true,
}: {
  result: EvidenceSearchResult;
  locale: Locale;
  showRank?: boolean;
  showMatchedPill?: boolean;
}) {
  return (
    <Surface variant="solid" className="gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showRank && (
          <span className="rounded-full bg-track px-2 py-0.5 text-sm font-medium text-muted-foreground">
            {translate(locale, "evidenceRank", { rank: result.rank })}
          </span>
        )}
        {showMatchedPill && result.matched === false && (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-sm text-status-warning">
            {translate(locale, "evidenceMatchedOnly")}
          </span>
        )}
      </div>

      <p className="whitespace-pre-wrap text-foreground">{result.excerpt}</p>

      <div className="mt-2 grid gap-3 text-sm">
        <div className="grid gap-1">
          <p className="font-medium text-foreground">{translate(locale, "evidenceSource")}</p>
          <p className="text-muted-foreground">{result.source.title}</p>
          <p className="text-muted-foreground">
            {result.source.sourceKind}
            {result.source.publisher && ` · ${result.source.publisher}`}
          </p>
          <p className="break-all text-muted-foreground">{result.source.canonicalUri}</p>
        </div>

        <div className="grid gap-1">
          <p className="font-medium text-foreground">{translate(locale, "evidenceVersion")}</p>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <span>{translate(locale, "evidenceVersionId")}</span>
            <span className="break-all">{result.version.id}</span>
            <span>{translate(locale, "evidenceHash")}</span>
            <span className="break-all" title={result.version.contentSha256}>
              {shortHash(result.version.contentSha256)}
            </span>
            <span>{translate(locale, "evidenceRetrieved")}</span>
            <span>{formatDateTimeUTC(result.version.retrievedAt)}</span>
            <span>{translate(locale, "evidenceParser")}</span>
            <span>{result.version.parserVersion}</span>
            <span>{translate(locale, "status")}</span>
            <span>{rightsLabel(result.provenance.rightsStatus, locale)}</span>
            {result.provenance.licenseNote && (
              <>
                <span>{translate(locale, "evidenceLicense")}</span>
                <span>{result.provenance.licenseNote}</span>
              </>
            )}
            <span>{translate(locale, "evidenceSize")}</span>
            <span>{formatBytes(result.version.byteSize, locale)}</span>
            <span>{translate(locale, "evidenceLocator")}</span>
            <span>{formatLocator(result.locator, locale)}</span>
          </div>
        </div>

        {result.claims.length > 0 && (
          <div className="grid gap-1">
            <p className="font-medium text-foreground">{translate(locale, "evidenceClaims")}</p>
            <ul className="list-disc space-y-1 ps-4 text-muted-foreground">
              {result.claims.map((claim) => (
                <li key={claim.claimKey}>
                  <span className="font-medium">{claim.claimKey}</span>{" "}
                  <span className="text-foreground">({stanceLabel(claim.stance, locale)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.numericValues.length > 0 ? (
          <div className="grid gap-2">
            <p className="font-medium text-foreground">{translate(locale, "evidenceNumbers")}</p>
            <div className="grid gap-2">
              {result.numericValues.map((value, index) => (
                <MetricValue key={index} value={value} locale={locale} />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{translate(locale, "evidenceNoNumbers")}</p>
        )}
      </div>
    </Surface>
  );
}

function ContradictionCard({
  contradiction,
  locale,
}: {
  contradiction: EvidenceContradiction;
  locale: Locale;
}) {
  return (
    <Surface variant="outline" className="border-status-warning/40 bg-status-warning/5">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-status-warning" />
        <div className="grid flex-1 gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {translate(locale, "evidenceContradictionClaim")}
            </p>
            <p className="text-foreground">{contradiction.claimKey}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {translate(locale, "details")}
            </p>
            <p className="whitespace-pre-wrap text-foreground">{contradiction.resolution}</p>
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              {translate(locale, "evidenceContradictionPassages", {
                count: contradiction.passages.length,
              })}
            </p>
            {contradiction.passages.map((passage) => (
              <ResultCard
                key={passage.passageId}
                result={passage}
                locale={locale}
                showRank={false}
                showMatchedPill={false}
              />
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}

export function EvidencePanel({ locale }: EvidencePanelProps) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<EvidenceSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRequest = useCallback(() => {
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearRequest();
  }, [clearRequest]);

  function handleCancel() {
    clearRequest();
    setLoading(false);
    setSlow(false);
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setValidation(null);
    setError(null);
    setResponse(null);

    const trimmed = query.trim();
    if (!trimmed) {
      setValidation(translate(locale, "evidenceEnterQuery"));
      return;
    }
    if (trimmed.length > MAX_QUERY_LENGTH) {
      setValidation(translate(locale, "evidenceQueryTooLong"));
      return;
    }

    clearRequest();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setSlow(false);

    slowTimerRef.current = setTimeout(() => {
      setSlow(true);
    }, 1500);

    searchEvidence(trimmed, { signal: controller.signal })
      .then((data) => {
        setResponse(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.kind === "aborted") {
          return;
        }
        setError(err instanceof ApiError ? err : new ApiError("network", "unknown", String(err)));
      })
      .finally(() => {
        setLoading(false);
        setSlow(false);
        if (slowTimerRef.current) {
          clearTimeout(slowTimerRef.current);
          slowTimerRef.current = null;
        }
        abortRef.current = null;
      });
  }

  function handleRetry() {
    handleSubmit();
  }

  const indexEmpty = response != null && response.index.indexedPassageCount === 0;
  const hasResults = response != null && response.results.length > 0;
  const hasContradictions = response != null && response.contradictions.length > 0;

  return (
    <div className="grid gap-4">
      <Surface variant="ghost">
        <p className="text-muted-foreground">{translate(locale, "evidenceIntro")}</p>
      </Surface>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          label={translate(locale, "evidenceQueryLabel")}
          placeholder={translate(locale, "evidenceQueryPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          error={validation ?? undefined}
          className="flex-1"
          containerClassName="flex-1"
        />
        <Button
          type="submit"
          isLoading={loading}
          loadingLabel={translate(locale, "evidenceSearching")}
          icon={<Search aria-hidden className="size-4" />}
          className="w-full sm:w-auto"
        >
          {translate(locale, "evidenceSearch")}
        </Button>
      </form>

      {loading && (
        <Surface variant="outline" className="items-center justify-center py-8 text-center">
          <p className="text-foreground">{translate(locale, "evidenceSearching")}</p>
          {slow && (
            <div className="mt-2 grid gap-2">
              <p className="text-sm text-muted-foreground">{translate(locale, "slow")}</p>
              <div>
                <Button variant="outline" size="sm" onClick={handleCancel} icon={<X aria-hidden className="size-4" />}>
                  {translate(locale, "requestCancelled")}
                </Button>
              </div>
            </div>
          )}
        </Surface>
      )}

      {error && !loading && <ApiErrorNotice error={error} locale={locale} onRetry={handleRetry} />}

      {response && !loading && (
        <>
          <Surface variant="outline">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <FileDigit aria-hidden className="size-4 text-muted-foreground" />
                <span className="font-medium">{translate(locale, "evidenceIndexState")}:</span>
                <span>{indexStateLabel(response.index.state, locale)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Hash aria-hidden className="size-4 text-muted-foreground" />
                <span>
                  {translate(locale, "evidenceIndexCounts", {
                    indexed: response.index.indexedPassageCount,
                    total: response.index.sourcePassageCount,
                  })}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Info aria-hidden className="size-4" />
                <span>
                  {translate(locale, "evidenceTokenizer")}: <span className="font-mono">{response.tokenizer}</span>
                </span>
              </span>
            </div>
          </Surface>

          {response.degradation && (
            <Surface variant="outline" className="border-status-warning/40 bg-status-warning/5">
              <div className="flex items-start gap-3">
                <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-status-warning" />
                <div>
                  <p className="font-medium text-foreground">{translate(locale, "evidenceDegradation")}</p>
                  <p className="text-foreground">{degradationText(response.degradation.reason, locale)}</p>
                  {/* The API hint is fixed English server text that repeats the localized
                      reason and empty-state body, so it is not rendered in either locale. */}
                </div>
              </div>
            </Surface>
          )}

          {hasContradictions && (
            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <Scale aria-hidden className="size-5 text-status-warning" />
                <h3 className="font-medium text-foreground">{translate(locale, "evidenceContradictions")}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{translate(locale, "evidenceContradictionsIntro")}</p>
              {response.contradictions.map((contradiction) => (
                <ContradictionCard key={contradiction.claimKey} contradiction={contradiction} locale={locale} />
              ))}
            </div>
          )}

          {indexEmpty && !hasResults && (
            <EmptyState
              title={translate(locale, "evidenceIndexEmptyTitle")}
              description={translate(locale, "evidenceIndexEmptyBody")}
            />
          )}

          {!indexEmpty && !hasResults && (
            <EmptyState
              title={translate(locale, "evidenceEmptyTitle")}
              description={translate(locale, "evidenceEmptyBody")}
            />
          )}

          {hasResults && (
            <div className="grid gap-3">
              <h3 className="font-medium text-foreground">
                {response.results.length === 1
                  ? translate(locale, "evidenceResultCountOne")
                  : translate(locale, "evidenceResultCount", { count: response.results.length })}
              </h3>
              <div className="grid gap-4">
                {response.results.map((result) => (
                  <ResultCard key={result.passageId} result={result} locale={locale} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!response && !loading && !error && (
        <EmptyState title={translate(locale, "emptyTitle")} description={translate(locale, "evidenceEnterQuery")} />
      )}
    </div>
  );
}

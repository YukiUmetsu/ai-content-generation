import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Database, ExternalLink, Info, Scale, Search, X } from "lucide-react";
import { ApiErrorNotice } from "./api-error-notice";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Surface } from "@/components/ui/surface-card";
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
  query?: string;
  onQueryChange?: (value: string) => void;
}

const MAX_QUERY_LENGTH = 500;

function safeExternalSourceUrl(uri: string): string | null {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

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
  const sourceUrl = safeExternalSourceUrl(result.source.canonicalUri);
  return (
    <Surface variant="solid" className="gap-0 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {showRank && <span className="rounded-full bg-track px-2.5 py-1 font-semibold text-foreground">
          {translate(locale, "evidenceRank", { rank: result.rank })}
        </span>}
        <span className="rounded-full border border-border px-2.5 py-1 capitalize">{result.source.sourceKind}</span>
        <span>{formatLocator(result.locator, locale)}</span>
      </div>
      {showMatchedPill && result.matched === false && (
        <p className="mt-3 text-xs text-status-warning">{translate(locale, "evidenceMatchedOnly")}</p>
      )}
      <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-foreground">{result.excerpt}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-foreground">{result.source.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[result.source.publisher, formatDateTimeUTC(result.version.retrievedAt)].filter(Boolean).join(" · ")}
          </p>
        </div>
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          aria-label={translate(locale, "evidenceOpenSource")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control px-2 py-2 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {translate(locale, "evidenceOpenSource")}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>}
      </div>
      <details className="group mt-3 rounded-control border border-border bg-surface-subtle">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {translate(locale, "evidenceSourceDetails")}
          <span aria-hidden className="ms-2 text-muted-foreground group-open:hidden">+</span>
          <span aria-hidden className="ms-2 hidden text-muted-foreground group-open:inline">−</span>
        </summary>
        <div className="grid gap-5 border-t border-border px-4 py-4 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-4">
            <span className="text-muted-foreground">{translate(locale, "evidenceVersionId")}</span>
            <span className="break-all font-mono text-xs">{result.version.id}</span>
            <span className="text-muted-foreground">{translate(locale, "evidenceHash")}</span>
            <span className="break-all font-mono text-xs" title={result.version.contentSha256}>
              {shortHash(result.version.contentSha256)}
            </span>
            <span className="text-muted-foreground">{translate(locale, "evidenceParser")}</span>
            <span>{result.version.parserVersion}</span>
            <span className="text-muted-foreground">{translate(locale, "evidenceSize")}</span>
            <span>{formatBytes(result.version.byteSize, locale)}</span>
            <span className="text-muted-foreground">{translate(locale, "evidenceRights")}</span>
            <span>{rightsLabel(result.provenance.rightsStatus, locale)}</span>
            {result.provenance.licenseNote && <>
              <span className="text-muted-foreground">{translate(locale, "evidenceLicense")}</span>
              <span className="break-words">{result.provenance.licenseNote}</span>
            </>}
            <span className="text-muted-foreground">{translate(locale, "evidenceSource")}</span>
            <span className="break-all">{result.source.canonicalUri}</span>
          </div>
          {result.claims.length > 0 && (
            <div>
              <h4 className="mb-2 font-semibold">{translate(locale, "evidenceClaims")}</h4>
              <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                {result.claims.map((claim) => <li key={claim.claimKey}>
                  <span className="text-foreground">{claim.claimKey}</span> · {stanceLabel(claim.stance, locale)}
                </li>)}
              </ul>
            </div>
          )}
          {result.numericValues.length > 0 && (
            <div className="grid gap-2">
              <h4 className="font-semibold">{translate(locale, "evidenceNumbers")}</h4>
              {result.numericValues.map((value, index) => <MetricValue key={index} value={value} locale={locale} />)}
            </div>
          )}
        </div>
      </details>
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

export function EvidencePanel({ locale, query: controlledQuery, onQueryChange }: EvidencePanelProps) {
  const [localQuery, setLocalQuery] = useState("");
  const query = controlledQuery ?? localQuery;
  const setQuery = onQueryChange ?? setLocalQuery;
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

  function handleSubmit(searchQuery = query) {
    setValidation(null);
    setError(null);
    setResponse(null);

    const trimmed = searchQuery.trim();
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
  const isDegraded = response?.degradation != null &&
    response.degradation.reason !== "index_empty" && response.degradation.reason !== "no_matches";

  return (
    <div className="grid gap-5">
      <header className="px-1 pt-4 sm:pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {translate(locale, "evidenceLibraryEyebrow")}
        </p>
        <h2 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {translate(locale, "evidenceLibraryHeading")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {translate(locale, "evidenceLibraryDescription")}
        </p>
      </header>

      <Surface variant="solid" className="gap-4 p-5 shadow-sm sm:p-6">
        <div role="search">
          <SearchField
            label={translate(locale, "evidenceQueryLabel")}
            placeholder={translate(locale, "evidenceQueryPlaceholder")}
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              if (validation) setValidation(null);
            }}
            onSearch={handleSubmit}
            onClear={() => {
              handleCancel();
              setResponse(null);
              setError(null);
              setValidation(null);
            }}
            error={validation ?? undefined}
            hint={translate(locale, "evidenceSearchHelp")}
            loading={loading}
            showSubmit
            submitLabel={translate(locale, "evidenceSearch")}
          />
        </div>
      </Surface>

      {loading && (
        <Surface variant="outline" className="items-center justify-center gap-3 py-10 text-center" role="status">
          <div aria-hidden className="size-7 animate-pulse rounded-full bg-track" />
          <p className="text-sm font-medium text-foreground">{translate(locale, "evidenceSearching")}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Database aria-hidden className="size-4 text-muted-foreground" />
                {translate(locale, "evidenceIndexState")}: {indexStateLabel(response.index.state, locale)}
              </span>
              <span className="text-muted-foreground">
                {translate(locale, "evidenceIndexCounts", {
                  indexed: response.index.indexedPassageCount,
                  total: response.index.sourcePassageCount,
                })}
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info aria-hidden className="size-3.5" />
              {translate(locale, "evidenceTokenizer")}: <span className="font-mono">{response.tokenizer}</span>
            </span>
          </div>

          {isDegraded && response.degradation && (
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
            <div className="rounded-surface border border-dashed border-border bg-surface px-6 py-12 text-center sm:py-16">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-track text-muted-foreground">
                <BookOpen aria-hidden className="size-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-semibold text-foreground">
                {translate(locale, "evidenceLibraryEmptyTitle")}
              </h3>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                {translate(locale, "evidenceLibraryEmptyBody")}
              </p>
              <p className="mx-auto mt-4 max-w-lg rounded-control bg-surface-subtle p-3 text-xs leading-5 text-muted-foreground">
                {translate(locale, "evidenceLibraryDraftNote")}
              </p>
            </div>
          )}

          {!indexEmpty && !hasResults && (
            <div className="rounded-surface border border-dashed border-border px-6 py-12 text-center">
              <Search aria-hidden className="mx-auto size-7 text-muted-foreground" />
              <h3 className="mt-4 font-serif text-xl font-semibold text-foreground">{translate(locale, "evidenceEmptyTitle")}</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{translate(locale, "evidenceEmptyBody")}</p>
            </div>
          )}

          {hasResults && (
            <div className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground">
                {response.results.length === 1
                  ? translate(locale, "evidenceResultCountOne")
                  : translate(locale, "evidenceResultCount", { count: response.results.length })}
              </h3>
              <div className="grid gap-3">
                {response.results.map((result) => (
                  <ResultCard key={result.passageId} result={result} locale={locale} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!response && !loading && !error && (
        <div className="rounded-surface border border-dashed border-border bg-surface-subtle px-6 py-12 text-center">
          <Search aria-hidden className="mx-auto size-7 text-muted-foreground" />
          <h3 className="mt-4 font-serif text-xl font-semibold text-foreground">{translate(locale, "evidenceLibraryInitialTitle")}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{translate(locale, "evidenceLibraryInitialBody")}</p>
        </div>
      )}
    </div>
  );
}

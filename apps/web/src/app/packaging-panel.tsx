import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { ApiErrorNotice } from "./api-error-notice";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { EmptyState } from "@/app/empty-state";
import { translate, formatDateTimeUTC, formatNumber } from "@/i18n/messages";
import { fetchPackagingHypothesisSet, ApiError } from "@/lib/api/client";
import type {
  MetricProvenanceKind,
  MetricValue,
  PackagingHypothesis,
  PackagingHypothesisSet,
  PackagingMetric,
  PackagingStatus,
  PackagingStrategy,
} from "@/lib/api/types";
import type { Locale } from "@/features/registry";

interface PackagingPanelProps {
  locale: Locale;
}

function statusLabel(status: PackagingStatus, locale: Locale): string {
  switch (status) {
    case "draft":
      return translate(locale, "packagingStatusDraft");
    case "approved":
      return translate(locale, "packagingStatusApproved");
    case "rejected":
      return translate(locale, "packagingStatusRejected");
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusBadgeClasses(status: PackagingStatus): string {
  switch (status) {
    case "draft":
      return "border-status-info/30 bg-status-info/10 text-status-info";
    case "approved":
      return "border-status-success/30 bg-status-success/10 text-status-success";
    case "rejected":
      return "border-status-danger/30 bg-status-danger/10 text-status-danger";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function strategyLabel(strategy: PackagingStrategy, locale: Locale): string {
  switch (strategy) {
    case "visible-cost-reversal":
      return translate(locale, "packagingStrategyVisibleCostReversal");
    case "mechanism-cutaway":
      return translate(locale, "packagingStrategyMechanismCutaway");
    case "decision-comparison":
      return translate(locale, "packagingStrategyDecisionComparison");
    case "everyday-mystery":
      return translate(locale, "packagingStrategyEverydayMystery");
    case "risk-escape":
      return translate(locale, "packagingStrategyRiskEscape");
    case "reality-check":
      return translate(locale, "packagingStrategyRealityCheck");
    case "concrete-reversal":
      return translate(locale, "packagingStrategyConcreteReversal");
    case "counterintuitive-mechanism":
      return translate(locale, "packagingStrategyCounterintuitiveMechanism");
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

function provenanceLabel(
  provenance: MetricProvenanceKind,
  locale: Locale,
): string {
  switch (provenance) {
    case "measured":
      return translate(locale, "packagingMeasured");
    case "estimated":
      return translate(locale, "packagingEstimated");
    case "unknown":
      return translate(locale, "packagingUnknown");
    default: {
      const _exhaustive: never = provenance;
      return _exhaustive;
    }
  }
}

function provenanceBadgeClasses(provenance: MetricProvenanceKind): string {
  switch (provenance) {
    case "measured":
      return "border-status-success/30 bg-status-success/10 text-status-success";
    case "estimated":
      return "border-status-warning/30 bg-status-warning/10 text-status-warning";
    case "unknown":
      return "border-border bg-surface-inset text-muted-foreground";
    default: {
      const _exhaustive: never = provenance;
      return _exhaustive;
    }
  }
}

function formatMetricValue(value: MetricValue, locale: Locale): string {
  switch (value.kind) {
    case "number":
      return formatNumber(value.value, locale);
    case "range":
      return `${formatNumber(value.low, locale)}–${formatNumber(value.high, locale)}`;
    case "text":
      return value.value;
    case "boolean":
      return value.value
        ? translate(locale, "packagingBooleanTrue")
        : translate(locale, "packagingBooleanFalse");
    case "unknown":
      return `— ${translate(locale, "packagingMetricValueUnknown")}`;
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{children}</dd>
    </div>
  );
}

function TextBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="break-words text-foreground">{children}</p>
    </div>
  );
}

function RefList({
  label,
  refs,
}: {
  label: string;
  refs: string[];
}) {
  if (refs.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <ul className="flex flex-wrap gap-2">
        {refs.map((ref) => (
          <li
            key={ref}
            className="max-w-full break-words rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-sm text-foreground"
          >
            {ref}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricRow({
  metric,
  locale,
}: {
  metric: PackagingMetric;
  locale: Locale;
}) {
  return (
    <li className="grid gap-2 rounded-control border border-border bg-surface-subtle px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words font-medium text-foreground">
          {metric.metricKey}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-sm font-medium ${provenanceBadgeClasses(metric.provenance)}`}
        >
          {provenanceLabel(metric.provenance, locale)}
        </span>
        <span className="break-words text-foreground">
          <span className="sr-only">{translate(locale, "packagingValue")}: </span>
          {formatMetricValue(metric.value, locale)}
        </span>
        {metric.unit && (
          <span className="break-words text-sm text-muted-foreground">
            <span className="sr-only">{translate(locale, "packagingUnit")}: </span>
            {metric.unit}
          </span>
        )}
      </div>
      {(metric.sourceVersionId || metric.observedAt || metric.method) && (
        <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          {metric.sourceVersionId && (
            <div className="grid gap-0.5">
              <dt className="font-medium">
                {translate(locale, "packagingSourceVersion")}
              </dt>
              <dd className="break-words text-foreground">
                {metric.sourceVersionId}
              </dd>
            </div>
          )}
          {metric.observedAt && (
            <div className="grid gap-0.5">
              <dt className="font-medium">
                {translate(locale, "packagingObservedAt")}
              </dt>
              <dd className="break-words text-foreground">
                {formatDateTimeUTC(metric.observedAt)}
              </dd>
            </div>
          )}
          {metric.method && (
            <div className="grid gap-0.5 sm:col-span-2">
              <dt className="font-medium">{translate(locale, "packagingMethod")}</dt>
              <dd className="break-words text-foreground">{metric.method}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

function HypothesisCard({
  index,
  hypothesis,
  locale,
}: {
  index: number;
  hypothesis: PackagingHypothesis;
  locale: Locale;
}) {
  return (
    <Surface
      variant="solid"
      header={
        <div className="grid gap-1">
          <p className="text-sm text-muted-foreground">
            {translate(locale, "packagingOption", { number: index + 1 })}
          </p>
          <h4 className="break-words font-serif text-lg text-foreground">
            {hypothesis.title}
          </h4>
        </div>
      }
    >
      <div className="grid gap-3">
        <div>
          <span className="inline-flex rounded-full border border-border bg-track px-2 py-0.5 text-sm text-muted-foreground">
            <span className="sr-only">
              {translate(locale, "packagingStrategy")}:{" "}
            </span>
            {strategyLabel(hypothesis.strategy, locale)}
          </span>
        </div>

        <TextBlock label={translate(locale, "packagingThumbnailConcept")}>
          {hypothesis.thumbnailConcept}
        </TextBlock>

        <TextBlock label={translate(locale, "packagingOpening")}>
          {hypothesis.openingVisual}
        </TextBlock>

        <div className="grid gap-1 rounded-control border border-border bg-surface-subtle p-3">
          <p className="text-sm font-medium text-muted-foreground">
            {translate(locale, "packagingPayoff")}
          </p>
          <p className="break-words text-foreground">
            {hypothesis.payoffEventId}
          </p>
          <p className="text-sm text-muted-foreground">
            {translate(locale, "packagingPayoffDischarges")}
          </p>
        </div>

        <RefList
          label={translate(locale, "packagingClaimRefs")}
          refs={hypothesis.claimRefs}
        />
      </div>
    </Surface>
  );
}

export function PackagingPanel({ locale }: PackagingPanelProps) {
  const [set, setSet] = useState<PackagingHypothesisSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
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

  const startRequest = useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    slowTimerRef.current = setTimeout(() => {
      setSlow(true);
    }, 1500);

    fetchPackagingHypothesisSet({ signal: controller.signal })
      .then((data) => {
        setSet(data);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.kind === "aborted") {
          return;
        }
        setError(
          err instanceof ApiError
            ? err
            : new ApiError("network", "unknown", String(err)),
        );
      })
      .finally(() => {
        if (abortRef.current !== controller) {
          return;
        }
        abortRef.current = null;
        setLoading(false);
        setSlow(false);
        if (slowTimerRef.current) {
          clearTimeout(slowTimerRef.current);
          slowTimerRef.current = null;
        }
      });
  }, []);

  const load = useCallback(() => {
    clearRequest();
    setLoading(true);
    setSlow(false);
    setCancelled(false);
    setError(null);
    setSet(null);
    startRequest();
  }, [clearRequest, startRequest]);

  useEffect(() => {
    // Initial state is already `loading`; start the request without a
    // synchronous setState in the effect body.
    startRequest();
    return clearRequest;
  }, [startRequest, clearRequest]);

  function handleCancel() {
    clearRequest();
    setLoading(false);
    setSlow(false);
    setCancelled(true);
  }

  const notImplemented =
    error !== null &&
    (error.code === "not_implemented" || error.status === 501);

  return (
    <div className="grid gap-4">
      <Surface variant="ghost">
        <h2 className="font-serif text-lg text-foreground">
          {translate(locale, "packagingTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate(locale, "packagingIntro")}
        </p>
      </Surface>

      {loading && (
        <Surface
          variant="outline"
          className="items-center justify-center py-8 text-center"
          role="status"
          aria-live="polite"
        >
          <Loader2
            aria-hidden
            className="mx-auto size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
          <p className="mt-2 text-foreground">
            {translate(locale, "packagingLoading")}
          </p>
          {slow && (
            <p className="mt-1 text-sm text-muted-foreground">
              {translate(locale, "slow")}
            </p>
          )}
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              icon={<X aria-hidden className="size-4" />}
            >
              {translate(locale, "packagingCancel")}
            </Button>
          </div>
        </Surface>
      )}

      {error && !loading && (
        <ApiErrorNotice
          error={error}
          locale={locale}
          onRetry={load}
          title={
            notImplemented
              ? translate(locale, "packagingNotImplementedTitle")
              : undefined
          }
          message={
            notImplemented
              ? translate(locale, "packagingNotImplementedBody")
              : translate(locale, "packagingErrorBody")
          }
          hideHint={notImplemented}
        />
      )}

      {cancelled && !loading && !error && (
        <div className="grid gap-3">
          <EmptyState
            title={translate(locale, "packagingCancelledTitle")}
            description={translate(locale, "packagingCancelledBody")}
          />
          <div>
            <Button
              variant="secondary"
              onClick={load}
              icon={<RotateCcw aria-hidden className="size-4" />}
            >
              {translate(locale, "retry")}
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && !cancelled && !set && (
        <EmptyState
          title={locale === "ja" ? "保存済みのパッケージ案はありません" : "No saved packaging concepts yet"}
          description={locale === "ja"
            ? "このタブにはローカルデータベースに保存された構成・サムネイル・導入案が表示されます。生成・承認機能は今後の実装対象です。サンプルデータは自動表示しません。"
            : "This tab shows actual title, thumbnail, and opening hypotheses saved in your local database. Packaging authoring and approval are still upcoming; sample concepts are never substituted for your work."}
        />
      )}

      {set && !loading && !error && (
        <div className="grid gap-4">
          <Surface
            variant="solid"
            header={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-serif text-lg text-foreground">
                  {translate(locale, "packagingSet")}
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={load}
                  icon={<RotateCcw aria-hidden className="size-4" />}
                >
                  {translate(locale, "refresh")}
                </Button>
              </div>
            }
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={translate(locale, "id")}>
                <span className="break-words">{set.id}</span>
              </Detail>
              <Detail label={translate(locale, "status")}>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-sm font-medium ${statusBadgeClasses(set.status)}`}
                >
                  {statusLabel(set.status, locale)}
                </span>
              </Detail>
              <Detail label={translate(locale, "packagingProjectRef")}>
                <span className="break-words">{set.projectRef}</span>
              </Detail>
              <Detail label={translate(locale, "packagingCreatedAt")}>
                {formatDateTimeUTC(set.createdAt)}
              </Detail>
              {set.approvedAt && (
                <Detail label={translate(locale, "packagingApprovedAt")}>
                  {formatDateTimeUTC(set.approvedAt)}
                </Detail>
              )}
            </dl>
          </Surface>

          <Surface
            variant="outline"
            header={
              <h3 className="font-serif text-lg text-foreground">
                {translate(locale, "packagingPremiseSetup")}
              </h3>
            }
          >
            <div className="grid gap-3">
              <TextBlock label={translate(locale, "packagingQuestion")}>
                {set.premiseSetup.question}
              </TextBlock>
              <TextBlock label={translate(locale, "packagingAudienceStakes")}>
                {set.premiseSetup.audienceStakes}
              </TextBlock>
              <TextBlock label={translate(locale, "packagingOpeningPromise")}>
                {set.premiseSetup.openingPromise}
              </TextBlock>
              <RefList
                label={translate(locale, "packagingEvidenceRefs")}
                refs={set.premiseSetup.evidenceRefs}
              />
            </div>
          </Surface>

          <Surface
            variant="outline"
            header={
              <h3 className="font-serif text-lg text-foreground">
                {translate(locale, "packagingPremisePayoff")}
              </h3>
            }
          >
            <div className="grid gap-3">
              <TextBlock label={translate(locale, "packagingPayoffStatement")}>
                {set.premisePayoff.payoffStatement}
              </TextBlock>
              <TextBlock label={translate(locale, "packagingLimitation")}>
                {set.premisePayoff.limitation}
              </TextBlock>
              <TextBlock label={translate(locale, "packagingAnswerEvent")}>
                <span className="break-words">
                  {set.premisePayoff.answerEventId}
                </span>
              </TextBlock>
              <RefList
                label={translate(locale, "packagingEvidenceRefs")}
                refs={set.premisePayoff.evidenceRefs}
              />
            </div>
          </Surface>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-serif text-lg text-foreground">
                {translate(locale, "packagingHypotheses")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {translate(locale, "packagingHypothesisCount", {
                  count: set.hypotheses.length,
                })}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {set.hypotheses.map((hypothesis, index) => (
                <HypothesisCard
                  key={hypothesis.hypothesisId}
                  index={index}
                  hypothesis={hypothesis}
                  locale={locale}
                />
              ))}
            </div>
            {set.hypotheses.length < 3 && (
              <Surface
                variant="outline"
                className="border-status-warning/40 bg-status-warning/5"
              >
                <p className="text-sm text-status-warning">
                  {translate(locale, "packagingFewHypotheses")}
                </p>
              </Surface>
            )}
          </section>

          <section className="grid gap-3">
            <h3 className="font-serif text-lg text-foreground">
              {translate(locale, "packagingMetrics")}
            </h3>
            <Surface variant="outline">
              {set.metrics.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {translate(locale, "packagingNoMetrics")}
                </p>
              ) : (
                <ul className="grid gap-3">
                  {set.metrics.map((metric) => (
                    <MetricRow
                      key={metric.metricKey}
                      metric={metric}
                      locale={locale}
                    />
                  ))}
                </ul>
              )}
            </Surface>
          </section>
        </div>
      )}
    </div>
  );
}

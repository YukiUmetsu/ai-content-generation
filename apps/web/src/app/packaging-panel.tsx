import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  FileText,
  Image,
  Info,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { ApiErrorNotice } from "./api-error-notice";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { EmptyState } from "@/app/empty-state";
import { translate, formatDateTimeUTC } from "@/i18n/messages";
import { generatePackaging, ApiError } from "@/lib/api/client";
import { demoBrief } from "@/features/packaging/demoBrief";
import type {
  AnswerStatus,
  EvidenceRole,
  CuriosityMechanism,
  StoryEngine,
  ThumbnailComposition,
  HookStrategy,
  PackagingEvidenceRef,
  PackagingFormat,
  PackagingHypothesis,
  PackagingHypothesisSet,
  PackagingTitleCandidate,
} from "@/lib/api/types";
import type { Locale } from "@/features/registry";

interface PackagingPanelProps {
  locale: Locale;
}

function answerStatusLabel(status: AnswerStatus, locale: Locale): string {
  switch (status) {
    case "requires_scenario_model":
      return translate(locale, "packagingAnswerStatusRequiresScenarioModel");
    case "supported_by_evidence":
      return translate(locale, "packagingAnswerStatusSupportedByEvidence");
    case "open":
      return translate(locale, "packagingAnswerStatusOpen");
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function formatLabel(format: PackagingFormat, locale: Locale): string {
  return format === "long_form"
    ? translate(locale, "packagingFormatLong")
    : translate(locale, "packagingFormatShort");
}

function roleLabel(role: EvidenceRole, locale: Locale): string {
  switch (role) {
    case "price_anchor":
      return translate(locale, "packagingRolePriceAnchor");
    case "hidden_component":
      return translate(locale, "packagingRoleHiddenComponent");
    case "comparison_baseline":
      return translate(locale, "packagingRoleComparison");
    case "assumption":
      return translate(locale, "packagingRoleAssumption");
    case "market_context":
      return translate(locale, "packagingRoleMarket");
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

function mechanismLabel(mechanism: CuriosityMechanism, locale: Locale): string {
  switch (mechanism) {
    case "cost_reversal":
      return translate(locale, "packagingMechanismCostReversal");
    case "mechanism_cutaway":
      return translate(locale, "packagingMechanismCutaway");
    case "decision_comparison":
      return translate(locale, "packagingMechanismDecision");
    case "contradiction":
      return translate(locale, "packagingMechanismContradiction");
    case "risk_escape":
      return translate(locale, "packagingMechanismRisk");
    default: {
      const _exhaustive: never = mechanism;
      return _exhaustive;
    }
  }
}

function engineLabel(engine: StoryEngine, locale: Locale): string {
  switch (engine) {
    case "cost_revelation":
      return translate(locale, "packagingEngineCost");
    case "engineering_experiment":
      return translate(locale, "packagingEngineExperiment");
    case "decision_showdown":
      return translate(locale, "packagingEngineDecision");
    case "mystery_investigation":
      return translate(locale, "packagingEngineMystery");
    case "failure_investigation":
      return translate(locale, "packagingEngineFailure");
    default: {
      const _exhaustive: never = engine;
      return _exhaustive;
    }
  }
}

function compositionLabel(composition: ThumbnailComposition, locale: Locale): string {
  switch (composition) {
    case "number_reversal":
      return translate(locale, "packagingCompositionNumber");
    case "exploded_cutaway":
      return translate(locale, "packagingCompositionCutaway");
    case "a_vs_b":
      return translate(locale, "packagingCompositionAvB");
    case "hero_object":
      return translate(locale, "packagingCompositionHero");
    case "before_after":
      return translate(locale, "packagingCompositionBeforeAfter");
    default: {
      const _exhaustive: never = composition;
      return _exhaustive;
    }
  }
}

function hookLabel(strategy: HookStrategy, locale: Locale): string {
  switch (strategy) {
    case "result_first":
      return translate(locale, "packagingHookResult");
    case "contradiction_first":
      return translate(locale, "packagingHookContradiction");
    case "stakes_first":
      return translate(locale, "packagingHookStakes");
    case "mechanism_reveal":
      return translate(locale, "packagingHookMechanism");
    case "decision_threshold":
      return translate(locale, "packagingHookDecision");
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

function titleRoleLabel(candidate: PackagingTitleCandidate, locale: Locale): string {
  return candidate.role === "searchable"
    ? translate(locale, "packagingSearchable")
    : translate(locale, "packagingIntriguing");
}

function measurementBadgeClasses(status: "measured" | "estimated" | "unknown"): string {
  switch (status) {
    case "measured":
      return "bg-status-success/10 text-status-success border-status-success/30";
    case "estimated":
      return "bg-status-warning/10 text-status-warning border-status-warning/30";
    case "unknown":
      return "bg-surface-inset text-muted-foreground border-border";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function EvidenceRefRow({
  evidence,
  locale,
}: {
  evidence: PackagingEvidenceRef;
  locale: Locale;
}) {
  return (
    <div className="grid gap-1 rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{evidence.claim}</span>
        <span className={`rounded-full border px-2 py-0.5 text-sm font-medium ${measurementBadgeClasses(evidence.measurement.status)}`}>
          {evidence.measurement.status}
        </span>
      </div>
      <p className="text-muted-foreground">{evidence.source_title}</p>
      <div className="flex flex-wrap gap-x-3 text-muted-foreground">
        <span>
          {translate(locale, "packagingEvidenceRole")}: {roleLabel(evidence.role, locale)}
        </span>
        {evidence.measurement.value != null && (
          <span>
            {translate(locale, "packagingMeasurement")}: {evidence.measurement.value}
            {evidence.measurement.unit ? ` ${evidence.measurement.unit}` : ""}
          </span>
        )}
      </div>
      {evidence.measurement.estimate_basis && (
        <p className="text-muted-foreground">
          {translate(locale, "packagingEstimateBasis")}: {evidence.measurement.estimate_basis}
        </p>
      )}
      {evidence.source_url && (
        <a
          href={evidence.source_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-status-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {translate(locale, "packagingSourceLink")}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
    </div>
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
  const accentColors = [
    "border-l-status-info",
    "border-l-status-success",
    "border-l-status-warning",
  ];
  const accent = accentColors[index % accentColors.length];

  return (
    <Surface
      variant="solid"
      className={`gap-3 border-l-4 ${accent}`}
      header={
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            {translate(locale, "packagingOption", { number: index + 1 })}
          </p>
          <h3 className="font-serif text-xl text-foreground">{hypothesis.variant_key}</h3>
        </div>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-track px-2 py-0.5 text-sm text-muted-foreground">
            {mechanismLabel(hypothesis.curiosity_mechanism, locale)}
          </span>
          <span className="rounded-full bg-track px-2 py-0.5 text-sm text-muted-foreground">
            {engineLabel(hypothesis.story_engine, locale)}
          </span>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">{translate(locale, "packagingPremise")}</p>
          <p className="text-foreground">{hypothesis.premise.statement}</p>
        </div>

        <div className="rounded-control border border-border bg-surface-subtle p-3">
          <p className="text-sm font-medium text-muted-foreground">{translate(locale, "packagingOpening")}</p>
          <p className="mt-1 text-foreground">{hypothesis.opening_beat.narration}</p>
          <p className="mt-1 text-sm text-muted-foreground">{hypothesis.opening_beat.visual}</p>
        </div>

        {hypothesis.payoff_beat ? (
          <div className="rounded-control border border-border bg-surface-subtle p-3">
            <p className="text-sm font-medium text-muted-foreground">{translate(locale, "packagingPayoff")}</p>
            <p className="mt-1 text-foreground">{hypothesis.payoff_beat.narration}</p>
            <p className="mt-1 text-sm text-muted-foreground">{hypothesis.payoff_beat.visual}</p>
            {hypothesis.payoff_beat.conditions.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {translate(locale, "packagingConditions")}
                </p>
                <ul className="list-disc space-y-1 ps-4 text-sm text-foreground">
                  {hypothesis.payoff_beat.conditions.map((condition, i) => (
                    <li key={i}>{condition}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-control border border-status-warning/30 bg-status-warning/5 p-3">
            <p className="text-sm text-status-warning">{translate(locale, "packagingPayoffMissing")}</p>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-muted-foreground">{translate(locale, "packagingHook")}</p>
          <p className="text-foreground">{hypothesis.hook.line}</p>
          <p className="text-sm text-muted-foreground">
            {hookLabel(hypothesis.hook.strategy, locale)} ·{" "}
            {translate(locale, "packagingHookTarget", { seconds: hypothesis.hook.seconds_target })}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">{translate(locale, "packagingTitles")}</p>
          <ul className="mt-1 grid gap-1">
            {hypothesis.title_candidates.map((candidate, i) => (
              <li key={i} className="flex items-start gap-2 text-foreground">
                <span className="rounded-full bg-track px-2 py-0.5 text-sm text-muted-foreground">
                  {titleRoleLabel(candidate, locale)}
                </span>
                <span className="break-words">{candidate.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-control border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Image aria-hidden className="size-4" />
            {translate(locale, "packagingThumbnail")}
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <dt>{translate(locale, "packagingComposition")}</dt>
            <dd className="text-foreground">
              {compositionLabel(hypothesis.thumbnail_concept.composition, locale)}
            </dd>
            <dt>{translate(locale, "packagingFocal")}</dt>
            <dd className="text-foreground">{hypothesis.thumbnail_concept.focal_subject}</dd>
            <dt>{translate(locale, "packagingTension")}</dt>
            <dd className="text-foreground">{hypothesis.thumbnail_concept.visual_tension}</dd>
            <dt>{translate(locale, "packagingOverlay")}</dt>
            <dd className="text-foreground">{hypothesis.thumbnail_concept.overlay_text}</dd>
            <dt>{translate(locale, "packagingColorRoles")}</dt>
            <dd className="text-foreground">{hypothesis.thumbnail_concept.color_roles.join(" / ")}</dd>
          </dl>
        </div>

        {hypothesis.claim_evidence_ids.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground">{translate(locale, "packagingEvidence")}</p>
            <p className="break-words text-sm text-muted-foreground">
              {hypothesis.claim_evidence_ids.join(", ")}
            </p>
          </div>
        )}
      </div>
    </Surface>
  );
}

export function PackagingPanel({ locale }: PackagingPanelProps) {
  const [result, setResult] = useState<PackagingHypothesisSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
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

  useEffect(() => {
    return () => clearRequest();
  }, [clearRequest]);

  function handleCancel() {
    clearRequest();
    setLoading(false);
    setSlow(false);
  }

  function handleGenerate() {
    setError(null);
    setResult(null);
    clearRequest();

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setSlow(false);

    slowTimerRef.current = setTimeout(() => {
      setSlow(true);
    }, 1500);

    generatePackaging(demoBrief, { signal: controller.signal })
      .then((data) => {
        if (data.hypotheses.length !== 3) {
          setError(
            new ApiError(
              "invalid_payload",
              "unexpected_payload",
              translate(locale, "packagingExactThree"),
            ),
          );
          return;
        }
        setResult(data);
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

  return (
    <div className="grid gap-4">
      <Surface variant="ghost">
        <p className="text-muted-foreground">{translate(locale, "packagingIntro")}</p>
      </Surface>

      <Surface variant="outline">
        <div className="flex items-start gap-3">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-status-info" />
          <div>
            <p className="font-medium text-foreground">{translate(locale, "packagingBrief")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{translate(locale, "packagingBriefBody")}</p>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {demoBrief.brief.promise_question}
            </p>
          </div>
        </div>
      </Surface>

      {!loading && (
        <div>
          <Button
            onClick={handleGenerate}
            icon={<Sparkles aria-hidden className="size-4" />}
            disabled={loading}
          >
            {translate(locale, "packagingGenerate")}
          </Button>
        </div>
      )}

      {!result && !loading && !error && (
        <EmptyState
          title={translate(locale, "packagingEmptyTitle")}
          description={translate(locale, "packagingEmptyBody")}
        />
      )}

      {loading && (
        <Surface variant="outline" className="items-center justify-center py-8 text-center">
          <Loader2 aria-hidden className="mx-auto size-6 animate-spin text-muted-foreground" />
          <p className="mt-2 text-foreground">{translate(locale, "packagingGenerating")}</p>
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

      {error && !loading && (
        <ApiErrorNotice
          error={error}
          locale={locale}
          onRetry={handleGenerate}
          title={
            error.code === "unsupported_virality_claim"
              ? translate(locale, "packagingFailedTitle")
              : undefined
          }
          message={
            error.code === "unsupported_virality_claim"
              ? translate(locale, "packagingViralityRefused")
              : undefined
          }
          hideHint={error.code === "unsupported_virality_claim"}
        />
      )}

      {result && !loading && (
        <div className="grid gap-4">
          <div>
            <h3 className="mb-3 font-medium text-foreground">
              {translate(locale, "packagingHypothesisCount", { count: result.hypotheses.length })}
            </h3>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {result.hypotheses.map((hypothesis, index) => (
                <HypothesisCard key={hypothesis.hypothesis_id} index={index} hypothesis={hypothesis} locale={locale} />
              ))}
            </div>
          </div>

          <Surface variant="outline">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-track px-2 py-0.5 text-sm text-muted-foreground">
                  {translate(locale, "packagingSet")}: {result.set_id}
                </span>
                <span className="rounded-full bg-track px-2 py-0.5 text-sm text-muted-foreground">
                  {result.audience.market} · {result.audience.intent} · {formatLabel(result.audience.format, locale)}
                </span>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {translate(locale, "packagingQuestion")}
                </p>
                <p className="text-foreground">{result.promise.question}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {translate(locale, "packagingAnswerStatus")}
                </p>
                <p className="text-foreground">
                  {answerStatusLabel(result.promise.answer_status, locale)}
                </p>
              </div>

              <div className="grid gap-1">
                <p className="text-sm font-medium text-muted-foreground">
                  {translate(locale, "packagingCannotAssert")}
                </p>
                <p className="text-foreground">{result.promise.cannot_assert}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {result.creative_constraints.genuine_variety_required && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-status-info/30 bg-status-info/10 px-2 py-0.5 text-sm text-status-info">
                    <Check aria-hidden className="size-3.5" />
                    {translate(locale, "packagingVariety")}
                  </span>
                )}
                {result.creative_constraints.no_virality_claim && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-status-success/30 bg-status-success/10 px-2 py-0.5 text-sm text-status-success">
                    <Check aria-hidden className="size-3.5" />
                    {translate(locale, "packagingNoVirality")}
                  </span>
                )}
              </div>

              <div className="grid gap-1 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium">{translate(locale, "packagingProvenance")}:</span>{" "}
                  {result.provenance.generator_id} {result.provenance.generator_version}
                </p>
                <p>
                  <span className="font-medium">{translate(locale, "packagingDeterministic")}:</span>{" "}
                  {result.provenance.deterministic
                    ? locale === "ja" ? "はい" : "Yes"
                    : locale === "ja" ? "いいえ" : "No"}
                </p>
                {result.provenance.generated_at && (
                  <p>
                    <span className="font-medium">{translate(locale, "packagingGeneratedAt")}:</span>{" "}
                    {formatDateTimeUTC(result.provenance.generated_at)}
                  </p>
                )}
              </div>
            </div>
          </Surface>

          {result.evidence.length > 0 && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <FileText aria-hidden className="size-5 text-muted-foreground" />
                <h3 className="font-medium text-foreground">{translate(locale, "packagingEvidence")}</h3>
              </div>
              <div className="grid gap-2">
                {result.evidence.map((evidence) => (
                  <EvidenceRefRow key={evidence.evidence_id} evidence={evidence} locale={locale} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Info, TrendingDown, TrendingUp } from "lucide-react";
import type { Locale } from "@/features/registry";
import type { IdeaGoogleTrends, IdeaMarketAssessment, ViralPotential } from "@/lib/api/discovery-sessions";
import type { IdeaVideoFormat } from "./idea-market-comparison";

const tr = (locale: Locale, en: string, ja: string) => locale === "ja" ? ja : en;

const compact = (value: number, locale: Locale) => new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US",
  { notation: "compact", maximumFractionDigits: 1 }).format(value);

function verdict(score: number | null, locale: Locale): string {
  if (score === null) return tr(locale, "Awaiting evidence", "データ待ち");
  if (score >= 70) return tr(locale, "Strong signals", "良好な兆候");
  if (score >= 45) return tr(locale, "Mixed signals", "判断が分かれる兆候");
  return tr(locale, "Limited signals", "弱い兆候");
}

function Ring({ score, large = false }: { score: number | null; large?: boolean }) {
  const reduceMotion = useReducedMotion();
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  const offset = score === null ? circumference : circumference * (1 - score / 100);
  return <span className={`relative inline-flex shrink-0 items-center justify-center ${large ? "size-[76px]" : "size-[64px]"}`}
    aria-hidden="true">
    <svg viewBox="0 0 72 72" className="size-full -rotate-90 overflow-visible">
      <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" strokeWidth="5.5"
        className="text-border" />
      {score !== null && <motion.circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor"
        strokeWidth="5.5" strokeLinecap="round" className="text-primary"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: reduceMotion ? offset : circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }} />}
    </svg>
    <span className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums tracking-tight ${large ? "text-2xl" : "text-xl"}`}>
      {score ?? "—"}
    </span>
  </span>;
}

function Factor({ name, value, weight, note, locale }: {
  name: string; value: number | null; weight: string; note: string; locale: Locale;
}) {
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="font-medium text-foreground">{name} <span className="font-normal text-muted-foreground">· {weight}</span></span>
      <span className="font-semibold tabular-nums text-foreground">{value === null
        ? tr(locale, "Unavailable", "データなし") : `${Math.round(value)}/100`}</span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {value !== null && <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
        style={{ width: `${value}%` }} />}
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">{note}</p>
  </div>;
}

export interface ViralScoreProps {
  potential: ViralPotential | null | undefined;
  assessment: IdeaMarketAssessment | null | undefined;
  googleTrends: IdeaGoogleTrends | null | undefined;
  format: IdeaVideoFormat;
  locale: Locale;
}

/** A compact score with a keyboard/touch-accessible, collision-aware evidence panel. */
export function ViralScore({ potential, assessment, googleTrends, format, locale }: ViralScoreProps) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  // Never display a saved long-form score when the user is comparing Shorts, or
  // a legacy editorial score as a viral score. Wait for real same-format data.
  const matching = potential?.format === format ? potential : null;
  const score = matching?.score ?? null;
  const coverage = matching?.coveragePercent ?? 0;
  const youtube = matching?.youtubeScore ?? null;
  const trends = matching?.trendScore ?? null;
  const momentum = matching?.trendChangePercent ?? null;
  const partial = score !== null && matching?.state === "partial";
  const sample = assessment?.format === format ? assessment : null;
  const change = momentum === null ? null : `${momentum > 0 ? "+" : ""}${compact(momentum, locale)}%`;

  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger openOnHover delay={180} render={<button type="button"
      aria-label={tr(locale,
        `Viral score: ${score === null ? "insufficient data" : `${score} out of 100`}. Open evidence breakdown.`,
        `バイラルスコア: ${score === null ? "データ不足" : `${score} / 100`}。評価の根拠を開く。`)}
      className="group inline-flex min-h-[70px] shrink-0 items-center gap-2 rounded-xl border border-border/80 bg-surface-subtle px-2.5 py-1.5 text-left transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/40 hover:bg-surface-elevated hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      <Ring score={score} />
      <span className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">
          {tr(locale, "Viral score", "バイラルスコア")}</span>
        <span className="text-xs font-medium text-foreground">{verdict(score, locale)}</span>
        <span className="text-[11px] text-muted-foreground">{score === null
          ? tr(locale, "Needs YouTube data", "YouTube データが必要")
          : partial ? tr(locale, "Partial evidence", "一部のデータのみ")
            : tr(locale, "Measured signals", "実測データ")}</span>
      </span>
      <Info className="ml-0.5 size-3.5 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
    </button>} />
    <AnimatePresence>
      {open && <PopoverPrimitive.Portal key="viral-score-panel">
        <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={8}
          className="z-50 max-w-[var(--available-width)]">
          <motion.div initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.98, y: reducedMotion ? 0 : -3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98, y: reducedMotion ? 0 : -3 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}>
            <PopoverPrimitive.Popup aria-label={tr(locale, "Viral score evidence", "バイラルスコアの根拠")}
              className="w-[min(22rem,calc(100vw-2rem))] max-h-[var(--available-height)] overflow-y-auto rounded-2xl border border-border bg-surface-floating p-4 text-foreground shadow-xl focus:outline-none">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold">{tr(locale, "Viral potential", "バイラルの可能性")}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{verdict(score, locale)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {tr(locale, `${coverage}% signal coverage · ${format === "long" ? "Long-form" : "Shorts"}`,
                      `データ充足率 ${coverage}% · ${format === "long" ? "長尺" : "ショート"}`)}</p>
                </div>
                <Ring score={score} large />
              </div>

              <div className="mt-3 space-y-3.5">
                <Factor locale={locale} name={tr(locale, "YouTube performance", "YouTube の実績")}
                  value={youtube} weight={score !== null && trends === null ? "100%" : "75%"} note={youtube === null
                    ? tr(locale, "Requires 8 usable videos, 3 channels and 3 comparable ideas in this format.",
                      "同形式の動画8件、チャンネル3件、比較対象3案が必要です。")
                    : tr(locale, `${matching?.sampleSize ?? 0} videos · ${matching?.distinctChannels ?? 0} channels · ${matching?.comparisonCohortSize ?? 0} ideas. Ranked by median lifetime views/day.`,
                      `動画 ${matching?.sampleSize ?? 0} 件 · チャンネル ${matching?.distinctChannels ?? 0} 件 · 比較対象 ${matching?.comparisonCohortSize ?? 0} 案。累計再生数の日割中央値で比較。`)} />
                <Factor locale={locale} name={tr(locale, "Search momentum", "検索の勢い")}
                  value={trends} weight={trends === null ? tr(locale, "not counted", "対象外") : "25%"} note={change === null
                    ? tr(locale, "Google Trends needs 26 valid weeks; unavailable data is not counted as zero.",
                      "Google Trends は有効な26週分が必要です。取得不可をゼロとはみなしません。")
                    : tr(locale, `${change} in Google search interest, last 13 vs previous 13 weeks.`,
                      `Google 検索関心度 ${change}（直近13週と前の13週の比較）。`)} />
              </div>

              {(matching?.youtubeObservedAt != null || matching?.trendsObservedAt != null) &&
                <p className="mt-3 text-[11px] text-muted-foreground">{tr(locale, "Observed", "取得日")}: {
                  [matching.youtubeObservedAt, matching.trendsObservedAt]
                    .filter((value): value is number => typeof value === "number" && value > 0)
                    .map(value => new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US",
                      { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(value * 1000))
                    .filter((value, index, values) => values.indexOf(value) === index).join(" · ")
                }</p>}

              {sample?.state === "succeeded" && sample.medianViewsPerDay !== null &&
                <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-subtle px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{tr(locale, "Median views/day", "再生数の日割中央値")}</span>
                  <span className="font-semibold tabular-nums">{compact(sample.medianViewsPerDay, locale)}</span>
                </div>}

              <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/70 bg-surface-subtle p-2.5">
                {momentum !== null && momentum >= 0
                  ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  : momentum !== null ? <TrendingDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    : <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <p className="text-[11px] leading-relaxed text-muted-foreground">{score === null
                  ? tr(locale, "No viral score yet. Collect enough comparable YouTube evidence to evaluate this idea.",
                    "まだバイラルスコアはありません。比較できる YouTube データが必要です。")
                  : partial ? tr(locale, "YouTube-only estimate. Trends is missing, so confidence is limited.",
                    "YouTube のみの評価です。検索トレンドが不足しているため、確度は限定的です。")
                    : tr(locale, "Both signals are available. This compares observed opportunity, not future views.",
                      "両方のデータを取得済みです。観測された機会の比較であり、将来の再生数予測ではありません。")}</p>
              </div>

              <details className="group/method mt-3 border-t border-border/70 pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {tr(locale, "How this score works", "スコアの計算方法")}
                  <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open/method:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                </summary>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{tr(locale,
                  "When both signals exist: 75% YouTube within-session, same-format percentile + 25% Google Trends change (−100% to +100% mapped to 0–100). With Trends missing, show only the YouTube percentile and mark the result partial. Trends indices are normalized per query, not search volume. This is a heuristic, not a prediction of virality or revenue.",
                  "両方ある場合は、同一セッション・同形式の YouTube 百分位75%と、Google Trends の変化率25%（−100%〜+100%を0〜100に変換）を合成します。トレンドがない場合は YouTube のみを表示し、部分的な評価と明記します。Trends は検索語ごとに正規化され、検索量ではありません。再生数や収益の予測ではありません。")}</p>
                {sample?.query && <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">
                  {tr(locale, "YouTube query", "YouTube 検索語")}: {sample.query}</p>}
                {googleTrends?.query && <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
                  {tr(locale, "Trends query", "Trends 検索語")}: {googleTrends.query}</p>}
                <p className="mt-2 text-[10px] text-muted-foreground">{matching?.scoreVersion ?? "viral-potential-v1"}</p>
              </details>
            </PopoverPrimitive.Popup>
          </motion.div>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>}
    </AnimatePresence>
  </PopoverPrimitive.Root>;
}

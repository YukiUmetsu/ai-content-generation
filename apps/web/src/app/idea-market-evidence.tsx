import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, ChevronDown, LoaderCircle, RotateCw } from "lucide-react";
import type { Locale } from "@/features/registry";
import { validIdeaMarketQuery, type IdeaMarketAssessment } from "@/lib/api/discovery-sessions";
import type { MarketStatus } from "@/lib/api/market";
import { marketErrorHint } from "./market-error-hint";
import { usableComparison, type IdeaVideoFormat } from "./idea-market-comparison";
import "./idea-market-evidence.css";

const tr = (locale: Locale, en: string, ja: string) => locale === "ja" ? ja : en;
const fmt = (number: number, locale: Locale, maximumFractionDigits = 1) => new Intl.NumberFormat(
  locale === "ja" ? "ja-JP" : "en-US", { notation: "compact", maximumFractionDigits },
).format(number);
const date = (seconds: number, locale: Locale) => new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US",
  { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(seconds * 1000);
const validVideoLink = (videoId: string, sourceUrl: string) => {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  return sourceUrl === canonical ? canonical : null;
};

interface IdeaMarketEvidenceProps {
  ideaId: string;
  title: string;
  locale: Locale;
  format: IdeaVideoFormat;
  assessment: IdeaMarketAssessment | null | undefined;
  status: MarketStatus | null;
  statusError: string | null;
  collecting: boolean;
  onCollect: (ideaId: string, query: string, format: IdeaVideoFormat) => Promise<void>;
}

/** Single idea evidence lens: scan a few values; hover, focus, or pin for provenance. */
export function IdeaMarketEvidence({ ideaId, title, locale, format, assessment, status,
  statusError, collecting, onCollect }: IdeaMarketEvidenceProps) {
  const [query, setQuery] = useState(Array.from(assessment?.query || title).slice(0, 120).join(""));
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!assessment?.nextCollectionAt || assessment.nextCollectionAt <= nowSeconds) return;
    const delay = Math.min(2_147_483_647, Math.max(0, (assessment.nextCollectionAt - nowSeconds) * 1000 + 100));
    const timer = window.setTimeout(() => setNowSeconds(Date.now() / 1000), delay);
    return () => window.clearTimeout(timer);
  }, [assessment?.nextCollectionAt, nowSeconds]);
  const expanded = pinned || hovered || focused;
  const matching = assessment?.format === format ? assessment : null;
  const finished = matching?.state === "succeeded";
  const comparing = usableComparison(matching, format);
  const running = collecting || matching?.state === "running";
  const cooldown = (assessment?.nextCollectionAt ?? 0) > nowSeconds;
  const canCollect = status?.apiKeyConfigured === true &&
    status.searchCallsLast24h < status.searchCallLimit &&
    !cooldown && !collecting && !running && validIdeaMarketQuery(query);
  const detailId = `idea-market-${ideaId}`;

  return <div className="mt-4 rounded-[1.1rem] border border-border/80 bg-gradient-to-br from-surface-subtle via-surface to-surface p-3.5 sm:p-4"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/7 text-primary">
          <Activity className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.13em] text-muted-foreground">
            {tr(locale, "YouTube evidence", "YouTube 観測")}</p>
          <p className="text-[11px] text-muted-foreground">
            {tr(locale, "Public observations · not a forecast", "公開データ · 予測ではありません")}</p>
        </div>
      </div>
      {comparing !== null && <div className="text-right">
        <p className="text-2xl font-semibold leading-none tabular-nums tracking-tight text-foreground">{Math.round(comparing)}<span className="ml-0.5 text-xs font-medium text-muted-foreground">/100</span></p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{tr(locale, "Within-format comparison", "形式別の相対比較")}</p>
      </div>}
      {finished && comparing === null && <span className="rounded-full border border-border/80 px-2.5 py-1 text-[11px] text-muted-foreground">
        {tr(locale, "Comparison unavailable", "比較データ不足")}</span>}
    </div>

    {finished && <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-t border-border/65 pt-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums tracking-tight">{matching.medianViews === null ? "—" : fmt(matching.medianViews, locale)}</span>
        <span className="text-xs text-muted-foreground">{tr(locale, "median views", "再生中央値")}</span>
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground">
        {tr(locale, `${matching.sampleSize} videos · ${matching.distinctChannels} channels`,
          `動画 ${matching.sampleSize}件 · チャンネル ${matching.distinctChannels}件`)}</span>
      <span className="text-xs text-muted-foreground">{matching.observedAt !== null
        ? date(matching.observedAt, locale) : tr(locale, "Date unknown", "観測日不明")}</span>
    </div>}

    {running && <p role="status" className="mt-3 flex items-center gap-2 text-xs font-medium text-primary">
      <LoaderCircle className="size-3.5 motion-safe:animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {tr(locale, "Collecting public videos…", "公開動画を収集中…")}</p>}
    {matching?.state === "failed" && <p role="status" className="mt-3 text-xs text-destructive">
      {marketErrorHint(matching.errorCode, locale === "ja") || tr(locale, "Collection failed. You can retry.", "収集に失敗しました。再試行できます。")}</p>}
    {matching?.state === "expired" && <p role="status" className="mt-3 text-xs text-muted-foreground">
      {tr(locale, "Observation expired. Collect again for current evidence.", "観測データの期限が切れました。再収集してください。")}</p>}
    {assessment && assessment.format !== format && <p className="mt-3 text-xs text-muted-foreground">
      {tr(locale, `Last collected as ${assessment.format === "long" ? "long video" : "Shorts"}. Switch format to inspect it.`,
        `直近の収集形式: ${assessment.format === "long" ? "長尺" : "ショート"}。切り替えると表示されます。`)}</p>}

    <div className="mt-3 flex flex-wrap items-end gap-2.5">
      <label className="min-w-[180px] flex-[2] text-[11px] font-medium text-muted-foreground">
        {tr(locale, `YouTube search phrase for ${title}`, `${title} の YouTube 検索語`)}
        <input value={query} maxLength={120} onChange={event => setQuery(event.target.value)}
          className="mt-1 block min-h-9 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          placeholder={tr(locale, "Exact phrase to research", "調査する検索語")} />
      </label>
      <button type="button" disabled={!canCollect} onClick={() => void onCollect(ideaId, query, format)}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background transition-colors duration-150 hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        <RotateCw className="size-3.5" aria-hidden="true" />
        {tr(locale, "Measure on YouTube", "YouTube で測定")}
      </button>
      <button type="button" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
        onClick={() => setPinned(value => !value)}
        className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        {tr(locale, "Evidence details", "観測の詳細")}
        <ChevronDown className={`size-3.5 motion-safe:transition-transform motion-safe:duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
    </div>
    {status?.apiKeyConfigured === false && <p className="mt-2 text-xs text-muted-foreground">
      {tr(locale, "Connect YouTube in Settings to measure an idea.", "設定で YouTube を接続すると測定できます。")}</p>}
    {statusError && <p className="mt-2 text-xs text-muted-foreground">
      {tr(locale, "YouTube connection unavailable. Check local server and Settings.", "YouTube の接続を確認できません。ローカルサーバーと設定を確認してください。")}</p>}
    {status?.apiKeyConfigured && status.searchCallsLast24h >= status.searchCallLimit && <p className="mt-2 text-xs text-muted-foreground">
      {tr(locale, "Daily shared YouTube search limit reached.", "共有の YouTube 検索上限に達しました。")}</p>}
    {cooldown && <p className="mt-2 text-xs text-muted-foreground">{tr(locale, "Next search after", "次に検索できる時刻")}{" "}
      <time dateTime={new Date((assessment?.nextCollectionAt ?? 0) * 1000).toISOString()}>
        {new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", { hour: "numeric", minute: "2-digit" })
          .format((assessment?.nextCollectionAt ?? 0) * 1000)}</time></p>}

    {expanded && <section id={detailId} aria-label={tr(locale, `Market evidence for ${title}`, `${title} の観測詳細`)}
      className="idea-market-enter mt-3 border-t border-border/70 pt-3">
      {finished ? <>
        <div className="grid gap-2.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-muted-foreground">{tr(locale, "75th percentile views", "再生数の第75百分位")}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{matching.p75Views === null ? "—" : fmt(matching.p75Views, locale)}</p></div>
          <div><p className="text-muted-foreground">{tr(locale, "Median lifetime views/day", "累計再生数の日割中央値")}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{matching.medianViewsPerDay === null ? "—" : fmt(matching.medianViewsPerDay, locale)}</p></div>
          <div><p className="text-muted-foreground">{tr(locale, "Uploaded in past 90 days", "直近90日間の投稿")}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{matching.recentUploads90d}</p></div>
          <div><p className="text-muted-foreground">{tr(locale, "Search coverage", "検索のカバー範囲")}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{matching.sampleSize}/{matching.searchedVideos}</p></div>
        </div>
        {pinned && <p className="mt-3 break-words text-xs text-muted-foreground">
          {tr(locale, "Query", "検索語")}: <span className="font-medium text-foreground">{matching.query}</span>
          {` · ${matching.format === "long" ? tr(locale, "Long video", "長尺") : tr(locale, "Shorts", "ショート")}`}
          {matching.region && ` · ${tr(locale, "Search relevance", "検索対象")}: ${matching.region}`}
          {matching.language && ` / ${matching.language === "en" ? "English" : matching.language}`}
          {matching.metricVersion && ` · ${matching.metricVersion}`}
          {comparing === null && ` · ${tr(locale, "Needs ≥8 usable videos, ≥3 channels and ≥3 comparable ideas", "有効な動画8件以上・チャンネル3件以上・比較対象3案以上が必要")}`}
        </p>}
        {pinned && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{tr(locale,
          "One relevance-ranked YouTube search, up to 25 results. US/English scopes search relevance; view totals are global. Usable samples were uploaded 1–365 days ago, share title/query terms, and include at most 3 videos per channel. Shorts uses a ≤180-second duration proxy, not an official classification. Lifetime views/day is not current momentum, and this comparison is not a forecast.",
          "関連度順の YouTube 検索1回・最大25件。米国・英語の指定は検索結果用で、再生数は世界全体です。対象は公開後1〜365日、タイトルと検索語が一致し、1チャンネル最大3件です。ショートは180秒以下という代用判定で公式分類ではありません。累計再生数の日割は最近の勢いを示さず、比較は予測ではありません。")}</p>}
        {!pinned && <p className="mt-2 text-xs text-muted-foreground">{tr(locale,
          "Open Evidence details for methodology and source videos.", "観測の詳細を開くと、方法と参照動画を確認できます。")}</p>}
        {pinned && matching.videos.length > 0 && <ul className="mt-3 grid max-h-56 gap-x-4 gap-y-2 overflow-y-auto border-t border-border/60 pt-3 text-xs sm:grid-cols-2">
          {matching.videos.map(video => <li key={video.videoId} className="min-w-0">
            {validVideoLink(video.videoId, video.sourceUrl) ? <a href={validVideoLink(video.videoId, video.sourceUrl)!} target="_blank" rel="noopener noreferrer"
              className="inline-flex max-w-full items-start gap-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="break-words">{video.title}</span><ArrowUpRight className="mt-0.5 size-3 shrink-0" aria-hidden="true" /></a>
              : <span className="font-medium">{video.title}</span>}
            <p className="mt-0.5 text-muted-foreground">{video.channelTitle} · {video.viewCount === null ? "—" : fmt(video.viewCount, locale)} {tr(locale, "views", "再生")}</p>
          </li>)}</ul>}
      </> : <p className="text-xs text-muted-foreground">{tr(locale,
        "Run one search to inspect dated public videos and comparable figures.",
        "検索を実行すると、観測日付きの公開動画と比較用の数値を確認できます。")}</p>}
    </section>}
  </div>;
}

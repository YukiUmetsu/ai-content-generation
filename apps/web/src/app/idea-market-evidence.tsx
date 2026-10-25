import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, ChevronDown, LoaderCircle, RotateCw, TrendingDown, TrendingUp } from "lucide-react";
import type { Locale } from "@/features/registry";
import { validIdeaMarketQuery, type IdeaGoogleTrends, type IdeaMarketAssessment } from "@/lib/api/discovery-sessions";
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
const trendAvailability = (errorCode: string | null, locale: Locale) => {
  switch (errorCode) {
    case "rate_limited": case "quota_exceeded":
      return tr(locale, "Google Trends rate limit reached.", "Google Trends のアクセス制限に達しました。");
    case "provider_blocked": case "blocked":
      return tr(locale, "Google Trends blocked this request.", "Google Trends がアクセスをブロックしました。");
    case "timeout":
      return tr(locale, "Google Trends did not respond in time.", "Google Trends の応答がタイムアウトしました。");
    case "no_data": case "insufficient_data":
      return tr(locale, "Not enough weekly interest data for this phrase.", "検索語の週次データが不足しています。");
    default:
      return tr(locale, "Google Trends was unavailable during Discovery.", "発見中に Google Trends を利用できませんでした。");
  }
};

interface IdeaMarketEvidenceProps {
  ideaId: string;
  title: string;
  locale: Locale;
  format: IdeaVideoFormat;
  assessment: IdeaMarketAssessment | null | undefined;
  googleTrends?: IdeaGoogleTrends | null;
  status: MarketStatus | null;
  statusError: string | null;
  collecting: boolean;
  onCollect: (ideaId: string, query: string, format: IdeaVideoFormat) => Promise<void>;
}

/** Single idea evidence lens: scan a few values; hover, focus, or pin for provenance. */
export function IdeaMarketEvidence({ ideaId, title, locale, format, assessment, googleTrends, status,
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
  const trendReady = googleTrends?.state === "succeeded" && googleTrends.points >= 26 && googleTrends.changePercent !== null;
  const momentum = trendReady ? googleTrends.changePercent : null;
  const trendChangeText = momentum === null ? null : `${momentum > 0 ? "+" : ""}${fmt(momentum, locale)}%`;
  const momentumPositive = momentum !== null && momentum > 0;
  const momentumNegative = momentum !== null && momentum < 0;

  return <div className="mt-4 rounded-[1.1rem] border border-border/80 bg-gradient-to-br from-surface-subtle via-surface to-surface p-3.5 sm:p-4"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/7 text-primary">
          <Activity className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.13em] text-muted-foreground">
            {tr(locale, "Market signals", "市場の観測データ")}</p>
          <p className="text-[11px] text-muted-foreground">
            {tr(locale, "Observed during Discovery · not a forecast", "発見時の公開データ · 予測ではありません")}</p>
        </div>
      </div>
      <button type="button" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
        onClick={() => setPinned(value => !value)}
        className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        {tr(locale, "Evidence details", "観測の詳細")}
        <ChevronDown className={`size-3.5 motion-safe:transition-transform motion-safe:duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
    </div>

    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-border/70 bg-surface/85 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">YouTube</p>
          {finished && matching.observedAt !== null && <time className="text-[10px] text-muted-foreground" dateTime={new Date(matching.observedAt * 1000).toISOString()}>
            {date(matching.observedAt, locale)}</time>}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          {comparing !== null ? <span className="text-2xl font-semibold leading-none tabular-nums tracking-tight">
            {Math.round(comparing)}<span className="ml-0.5 text-xs font-medium text-muted-foreground">/100</span></span>
            : <span className="text-sm font-semibold text-muted-foreground">{running ? tr(locale, "Collecting…", "収集中…")
              : finished ? tr(locale, "Comparison unavailable", "比較データ不足")
                : matching?.state === "failed" || status?.apiKeyConfigured === false ? tr(locale, "YouTube unavailable", "YouTube を利用できません")
                  : matching?.state === "expired" ? tr(locale, "Observation expired", "観測データの期限切れ")
                : tr(locale, "Not measured", "未測定")}</span>}
          {finished && matching.medianViews !== null && <span className="truncate text-xs text-muted-foreground">
            {fmt(matching.medianViews, locale)} {tr(locale, "median views", "再生中央値")}</span>}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{tr(locale, "Within-format public-video comparison", "同形式の公開動画で比較")}</p>
        {finished && <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
          {tr(locale, `${matching.sampleSize} videos · ${matching.distinctChannels} channels`,
            `動画 ${matching.sampleSize}件 · チャンネル ${matching.distinctChannels}件`)}</p>}
      </div>
      <div className="min-w-0 rounded-xl border border-border/70 bg-surface/85 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Google Trends</p>
          {googleTrends?.observedAt != null && <time className="text-[10px] text-muted-foreground" dateTime={new Date(googleTrends.observedAt * 1000).toISOString()}>
            {date(googleTrends.observedAt, locale)}</time>}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {momentumPositive ? <TrendingUp className="size-5 shrink-0 text-success" aria-hidden="true" />
            : momentumNegative ? <TrendingDown className="size-5 shrink-0 text-status-warning" aria-hidden="true" /> : null}
          {trendChangeText ? <span className={`text-2xl font-semibold leading-none tabular-nums tracking-tight ${momentumPositive ? "text-success" : ""}`}>
            {trendChangeText}</span> : <span className="text-sm font-semibold text-muted-foreground">
            {googleTrends?.state === "running" ? tr(locale, "Checking…", "取得中…")
              : googleTrends?.state === "failed" || googleTrends?.state === "unavailable" ? tr(locale, "Google Trends unavailable", "Google Trends を利用できません")
                : googleTrends?.state === "succeeded" ? tr(locale, "No trend comparison", "傾向の比較不可")
                : tr(locale, "Not measured", "未測定")}</span>}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{tr(locale, "Google search momentum · last 13 vs previous 13 weeks",
          "Google の検索傾向 · 直近13週と前の13週")}</p>
      </div>
    </div>

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
        "No comparable YouTube observations have been saved for this format.",
        "この形式で比較できる YouTube 観測データはありません。")}</p>}
      <div className="mt-3 border-t border-border/70 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold">{tr(locale, "Google search-interest detail", "Google 検索関心度の詳細")}</p>
          {googleTrends?.state === "succeeded" && <span className="text-[11px] text-muted-foreground">
            {tr(locale, `${googleTrends.points} weekly samples · ${googleTrends.region}`, `週次データ ${googleTrends.points} 点 · ${googleTrends.region}`)}</span>}
        </div>
        {googleTrends?.state === "succeeded" && googleTrends.recentMean !== null && googleTrends.previousMean !== null
          ? <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between gap-2"><p className="text-muted-foreground">{tr(locale, "Previous interest index", "前13週の関心度")}</p>
                <p className="font-semibold tabular-nums">{fmt(googleTrends.previousMean, locale)}</p></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-muted-foreground/50 motion-safe:transition-[width] motion-safe:duration-300"
                style={{width:`${Math.max(0,Math.min(100,googleTrends.previousMean))}%`}} /></div>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2"><p className="text-muted-foreground">{tr(locale, "Recent interest index", "直近13週の関心度")}</p>
                <p className="font-semibold tabular-nums">{fmt(googleTrends.recentMean, locale)}</p></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
                style={{width:`${Math.max(0,Math.min(100,googleTrends.recentMean))}%`}} /></div>
            </div>
          </div> : <p className="mt-1.5 text-xs text-muted-foreground">{googleTrends?.state === "failed" || googleTrends?.state === "unavailable"
          ? tr(locale, "Google Trends did not return usable data for this phrase; Discovery kept the other evidence.",
              "この検索語では Google Trends の有効なデータが得られませんでした。他の観測結果は保存されています。")
            : tr(locale, "No saved Google Trends observation.", "Google Trends の保存済み観測データはありません。")}</p>}
        {googleTrends?.query && <p className="mt-2 break-words text-[11px] text-muted-foreground">
          {tr(locale, "Query", "検索語")}: {googleTrends.query}{googleTrends.metricVersion ? ` · ${googleTrends.metricVersion}` : ""}</p>}
        {googleTrends?.errorCode && <p className="mt-1 text-[11px] text-muted-foreground">
          {trendAvailability(googleTrends.errorCode, locale)} <span className="font-mono">({googleTrends.errorCode})</span></p>}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{tr(locale,
          "Google Trends indices are normalized within this query (0–100), not absolute searches or directly comparable demand between topics. Momentum compares the latest 13 weeks with the preceding 13 weeks; it is not a growth forecast.",
          "Google Trends の指数（0～100）は検索語ごとの相対値で、検索回数そのものではありません。異なる検索語の需要規模を直接比較できません。直近13週と前13週の変化は将来予測ではありません。")}</p>
      </div>
      {pinned && <div className="mt-3 border-t border-border/70 pt-3">
        <p className="mb-2 text-xs font-medium">{tr(locale, "Optional YouTube recheck", "任意の YouTube 再測定")}</p>
        <div className="flex flex-wrap items-end gap-2.5">
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
      </div>}
    </section>}
  </div>;
}

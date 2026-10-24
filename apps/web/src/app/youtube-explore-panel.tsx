import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, ExternalLink, Search, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import {
  createMarketWatchlist, loadMarketStatus, searchMarketVideos,
  type MarketStatus, type MarketVideo,
} from "@/lib/api/market";

const inputClass = "w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-muted-foreground";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "YouTube search failed.";

type DateRange = "all" | "7" | "30" | "365";
type SortOrder = "date" | "views";

interface Props {
  locale: Locale;
  onUseVideo: (idea: {title: string; sourceUrl: string}) => boolean;
  onWatchlistSaved: () => void;
}

function filteredVideos(
  videos: MarketVideo[], dateRange: DateRange, minimumViews: number,
  minimumSubscribers: number, order: SortOrder, now: number,
): MarketVideo[] {
  const cutoff = dateRange === "all" ? 0 : now - Number(dateRange) * 86_400_000;
  return videos.filter(video => {
    const published = Date.parse(video.publishedAt);
    return (cutoff === 0 || (Number.isFinite(published) && published >= cutoff))
      && (minimumViews === 0 || (video.viewCount !== null && video.viewCount >= minimumViews))
      && (minimumSubscribers === 0 || (video.subscriberCount !== null && video.subscriberCount >= minimumSubscribers));
  }).sort((a, b) => order === "views"
    ? (b.viewCount ?? -1) - (a.viewCount ?? -1)
    : Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** Human-triggered market discovery; never calls a local model or stores observations. */
export function YoutubeExplorePanel({locale, onUseVideo, onWatchlistSaved}: Props) {
  const ja = locale === "ja";
  const tr = (en: string, jp: string) => ja ? jp : en;
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchedAt, setSearchedAt] = useState(0);
  const [videos, setVideos] = useState<MarketVideo[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [minimumViews, setMinimumViews] = useState(0);
  const [minimumSubscribers, setMinimumSubscribers] = useState(0);
  const [sortOrder, setSortOrder] = useState<SortOrder>("date");
  const [busy, setBusy] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ideaVideo, setIdeaVideo] = useState<MarketVideo | null>(null);
  const [ideaTitle, setIdeaTitle] = useState("");
  const activeSearch = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void loadMarketStatus()
      .then(value => { if (active) setStatus(value); })
      .catch(err => { if (active) setError(errorMessage(err)); });
    return () => { active = false; activeSearch.current?.abort(); };
  }, []);

  const visible = useMemo(
    () => filteredVideos(videos, dateRange, minimumViews, minimumSubscribers, sortOrder, searchedAt),
    [videos, dateRange, minimumViews, minimumSubscribers, sortOrder, searchedAt],
  );
  const count = (value: number | null) => value === null ? tr("Unknown", "不明")
    : new Intl.NumberFormat(ja ? "ja-JP" : "en-US", {notation:"compact", maximumFractionDigits:1}).format(value);
  const validQuery = [...query.trim()].length >= 3 && [...query.trim()].length <= 160;

  async function search() {
    if (!validQuery || busy) return;
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    setBusy(true); setError(""); setNotice(""); setIdeaVideo(null);
    try {
      const result = await searchMarketVideos(query, {signal: controller.signal});
      if (controller.signal.aborted) return;
      setVideos(result);
      setSearchedQuery(query.trim()); setSearchedAt(Date.now());
      setDateRange("all"); setMinimumViews(0); setMinimumSubscribers(0); setSortOrder("date");
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        void loadMarketStatus().then(setStatus).catch(() => {});
      }
    }
  }

  async function saveSearch() {
    if (!searchedQuery || savingSearch) return;
    setSavingSearch(true); setError(""); setNotice("");
    try {
      await createMarketWatchlist({
        name: searchedQuery.slice(0, 80), query: searchedQuery,
        queryMode: "manual", queryPlan: [], queryPlanSource: "user-edited",
        region: "US", language: "en", enabled: false,
      });
      onWatchlistSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setSavingSearch(false); }
  }

  function saveIdea() {
    if (!ideaVideo || !ideaTitle.trim() || ideaTitle.trim().length > 120) {
      setError(tr("Write an original working title (1–120 characters).", "独自の仮タイトルを1〜120文字で入力してください。"));
      return;
    }
    if (onUseVideo({title:ideaTitle.trim(), sourceUrl:ideaVideo.sourceUrl})) {
      setIdeaVideo(null); setIdeaTitle("");
      setNotice(tr("Saved as an editable idea in Content.", "編集可能な動画アイデアとして保存しました。"));
    } else setError(tr("Could not save the video idea.", "動画アイデアを保存できませんでした。"));
  }

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 py-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{tr("Discover / Explore", "発見 / 探索")}</p>
        <h2 className="font-serif text-2xl font-semibold tracking-tight">{tr("Search YouTube videos", "YouTube動画を検索")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {tr("Search public videos directly. No local AI, watchlist or scheduled collection required.",
            "公開動画を直接検索します。ローカルAI、監視リスト、定期収集は不要です。")}
        </p>
      </div>
      {status && <span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
        {status.searchCallsLast24h}/{status.searchCallLimit} {tr("searches used in 24h", "過去24時間の検索")}
      </span>}
    </div>

    {status && !status.apiKeyConfigured && <Surface variant="outline">
      <p className="text-sm font-semibold">{tr("A YouTube API key is needed", "YouTube APIキーが必要です")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {tr("Add your key in local Settings or CONTENTGEN_YOUTUBE_API_KEY, then reload. You do not need Magnitude or SearXNG.",
          "ローカル設定または CONTENTGEN_YOUTUBE_API_KEY でキーを設定し、再読み込みしてください。MagnitudeやSearXNGは不要です。")}
      </p>
    </Surface>}

    <Surface>
      <form className="flex flex-col gap-3" onSubmit={event=>{event.preventDefault();void search();}}>
        <label className={labelClass} htmlFor="youtube-explore-query">{tr("Search YouTube", "YouTubeを検索")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="youtube-explore-query" className={inputClass+" flex-1"} type="search"
            value={query} onChange={event=>setQuery(event.target.value)} maxLength={160}
            placeholder={tr("e.g. cost of replacing a roof", "例：屋根の交換費用")}/>
          <Button type="submit" icon={<Search className="size-4"/>} isLoading={busy}
            disabled={!validQuery || busy || status?.apiKeyConfigured===false}>
            {tr("Search YouTube videos", "YouTube動画を検索")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{tr(
          "United States · English results · one explicit YouTube API search per click (shared daily budget).",
          "対象：米国・英語。クリックごとにYouTube APIを1回検索（1日の上限は共有）。",
        )}</p>
      </form>
    </Surface>

    {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="rounded-control border border-success/30 bg-success/10 p-3 text-sm">{notice}</p>}

    {searchedQuery && <Surface header={<div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="font-semibold">{tr("Results for", "検索結果：")} “{searchedQuery}”</h3>
        <p className="text-xs text-muted-foreground">{tr("Showing", "表示")} {visible.length}/{videos.length} {tr("from this search sample (up to 25). Filters and sorting do not search all YouTube.", "件（最大25件）のサンプルから絞り込み。YouTube全体の順位ではありません。")}</p>
      </div>
      <Button variant="outline" size="sm" icon={<BookmarkPlus className="size-4"/>} isLoading={savingSearch}
        onClick={()=>void saveSearch()} disabled={savingSearch}>
        {tr("Save search to Monitor", "検索を監視リストに保存")}
      </Button>
    </div>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClass}>{tr("Published within", "公開時期")}
          <select className={inputClass} value={dateRange} onChange={e=>setDateRange(e.target.value as DateRange)}>
            <option value="all">{tr("Any date", "指定なし")}</option>
            <option value="7">{tr("Last 7 days", "過去7日")}</option>
            <option value="30">{tr("Last 30 days", "過去30日")}</option>
            <option value="365">{tr("Last year", "過去1年")}</option>
          </select>
        </label>
        <label className={labelClass}>{tr("Minimum views", "最低再生回数")}
          <select className={inputClass} aria-label="Minimum views" value={minimumViews} onChange={e=>setMinimumViews(Number(e.target.value))}>
            <option value="0">{tr("Any", "指定なし")}</option>
            <option value="1000">1,000+</option><option value="10000">10,000+</option>
            <option value="100000">100,000+</option><option value="1000000">1,000,000+</option>
          </select>
        </label>
        <label className={labelClass}>{tr("Channel subscribers", "チャンネル登録者数")}
          <select className={inputClass} value={minimumSubscribers} onChange={e=>setMinimumSubscribers(Number(e.target.value))}>
            <option value="0">{tr("Any", "指定なし")}</option>
            <option value="1000">1,000+</option><option value="10000">10,000+</option>
            <option value="100000">100,000+</option>
          </select>
        </label>
        <label className={labelClass}>{tr("Sort sample", "サンプルの並び順")}
          <select className={inputClass} value={sortOrder} onChange={e=>setSortOrder(e.target.value as SortOrder)}>
            <option value="date">{tr("Newest first", "新しい順")}</option>
            <option value="views">{tr("Most viewed first", "再生数が多い順")}</option>
          </select>
        </label>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {visible.map(video => <article key={video.videoId} className="overflow-hidden rounded-surface border border-border bg-surface-subtle">
          <div className="grid grid-cols-[minmax(110px,36%)_1fr] gap-3 p-3">
            <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={tr("Watch on YouTube", "YouTubeで見る")+": "+video.title}>
              <img alt="" loading="lazy" className="aspect-video h-full w-full object-cover"
                src={"https://i.ytimg.com/vi/"+video.videoId+"/mqdefault.jpg"}/>
            </a>
            <div className="flex min-w-0 flex-col gap-1">
              <h4 className="line-clamp-2 text-sm font-semibold leading-snug">{video.title}</h4>
              <p className="truncate text-xs text-muted-foreground">{video.channelTitle}</p>
              <p className="text-xs text-muted-foreground">{count(video.viewCount)} {tr("views", "再生")} · {count(video.subscriberCount)} {tr("subscribers", "登録者")}</p>
              <p className="text-xs text-muted-foreground">{new Date(video.publishedAt).toLocaleDateString(ja?"ja-JP":"en-US")}</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2">
            <a className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline" href={video.sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3"/> YouTube
            </a>
            <Button variant="outline" size="sm" icon={<Video className="size-3"/>}
              onClick={()=>{setIdeaVideo(video);setIdeaTitle("");setError("");}}>
              {tr("Use for video idea", "動画の着想に使う")}
            </Button>
          </div>
        </article>)}
      </div>
      {visible.length===0 && <p className="mt-4 rounded-control bg-surface-subtle p-4 text-sm text-muted-foreground">
        {videos.length===0 ? tr("No public videos returned for this search.", "この検索では公開動画が見つかりませんでした。")
          : tr("Nothing in this search sample matches your filters. Relax filters or run a different search.", "このサンプルで条件に一致する動画がありません。条件を緩めるか、別の検索を試してください。")}
      </p>}
    </Surface>}

    {ideaVideo && <Surface header={<h3 className="font-semibold">{tr("Create an original video idea", "独自の動画アイデアを作成")}</h3>}>
      <p className="mb-3 text-sm text-muted-foreground">{tr("Reference:", "参考:")} {ideaVideo.title}. {tr("Write your own title; competitor metrics will not be copied.", "独自のタイトルを入力してください。競合の数値はコピーされません。")}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className={labelClass+" flex-1"}>{tr("Working video title", "仮タイトル")}
          <input className={inputClass} aria-label="Working video title" value={ideaTitle}
            onChange={e=>setIdeaTitle(e.target.value)} maxLength={120}/>
        </label>
        <Button onClick={saveIdea} disabled={!ideaTitle.trim()}>{tr("Save video idea", "アイデアを保存")}</Button>
        <Button variant="outline" onClick={()=>setIdeaVideo(null)}>{tr("Cancel", "キャンセル")}</Button>
      </div>
    </Surface>}

    {!searchedQuery && <Surface variant="ghost">
      <p className="text-sm text-muted-foreground">{tr("Enter any topic above to inspect real public video examples. Search results are leads, not verified research evidence or forecasts.",
        "上にテーマを入力すると実際の公開動画を確認できます。検索結果は調査の手がかりであり、検証済みの根拠や予測ではありません。")}</p>
    </Surface>}
  </div>;
}

import { useEffect, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { loadRelatedMarketVideos, type RelatedMarketVideo } from "@/lib/api/market";
import type { Locale } from "@/features/registry";

interface Props {
  locale: Locale;
  topic: string;
  selectedUrls: string[];
  onSelectUrls: (urls: string[]) => void;
}

const MAX_REFERENCES = 5;
const displayDate = (epoch: number, locale: Locale) => new Date(epoch * 1000).toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US");
const publishedDate = (raw: string, locale: Locale) => {
  const date = new Date(raw);
  return Number.isFinite(date.valueOf()) ? date.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US") : "—";
};

export function RelatedYoutubePanel({locale, topic, selectedUrls, onSelectUrls}: Props) {
  const ja = locale === "ja";
  const tr = (en: string, jp: string) => ja ? jp : en;
  const [result, setResult] = useState<{topic:string;videos:RelatedMarketVideo[];error:string}|null>(null);
  const [refresh, setRefresh] = useState(0);
  const active = result?.topic === topic.trim() ? result : null;
  const meaningfulTopic = topic.trim().length >= 3 && topic.trim().length <= 160;

  useEffect(() => {
    if (!meaningfulTopic) return;
    const controller = new AbortController();
    const requestedTopic = topic.trim();
    const timer = window.setTimeout(() => {
      void loadRelatedMarketVideos(topic, {signal:controller.signal})
        .then(videos => { if (!controller.signal.aborted) setResult({topic:requestedTopic,videos,error:""}); })
        .catch(err => {
          if (!controller.signal.aborted) setResult({topic:requestedTopic,videos:[],error:err instanceof Error ? err.message : "Local research lookup failed."});
        });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [topic, meaningfulTopic, refresh]);

  function toggle(url: string, checked: boolean) {
    if (checked && !selectedUrls.includes(url)) {
      if (selectedUrls.length >= MAX_REFERENCES) return;
      onSelectUrls([...selectedUrls,url]);
    } else if (!checked) {
      onSelectUrls(selectedUrls.filter(item => item !== url));
    }
  }

  return <Surface variant="solid" className="gap-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold">{tr("Related YouTube videos", "関連するYouTube動画")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{tr(
          "Automatically matched against cached local observations. Creative context only—not fact-checking evidence.",
          "ローカルに保存された観測データを自動検索します。制作の参考用であり、事実の裏付けではありません。"
        )}</p>
      </div>
      <span className="rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs text-muted-foreground">
        {tr("Local cache · no YouTube API request", "ローカルデータ · APIアクセスなし")}
      </span>
      {meaningfulTopic && <Button size="sm" variant="outline" onClick={()=>{setResult(null);setRefresh(n=>n+1);}}>
        {tr("Refresh saved matches", "保存済み結果を更新")}
      </Button>}
    </div>
    {!meaningfulTopic ? <p className="rounded-control border border-dashed border-border p-4 text-sm text-muted-foreground">
      {tr("Enter a research topic to find related videos you've already collected.", "リサーチするトピックを入力すると、保存済みの関連動画が表示されます。")}
    </p> : !active ? <div role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
      <Search aria-hidden className="size-4" />{tr("Matching saved videos…", "保存済み動画を検索中…")}
    </div> : active.error ? <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-4 text-sm">
      <p>{tr("Couldn't load local YouTube context.", "ローカルのYouTubeデータを読み込めませんでした。")}</p>
      <p className="mt-1 text-muted-foreground">{active.error}</p>
    </div> : active.videos.length === 0 ? <div className="rounded-control border border-dashed border-border p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{tr("No related cached videos for this topic.", "このトピックに関連する保存済み動画はありません。")}</p>
      <p className="mt-1">{tr("Add an enabled niche under YouTube Intelligence, then collect while your local server is running. Your normal evidence research still works.",
        "YouTube Intelligenceで対象ニッチを有効にし、ローカルサーバー起動中に収集してください。通常の根拠調査には影響しません。")}</p>
    </div> : <>
      <p className="text-xs text-muted-foreground">{tr(
        `Select up to ${MAX_REFERENCES} inspiration links to carry into an original video project. Public statistics are shown as observed, not predictions.`,
        `最大${MAX_REFERENCES}件の参考動画を選択できます。公開データは観測値で、予測ではありません。`
      )}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {active.videos.map(video => <article key={video.videoId} className="min-w-0 rounded-surface border border-border bg-surface-subtle p-4">
          <p className="text-xs text-muted-foreground">{video.channelTitle} · {publishedDate(video.publishedAt,locale)}</p>
          <p className="mt-1 text-sm font-semibold leading-relaxed">{video.title}</p>
          <p className="mt-2 text-xs text-muted-foreground">{tr("Public views", "公開再生数")}: {video.viewCount == null ? "—" : new Intl.NumberFormat(ja ? "ja-JP" : "en-US").format(video.viewCount)}
            {" · "}{tr("Duration", "長さ")}: {video.durationSeconds == null ? "—" : `${Math.floor(video.durationSeconds / 60)}m ${video.durationSeconds % 60}s`}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tr("Watchlist", "リスト")}: {video.watchlistName} · {tr("Observed", "観測日")}: {displayDate(video.observedAt,locale)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tr("Matched", "一致語")}: {video.matchedTerms.join(", ")}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
              {tr("Watch on YouTube", "YouTubeで見る")} <ExternalLink aria-hidden className="size-3.5" />
            </a>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <input type="checkbox" aria-label={`${tr("Select for inspiration", "参考として選択")}: ${video.title}`}
                checked={selectedUrls.includes(video.sourceUrl)}
                disabled={!selectedUrls.includes(video.sourceUrl) && selectedUrls.length >= MAX_REFERENCES}
                onChange={e => toggle(video.sourceUrl,e.target.checked)}/>
              {tr("Select as inspiration", "参考に選択")}
            </label>
          </div>
        </article>)}
      </div>
    </>}
  </Surface>;
}

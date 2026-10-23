import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, ExternalLink, Plus, RefreshCw, Sparkles, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import {
  createMarketWatchlist, deleteMarketWatchlist, loadMarketStatus,
  loadMarketVideos, loadMarketWatchlists, requestMarketCollection, updateMarketWatchlist,
  type MarketStatus, type MarketVideo, type MarketWatchlist,
} from "@/lib/api/market";
import {
  loadEditorialDraft, persistEditorialDraft, starterApproaches, validateEditorialDraft,
  type EditorialApproach, type EditorialDraft,
} from "./editorial-brief";

const input = "min-w-0 w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-muted-foreground";
const note = "text-xs leading-relaxed text-muted-foreground";
const messageOf = (err: unknown) => err instanceof Error ? err.message : "Local research request failed.";
const asLocalDate = (epoch: number | null, locale: Locale) =>
  epoch == null ? "—" : new Date(epoch * 1000).toLocaleString(locale === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" });
const asPublished = (iso: string, locale: Locale) => {
  const dt = new Date(iso);
  return Number.isFinite(dt.valueOf()) ? dt.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US") : "Unknown";
};
const formatViews = (count: number | null, locale: Locale) =>
  count == null ? "Unknown" : new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US").format(count);

interface Props {
  locale: Locale;
  onUseVideo: (idea: {title: string; sourceUrl: string}) => boolean;
  onCreateStoryboard?: (draft: EditorialDraft) => boolean;
}

export function YoutubeIntelligencePanel({locale, onUseVideo, onCreateStoryboard}: Props) {
  const ja = locale === "ja";
  const tr = (english: string, japanese: string) => ja ? japanese : english;
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [watchlists, setWatchlists] = useState<MarketWatchlist[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [videoResult, setVideoResult] = useState<{watchlistId: string; rows: MarketVideo[]} | null>(null);
  const [newName, setNewName] = useState("");
  const [newQuery, setNewQuery] = useState("");
  const [editDraft, setEditDraft] = useState<{watchlistId: string; name: string; query: string} | null>(null);
  const [creatingEnabled, setCreatingEnabled] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<MarketVideo | null>(null);
  const [workingTitle, setWorkingTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [creative, setCreative] = useState<{watchlistId:string; draft:EditorialDraft} | null>(null);
  const [creativeError, setCreativeError] = useState("");
  const [creativeBusy, setCreativeBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextStatus, nextWatchlists] = await Promise.all([loadMarketStatus(), loadMarketWatchlists()]);
    setStatus(nextStatus);
    setWatchlists(nextWatchlists);
    setSelectedId(current => nextWatchlists.some(x => x.id === current) ? current : nextWatchlists[0]?.id ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadMarketStatus(), loadMarketWatchlists()])
      .then(([nextStatus, nextWatchlists]) => {
        if (!active) return;
        setStatus(nextStatus);
        setWatchlists(nextWatchlists);
        setSelectedId(nextWatchlists[0]?.id ?? "");
      })
      .catch(err => { if (active) setError(messageOf(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selected = watchlists.find(x => x.id === selectedId) ?? null;
  const editName = editDraft?.watchlistId === selectedId ? editDraft.name : selected?.name ?? "";
  const editQuery = editDraft?.watchlistId === selectedId ? editDraft.query : selected?.query ?? "";
  const videos = videoResult?.watchlistId === selectedId ? videoResult.rows : [];
  const loadedDraft = useMemo(() => {
    const watch = watchlists.find(x => x.id === selectedId);
    return watch ? loadEditorialDraft(watch.id, watch.query) : null;
  }, [selectedId, watchlists]);
  const draft = creative?.watchlistId === selectedId ? creative.draft : loadedDraft?.draft ?? null;
  const selectedApproach = draft?.approaches.find(x=>x.id===draft.selectedId);

  function editCreativeDraft(update: (current: EditorialDraft) => EditorialDraft) {
    if (!draft) return;
    const next = update(draft);
    setCreative({watchlistId:selectedId,draft:next});
    try { persistEditorialDraft(selectedId, next); setCreativeError(""); }
    catch (err) { setCreativeError(messageOf(err) + " Complete the form to save the draft."); }
  }

  function startPatterns() {
    if (!draft) return;
    try { editCreativeDraft(current=>({...current,approaches:starterApproaches(current.input),selectedId:"direct"})); }
    catch (err) { setCreativeError(messageOf(err)); }
  }

  async function generateLocalPatterns() {
    if (!draft) return;
    setCreativeBusy(true);setCreativeError("");
    try {
      // Whitelist the author's own text. No MarketVideo title, views, channel or URL is sent.
      const {topic,audience,viewerQuestion,payoff,reviewNotes} = draft.input;
      const res = await fetch("/api/contentgen-director/brief-variants", {
        method:"POST",headers:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
        body:JSON.stringify({topic,audience,viewerQuestion,payoff,reviewNotes}),
        signal:AbortSignal.timeout(200_000),
      });
      const body = await res.json() as {approaches?:EditorialApproach[];error?:string};
      if (!res.ok) throw Error(body.error ?? "Local model could not create approaches.");
      const next=validateEditorialDraft({...draft,approaches:body.approaches});
      editCreativeDraft(()=>next);
      setMessage(tr("Three local-model concepts are ready to edit. They are unverified ideas.","ローカルモデルが3案を作成しました。内容は未検証です。"));
    } catch (err) { setCreativeError(messageOf(err)); }
    finally { setCreativeBusy(false); }
  }

  function openStoryboard() {
    if (!draft || !onCreateStoryboard) return;
    try {
      const valid = validateEditorialDraft(draft);
      if (!onCreateStoryboard(valid)) setCreativeError(tr("Could not save the new local video project.", "動画プロジェクトを保存できませんでした。"));
    } catch (err) { setCreativeError(messageOf(err)); }
  }

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const sync = () => {
      void Promise.all([loadMarketVideos(selectedId), loadMarketStatus()])
        .then(([rows, nextStatus]) => { if (active) { setVideoResult({watchlistId:selectedId,rows}); setStatus(nextStatus); } })
        .catch(err => { if (active) setError(messageOf(err)); });
    };
    sync();
    const timer = window.setInterval(sync, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (err) { setError(messageOf(err)); }
    finally { setBusy(false); }
  }

  function saveIdea() {
    const title = workingTitle.trim();
    if (!selectedVideo || title.length === 0 || title.length > 120) {
      setError(tr("Enter a working title (up to 120 characters).", "仮タイトルを120文字以内で入力してください。"));
      return;
    }
    if (onUseVideo({title, sourceUrl: selectedVideo.sourceUrl})) {
      setSelectedVideo(null);
      setMessage(tr("Saved as an editable video idea in Content.", "動画アイデアとして保存しました。"));
    } else {
      setError(tr("Could not save to the local Content catalog.", "ローカルのコンテンツに保存できませんでした。"));
    }
  }

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="font-serif text-xl font-semibold">{tr("YouTube Intelligence", "YouTube 市場リサーチ")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("Discover public videos in your niche. These are observed signals, not predicted views, search volume, retention or earnings.",
            "公開動画の傾向を調べます。再生数の予測、検索数、視聴維持率や収益の推定ではありません。")}
        </p>
      </div>
      {status && <span className="rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs text-muted-foreground">
        {status.searchCallsLast24h}/{status.searchCallLimit} {tr("search calls / 24h", "検索 / 24時間")}
        {status.collecting ? tr(" · collecting…", " · 収集中…") : ""}
      </span>}
    </div>

    {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="rounded-control border border-success/30 bg-success/10 p-3 text-sm">{message}</p>}

    {status && !status.apiKeyConfigured && <Surface variant="outline">
      <p className="text-sm font-semibold">{tr("Collection paused: API key not configured", "収集停止中: APIキーが未設定です")}</p>
      <p className={note+" mt-1"}>{tr("Set CONTENTGEN_YOUTUBE_API_KEY in the local server environment, restart the server, then enable a watchlist. No remote calls occur without both steps.",
        "ローカルサーバーの環境変数 CONTENTGEN_YOUTUBE_API_KEY を設定して再起動し、リストを有効化してください。設定なしでは外部通信しません。")}</p>
    </Surface>}

    <Surface header={<h3 className="font-semibold">{tr("Monitor a niche", "調査するニッチを追加")}</h3>}>
      <form className="grid gap-3 md:grid-cols-[1fr_1.5fr_auto] md:items-end" onSubmit={event => {
        event.preventDefault();
        void perform(async () => {
          const watch = await createMarketWatchlist({
            name: newName.trim(), query: newQuery.trim(),
            region: "US", language: "en", enabled: creatingEnabled,
          });
          await refresh();
          setSelectedId(watch.id);
          setEditDraft(null); setSelectedVideo(null);
          setNewName(""); setNewQuery(""); setCreatingEnabled(false);
          setMessage(tr("Watchlist saved. Collection happens only while the local server runs.",
            "リストを保存しました。収集はローカルサーバーの起動中のみ行われます。"));
        });
      }}>
        <label className={label}>{tr("Niche name", "ニッチ名")}
          <input className={input} aria-label="Niche name" value={newName} onChange={e => setNewName(e.target.value)}
            maxLength={80} placeholder="House Math" required/>
        </label>
        <label className={label}>{tr("Search phrase", "検索語")}
          <input className={input} aria-label="Search phrase" value={newQuery} onChange={e => setNewQuery(e.target.value)}
            maxLength={160} placeholder="heat pump vs gas furnace cost" required/>
        </label>
        <Button type="submit" disabled={busy || newName.trim().length===0 || newQuery.trim().length<3}
          icon={<Plus className="size-4"/>}>{tr("Add watchlist", "リストを追加")}</Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-3">
          <input type="checkbox" checked={creatingEnabled} onChange={e => setCreatingEnabled(e.target.checked)}/>
          {tr("Enable daily automatic collection (requires API key)", "毎日の自動収集を有効化する（APIキーが必要）")}
        </label>
        <p className={note+" md:col-span-3"}>{tr("Target market: United States · English. Edit the phrase for each niche.",
          "対象市場: アメリカ · 英語。ニッチごとに検索語を編集できます。")}</p>
      </form>
    </Surface>

    {loading ? <p className="p-4 text-sm text-muted-foreground">{tr("Loading local research…", "読み込み中…")}</p>
      : watchlists.length===0 ? <Surface variant="outline">
        <p className="text-sm text-muted-foreground">{tr("No niches tracked yet. Add a phrase above to get started.", "まだ登録されたニッチはありません。検索語を追加してください。")}</p>
      </Surface> : <>
        <Surface header={<h3 className="font-semibold">{tr("Tracked niches", "監視中のニッチ")}</h3>}>
          <div className="flex flex-col gap-3">
            <label className={label}>{tr("Selected niche", "選択したニッチ")}
              <select className={input} aria-label="Selected niche" value={selectedId} onChange={e=>{
                setSelectedId(e.target.value);setEditDraft(null);setSelectedVideo(null);
              }}>
                {watchlists.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            {selected && <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>{tr("Watchlist name", "リスト名")}
                  <input className={input} value={editName} maxLength={80} aria-label="Watchlist name"
                    onChange={e=>setEditDraft({watchlistId:selected.id,name:e.target.value,query:editQuery})}/>
                </label>
                <label className={label}>{tr("Tracked query", "監視する検索語")}
                  <input className={input} value={editQuery} maxLength={160} aria-label="Tracked query"
                    onChange={e=>setEditDraft({watchlistId:selected.id,name:editName,query:e.target.value})}/>
                </label>
              </div>
              <p className={note}>
                {selected.enabled ? tr("Daily automatic collection enabled", "毎日の自動収集は有効")
                  : tr("Disabled — no automatic collection", "無効 — 自動収集は行いません")}
                {" · "}{tr("Last collected:", "最終収集:")} {asLocalDate(selected.lastFinishedAt,locale)}
                {" · "}{tr("Next eligible:", "次の予定:")} {asLocalDate(selected.nextDueAt,locale)}
                {selected.errorCode && <span className="text-danger"> · {tr("Last error:", "直近のエラー:")} {selected.errorCode}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy || !editName.trim() || editQuery.trim().length<3}
                  onClick={()=>void perform(async()=>{await updateMarketWatchlist(selected.id,{
                    name:editName.trim(),query:editQuery.trim(),region:selected.region,
                    language:selected.language,enabled:selected.enabled,
                  });await refresh();setEditDraft(null);setMessage(tr("Watchlist updated.","リストを更新しました。"));})}>
                  {tr("Save changes", "変更を保存")}
                </Button>
                <Button variant="outline" size="sm" disabled={busy}
                  onClick={()=>void perform(async()=>{await updateMarketWatchlist(selected.id,{
                    name:selected.name,query:selected.query,region:selected.region,
                    language:selected.language,enabled:!selected.enabled,
                  });await refresh();})}>
                  {selected.enabled ? tr("Disable", "無効化") : tr("Enable", "有効化")}
                </Button>
                <Button size="sm" disabled={busy || !selected.enabled || !status?.apiKeyConfigured}
                  icon={<RefreshCw className="size-4"/>}
                  onClick={()=>void perform(async()=>{await requestMarketCollection(selected.id);
                    await refresh();setMessage(tr("Collection queued locally. Results refresh automatically.","収集を開始しました。結果は自動更新されます。"));})}>
                  {tr("Collect now", "今すぐ収集")}
                </Button>
                <Button variant="subtle" size="sm" disabled={busy} icon={<Trash2 className="size-4"/>}
                  onClick={()=>{if(window.confirm(tr("Delete this niche and its cached observations?", "このリストと保存データを削除しますか？")))
                    void perform(async()=>{await deleteMarketWatchlist(selected.id);await refresh();});}}>
                  {tr("Delete", "削除")}
                </Button>
              </div>
            </>}
          </div>
        </Surface>

        {selected && draft && <Surface header={<div>
          <h3 className="font-semibold">{tr("Turn this niche into an original video", "ニッチから独自の動画を作る")}</h3>
          <p className={note+" mt-1"}>{tr("Your own topic and audience drive the story. Public YouTube observations remain read-only references, never performance predictions or verified evidence.",
            "独自のテーマと視聴者を基に構成します。YouTubeの公開データは参考情報であり、予測や検証済みの証拠ではありません。")}</p>
        </div>}>
          <div className="grid gap-3 md:grid-cols-2">
            {([[
              "topic",tr("Original topic", "独自のテーマ"),160],
              ["audience",tr("Who is this for?", "対象視聴者"),120],
              ["viewerQuestion",tr("Question to answer", "解決する疑問"),200],
              ["payoff",tr("What will viewers understand at the end?", "最後に理解すること"),320],
            ] as const).map(([key,caption,max])=><label key={key} className={label}>{caption}
              <input className={input} aria-label={caption} maxLength={max} value={draft.input[key]}
                onChange={e=>editCreativeDraft(x=>({...x,input:{...x.input,[key]:e.target.value}}))}/>
            </label>)}
            <label className={label+" md:col-span-2"}>{tr("Factual notes to verify before publishing (optional)","公開前に検証する事実・メモ（任意）")}
              <textarea className={input} rows={2} maxLength={1800} value={draft.input.reviewNotes}
                onChange={e=>editCreativeDraft(x=>({...x,input:{...x.input,reviewNotes:e.target.value}}))}/>
            </label>
            <label className={label+" md:col-span-2"}>{tr("Selected YouTube inspiration (not factual evidence)", "参考動画（事実の証拠ではありません）")}
              <input className={input} maxLength={300} placeholder="https://www.youtube.com/watch?v=..." value={draft.input.inspirationUrl}
                onChange={e=>editCreativeDraft(x=>({...x,input:{...x.input,inspirationUrl:e.target.value}}))}/>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" disabled={creativeBusy} onClick={startPatterns} icon={<Sparkles className="size-4"/>}>
              {tr("Create 3 starter approaches", "3つの構成案を作成")}
            </Button>
            <Button variant="outline" disabled={creativeBusy} onClick={()=>void generateLocalPatterns()} icon={<Sparkles className="size-4"/>}>
              {creativeBusy ? tr("Generating…","作成中…") : tr("Generate with local AI", "ローカルAIで生成")}
            </Button>
          </div>
          <p className={note+" mt-2"}>{tr("Regenerating replaces the three edited approaches. Local AI needs a model configured under Studio Settings. Nothing is sent to a cloud model.",
            "再生成すると編集済みの3案が置き換わります。ローカルAIの設定が必要です。クラウドモデルへ送信しません。")}</p>
          {(creativeError || loadedDraft?.warning) && <p role="alert" className="mt-3 rounded-control bg-danger/10 p-3 text-sm text-danger">{creativeError || loadedDraft?.warning}</p>}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {draft.approaches.map(approach=><label key={approach.id} className={`flex cursor-pointer flex-col gap-1 rounded-surface border p-3 ${draft.selectedId===approach.id ? "border-primary bg-primary/5":"border-border bg-surface-subtle"}`}>
              <span className="flex items-center gap-2 text-xs font-semibold"><input type="radio" name="selected-editorial-approach" checked={draft.selectedId===approach.id}
                onChange={()=>editCreativeDraft(x=>({...x,selectedId:approach.id}))}/>{approach.strategy}</span>
              <span className="mt-1 text-sm font-semibold">{approach.title}</span>
              <span className={note}>{approach.hook}</span>
            </label>)}
          </div>
          {selectedApproach && <div className="mt-4 rounded-surface border border-border bg-surface-subtle p-4">
            <p className="text-sm font-semibold">{tr("Edit the selected approach", "選択した構成案を編集")}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {([[
                "title",tr("Video title", "動画タイトル"),120],
                ["hook",tr("Opening narration / hook", "冒頭ナレーション"),420],
                ["firstVisual",tr("First-frame animation & partial reveal", "冒頭アニメーション"),560],
                ["onScreenText",tr("Opening on-screen text", "冒頭テキスト"),64],
                ["thumbnail",tr("Thumbnail concept", "サムネイル構想"),400],
                ["sfxIntent",tr("Sound-effect intent (optional)", "効果音（任意）"),200],
                ["payoffConnection",tr("Final answer / payoff narration", "結論・ナレーション"),320],
              ] as const).map(([key,caption,max])=><label key={key} className={label+(["hook","firstVisual","thumbnail","payoffConnection"].includes(key)?" md:col-span-2":"")}>{caption}
                {max>200 ? <textarea className={input} rows={2} maxLength={max} value={selectedApproach[key]}
                  onChange={e=>editCreativeDraft(x=>({...x,approaches:x.approaches.map(a=>a.id===x.selectedId?{...a,[key]:e.target.value}:a)}))}/> :
                <input className={input} maxLength={max} value={selectedApproach[key]}
                  onChange={e=>editCreativeDraft(x=>({...x,approaches:x.approaches.map(a=>a.id===x.selectedId?{...a,[key]:e.target.value}:a)}))}/>}
              </label>)}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button icon={<Clapperboard className="size-4"/>} disabled={!onCreateStoryboard||creativeBusy} onClick={openStoryboard}>
                {tr("Create video project → Storyboard", "動画プロジェクト → ストーリーボード")}
              </Button>
              <p className={note}>{tr("Creates a NEW local project; existing storyboards are untouched. All facts require review. No audio or video is rendered yet.",
                "新しいローカルプロジェクトを作成します。既存のボードは保持されます。事実は要検証。映像・音声生成はまだ行いません。")}</p>
            </div>
          </div>}
        </Surface>}

        <Surface header={<h3 className="font-semibold">{tr("Observed public videos", "観測した公開動画")}</h3>}>
          {videos.length===0 ? <p className="text-sm text-muted-foreground">
            {tr("No fresh observations. Enable this niche and run collection with a configured key.",
              "新しい観測データはありません。APIキーを設定してリストを有効化してください。")}
          </p> : <div className="grid gap-3 lg:grid-cols-2">
            {videos.map(video => <article key={video.videoId} className="rounded-surface border border-border bg-surface-subtle p-4">
              <p className="text-xs text-muted-foreground">{video.channelTitle} · {asPublished(video.publishedAt,locale)}</p>
              <h4 className="mt-1 text-base font-semibold leading-snug">{video.title}</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                {tr("Public views:", "公開再生数:")} {formatViews(video.viewCount,locale)}
                {" · "}{tr("Duration:", "長さ:")} {video.durationSeconds==null ? "—" : Math.floor(video.durationSeconds/60)+"m "+video.durationSeconds%60+"s"}
              </p>
              <p className={note+" mt-2"}>{video.provider} · {tr("Observed:", "観測日時:")} {asLocalDate(video.observedAt,locale)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline"
                  href={video.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {tr("Open source", "元の動画を開く")} <ExternalLink className="size-3.5"/>
                </a>
                <Button size="sm" variant="outline" icon={<Video className="size-4"/>}
                  onClick={()=>{setSelectedVideo(video);
                    setWorkingTitle(`What should viewers know about ${selected?.query ?? "this topic"}?`.slice(0,120));
                    setError("");}}>
                  {tr("Use for video", "動画のアイデアに使う")}
                </Button>
                <Button size="sm" variant="outline" onClick={()=>editCreativeDraft(x=>({...x,input:{...x.input,inspirationUrl:video.sourceUrl}}))}>
                  {tr("Reference in brief", "構成案の参考にする")}
                </Button>
              </div>
            </article>)}
          </div>}
        </Surface>

        {selectedVideo && <Surface header={<h3 className="font-semibold">{tr("Create an original video idea", "オリジナル動画のアイデアを作る")}</h3>}>
          <p className={note}>{tr("Use the source for inspiration, not its script or title. Edit your own working title before saving.",
            "参考動画の台本やタイトルはコピーせず、独自の仮タイトルを入力してください。")}</p>
          <div className="mt-3 flex flex-col gap-3">
            <label className={label}>{tr("Working video title", "動画の仮タイトル")}
              <input className={input} aria-label="Working video title" maxLength={120}
                value={workingTitle} onChange={e=>setWorkingTitle(e.target.value)}/>
            </label>
            <div className="flex gap-2">
              <Button onClick={saveIdea} disabled={!workingTitle.trim()}>{tr("Save video idea", "動画アイデアを保存")}</Button>
              <Button variant="outline" onClick={()=>setSelectedVideo(null)}>{tr("Cancel", "キャンセル")}</Button>
            </div>
          </div>
        </Surface>}
      </>}
  </div>;
}

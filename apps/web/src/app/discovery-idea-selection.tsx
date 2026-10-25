import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, CheckCircle2, ExternalLink, FileSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/features/registry";
import {
  decideSessionIdea, getDiscoverySession, listSessionIdeas,
  type DiscoveryIdeaBrief, type DiscoveryPlatform, type DiscoverySessionIdea,
} from "@/lib/api/discovery-sessions";

const tr = (locale: Locale, en: string, ja: string) => locale === "ja" ? ja : en;
const fieldClass = "mt-1.5 w-full rounded-control border border-input bg-surface px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const platforms: Record<DiscoveryPlatform, string> = {
  youtube: "YouTube", youtube_shorts: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram",
  facebook: "Facebook", blog: "Blog / Website", website: "Blog / Website",
};
type Filter = "all" | "saved" | "dismissed" | "selected";
type Sort = "opportunity" | "sources" | "title";

function safeSourceUrl(value: string): string | null {
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : null; }
  catch { return null; }
}

function opportunityText(idea: DiscoverySessionIdea, locale: Locale): string {
  return idea.opportunityScore === null ? tr(locale, "Not measured", "未測定") : `${Math.round(idea.opportunityScore)}/100`;
}

function inputLabel(key: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    capturedPassages: ["Captured passages", "取得済みの引用"],
    publicVideoLeads: ["Public video leads", "公開動画の手掛かり"],
    sourcePoints: ["Source points", "出典の点数"],
    candidateConfidence: ["Draft confidence", "下書きの確度"],
    confidencePoints: ["Confidence points", "確度の点数"],
    editorialReadinessPoints: ["Story completeness points", "構成の完成度"],
    audienceDemand: ["Audience demand", "視聴者の需要"],
    searchVolume: ["Search volume", "検索ボリューム"],
    scoreMeaning: ["Score interpretation", "点数の意味"],
  };
  const known = labels[key];
  return known ? known[locale === "ja" ? 1 : 0]
    : key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, value => value.toUpperCase());
}

export interface DiscoveryIdeaSelectionProps {
  projectId: string;
  sessionId: string;
  locale: Locale;
  onStartProduction: (idea: DiscoverySessionIdea, brief: DiscoveryIdeaBrief) => void | Promise<unknown>;
}

/** Compare dated opportunities and inspect preserved source leads before production handoff. */
export function DiscoveryIdeaSelection(props: DiscoveryIdeaSelectionProps) {
  // Search, review drafts and loaded ideas are specific to one saved session.
  return <SessionIdeaSelection key={`${props.projectId}:${props.sessionId}`} {...props} />;
}

function SessionIdeaSelection({ projectId, sessionId, locale, onStartProduction }: DiscoveryIdeaSelectionProps) {
  const [ideas, setIdeas] = useState<DiscoverySessionIdea[]>([]);
  const [sessionPlatforms, setSessionPlatforms] = useState<DiscoveryPlatform[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("opportunity");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [brief, setBrief] = useState<DiscoveryIdeaBrief | null>(null);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      listSessionIdeas(projectId, sessionId),
      getDiscoverySession(projectId, sessionId),
    ]).then(([ideaResult, sessionResult]) => {
      if (!alive) return;
      if (ideaResult.status === "fulfilled") setIdeas(ideaResult.value);
      else setError(ideaResult.reason instanceof Error ? ideaResult.reason.message : "Could not load saved ideas.");
      if (sessionResult.status === "fulfilled") setSessionPlatforms(sessionResult.value.platforms);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId, sessionId]);

  const visible = useMemo(() => {
    const term = search.toLocaleLowerCase().trim();
    const matched = ideas.filter(idea => (filter === "all" || (idea.decision ?? "") === filter) &&
      (!term || [idea.title, idea.hook, idea.premise, idea.whyNow, idea.angleKey]
        .some(item => item.toLocaleLowerCase().includes(term))));
    return matched.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "sources") return b.sources.length - a.sources.length || a.rank - b.rank;
      // Numeric heuristic exists only when the backend has measured enough inputs;
      // otherwise show and sort by the source-backed server rank, not a fake zero.
      if (a.opportunityScore !== null && b.opportunityScore !== null)
        return b.opportunityScore - a.opportunityScore || a.rank - b.rank;
      if (a.opportunityScore !== null) return -1;
      if (b.opportunityScore !== null) return 1;
      return a.rank - b.rank;
    });
  }, [ideas, search, filter, sort]);

  // The shortlist is based on the full saved session, not the current search
  // or sort filter; otherwise a filtered-out idea would change the top picks.
  const topPicks = useMemo(() => new Set(ideas.filter(idea => idea.opportunityScore !== null &&
    (idea.decision === null || idea.decision === "saved"))
    .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0) || a.rank - b.rank)
    .slice(0, 3).map(idea => idea.id)), [ideas]);

  const decide = async (idea: DiscoverySessionIdea, decision: "saved" | "dismissed") => {
    setBusy(true); setError(null); setNotice("");
    try {
      await decideSessionIdea(projectId, sessionId, idea.id, decision);
      setIdeas(items => items.map(item => item.id === idea.id ? { ...item, decision } : item));
      setNotice(tr(locale, "Decision saved in this session.", "選択結果をセッションに保存しました。"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save decision."); }
    finally { setBusy(false); }
  };

  const choose = (idea: DiscoverySessionIdea) => {
    setEditingId(idea.id); setError(null); setNotice("");
    setBrief({ topic: idea.title, title: idea.title, angle: idea.hook || idea.angleKey,
      description: idea.premise, keywords: [], platforms: [...sessionPlatforms] });
    setKeywordDraft("");
  };

  const startProduction = async (idea: DiscoverySessionIdea) => {
    if (!brief) return;
    if (!brief.title.trim() || !brief.topic.trim() || brief.platforms.length === 0) {
      setError(tr(locale, "Add a topic and title, and choose at least one output platform.",
        "テーマ、タイトル、配信先を選択してください。"));
      return;
    }
    setBusy(true); setError(null);
    try {
      const approved = { ...brief, title: brief.title.trim(), topic: brief.topic.trim(),
        angle: brief.angle.trim(), description: brief.description.trim(),
        keywords: [...new Set(keywordDraft.split(",").map(item => item.trim()).filter(Boolean))] };
      await decideSessionIdea(projectId, sessionId, idea.id, "selected");
      setIdeas(items => items.map(item => item.id === idea.id ? { ...item, decision: "selected" } : item));
      await onStartProduction(idea, approved);
      setEditingId(null); setBrief(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start production."); }
    finally { setBusy(false); }
  };

  return <section aria-label={tr(locale, "Select an idea", "アイデアを選択")} className="space-y-5">
    <div className="flex flex-wrap items-end gap-3 rounded-control border border-border bg-surface p-4">
      <label className="relative min-w-52 flex-[2] text-xs font-medium text-muted-foreground">{tr(locale, "Search ideas", "アイデアを検索")}
        <Search className="pointer-events-none absolute bottom-3 left-3 size-4" aria-hidden="true" />
        <input type="search" className={`${fieldClass} pl-10`} value={search} onChange={event => setSearch(event.target.value)}
          placeholder={tr(locale, "Search titles, questions or angles", "タイトルや切り口で検索")} />
      </label>
      <label className="min-w-40 flex-1 text-xs font-medium text-muted-foreground">{tr(locale, "Status", "状態")}
        <select className={fieldClass} value={filter} onChange={event => setFilter(event.target.value as Filter)}>
          <option value="all">{tr(locale, "All ideas", "すべて")}</option>
          <option value="saved">{tr(locale, "Saved for later", "後で使う")}</option>
          <option value="selected">{tr(locale, "Selected", "選択済み")}</option>
          <option value="dismissed">{tr(locale, "Dismissed", "見送り")}</option>
        </select>
      </label>
      <label className="min-w-44 flex-1 text-xs font-medium text-muted-foreground">{tr(locale, "Sort ideas", "並べ替え")}
        <span className="relative block"><ArrowUpDown className="pointer-events-none absolute bottom-3 left-3 size-4" aria-hidden="true" />
          <select className={`${fieldClass} pl-10`} value={sort} onChange={event => setSort(event.target.value as Sort)}>
            <option value="opportunity">{tr(locale, "Research readiness / rank", "調査準備度・順位")}</option>
            <option value="sources">{tr(locale, "Most source references", "参照元の数")}</option>
            <option value="title">{tr(locale, "Title A–Z", "タイトル順")}</option>
          </select>
        </span>
      </label>
    </div>

    {loading && <p role="status" className="rounded-control border border-border bg-surface p-5 text-sm text-muted-foreground">
      {tr(locale, "Loading saved ideas and research evidence…", "保存済みアイデアを読み込み中…")}</p>}
    {!loading && ideas.length === 0 && <div className="rounded-control border border-border bg-surface p-7 text-center">
      <FileSearch className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-semibold">{tr(locale, "No ideas collected yet", "アイデアはまだありません")}</p>
      <p className="mt-2 text-sm text-muted-foreground">{tr(locale,
        "Return to Discover and launch a session. Previous partial results will stay available.",
        "『発見』に戻って調査を開始してください。部分的な結果も保存されます。")}</p>
    </div>}
    {!loading && ideas.length > 0 && <p className="text-xs text-muted-foreground" role="status">{tr(locale,
      `${visible.length} of ${ideas.length} saved ideas`, `${ideas.length} 件中 ${visible.length} 件表示`)}</p>}
    <div className="space-y-3">{visible.map(idea => <article key={idea.id} className={`rounded-control border bg-surface p-5 shadow-sm ${topPicks.has(idea.id) ? "border-primary/50" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-[2]">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tr(locale, "Idea", "アイデア")} {idea.rank > 0 ? `#${idea.rank}` : ""}
            {topPicks.has(idea.id) && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-primary normal-case tracking-normal">
              {tr(locale, "Top 3 recommendation", "おすすめ上位3件")}</span>}
            {idea.decision && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 normal-case tracking-normal">{idea.decision}</span>}
          </p>
          <h3 className="font-serif text-xl font-semibold leading-snug">{idea.title}</h3>
          {idea.hook && <p className="mt-2 text-sm font-medium">{idea.hook}</p>}
          {idea.premise && <p className="mt-2 text-sm leading-6 text-muted-foreground">{idea.premise}</p>}
        </div>
        <div className="min-w-[140px] rounded-control bg-muted/50 p-3 text-right">
          <p className="text-xs text-muted-foreground">{tr(locale, "Research readiness", "調査準備度")}</p>
          <p className="mt-1 text-base font-semibold">{opportunityText(idea, locale)}</p>
          {idea.opportunityScore !== null && <p className="mt-1 text-[11px] text-muted-foreground">{tr(locale,
            "Internal heuristic · not audience demand", "内部推定・視聴需要の測定ではありません")}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>{tr(locale, "Draft confidence (AI-assigned)", "下書きの確度（AI による判断）")}: {idea.confidence}</span>
        {idea.whyNow && <span>{tr(locale, "Why consider", "選定理由")}: {idea.whyNow}</span>}
      </div>
      {(idea.scoreVersion || Object.keys(idea.scoreInputs).length > 0) && <div className="mt-3">
        <button className="text-xs font-medium text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expandedScoreId === idea.id}
          aria-controls={expandedScoreId === idea.id ? `score-details-${idea.id}` : undefined}
          onClick={() => setExpandedScoreId(value => value === idea.id ? null : idea.id)}>
          {expandedScoreId === idea.id ? tr(locale, "Hide score details", "評価の詳細を閉じる") : tr(locale, "Explain this score", "評価の根拠を確認")}
        </button>
        {expandedScoreId === idea.id && <div id={`score-details-${idea.id}`} className="mt-2 rounded-control bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>{tr(locale, "Formula revision", "計算式の版")}: {idea.scoreVersion ?? tr(locale, "not recorded", "記録なし")}</p>
          {Object.entries(idea.scoreInputs).slice(0, 12).map(([key, value]) => <p key={key} className="mt-1 break-words">
            {inputLabel(key, locale)}: {key === "scoreMeaning" && locale === "ja" ? "調査準備度のみ。動画の成果予測ではありません"
              : value === "unknown" ? tr(locale, "unknown", "不明")
                : value === null ? tr(locale, "unknown", "不明") : typeof value === "object" ? JSON.stringify(value) : String(value)}</p>)}
        </div>}
      </div>}
      <div className="mt-4 rounded-control border border-border-subtle bg-surface-subtle p-3">
        <p className="text-xs font-semibold"><FileSearch className="mr-1 inline size-3.5" aria-hidden="true" />
          {tr(locale, "Sources and provenance", "出典と取得記録")} · {idea.sources.length}</p>
        {idea.sources.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">{tr(locale,
          "No frozen source summaries available for this idea. Verify factual claims before drafting.",
          "保存済みの出典がありません。原稿作成前に事実確認してください。")}</p> :
          <ul className="mt-2 space-y-2">{idea.sources.map(source => <li key={source.id} className="text-xs">
            {safeSourceUrl(source.url) ? <a href={safeSourceUrl(source.url)!} target="_blank" rel="noopener noreferrer"
              className="break-words font-medium text-primary underline underline-offset-2">
              {source.title} <ExternalLink className="inline size-3" aria-hidden="true" /></a> :
              <span className="break-words font-medium">{source.title}</span>}
            <p className="mt-0.5 text-muted-foreground">{source.provider} · {source.observedAt
              ? new Date(source.observedAt * 1000).toLocaleDateString() : tr(locale, "observation date unknown", "取得日不明")}
              {source.evidenceState === "captured" ? tr(locale, " · captured; verify claim support", " · 取得済み・主張の検証が必要")
                : tr(locale, " · source lead, not verified", " · 未検証の候補")}</p>
          </li>)}</ul>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => choose(idea)}>{tr(locale, "Use this idea", "このアイデアを使う")}</Button>
        <Button variant="outline" size="sm" disabled={busy || idea.decision === "saved"}
          onClick={() => void decide(idea, "saved")}>{tr(locale, "Save for later", "後で使う")}</Button>
        <Button variant="subtle" size="sm" disabled={busy || idea.decision === "dismissed"}
          onClick={() => void decide(idea, "dismissed")}>{tr(locale, "Dismiss", "見送る")}</Button>
      </div>
      {editingId === idea.id && brief && <section role="region" aria-label={tr(locale, "Prepare production brief", "制作内容を確認")}
        className="mt-5 space-y-4 rounded-control border border-primary/30 bg-primary/5 p-4">
        <div><p className="text-sm font-semibold"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden="true" />
          {tr(locale, "Prepare production brief", "制作内容を確認")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tr(locale,
            "This edits the creative proposal, not the original research or idea. AI will draft the script next.",
            "ここで編集するのは制作方針です。元の調査は保持され、次に AI が原稿を作成します。")}</p></div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">{tr(locale, "Topic / viewer question", "テーマ・視聴者の疑問")}
            <input className={fieldClass} value={brief.topic} maxLength={180}
              onChange={event => setBrief(current => current && { ...current, topic: event.target.value })}/></label>
          <label className="text-sm">{tr(locale, "Proposed title", "タイトル案")}
            <input className={fieldClass} value={brief.title} maxLength={180}
              onChange={event => setBrief(current => current && { ...current, title: event.target.value })}/></label>
        </div>
        <label className="block text-sm">{tr(locale, "Angle / hook", "切り口・フック")}
          <textarea className={fieldClass} rows={2} value={brief.angle} maxLength={1200}
            onChange={event => setBrief(current => current && { ...current, angle: event.target.value })}/></label>
        <label className="block text-sm">{tr(locale, "Description", "内容の説明")}
          <textarea className={fieldClass} rows={3} value={brief.description} maxLength={2400}
            onChange={event => setBrief(current => current && { ...current, description: event.target.value })}/></label>
        <label className="block text-sm">{tr(locale, "Keywords (comma separated, optional)", "キーワード（カンマ区切り・任意）")}
          <input className={fieldClass} value={keywordDraft} maxLength={800}
            onChange={event => setKeywordDraft(event.target.value)}/></label>
        <fieldset><legend className="mb-2 text-sm font-medium">{tr(locale, "Output platforms", "配信先")}</legend>
          <div className="flex flex-wrap gap-3">{sessionPlatforms.map(platform => <label key={platform} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={brief.platforms.includes(platform)} onChange={event =>
              setBrief(current => current && { ...current, platforms: event.target.checked
                ? [...current.platforms, platform] : current.platforms.filter(item => item !== platform) })}/>
            {platforms[platform] ?? platform}</label>)}</div>
          {sessionPlatforms.length === 0 && <p className="text-sm text-danger">{tr(locale,
            "Session platforms could not be loaded. Reopen this session or return to Setup.",
            "配信先を読み込めません。セッションを開き直してください。")}</p>}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || brief.platforms.length === 0} onClick={() => void startProduction(idea)}>
            {tr(locale, "Start production", "制作を開始")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setBrief(null); }}>
            {tr(locale, "Cancel", "戻る")}</Button>
        </div>
      </section>}
    </article>)}</div>
    {!loading && ideas.length > 0 && visible.length === 0 && <p className="rounded-control border border-border p-5 text-sm text-muted-foreground">
      {tr(locale, "No ideas match these filters. Your saved ideas were not deleted.", "一致するアイデアがありません。保存内容は削除されていません。")}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}


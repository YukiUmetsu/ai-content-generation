import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import type { LocalContent, LocalProject } from "./catalog-model";
import { loadProjectKeywords, patchProjectKeywords, streamProjectKeywords,
  type KeywordKind, type KeywordSuggestion, type KeywordSuggestionQuality, type ProjectKeyword, type GraphOverview,
  type DiscoveryCandidate } from "@/lib/api/discovery";
import { ProjectKnowledgePanel } from "./project-knowledge-panel";
import { DiscoveryIdeasPanel } from "./discovery-ideas-panel";

const input = "w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const msg = (locale: Locale, en: string, ja: string) => locale === "ja" ? ja : en;

export function ProjectDiscoveryPanel({project,content,locale,syncStatus,onSaveIdea}: {
  project: LocalProject; content: LocalContent[]; locale: Locale; syncStatus: "syncing" | "synced" | "offline";
  onSaveIdea:(idea:DiscoveryCandidate,openResearch:boolean,sources?:GraphOverview["sources"])=>boolean;
}) {
  const [graph,setGraph] = useState<GraphOverview|null>(null);
  const [graphRevision,setGraphRevision] = useState(0);
  const onRunFinished = useCallback(()=>setGraphRevision(value=>value+1),[]);
  const [keywords, setKeywords] = useState<ProjectKeyword[]>([]);
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
  const [suggestionQuality,setSuggestionQuality]=useState<KeywordSuggestionQuality|null>(null);
  const [keywordBusy,setKeywordBusy]=useState(false);
  const [keywordProgress,setKeywordProgress]=useState<{step:number;totalSteps:number}|null>(null);
  const keywordController=useRef<AbortController|null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<KeywordKind>("topic");
  const [editingId,setEditingId] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    try { setKeywords(await loadProjectKeywords(project.id)); setError(null); }
    catch { setError(msg(locale,"Project discovery is unavailable. Start the local Rust server and reopen Projects.","ローカル Rust サーバーを起動してください。")); }
  }, [project.id, locale]);
  useEffect(() => {
    if(syncStatus !== "synced") return;
    const timer=window.setTimeout(()=>{void reload();},0);
    return ()=>window.clearTimeout(timer);
  }, [syncStatus, reload]);
  useEffect(()=>()=>{keywordController.current?.abort();},[project.id]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Discovery action failed."); }
    finally { setBusy(false); }
  };
  const patch = async (change: Parameters<typeof patchProjectKeywords>[1]) => setKeywords(await patchProjectKeywords(project.id,change));
  const startKeywordReview=async()=>{
    if(keywordController.current)return;
    const controller=new AbortController();keywordController.current=controller;
    setKeywordBusy(true);setError(null);setNotice("");setSuggestions([]);
    setSuggestionQuality(null);setKeywordProgress(null);
    try{
      const quality=await streamProjectKeywords(project,keywords.filter(item=>item.active).map(item=>item.text),{
        signal:controller.signal,onBatch:batch=>{
          if(controller.signal.aborted)return;
          setSuggestions(prior=>{
            const seen=new Set(prior.map(item=>`${item.kind}:${item.text.toLowerCase()}`));
            return [...prior,...batch.suggestions.filter(item=>{
              const key=`${item.kind}:${item.text.toLowerCase()}`;
              if(seen.has(key))return false;seen.add(key);return true;
            })];
          });
          setSuggestionQuality(batch.quality);setKeywordProgress({step:batch.step,totalSteps:batch.totalSteps});
        },
      });
      setSuggestionQuality(quality);
      setNotice(msg(locale,"Review suggestions before adding them.","追加前に提案を確認してください。"));
    }catch(err){
      if(controller.signal.aborted)setNotice(msg(locale,
        "Stopped. Suggestions already received are kept for review.","停止しました。受け取った提案はそのまま確認できます。"));
      else setError(err instanceof Error?err.message:"Local keyword streaming failed.");
    }finally{
      if(keywordController.current===controller){keywordController.current=null;setKeywordBusy(false);}
    }
  };
  return <section className="mt-5 space-y-4" aria-label={msg(locale,"Project discovery","プロジェクトの発見") }>
    <Surface header={<div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">{msg(locale,"Project topics & search keywords","プロジェクトのトピックと検索語")}</h2>
      <span className="text-xs text-muted-foreground" role="status">{syncStatus==="synced"?msg(locale,"Saved locally","ローカルに保存済み"):
        syncStatus==="syncing"?msg(locale,"Syncing local project…","同期中…"):msg(locale,"Local server offline — catalog is safe","サーバー停止中 — データは保存済み")}</span>
    </div>}>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{msg(locale,
        "Choose precise topics and exclusions. AI suggestions are drafts until you accept them. Your project description guides topic relevance.",
        "説明文をもとに、検索トピックや除外語を管理できます。AI の提案は承認するまで保存されません。")}</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => {event.preventDefault(); if(!text.trim())return;
        void perform(async()=>{await patch({add:[{text:text.trim(),kind,origin:"manual"}],...(editingId?{remove:[editingId]}:{})});
          setText("");setEditingId(null);});}}>
        <label className="min-w-48 flex-1 text-xs text-muted-foreground">{msg(locale,"Keyword or search phrase","キーワード・検索フレーズ")}
          <input value={text} onChange={event=>setText(event.target.value)} maxLength={160} className={input} placeholder="e.g. rising home insurance costs"/>
        </label>
        <label className="text-xs text-muted-foreground">{msg(locale,"Type","種類")}
          <select className={input} value={kind} onChange={event=>setKind(event.target.value as KeywordKind)}>
            <option value="topic">Topic</option><option value="query">Search phrase</option><option value="exclusion">Exclude</option>
          </select>
        </label>
        <Button type="submit" disabled={busy || syncStatus!=="synced" || text.trim().length<2} size="sm">{editingId?msg(locale,"Save edit","変更を保存"):msg(locale,"Add keyword","追加")}</Button>
        {editingId&&<Button size="sm" variant="subtle" onClick={()=>{setEditingId(null);setText("");}}>{msg(locale,"Cancel edit","変更を中止")}</Button>}
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{keywords.filter(item=>item.active).length} {msg(locale,"active keywords","有効なキーワード")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy||keywordBusy||syncStatus!=="synced"}
            onClick={()=>void startKeywordReview()}>{msg(locale,keywordBusy?"Generating in batches…":"Suggest Keywords with Local AI",
              keywordBusy?"少しずつ生成中…":"ローカル AI で提案")}</Button>
          {keywordBusy&&<Button size="sm" variant="subtle" onClick={()=>keywordController.current?.abort()}
            aria-label="Stop keyword generation">{msg(locale,"Stop and keep results","停止して結果を残す")}</Button>}
        </div>
      </div>
      {keywordBusy&&<p role="status" className="mt-2 text-xs text-muted-foreground">{msg(locale,
        `Local AI is working in small batches. ${keywordProgress?`Batch ${keywordProgress.step} complete (up to ${keywordProgress.totalSteps} batches).`:"Waiting for the first batch…"} You can review or accept suggestions as they arrive.`,
        `ローカル AI で少量ずつ生成中。${keywordProgress?`${keywordProgress.step} 回完了（最大 ${keywordProgress.totalSteps} バッチ）。`:"最初の結果を待機中…"}受け取った提案はすぐに確認・採用できます。`)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {keywords.length===0?<p className="text-sm text-muted-foreground">{msg(locale,"No keywords yet. Add one or request AI suggestions.","キーワードはまだありません。")}</p>:
          keywords.map(item=><div key={item.id} className={`flex max-w-full items-center gap-2 rounded-control border px-3 py-2 text-sm ${item.active?"border-border":"border-border opacity-55"}`}>
            <span className="min-w-0 break-words">{item.text}</span>
            <span className="text-xs text-muted-foreground">{item.kind}{item.origin==="manual"?" · manual":" · AI"}</span>
            <button type="button" disabled={busy} className="text-xs text-primary underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={()=>{setEditingId(item.id);setText(item.text);setKind(item.kind);}}>{msg(locale,"Edit","編集")}</button>
            {item.active&&<button type="button" disabled={busy} className="text-xs text-muted-foreground underline focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>void perform(async()=>patch({disable:[item.id]}))}>Disable</button>}
            <button type="button" disabled={busy} className="text-xs text-danger underline focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${item.text}`} onClick={()=>void perform(async()=>patch({remove:[item.id]}))}>×</button>
          </div>)}
      </div>
      {suggestions.length>0&&<div className="mt-4 space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{msg(locale,"Review AI suggestions","AI の提案を確認")}</h3>
        <p className="text-xs text-muted-foreground">{msg(locale,
          "Unverified AI-generated hypotheses. Search volume and trend strength have not been measured.",
          "AI による未検証の提案です。検索数・トレンドの強さは測定されていません。")}</p>
        {suggestionQuality&&<p className="text-xs text-muted-foreground">{msg(locale,
          `${suggestionQuality.modelRequests} local AI requests · ${suggestionQuality.rejected} suggestions filtered by quality checks.`,
          `ローカル AI ${suggestionQuality.modelRequests} 回 · 品質チェックで ${suggestionQuality.rejected} 件除外。`)}</p>}
        {suggestionQuality?.partial&&<p className="text-xs text-muted-foreground">{msg(locale,
          "Partial results: no fabricated suggestions were added to reach the target.",
          "一部の提案のみ利用可能です。件数を満たすための架空の提案は追加していません。")}</p>}
        {suggestions.map(item=><div key={`${item.kind}:${item.text}`} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border p-3">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.text} <span className="text-xs text-muted-foreground">· {item.kind}</span></p>
            <p className="text-xs text-muted-foreground">{item.rationale}</p></div>
          <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={()=>void perform(async()=>{
            await patch({add:[{text:item.text,kind:item.kind,origin:"model"}]});setSuggestions(rows=>rows.filter(row=>row!==item));
          })}>{msg(locale,"Accept","採用")}</Button>
          <Button size="sm" variant="subtle" onClick={()=>setSuggestions(rows=>rows.filter(row=>row!==item))}>{msg(locale,"Skip","除外")}</Button></div>
        </div>)}
      </div>}
      {notice&&<p role="status" className="mt-3 text-xs text-muted-foreground">{notice}</p>}
      {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Surface>
    <ProjectKnowledgePanel projectId={project.id} locale={locale} syncStatus={syncStatus} revision={graphRevision} onGraph={setGraph}/>
    <DiscoveryIdeasPanel project={project} content={content} locale={locale} syncStatus={syncStatus}
      sources={graph?.sources??[]} onSaveIdea={(idea,openResearch)=>onSaveIdea(idea,openResearch,
        (graph?.sources??[]).filter(source=>idea.sourceIds.includes(source.id)))} onRunFinished={onRunFinished}/>
  </section>;
}

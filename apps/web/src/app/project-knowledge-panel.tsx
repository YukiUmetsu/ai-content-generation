import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import { loadProjectGraphOverview,loadProjectWatchlists,setProjectWatchlists,
  type GraphOverview } from "@/lib/api/discovery";
const t=(locale:Locale,en:string,ja:string)=>locale==="ja"?ja:en;
type Watchlist={id:string;name:string;query:string;enabled:boolean};

export function ProjectKnowledgePanel({projectId,locale,syncStatus,onGraph}: {
  projectId:string;locale:Locale;syncStatus:"syncing"|"synced"|"offline";
  onGraph:(graph:GraphOverview)=>void;
}) {
  const [graph,setGraph]=useState<GraphOverview|null>(null);
  const [watchlists,setWatchlists]=useState<Watchlist[]>([]);
  const [bound,setBound]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{
    try{
      const [data,bindings,response]=await Promise.all([
        loadProjectGraphOverview(projectId),loadProjectWatchlists(projectId),
        fetch("/api/research/market/watchlists").then(async result=>result.ok?result.json() as Promise<{watchlists:Watchlist[]}>:{watchlists:[]})]);
      setGraph(data);onGraph(data);setBound(bindings);setWatchlists(response.watchlists);setError(null);
    }catch{setError(t(locale,"Graph or watchlist data is not available while the local server is offline.","ローカルサーバーとの接続が必要です。"));}
  },[projectId,locale,onGraph]);
  useEffect(()=>{
    if(syncStatus!=="synced")return;
    const timer=window.setTimeout(()=>{void refresh();},0);
    return ()=>window.clearTimeout(timer);
  },[syncStatus,refresh]);
  const toggle=async(id:string,checked:boolean)=>{
    setBusy(true);setError(null);
    try{setBound(await setProjectWatchlists(projectId,checked?[...bound,id]:bound.filter(x=>x!==id)));}
    catch(err){setError(err instanceof Error?err.message:"Watchlist mapping failed.");}
    finally{setBusy(false);}
  };
  return <Surface header={<div className="flex flex-wrap items-center justify-between gap-2">
    <h2 className="font-semibold">{t(locale,"Knowledge graph & research sources","知識グラフと調査資料")}</h2>
    <Button size="sm" variant="outline" disabled={busy||syncStatus!=="synced"} onClick={()=>void refresh()}>{t(locale,"Refresh","更新")}</Button>
  </div>}>
    <p className="mb-3 text-sm text-muted-foreground">{t(locale,
      "Saved topics, explicit relationships and dated public source observations. Suggested relationships are hypotheses until backed by captured passages.",
      "保存したトピック・関係・公開情報を表示します。出典で確認されていない関係は仮説です。")}</p>
    <div className="mb-4 flex flex-wrap gap-4 text-sm">
      <span><strong>{graph?.topicCount??0}</strong> {t(locale,"nodes","ノード")}</span>
      <span><strong>{graph?.sourceCount??0}</strong> {t(locale,"sources","情報源")}</span>
      <span><strong>{graph?.supportedEdgeCount??0}</strong> {t(locale,"supported relations","裏付けのある関係")}</span>
    </div>
    {watchlists.length>0&&<div className="mb-5 rounded-control border border-border p-3">
      <h3 className="text-sm font-semibold">{t(locale,"Link existing YouTube watchlists to this project","YouTube ウォッチリストを連携")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t(locale,
        "Only linked lists contribute videos to this project's graph. Linking does not spend API quota; collect using YouTube Intelligence.",
        "連携したリストの動画のみグラフに加わります。連携自体は API の呼び出しを行いません。")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{watchlists.map(list=><label key={list.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={bound.includes(list.id)} disabled={busy} onChange={event=>void toggle(list.id,event.target.checked)}/>
        <span className="min-w-0 break-words">{list.name} <span className="text-xs text-muted-foreground">· {list.query||"auto"}</span></span>
      </label>)}</div>
    </div>}
    {!graph?.nodes.length&&<p className="text-sm text-muted-foreground">{t(locale,
      "No mapped topics yet. Link and collect a watchlist, or run discovery after adding focused keywords.",
      "まだトピックがありません。ウォッチリストを連携してデータを収集してください。")}</p>}
    {!!graph?.nodes.length&&<div className="grid gap-4 md:grid-cols-2">
      <section><h3 className="mb-2 text-sm font-semibold">{t(locale,"Related topics","関連トピック")}</h3>
        <ul className="space-y-2">{graph.nodes.slice(0,28).map(node=><li key={node.id} className="rounded-control border border-border p-2 text-sm">
          <span className="font-medium">{node.label}</span> <span className="text-xs text-muted-foreground">· {node.kind}</span>
        </li>)}</ul>
      </section>
      <section><h3 className="mb-2 text-sm font-semibold">{t(locale,"Source-backed relationships","関係と裏付け")}</h3>
        <ul className="space-y-2">{graph.edges.slice(0,25).map(edge=>{
          const from=graph.nodes.find(node=>node.id===edge.fromNodeId)?.label??"Related topic";
          const to=graph.nodes.find(node=>node.id===edge.toNodeId)?.label??"Related topic";
          return <li key={edge.id} className="rounded-control border border-border p-2 text-sm">
            <p>{from} <span className="text-muted-foreground">→ {edge.relation.replaceAll("_"," ")} →</span> {to}</p>
            <span className={`text-xs ${edge.status==="supported"?"text-success":"text-muted-foreground"}`}>{edge.status}</span>
          </li>;
        })}</ul>
      </section>
    </div>}
    {!!graph?.sources.length&&<details className="mt-5 text-sm"><summary className="cursor-pointer font-semibold">{t(locale,"Inspect research sources","出典を見る")} · {graph.sources.length}</summary>
      <ul className="mt-2 space-y-2">{graph.sources.map(source=><li key={source.id} className="rounded-control border border-border p-2">
        <a href={source.url} rel="noopener noreferrer" target="_blank" className="break-words text-primary underline">{source.title}</a>
        <p className="text-xs text-muted-foreground">{source.provider} · {source.publishedAt??"publication date unknown"} · {source.evidenceState.replaceAll("_"," ")}</p>
      </li>)}</ul>
    </details>}
    {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </Surface>;
}

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import { addProjectGraphAlias,correctProjectGraphEdge,loadProjectGraphOverview,loadProjectWatchlists,
  removeProjectGraphAlias,searchProjectGraphNodes,setProjectWatchlists,
  type GraphNode,type GraphOverview } from "@/lib/api/discovery";
const t=(locale:Locale,en:string,ja:string)=>locale==="ja"?ja:en;
type Watchlist={id:string;name:string;query:string;enabled:boolean};

export function ProjectKnowledgePanel({projectId,locale,syncStatus,revision,onGraph}: {
  projectId:string;locale:Locale;syncStatus:"syncing"|"synced"|"offline";revision:number;
  onGraph:(graph:GraphOverview)=>void;
}) {
  const [graph,setGraph]=useState<GraphOverview|null>(null);
  const [watchlists,setWatchlists]=useState<Watchlist[]>([]);
  const [bound,setBound]=useState<string[]>([]);
  const [aliasDrafts,setAliasDrafts]=useState<Record<string,string>>({});
  const [searchText,setSearchText]=useState("");
  const [matches,setMatches]=useState<GraphNode[]|null>(null);
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
  },[syncStatus,refresh,revision]);
  const toggle=async(id:string,checked:boolean)=>{
    setBusy(true);setError(null);
    try{setBound(await setProjectWatchlists(projectId,checked?[...bound,id]:bound.filter(x=>x!==id)));}
    catch(err){setError(err instanceof Error?err.message:"Watchlist mapping failed.");}
    finally{setBusy(false);}
  };
  const edit=async(change:()=>Promise<unknown>)=>{
    setBusy(true);setError(null);
    try{await change();await refresh();}
    catch(err){setError(err instanceof Error?err.message:t(locale,"Graph update failed.","グラフの更新に失敗しました。"));}
    finally{setBusy(false);}
  };
  const search=async()=>{
    if(!searchText.trim()){setMatches(null);return;}
    setBusy(true);setError(null);
    try{setMatches(await searchProjectGraphNodes(projectId,searchText.trim()));}
    catch(err){setError(err instanceof Error?err.message:"Graph search failed.");}
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
    {!!graph?.nodes.length&&<form className="mb-4 flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void search();}}>
      <input aria-label={t(locale,"Search graph topics","グラフのトピックを検索")} value={searchText}
        onChange={event=>setSearchText(event.target.value)} maxLength={200}
        className="min-w-0 flex-1 rounded-control border border-input bg-surface px-3 py-2 text-sm" />
      <Button size="sm" variant="outline" type="submit" disabled={busy}>{t(locale,"Search topics","トピックを検索")}</Button>
      {matches&&<Button size="sm" variant="outline" type="button" onClick={()=>{setMatches(null);setSearchText("");}}>{t(locale,"Clear","クリア")}</Button>}
    </form>}
    {matches&&<p className="mb-2 text-xs text-muted-foreground">{matches.length} {t(locale,"matching topics","一致するトピック")}</p>}
    {!!graph?.nodes.length&&<div className="grid gap-4 md:grid-cols-2">
      <section><h3 className="mb-2 text-sm font-semibold">{t(locale,"Related topics","関連トピック")}</h3>
        <ul className="space-y-2">{(matches??graph.nodes).slice(0,28).map(node=><li key={node.id} className="rounded-control border border-border p-2 text-sm">
          <span className="font-medium">{node.label}</span> <span className="text-xs text-muted-foreground">· {node.kind}</span>
          {(graph.aliases??[]).filter(item=>item.nodeId===node.id).map(item=><div key={item.alias} className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 break-words text-muted-foreground">{item.alias}</span>
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove alias ${item.alias}`}
              onClick={()=>void edit(()=>removeProjectGraphAlias(projectId,node.id,item.alias))}>{t(locale,"Remove","削除")}</Button>
          </div>)}
          <form className="mt-2 flex flex-wrap gap-2" onSubmit={event=>{
            event.preventDefault();
            const alias=aliasDrafts[node.id]?.trim();
            if(!alias)return;
            void edit(async()=>{await addProjectGraphAlias(projectId,node.id,alias);setAliasDrafts(current=>({...current,[node.id]:""}));});
          }}>
            <input aria-label={`Alias for ${node.label}`} value={aliasDrafts[node.id]??""}
              onChange={event=>setAliasDrafts(current=>({...current,[node.id]:event.target.value}))}
              maxLength={240} className="min-w-0 flex-1 rounded-control border border-input bg-surface px-2 py-1 text-sm" />
            <Button size="sm" variant="outline" type="submit" disabled={busy||!(aliasDrafts[node.id]??"").trim()}
              aria-label={`Add alias to ${node.label}`}>{t(locale,"Add alias","別名を追加")}</Button>
          </form>
        </li>)}</ul>
      </section>
      <section><h3 className="mb-2 text-sm font-semibold">{t(locale,"Source-backed relationships","関係と裏付け")}</h3>
        <ul className="space-y-2">{graph.edges.slice(0,25).map(edge=>{
          const from=graph.nodes.find(node=>node.id===edge.fromNodeId)?.label??"Related topic";
          const to=graph.nodes.find(node=>node.id===edge.toNodeId)?.label??"Related topic";
          const evidence=(graph.edgeEvidence??[]).filter(item=>item.edgeId===edge.id).slice(0,2);
          return <li key={edge.id} className="rounded-control border border-border p-2 text-sm">
            <p>{from} <span className="text-muted-foreground">→ {edge.relation.replaceAll("_"," ")} →</span> {to}</p>
            <span className={`text-xs ${edge.status==="supported"?"text-success":"text-muted-foreground"}`}>{edge.status}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {edge.status==="hypothesized"&&edge.relation!=="affects"&&
                evidence.some(item=>item.assessment==="supports"&&Boolean(item.quote))&&
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={()=>void edit(()=>correctProjectGraphEdge(projectId,edge.id,"supported"))}>
                  {t(locale,"Approve sourced relation","出典を確認して承認")}</Button>}
              {edge.status!=="rejected"?<Button size="sm" variant="outline" disabled={busy}
                onClick={()=>void edit(()=>correctProjectGraphEdge(projectId,edge.id,"rejected"))}>{t(locale,"Reject relation","関係を却下")}</Button>
                :<Button size="sm" variant="outline" disabled={busy}
                  onClick={()=>void edit(()=>correctProjectGraphEdge(projectId,edge.id,"hypothesized"))}>{t(locale,"Reopen relation","関係を再検討")}</Button>}
            </div>
            {evidence.map(item=>{
              const source=graph.sources.find(entry=>entry.id===item.sourceId);
              return <div key={item.sourceId} className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                {source?<a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline">{source.title}</a>:
                  <span>{t(locale,"Earlier linked source","関連情報源")}</span>}
                <span> · {item.assessment==="supports"?t(locale,"verbatim passage","引用あり"):t(locale,"unverified link","未確認")}</span>
                {item.quote&&<p className="mt-1 break-words italic">“{item.quote}”</p>}
              </div>;
            })}
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

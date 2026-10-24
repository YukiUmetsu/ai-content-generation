import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import type { LocalContent, LocalProject } from "./catalog-model";
import { cancelDiscoveryRun, decideDiscoveryIdea, discoverFiveIdeas, listDiscoveryRuns, loadDiscoveryRun, resumeDiscoveryRun,
  type DiscoveryCandidate, type DiscoveryRun, type GraphSource } from "@/lib/api/discovery";

const say=(locale:Locale,en:string,ja:string)=>locale==="ja"?ja:en;
const active=(run:DiscoveryRun|null)=>run&&["queued","running"].includes(run.status);

export function DiscoveryIdeasPanel({project,content,locale,syncStatus,sources,onSaveIdea,onRunFinished}: {
  project:LocalProject;content:LocalContent[];locale:Locale;syncStatus:"syncing"|"synced"|"offline";
  sources:GraphSource[];onSaveIdea:(idea:DiscoveryCandidate,openCreate:boolean)=>boolean;onRunFinished:()=>void;
}) {
  const [run,setRun]=useState<DiscoveryRun|null>(null);
  const [history,setHistory]=useState<DiscoveryRun[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const sourceById=useMemo(()=>new Map(sources.map(source=>[source.id,source])),[sources]);
  useEffect(()=>{
    let mounted=true;
    void listDiscoveryRuns(project.id).then(runs=>{if(mounted){setHistory(runs);setRun(runs[0]??null);}}).catch(()=>{});
    return ()=>{mounted=false;};
  },[project.id,syncStatus]);
  useEffect(()=>{
    if(!active(run))return;
    const interval=window.setInterval(()=>{
      void loadDiscoveryRun(project.id,run!.id).then(next=>{
        setRun(next);
        if(!active(next)){
          onRunFinished();
          void listDiscoveryRuns(project.id).then(setHistory).catch(()=>{});
        }
      }).catch(()=>setMessage(say(locale,"Local discovery server is unavailable.","ローカルサーバーに接続できません。")));
    },1800);
    return ()=>clearInterval(interval);
  },[run,project.id,locale,onRunFinished]);
  const start=async()=>{
    setBusy(true);setMessage(null);
    try {const next=await discoverFiveIdeas(project,content);setRun(next);
      if(!active(next))onRunFinished();
      setHistory(old=>[next,...old.filter(item=>item.id!==next.id)]);}
    catch(err){setMessage(err instanceof Error?err.message:"Could not start discovery.");}
    finally{setBusy(false);}
  };
  const resume=async()=>{
    if(!run)return;
    setBusy(true);setMessage(null);
    try{setRun(await resumeDiscoveryRun(project,content,run.id));}
    catch(err){setMessage(err instanceof Error?err.message:"Could not resume discovery.");}
    finally{setBusy(false);}
  };
  const cancel=async()=>{
    if(!run)return;
    setBusy(true);setMessage(null);
    try{const next=await cancelDiscoveryRun(project.id,run.id);setRun(next);
      setHistory(old=>old.map(item=>item.id===next.id?next:item));}
    catch(err){setMessage(err instanceof Error?err.message:"Could not cancel discovery.");}
    finally{setBusy(false);}
  };
  const decide=async(idea:DiscoveryCandidate,decision:"saved"|"dismissed",openResearch=false)=>{
    setMessage(null);
    if(decision!=="dismissed"&&!onSaveIdea(idea,openResearch))return;
    try {
      await decideDiscoveryIdea(project.id,idea.id,decision);
      if(run)setRun({...run,candidates:run.candidates.map(item=>item.id===idea.id?{...item,decision}:item)});
    }catch(err){setMessage(err instanceof Error?err.message:"Could not record the idea decision.");}
  };
  return <Surface header={<div className="flex flex-wrap items-center justify-between gap-3">
    <div><h2 className="font-semibold">{say(locale,"Discover 5 Ideas","新しいアイデアを5件探す")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{say(locale,"Runs only when you click. Each run stays in your local history.","クリックしたときだけ実行され、結果は履歴に保存されます。")}</p></div>
    <Button disabled={busy||!!active(run)||syncStatus!=="synced"} onClick={()=>void start()}>
      {busy?say(locale,"Starting…","開始中…"):say(locale,"Discover 5 Ideas","5件のアイデアを探す")}</Button>
  </div>}>
    {run&&<div className="mb-4 flex flex-wrap items-center gap-3 rounded-control border border-border p-3">
      <div className="flex-1"><p className="text-sm font-semibold capitalize">{run.status.replaceAll("_"," ")}</p>
        <p className="text-xs text-muted-foreground">{say(locale,"Stage","段階")}: {run.stage.replaceAll("_"," ")} · {new Date(run.createdAt*1000).toLocaleString()}</p>
      </div>
      {(["paused","failed"].includes(run.status))&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void resume()}>{say(locale,"Resume","再開")}</Button>}
      {(active(run)||run.status==="paused")&&<Button size="sm" variant="subtle" disabled={busy||syncStatus!=="synced"} onClick={()=>void cancel()}>{say(locale,"Cancel run","実行を中止")}</Button>}
    </div>}
    {run?.providerHealth&&Object.keys(run.providerHealth).length>0&&<details className="mb-4 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium">{say(locale,"Provider availability and evidence gaps","データ提供元の状態")}</summary>
      <ul className="mt-2 list-inside list-disc space-y-1">{Object.entries(run.providerHealth).map(([name,value])=><li key={name}>{name}: {value}</li>)}</ul>
    </details>}
    {run?.status==="insufficient_evidence"&&<p role="status" className="mb-4 text-sm text-muted-foreground">{say(locale,
      "Not enough relevant, source-linked evidence to suggest credible ideas. Link a YouTube watchlist, collect videos, or add focused keywords and try again.",
      "信頼できる情報源が足りません。YouTube のウォッチリストを連携して収集してから再実行してください。")}</p>}
    {run?.status==="failed"&&<p role="alert" className="mb-4 text-sm text-danger">{say(locale,"Discovery stopped:","実行が停止しました:")} {run.errorCode??"local model unavailable"}</p>}
    <div className="space-y-3">{run?.candidates.map(idea=><article key={idea.id} className="rounded-control border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="max-w-2xl font-serif text-lg font-semibold">{idea.rank}. {idea.title}</h3>
        <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{idea.confidence} confidence</span></div>
      <p className="mt-2 text-sm font-medium">{idea.hook}</p>
      <p className="mt-2 text-sm text-muted-foreground">{idea.premise}</p>
      <p className="mt-2 text-xs text-muted-foreground">{say(locale,"Why consider it","選定理由")}: {idea.whyNow}</p>
      <p className="mt-1 text-xs text-muted-foreground">{say(locale,"Growth and search volume","成長率・検索数")}: {say(locale,"unknown — no comparable observations verified","不明 — 比較可能な測定データなし")}</p>
      {idea.sourceIds.length>0&&<div className="mt-3 space-y-1"><p className="text-xs font-medium">{say(locale,"Related source leads (not verified claims)","関連情報源（事実確認は別途必要）")}</p>
        {idea.sourceIds.map(id=>{const source=sourceById.get(id);return source?<a key={id} href={source.url} target="_blank" rel="noopener noreferrer"
          className="block max-w-2xl break-words text-xs text-primary underline underline-offset-2">{source.title} · {source.provider} · {source.publishedAt??say(locale,"date unknown","日付不明")}</a>:<span key={id} className="text-xs text-muted-foreground">Source {id.slice(0,9)} unavailable in preview</span>;})}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">{idea.decision?<>
        <span className="text-xs text-muted-foreground">{say(locale,"Marked","記録済み")}: {idea.decision}</span>
        {(idea.decision==="saved"||idea.decision==="storyboard")&&<Button size="sm" variant="outline" onClick={()=>onSaveIdea(idea,true)}>
          {say(locale,"Open in Research","調査画面へ")}</Button>}
      </>:<>
        <Button size="sm" onClick={()=>void decide(idea,"saved")}>{say(locale,"Save idea","保存")}</Button>
        <Button size="sm" variant="outline" onClick={()=>void decide(idea,"saved",true)}>{say(locale,"Save & research","保存して調査へ")}</Button>
        <Button size="sm" variant="subtle" onClick={()=>void decide(idea,"dismissed")}>{say(locale,"Dismiss","却下")}</Button>
      </>}</div>
    </article>)}</div>
    {!run&&<p className="text-sm text-muted-foreground">{say(locale,"No discovery runs yet. Add relevant keywords, link evidence, then click Discover 5 Ideas.","まだ実行履歴がありません。キーワードと情報源を登録して開始してください。")}</p>}
    {history.length>1&&<label className="mt-5 block text-xs text-muted-foreground">{say(locale,"Previous runs","過去の実行")}
      <select className="ml-2 max-w-full rounded-control border border-input bg-surface px-2 py-2 text-sm" value={run?.id??""} onChange={event=>{
        const selected=history.find(item=>item.id===event.target.value);if(selected)setRun(selected);
      }}>{history.map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt*1000).toLocaleString()} · {item.status}</option>)}</select>
    </label>}
    {message&&<p role="alert" className="mt-4 text-sm text-danger">{message}</p>}
  </Surface>;
}

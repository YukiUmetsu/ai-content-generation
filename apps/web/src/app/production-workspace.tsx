import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Circle, Loader2, Menu, RotateCcw } from "lucide-react";
import type { Locale } from "@/features/registry";
import type { StudioCatalog } from "./catalog-model";
import { loadProjectStoryboard, saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { repairStoryboardEvidence } from "./storyboard-evidence-repair";
import { ResearchWorkspace } from "./research-workspace";
import { inspectClaimEvidence } from "./claim-evidence";
import { ProductionClaimIssues } from "./production-claim-issues";
import { getProductionStages, type ProductionStageId, type ProductionStageStatus } from "./production-progress";
import type { EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";

interface JobState {
  jobId: string;
  status: "queued" | "running" | "paused" | "failed" | "cancelled" | "completed";
  stage: string;
  artifactId?: string;
  completedScenes?: number;
  totalScenes?: number;
  evidenceRepair?: {status:string;autoFixed:number;needsReview:number;
    issues?:{claimId:string;reason:string}[]};
  error?: {message?:string};
}
interface Props {
  locale: Locale;
  catalog: StudioCatalog;
  onSelectProject: (projectId:string)=>void;
  onOpenResearch: ()=>void;
  onOpenStoryboard: ()=>void;
  onOpenVisuals: ()=>void;
  onOpenAudio: ()=>void;
  onOpenExport: ()=>void;
  onOpenNav: ()=>void;
  onCreateStoryboard: (draft:EditorialDraft,research?:ResearchDraftResult)=>boolean;
  onUseVideo: (idea:{title:string;sourceUrl:string})=>boolean;
}
const stageLabels:Record<ProductionStageId,{en:string;ja:string;enDetail:string;jaDetail:string}>={
  brief:{en:"Brief",ja:"企画",enDetail:"Define the viewer question and what the video will teach.",jaDetail:"視聴者の疑問と動画で伝える内容を決めます。"},
  research:{en:"Research",ja:"調査",enDetail:"Capture sources, generate teaching units, and check evidence links.",jaDetail:"根拠を収集し、説明構成と出典を確認します。"},
  storyboard:{en:"Storyboard",ja:"構成案",enDetail:"Review the story, claims, and visual learning beats.",jaDetail:"構成・主張・視覚的な説明を確認します。"},
  visuals:{en:"Visuals",ja:"映像",enDetail:"Turn each teaching beat into clear on-screen actions.",jaDetail:"各シーンに伝わる動きと視覚表現を付けます。"},
  audio:{en:"Audio",ja:"音声",enDetail:"Prepare narration and sound effects.",jaDetail:"ナレーションと効果音を準備します。"},
  export:{en:"Preview & Export",ja:"確認と書き出し",enDetail:"Inspect the result and export only after review.",jaDetail:"動画を確認し、承認後に書き出します。"},
};
const lastJobKey="contentgen:studio-research-job:latest:v1";
const lastResearchKey="contentgen:studio-research:latest:v1";
const stagesKey=(projectId:string)=>"contentgen:production-step:v1:"+projectId;
function storedForTopic(key:string,topic:string,field:string):string|null{
  if(typeof localStorage==="undefined"||!topic.trim())return null;
  try{
    const value:unknown=JSON.parse(localStorage.getItem(key)??"null");
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const data=value as Record<string,unknown>;
    return data.topic===topic&&typeof data[field]==="string"?data[field] as string:null;
  }catch{return null;}
}
function previousStep(projectId:string):ProductionStageId{
  try{
    const value=localStorage.getItem(stagesKey(projectId));
    return value && value in stageLabels?value as ProductionStageId:"brief";
  }catch{return "brief";}
}
function statusLabel(status:ProductionStageStatus,ja:boolean){
  const labels={
    not_started:ja?"未開始":"Not started",running:ja?"進行中":"Running",
    complete:ja?"完了":"Complete",needs_review:ja?"要確認":"Needs review",
    failed:ja?"再試行":"Needs retry",stale:ja?"更新が必要":"Stale",
  };
  return labels[status];
}
function StatusIcon({status}:{status:ProductionStageStatus}){
  if(status==="complete")return <Check className="size-4 text-emerald-600" aria-hidden/>;
  if(status==="running")return <Loader2 className="size-4 animate-spin text-primary" aria-hidden/>;
  if(status==="failed"||status==="needs_review")return <AlertCircle className="size-4 text-status-warning" aria-hidden/>;
  if(status==="stale")return <RotateCcw className="size-4 text-status-warning" aria-hidden/>;
  return <Circle className="size-4 text-muted-foreground" aria-hidden/>;
}
export function ProductionWorkspace({locale,catalog,onSelectProject,onOpenResearch,onOpenStoryboard,
  onOpenVisuals,onOpenAudio,onOpenExport,onOpenNav,onCreateStoryboard,onUseVideo}:Props){
  const ja=locale==="ja";
  const tr=(en:string,jp:string)=>ja?jp:en;
  const projectId=catalog.activeProjectId;
  const project=catalog.projects.find(item=>item.id===projectId);
  const video=catalog.content.filter(item=>item.projectId===projectId&&item.kind==="video").at(-1);
  const topic=video?.name??(project?.name==="My project"?"":project?.name??"");
  const [step,setStep]=useState<ProductionStageId>(()=>previousStep(projectId));
  const [board,setBoard]=useState(()=>loadProjectStoryboard(projectId).board);
  const [boardError]=useState<string|null>(()=>loadProjectStoryboard(projectId).warning);
  const [jobId,setJobId]=useState<string|null>(()=>storedForTopic(lastJobKey,topic,"jobId"));
  const [researchArtifactId,setResearchArtifactId]=useState<string|null>(()=>
    storedForTopic(lastResearchKey,topic,"artifactId"));
  const [job,setJob]=useState<JobState|null>(null);
  const [draft,setDraft]=useState<ResearchDraftResult|null>(null);
  const [error,setError]=useState("");
  const [retryBusy,setRetryBusy]=useState(false);
  const [repairSummary,setRepairSummary]=useState("");

  useEffect(()=>{
    const refresh=()=>{
      const currentJob=storedForTopic(lastJobKey,topic,"jobId");
      const currentArtifact=storedForTopic(lastResearchKey,topic,"artifactId");
      setJobId(prev=>prev===currentJob?prev:currentJob);
      setResearchArtifactId(prev=>prev===currentArtifact?prev:currentArtifact);
    };
    const interval=setInterval(refresh,2500);
    return ()=>clearInterval(interval);
  },[topic]);
  useEffect(()=>{
    if(!jobId)return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      try{
        const response=await fetch("/api/contentgen-director/research-jobs/"+jobId,{signal:controller.signal});
        if(!response.ok)throw Error("Research job status unavailable.");
        const result=await response.json() as JobState;
        if(!controller.signal.aborted&&result.jobId===jobId){
          setJob(result);
          if(result.artifactId)setResearchArtifactId(result.artifactId);
        }
      }catch{
        if(!controller.signal.aborted)setJob(null);
      }finally{
        if(!controller.signal.aborted)timer=setTimeout(poll,2500);
      }
    };
    void poll();
    return ()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[jobId]);
  const artifactId=job?.artifactId??researchArtifactId;
  useEffect(()=>{
    if(!artifactId)return;
    const controller=new AbortController();
    void fetch("/api/contentgen-director/research-draft/"+encodeURIComponent(artifactId),{
      signal:controller.signal,
    }).then(async response=>{
      if(!response.ok)throw Error("Research snapshot unavailable.");
      return await response.json() as ResearchDraftResult;
    }).then(result=>{if(!controller.signal.aborted)setDraft(result);})
      .catch(()=>{if(!controller.signal.aborted)setDraft(null);});
    return ()=>controller.abort();
  },[artifactId]);

  const issues=useMemo(()=>board?inspectClaimEvidence(board,draft??undefined):[],[board,draft]);
  const unresolved=issues.filter(issue=>issue.kind==="source_missing"||issue.kind==="source_mismatch").length;
  const unreviewed=issues.filter(issue=>issue.kind==="needs_factual_review"||issue.kind==="source_unchecked").length;
  const storyboardResearchArtifactId=board?.assumptions.find(value=>value.startsWith("Research artifact: "))?.slice("Research artifact: ".length);
  const stages=getProductionStages({briefReady:Boolean(topic.trim()),researchJob:job,
    researchArtifactId:artifactId,storyboardReady:Boolean(board),
    storyboardResearchArtifactId,missingEvidenceClaims:unresolved,unreviewedClaims:unreviewed});
  const current=stages.find(item=>item.id===step)!;
  function selectStep(next:ProductionStageId){
    setStep(next);
    try{localStorage.setItem(stagesKey(projectId),next);}catch{/* Navigation still works without local storage. */}
  }
  async function retryEvidence(){
    if(!jobId||retryBusy)return;
    setRetryBusy(true);setError("");
    try{
      const response=await fetch("/api/contentgen-director/research-jobs/"+jobId+"/repair",{
        method:"POST",headers:{"Content-Type":"application/json","x-contentgen-director":"local-only"},
        body:"{}",});
      if(!response.ok){const message=await response.json() as {error?:string};throw Error(message.error||"Repair could not restart.");}
      setJob(await response.json() as JobState);
    }catch(reason){setError(reason instanceof Error?reason.message:"Evidence repair could not restart.");}
    finally{setRetryBusy(false);}
  }
  function fixStoryboardSources(){
    setError("");setRepairSummary("");
    if(!draft){setError("Load a saved research snapshot before repairing source links.");return;}
    try{
      // Always re-read the live draft. Never write an obsolete in-memory copy over an edit.
      const saved=loadProjectStoryboard(projectId);
      if(!saved.board)throw Error(saved.warning??"No saved storyboard was found.");
      const result=repairStoryboardEvidence(saved.board,draft);
      if(result.reason){setError("This storyboard does not belong to the loaded research snapshot. Open its original research before repairing references.");return;}
      if(!result.fixed.length){
        setRepairSummary(tr("No source links could be safely repaired. Preserve the claim and find new evidence or edit it manually.",
          "安全に修復できる参照はありません。新しい根拠を探すか、主張を手動で修正してください。"));
        return;
      }
      saveProjectStoryboard(projectId,result.board);
      setBoard(result.board);
      setRepairSummary(tr(`${result.fixed.length} source link(s) repaired from saved evidence. These claims still need factual review.`,
        `保存された根拠から${result.fixed.length}件の参照を修復しました。事実確認は引き続き必要です。`));
    }catch(reason){setError(reason instanceof Error?reason.message:"Storyboard repair could not be saved.");}
  }
  const contentCard="rounded-surface border border-border bg-surface p-5 sm:p-6";
  const primaryButton="rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const secondaryButton="rounded-control border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  return <section id="workspace" aria-label={tr("Guided production","制作ガイド")}
    className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpenNav} aria-label={tr("Open navigation","メニューを開く")}
          className="rounded-control p-2 hover:bg-muted lg:hidden"><Menu className="size-5"/></button>
        <div><h1 className="font-serif text-2xl font-semibold">{tr("Production","動画制作")}</h1>
          <p className="text-xs text-muted-foreground">{tr("One video, six clear steps. Your progress is saved.","6ステップで動画を制作。進行状況は保存されます。")}</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {tr("Project","プロジェクト")}
        <select className="max-w-[240px] rounded-control border border-border bg-surface px-3 py-2 text-sm text-foreground"
          value={projectId} onChange={event=>onSelectProject(event.target.value)}>
          {catalog.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </header>
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label={tr("Production stages","制作ステップ")}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-subtle p-3 md:w-[216px] md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-4">
        {stages.map((item,index)=><button key={item.id} type="button" onClick={()=>selectStep(item.id)}
          aria-current={step===item.id?"step":undefined}
          aria-label={stageLabels[item.id].en+" stage"}
          className={`flex min-w-[152px] items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-surface md:min-w-0 ${step===item.id?"bg-surface text-foreground shadow-sm ring-1 ring-border":"text-muted-foreground"}`}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium tabular-nums">{index+1}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{ja?stageLabels[item.id].ja:stageLabels[item.id].en}</span>
            <span className="block truncate text-[11px]">{statusLabel(item.status,ja)}</span></span>
          <StatusIcon status={item.status}/>
        </button>)}
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
                {tr("Step","ステップ")} {stages.findIndex(item=>item.id===step)+1} / 6
              </p>
              <h2 className="mt-1 font-serif text-3xl font-semibold">{ja?stageLabels[step].ja:stageLabels[step].en}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{ja?stageLabels[step].jaDetail:stageLabels[step].enDetail}</p>
            </div>
            <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs">
              {statusLabel(current.status,ja)}
            </span>
          </div>
          {error&&<p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
          {boardError&&<p role="alert" className="rounded-control border border-danger/40 px-4 py-3 text-sm text-danger">{boardError}</p>}
          {step==="brief"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{topic||tr("Start with one question","まず1つの疑問から")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {project?.notes||tr("Your research brief defines the audience, viewer question, and learning payoff.",
                "誰に、何を、どう伝えるかを調査用ブリーフで決めます。")}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className={primaryButton} onClick={()=>selectStep("research")}>
                {tr("Continue to research","調査へ進む")}
              </button>
              <button type="button" className={secondaryButton} onClick={onOpenResearch}>
                {tr("Edit the detailed brief","詳しい企画を編集")}
              </button>
            </div>
          </div>}
          {step==="research"&&<>
            {job&&<div className={contentCard}>
              <p className="text-sm font-medium">{tr("Saved research job","保存された調査ジョブ")} · {job.stage}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {job.completedScenes??0} / {job.totalScenes??0} {tr("teaching units saved","個の説明単位を保存")}
                {job.evidenceRepair&&` · ${job.evidenceRepair.autoFixed} ${tr("links repaired","件の参照修復")}`}
              </p>
              {job.evidenceRepair?.needsReview?<p className="mt-2 text-sm text-status-warning">
                {job.evidenceRepair.needsReview} {tr("source references need review","件の出典を確認してください")}
              </p>:null}
              {job.status==="paused"&&job.stage==="evidence-repair"&&<button type="button" disabled={retryBusy}
                className={primaryButton+" mt-3"} onClick={()=>void retryEvidence()}>
                {tr("Refresh sources and retry","出典を再取得して再試行")}
              </button>}
            </div>}
            <div className="flex min-h-[620px] flex-col overflow-hidden rounded-surface border border-border bg-surface">
              <ResearchWorkspace key={projectId} locale={locale} projectTopic={topic}
                onUseVideo={onUseVideo} onCreateStoryboard={onCreateStoryboard}/>
            </div>
          </>}
          {step==="storyboard"&&<>
            {repairSummary&&<p role="status" className="rounded-control border border-border bg-surface p-3 text-sm">{repairSummary}</p>}
            {board?<div className={contentCard}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-serif text-xl font-semibold">{board.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{board.beats.length} {tr("editable teaching beats","個の編集可能な説明シーン")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {unresolved>0&&draft&&<button type="button" className={secondaryButton} onClick={fixStoryboardSources}>
                    {tr("Auto-fix safe source links","安全な出典参照を自動修復")}
                  </button>}
                  <button type="button" className={primaryButton} onClick={onOpenStoryboard}>
                    {tr("Open editable storyboard","構成案を編集")}
                  </button>
                </div>
              </div>
              <ol className="mt-5 grid gap-2">
                {board.beats.map((beat,index)=><li key={beat.id} className="rounded-control border border-border bg-surface-subtle p-3">
                  <div className="flex gap-3"><span className="text-xs tabular-nums text-muted-foreground">{index+1}</span>
                    <div><p className="text-sm font-semibold">{beat.onScreenText||beat.objective}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{beat.visualObjective}</p></div>
                  </div>
                </li>)}
              </ol>
            </div>:<div className={contentCard}><p className="text-sm text-muted-foreground">
              {tr("No storyboard has been saved for this project. Finish research, then create an editable storyboard.",
                "このプロジェクトには構成案がありません。調査を完了して構成案を作成してください。")}</p>
              <button type="button" className={primaryButton+" mt-4"} onClick={()=>selectStep("research")}>
                {tr("Go to research","調査へ")}
              </button></div>}
            {board&&<ProductionClaimIssues issues={issues} draft={draft} locale={locale}
              onOpenBeat={beatId=>{
                try { sessionStorage.setItem("contentgen:storyboard-focus-beat:v1:"+projectId,beatId); }
                catch { /* The planner still opens when session storage is unavailable. */ }
                onOpenStoryboard();
              }} onFindEvidence={()=>selectStep("research")}
              onRetryRepair={job?.status==="paused"&&job.stage==="evidence-repair"?()=>void retryEvidence():undefined}/>}
          </>}
          {step==="visuals"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{tr("Design the explanation visually","説明を映像にする")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {tr("Plan meaningful movement, assets, and camera actions for each beat. Existing visual and Kumiki tools remain available.",
                "各シーンに意味のある動き、素材、カメラ演出を設計します。既存の映像制作ツールを利用できます。")}
            </p>
            <button type="button" className={primaryButton+" mt-5"} onClick={onOpenVisuals}
              aria-label="Open visual tools">{tr("Open visual tools","映像ツールを開く")}</button>
          </div>}
          {step==="audio"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{tr("Narration and sound effects","ナレーションと効果音")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {tr("Use the existing video studio to produce and review authorized narration and sound effects.",
                "既存の制作スタジオでナレーションと効果音を作成・確認します。")}
            </p>
            <button type="button" className={primaryButton+" mt-5"} onClick={onOpenAudio}>
              {tr("Open audio tools","音声ツールを開く")}</button>
          </div>}
          {step==="export"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{tr("Preview before exporting","書き出し前に確認")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {tr("Inspect playback and evidence before rendering. Completing steps here never automatically approves or publishes a video.",
                "再生と根拠を確認してから書き出します。各ステップの完了は自動的な承認や公開を意味しません。")}
            </p>
            <button type="button" className={primaryButton+" mt-5"} onClick={onOpenExport}>
              {tr("Open preview & export","確認と書き出しを開く")}</button>
          </div>}
        </div>
      </main>
    </div>
  </section>;
}

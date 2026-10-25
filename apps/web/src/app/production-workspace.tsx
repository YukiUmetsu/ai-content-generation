import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Circle, Loader2, Menu, RotateCcw, ArrowRight, ExternalLink } from "lucide-react";
import type { Locale } from "@/features/registry";
import type { StudioCatalog } from "./catalog-model";
import { loadProjectStoryboard, saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { validateStoryboard } from "@/features/storyboard-planner/model/validate";
import { repairStoryboardEvidence } from "./storyboard-evidence-repair";
import { inspectClaimEvidence, matchesStoryboardResearch } from "./claim-evidence";
import { ProductionClaimIssues } from "./production-claim-issues";
import { createClaimReviewReceipt, isClaimReviewCurrent, loadClaimReviews,
  saveClaimReviews } from "./production-claim-reviews";
import { getProductionStages, PRODUCTION_STAGE_ORDER, type ProductionStageId, type ProductionStageStatus } from "./production-progress";
import type { EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";
import { DiscoverySessionWorkspace } from "./discovery-session-workspace";
import { DiscoveryIdeaSelection } from "./discovery-idea-selection";
import { createProduction, getDiscoverySession, listProductions, listSessionIdeas, type DiscoverySessionIdea, type DiscoveryIdeaBrief,
  type DiscoveryProduction, type DiscoveryPlatform } from "@/lib/api/discovery-sessions";
import { ScriptReviewWorkspace } from "./script-review-workspace";
import { loadScriptDraft, type ScriptDraft } from "./script-review-model";
import { PlatformOptimization, type PlatformOptimizationInput } from "@/features/platform-optimization";
import { resolveProjectAppearance, snapshotProjectAppearance } from "./project-brand-appearance";
import { scriptToStoryboard } from "./script-storyboard-handoff";

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
  onOpenStoryboard: (productionId?:string)=>void;
  onOpenVisuals: (artifactId?:string,productionId?:string)=>void;
  onOpenAudio: (artifactId?:string,productionId?:string)=>void;
  onOpenExport: (artifactId?:string,productionId?:string)=>void;
  onOpenNav: ()=>void;
  onOpenProjects?: ()=>void;
  onCreateStoryboard: (draft:EditorialDraft,research?:ResearchDraftResult)=>boolean;
  onUseVideo: (idea:{title:string;sourceUrl:string})=>boolean;
}
const stageLabels:Record<ProductionStageId,{en:string;ja:string;enDetail:string;jaDetail:string}>={
  setup:{en:"Setup",ja:"準備",enDetail:"Choose your project brand and where this content will be published.",jaDetail:"ブランドと配信先を選びます。"},
  discover:{en:"Discover",ja:"テーマ発見",enDetail:"Run a saved discovery session and reuse its captured evidence.",jaDetail:"保存できるリサーチセッションで根拠を収集します。"},
  select:{en:"Select Idea",ja:"テーマ選択",enDetail:"Compare evidence and decide which original idea to produce.",jaDetail:"根拠を比較し、制作するアイデアを選びます。"},
  script:{en:"Script",ja:"台本",enDetail:"Review the AI-written draft, regenerate individual sections or edit when needed.",jaDetail:"AI作成の台本を確認し、必要な箇所だけ再生成します。"},
  storyboard:{en:"Storyboard",ja:"構成案",enDetail:"Review the story, claims, and visual learning beats.",jaDetail:"構成・主張・視覚的な説明を確認します。"},
  produce:{en:"Produce",ja:"映像制作",enDetail:"Create and review animation, narration, sound and final cuts.",jaDetail:"映像、ナレーション、効果音と編集を確認します。"},
  optimize:{en:"Optimize",ja:"最適化",enDetail:"Review automatically prepared metadata and upload packages by platform.",jaDetail:"プラットフォーム別に自動作成された投稿情報を確認します。"},
  export:{en:"Export",ja:"書き出し",enDetail:"Inspect and export your approved platform packages. Publishing stays under your control.",jaDetail:"承認したパッケージを確認・書き出しします。"},
};
const lastJobKey="contentgen:studio-research-job:latest:v1";
const lastResearchKey="contentgen:studio-research:latest:v1";
const stagesKey=(projectId:string)=>"contentgen:production-step:v1:"+projectId;
const flowKey=(projectId:string)=>"contentgen:production-flow:v2:"+projectId;
const PLATFORM_CHOICES:{id:DiscoveryPlatform;label:string}[]=[
  {id:"youtube",label:"YouTube"},{id:"tiktok",label:"TikTok"},
  {id:"instagram",label:"Instagram"},{id:"facebook",label:"Facebook"},{id:"blog",label:"Blog / Website"},
];
interface FlowSelection {
  platforms:DiscoveryPlatform[];
  sessionId:string|null;
  production:DiscoveryProduction|null;
}
function loadFlowSelection(projectId:string):FlowSelection {
  const fallback:FlowSelection={platforms:["youtube"],sessionId:null,production:null};
  try{
    const raw=JSON.parse(localStorage.getItem(flowKey(projectId))??"null") as Partial<FlowSelection>|null;
    if(!raw||typeof raw!=="object")return fallback;
    const platforms=Array.isArray(raw.platforms)?raw.platforms.filter((id):id is DiscoveryPlatform=>
      PLATFORM_CHOICES.some(choice=>choice.id===id)):fallback.platforms;
    return {platforms:platforms.length?platforms:fallback.platforms,
      sessionId:typeof raw.sessionId==="string"?raw.sessionId:null,
      production:raw.production?.id&&raw.production.projectId===projectId?raw.production:null};
  }catch{return fallback;}
}
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
    if(value==="brief")return "setup";
    if(value==="research")return "discover";
    if(value==="visuals"||value==="audio")return "produce";
    return value && value in stageLabels?value as ProductionStageId:"setup";
  }catch{return "setup";}
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
export function ProductionWorkspace({locale,catalog,onSelectProject,onOpenProjects,onOpenResearch,onOpenStoryboard,
  onOpenVisuals,onOpenAudio,onOpenExport,onOpenNav}:Props){
  const ja=locale==="ja";
  const tr=(en:string,jp:string)=>ja?jp:en;
  const projectId=catalog.activeProjectId;
  const project=catalog.projects.find(item=>item.id===projectId);
  const appearance=resolveProjectAppearance(project??{});
  const [flow,setFlow]=useState<FlowSelection>(()=>loadFlowSelection(projectId));
  const {platforms,sessionId,production}=flow;
  const [selectedIdea,setSelectedIdea]=useState<DiscoverySessionIdea|null>(null);
  const [scriptApproved,setScriptApproved]=useState(false);
  const [scriptDraft,setScriptDraft]=useState<ScriptDraft|null>(null);
  const [optimizationReady,setOptimizationReady]=useState(false);
  const [savedProductions,setSavedProductions]=useState<DiscoveryProduction[]>([]);
  const [loadingProductions,setLoadingProductions]=useState(false);
  const [startingProduction,setStartingProduction]=useState(false);
  const productionKey=production?.id??projectId;
  const allScriptsApproved=()=>Boolean(production)&&platforms.length>0&&platforms.every(platform=>
    loadScriptDraft(production!.id,platform).draft?.status==="approved");
  const platformScripts:Record<string,{id:string;heading:string;text:string}[]>=
    Object.fromEntries(platforms.flatMap(platform=>{
      const saved=production?loadScriptDraft(production.id,platform).draft:null;
      return saved?.sections.length ? [[platform,saved.sections.map(section=>
        ({id:section.id,heading:section.heading,text:section.text}))] as const] : [];
    }));
  const video=catalog.content.filter(item=>item.projectId===projectId&&item.kind==="video").at(-1);
  const topic=production?.brief?.title??video?.name??"";
  const [step,setStep]=useState<ProductionStageId>(()=>previousStep(productionKey));
  const [board,setBoard]=useState(()=>loadProjectStoryboard(productionKey).board);
  const [boardError,setBoardError]=useState<string|null>(()=>loadProjectStoryboard(productionKey).warning);
  const [jobId,setJobId]=useState<string|null>(()=>storedForTopic(lastJobKey,topic,"jobId"));
  const [researchArtifactId,setResearchArtifactId]=useState<string|null>(()=>
    storedForTopic(lastResearchKey,topic,"artifactId"));
  const [job,setJob]=useState<JobState|null>(null);
  const [draft,setDraft]=useState<ResearchDraftResult|null>(null);
  const [error,setError]=useState("");
  const [retryBusy,setRetryBusy]=useState(false);
  const [repairSummary,setRepairSummary]=useState("");
  const [claimReviews,setClaimReviews]=useState(()=>loadClaimReviews(productionKey));

  function updateFlow(next:FlowSelection){
    try{localStorage.setItem(flowKey(projectId),JSON.stringify(next));}
    catch{setError("This selection is open, but browser storage is unavailable. It may not survive a reload.");}
    setFlow(next);
  }
  useEffect(()=>{
    const saved=loadProjectStoryboard(productionKey);
    setBoard(saved.board);setBoardError(saved.warning);
    setClaimReviews(loadClaimReviews(productionKey));
    setScriptApproved(false);setOptimizationReady(false);
    const previous=loadScriptDraft(productionKey,platforms[0]??"youtube");
    setScriptDraft(previous.draft);
    if(production&&platforms.every(platform=>loadScriptDraft(production.id,platform).draft?.status==="approved"))
      setScriptApproved(true);
    setStep(previousStep(productionKey));
  },[productionKey]);
  useEffect(()=>{
    if(!projectId)return;
    const controller=new AbortController();
    setLoadingProductions(true);
    void listProductions(projectId).then(items=>{
      if(!controller.signal.aborted)setSavedProductions(items);
    }).catch(()=>{
      if(!controller.signal.aborted)setSavedProductions([]);
    }).finally(()=>{if(!controller.signal.aborted)setLoadingProductions(false);});
    return ()=>controller.abort();
  },[projectId,production?.id]);
  useEffect(()=>{
    if(!production)return;
    let active=true;
    void listSessionIdeas(projectId,production.sessionId).then(ideas=>{
      if(active)setSelectedIdea(ideas.find(item=>item.id===production.ideaId)??null);
    }).catch(()=>{if(active)setSelectedIdea(null);});
    return ()=>{active=false;};
  },[projectId,production?.id,production?.sessionId,production?.ideaId]);
  async function startProduction(idea:DiscoverySessionIdea,brief:DiscoveryIdeaBrief){
    if(!sessionId||startingProduction)return;
    setStartingProduction(true);setError("");
    try{
      const next=await createProduction({projectId,sessionId,ideaId:idea.id,brief,platforms:brief.platforms});
      updateFlow({...flow,production:next,platforms:brief.platforms});
      setSelectedIdea(idea);setScriptDraft(null);setScriptApproved(false);
      setStep("script");localStorage.setItem(stagesKey(next.id),"script");
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not save this production.");throw reason;}
    finally{setStartingProduction(false);}
  }

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

  const matchingDraft=useMemo(()=>board&&draft&&matchesStoryboardResearch(board,draft)?draft:null,
    [board,draft]);
  const issues=useMemo(()=>board?inspectClaimEvidence(board,matchingDraft??undefined):[],[board,matchingDraft]);
  const reviewedClaims=useMemo(()=>new Set(issues.filter(issue=>
    isClaimReviewCurrent(issue,matchingDraft,claimReviews[issue.claimId])).map(issue=>issue.claimId)),
    [issues,matchingDraft,claimReviews]);
  const unresolved=issues.filter(issue=>issue.kind==="source_missing"||issue.kind==="source_mismatch").length;
  const repeatedScenes=useMemo(()=>board?validateStoryboard(board).filter(issue=>issue.code==="storyboard-repeated-information"):[],[board]);
  const repeatedByBeat=new Map(repeatedScenes.map(issue=>[issue.beatId,issue]));
  const unreviewed=issues.filter(issue=>issue.kind==="source_unchecked"||
    (issue.kind==="needs_factual_review"&&!reviewedClaims.has(issue.claimId))).length;
  const storyboardResearchArtifactId=board?.assumptions.find(value=>value.startsWith("Research artifact: "))?.slice("Research artifact: ".length);
  const stages=getProductionStages({setupReady:Boolean(project&&platforms.length),sessionId,
    ideaId:production?.ideaId,scriptReady:scriptApproved,discoveryReady:Boolean(production?.ideaId),
    discoveryArtifactId:artifactId,discoveryJob:sessionId?null:job,
    storyboardReady:Boolean(board),
    storyboardResearchArtifactId,missingEvidenceClaims:unresolved,unreviewedClaims:unreviewed,
    storyboardEditorialWarnings:repeatedScenes.length,optimizationReady});
  const current=stages.find(item=>item.id===step)!;
  function selectStep(next:ProductionStageId){
    setStep(next);
    try{localStorage.setItem(stagesKey(productionKey),next);}catch{/* Navigation still works without local storage. */}
  }
  function editScene(beatId:string){
    try{sessionStorage.setItem("contentgen:storyboard-focus-beat:v1:"+productionKey,beatId);}
    catch{/* Navigation remains available without session storage. */}
    onOpenStoryboard(productionKey);
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
  function markClaimReviewed(claimId:string){
    setError("");
    const issue=issues.find(item=>item.claimId===claimId);
    if(!issue||!matchingDraft){setError("Load the matching saved research snapshot before reviewing this claim.");return;}
    try{
      const receipt=createClaimReviewReceipt(issue,matchingDraft);
      const next={...claimReviews,[claimId]:receipt};
      saveClaimReviews(productionKey,next);
      setClaimReviews(next);
    }catch(reason){setError(reason instanceof Error?reason.message:"Claim review could not be recorded.");}
  }
  function undoClaimReview(claimId:string){
    const next={...claimReviews};delete next[claimId];
    try{saveClaimReviews(productionKey,next);setClaimReviews(next);setError("");}
    catch(reason){setError(reason instanceof Error?reason.message:"Claim review could not be removed.");}
  }
  function fixStoryboardSources(){
    setError("");setRepairSummary("");
    if(!draft){setError("Load a saved research snapshot before repairing source links.");return;}
    try{
      // Always re-read the live draft. Never write an obsolete in-memory copy over an edit.
      const saved=loadProjectStoryboard(productionKey);
      if(!saved.board)throw Error(saved.warning??"No saved storyboard was found.");
      const result=repairStoryboardEvidence(saved.board,draft);
      if(result.reason){setError("This storyboard does not belong to the loaded research snapshot. Open its original research before repairing references.");return;}
      if(!result.fixed.length){
        setRepairSummary(tr("No source links could be safely repaired. Preserve the claim and find new evidence or edit it manually.",
          "安全に修復できる参照はありません。新しい根拠を探すか、主張を手動で修正してください。"));
        return;
      }
      saveProjectStoryboard(productionKey,result.board);
      setBoard(result.board);
      setRepairSummary(tr(`${result.fixed.length} source link(s) repaired from saved evidence. These claims still need factual review.`,
        `保存された根拠から${result.fixed.length}件の参照を修復しました。事実確認は引き続き必要です。`));
    }catch(reason){setError(reason instanceof Error?reason.message:"Storyboard repair could not be saved.");}
  }
  function createStoryboardOutline(script:ScriptDraft){
    if(board){setError("An editable storyboard already exists. Review it before importing a different script revision.");return;}
    try{
      const next=scriptToStoryboard(script,selectedIdea?.evidence??[]);
      saveProjectStoryboard(productionKey,next);
      setBoard(next);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"The script could not be mapped to a storyboard outline.");}
  }
  const contentCard="rounded-surface border border-border bg-surface p-5 sm:p-6";
  const primaryButton="rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const secondaryButton="rounded-control border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const activeIndex=PRODUCTION_STAGE_ORDER.indexOf(step);
  return <section id="workspace" aria-label={tr("Guided production","制作ガイド")}
    className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpenNav} aria-label={tr("Open navigation","メニューを開く")}
          className="rounded-control p-2 hover:bg-muted lg:hidden"><Menu className="size-5"/></button>
        <div><h1 className="font-serif text-2xl font-semibold">{tr("Production","動画制作")}</h1>
          <p className="text-xs text-muted-foreground">{tr("From discovery to export · eight connected steps · saved along the way","発見から書き出しまで8ステップで進めます。")}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="hidden sm:inline">{project?.name}</span>
        {production&&<span className="rounded-full border border-border bg-surface-subtle px-3 py-1.5">
          {tr("Production saved","制作を保存済み")}
        </span>}
      </div>
    </header>
    <nav aria-label={tr("Production stages","制作ステップ")}
      className="z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-subtle px-3 py-3 lg:justify-between lg:gap-2 lg:px-5">
      {stages.map((item,index)=><button key={item.id} type="button" onClick={()=>selectStep(item.id)}
        aria-current={step===item.id?"step":undefined}
        aria-label={stageLabels[item.id].en+" stage"}
        title={item.reason}
        className={`flex min-w-[132px] flex-1 items-center gap-2 rounded-control px-3 py-2.5 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${step===item.id?"border border-primary/40 bg-surface text-foreground shadow-sm":"border border-transparent text-muted-foreground"}`}>
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${step===item.id?"bg-primary text-primary-foreground":"border border-border"}`}>{index+1}</span>
        <span className="min-w-0 flex-1"><span className="block whitespace-nowrap text-xs font-semibold xl:text-sm">{ja?stageLabels[item.id].ja:stageLabels[item.id].en}</span>
          <span className="block truncate text-[10px]">{statusLabel(item.status,ja)}</span></span>
        {item.status==="complete"?<StatusIcon status={item.status}/>:null}
      </button>)}
    </nav>
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
                {tr("Step","ステップ")} {activeIndex+1} / {PRODUCTION_STAGE_ORDER.length}
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
          {step==="setup"&&<div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
            <div className={contentCard+" space-y-6"}>
              <div>
                <label htmlFor="production-project" className="text-sm font-semibold">{tr("Project / brand","プロジェクト / ブランド")}</label>
                <p className="mt-1 text-xs text-muted-foreground">{tr("Your identity and appearance carry across every video.","動画に共通するブランドです。")}</p>
                <select id="production-project" value={projectId} onChange={event=>onSelectProject(event.target.value)}
                  className="mt-3 w-full rounded-control border border-input bg-surface px-4 py-3 text-base font-medium">
                  {catalog.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground line-clamp-2">{project?.notes||tr("Set your audience, positioning and brand appearance in Projects.","プロジェクトで対象視聴者とデザインを設定します。")}</p>
                  {onOpenProjects&&<button className={secondaryButton+" shrink-0"} onClick={onOpenProjects} type="button">
                    {tr("Edit brand","ブランドを編集")}<ExternalLink className="ml-1 inline size-3"/>
                  </button>}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">{tr("Where should this content go?","配信先を選択")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{tr("Select one or more. Each gets its own optimized export package.","複数選択できます。配信先ごとに最適化します。")}</p>
                <div role="group" aria-label="Target platforms" className="mt-3 flex flex-wrap gap-2">
                  {PLATFORM_CHOICES.map(choice=><button type="button" key={choice.id} aria-label={choice.label} aria-pressed={platforms.includes(choice.id)}
                    onClick={()=>{
                      const next=platforms.includes(choice.id)?platforms.filter(id=>id!==choice.id):[...platforms,choice.id];
                      if(next.length)updateFlow({...flow,platforms:next});
                    }} className={`rounded-full border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${platforms.includes(choice.id)?"border-primary bg-primary/10 text-foreground":"border-border bg-surface text-muted-foreground hover:bg-muted"}`}>
                    {platforms.includes(choice.id)?"✓ ":"+ "}{choice.label}
                  </button>)}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-border pt-5">
                <button type="button" className={primaryButton+" inline-flex items-center gap-2"} onClick={()=>selectStep("discover")}
                  disabled={!platforms.length}>{tr("Continue to discovery","テーマ発見へ")}<ArrowRight className="size-4"/></button>
                <button type="button" className={secondaryButton} onClick={onOpenResearch}>{tr("Open research tools","リサーチツール")}</button>
              </div>
            </div>
            <aside className={contentCard+" space-y-3"}>
              <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{tr("Resume a production","制作を再開")}</h3>
                {loadingProductions&&<Loader2 className="size-4 animate-spin" aria-label="Loading productions"/>}</div>
              {savedProductions.length? <div className="space-y-2">{savedProductions.map(item=><button type="button" key={item.id}
                onClick={()=>{updateFlow({...flow,sessionId:item.sessionId,production:item,platforms:item.platforms});selectStep("script");}}
                className="w-full rounded-control border border-border bg-surface-subtle p-3 text-left hover:border-primary/50">
                <span className="block text-sm font-semibold line-clamp-2">{item.brief.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.platforms.join(" · ")}</span>
              </button>)}</div>:<p className="text-sm leading-6 text-muted-foreground">{tr("Your saved productions will appear here after you select an idea.","テーマを選ぶと制作履歴がここに表示されます。")}</p>}
            </aside>
          </div>}
          {step==="discover"&&<div className="space-y-4">
            <DiscoverySessionWorkspace project={project!} content={catalog.content} platforms={platforms} locale={locale}
              selectedSessionId={sessionId} onSelectSession={(next)=>{
                const selection={...flow,sessionId:next,production:flow.production?.sessionId===next?flow.production:null};
                updateFlow(selection);
                void getDiscoverySession(projectId,next).then(saved=>{
                  // A session's destinations are a durable snapshot: reopening it restores those choices.
                  if(saved.platforms.length)setFlow(current=>{
                    if(current.sessionId!==next)return current;
                    const refreshed={...current,platforms:saved.platforms};
                    try{localStorage.setItem(flowKey(projectId),JSON.stringify(refreshed));}catch{/* Keep the in-memory selection. */}
                    return refreshed;
                  });
                }).catch(()=>{/* The existing selection remains navigable while the local server is unavailable. */});
              }}/>
            {sessionId&&<div className="flex justify-end"><button type="button" className={primaryButton+" inline-flex items-center gap-2"}
              onClick={()=>selectStep("select")}>{tr("Review ideas","アイデアを比較")}<ArrowRight className="size-4"/></button></div>}
          </div>}
          {step==="select"&&(sessionId?<DiscoveryIdeaSelection projectId={projectId} sessionId={sessionId} locale={locale}
            onStartProduction={startProduction}/>:<div className={contentCard}>
            <p className="text-sm text-muted-foreground">{tr("Create or reopen a discovery session first.","最初にテーマ発見セッションを作成・選択してください。")}</p>
            <button type="button" className={primaryButton+" mt-4"} onClick={()=>selectStep("discover")}>{tr("Go to Discover","テーマ発見へ")}</button>
          </div>)}
          {step==="script"&&(production?<div className="space-y-4">
            {selectedIdea&&selectedIdea.sources.length>0&&!selectedIdea.evidence?.length&&<p role="status" className="rounded-control border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm">
              {tr("The idea has source leads but no captured passages yet. Complete evidence collection in Discover before generating factual narration.","出典候補はありますが引用文が未収集です。台本の前に出典を補完してください。")}
              <button type="button" className="ml-2 underline" onClick={()=>selectStep("discover")}>{tr("Review sources","出典を確認")}</button>
            </p>}
            <ScriptReviewWorkspace
            productionId={production.id} projectId={projectId} platforms={platforms} locale={locale}
            title={production.brief.title} viewerQuestion={production.brief.topic||production.brief.title}
            audience={project?.notes?.trim()||"English-speaking learners"} angle={production.brief.angle??""}
            brandVoice={project?.notes??""} evidence={selectedIdea?.evidence??[]}
            onDraftChange={(updated)=>{setScriptDraft(updated);setScriptApproved(allScriptsApproved());setOptimizationReady(false);}}
            onApprove={(approved)=>{setScriptDraft(approved);
              const ready=allScriptsApproved();setScriptApproved(ready);
              if(ready){
                const primary=loadScriptDraft(production.id,platforms[0]??"youtube").draft;
                if(!board&&primary)createStoryboardOutline(primary);
                selectStep("storyboard");
              }
            }}/>
            {!scriptApproved&&platforms.length>1&&<p className="rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground" role="status">
              {tr("Approve each selected destination's script before moving to the storyboard. Completed destinations remain saved while you work on the others.",
                "構成案へ進む前に、配信先ごとの台本を承認してください。承認済みの内容は保存されます。")}
            </p>}
          </div>:<div className={contentCard}>
            <p className="text-sm text-muted-foreground">{tr("Choose a discovery idea to let AI draft the script.","アイデアを選択するとAIが台本を作成します。")}</p>
            <button type="button" className={primaryButton+" mt-4"} onClick={()=>selectStep("select")}>{tr("Select an idea","テーマを選択")}</button>
          </div>)}
          {step==="storyboard"&&<>
            {repairSummary&&<p role="status" className="rounded-control border border-border bg-surface p-3 text-sm">{repairSummary}</p>}
            {board?<div className={contentCard}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-serif text-xl font-semibold">{tr("Review your scenes","シーンを確認")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{board.beats.length} {tr("scenes","シーン")} · {board.title}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {unresolved>0&&draft&&<button type="button" className={secondaryButton} onClick={fixStoryboardSources}>
                    {tr("Repair source links","出典参照を修復")}
                  </button>}
                  <button type="button" className={primaryButton}
                    onClick={()=>editScene(repeatedScenes[0]?.beatId??board.beats[0]?.id??"")}>
                    {repeatedScenes.length?tr("Review flagged scene","指摘されたシーンを確認"):tr("Edit storyboard","構成案を編集")}
                  </button>
                </div>
              </div>
              {repeatedScenes.length>0&&<p role="status" className="mt-4 rounded-control border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-foreground">
                {repeatedScenes.length} {tr(repeatedScenes.length===1?"potentially repeated scene":"potentially repeated scenes","件のシーンで内容が重複している可能性があります")} · {tr("Review before making visuals.","映像制作の前に確認してください。")}
              </p>}
              <ol className="mt-4 grid gap-3">
                {board.beats.map((beat,index)=>{
                  const repeated=repeatedByBeat.get(beat.id);
                  return <li key={beat.id} className="rounded-control border border-border bg-surface-subtle p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold tabular-nums">{index+1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{beat.role}</p>
                        <p className="mt-0.5 font-semibold leading-6">{beat.onScreenText||beat.objective}</p>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">{beat.objective}</p>
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{tr("Visual: ","映像: ")}{beat.visualObjective}</p>
                        {repeated&&<p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          {tr("Similar to scene","シーンと類似")} {String(repeated.params?.previousIndex??"?")}
                        </p>}
                      </div>
                      <button type="button" className={secondaryButton+" shrink-0"}
                        aria-label={`Edit scene ${index+1}`} onClick={()=>editScene(beat.id)}>
                        {tr("Edit","編集")}
                      </button>
                    </div>
                  </li>;
                })}
              </ol>
              <div className="mt-5 flex justify-end border-t border-border pt-4">
                <button type="button" className={secondaryButton} onClick={()=>selectStep("produce")}>
                  {tr("Continue to production","映像制作へ進む")}
                </button>
              </div>
            </div>:<div className={contentCard}>
              <h3 className="font-serif text-xl font-semibold">{tr("Create your storyboard","構成案を作成")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{tr("Start with your approved script. Use the existing storyboard planner to arrange the scenes.","承認した台本からシーンを構成します。")}</p>
              {production&&scriptDraft?.status==="approved"&&<button type="button" className={primaryButton+" mt-4"}
                onClick={()=>createStoryboardOutline(scriptDraft)}>{tr("Create editable outline from approved script","承認済み台本から構成案を生成")}</button>}
              {(!production||scriptDraft?.status!=="approved")&&<button type="button" className={primaryButton+" mt-4"}
                onClick={()=>selectStep("script")}>{tr("Review script first","先に台本を確認")}</button>}
            </div>}
            {board&&<ProductionClaimIssues issues={issues} draft={matchingDraft} locale={locale}
              reviewedClaims={reviewedClaims} onMarkReviewed={markClaimReviewed} onUndoReviewed={undoClaimReview}
              onOpenBeat={editScene} onFindEvidence={()=>selectStep("discover")}
              onRetryRepair={job?.status==="paused"&&job.stage==="evidence-repair"?()=>void retryEvidence():undefined}/>}
          </>}
          {step==="produce"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{tr("Produce your video or article","動画や記事を制作")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {tr("Continue in the existing Kumiki-powered director for visual scenes, narration and sound. Your saved script, brand and storyboard stay separate from the rendering engine.",
                "既存のディレクターで映像、ナレーション、音声を制作します。")}
            </p>
            {!matchingDraft?.artifactId&&<p role="status" className="mt-4 rounded-control border border-status-warning/40 bg-surface-subtle p-3 text-sm text-muted-foreground">
              {tr("This script-derived storyboard is an editable outline, not yet a renderable Director bundle. Review its scenes in Storyboard Planner, then open Director to import a compatible saved project or create a renderable plan from research. Nothing has been rendered automatically.",
                "台本から作成した構成案は編集可能ですが、まだレンダリング可能な映像ではありません。構成案を確認し、ディレクターで対応するプロジェクトを開いてください。")}
            </p>}
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className={secondaryButton} onClick={()=>onOpenStoryboard(productionKey)}>
                {tr("Edit storyboard outline","構成案を編集")}</button>
              <button type="button" className={primaryButton} onClick={()=>onOpenVisuals(matchingDraft?.artifactId,productionKey)} aria-label="Open visual tools">
                {matchingDraft?.artifactId?tr("Open video director","映像ディレクターを開く"):tr("Open director / import project","ディレクターで読み込む")}</button>
              <button type="button" className={secondaryButton} onClick={()=>onOpenAudio(matchingDraft?.artifactId,productionKey)}>
                {tr("Narration & sound","ナレーションと音声")}</button>
            </div>
            {platforms.includes("blog")&&<p className="mt-4 text-sm text-muted-foreground">{tr("For blog content, keep the researched script as an article draft until a dedicated article export is available.","ブログ記事は記事の書き出しに対応するまで台本を保存してください。")}</p>}
          </div>}
          {step==="optimize"&&(production?<PlatformOptimization input={{
            productionId:production.id,projectId,title:production.brief.title,platforms,
            scriptSections:(scriptDraft?.sections??[]).map(section=>({id:section.id,heading:section.heading,text:section.text})),
            platformScripts,
            summary:production.brief.description,audience:project?.notes||undefined,
            brandColors:{...snapshotProjectAppearance(project??{}).palette,
              custom:appearance.palette.custom.map(item=>item.hex)},
            sourceRevision:`project-palette-${appearance.revision}`,
          } satisfies PlatformOptimizationInput} onManifestChange={(manifest)=>{
            setOptimizationReady(manifest.packages.length>0 && manifest.packages.every(item=>item.status==="approved"));
          }}/>:<div className={contentCard}>
            <p className="text-sm text-muted-foreground">{tr("Select an idea and create a production to prepare platform metadata.","制作するアイデアを選んでください。")}</p>
            <button type="button" className={primaryButton+" mt-4"} onClick={()=>selectStep("select")}>{tr("Select idea","テーマを選択")}</button>
          </div>}
          {step==="export"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{tr("Preview before exporting","書き出し前に確認")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {tr("Inspect playback and evidence before rendering. Completing steps here never automatically approves or publishes a video.",
                "再生と根拠を確認してから書き出します。各ステップの完了は自動的な承認や公開を意味しません。")}
            </p>
            <button type="button" className={primaryButton+" mt-5"} onClick={()=>onOpenExport(matchingDraft?.artifactId,productionKey)}>
              {tr("Open preview & export","確認と書き出しを開く")}</button>
          </div>}
        </div>
    </main>
  </section>;
}

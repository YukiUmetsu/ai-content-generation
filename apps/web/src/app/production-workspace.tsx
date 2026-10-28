import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Menu, ArrowRight, ExternalLink } from "lucide-react";
import { Stepper } from "@/components/ui/stepper";
import type { StepperStates, StepperStep } from "@/components/ui/stepper";
import type { Locale } from "@/features/registry";
import type { StudioCatalog } from "./catalog-model";
import { loadProjectStoryboard, saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { validateStoryboard } from "@/features/storyboard-planner/model/validate";
import type { SemanticStoryboard } from "@/features/storyboard-planner/model/types";
import { repairStoryboardEvidence } from "./storyboard-evidence-repair";
import { inspectClaimEvidence, matchesStoryboardResearch } from "./claim-evidence";
import { ProductionClaimIssues } from "./production-claim-issues";
import { createClaimReviewReceipt, isClaimReviewCurrent, loadClaimReviews,
  saveClaimReviews } from "./production-claim-reviews";
import { getProductionStages, type ProductionStageId, type ProductionStageStatus } from "./production-progress";
import type { EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";
import { DiscoverySessionWorkspace } from "./discovery-session-workspace";
import { DiscoveryIdeaSelection } from "./discovery-idea-selection";
import { createProduction, getDiscoverySession, listProductions, listSessionIdeas, type DiscoverySessionIdea, type DiscoveryIdeaBrief,
  type DiscoveryProduction, type DiscoveryPlatform } from "@/lib/api/discovery-sessions";
import type { DiscoveryRun } from "@/lib/api/discovery";
import { ScriptReviewWorkspace } from "./script-review-workspace";
import { isScriptContextCurrent, loadScriptDraft, scriptEvidenceFingerprint, type ScriptDraft } from "./script-review-model";
import { PlatformOptimization, type PlatformOptimizationInput } from "@/features/platform-optimization";
import { loadPlatformOptimization } from "@/features/platform-optimization/storage";
import { sourceSignature, type PlatformAsset } from "@/features/platform-optimization/model";
import { resolveProjectAppearance, snapshotProjectAppearance } from "./project-brand-appearance";
import { scriptToStoryboard, syncScriptStoryboard } from "./script-storyboard-handoff";

import { scriptClaimSnapshot } from "./script-claim-evidence";
import type { ClaimEvidenceSnapshot } from "./claim-evidence";
import { productionMediaSource } from "./production-lineage";
import { productionEvidence, type ProductionEvidenceSnapshot } from "@/lib/api/production-evidence";
import { VideoDirectorWorkspace } from "./video-director-workspace";

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
interface MediaSnapshot {
  productionId:string;
  status:"loading"|"ready"|"error";
  assets:PlatformAsset[];
  error?:string;
}
interface Props {
  workspaceId?:string|null;
  locale: Locale;
  catalog: StudioCatalog;
  onSelectProject: (projectId:string)=>void;
  onOpenResearch: ()=>void;
  onOpenJobs?: ()=>void;
  onOpenStoryboard: (productionId?:string)=>void;
  onOpenVisuals: (artifactId?:string,productionId?:string)=>void;
  onOpenAudio: (artifactId?:string,productionId?:string)=>void;
  onOpenDraft: (artifactId?:string,productionId?:string)=>void;
  onOpenExport: (artifactId?:string,productionId?:string)=>void;
  onOpenNav: ()=>void;
  directorEntry?:{projectId:string;artifactId?:string;stage:"visuals"|"audio"|"draft"|"export"}|null;
  directorDirty?:boolean;
  onDirectorDirtyChange?:(dirty:boolean)=>void;
  onOpenProjects?: ()=>void;
  onCreateStoryboard: (draft:EditorialDraft,research?:ResearchDraftResult)=>boolean;
  onUseVideo: (idea:{title:string;sourceUrl:string})=>boolean;
}
const stageLabels:Record<ProductionStageId,{en:string;ja:string;enDetail:string;jaDetail:string}>={
  setup:{en:"Setup",ja:"準備",enDetail:"Choose your project brand and where this content will be published.",jaDetail:"ブランドと配信先を選びます。"},
  discover:{en:"Discover",ja:"テーマ発見",enDetail:"Run a saved discovery session and reuse its captured evidence.",jaDetail:"保存できるリサーチセッションで根拠を収集します。"},
  select:{en:"Select Idea",ja:"テーマ選択",enDetail:"Compare evidence and decide which original idea to produce.",jaDetail:"根拠を比較し、制作するアイデアを選びます。"},
  script:{en:"Script",ja:"台本",enDetail:"Review the AI-written draft, regenerate individual sections or edit when needed.",jaDetail:"AI作成の台本を確認し、必要な箇所だけ再生成します。"},
  storyboard:{en:"Plan Scenes",ja:"構成案",enDetail:"Your script becomes a scene-by-scene visual plan. Check that the ideas flow, then continue.",jaDetail:"台本をシーンごとの映像計画に変換し、流れを確認します。"},
  produce:{en:"Create Video",ja:"映像制作",enDetail:"Edit scenes, choose voices, add sound, and watch your draft without leaving Production.",jaDetail:"制作画面を離れずにシーンと音声を編集し、下書き映像を確認できます。"},
  optimize:{en:"Publish Kit",ja:"投稿準備",enDetail:"Find your platform-specific titles, captions, covers, and illustrated blog files together.",jaDetail:"配信先ごとのタイトル、説明文、カバー画像、ブログ素材を準備します。"},
  export:{en:"Export",ja:"書き出し",enDetail:"Inspect and export your approved platform packages. Publishing stays under your control.",jaDetail:"承認したパッケージを確認・書き出しします。"},
};
const lastJobKey="contentgen:studio-research-job:latest:v1";
const lastResearchKey="contentgen:studio-research:latest:v1";
const stagesKey=(projectId:string)=>"contentgen:production-step:v1:"+projectId;
const flowKey=(projectId:string)=>"contentgen:production-flow:v2:"+projectId;
const storyboardBackupKey=(productionId:string)=>"contentgen:storyboard-before-script-sync:v1:"+productionId;
const PLATFORM_CHOICES:{id:DiscoveryPlatform;label:string}[]=[
  {id:"youtube",label:"YouTube"},{id:"youtube_shorts",label:"YouTube Shorts"},{id:"tiktok",label:"TikTok"},
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
    const production=raw.production?.id&&raw.production.projectId===projectId?raw.production:null;
    const frozen=production?.platforms?.filter((id):id is DiscoveryPlatform=>
      PLATFORM_CHOICES.some(choice=>choice.id===id))??[];
    return {platforms:frozen.length?frozen:platforms.length?platforms:fallback.platforms,
      sessionId:typeof raw.sessionId==="string"?raw.sessionId:null,
      production};
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
const statusToStepper:Record<ProductionStageStatus,string>={
  not_started:"not-started",running:"started",complete:"complete",
  needs_review:"needs-review",failed:"failed",stale:"stale",
};
export function ProductionWorkspace(props:Props){
  return <ProductionWorkspaceProject key={props.catalog.activeProjectId} {...props}/>;
}
function ProductionWorkspaceProject({locale,catalog,onSelectProject,onOpenProjects,onOpenResearch,onOpenJobs,onOpenStoryboard,
  onOpenVisuals,onOpenAudio,onOpenDraft,onOpenExport,onOpenNav,directorEntry,directorDirty=false,onDirectorDirtyChange,workspaceId="workspace"}:Props){
  const ja=locale==="ja";
  const tr=(en:string,jp:string)=>ja?jp:en;
  const projectId=catalog.activeProjectId;
  const project=catalog.projects.find(item=>item.id===projectId);
  const appearance=resolveProjectAppearance(project??{});
  const [flow,setFlow]=useState<FlowSelection>(()=>loadFlowSelection(projectId));
  const {platforms,sessionId,production}=flow;
  const [sessionDiscovery,setSessionDiscovery]=useState<{
    sessionId:string;run:DiscoveryRun|null;ideaCount:number|null
  }|null>(null);
  const [selectedIdea,setSelectedIdea]=useState<DiscoverySessionIdea|null>(null);
  const [evidenceState,setEvidenceState]=useState<{productionId:string;snapshot:ProductionEvidenceSnapshot|null;error:string;loading:boolean}|null>(null);
  const [collectingEvidence,setCollectingEvidence]=useState(false);
  const evidenceAbort=useRef<AbortController|null>(null);
  const [ideaError,setIdeaError]=useState("");
  const [ideaRefresh,setIdeaRefresh]=useState(0);
  const sourceIdea=selectedIdea?.id===production?.ideaId?selectedIdea:null;
  const savedEvidence=evidenceState?.productionId===production?.id?evidenceState:null;
  const snapshot=savedEvidence?.snapshot;
  const currentIdea=sourceIdea&&snapshot?{...sourceIdea,evidence:snapshot.evidence,sources:snapshot.sources}:sourceIdea;
  const [scriptActivity,setScriptActivity]=useState<"idle"|"running"|"failed">("idle");
  useEffect(()=>{
    if(!production)return;
    const controller=new AbortController();
    void productionEvidence(production.id,{signal:controller.signal}).then(snapshot=>{
      if(!controller.signal.aborted)setEvidenceState({productionId:production.id,snapshot,error:"",loading:false});
    }).catch(reason=>{
      if(!controller.signal.aborted)setEvidenceState({productionId:production.id,snapshot:null,
        error:reason instanceof Error?reason.message:"Saved script evidence could not be loaded.",loading:false});
    });
    return ()=>{controller.abort();evidenceAbort.current?.abort();};
  },[production,ideaRefresh]);
  async function collectScriptEvidence(){
    if(!production||collectingEvidence)return;
    const controller=new AbortController();evidenceAbort.current=controller;
    setCollectingEvidence(true);
    try{
      const snapshot=await productionEvidence(production.id,{locale,signal:controller.signal});
      if(!snapshot||snapshot.projectId!==projectId||snapshot.ideaId!==production.ideaId)
        throw Error("Captured sources do not belong to this production.");
      setEvidenceState({productionId:production.id,snapshot,error:"",loading:false});
    }catch(reason){
      if(!controller.signal.aborted)setEvidenceState(previous=>({productionId:production.id,
        snapshot:previous?.productionId===production.id?previous.snapshot:null,loading:false,
        error:reason instanceof Error?reason.message:"Source collection failed. Retry when the local server is available."}));
    }finally{setCollectingEvidence(false);}
  }
  const [,refreshScriptState]=useState(0);
  const [loadedProductions,setLoadedProductions]=useState<{
    projectId:string;productionId:string|undefined;items:DiscoveryProduction[];
  }|null>(null);
  const savedProductions=loadedProductions?.projectId===projectId?loadedProductions.items:[];
  const loadingProductions=Boolean(projectId&&(loadedProductions?.projectId!==projectId||
    loadedProductions.productionId!==production?.id));
  const [startingProduction,setStartingProduction]=useState(false);
  const [openingDirector,setOpeningDirector]=useState(false);
  const [mediaRefresh,setMediaRefresh]=useState(0);
  const [mediaResult,setMediaResult]=useState<(MediaSnapshot&{refresh:number})|null>(null);
  const mediaSnapshot:MediaSnapshot|null=production?
    mediaResult?.productionId===production.id&&mediaResult.refresh===mediaRefresh?mediaResult:
      {productionId:production.id,status:"loading",assets:[]}:null;
  const productionKey=production?.id??projectId;
  const currentDirectorEntry=directorEntry?.projectId===productionKey?directorEntry:null;
  const directorRegion=useRef<HTMLDivElement>(null);
  const renderAssets=mediaSnapshot&&mediaSnapshot.productionId===production?.id&&mediaSnapshot.status==="ready"?mediaSnapshot.assets:[];
  useEffect(()=>{
    if(!production)return;
    const controller=new AbortController();
    void fetch("/api/contentgen-video/assets/"+encodeURIComponent(production.id),{signal:controller.signal,
      credentials:"same-origin",cache:"no-store"}).then(async response=>{
      if(!response.ok)throw Error(`Rendered-file lookup failed (HTTP ${response.status}).`);
      const data=await response.json() as {assets?:unknown};
      if(!Array.isArray(data.assets))throw Error("Rendered-file response is invalid.");
      const assets:PlatformAsset[]=data.assets.filter((value:unknown):value is PlatformAsset=>
        value!==null&&typeof value==="object"&&
        typeof (value as PlatformAsset).id==="string"&&
        ["video","captions","thumbnail","hero"].includes((value as PlatformAsset).kind)&&
        typeof (value as PlatformAsset).downloadUrl==="string"&&
        (value as PlatformAsset).downloadUrl!.startsWith("/api/contentgen-video/media/"));
      if(!controller.signal.aborted)setMediaResult({productionId:production.id,refresh:mediaRefresh,status:"ready",assets});
    }).catch(reason=>{
      if(!controller.signal.aborted)setMediaResult({productionId:production.id,refresh:mediaRefresh,status:"error",assets:[],
        error:reason instanceof Error?reason.message:"Could not read rendered files."});
    });
    return ()=>controller.abort();
  },[production,mediaRefresh]);
  const isPlatformScriptApproved=(platform:DiscoveryPlatform):boolean=>{
      if(!production||!currentIdea)return false;
      const saved=loadScriptDraft(production!.id,platform).draft;
      return Boolean(saved?.status==="approved"&&isScriptContextCurrent(saved,{
        productionId:production!.id,projectId,platform,locale,
        title:production!.brief.title,viewerQuestion:production!.brief.topic||production!.brief.title,
        audience:project?.notes?.trim().slice(0,160)||(locale==="ja"?"日本語の学習者":"English-speaking learners"),
        angle:production!.brief.angle??"",brandVoice:project?.notes??"",
        evidenceSnapshotId:scriptEvidenceFingerprint(currentIdea?.evidence??[]),
      }));
    };
  const allScriptsApproved=()=>platforms.length>0&&platforms.every(isPlatformScriptApproved);
  const scriptApproved=allScriptsApproved();
  const approvedPlatforms=platforms.filter(isPlatformScriptApproved);
  const anyApprovedScript=Boolean(production&&platforms.some(platform=>
    loadScriptDraft(production.id,platform).draft?.status==="approved"));
  const scriptStale=anyApprovedScript&&!scriptApproved&&Boolean(currentIdea);
  const platformScripts:Record<string,{id:string;heading:string;text:string;sourceRefs:string[]}[]>=
    Object.fromEntries(platforms.flatMap(platform=>{
      const saved=production?loadScriptDraft(production.id,platform).draft:null;
      return saved?.sections.length ? [[platform,saved.sections.map(section=>
        ({id:section.id,heading:section.heading,text:section.text,sourceRefs:section.sourceRefs}))] as const] : [];
    }));
  const video=catalog.content.filter(item=>item.projectId===projectId&&item.kind==="video").at(-1);
  const topic=production?.brief?.title??video?.name??"";
  const [step,setStep]=useState<ProductionStageId>(()=>previousStep(productionKey));
  useEffect(()=>{
    if(!currentDirectorEntry)return;
    setStep("produce");
    try{localStorage.setItem(stagesKey(productionKey),"produce");}catch{/* Keep navigation available. */}
    const frame=requestAnimationFrame(()=>directorRegion.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[currentDirectorEntry,productionKey]);
  const [activeRender,setActiveRender]=useState<{productionId?:string|null;state:string;phase?:string;
    message?:string;jobId?:string|null;progress?:{completedFrames?:number;totalFrames?:number}|null}|null>(null);
  useEffect(()=>{
    if(!production||step!=="produce")return;
    let active=true;
    const controller=new AbortController();
    const poll=()=>{void fetch("/api/contentgen-video/status",{signal:controller.signal,cache:"no-store"})
      .then(response=>response.ok?response.json():null)
      .then(data=>{if(active&&data?.productionId===production.id)setActiveRender(data);})
      .catch(()=>{/* Jobs remain accessible when the Director worker is offline. */});};
    poll();const timer=window.setInterval(poll,2500);
    return ()=>{active=false;controller.abort();window.clearInterval(timer);};
  },[production,step]);
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
  const [confirmStoryboardRefresh,setConfirmStoryboardRefresh]=useState(false);
  const [hasStoryboardBackup,setHasStoryboardBackup]=useState(()=>{
    try{return Boolean(localStorage.getItem(storyboardBackupKey(productionKey)));}catch{return false;}
  });
  const [claimReviews,setClaimReviews]=useState(()=>loadClaimReviews(productionKey));
  const [previousProductionKey,setPreviousProductionKey]=useState(productionKey);
  // Reinitialize production-scoped editor state before React commits a new production.
  if(previousProductionKey!==productionKey){
    const saved=loadProjectStoryboard(productionKey);
    setPreviousProductionKey(productionKey);
    setBoard(saved.board);setBoardError(saved.warning);
    setClaimReviews(loadClaimReviews(productionKey));
    setConfirmStoryboardRefresh(false);
    try{setHasStoryboardBackup(Boolean(localStorage.getItem(storyboardBackupKey(productionKey))));}
    catch{setHasStoryboardBackup(false);}
    setStep(previousStep(productionKey));
  }
  // A landscape YouTube film is the Director's currently supported media
  // format; never silently source its storyboard from a Shorts/blog script.
  const primaryPlatform=platforms.includes("youtube")?"youtube":platforms[0]??"youtube";
  const primaryScript=production?loadScriptDraft(production.id,primaryPlatform).draft:null;
  const videoScript=production&&platforms.includes("youtube")?
    loadScriptDraft(production.id,"youtube").draft:null;
  const boardScriptStale=Boolean(production&&board&&(
    !primaryScript||![`Script revision: ${primaryScript.updatedAt}.`,
      `Approved script revision: ${primaryScript.updatedAt}.`].some(note=>board.assumptions.includes(note))));
  const currentMediaPrefix=board&&videoScript?productionMediaSource(videoScript.updatedAt,board):null;
  const currentRenderAssets=currentMediaPrefix?renderAssets.filter(asset=>asset.sourceRevision?.startsWith(currentMediaPrefix)):[];
  const hasCurrentVideo=currentRenderAssets.some(asset=>asset.kind==="video");
  const optimizationInput:PlatformOptimizationInput={
    productionId:production?.id??projectId,projectId,
    title:production?.brief.title??"",platforms,approvedPlatforms,
    scriptSections:(primaryScript?.sections??[]).map(section=>({id:section.id,heading:section.heading,text:section.text,sourceRefs:section.sourceRefs})),
    platformScripts,
    sourceEvidence:(currentIdea?.evidence??[]).map(item=>({sourceId:item.sourceId,sourceUrl:item.sourceUrl,reviewStatus:item.reviewStatus})),
    assets:currentRenderAssets,
    summary:production?.brief.description,audience:project?.notes||undefined,
    brandColors:{...snapshotProjectAppearance(project??{}).palette,
      custom:appearance.palette.custom.map(item=>item.hex)},
    // Per-destination signatures already include that destination's full
    // script and approval state. A shared list of all script timestamps would
    // incorrectly revoke YouTube approval when Blog is edited (and vice versa).
    sourceRevision:`project-palette-${appearance.revision}`,
  };
  const savedOptimization=production?loadPlatformOptimization(production.id,projectId).manifest:null;
  const optimizationReady=Boolean(savedOptimization?.packages.length===platforms.length&&
    savedOptimization.packages.every(item=>item.status==="approved"&&!item.stale&&
      item.sourceSignature===sourceSignature(optimizationInput,item.platform)));

  function updateFlow(next:FlowSelection){
    try{localStorage.setItem(flowKey(projectId),JSON.stringify(next));}
    catch{setError("This selection is open, but browser storage is unavailable. It may not survive a reload.");}
    setFlow(next);
  }
  useEffect(()=>{
    if(!projectId)return;
    const controller=new AbortController();
    void listProductions(projectId).then(items=>{
      if(!controller.signal.aborted)setLoadedProductions({projectId,productionId:production?.id,items});
    }).catch(()=>{
      if(!controller.signal.aborted)setLoadedProductions({projectId,productionId:production?.id,items:[]});
    });
    return ()=>controller.abort();
  },[projectId,production?.id]);
  useEffect(()=>{
    if(!sessionId){return;}
    if(step==="discover")return; // The visible Discover panel owns polling while it is mounted.
    const controller=new AbortController();
    const refresh=()=>{
      void getDiscoverySession(projectId,sessionId,controller.signal).then(saved=>{
        if(!controller.signal.aborted)setSessionDiscovery({
          sessionId,run:saved.lastRun??null,ideaCount:saved.ideaCount??null});
      }).catch(()=>{/* Keep last confirmed state when the local server is temporarily unreachable. */});
    };
    refresh();
    const timer=window.setInterval(refresh,3500);
    return ()=>{controller.abort();window.clearInterval(timer);};
  },[projectId,sessionId,step]);
  useEffect(()=>{
    if(!production)return;
    let active=true;
    void listSessionIdeas(projectId,production.sessionId).then(ideas=>{
      if(active){
        const idea=ideas.find(item=>item.id===production.ideaId)??null;
        setSelectedIdea(idea);setIdeaError(idea?"":"The selected idea is missing from its saved session.");
      }
    }).catch(reason=>{if(active){setSelectedIdea(null);setIdeaError(reason instanceof Error?reason.message:"Could not load the selected idea.");}});
    return ()=>{active=false;};
  },[projectId,production,ideaRefresh]);
  async function startProduction(idea:DiscoverySessionIdea,brief:DiscoveryIdeaBrief){
    if(!sessionId||startingProduction)return;
    setStartingProduction(true);setError("");
    try{
      const next=await createProduction({projectId,sessionId,ideaId:idea.id,brief,platforms:brief.platforms});
      updateFlow({...flow,production:next,platforms:brief.platforms});
      setSelectedIdea(idea);refreshScriptState(value=>value+1);
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
  const [scriptClaims,setScriptClaims]=useState<{productionId:string;fingerprint:string;draft:ClaimEvidenceSnapshot}|null>(null);
  const evidenceFingerprint=scriptEvidenceFingerprint(currentIdea?.evidence??[]);
  const claimScript=primaryScript;
  const claimSources=currentIdea?.sources;
  const claimEvidence=currentIdea?.evidence;
  useEffect(()=>{
    if(!production||!claimScript||!claimEvidence?.length||!claimSources||
      claimScript.input.evidenceSnapshotId!==evidenceFingerprint)return;
    let active=true;
    void scriptClaimSnapshot(claimScript,claimEvidence,claimSources).then(draft=>{
      if(active)setScriptClaims({productionId:production.id,fingerprint:evidenceFingerprint,draft});
    }).catch(()=>{/* Missing source provenance stays visible as a claim-review issue. */});
    return ()=>{active=false;};
    // Exact evidence fingerprint covers the full script source context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[production?.id,evidenceFingerprint,claimScript?.updatedAt]);
  const claimDraft=matchingDraft??(production&&board&&!boardScriptStale&&scriptClaims?.productionId===production.id&&
    scriptClaims.fingerprint===evidenceFingerprint?scriptClaims.draft:null);
  const issues=useMemo(()=>board?inspectClaimEvidence(board,claimDraft??undefined):[],[board,claimDraft]);
  const reviewedClaims=useMemo(()=>new Set(issues.filter(issue=>
    isClaimReviewCurrent(issue,claimDraft,claimReviews[issue.claimId])).map(issue=>issue.claimId)),
    [issues,claimDraft,claimReviews]);
  const unresolved=issues.filter(issue=>issue.kind==="source_missing"||issue.kind==="source_mismatch").length;
  const repeatedScenes=useMemo(()=>board?validateStoryboard(board).filter(issue=>issue.code==="storyboard-repeated-information"):[],[board]);
  const repeatedByBeat=new Map(repeatedScenes.map(issue=>[issue.beatId,issue]));
  const unreviewed=issues.filter(issue=>issue.kind==="source_unchecked"||
    (issue.kind==="needs_factual_review"&&!reviewedClaims.has(issue.claimId))).length;
  const storyboardResearchArtifactId=board?.assumptions.find(value=>value.startsWith("Research artifact: "))?.slice("Research artifact: ".length);
  const activeDiscovery=sessionDiscovery?.sessionId===sessionId?sessionDiscovery:null;
  const youtubeReady=Boolean(videoScript?.sections.length&&videoScript.sections.every(section=>section.text.trim()));
  const stages=getProductionStages({setupReady:Boolean(project&&platforms.length),sessionId,
    ideaId:production?.ideaId,scriptReady:platforms.includes("youtube")?youtubeReady:scriptApproved,
    scriptStale:platforms.includes("youtube")&&youtubeReady?false:scriptStale,discoveryReady:Boolean(production?.ideaId),
    discoveryArtifactId:sessionId?null:artifactId,discoveryJob:sessionId?null:job,
    discoverySessionRun:activeDiscovery?.run,discoveryIdeaCount:activeDiscovery?.ideaCount,
    storyboardReady:Boolean(board),storyboardScriptStale:boardScriptStale,
    storyboardResearchArtifactId,missingEvidenceClaims:unresolved,unreviewedClaims:unreviewed,
    storyboardEditorialWarnings:repeatedScenes.length,optimizationReady,
    scriptActivity:step==="script"?scriptActivity:"idle",
    visualReady:hasCurrentVideo,audioReady:hasCurrentVideo,exportReady:hasCurrentVideo});
  const canOpenDirector=Boolean(matchingDraft?.artifactId||production&&videoScript&&
    videoScript.sections.length>0&&videoScript.sections.every(section=>section.text.trim()));
  const current=stages.find(item=>item.id===step)!;
  const stepperStates:StepperStates={
    "not-started":{label:statusLabel("not_started",ja)},
    started:{label:statusLabel("running",ja),tone:"info"},
    complete:{label:statusLabel("complete",ja)},
    "needs-review":{label:statusLabel("needs_review",ja),tone:"warning"},
    failed:{label:statusLabel("failed",ja),tone:"danger"},
    stale:{label:statusLabel("stale",ja),tone:"warning"},
  };
  const stepperSteps:StepperStep[]=stages.map(item=>({
    id:item.id,label:ja?stageLabels[item.id].ja:stageLabels[item.id].en,
    status:statusToStepper[item.status],hint:step===item.id?item.reason:undefined,
  }));
  function selectStep(next:ProductionStageId){
    if(currentDirectorEntry&&directorDirty&&next!=="produce"){
      setError("Save or discard the edited scene before leaving Create Video. Your changes are still in the scene editor.");
      return;
    }
    setError("");
    setStep(next);
    try{localStorage.setItem(stagesKey(productionKey),next);}catch{/* Navigation still works without local storage. */}
  }
  async function openDirector(stage:"visuals"|"audio"|"draft"|"export"){
    if(openingDirector)return;
    if(!production&&matchingDraft?.artifactId){
      (stage==="visuals"?onOpenVisuals:stage==="audio"?onOpenAudio:stage==="draft"?onOpenDraft:onOpenExport)(matchingDraft.artifactId,productionKey);
      return;
    }
    if(!production||!videoScript||!videoScript.sections.length||videoScript.sections.some(section=>!section.text.trim())){
      setError("Finish the YouTube script first. Other platform scripts can remain unfinished.");
      return;
    }
    setOpeningDirector(true);setError("");
    try{
      const saved=loadProjectStoryboard(production.id);
      if(saved.warning)throw Error(saved.warning);
      const refreshed=syncScriptStoryboard(videoScript,currentIdea?.evidence??[],saved.board);
      const changed=JSON.stringify(saved.board)!==JSON.stringify(refreshed);
      if(changed){
        // Back up before overwriting; a storage failure must not discard edits.
        if(saved.board){
          localStorage.setItem(storyboardBackupKey(production.id),JSON.stringify(saved.board));
          setHasStoryboardBackup(true);
        }
        saveProjectStoryboard(production.id,refreshed);
        setBoard(refreshed);
        setConfirmStoryboardRefresh(false);
      }
      const response=await fetch("/api/contentgen-director/compile-approved-script",{
        method:"POST",headers:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
        body:JSON.stringify({productionId:production.id,script:videoScript,
          evidence:currentIdea?.evidence??[],sources:currentIdea?.sources??[],storyboard:refreshed}),
        signal:AbortSignal.timeout(20000),
      });
      const result=await response.json() as Record<string,unknown>;
      if(!response.ok)throw Error(String(result.error??"Cannot create the draft scene plan."));
      if((result.dossier as {kind?:string}|undefined)?.kind!=="research-dossier"||
        (result.bundle as {kind?:string}|undefined)?.kind!=="preproduction-bundle")
        throw Error("The local Director returned an invalid draft.");
      sessionStorage.setItem("contentgen:director-approved-script:v1:"+production.id,JSON.stringify({
        productionId:production.id,scriptRevision:videoScript.updatedAt,sourcePrefix:productionMediaSource(videoScript.updatedAt,refreshed),...result}));
      (stage==="visuals"?onOpenVisuals:stage==="audio"?onOpenAudio:stage==="draft"?onOpenDraft:onOpenExport)(undefined,production.id);
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not open video production. Check local server and retry.");}
    finally{setOpeningDirector(false);}
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
    if(!issue||!claimDraft){setError("Load the matching saved research snapshot before reviewing this claim.");return;}
    try{
      const receipt=createClaimReviewReceipt(issue,claimDraft);
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
    if(board){setError("A scene plan already exists. Use Update scenes to refresh it while keeping your edits.");return;}
    try{
      const next=scriptToStoryboard(script,currentIdea?.evidence??[]);
      saveProjectStoryboard(productionKey,next);
      saveClaimReviews(productionKey,{});
      setBoard(next);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"The script could not be mapped to a storyboard outline.");}
  }
  function refreshStoryboardOutline(){
    if(!board||!primaryScript)return;
    try{
      const next=syncScriptStoryboard(primaryScript,currentIdea?.evidence??[],board);
      // Existing hand-edited scenes are recoverable; refuse to overwrite if
      // the backup cannot be persisted.
      localStorage.setItem(storyboardBackupKey(productionKey),JSON.stringify(board));
      saveProjectStoryboard(productionKey,next);
      setHasStoryboardBackup(true);setBoard(next);setConfirmStoryboardRefresh(false);
      setClaimReviews({});setError("");setRepairSummary("");
    }catch(reason){setError(reason instanceof Error?reason.message:"Storyboard update failed; the existing outline is still saved.");}
  }
  function restorePreviousStoryboard(){
    try{
      const previous=JSON.parse(localStorage.getItem(storyboardBackupKey(productionKey))??"null") as SemanticStoryboard|null;
      if(!previous||validateStoryboard(previous).some(issue=>issue.severity==="error"))
        throw Error("The previous storyboard backup cannot be restored safely.");
      saveProjectStoryboard(productionKey,previous);
      saveClaimReviews(productionKey,{});
      setBoard(previous);setClaimReviews({});setError("");
      localStorage.removeItem(storyboardBackupKey(productionKey));
      setHasStoryboardBackup(false);
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not restore the previous storyboard.");}
  }
  const contentCard="rounded-surface border border-border bg-surface p-5 sm:p-6";
  const primaryButton="rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const secondaryButton="rounded-control border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  return <section id={workspaceId??undefined} aria-label={tr("Guided production","制作ガイド")}
    className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="z-10 flex shrink-0 items-center border-b border-border bg-surface-subtle px-3 py-1 lg:px-5">
      <button type="button" onClick={onOpenNav} aria-label={tr("Open navigation","メニューを開く")}
        className="shrink-0 rounded-control p-2 hover:bg-muted lg:hidden"><Menu className="size-5"/></button>
      <Stepper aria-label={tr("Production stages","制作ステップ")} className="min-w-0 flex-1"
        steps={stepperSteps} states={stepperStates} currentStepId={step} size="sm"
        showStateText arrowKeys connectors fillConnectors
        onStepSelect={selected=>selectStep(selected.id as ProductionStageId)}/>
    </div>
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8">
        <div className={"mx-auto flex flex-col gap-5 "+(step==="produce"&&currentDirectorEntry?"max-w-7xl":"max-w-5xl")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
               <h2 className="font-serif text-2xl font-semibold">{ja?stageLabels[step].ja:stageLabels[step].en}</h2>
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
                    disabled={Boolean(production)}
                    onClick={()=>{
                      const next=platforms.includes(choice.id)?platforms.filter(id=>id!==choice.id):[...platforms,choice.id];
                      if(next.length)updateFlow({...flow,platforms:next});
                    }} className={`rounded-full border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-65 ${platforms.includes(choice.id)?"border-primary bg-primary/10 text-foreground":"border-border bg-surface text-muted-foreground hover:bg-muted"}`}>
                    {platforms.includes(choice.id)?"✓ ":"+ "}{choice.label}
                  </button>)}
                </div>
                {production&&<p className="mt-2 text-xs text-muted-foreground" role="status">
                  Production destinations are frozen to keep script and export versions consistent. Choose another idea in Select Idea to create a new production with different destinations.
                </p>}
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
               onDiscoveryStateChange={(active,run,ideaCount)=>setSessionDiscovery({sessionId:active,run,ideaCount})}
               onIdeasReady={(active)=>{if(active===sessionId)selectStep("select");}}
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
            {(!currentIdea||!savedEvidence)&&!ideaError&&<p role="status" className="text-sm text-muted-foreground">Loading saved script sources…</p>}
            {ideaError&&<div role="alert" className={contentCard}><p>{ideaError}</p>
              <button type="button" className={secondaryButton+" mt-3"} onClick={()=>setIdeaRefresh(value=>value+1)}>Retry selected idea</button></div>}
            {savedEvidence?.error&&<div role="alert" className={contentCard}><p>{savedEvidence.error}</p>
              <button type="button" className={secondaryButton+" mt-3"} onClick={()=>setIdeaRefresh(value=>value+1)}>Retry saved evidence</button></div>}
            {currentIdea&&savedEvidence&&!currentIdea.evidence?.length&&<div className={contentCard+" space-y-3"}>
              <p className="text-sm">Collect factual source passages for this idea to start AI script writing. This searches and reads public websites using your local research service.</p>
              <button type="button" className={primaryButton} disabled={collectingEvidence} onClick={()=>void collectScriptEvidence()}>
                {collectingEvidence?"Collecting source passages…":"Collect sources and draft script"}</button>
              {collectingEvidence&&<button type="button" className={secondaryButton} onClick={()=>evidenceAbort.current?.abort()}>Cancel source collection</button>}
            </div>}
            {currentIdea&&savedEvidence&&(!savedEvidence.error||currentIdea.evidence?.length)&&<ScriptReviewWorkspace
            productionId={production.id} projectId={projectId} platforms={platforms} locale={locale}
            title={production.brief.title} viewerQuestion={production.brief.topic||production.brief.title}
            audience={project?.notes?.trim().slice(0,160)||(locale==="ja"?"日本語の学習者":"English-speaking learners")} angle={production.brief.angle??""}
            brandVoice={project?.notes??""} evidence={currentIdea?.evidence??[]}
            onStatusChange={setScriptActivity}
            onDraftChange={()=>refreshScriptState(value=>value+1)}
            onApprove={()=>{refreshScriptState(value=>value+1);
              const ready=allScriptsApproved();
              if(ready){
                const primary=loadScriptDraft(production.id,primaryPlatform).draft;
                if(!board&&primary)createStoryboardOutline(primary);
                selectStep("storyboard");
              }
            }}/>}
            {platforms.includes("youtube")&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-primary/25 bg-primary/5 p-4">
              <p className="text-sm text-muted-foreground">Your YouTube draft can be made independently of other scripts.</p>
              <button type="button" className={primaryButton+" inline-flex items-center gap-2"} disabled={openingDirector}
                onClick={()=>void openDirector("draft")}>{openingDirector?"Preparing scenes…":"Generate draft video"}<ArrowRight className="size-4"/></button>
            </div>}
          </div>:<div className={contentCard}>
            <p className="text-sm text-muted-foreground">{tr("Choose a discovery idea to let AI draft the script.","アイデアを選択するとAIが台本を作成します。")}</p>
            <button type="button" className={primaryButton+" mt-4"} onClick={()=>selectStep("select")}>{tr("Select an idea","テーマを選択")}</button>
          </div>)}
          {step==="storyboard"&&<>
            <div className="rounded-surface border border-primary/20 bg-primary/5 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-primary">Next · {board?"Check the scene plan":"Create the scene plan"}</p>
              <h3 className="mt-1 font-serif text-xl font-semibold">{board?"Make sure every scene teaches something new":"Turn your script into a visual outline"}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{board?
                "The cards below are scenes in viewing order. Review the headline and visual idea for each one. Click Edit only if something needs changing—your work is saved.":
                "ContentGen creates scenes from your script automatically. Review or edit anything before rendering."}</p>
              {board&&!boardScriptStale&&<button type="button" className={primaryButton+" mt-4 inline-flex items-center gap-2"}
                onClick={()=>selectStep("produce")}>Looks good · Create video <ArrowRight className="size-4" aria-hidden /></button>}
            </div>
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
              {boardScriptStale&&<div role="status" className="mt-4 rounded-control border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
                <p>Your script changed. Generate draft video will update the scene plan automatically and keep unaffected edits.</p>
                {primaryScript&&
                  (confirmStoryboardRefresh?<div className="mt-3 space-y-2">
                    <p>Update the outline now? Existing scene edits will be backed up and unchanged scenes preserved.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={primaryButton} onClick={refreshStoryboardOutline}>Save backup and update</button>
                      <button type="button" className={secondaryButton} onClick={()=>setConfirmStoryboardRefresh(false)}>Keep existing scenes</button>
                    </div>
                  </div>:<button type="button" className={secondaryButton+" mt-3"}
                    onClick={()=>setConfirmStoryboardRefresh(true)}>Update scenes now</button>)}
              </div>}
              {hasStoryboardBackup&&<button type="button" className={secondaryButton+" mt-3"}
                onClick={restorePreviousStoryboard}>Restore previous storyboard outline</button>}
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
            </div>:<div className={contentCard}>
              <h3 className="font-serif text-xl font-semibold">{tr("Create your storyboard","構成案を作成")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">Your completed script is enough to plan scenes.</p>
              {production&&primaryScript?.sections.every(section=>section.text.trim())&&<button type="button" className={primaryButton+" mt-4"}
                onClick={()=>createStoryboardOutline(primaryScript)}>Create scene outline</button>}
              {(!production||!primaryScript?.sections.every(section=>section.text.trim()))&&<button type="button" className={primaryButton+" mt-4"}
                onClick={()=>selectStep("script")}>{tr("Review script first","先に台本を確認")}</button>}
            </div>}
            {board&&<ProductionClaimIssues issues={issues} draft={claimDraft} locale={locale}
              reviewedClaims={reviewedClaims} onMarkReviewed={markClaimReviewed} onUndoReviewed={undoClaimReview}
              onOpenBeat={editScene} onFindEvidence={()=>selectStep("discover")}
              onRetryRepair={job?.status==="paused"&&job.stage==="evidence-repair"?()=>void retryEvidence():undefined}/>}
          </>}
          {step==="produce"&&!platforms.includes("youtube")&&<div className={contentCard+" space-y-4"}>
            <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-primary">Your next step</p>
            <h3 className="font-serif text-2xl font-semibold">Prepare your selected destinations</h3>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Video drafts use your YouTube script. Other destinations can be finished separately, including their titles, captions, covers and illustrated articles.</p>
            <button type="button" className={primaryButton+" inline-flex items-center gap-2"} onClick={()=>selectStep("optimize")}>Open Publish Kit <ArrowRight className="size-4" aria-hidden /></button>
          </div>}
          {step==="produce"&&platforms.includes("youtube")&&!currentDirectorEntry&&<div className={contentCard}>
            <span className="text-[11px] font-semibold uppercase tracking-[.14em] text-primary">Video draft</span>
            <h3 className="mt-2 font-serif text-2xl font-semibold">Turn your script into a video</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Choose a voice, then select <strong>Generate draft video</strong>. ContentGen prepares scenes, checks your local tools and makes a playable MP4. You can refine the scenes afterward.</p>
            {activeRender&&activeRender.productionId===production?.id&&activeRender.state!=="idle"&&
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-primary/25 bg-primary/5 p-4" role="status">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{activeRender.state==="rendering"?"Creating your video":
                    activeRender.state==="done"?"Draft video ready":activeRender.state==="failed"?"Video needs attention":
                    activeRender.state==="cancelled"?"Video cancelled":"Production status"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{activeRender.message??activeRender.phase}</p>
                  {activeRender.progress?.totalFrames&&activeRender.progress.completedFrames!==undefined&&
                    <progress aria-label="Video frames rendered" className="mt-2 h-2 w-full" max={activeRender.progress.totalFrames}
                      value={activeRender.progress.completedFrames}/>}
                </div>
                {onOpenJobs&&activeRender.jobId&&<button className={secondaryButton} type="button" onClick={onOpenJobs}>View in Jobs</button>}
              </div>}
            {mediaSnapshot&&mediaSnapshot.productionId===production?.id&&<div className="mt-4 rounded-control border border-border bg-surface-subtle p-3 text-sm" role="status">
              {mediaSnapshot.status==="loading"?"Checking saved local render files…":
                mediaSnapshot.status==="error"?`Unable to read saved renders: ${mediaSnapshot.error}`:
                renderAssets.some(asset=>asset.kind==="video")?
                  "A completed local MP4 was found. Review playback and rights before export; this is not a published release.":
                  "No completed render is registered for this production yet."}
              <button type="button" className="ml-3 text-primary underline" onClick={()=>setMediaRefresh(value=>value+1)}>
                Refresh files
              </button>
            </div>}
            {!canOpenDirector&&<p role="status" className="mt-4 text-sm text-muted-foreground">Finish the YouTube script to generate a playable draft. Other destinations can wait.</p>}
            <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-5">
              <button type="button" className={primaryButton+" inline-flex items-center gap-2"} disabled={openingDirector} onClick={()=>void openDirector("draft")}>{openingDirector?"Preparing scenes…":"Generate draft video"}<ArrowRight className="size-4" aria-hidden /></button>
              <p className="mt-3 text-xs text-muted-foreground">Your storyboard refreshes automatically. You can opt in to public free-media searches when generating the draft; stock suggestions are never downloaded without review. Voice setup is requested only when needed. Nothing is published.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={secondaryButton} disabled={openingDirector} onClick={()=>void openDirector("visuals")}>Edit video scenes</button>
              <button type="button" className={secondaryButton} disabled={openingDirector}
                onClick={()=>hasCurrentVideo?selectStep("export"):void openDirector("export")}>
                {hasCurrentVideo?"Watch & export MP4":"Open render controls"}
              </button>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <button type="button" className={secondaryButton} onClick={()=>onOpenStoryboard(productionKey)}>Adjust scene plan</button>
              <button type="button" className={primaryButton+" inline-flex items-center gap-2"} onClick={()=>selectStep("optimize")}>Prepare publishing assets <ArrowRight className="size-4" aria-hidden /></button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">YouTube video drafts are supported here. Shorts and social video presets are still in development. Their captions and covers are available in Publish Kit.</p>
          </div>}
          {currentDirectorEntry&&<div ref={directorRegion} tabIndex={-1}
            className={step==="produce"?"min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring":"hidden"}
            aria-hidden={step!=="produce"} inert={step!=="produce"}>
            <VideoDirectorWorkspace embedded locale={locale}
              projectId={currentDirectorEntry.projectId} voiceProjectId={projectId}
              researchArtifactId={currentDirectorEntry.artifactId}
              focusStage={currentDirectorEntry.stage} onOpenJobs={onOpenJobs}
              onUnsavedChange={onDirectorDirtyChange}/>
          </div>}
          {step==="optimize"&&(production?<>
            {mediaSnapshot?.status==="error"&&<div className="mb-4 flex flex-wrap items-center gap-3 rounded-control border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground" role="status">
              <span>Saved video files could not be checked. You can still edit covers and metadata; verify video attachments before publishing.</span>
              <button type="button" className="font-semibold text-primary underline" onClick={()=>setMediaRefresh(value=>value+1)}>Retry file lookup</button>
            </div>}
            <PlatformOptimization input={optimizationInput} onManifestChange={()=>refreshScriptState(value=>value+1)}/>
          </>:<div className={contentCard}>
            <p className="text-sm text-muted-foreground">{tr("Select an idea and create a production to prepare platform metadata.","制作するアイデアを選んでください。")}</p>
            <button type="button" className={primaryButton+" mt-4"} onClick={()=>selectStep("select")}>{tr("Select idea","テーマを選択")}</button>
          </div>)}
          {step==="export"&&<div className={contentCard}>
            <h3 className="font-serif text-xl font-semibold">{tr("Preview before exporting","書き出し前に確認")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {tr("Review playback, captions, source claims and rights. Download local renders and platform metadata here; no upload or publishing happens automatically.",
                "再生、字幕、根拠と利用権を確認します。映像ファイルや投稿情報をダウンロードできますが、自動公開は行われません。")}
            </p>
            {!canOpenDirector&&<p role="status" className="mt-3 text-sm text-muted-foreground">Finish the YouTube script to preview or export its draft. Approval is not required.</p>}
            <button type="button" className={primaryButton+" mt-5"} disabled={openingDirector||!canOpenDirector} onClick={()=>void openDirector("export")}>
              {tr("Open preview & export","確認と書き出しを開く")}</button>
            {mediaSnapshot&&mediaSnapshot.productionId===production?.id&&mediaSnapshot.status==="ready"&&
              <div className="mt-5 space-y-2 border-t border-border pt-4">
                <p className="text-sm font-semibold">Saved local render files</p>
                {currentRenderAssets.find(asset=>asset.kind==="video"&&asset.downloadUrl)&&
                  <video className="aspect-video w-full max-w-3xl rounded-xl bg-black" controls preload="metadata"
                    playsInline aria-label="Saved ContentGen video draft"
                    src={currentRenderAssets.find(asset=>asset.kind==="video"&&asset.downloadUrl)?.downloadUrl}/>}
                {renderAssets.length?renderAssets.map(asset=><a key={asset.id} href={asset.downloadUrl}
                  download={asset.filename} className={secondaryButton+" mr-2 inline-flex items-center gap-2"}>
                  {asset.kind==="video"?"Download MP4":asset.kind==="captions"?"Download captions":
                    asset.kind==="thumbnail"?(asset.filename?.startsWith("thumbnail-")?
                      `Download ${asset.filename.replaceAll("-"," ")}`:"Download cover frame"):`Download ${asset.kind}`}
                  {!currentRenderAssets.includes(asset)&&" · previous / untracked revision"}
                  <ExternalLink className="size-3"/></a>):<p className="text-sm text-muted-foreground">
                  No completed renders are registered. Open Create Video to render an MP4 before preparing an upload.</p>}
                {renderAssets.some(asset=>asset.filename?.startsWith("thumbnail-"))&&<p className="text-xs text-muted-foreground">
                  Three distinct 1280×720 thumbnail designs are exported automatically. Select one in Publish Kit to preview or download it, and edit the headline, composition and colors in the thumbnail designer.
                </p>}
              </div>}
            {production&&mediaSnapshot?.status!=="ready"&&<p className="mt-4 text-sm text-muted-foreground">
              The render catalog is loading or unavailable. Retry from Produce; previous metadata is preserved.</p>}
          </div>}
          {step==="export"&&production&&mediaSnapshot?.productionId===production.id&&mediaSnapshot.status==="ready"&&
            <PlatformOptimization input={optimizationInput} onManifestChange={()=>refreshScriptState(value=>value+1)}/>}
        </div>
    </main>
  </section>;
}


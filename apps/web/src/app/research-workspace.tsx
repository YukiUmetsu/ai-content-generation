import { useEffect, useRef, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { EvidencePanel } from "@/app/evidence-panel";
import { PackagingPanel } from "@/app/packaging-panel";
import { YoutubeIntelligencePanel } from "@/app/youtube-intelligence-panel";
import { RelatedYoutubePanel } from "@/app/related-youtube-panel";
import { translate } from "@/i18n/messages";
import type { Locale } from "@/features/registry";
import { createDraft, starterApproaches, validateEditorialDraft, type EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";

const LATEST_RESEARCH_KEY="contentgen:studio-research:latest:v1";
const LATEST_SEARCH_KEY="contentgen:studio-search:latest:v1";
const LATEST_JOB_KEY="contentgen:studio-research-job:latest:v1";
interface RecentResearch {topic:string;artifactId:string}
interface ResearchJobStatus {jobId:string;status:"queued"|"running"|"paused"|"failed"|"cancelled"|"completed";
  stage:string;currentStep?:string;completedScenes:number;totalScenes:number;artifactId?:string;
  error?:{code:string;message:string;detailCode?:string;field?:string};
  retry?:{stage:string;attempt:number;maxAttempts:number;reason:string;modelIndex:number;totalModels:number;detailCode?:string;field?:string}}
type ResearchJobResponse=Omit<ResearchJobStatus,"error">&{error?:string|{code:string;message:string}};
interface SearchLead {title:string;url:string;snippet:string}
interface SavedSearch {
  artifactId:string;schemaVersion:1;kind:"studio-search-snapshot";
  topic:string;query:string;audience:string;locale:"en-US"|"ja-JP";
  provider:"searxng";searchedAt:string;results:SearchLead[];
}
interface SavedSearchSummary {
  artifactId:string;topic:string;query:string;audience:string;locale:string;
  searchedAt:string;resultCount:number;
}
type ReadinessState = "not_configured" | "unavailable" | "unverified" | "model_missing" | "ready";
interface ServiceReadiness { state: ReadinessState; model?: string; detail?: string }
interface ResearchReadiness {
  version: 1;
  search: ServiceReadiness;
  researchModel: ServiceReadiness;
  storyModel: ServiceReadiness;
  ready: boolean;
}
const storyApproaches = [
  { id: "direct", en: "Answer the question", ja: "疑問に答える", detail: "Lead with the viewer's biggest question.", detailJa: "視聴者の一番の疑問から始めます。" },
  { id: "process", en: "Reveal the mechanism", ja: "仕組みを見せる", detail: "Show how it works, step by step.", detailJa: "仕組みを段階的に見せます。" },
  { id: "comparison", en: "Compare the options", ja: "選択肢を比べる", detail: "Make tradeoffs easy to see.", detailJa: "選択肢の違いを明確にします。" },
] as const;
function savedResearchFor(projectTopic:string):RecentResearch|null {
  if(!projectTopic.trim())return null;
  try{
    const stored:unknown=JSON.parse(localStorage.getItem(LATEST_RESEARCH_KEY)||"null");
    if(!stored||typeof stored!=="object"||!("topic" in stored)||!("artifactId" in stored))return null;
    if(stored.topic!==projectTopic.trim()||typeof stored.artifactId!=="string"||
      !/^research_[a-z0-9_-]{1,78}-[a-f0-9]{12}$/iu.test(stored.artifactId))return null;
    return {topic:stored.topic,artifactId:stored.artifactId};
  }catch{return null;}
}
function savedSearchFor(projectTopic:string):RecentResearch|null {
  if(!projectTopic.trim())return null;
  try{
    const stored:unknown=JSON.parse(localStorage.getItem(LATEST_SEARCH_KEY)||"null");
    if(!stored||typeof stored!=="object"||!("topic" in stored)||!("artifactId" in stored))return null;
    if(stored.topic!==projectTopic.trim()||typeof stored.artifactId!=="string"||
      !/^search_\d{8}T\d{9}Z-[a-f0-9]{12}$/u.test(stored.artifactId))return null;
    return {topic:stored.topic,artifactId:stored.artifactId};
  }catch{return null;}
}
function savedJobFor(projectTopic:string):{topic:string;jobId:string}|null{
  if(!projectTopic.trim())return null;
  try{
    const value:unknown=JSON.parse(localStorage.getItem(LATEST_JOB_KEY)||"null");
    if(!value||typeof value!=="object"||!("topic" in value)||!("jobId" in value)||
      value.topic!==projectTopic.trim()||typeof value.jobId!=="string"||
      !/^job_[a-f0-9]{24}$/u.test(value.jobId))return null;
    return {topic:projectTopic.trim(),jobId:value.jobId};
  }catch{return null;}
}

interface ResearchWorkspaceProps {
  locale: Locale;
  onUseVideo: (idea: {title: string; sourceUrl: string}) => boolean;
  onCreateStoryboard?: (draft: EditorialDraft, research?: ResearchDraftResult) => boolean;
  projectTopic?: string;
}

export function ResearchWorkspace({ locale, onUseVideo, onCreateStoryboard, projectTopic = "" }: ResearchWorkspaceProps) {
  const ja = locale === "ja";
  const tr = (en: string, jp: string) => ja ? jp : en;
  const [topic, setTopic] = useState(projectTopic);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [showInspiration, setShowInspiration] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [viewerQuestion, setViewerQuestion] = useState("");
  const [payoff, setPayoff] = useState("");
  const [approach, setApproach] = useState<EditorialDraft["selectedId"]>("direct");
  const [projectError, setProjectError] = useState("");
  const [recentResearch] = useState(()=>savedResearchFor(projectTopic));
  const [researchBusy, setResearchBusy] = useState(Boolean(recentResearch));
  const [restoring, setRestoring] = useState(Boolean(recentResearch));
  const [researchResult, setResearchResult] = useState<ResearchDraftResult | null>(null);
  const [researchError, setResearchError] = useState("");
  const [activeJobId,setActiveJobId]=useState<string|null>(()=>savedJobFor(projectTopic)?.jobId??null);
  const [researchJob,setResearchJob]=useState<ResearchJobStatus|null>(null);
  const [jobPollRevision,setJobPollRevision]=useState(0);
  const [recentSearch] = useState(()=>savedSearchFor(projectTopic));
  const [searchResult, setSearchResult] = useState<SavedSearch|null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedSearchSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [readiness, setReadiness] = useState<ResearchReadiness | null>(null);
  const [readinessError, setReadinessError] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(true);
  const [readinessAttempt, setReadinessAttempt] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setCheckingReadiness(true);
    setReadinessError(false);
    void fetch("/api/local-research-model/readiness", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error("Readiness check unavailable.");
        const result = await response.json() as ResearchReadiness;
        if (result.version !== 1 || !result.search || !result.researchModel || !result.storyModel)
          throw Error("Unexpected readiness response.");
        if (!controller.signal.aborted) setReadiness(result);
      })
      .catch(() => { if (!controller.signal.aborted) { setReadiness(null); setReadinessError(true); } })
      .finally(() => { if (!controller.signal.aborted) setCheckingReadiness(false); });
    return () => controller.abort();
  }, [readinessAttempt]);

  const blockedForReadiness = checkingReadiness || (readiness !== null && (
    (!searchResult && readiness.search.state !== "ready") ||
    [readiness.storyModel].some(service =>
      service.state === "not_configured" || service.state === "model_missing" || service.state === "unavailable")));
  const blockedForStory = checkingReadiness || (readiness !== null &&
    ["not_configured","model_missing","unavailable"].includes(readiness.storyModel.state));
  const blockedForSearch = checkingReadiness || (readiness !== null &&
    ["not_configured","unavailable"].includes(readiness.search.state));

  function readinessInstruction() {
    if (checkingReadiness) return tr("Checking SearXNG and local AI before you start.", "開始前に SearXNG とローカル AI を確認しています。");
    if (readinessError || !readiness) return tr("Couldn't verify local services. You can retry or continue with caution.", "ローカルサービスを確認できませんでした。再確認するか、注意して続行できます。");
    if (readiness.search.state !== "ready" && searchResult)
      return tr("SearXNG is unavailable, but this saved search can still be used to generate a storyboard with local AI.",
        "SearXNG は利用できませんが、保存済みの検索結果からローカル AI で構成案を作成できます。");
    if (readiness.search.state === "not_configured") return tr("Set up local search: pnpm --dir apps/web research:up, then pnpm --dir apps/web research:check.",
      "ローカル検索を設定してください：pnpm --dir apps/web research:up、続けて pnpm --dir apps/web research:check。");
    if (readiness.search.state !== "ready") return tr("SearXNG is not responding. Run pnpm --dir apps/web research:status, then research:check.",
      "SearXNG に接続できません。pnpm --dir apps/web research:status と research:check を実行してください。");
    if ([readiness.storyModel].some(service => service.state === "not_configured" || service.state === "model_missing"))
      return tr("Select an installed Story model in Settings → Local AI, then check again.",
        "設定 → ローカル AI で構成用モデルを選択し、再確認してください。");
    if (readiness.storyModel.state !== "ready")
      return tr("The story model is not responding; deterministic evidence capture can still be saved.",
        "構成用モデルが応答していませんが、出典情報は保存できます。");
    return tr("Local services respond. For a real JSON engine search, run pnpm --dir apps/web research:check.",
      "ローカルサービスは応答しています。実際の JSON 検索は pnpm --dir apps/web research:check で確認できます。");
  }

  function readinessLabel(service: ServiceReadiness) {
    switch (service.state) {
      case "ready": return tr("Connected", "接続済み");
      case "not_configured": return tr("Not configured", "未設定");
      case "unavailable": return tr("Not responding", "応答なし");
      case "model_missing": return tr("Model not found", "モデルがありません");
      default: return tr("Unverified", "未確認");
    }
  }

  useEffect(()=>{
    if(!recentResearch||recentResearch.topic!==projectTopic.trim())return;
    const controller=new AbortController();pending.current=controller;
    const current=++revision.current;
    let cancelled=false;
    void fetch("/api/contentgen-director/research-draft/"+recentResearch.artifactId,{signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error("The saved research snapshot is unavailable. Run research again.");
        return await response.json() as ResearchDraftResult;
      })
      .then(result=>{if(!cancelled&&current===revision.current&&result.dossier?.topic.title===projectTopic.trim())setResearchResult(result);})
      .catch(error=>{if(!cancelled&&current===revision.current)setResearchError(error instanceof Error?error.message:"Cannot restore research.");})
      .finally(()=>{if(!cancelled&&current===revision.current){pending.current=null;setRestoring(false);setResearchBusy(false);}});
    return ()=>{cancelled=true;controller.abort();};
  },[projectTopic,recentResearch]);

  useEffect(()=>{
    if(!recentSearch||recentSearch.topic!==projectTopic.trim())return;
    const controller=new AbortController(),current=revision.current;
    void fetch("/api/contentgen-director/research-search/"+recentSearch.artifactId,{signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error("Saved search is no longer available.");
        return await response.json() as SavedSearch;
      })
      .then(result=>{
        if(!controller.signal.aborted&&current===revision.current&&result.topic===projectTopic.trim())
          setSearchResult(result);
      })
      .catch(error=>{
        if(!controller.signal.aborted&&current===revision.current)
          setSearchError(error instanceof Error?error.message:"Could not restore saved search.");
      });
    return ()=>controller.abort();
  },[projectTopic,recentSearch]);

  useEffect(()=>{
    if(!activeJobId)return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const expectedTopic=topic.trim();
    async function refresh(){
      try{
        const response=await fetch("/api/contentgen-director/research-jobs/"+activeJobId,{signal:controller.signal});
        const state=await response.json() as ResearchJobResponse;
        if(!response.ok)throw Error(typeof state.error==="string"?state.error:"Could not restore research job.");
        if(controller.signal.aborted)return;
        setResearchJob({...state,error:typeof state.error==="object"?state.error:undefined});
        setResearchBusy(["queued","running"].includes(state.status));
        if(state.status==="completed"&&state.artifactId){
          const restored=await fetch("/api/contentgen-director/research-draft/"+state.artifactId,{signal:controller.signal});
          const draft=await restored.json() as ResearchDraftResult&{error?:string};
          if(!restored.ok)throw Error(draft.error||"Cannot open completed storyboard.");
          if(!controller.signal.aborted&&draft.dossier?.topic.title===expectedTopic){
            setResearchResult(draft);setResearchError("");
            try{localStorage.setItem(LATEST_RESEARCH_KEY,JSON.stringify({topic:expectedTopic,artifactId:state.artifactId}));}catch{/* Server artifact is durable. */}
          }
        }else if(state.status==="failed"||state.status==="paused"){
          setResearchError(state.error&&typeof state.error==="object"?
            `${state.error.message}${state.error.detailCode?` (${state.error.detailCode}${state.error.field?` · ${state.error.field}`:""})`:""}`:
            "Research job paused. Resume to continue.");
        }
        if(["queued","running"].includes(state.status))timer=setTimeout(()=>void refresh(),1500);
      }catch(error){
        if(!controller.signal.aborted){setResearchBusy(false);setResearchError(error instanceof Error?error.message:"Unable to read job status.");}
      }
    }
    void refresh();
    return ()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[activeJobId,topic,jobPollRevision]);

  function invalidateResearch() {
    pending.current?.abort();
    revision.current++;
    setResearchBusy(false);
    setRestoring(false);
    setResearchResult(null);
    setResearchJob(null);
    setActiveJobId(null);
    setResearchError("");
    setSearchBusy(false);
    setSearchResult(null);
    setSearchError("");
    setProjectError("");
  }

  function changeTopic(next: string) {
    invalidateResearch();
    setTopic(next);
    setSelectedUrls([]);
  }

  function cancelResearch() {
    if(activeJobId&&researchJob&&["queued","running"].includes(researchJob.status)){
      void fetch("/api/contentgen-director/research-jobs/"+activeJobId+"/cancel",{
        method:"POST",headers:{"Content-Type":"application/json","x-contentgen-director":"local-only"},body:"{}",
      }).then(async response=>{const status=await response.json() as ResearchJobStatus;
        if(!response.ok)throw Error("Could not cancel the job.");setResearchJob(status);setResearchBusy(false);
      }).catch(error=>setResearchError(error instanceof Error?error.message:"Cancel failed."));
      return;
    }
    pending.current?.abort();
    revision.current++;
    pending.current=null;
    setResearchBusy(false);
    setSearchBusy(false);
    setRestoring(false);
    setResearchError("");
  }

  function editorialDraft():EditorialDraft {
    const seed = createDraft(topic.trim());
    const input = {
      ...seed.input,
      audience: audience.trim() || seed.input.audience,
      viewerQuestion: viewerQuestion.trim() || seed.input.viewerQuestion,
      payoff: payoff.trim() || seed.input.payoff,
      inspirationUrls: selectedUrls,
    };
    return validateEditorialDraft({...seed,input,approaches:starterApproaches(input),selectedId:approach});
  }

  function searchMatches(search:SavedSearch,draft:EditorialDraft){
    return search.topic===draft.input.topic&&search.query===draft.input.viewerQuestion&&
      search.audience===draft.input.audience&&search.locale===(locale==="ja"?"ja-JP":"en-US");
  }

  async function searchAndSave(draft:EditorialDraft,controller:AbortController,current:number):Promise<SavedSearch>{
    const response=await fetch("/api/contentgen-director/research-search",{
      method:"POST",signal:controller.signal,
      headers:{"Content-Type":"application/json","x-contentgen-director":"local-only"},
      body:JSON.stringify({title:draft.input.topic,viewerQuestion:draft.input.viewerQuestion,
        audience:draft.input.audience,locale:locale==="ja"?"ja-JP":"en-US"}),
    });
    const payload=await response.json() as SavedSearch&{error?:string};
    if(!response.ok)throw Error(payload.error||`Search failed (HTTP ${response.status}).`);
    if(!payload.artifactId||!Array.isArray(payload.results)||!payload.results.length||
      !searchMatches(payload,draft))throw Error("Saved search response did not match the current brief.");
    if(current===revision.current){
      setSearchResult(payload);
      try{localStorage.setItem(LATEST_SEARCH_KEY,JSON.stringify({topic:draft.input.topic,artifactId:payload.artifactId}));}
      catch{/* The saved server artifact remains available in Saved searches. */}
    }
    return payload;
  }

  async function searchOnly(){
    if(searchBusy||researchBusy||blockedForSearch||topic.trim().length<3||topic.trim().length>160)return;
    const current=++revision.current,controller=new AbortController();
    pending.current=controller;
    setSearchBusy(true);setSearchError("");setResearchError("");setResearchResult(null);
    try{await searchAndSave(editorialDraft(),controller,current);}
    catch(error){if(current===revision.current)setSearchError(error instanceof Error?error.message:"Search failed.");}
    finally{if(current===revision.current){setSearchBusy(false);pending.current=null;}}
  }

  async function loadSavedSearch(artifactId:string){
    if(searchBusy||researchBusy)return;
    invalidateResearch();
    const current=revision.current,controller=new AbortController();
    pending.current=controller;setSearchBusy(true);
    try{
      const response=await fetch("/api/contentgen-director/research-search/"+artifactId,{signal:controller.signal});
      const item=await response.json() as SavedSearch&{error?:string};
      if(!response.ok)throw Error(item.error||"Cannot load saved search.");
      if(current===revision.current){
        setTopic(item.topic);setViewerQuestion(item.query);setAudience(item.audience);
        setSearchResult(item);
        try{localStorage.setItem(LATEST_SEARCH_KEY,JSON.stringify({topic:item.topic,artifactId:item.artifactId}));}catch{/* Optional browser pointer. */}
      }
    }catch(error){if(current===revision.current)setSearchError(error instanceof Error?error.message:"Could not load search.");}
    finally{if(current===revision.current){setSearchBusy(false);pending.current=null;}}
  }

  async function loadSavedSearchHistory(){
    if(historyBusy)return;
    setHistoryBusy(true);
    try{
      const response=await fetch("/api/contentgen-director/research-search");
      if(!response.ok)throw Error("Could not list saved searches.");
      const body=await response.json() as {items:SavedSearchSummary[]};
      setSavedSearches(Array.isArray(body.items)?body.items:[]);
    }catch(error){setSearchError(error instanceof Error?error.message:"Could not list saved searches.");}
    finally{setHistoryBusy(false);}
  }

  async function researchAndGenerate(){
    if(researchBusy||searchBusy||blockedForReadiness||topic.trim().length<3||topic.trim().length>160)return;
    setResearchBusy(true);setResearchError("");setResearchResult(null);
    const current=++revision.current;
    const controller=new AbortController();pending.current=controller;
    try{
      const editorial=editorialDraft();
      let saved=searchResult;
      if(!saved||!searchMatches(saved,editorial)){
        setSearchBusy(true);
        saved=await searchAndSave(editorial,controller,current);
        if(current===revision.current)setSearchBusy(false);
      }
      if(current!==revision.current||controller.signal.aborted)return;
      const response=await fetch("/api/contentgen-director/research-jobs",{
        method:"POST",signal:controller.signal,
        headers:{"Content-Type":"application/json","x-contentgen-director":"local-only"},
        body:JSON.stringify({title:editorial.input.topic,viewerQuestion:editorial.input.viewerQuestion,
          audience:editorial.input.audience,locale:locale==="ja"?"ja-JP":"en-US",
          searchArtifactId:saved.artifactId}),
      });
      const payload=await response.json() as ResearchJobResponse;
      if(!response.ok)throw Error(typeof payload.error==="string"?payload.error:`Research job failed (HTTP ${response.status}).`);
      if(!/^job_[a-f0-9]{24}$/u.test(payload.jobId))throw Error("Research job did not return a valid ID.");
      if(current===revision.current){
        setResearchJob({...payload,error:typeof payload.error==="object"?payload.error:undefined});setActiveJobId(payload.jobId);
        try{localStorage.setItem(LATEST_JOB_KEY,JSON.stringify({topic:editorial.input.topic,jobId:payload.jobId}));}
        catch{/* The server continues the job independently. */}
      }
    }catch(error){
      if(current===revision.current){setResearchError(error instanceof Error?error.message:"Research failed.");setResearchBusy(false);}
    }finally{
       if(current===revision.current){setSearchBusy(false);pending.current=null;}
    }
  }

  async function resumeResearchJob(retryScene=false){
    if(!activeJobId)return;
    const scene=researchJob?.stage.match(/^scene:(\d+)$/u);
    const evidenceReview=researchJob?.status==="paused"&&researchJob.stage==="evidence-repair";
    const url=retryScene&&scene?`/api/contentgen-director/research-jobs/${activeJobId}/scenes/${Number(scene[1])-1}/retry`:
      evidenceReview?`/api/contentgen-director/research-jobs/${activeJobId}/repair`:
      `/api/contentgen-director/research-jobs/${activeJobId}/resume`;
    setResearchError("");setResearchBusy(true);
    try{
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-contentgen-director":"local-only"},body:"{}"});
      const result=await response.json() as ResearchJobResponse;
      if(!response.ok)throw Error(typeof result.error==="string"?result.error:"Could not resume job.");
      setResearchJob({...result,error:typeof result.error==="object"?result.error:undefined});
      setJobPollRevision(value=>value+1);
    }catch(error){setResearchBusy(false);setResearchError(error instanceof Error?error.message:"Cannot resume job.");}
  }

  function createFromResearch() {
    if (!onCreateStoryboard) return;
    setProjectError("");
    try {
      const draft=editorialDraft();
      if (!onCreateStoryboard(draft)) setProjectError(tr("Couldn't save the new storyboard project.", "ストーリーボードを保存できませんでした。"));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create project.");
    }
  }

  function createSourcedStoryboard(){
    if(!researchResult||!onCreateStoryboard||researchBusy||researchResult.dossier.topic.title!==topic.trim())return;
    setProjectError("");
    try{
      if(!onCreateStoryboard(editorialDraft(),researchResult))
        setProjectError(tr("Couldn't save the researched storyboard.","調査済みストーリーボードを保存できませんでした。"));
    }catch(error){setProjectError(error instanceof Error?error.message:"Could not save the researched storyboard.");}
  }

  return (
    <section
      id="workspace"
      aria-label={tr("Research workspace", "リサーチワークスペース")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        defaultActiveIndex={0}
        label={tr("Research sections", "リサーチのセクション")}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4"
      >
        <Tabs.List className="mt-3 shrink-0" aria-label={tr("Research sections", "リサーチのセクション")}>
          <Tabs.Tab value={0} className="h-11">
            {tr("Research", "リサーチ")}
          </Tabs.Tab>
          <Tabs.Tab value={1} className="h-11">
            {tr("Evidence Library", "根拠ライブラリ")}
          </Tabs.Tab>
          <Tabs.Tab value={2} className="h-11">
            {translate(locale, "navPackaging")}
          </Tabs.Tab>
          <Tabs.Tab value={3} className="h-11">
            {locale === "ja" ? "YouTube 市場" : "YouTube Intelligence"}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={0} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
            <header className="rounded-surface border border-border bg-surface-subtle px-5 py-6 sm:px-8 sm:py-8">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {tr("STUDIO / RESEARCH", "スタジオ / リサーチ")}
              </p>
              <h2 className="mt-3 max-w-3xl font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {tr("Start with a question worth answering.", "答える価値のある問いから始めましょう。")}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {tr("Capture public sources, review what they actually support, and turn the research into an editable visual story.",
                  "公開情報を集め、出典が裏付ける内容を確認し、編集できる映像ストーリーにまとめます。")}
              </p>
              <div className="mt-6 rounded-surface border border-border bg-surface p-4 sm:p-5" aria-label={tr("Local research readiness", "ローカル調査の準備状況")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{tr("Local research readiness", "ローカル調査の準備状況")}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{tr("Checked on page open · no search or AI generation triggered", "ページ表示時に確認・検索と AI 生成は実行しません")}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={checkingReadiness} onClick={()=>setReadinessAttempt(attempt=>attempt+1)}>
                    {tr("Check again", "再確認")}
                  </Button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {([
                    {label:tr("SearXNG search", "SearXNG 検索"),value:readiness?.search},
                    {label:tr("Research AI", "調査 AI"),value:readiness?.researchModel},
                    {label:tr("Story AI", "構成 AI"),value:readiness?.storyModel},
                  ] as const).map(item=><div key={item.label} className="flex items-center justify-between gap-3 rounded-control bg-surface-subtle px-3 py-2.5 sm:flex-col sm:items-start sm:gap-1">
                    <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                    <span className={`text-sm font-semibold ${checkingReadiness?"text-muted-foreground":item.value?.state==="ready"?"text-foreground":"text-status-warning"}`}>
                      {checkingReadiness?tr("Checking…", "確認中…"):item.value?readinessLabel(item.value):tr("Unknown", "不明")}
                    </span>
                  </div>)}
                </div>
                <p role="status" className={`mt-3 text-xs leading-5 ${blockedForReadiness||readinessError?"text-status-warning":"text-muted-foreground"}`}>{readinessInstruction()}</p>
              </div>
              <label htmlFor="research-topic" className="mt-6 block text-sm font-semibold text-foreground">
                {tr("Research topic", "リサーチするトピック")}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input id="research-topic" value={topic} maxLength={160} onChange={e=>changeTopic(e.target.value)}
                  placeholder={tr("e.g. Why heat pumps cost more upfront", "例：ヒートポンプの初期費用が高い理由")}
                  className="min-w-0 flex-1 rounded-control border border-input bg-surface px-4 py-3 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
                {!topic.trim() && <Button size="md" variant="outline" onClick={()=>changeTopic("heat pump vs gas furnace costs")}>
                  {tr("Try an example", "例を入力")}
                </Button>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {tr("Searches are saved locally. Search leads are separate from captured, verified Evidence Library passages.",
                  "検索結果はローカルに保存されます。検索候補は、取得・検証された根拠ライブラリの文章とは別です。")}
              </p>
            </header>
            <Surface variant="solid" className="gap-0 [&>div]:!p-0">
              <div className="border-b border-border px-5 py-6 sm:px-8 sm:py-7">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {tr("01 / STORY BRIEF", "01 / 構成の概要")}
                </p>
                <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">{tr("Choose how the story unfolds", "伝え方を選ぶ")}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{tr(
                  "Pick an explanation style. We'll collect sources and build a storyboard you can review before creating a video.",
                  "解説のスタイルを選択してください。出典を集め、動画制作前に確認できるストーリーボードを作成します。")}</p>
              </div>
              <div className="px-5 py-6 sm:px-8 sm:py-7">
                <fieldset>
                  <legend className="mb-3 text-sm font-semibold text-foreground">{tr("Story direction", "ストーリーの方向性")}</legend>
                  <div className="grid gap-3 md:grid-cols-3">
                    {storyApproaches.map((choice,index)=><label key={choice.id} className="relative cursor-pointer">
                      <input type="radio" name="story-approach" value={choice.id} checked={approach===choice.id}
                        onChange={()=>{invalidateResearch();setApproach(choice.id);}}
                        className="peer sr-only" />
                      <span className="flex h-full flex-col rounded-surface border border-border bg-surface-subtle px-4 py-4 transition-colors hover:border-primary/50 peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                        <span className="text-xs font-semibold tracking-wide text-muted-foreground">0{index+1}</span>
                        <span className="mt-3 text-sm font-semibold text-foreground">{tr(choice.en,choice.ja)}</span>
                        <span className="mt-1 text-xs leading-5 text-muted-foreground">{tr(choice.detail,choice.detailJa)}</span>
                      </span>
                    </label>)}
                  </div>
                </fieldset>
                <details className="mt-5 rounded-control border border-border bg-surface">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {tr("Fine-tune your brief", "構成の詳細を調整する")}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">{tr("Optional", "任意")}</span>
                  </summary>
                  <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm">{tr("Audience (optional)", "対象視聴者（任意）")}
                      <input value={audience} maxLength={120} onChange={e=>{invalidateResearch();setAudience(e.target.value);}}
                        placeholder={tr("e.g. Homeowners comparing heating quotes", "例：暖房の見積りを比べる住宅所有者")}
                        className="min-w-0 rounded-control border border-input bg-surface px-3 py-2.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>
                    </label>
                    <label className="grid gap-1.5 text-sm">{tr("Question to answer (optional)", "答える疑問（任意）")}
                      <input value={viewerQuestion} maxLength={200} onChange={e=>{invalidateResearch();setViewerQuestion(e.target.value);}}
                        className="min-w-0 rounded-control border border-input bg-surface px-3 py-2.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>
                    </label>
                    <label className="grid gap-1.5 text-sm sm:col-span-2">{tr("What viewers will learn (optional)", "視聴者が学ぶこと（任意）")}
                      <input value={payoff} maxLength={320} onChange={e=>{invalidateResearch();setPayoff(e.target.value);}}
                        className="min-w-0 rounded-control border border-input bg-surface px-3 py-2.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>
                    </label>
                  </div>
                </details>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-subtle px-5 py-5 sm:px-8">
                <Button size="lg" variant="outline" onClick={()=>void searchOnly()}
                  disabled={searchBusy||researchBusy||blockedForSearch||topic.trim().length<3||topic.trim().length>160}>
                  {searchBusy?tr("Searching…","検索中…"):tr("Search & save sources","出典候補を検索・保存")}
                </Button>
                <Button size="lg" onClick={()=>void researchAndGenerate()} disabled={!onCreateStoryboard||searchBusy||researchBusy||blockedForReadiness||topic.trim().length<3||topic.trim().length>160}>
                  {researchBusy?tr("Researching…","調査中…"):researchError?tr("Retry storyboard generation","構成案を再生成"):
                    searchResult?tr("Generate storyboard from saved sources","保存済みの出典候補から構成案を生成"):
                      tr("Research & generate storyboard","調査して構成案を生成")}
                </Button>
                {activeJobId&&researchJob&&["failed","paused","cancelled"].includes(researchJob.status)&&
                  <Button size="lg" variant="outline" onClick={()=>void resumeResearchJob()} disabled={researchBusy||blockedForStory}>
                    {researchJob.stage==="evidence-repair"&&researchJob.status==="paused"?
                      tr("Refresh sources and retry evidence","出典を再取得して根拠を再確認"):
                      tr("Resume saved job","保存済みジョブを再開")}
                  </Button>}
                {activeJobId&&researchJob?.status==="failed"&&/^scene:\d+$/u.test(researchJob.stage)&&
                  <Button size="md" variant="outline" onClick={()=>void resumeResearchJob(true)} disabled={researchBusy||blockedForStory}>
                    {tr("Regenerate failed scene only","失敗したシーンのみ再生成")}
                  </Button>}
                {(researchBusy||searchBusy)&&<Button variant="outline" onClick={cancelResearch}>{tr("Cancel","中止")}</Button>}
                <Button variant="subtle" onClick={createFromResearch} disabled={!onCreateStoryboard||researchBusy||searchBusy||topic.trim().length<3||topic.trim().length>160}>
                  {tr("Create unresearched outline","未調査の構成案を作成")}
                </Button>
                {selectedUrls.length>0&&<span className="text-xs text-muted-foreground">{tr(`${selectedUrls.length} inspiration links`, `参考リンク ${selectedUrls.length} 件`)}</span>}
              </div>
              <div className="px-5 pb-6 pt-4 sm:px-8">
              {researchBusy&&<p role="status" className="text-sm text-muted-foreground">{restoring?tr("Restoring saved research…","保存済みの調査を読み込み中…"):searchBusy?tr("Searching SearXNG and saving sources…","SearXNG を検索して出典候補を保存中…"):tr("Using saved search results to capture public pages and draft teaching shots. No media is rendered yet.","保存済みの検索結果から公開ページを取得し、解説ショットを生成しています。映像はまだ生成されません。")}</p>}
              {researchJob&&<div role="status" className="mt-3 rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm">
                <p className="font-semibold text-foreground">{tr("Research production job","調査・構成作成ジョブ")} · {researchJob.status}</p>
                <p className="mt-1 text-muted-foreground">{researchJob.stage}{researchJob.currentStep&&` · ${researchJob.currentStep}`} · {researchJob.totalScenes?`${researchJob.completedScenes}/${researchJob.totalScenes} ${tr("teaching units saved","解説単位を保存")}`:tr("Preparing evidence and outline","出典と構成案を準備中")}</p>
                {researchJob.retry&&<p className="mt-2 text-sm text-status-warning">{tr("Local model retry","ローカルモデルの再試行")} {researchJob.retry.attempt}/{researchJob.retry.maxAttempts} · {researchJob.retry.detailCode??(researchJob.retry.reason==="invalid_output"?tr("Invalid structured response","構造化された応答が無効です"):researchJob.retry.reason==="model_timeout"?tr("Model timed out","モデルがタイムアウトしました"):tr("Provider temporarily unavailable","モデルに一時的に接続できません"))} {researchJob.retry.field&&`· ${researchJob.retry.field}`} {researchJob.retry.totalModels>1&&`· ${tr("Model","モデル")} ${researchJob.retry.modelIndex}/${researchJob.retry.totalModels}`}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{tr("Progress survives page refreshes. Completed stages are reused on retry.","ページを更新しても進行状況は保存されます。再試行時は完了済みの工程を再利用します。")}</p>
              </div>}
              {searchBusy&&!researchBusy&&<p role="status" className="text-sm text-muted-foreground">{tr("Searching SearXNG and saving sources locally…","SearXNG を検索して出典候補をローカルに保存中…")}</p>}
              {searchError&&<p role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{searchError}</p>}
              {researchError&&<p role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{researchError}</p>}
              <details className="mt-3 rounded-control border border-border bg-surface"
                onToggle={event=>{if(event.currentTarget.open)void loadSavedSearchHistory();}}>
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">{tr("Saved searches","保存済みの検索")}</summary>
                <div className="border-t border-border p-3">
                  {historyBusy?<p className="text-xs text-muted-foreground">{tr("Loading saved searches…","保存済みの検索を読み込み中…")}</p>:
                    savedSearches.length?(
                      <ul className="grid gap-2">{savedSearches.map(item=><li key={item.artifactId}>
                        <Button variant="subtle" size="sm" disabled={searchBusy||researchBusy} onClick={()=>void loadSavedSearch(item.artifactId)}>
                          {item.topic} · {tr(`${item.resultCount} sources`,`${item.resultCount} 件`)}
                        </Button>
                        <span className="ms-2 text-xs text-muted-foreground">{new Date(item.searchedAt).toLocaleString(locale==="ja"?"ja-JP":"en-US")}</span>
                      </li>)}</ul>
                    ):<p className="text-xs text-muted-foreground">{tr("No saved searches found yet.","保存済みの検索はまだありません。")}</p>}
                </div>
              </details>
              {searchResult&&searchResult.topic===topic.trim()&&<section aria-label={tr("Saved source search results","保存済みの検索結果")}
                className="mt-4 rounded-surface border border-border bg-surface-subtle p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-foreground">{tr("Saved search results","保存済みの検索結果")}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">{tr(`${searchResult.results.length} sources · ${searchResult.query}`,`${searchResult.results.length} 件・${searchResult.query}`)}</p>
                  </div>
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-foreground">{tr("Saved locally","ローカルに保存済み")}</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-status-warning">{tr(
                  "Search leads are not verified evidence. Open and review each source before trusting claims or numbers.",
                  "検索候補は検証済みの根拠ではありません。主張や数値を信頼する前に各出典を確認してください。")}</p>
                <ol className="mt-3 grid gap-2">
                  {searchResult.results.map((result,i)=><li key={result.url} className="rounded-control border border-border bg-surface px-3 py-3">
                    <div className="flex items-start gap-3">
                      <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{String(i+1).padStart(2,"0")}</span>
                      <div className="min-w-0 flex-1">
                        <a href={result.url} target="_blank" rel="noopener noreferrer"
                          className="break-words text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                          {result.title} ↗
                        </a>
                        <p className="mt-0.5 break-all text-xs text-muted-foreground">{new URL(result.url).hostname}</p>
                        {result.snippet&&<p className="mt-2 text-sm leading-6 text-foreground">{result.snippet}</p>}
                      </div>
                    </div>
                  </li>)}
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">{tr(`SearXNG · searched ${new Date(searchResult.searchedAt).toLocaleString("en-US")}`,
                  `SearXNG・検索日時 ${new Date(searchResult.searchedAt).toLocaleString("ja-JP")}`)}</p>
              </section>}
              {researchResult&&researchResult.dossier.topic.title===topic.trim()&&<div className="grid gap-4 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold">{tr("Research-backed draft to review","根拠付き下書きを確認")}</h4>
                    <p className="text-sm text-muted-foreground">{tr(`${researchResult.dossier.claims.length} candidate claims · ${researchResult.dossier.evidence.length} captured sources · ${researchResult.plan.shots.length} planned shots`,
                      `主張 ${researchResult.dossier.claims.length} 件・出典 ${researchResult.dossier.evidence.length} 件・ショット ${researchResult.plan.shots.length} 件`)}</p>
                  </div>
                  <Button onClick={createSourcedStoryboard} disabled={!onCreateStoryboard}>
                    {tr("Create editable sourced storyboard →","根拠付きストーリーボードを作成 →")}
                  </Button>
                </div>
                <p className="text-sm text-status-warning">{tr("Quotes are copied from captured pages, but facts have not been independently verified. Review disputed numbers and assumptions before final production.",
                  "引用は取得したページからの原文ですが、事実確認は未完了です。最終生成前に数字と前提を確認してください。")}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {researchResult.dossier.claims.map(claim=><div key={claim.id} className="rounded-surface border border-border bg-surface-subtle p-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr("Candidate claim · Needs review","確認待ちの主張")}</span>
                    <p className="mt-2 font-medium">{claim.text}</p>
                    {researchResult.quotes.filter(q=>q.claimId===claim.id).map((quote,i)=>{
                      const source=researchResult.dossier.evidence.find(s=>s.id===quote.sourceId);
                      return <div key={`${quote.sourceId}-${i}`} className="mt-3 border-s-2 border-primary/40 ps-3">
                        <p className="text-sm text-muted-foreground">“{quote.quote}”</p>
                        {source&&<a href={source.sourceUri} target="_blank" rel="noopener noreferrer" className="mt-1 block break-words text-sm text-primary underline-offset-2 hover:underline">
                          {source.title} · {new Date(source.retrievedAt).toLocaleDateString(locale==="ja"?"ja-JP":"en-US")}
                        </a>}
                      </div>;
                    })}
                  </div>)}
                </div>
                {researchResult.dossier.gaps.length>0&&<div className="rounded-surface border border-warning/30 bg-warning/5 p-4">
                  <h5 className="font-semibold">{tr("What still needs checking","追加調査が必要な点")}</h5>
                  <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">{researchResult.dossier.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>
                </div>}
                <div>
                  <h5 className="font-semibold">{tr("Planned visual explanation","映像でどう説明するか")}</h5>
                  <p className="mt-1 text-sm text-muted-foreground">{researchResult.plan.story.hook}</p>
                  <ol className="mt-3 grid gap-2 md:grid-cols-2">{researchResult.plan.shots.map((shot,i)=><li key={shot.id} className="rounded-control border border-border p-3">
                    <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{i+1}.</span><strong>{shot.onScreenText}</strong></div>
                    <p className="mt-1 text-sm text-foreground">{shot.visualChange}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{researchResult.plan.sound.find(s=>s.shotId===shot.id)?.narration}</p>
                  </li>)}</ol>
                </div>
              </div>}
              {projectError && <p role="alert" className="text-sm text-danger">{projectError}</p>}
              <p className="text-xs text-muted-foreground">{tr("No video/audio is rendered yet. Independent factual research and approval are still required before publishing.",
                "映像・音声の生成はまだ行いません。公開前に独立した事実確認と承認が必要です。")}</p>
              </div>
            </Surface>
            <details className="rounded-surface border border-border bg-surface" onToggle={event=>setShowInspiration(event.currentTarget.open)}>
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
                {tr("YouTube inspiration (optional)", "YouTube の参考動画（任意）")}
                <span className="ms-2 text-xs font-normal text-muted-foreground">{tr("Find related videos without treating them as verified facts", "関連動画を探す（事実の証拠には含めません）")}</span>
              </summary>
              <div className="border-t border-border px-4 py-4">
                {showInspiration && <RelatedYoutubePanel locale={locale} topic={topic} selectedUrls={selectedUrls} onSelectUrls={setSelectedUrls}/>}
              </div>
            </details>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value={1} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto w-full max-w-5xl pb-8">
            <EvidencePanel locale={locale} query={evidenceQuery} onQueryChange={setEvidenceQuery} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value={2} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <PackagingPanel locale={locale} />
        </Tabs.Panel>

        <Tabs.Panel value={3} className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <YoutubeIntelligencePanel locale={locale} onUseVideo={onUseVideo} onCreateStoryboard={onCreateStoryboard}/>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}


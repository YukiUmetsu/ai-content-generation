import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ArrowRight, Download, Film, Headphones, Images, Layers3, RefreshCw, WandSparkles, Save, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import { ProductionPanel } from "./video-production-panel";
import { AssetDiscoveryPanel } from "./asset-discovery-panel";
import { SfxDiscoveryPanel } from "./sfx-discovery-panel";
import { loadProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { NewVideoSetup } from "./new-video-setup";
import { isSceneMotion, normalizedSceneMotion, type SceneMotion } from "../../scripts/video-production/scene-motion.mjs";
import { isVisualElements, type VisualElement } from "../../scripts/video-production/visual-elements.mjs";
import { transferableDirectorEdits } from "./director-edit-transfer";
import { directorStages, nextDirectorStage, resolveDirectorNavigation,
  shouldInvalidateDirectorReadiness } from "../../scripts/video-production/director-workflow.mjs";
import type { LiveVisualPreviewData } from "./live-renderer-preview";

const RendererScene=lazy(()=>import("./live-renderer-scene"));

type Shot={id:string;family:string;visualChange:string;onScreenText:string;purpose:string;sceneRecipe?:string;visualElements?:VisualElement[];motion?:SceneMotion};
type Sound={shotId:string;narration:string;sfxIntent:string|null;pauseAfterMs:number};
type Phase={shotId:string;visualAction:string;kind:string};
type Plan={shots:Shot[];sound:Sound[];teachingSequences:Array<{phases:Phase[]}>;story:{question:string}};
type Bundle={kind:string;researchId:string;plan:Plan;planSha256?:string;researchSha256?:string};
type Dossier={kind:string;id:string;topic:{title:string;audience:string}};
type Variant={id:string;strategy:string;audienceSignal:string;curiosityQuestion:string;
  narration:string;firstVisual:string;onScreenText:string;payoffConnection:string;sfxIntent:string|null};
type Impact={changedFields:string[];speechRegenerate:string[];visualRerender:string[];
  sfxRemix:string[];downstreamRetiming:string[];timelineRecalculate:boolean;externalActionsPerformed:string[]};
type Revision={kind:string;bundle:Bundle;impacts:Impact;reviewRequired:boolean};
type DirectorSnapshot={bundle:Bundle;revisions:Array<{shotId:string;impacts:Impact}>};
type DirectorStage="storyboard"|"assets"|"sound"|"preview";
const stageIcons={storyboard:Layers3,assets:Images,sound:Headphones,preview:Film};
type StoryboardSync={storyboardSha256:string;applied:string[];manualReview:string[]};
type SceneClipStatus={state:"idle"|"starting"|"rendering"|"done"|"failed"|"cancelled";
  shotId?:string|null;message:string;videoUrl?:string|null;jobId?:string|null;sourceRevision?:string};
const field="w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const header="text-xs font-semibold uppercase tracking-wide text-muted-foreground";
async function request(path:string,data:unknown){
  const response=await fetch("/api/contentgen-director/"+path,{method:"POST",headers:{
    "Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    body:JSON.stringify(data),signal:AbortSignal.timeout(path==="variants"?200000:15000)});
  const json=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(json.error??"Local director API unavailable."));
  return json;
}
async function previewScene(dossier:Dossier,bundle:Bundle):Promise<LiveVisualPreviewData>{
  const response=await fetch("/api/contentgen-video/live-preview",{method:"POST",headers:{
    "Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    body:JSON.stringify({dossier,bundle}),signal:AbortSignal.timeout(15000)});
  const data=await response.json() as LiveVisualPreviewData & {error?:string};
  if(!response.ok)throw Error(data.error??"Local scene renderer is unavailable.");
  return data;
}
async function sceneClipRequest(path:string,payload?:unknown):Promise<Record<string,unknown>>{
  const response=await fetch("/api/contentgen-video/scene-clip/"+path,{
    method:payload===undefined?"GET":"POST",cache:"no-store",
    headers:payload===undefined?undefined:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(16000)});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(typeof data.error==="string"?data.error:"The local scene video renderer is unavailable.");
  return data;
}
async function loadJson(file:File,maxBytes=900000){
  if(file.size>maxBytes)throw Error("File is too large for the editorial workspace (900 KB limit).");
  return JSON.parse(await file.text()) as Record<string,unknown>;
}
function downloadJson(name:string,data:unknown){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=name;
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const directorSessionKey=(projectId:string,artifactId:string,storyboardSha256:string|null=null)=>
  storyboardSha256?"contentgen:director-session:v2:"+projectId+":"+artifactId+":"+storyboardSha256:
    "contentgen:director-session:v1:"+projectId+":"+artifactId;
const safeSceneMotion=(value:unknown):SceneMotion=>normalizedSceneMotion(isSceneMotion(value)?value:undefined);
function readDirectorSession(projectId:string|undefined,artifactId:string,source:Bundle,
  storyboardSha256:string|null=null):
  {dossier:Dossier;bundle:Bundle;sourceBundle:Bundle}|null {
  if(!projectId||typeof window==="undefined"||!source.researchSha256)return null;
  try{
    const key=directorSessionKey(projectId,artifactId,storyboardSha256);
    // Migrate existing tab-scoped edits without breaking older saved sessions.
    // Local storage retains the same source-bound draft after the tab closes.
    let raw:string|null=null;
    try{raw=sessionStorage.getItem(key);}catch{/* Try persistent storage. */}
    if(!raw)try{raw=localStorage.getItem(key);}catch{/* Storage can be disabled. */}
    if(!raw||raw.length>900000)return null;
    const data=JSON.parse(raw) as {version?:number;artifactId?:string;dossier?:Dossier;bundle?:Bundle;sourceBundle?:Bundle};
    if(![1,2].includes(data.version??0)||data.artifactId!==artifactId||data.dossier?.kind!=="research-dossier"||
      data.dossier.id!==source.researchId||data.bundle?.kind!=="preproduction-bundle"||
      data.bundle.researchId!==source.researchId||data.bundle.researchSha256!==source.researchSha256||
      !Array.isArray(data.bundle.plan?.shots)||!data.bundle.plan.shots.length||
      !Array.isArray(data.bundle.plan?.sound)||!Array.isArray(data.bundle.plan?.teachingSequences)||
      !/^[a-f0-9]{64}$/u.test(data.bundle.planSha256??""))return null;
    if(data.version===2&&(data.sourceBundle?.kind!=="preproduction-bundle"||
      data.sourceBundle.planSha256!==source.planSha256||
      data.sourceBundle.researchSha256!==source.researchSha256))return null;
    return {dossier:data.dossier,bundle:data.bundle,sourceBundle:data.sourceBundle??source};
  }catch{return null;}
}
/** Find only same-research, provenance-bearing edits from previous generated
 * scripts. Older sessions lacked an original baseline, so cannot be safely
 * applied to a different script without guessing which values were authored. */
function findTransferableDirectorSession(projectId:string,sourceId:string,source:Bundle):
  {sourceBundle:Bundle;bundle:Bundle}|null{
  if(typeof window==="undefined"||!source.researchSha256)return null;
  const prefix="contentgen:director-session:v1:"+projectId+":approved-script:";
  let newest:{savedAt:number;sourceBundle:Bundle;bundle:Bundle}|null=null;
  try{
    const count=Math.min(localStorage.length,1000);
    for(let i=0;i<count;i++){
      const key=localStorage.key(i);
      if(!key?.startsWith(prefix)||key===directorSessionKey(projectId,sourceId))continue;
      const raw=localStorage.getItem(key);
      if(!raw||raw.length>900000)continue;
      let data:{version?:number;savedAt?:number;artifactId?:string;sourceBundle?:Bundle;bundle?:Bundle};
      try{data=JSON.parse(raw);}catch{continue;}
      if(data.version!==2||!data.artifactId||key!==directorSessionKey(projectId,data.artifactId)||
        !data.artifactId.startsWith("approved-script:")||
        !Number.isSafeInteger(data.savedAt)||typeof data.savedAt!=="number"||data.savedAt<0||
        data.sourceBundle?.kind!=="preproduction-bundle"||data.bundle?.kind!=="preproduction-bundle"||
        data.sourceBundle.researchId!==source.researchId||
        data.sourceBundle.researchSha256!==source.researchSha256||
        data.bundle.researchSha256!==source.researchSha256||
        !/^[a-f0-9]{64}$/u.test(data.sourceBundle.planSha256??""))continue;
      if(!newest||data.savedAt>newest.savedAt)newest={savedAt:data.savedAt,
        sourceBundle:data.sourceBundle,bundle:data.bundle};
    }
  }catch{return null;}
  return newest?{sourceBundle:newest.sourceBundle,bundle:newest.bundle}:null;
}
function shotDraft(bundle:Bundle,id:string){
  const shot=bundle.plan.shots.find(x=>x.id===id);
  const audio=bundle.plan.sound.find(x=>x.shotId===id);
  const phase=bundle.plan.teachingSequences?.flatMap(x=>x.phases).find(x=>x.shotId===id);
  return {narration:audio?.narration??"",onScreenText:shot?.onScreenText??"",family:shot?.family??"process",
    visualChange:shot?.visualChange??"",visualAction:phase?.visualAction??shot?.visualChange??"",
    sfxIntent:audio?.sfxIntent??"",pauseAfterMs:audio?.pauseAfterMs??160,
    visualElementsText:shot?.visualElements?.map(item=>item.label+" | "+item.detail).join("\n")??"",
    motion:safeSceneMotion(shot?.motion)};
}
type DirectorWorkspaceProps={locale:Locale;projectId?:string;voiceProjectId?:string;researchArtifactId?:string|null;focusStage?:"visuals"|"audio"|"draft"|"export";onOpenJobs?:()=>void};
export function VideoDirectorWorkspace(props:DirectorWorkspaceProps){
  return <VideoDirectorWorkspaceContent key={`${props.voiceProjectId??""}:${props.projectId??""}:${props.researchArtifactId??""}`} {...props}/>;
}
function VideoDirectorWorkspaceContent({locale,projectId,voiceProjectId,researchArtifactId,focusStage,onOpenJobs}:DirectorWorkspaceProps){
  const ja=locale==="ja";
  const [dossier,setDossier]=useState<Dossier|null>(null);
  const [bundle,setBundle]=useState<Bundle|null>(null);
  const [sourceBundle,setSourceBundle]=useState<Bundle|null>(null);
  const [shotId,setShotId]=useState("");
  const [draft,setDraft]=useState({narration:"",onScreenText:"",family:"process",visualChange:"",visualAction:"",sfxIntent:"",pauseAfterMs:160,visualElementsText:"",motion:normalizedSceneMotion()});
  const [variants,setVariants]=useState<Variant[]>([]);
  const [voiceVariant,setVoiceVariant]=useState("");
  const [visualVariant,setVisualVariant]=useState("");
  const [soundVariant,setSoundVariant]=useState("");
  const [revisions,setRevisions]=useState<Array<{shotId:string;impacts:Impact}>>([]);
  const [history,setHistory]=useState<{undo:DirectorSnapshot[];redo:DirectorSnapshot[]}>({undo:[],redo:[]});
  const [quickPreview,setQuickPreview]=useState<LiveVisualPreviewData|null>(null);
  const [quickPreviewError,setQuickPreviewError]=useState("");
  const [sceneClip,setSceneClip]=useState<SceneClipStatus>({state:"idle",message:""});
  const [previewPercent,setPreviewPercent]=useState(35);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [sampleMode,setSampleMode]=useState(false);
  const [stage,setStage]=useState<DirectorStage>("storyboard");
  const [draftLaunchCount,setDraftLaunchCount]=useState(0);
  const [recheckToken,setRecheckToken]=useState(0);
  const [loadingSaved,setLoadingSaved]=useState(Boolean(researchArtifactId||projectId?.startsWith("production-")));
  const [loadError,setLoadError]=useState("");
  const [sourceArtifactId,setSourceArtifactId]=useState<string|null>(null);
  const [sourceStoryboardSha,setSourceStoryboardSha]=useState<string|null>(null);
  const [syncReport,setSyncReport]=useState<StoryboardSync|null>(null);
  useEffect(()=>{
    if(sceneClip.state!=="rendering")return;
    let active=true,pending=false;
    const poll=async()=>{
      if(pending)return;
      pending=true;
      try{
        const data=await sceneClipRequest("status");
        if(active&&["rendering","done","failed","cancelled"].includes(String(data.state)))
          setSceneClip(current=>({state:data.state as SceneClipStatus["state"],
            shotId:typeof data.shotId==="string"?data.shotId:null,
            message:typeof data.message==="string"?data.message:"Checking scene preview…",
            videoUrl:typeof data.videoUrl==="string"?data.videoUrl:null,
            jobId:typeof data.jobId==="string"?data.jobId:null,sourceRevision:current.sourceRevision}));
      }catch{if(active)setSceneClip(current=>({...current,
        message:"Scene preview connection interrupted. Checking again; completed frames remain saved."}));}
      finally{pending=false;}
    };
    const timer=setInterval(()=>{void poll();},1200);
    void poll();
    return ()=>{active=false;clearInterval(timer);};
  },[sceneClip.state]);
  const shot=bundle?.plan.shots.find(x=>x.id===shotId);
  const audio=bundle?.plan.sound.find(x=>x.shotId===shotId);
  const phase=bundle?.plan.teachingSequences?.flatMap(x=>x.phases).find(x=>x.shotId===shotId);
  async function renderSceneClip(){
    if(!dossier||!bundle||!shotId||dirty)return;
    const sourceRevision=quickPreview?.sourcePlanSha256;
    setSceneClip({state:"starting",shotId,sourceRevision,
      message:"Requesting a preview of the selected scene…"});
    try{
      await sceneClipRequest("start",{dossier,bundle,shotId,projectId:projectId??dossier.id});
      setSceneClip({state:"rendering",shotId,sourceRevision,
        message:"Preparing this scene's silent MP4 preview…"});
    }catch(error){setSceneClip({state:"failed",shotId,message:error instanceof Error?error.message:"Could not start scene preview."});}
  }
  async function cancelSceneClip(){
    try{await sceneClipRequest("cancel",{confirmed:true});}
    catch(error){setSceneClip(current=>({...current,message:error instanceof Error?error.message:"Could not cancel scene preview."}));}
  }
  const acceptProject=useCallback((d:Dossier,b:Bundle,source:"sample"|"topic"="topic",artifactId:string|null=null,storyboardSha:string|null=null,originalBundle:Bundle=b)=>{
    setDossier(d);setBundle(b);setRevisions([]);setHistory({undo:[],redo:[]});setSampleMode(source==="sample");setSourceArtifactId(artifactId);
    setSourceBundle(originalBundle);
    setSourceStoryboardSha(storyboardSha);setSyncReport(null);
    // "Edit video scenes" must open the editable shot controls. Voice and
    // export deep links open rendering controls; the preview stays one click
    // away without forcing an unnecessary render during editing.
    setStage(source==="sample"||(focusStage&&focusStage!=="visuals")?"preview":"storyboard");
    setRecheckToken(0);
    const first=b.plan.shots[0]?.id??"";
    setShotId(first);setDraft(shotDraft(b,first));
    setVariants([]);setVoiceVariant("");setVisualVariant("");setSoundVariant("");
    setStatus("Storyboard ready. Review and edit individual shots, then preview the renderable scenes below.");
  },[focusStage]);
  useEffect(()=>{
    if(!researchArtifactId)return;
    let active=true;
    // Re-read on entry so source-bound edits made since Production was last shown are included.
    const loaded=projectId?loadProjectStoryboard(projectId):null;
    const board=loaded?.board?.assumptions.includes("Research artifact: "+researchArtifactId)
      ?loaded.board:null;
    const warning=loaded?.warning
      ?loaded.warning+" The original research plan will open without storyboard edits."
      :loaded?.board&&!board
        ?"The saved storyboard references a different research artifact. Director will use the selected research plan without its edits."
        :"";
    const payload={artifactId:researchArtifactId,
      ...(board&&projectId?{projectId,storyboard:board}:{})};
    void request("compile-saved-research",payload).then(result=>{
      if(!active)return;
      if(warning)setLoadError(warning);
      const saved=result as {artifactId?:string;dossier?:Dossier;bundle?:Bundle;synchronization?:StoryboardSync|null};
      if(saved.artifactId!==researchArtifactId || saved.dossier?.kind!=="research-dossier" ||
        saved.bundle?.kind!=="preproduction-bundle" || !saved.dossier.id ||
        saved.bundle.researchId!==saved.dossier.id || !saved.bundle.plan?.shots?.length ||
        (board&&(!saved.synchronization||
          !/^[a-f0-9]{64}$/u.test(saved.synchronization.storyboardSha256))))
        throw Error("The returned project did not match the selected storyboard and research artifact.");
      const sync=saved.synchronization??null;
      const revision=sync?.storyboardSha256??null;
      const resumed=readDirectorSession(projectId,researchArtifactId,saved.bundle,revision);
      acceptProject(resumed?.dossier??saved.dossier,resumed?.bundle??saved.bundle,
        "topic",researchArtifactId,revision,resumed?.sourceBundle??saved.bundle);
      setSyncReport(sync);
      setStatus((resumed?"Resumed applied edits from this storyboard version. ":
        sync?"Opened the saved storyboard with compatible changes applied. ":"Opened the original research plan. ")+
        "Claims, unsynchronized semantic details, and media rights still need review.");
    }).catch(error=>{if(active){
      const message=error instanceof Error?error.message:"Saved research could not be opened.";
      setStatus(message);setLoadError(message);
    }})
      .finally(()=>{if(active)setLoadingSaved(false);});
    return ()=>{active=false;};
  },[researchArtifactId,projectId,acceptProject]);
  useEffect(()=>{
    if(researchArtifactId||!projectId?.startsWith("production-"))return;
    let active=true;
    // A browser-session handoff is external state. Load it after render and
    // cancel a pending handoff if the selected project changes.
    queueMicrotask(()=>{if(!active)return;
      void (async()=>{
      const raw=sessionStorage.getItem("contentgen:director-approved-script:v1:"+projectId);
      if(!raw)return;
      if(raw.length>900000)throw Error("Script handoff exceeds the Director browser-session limit.");
      const handoff=JSON.parse(raw) as {productionId?:string;scriptRevision?:string;sourcePrefix?:string;dossier?:Dossier;bundle?:Bundle};
      if(handoff.productionId!==projectId||typeof handoff.scriptRevision!=="string"||
        handoff.dossier?.kind!=="research-dossier"||handoff.bundle?.kind!=="preproduction-bundle"||
        !handoff.dossier.id||handoff.bundle.researchId!==handoff.dossier.id||
        !handoff.bundle.researchSha256||!/^[a-f0-9]{64}$/u.test(handoff.bundle.planSha256??"")||
        !handoff.bundle.plan?.shots?.length)
        throw Error("The video draft could not be loaded. Return to Production and select Generate draft video again.");
      // Two storyboard edits can share one script revision. Scope resumes to
      // the exact compiled visual plan so old edits never mask new visuals.
      const sourceId=(handoff.sourcePrefix??"approved-script:"+handoff.scriptRevision+":")+handoff.bundle.planSha256;
      const resumed=readDirectorSession(projectId,sourceId,handoff.bundle);
      if(resumed){
        if(!active)return;
        acceptProject(resumed.dossier,resumed.bundle,"topic",sourceId,null,resumed.sourceBundle);
        setStatus("Restored your saved scene edits. Review facts and rights before publication.");
        return;
      }
      const previous=findTransferableDirectorSession(projectId,sourceId,handoff.bundle);
      const transfer=previous?transferableDirectorEdits(previous.sourceBundle,previous.bundle,handoff.bundle):
        {patches:[],skipped:0};
      let next=handoff.bundle;
      const transferred:Array<{shotId:string;impacts:Impact}>=[];
      try{
        for(const patch of transfer.patches){
          const result=await request("edit",{dossier:handoff.dossier,bundle:next,
            shotId:patch.shotId,changes:patch.changes}) as unknown as Revision;
          if(result.bundle?.researchId!==handoff.dossier.id||
            !Array.isArray(result.bundle.plan?.shots)||
            !result.bundle.plan.shots.some(shot=>shot.id===patch.shotId))
            throw Error("The scene revision returned a different project.");
          next=result.bundle;
          transferred.push({shotId:patch.shotId,impacts:result.impacts});
        }
      }catch{
        // No partial restoration. Keep the previous draft saved separately;
        // never overwrite the newly generated script with an unverified edit.
        next=handoff.bundle;
        transferred.length=0;
        transfer.skipped+=transfer.patches.length;
      }
      if(!active)return;
      acceptProject(handoff.dossier,next,"topic",sourceId,null,handoff.bundle);
      if(transferred.length)setRevisions(transferred);
      setStatus(transferred.length?
        `Carried ${transferred.length} compatible scene edit(s) into this script. ${transfer.skipped?`${transfer.skipped} changed field(s) were left in the older version. `:""}Review the scene changes before export.`:
        transfer.skipped?"This script changed since the last edit. Previous edits remain saved in the earlier script, without overriding the new content.":
        "Video scenes are ready. Preview them or adjust individual shots while your draft is being made.");
      })().catch(reason=>{if(active)setLoadError(reason instanceof Error?reason.message:"Cannot open this script in Director.");})
        .finally(()=>{if(active)setLoadingSaved(false);});
    });
    return ()=>{active=false;};
  },[researchArtifactId,projectId,acceptProject]);
  useEffect(()=>{
    if(!projectId||!sourceArtifactId||!sourceBundle||!dossier||!bundle||
      typeof window==="undefined")return;
    let warningTimer:ReturnType<typeof setTimeout>|undefined;
    try{
      // Only applied shot edits are saved here. Never store provider keys or voice permissions.
      const data=JSON.stringify({version:2,savedAt:Date.now(),artifactId:sourceArtifactId,
        dossier,sourceBundle,bundle});
      if(data.length>900000)throw Error("Saved director draft exceeds the browser session limit.");
      const key=directorSessionKey(projectId,sourceArtifactId,sourceStoryboardSha);
      let persistent=false;
      try{localStorage.setItem(key,data);persistent=true;}catch{/* Try tab storage. */}
      try{sessionStorage.setItem(key,data);}catch{/* Persistent storage may still have succeeded. */}
      if(!persistent)throw Error("Persistent browser storage is unavailable.");
    }catch{
      // Storage failure is reported after the effect finishes, avoiding a cascading render.
      warningTimer=setTimeout(()=>setStatus("Scene edits could not be saved across browser restarts. Download Save project JSON before leaving Video Director."),0);
    }
    return ()=>{if(warningTimer!==undefined)clearTimeout(warningTimer);};
  },[projectId,sourceArtifactId,sourceStoryboardSha,dossier,sourceBundle,bundle]);
  useEffect(()=>{
    if(!bundle||!dossier||stage!=="storyboard")return;
    let active=true;
    void previewScene(dossier,bundle).then(value=>{
      if(!active)return;
      const preview=value as unknown as LiveVisualPreviewData;
      if(preview.kind!=="live-renderer-preview/v1"||!Array.isArray(preview.shotMap))
        throw Error("The saved scene cannot be previewed by Kumiki.");
      setQuickPreview(preview);setQuickPreviewError("");
    }).catch(error=>{if(active){setQuickPreview(null);
      setQuickPreviewError(error instanceof Error?error.message:"Scene preview unavailable.");}});
    return()=>{active=false;};
  },[dossier,bundle,stage]);
  async function importProject(file:File|undefined){
    if(!file)return;
    try{
      const input=await loadJson(file) as unknown as {dossier:Dossier;bundle:Bundle};
      if(input.dossier?.kind!=="research-dossier"||input.bundle?.kind!=="preproduction-bundle"||
        input.dossier.id!==input.bundle.researchId)
        throw Error("Expected a matching ContentGen saved project.");
      if(!Array.isArray(input.bundle.plan?.shots)||input.bundle.plan.shots.length===0)
        throw Error("Saved project has no editable shots.");
      acceptProject(input.dossier,input.bundle);
    }catch(error){setStatus(error instanceof Error?error.message:"Project import failed.");}
  }
  async function importDossier(file:File|undefined){
    setSampleMode(false);
    setStage("storyboard");
    if(!file)return;
    try{const x=await loadJson(file) as unknown as Dossier;
      if(x.kind!=="research-dossier"||!x.id||!x.topic)throw Error("Expected a research-dossier/v1 JSON file.");
      setDossier(x);setStatus("Research dossier loaded. No source was modified.");
    }catch(e){setStatus(e instanceof Error?e.message:"Dossier import failed.");}
  }
  async function importBundle(file:File|undefined){
    setSampleMode(false);
    setStage("storyboard");
    if(!file)return;
    try{const x=await loadJson(file) as unknown as Bundle;
      if(x.kind!=="preproduction-bundle"||!x.plan?.shots?.length)
        throw Error("Expected a preproduction-bundle/v1 JSON file.");
      setBundle(x);setRevisions([]);setHistory({undo:[],redo:[]});setShotId(x.plan.shots[0].id);
      setDraft(shotDraft(x,x.plan.shots[0].id));
      setVariants([]);setVoiceVariant("");setVisualVariant("");setSoundVariant("");
      setStatus("Preproduction bundle loaded. Select a shot to revise.");
    }catch(e){setStatus(e instanceof Error?e.message:"Bundle import failed.");}
  }
  function chooseShot(id:string,focusEditor=false){
    if(!bundle)return;
    if(id!==shotId&&dirty){
      setStage("storyboard");
      setStatus("Save or discard your scene edits before choosing another scene. Your changes are still here.");
      return;
    }
    setShotId(id);setDraft(shotDraft(bundle,id));setPreviewPercent(35);
    setVariants([]);setVoiceVariant("");setVisualVariant("");setSoundVariant("");setStatus("");
    if(focusEditor){
      setStage("storyboard");
      if(typeof requestAnimationFrame==="function")
        requestAnimationFrame(()=>document.querySelector<HTMLSelectElement>('select[aria-label="Selected video shot"]')?.focus());
    }
  }
  function parseElementsInput(value:string):VisualElement[]{
    const lines=value.trim().split("\n").map(s=>s.trim()).filter(Boolean);
    const parsed=lines.map(line=>{
      const sections=line.split("|");
      if(sections.length!==2)throw Error("Each visual element must be one line: Label | what the viewer learns.");
      return {label:sections[0].trim(),detail:sections[1].trim()};
    });
    if(!isVisualElements(parsed))throw Error("Add 2–5 unique, specific visual elements with short explanations (not labels like 'House' or 'Categories').");
    return parsed;
  }
  function changes(){
    if(!shot||!audio)return {};
    const result:Record<string,string|null|VisualElement[]|number|SceneMotion>={};
    if(draft.narration!==audio.narration)result.narration=draft.narration;
    if(draft.family!==(shot.family??"process"))result.family=draft.family;
    if(draft.onScreenText!==shot.onScreenText)result.onScreenText=draft.onScreenText;
    if(draft.visualChange!==shot.visualChange)result.visualChange=draft.visualChange;
    if(draft.visualAction!==(phase?.visualAction??shot.visualChange))result.visualAction=draft.visualAction;
    if(draft.sfxIntent!==(audio.sfxIntent??""))result.sfxIntent=draft.sfxIntent||null;
    if(draft.pauseAfterMs!==(audio.pauseAfterMs??160))result.pauseAfterMs=draft.pauseAfterMs;
    if(JSON.stringify(draft.motion)!==JSON.stringify(safeSceneMotion(shot.motion)))result.motion=draft.motion;
    const savedText=shot.visualElements?.map(item=>item.label+" | "+item.detail).join("\n")??"";
    if(draft.visualElementsText.trim()!==savedText.trim())
      result.visualElements=parseElementsInput(draft.visualElementsText);
    return result;
  }
  async function apply(changed:Record<string,string|null|VisualElement[]|number|SceneMotion>){
    if(!bundle||!dossier||!shot)return false;
    setBusy(true);setStatus("");
    try{
      const result=await request("edit",{bundle,dossier,shotId:shot.id,changes:changed}) as unknown as Revision;
      setHistory(prev=>({undo:[...prev.undo,{bundle,revisions}].slice(-20),redo:[]}));
      setBundle(result.bundle);
      setDraft(shotDraft(result.bundle,shot.id));
      setRevisions(prev=>[...prev,{shotId:shot.id,impacts:result.impacts}]);
      setStatus("Draft revised. Unchanged shots remain intact. Review before any regeneration or publishing.");
      return true;
    }catch(e){setStatus(e instanceof Error?e.message:"Revision rejected.");return false;}
    finally{setBusy(false);}
  }
  async function applyShotMotion(id:string,motion:SceneMotion):Promise<Bundle>{
    if(!bundle||!dossier)throw Error("Open a matching project before editing motion.");
    setBusy(true);setStatus("");
    try{
      const result=await request("edit",{bundle,dossier,shotId:id,changes:{motion}}) as unknown as Revision;
      setHistory(prev=>({undo:[...prev.undo,{bundle,revisions}].slice(-20),redo:[]}));
      setBundle(result.bundle);
      // The full preview and scene workbench edit the same motion field.
      // Keep both controls aligned so returning to the scene never looks dirty.
      if(id===shotId)setDraft(shotDraft(result.bundle,id));
      setRevisions(prev=>[...prev,{shotId:id,impacts:result.impacts}]);
      setStatus("Scene motion saved. Only its visual segment needs rebuilding; narration remains reusable.");
      return result.bundle;
    }catch(e){setStatus(e instanceof Error?e.message:"Motion revision rejected.");throw e;}
    finally{setBusy(false);}
  }
  async function generate(){
    if(!bundle||!dossier||!shot)return;
    setBusy(true);setStatus("");
    try{
      const result=await request("variants",{bundle,dossier,shotId:shot.id}) as unknown as {variants:Variant[]};
      setVariants(result.variants);setVoiceVariant(result.variants[0].id);
      setVisualVariant(result.variants[0].id);setSoundVariant(result.variants[0].id);
      setStatus("Three unreviewed creative hypotheses generated. Mix script, visual and sound treatments before applying.");
    }catch(e){setStatus(e instanceof Error?e.message:"Local generation failed.");}
    finally{setBusy(false);}
  }
  function combine(){
    const spoken=variants.find(x=>x.id===voiceVariant),picture=variants.find(x=>x.id===visualVariant);
    const sound=variants.find(x=>x.id===soundVariant);
    if(!spoken||!picture||!sound)return;
    void apply({narration:spoken.narration,visualChange:picture.firstVisual,
      visualAction:picture.firstVisual,onScreenText:picture.onScreenText,sfxIntent:sound.sfxIntent});
  }
  const visualTextSaved=shot?.visualElements?.map(item=>item.label+" | "+item.detail).join("\n")??"";
  const dirty=!!shot&&!!audio&&(
    draft.narration!==audio.narration||draft.onScreenText!==shot.onScreenText||
    draft.family!==(shot.family??"process")||
    draft.visualChange!==shot.visualChange||draft.visualAction!==(phase?.visualAction??shot.visualChange)||
    draft.sfxIntent!==(audio.sfxIntent??"")||draft.pauseAfterMs!==(audio.pauseAfterMs??160)||
    JSON.stringify(draft.motion)!==JSON.stringify(safeSceneMotion(shot.motion))||
    draft.visualElementsText.trim()!==visualTextSaved.trim());
  function navigate(target:DirectorStage,justSaved=false){
    const result=resolveDirectorNavigation({current:stage,target,unsaved:dirty&&!justSaved});
    if(result.blocked){setStatus(result.message);return;}
    if(shouldInvalidateDirectorReadiness(stage,target))setRecheckToken(value=>value+1);
    setStage(result.stage as DirectorStage);setStatus("");
  }
  function launchDraft(justSaved=false){
    setDraftLaunchCount(count=>count+1);
    navigate("preview",justSaved);
  }
  function generateUpdatedDraft(){if(!busy&&!dirty)launchDraft();}
  async function saveAndGenerateDraft(){
    if(busy||!dirty)return;
    let edits;
    try{edits=changes();}
    catch(error){setStatus(error instanceof Error?error.message:"Review the scene edit before rendering.");return;}
    if(await apply(edits))launchDraft(true);
  }
  function discardEdits(){
    if(bundle)setDraft(shotDraft(bundle,shotId));
    setStatus("Unsaved scene edits discarded. The saved storyboard is unchanged.");
  }
  function travelHistory(direction:"undo"|"redo"){
    if(!bundle||busy||dirty)return;
    const stack=history[direction];
    if(!stack.length)return;
    const previous=stack.at(-1)!;
    const opposite=direction==="undo"?"redo":"undo";
    setHistory(current=>({...current,[direction]:current[direction].slice(0,-1),
      [opposite]:[...current[opposite],{bundle,revisions}].slice(-20)}));
    setBundle(previous.bundle);setRevisions(previous.revisions);
    setDraft(shotDraft(previous.bundle,shotId));setRecheckToken(value=>value+1);
    setStatus(direction==="undo"?"Last saved scene change undone.":"Saved scene change restored.");
  }
  const nextStage=nextDirectorStage(stage) as DirectorStage|null;
  const usable=!!dossier&&!!bundle&&dossier.id===bundle.researchId&&!!shot;
  const mergedImpact={
    speech:new Set(revisions.flatMap(x=>x.impacts.speechRegenerate)),
    visuals:new Set(revisions.flatMap(x=>x.impacts.visualRerender)),
    sfx:new Set(revisions.flatMap(x=>x.impacts.sfxRemix)),
    shifted:new Set(revisions.flatMap(x=>x.impacts.downstreamRetiming)),
  };
  return <main id="workspace" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6" aria-label="Video director">
    <div className="mx-auto flex max-w-7xl flex-col gap-5 pb-12">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-surface bg-primary/10 text-primary">
          <Film className="size-6"/>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">ContentGen Studio</p>
          <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight">Video Director</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Build a video from its story to its final draft. Each step saves to the same project; review your work before rendering.
          </p>
        </div>
      </div>
      {loadError&&<p role="alert" className="rounded-control border border-status-warning/40 bg-surface-subtle p-3 text-sm">{loadError} Review the storyboard or open a saved project manually; no source was overwritten.</p>}
      {!usable&&loadingSaved&&<p role="status" className="rounded-control border border-border bg-surface p-4 text-sm">Opening your saved scenes and compatible edits…</p>}
      {!usable&&!loadingSaved&&<NewVideoSetup onGenerated={(d,b,source)=>acceptProject(d as Dossier,b as Bundle,source)}/>}
      {usable&&syncReport&&<div role="status" className="rounded-surface border border-primary/30 bg-surface-subtle p-4 text-sm">
        <p className="font-semibold">Saved storyboard → Director</p>
        <p className="mt-1">{syncReport.applied.length} narration, screen-text, or visual-action change(s) applied to a new draft bundle. Immutable research remains unchanged.</p>
        {syncReport.manualReview.length>0&&<ul className="mt-2 list-disc space-y-1 pl-5 text-status-warning">
          {syncReport.manualReview.map((warning,i)=><li key={i}>{warning}</li>)}</ul>}
        <p className="mt-2 text-xs text-muted-foreground">Other storyboard-only timing, camera, and semantic design fields need manual comparison. This is not publishing approval.</p>
      </div>}
      {usable&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-surface-subtle p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{sampleMode?"Interactive sample loaded":"Video project loaded"}</p>
          <p className="mt-1 text-base font-semibold">{dossier.topic.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{bundle.plan.shots.length} scenes · {sampleMode?"Synthetic demo · explore without voice setup":"Editable video draft"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Download className="size-4"/>} disabled={dirty||busy}
            onClick={()=>downloadJson("contentgen-project.json",{dossier,bundle})}>Save project</Button>
          <Button variant="outline" disabled={dirty||busy} onClick={()=>{
               if(projectId&&sourceArtifactId){
                 try{sessionStorage.removeItem(directorSessionKey(projectId,sourceArtifactId,sourceStoryboardSha));
                   if(sourceArtifactId.startsWith("approved-script:"))
                     sessionStorage.removeItem("contentgen:director-approved-script:v1:"+projectId);
                 }catch{/* In-memory reset still works. */}
               }
               setDossier(null);setBundle(null);setShotId("");setStage("storyboard");setSampleMode(false);setSourceArtifactId(null);setSourceStoryboardSha(null);setSyncReport(null);setLoadError("");setStatus("");
             }}>
            Start another project
          </Button>
        </div>
      </div>}
      {!usable&&!loadingSaved&&<Surface header={<h2 className="font-medium">Or open an existing project</h2>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className={header}>Open saved project (.json)
            <input type="file" className={field+" mt-2"} accept=".json" aria-label="Saved ContentGen project"
              onChange={e=>{void importProject(e.target.files?.[0]);}}/>
          </label>
          {usable&&<Button variant="outline" icon={<Download className="size-4"/>}
            onClick={()=>downloadJson("contentgen-project.json",{dossier,bundle})}>
            Save project
          </Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={header}>Research dossier (.json)<input className={field+" mt-2"} type="file" accept=".json" aria-label="Research dossier JSON" onChange={e=>{void importDossier(e.target.files?.[0]);}}/></label>
          <label className={header}>Preproduction bundle (.json)<input className={field+" mt-2"} type="file" accept=".json" aria-label="Preproduction bundle JSON" onChange={e=>{void importBundle(e.target.files?.[0]);}}/></label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{usable
          ?"Matched: "+dossier.topic.title+" · "+bundle.plan.shots.length+" shots"
          :"Import both the matching research dossier and preproduction bundle. Studio does not send either to a cloud service."}</p>
      </Surface>}
      {!usable&&status&&<p role="status" className="rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm">{status}</p>}
      {usable&&<>
        <nav aria-label="Video production steps" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {directorStages.map(item=>{
            const StepIcon=stageIcons[item.id as DirectorStage];
            const active=item.id===stage;
            return <button key={item.id} type="button" aria-label={`${item.number} ${item.label}`}
              aria-current={active?"step":undefined}
              onClick={()=>navigate(item.id as DirectorStage)}
              className={`group flex min-w-0 items-start gap-3 rounded-surface border px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active?
                "border-primary bg-primary/10 shadow-sm":"border-border bg-surface hover:border-primary/40 hover:bg-surface-subtle"}`}>
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-control ${active?
                "bg-primary text-primary-foreground":"bg-surface-subtle text-muted-foreground"}`}>
                <StepIcon className="size-5"/>
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-muted-foreground">{item.number} · {active?"Current step":"Production step"}</span>
                <span className="mt-0.5 block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.detail}</span>
              </span>
            </button>;
          })}
        </nav>
        {status&&<p role="status" className="rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm" >{status}</p>}
        {stage==="storyboard"&&<section aria-label="Storyboard editing" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Shape your story</h2>
              <p className="mt-1 text-sm text-muted-foreground">Work on one scene at a time. Save its edits before choosing another.</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon={<Undo2 className="size-4"/>}
                disabled={busy||dirty||history.undo.length===0} onClick={()=>travelHistory("undo")}>Undo saved edit</Button>
              <Button size="sm" variant="outline" icon={<Redo2 className="size-4"/>}
                disabled={busy||dirty||history.redo.length===0} onClick={()=>travelHistory("redo")}>Redo</Button>
              {dirty&&<div className="flex flex-wrap items-center gap-2 rounded-control border border-amber-400/40 bg-amber-400/5 px-3 py-2">
                <span className="text-xs font-semibold text-foreground">Unsaved scene edits</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={discardEdits}>Discard unsaved edits</Button>
              </div>}
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Scene timeline">
            {bundle.plan.shots.map((scene,index)=>{
              const selected=scene.id===shotId;
              const affected=revisions.some(item=>item.shotId===scene.id);
              return <button key={scene.id} type="button" onClick={()=>chooseShot(scene.id)}
                aria-pressed={selected} aria-label={`Scene ${index+1}: ${scene.onScreenText}${affected?", edited":""}`}
                className={`min-w-36 max-w-52 flex-1 rounded-control border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?
                  "border-primary bg-primary/10 text-foreground":"border-border bg-surface hover:border-primary/40"}`}>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scene {String(index+1).padStart(2,"0")}{affected?" · Edited":""}</span>
                <span className="mt-1 block truncate text-sm font-medium">{scene.onScreenText}</span>
              </button>;
            })}
          </div>
          <Surface header={<h2 className="font-medium">Selected scene · live preview</h2>}>
            {quickPreview?.shotMap.some(item=>item.shotId===shotId)?(()=>{
              const chapter=quickPreview.shotMap.find(item=>item.shotId===shotId)!;
              const frame=chapter.startFrame+Math.floor(Math.max(0,chapter.endFrame-chapter.startFrame-1)*previewPercent/100);
              return <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(14rem,1fr)]">
                <div className="min-w-0 overflow-hidden rounded-control border border-border bg-surface-subtle">
                  <Suspense fallback={<p role="status" className="p-5 text-sm">Loading the scene renderer…</p>}>
                    <RendererScene plan={quickPreview.plan} frame={frame}/>
                  </Suspense>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-semibold">{shot?.onScreenText}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">Preview uses the same Kumiki scene as export. Timing is estimated until voice generation.</p>
                  <label className="block text-xs font-medium text-muted-foreground">Scrub selected scene · {previewPercent}%
                    <input className="mt-2 block w-full accent-primary" aria-label="Scrub selected scene" type="range" min="0" max="100" step="5"
                      value={previewPercent} onChange={e=>setPreviewPercent(Number(e.target.value))}/>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy||dirty||["starting","rendering"].includes(sceneClip.state)}
                      onClick={()=>void renderSceneClip()}><Film className="mr-2 size-4"/>Render this scene MP4</Button>
                    {sceneClip.state==="rendering"&&<Button size="sm" variant="outline"
                      onClick={()=>void cancelSceneClip()}>Cancel scene render</Button>}
                  </div>
                  <p className="text-xs text-muted-foreground">Exports only this scene as a silent, real video. The complete draft adds narration, sound and final timing.</p>
                  {sceneClip.state!=="idle"&&sceneClip.shotId===shotId&&<div role="status"
                    className="rounded-control border border-border bg-surface-subtle p-3 text-xs text-muted-foreground">
                    <p>{sceneClip.message}</p>
                    {sceneClip.jobId&&onOpenJobs&&<Button size="sm" variant="outline"
                      onClick={onOpenJobs}>View scene job</Button>}
                    {sceneClip.state==="done"&&sceneClip.sourceRevision!==quickPreview.sourcePlanSha256&&
                      <p className="mt-2">The storyboard changed after this render. Render this scene again to see the latest edits.</p>}
                    {sceneClip.state==="done"&&sceneClip.videoUrl&&
                      sceneClip.sourceRevision===quickPreview.sourcePlanSha256&&
                      <video controls playsInline preload="metadata" aria-label="Selected scene MP4 preview"
                        src={sceneClip.videoUrl} className="mt-3 aspect-video w-full rounded-control bg-black"/>}
                  </div>}
                  <Button size="sm" variant="outline" onClick={()=>navigate("preview")}>Open full video preview</Button>
                </div>
              </div>;
            })():<p role="status" className="text-sm text-muted-foreground">{quickPreviewError||"Preparing this scene’s visual preview…"}</p>}
          </Surface>
        <Surface header={<h2 className="font-medium">Scene editor</h2>}>
          <div className="flex flex-col gap-3">
            <label className={header}>Selected shot
              <select aria-label="Selected video shot" className={field+" mt-2"} value={shotId}
                onChange={e=>chooseShot(e.target.value)}>
                {bundle.plan.shots.map((s,i)=><option key={s.id} value={s.id}>{String(i+1).padStart(2,"0")} · {s.id} · {s.purpose}</option>)}
              </select>
            </label>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className={header}>Narration script<textarea className={field+" mt-2"} rows={6} maxLength={2000} aria-label="Edit narration" value={draft.narration} onChange={e=>setDraft({...draft,narration:e.target.value})}/></label>
              <label className={header}>Visible explanation / motion intent<textarea className={field+" mt-2"} rows={6} maxLength={650} aria-label="Edit visual action" value={draft.visualAction} onChange={e=>setDraft({...draft,visualAction:e.target.value})}/></label>
              <label className={header}>What the viewer actually sees and learns
                <textarea className={field+" mt-2 font-mono"} rows={5}
                  aria-label="Visible teaching elements" maxLength={900}
                  placeholder={"Mortgage interest | Borrowing adds interest over time\\nProperty tax | Local tax payments recur"}
                  value={draft.visualElementsText}
                  onChange={e=>setDraft({...draft,visualElementsText:e.target.value})}/>
                <span className="mt-1 block text-xs text-muted-foreground">Two to five lines in <code>Label | explanation</code> format. These appear in the actual diagram, unlike free-form motion instructions. Avoid unsourced numbers.</span>
              </label>
              <label className={header}>Shot description<textarea className={field+" mt-2"} rows={3} maxLength={650} aria-label="Edit shot description" value={draft.visualChange} onChange={e=>setDraft({...draft,visualChange:e.target.value})}/></label>
              <div className="flex flex-col gap-3">
                <label className={header}>Visible scene layout
                  <select className={field+" mt-2"} aria-label="Visible scene layout" value={draft.family}
                    disabled={busy||!shot||!!shot.sceneRecipe||shot.id===bundle.plan.shots[0]?.id||shot.id===bundle.plan.shots.at(-1)?.id}
                    onChange={e=>setDraft({...draft,family:e.target.value})}>
                    <option value="question">Question · connected stages</option>
                    <option value="process">Process · connected stages</option>
                    <option value="mechanism">Mechanism · connected stages</option>
                    <option value="comparison">Comparison · side by side</option>
                    <option value="cost-breakdown">Breakdown · itemized parts</option>
                    <option value="evidence">Evidence · itemized parts</option>
                    <option value="summary">Summary · connected stages</option>
                  </select>
                  <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted-foreground">This controls the actual renderer arrangement. Opening, closing and bespoke scenes have fixed layouts. Written motion directions alone do not create 3D or footage.</span>
                </label>
                <label className={header}>On-screen text<input className={field+" mt-2"} maxLength={240} aria-label="Edit on-screen text" value={draft.onScreenText} onChange={e=>setDraft({...draft,onScreenText:e.target.value})}/></label>
                <label className={header}>Sound effect intent (optional)<input className={field+" mt-2"} maxLength={250} aria-label="Edit sound effect intent" value={draft.sfxIntent} onChange={e=>setDraft({...draft,sfxIntent:e.target.value})}/></label>
                <label className={header}>Pause after this scene (milliseconds)
                  <input className={field+" mt-2"} type="number" min={0} max={3000} step={50}
                    aria-label="Scene pause duration" value={draft.pauseAfterMs}
                    onChange={e=>setDraft({...draft,pauseAfterMs:Number(e.target.value)})}/>
                  <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted-foreground">0–3000 ms. Changes pacing and adjusts later scene timing without regenerating this scene’s voice.</span>
                </label>
              </div>
            </div>
            <div className="rounded-surface border border-border bg-surface-subtle p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Scene motion &amp; transition</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Control what actually animates in the exported scene. Changes here only rebuild this scene’s visual segment.</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={()=>setDraft({...draft,motion:normalizedSceneMotion()})}>Reset motion</Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <label className={header}>Reveal delay · {draft.motion.revealDelayPercent}%
                  <input className="mt-3 w-full accent-primary" type="range" min={0} max={30} step={5}
                    aria-label="Scene reveal delay" value={draft.motion.revealDelayPercent}
                    onChange={e=>setDraft({...draft,motion:{...draft.motion,revealDelayPercent:Number(e.target.value)}})}/>
                  <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted-foreground">Wait before showing the first visual element.</span>
                </label>
                <label className={header}>Reveal pace
                  <select className={field+" mt-2"} aria-label="Scene reveal pace" value={draft.motion.revealPace}
                    onChange={e=>setDraft({...draft,motion:{...draft.motion,revealPace:e.target.value as SceneMotion["revealPace"]}})}>
                    <option value="snappy">Quick reveals</option>
                    <option value="balanced">Balanced</option>
                    <option value="deliberate">Slow &amp; deliberate</option>
                  </select>
                </label>
                <label className={header}>Camera movement
                  <select className={field+" mt-2"} aria-label="Scene camera movement" value={draft.motion.camera}
                    onChange={e=>setDraft({...draft,motion:{...draft.motion,camera:e.target.value as SceneMotion["camera"]}})}>
                    <option value="locked">Still</option>
                    <option value="subtle">Subtle push</option>
                    <option value="cinematic">Cinematic push</option>
                  </select>
                </label>
                <label className={header}>Transition in
                  <select className={field+" mt-2"} aria-label="Scene transition" value={draft.motion.transition}
                    onChange={e=>setDraft({...draft,motion:{...draft.motion,transition:e.target.value as SceneMotion["transition"]}})}>
                    <option value="cut">Cut</option>
                    <option value="fade">Fade in</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button icon={<Save className="size-4"/>} disabled={busy||!dirty}
                onClick={()=>{try{void apply(changes());}catch(error){setStatus(error instanceof Error?error.message:"Review the visual elements.");}}}>Apply selected-shot edit</Button>
              <Button variant="outline" disabled={busy} onClick={()=>{
                if(dirty)void saveAndGenerateDraft();else generateUpdatedDraft();}}>
                <Film className="mr-2 size-4"/>{dirty?"Save & generate draft":"Generate updated draft"}
              </Button>
            </div>
          </div>
        </Surface>
        <Surface header={<h2 className="font-medium">Optional · Explore creative alternatives</h2>}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{shotId===bundle.plan.shots[0].id
              ?"Opening hooks must create immediate audience relevance AND a specific unanswered question."
              :"Generate three different script + visual treatments for the selected section; preserve its claims and role in the story."}</p>
            <Button icon={<WandSparkles className="size-4"/>} variant="outline" disabled={busy}
              onClick={()=>void generate()}>{busy?"Working…":"Generate 3 local AI variations"}</Button>
            {variants.length>0&&<div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                {variants.map(v=><div key={v.id} className="rounded-surface border border-border bg-surface-subtle p-3">
                  <p className="text-sm font-semibold">{v.strategy}</p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">AUDIENCE CLARITY</p>
                  <p className="text-xs">{v.audienceSignal}</p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">CURIOSITY GAP</p>
                  <p className="text-xs">{v.curiosityQuestion}</p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">SCRIPT</p>
                  <p className="text-sm leading-relaxed">{v.narration}</p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">VISUAL REVEAL</p>
                  <p className="text-xs">{v.firstVisual}</p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">PAYOFF</p>
                  <p className="text-xs">{v.payoffConnection}</p>
                </div>)}
              </div>
              <p className="text-sm font-medium">Mix and match any script, visual treatment and sound idea:</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {([{label:"Script candidate",value:voiceVariant,set:setVoiceVariant},{label:"Visual candidate",value:visualVariant,set:setVisualVariant},
                  {label:"Sound candidate",value:soundVariant,set:setSoundVariant}]).map(x=><label key={x.label} className={header}>
                    {x.label}<select className={field+" mt-2"} aria-label={x.label} value={x.value} onChange={e=>x.set(e.target.value)}>
                      {variants.map(v=><option key={v.id} value={v.id}>{v.strategy}</option>)}
                    </select></label>)}
              </div>
              <Button disabled={busy||dirty} onClick={combine} icon={<RefreshCw className="size-4"/>}>
                Apply combined variation to selected shot
              </Button>
              <p className="text-xs text-muted-foreground">Generated choices are hypotheses, not measured hook winners. Claims and media rights still require editorial review.</p>
            </div>}
          </div>
        </Surface>
        <Surface header={<h2 className="font-medium">Changes & regeneration</h2>}>
          <div className="space-y-2 text-sm">
            {revisions.length===0?<p className="text-muted-foreground">Make a change to see which segments need regeneration.</p>:<>
              <p>Revised shots: {revisions.length} · New narration: {[...mergedImpact.speech].join(", ")||"none"}</p>
              <p>Rerender visuals: {[...mergedImpact.visuals].join(", ")||"none"} · Remix sound: {[...mergedImpact.sfx].join(", ")||"none"}</p>
              <p>Retiming required from: {[...mergedImpact.shifted].join(", ")||"none"}</p>
              <p className="text-xs text-muted-foreground">Unchanged narration is kept and valid video scenes can be reused during the next draft export. A timing change may also move later scenes.</p>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Download className="size-4"/>} onClick={()=>downloadJson("contentgen-revised-preproduction.json",bundle)}>
                  Export revised bundle
                </Button>
                <Button variant="outline" icon={<Download className="size-4"/>} onClick={()=>downloadJson("contentgen-regeneration-plan.json",{
                  kind:"selective-regeneration-plan/v1",sourceResearchId:dossier.id,
                  changes:revisions,targets:{speech:[...mergedImpact.speech],visuals:[...mergedImpact.visuals],
                    sfx:[...mergedImpact.sfx],retiming:[...mergedImpact.shifted]},
                  reviewRequired:true,executed:false
                })}>Export regeneration plan</Button>
              </div>
            </>}
          </div>
        </Surface>
        </section>}
        {stage==="assets"&&<section aria-label="Visual asset selection" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Find the right visuals</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose footage and imagery that actually explain the selected scene. Review source rights before use.</p></div>
            <label className="text-xs font-semibold text-muted-foreground">Scene to source
              <select aria-label="Visual asset scene" className={field+" mt-1 max-w-xs"} value={shotId}
                onChange={event=>chooseShot(event.target.value)}>
                {bundle.plan.shots.map((shot,index)=><option key={shot.id} value={shot.id}>
                  {String(index+1).padStart(2,"0")} · {shot.purpose}
                </option>)}
              </select>
            </label>
          </div>
          <AssetDiscoveryPanel bundle={bundle} projectId={dossier.id} selectedShotId={shotId}
            productionId={projectId?.startsWith("production-")?projectId:undefined} onOpenJobs={onOpenJobs}/>
        </section>}
        {stage==="sound"&&<section aria-label="Sound design" className="space-y-4">
          <div><h2 className="text-lg font-semibold">Make it sound intentional</h2>
            <p className="mt-1 text-sm text-muted-foreground">Arrange approved effects, audition your mix and add subtle ambience where it helps.</p></div>
          <SfxDiscoveryPanel bundle={bundle} projectId={dossier.id} selectedShotId={shotId}
            onSelectShot={id=>chooseShot(id)}/>
        </section>}
        <div className={stage==="preview"?"space-y-4":"hidden"} aria-hidden={stage!=="preview"}>
          {stage==="preview"&&<div><h2 className="text-lg font-semibold">Preview & produce your draft</h2>
            <p className="mt-1 text-sm text-muted-foreground">Inspect the real scenes first. When ready, check voice permissions and media tools before starting a render.</p></div>}
          <ProductionPanel key={`${voiceProjectId??projectId??dossier.id}:${dossier.id}:${draftLaunchCount}`} dossier={dossier} bundle={bundle}
            voiceProjectId={voiceProjectId??projectId}
            onOpenJobs={onOpenJobs}
            onFindVisuals={id=>{chooseShot(id);navigate("assets");}}
            // A saved script can have multiple applied scene edits. Keep the
            // original source ID for its unedited plan, and scope edited MP4
            // restoration to that exact plan rather than showing an old film.
            sourceRevision={sourceArtifactId&&sourceBundle?.planSha256!==bundle.planSha256?
              bundle.planSha256:sourceArtifactId??undefined} recheckToken={recheckToken}
            productionId={projectId?.startsWith("production-")?projectId:undefined}
            selectedShotId={shotId} onSelectShot={id=>chooseShot(id,true)}
            onApplyMotion={applyShotMotion} autoOpenSample={sampleMode}
            initialStage={focusStage==="audio"?"narration":focusStage==="export"?"export":"preview"}
            autoStartDraft={focusStage==="draft"||draftLaunchCount>0}
            autoOpenVisuals={focusStage==="visuals"}/>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-surface-subtle px-4 py-4">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{stage==="preview"?
            "The final draft needs an explicit readiness check and human playback. Nothing publishes automatically.":
            dirty?"Save or discard the selected scene before continuing.":
            "You can revisit any stage. Saved choices remain in this project."}</p>
          {nextStage?<Button disabled={busy||dirty} onClick={()=>navigate(nextStage)}>
            Continue to {directorStages.find(item=>item.id===nextStage)?.label}
            <ArrowRight className="ml-2 size-4"/>
          </Button>:<Button variant="outline" onClick={()=>navigate("storyboard")}>Back to storyboard</Button>}
        </div>
      </>}
      <p className="text-xs text-muted-foreground">{ja?"すべての変更は下書きです。":"Every edit remains an unapproved draft. Source research, claims, voice permissions, and final export QA are never bypassed."}</p>
    </div>
  </main>;
}



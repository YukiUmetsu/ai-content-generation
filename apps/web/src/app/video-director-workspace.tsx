import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Download, Film, Headphones, Images, Layers3, RefreshCw, WandSparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import { ProductionPanel } from "./video-production-panel";
import { AssetDiscoveryPanel } from "./asset-discovery-panel";
import { SfxDiscoveryPanel } from "./sfx-discovery-panel";
import { loadProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { NewVideoSetup } from "./new-video-setup";
import type { SceneMotion } from "../../scripts/video-production/scene-motion.mjs";
import { isVisualElements, type VisualElement } from "../../scripts/video-production/visual-elements.mjs";
import { directorStages, nextDirectorStage, resolveDirectorNavigation,
  shouldInvalidateDirectorReadiness } from "../../scripts/video-production/director-workflow.mjs";

type Shot={id:string;family:string;visualChange:string;onScreenText:string;purpose:string;sceneRecipe?:string;visualElements?:VisualElement[]};
type Sound={shotId:string;narration:string;sfxIntent:string|null};
type Phase={shotId:string;visualAction:string;kind:string};
type Plan={shots:Shot[];sound:Sound[];teachingSequences:Array<{phases:Phase[]}>;story:{question:string}};
type Bundle={kind:string;researchId:string;plan:Plan;planSha256?:string;researchSha256?:string};
type Dossier={kind:string;id:string;topic:{title:string;audience:string}};
type Variant={id:string;strategy:string;audienceSignal:string;curiosityQuestion:string;
  narration:string;firstVisual:string;onScreenText:string;payoffConnection:string;sfxIntent:string|null};
type Impact={changedFields:string[];speechRegenerate:string[];visualRerender:string[];
  sfxRemix:string[];downstreamRetiming:string[];timelineRecalculate:boolean;externalActionsPerformed:string[]};
type Revision={kind:string;bundle:Bundle;impacts:Impact;reviewRequired:boolean};
type DirectorStage="storyboard"|"assets"|"sound"|"preview";
const stageIcons={storyboard:Layers3,assets:Images,sound:Headphones,preview:Film};
type StoryboardSync={storyboardSha256:string;applied:string[];manualReview:string[]};
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
function readDirectorSession(projectId:string|undefined,artifactId:string,source:Bundle,
  storyboardSha256:string|null=null):
  {dossier:Dossier;bundle:Bundle}|null {
  if(!projectId||typeof sessionStorage==="undefined"||!source.researchSha256)return null;
  try{
    const raw=sessionStorage.getItem(directorSessionKey(projectId,artifactId,storyboardSha256));
    if(!raw||raw.length>900000)return null;
    const data=JSON.parse(raw) as {version?:number;artifactId?:string;dossier?:Dossier;bundle?:Bundle};
    if(data.version!==1||data.artifactId!==artifactId||data.dossier?.kind!=="research-dossier"||
      data.dossier.id!==source.researchId||data.bundle?.kind!=="preproduction-bundle"||
      data.bundle.researchId!==source.researchId||data.bundle.researchSha256!==source.researchSha256||
      !Array.isArray(data.bundle.plan?.shots)||!data.bundle.plan.shots.length||
      !Array.isArray(data.bundle.plan?.sound)||!Array.isArray(data.bundle.plan?.teachingSequences)||
      !/^[a-f0-9]{64}$/u.test(data.bundle.planSha256??""))return null;
    return {dossier:data.dossier,bundle:data.bundle};
  }catch{return null;}
}
function shotDraft(bundle:Bundle,id:string){
  const shot=bundle.plan.shots.find(x=>x.id===id);
  const audio=bundle.plan.sound.find(x=>x.shotId===id);
  const phase=bundle.plan.teachingSequences?.flatMap(x=>x.phases).find(x=>x.shotId===id);
  return {narration:audio?.narration??"",onScreenText:shot?.onScreenText??"",family:shot?.family??"process",
    visualChange:shot?.visualChange??"",visualAction:phase?.visualAction??shot?.visualChange??"",
    sfxIntent:audio?.sfxIntent??"",
    visualElementsText:shot?.visualElements?.map(item=>item.label+" | "+item.detail).join("\n")??""};
}
type DirectorWorkspaceProps={locale:Locale;projectId?:string;researchArtifactId?:string|null;focusStage?:"visuals"|"audio"|"export"};
export function VideoDirectorWorkspace(props:DirectorWorkspaceProps){
  return <VideoDirectorWorkspaceContent key={`${props.projectId??""}:${props.researchArtifactId??""}`} {...props}/>;
}
function VideoDirectorWorkspaceContent({locale,projectId,researchArtifactId,focusStage}:DirectorWorkspaceProps){
  const ja=locale==="ja";
  const [dossier,setDossier]=useState<Dossier|null>(null);
  const [bundle,setBundle]=useState<Bundle|null>(null);
  const [shotId,setShotId]=useState("");
  const [draft,setDraft]=useState({narration:"",onScreenText:"",family:"process",visualChange:"",visualAction:"",sfxIntent:"",visualElementsText:""});
  const [variants,setVariants]=useState<Variant[]>([]);
  const [voiceVariant,setVoiceVariant]=useState("");
  const [visualVariant,setVisualVariant]=useState("");
  const [soundVariant,setSoundVariant]=useState("");
  const [revisions,setRevisions]=useState<Array<{shotId:string;impacts:Impact}>>([]);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [sampleMode,setSampleMode]=useState(false);
  const [stage,setStage]=useState<DirectorStage>("storyboard");
  const [recheckToken,setRecheckToken]=useState(0);
  const [loadingSaved,setLoadingSaved]=useState(Boolean(researchArtifactId));
  const [loadError,setLoadError]=useState("");
  const [sourceArtifactId,setSourceArtifactId]=useState<string|null>(null);
  const [sourceStoryboardSha,setSourceStoryboardSha]=useState<string|null>(null);
  const [syncReport,setSyncReport]=useState<StoryboardSync|null>(null);
  const shot=bundle?.plan.shots.find(x=>x.id===shotId);
  const audio=bundle?.plan.sound.find(x=>x.shotId===shotId);
  const phase=bundle?.plan.teachingSequences?.flatMap(x=>x.phases).find(x=>x.shotId===shotId);
  const acceptProject=useCallback((d:Dossier,b:Bundle,source:"sample"|"topic"="topic",artifactId:string|null=null,storyboardSha:string|null=null)=>{
    setDossier(d);setBundle(b);setRevisions([]);setSampleMode(source==="sample");setSourceArtifactId(artifactId);
    setSourceStoryboardSha(storyboardSha);setSyncReport(null);
    setStage(source==="sample"?"preview":focusStage==="visuals"?"assets":focusStage==="audio"?"sound":focusStage==="export"?"preview":"storyboard");
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
        "topic",researchArtifactId,revision);
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
    if(!projectId||!researchArtifactId||sourceArtifactId!==researchArtifactId||!dossier||!bundle||
      typeof sessionStorage==="undefined")return;
    let warningTimer:ReturnType<typeof setTimeout>|undefined;
    try{
      // Only applied shot edits are saved here. Never store provider keys or voice permissions.
      const data=JSON.stringify({version:1,artifactId:researchArtifactId,dossier,bundle});
      if(data.length>900000)throw Error("Saved director draft exceeds the browser session limit.");
      sessionStorage.setItem(directorSessionKey(projectId,researchArtifactId,sourceStoryboardSha),data);
    }catch{
      // Storage failure is reported after the effect finishes, avoiding a cascading render.
      warningTimer=setTimeout(()=>setStatus("Browser session draft could not be saved. Download Save project JSON before leaving Video Director."),0);
    }
    return ()=>{if(warningTimer!==undefined)clearTimeout(warningTimer);};
  },[projectId,researchArtifactId,sourceArtifactId,sourceStoryboardSha,dossier,bundle]);
  async function importProject(file:File|undefined){
    if(!file)return;
    try{
      const input=await loadJson(file) as unknown as {dossier:Dossier;bundle:Bundle};
      if(input.dossier?.kind!=="research-dossier"||input.bundle?.kind!=="preproduction-bundle"||
        input.dossier.id!==input.bundle.researchId)
        throw Error("Expected a matching ContentGen saved project.");
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
      setBundle(x);setRevisions([]);setShotId(x.plan.shots[0].id);
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
    setShotId(id);setDraft(shotDraft(bundle,id));
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
    const result:Record<string,string|null|VisualElement[]>={};
    if(draft.narration!==audio.narration)result.narration=draft.narration;
    if(draft.family!==(shot.family??"process"))result.family=draft.family;
    if(draft.onScreenText!==shot.onScreenText)result.onScreenText=draft.onScreenText;
    if(draft.visualChange!==shot.visualChange)result.visualChange=draft.visualChange;
    if(draft.visualAction!==(phase?.visualAction??shot.visualChange))result.visualAction=draft.visualAction;
    if(draft.sfxIntent!==(audio.sfxIntent??""))result.sfxIntent=draft.sfxIntent||null;
    const savedText=shot.visualElements?.map(item=>item.label+" | "+item.detail).join("\n")??"";
    if(draft.visualElementsText.trim()!==savedText.trim())
      result.visualElements=parseElementsInput(draft.visualElementsText);
    return result;
  }
  async function apply(changed:Record<string,string|null|VisualElement[]>){
    if(!bundle||!dossier||!shot)return;
    setBusy(true);setStatus("");
    try{
      const result=await request("edit",{bundle,dossier,shotId:shot.id,changes:changed}) as unknown as Revision;
      setBundle(result.bundle);
      setDraft(shotDraft(result.bundle,shot.id));
      setRevisions(prev=>[...prev,{shotId:shot.id,impacts:result.impacts}]);
      setStatus("Draft revised. Unchanged shots remain intact. Review before any regeneration or publishing.");
    }catch(e){setStatus(e instanceof Error?e.message:"Revision rejected.");}
    finally{setBusy(false);}
  }
  async function applyShotMotion(id:string,motion:SceneMotion):Promise<Bundle>{
    if(!bundle||!dossier)throw Error("Open a matching project before editing motion.");
    setBusy(true);setStatus("");
    try{
      const result=await request("edit",{bundle,dossier,shotId:id,changes:{motion}}) as unknown as Revision;
      setBundle(result.bundle);
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
    draft.sfxIntent!==(audio.sfxIntent??"")||draft.visualElementsText.trim()!==visualTextSaved.trim());
  function navigate(target:DirectorStage){
    const result=resolveDirectorNavigation({current:stage,target,unsaved:dirty});
    if(result.blocked){setStatus(result.message);return;}
    if(shouldInvalidateDirectorReadiness(stage,target))setRecheckToken(value=>value+1);
    setStage(result.stage as DirectorStage);setStatus("");
  }
  function discardEdits(){
    if(bundle)setDraft(shotDraft(bundle,shotId));
    setStatus("Unsaved scene edits discarded. The saved storyboard is unchanged.");
  }
  const nextStage=nextDirectorStage(stage) as DirectorStage|null;
  const usable=!!dossier&&!!bundle&&dossier.id===bundle.researchId;
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
      {!usable&&loadingSaved&&<p role="status" className="rounded-control border border-border bg-surface p-4 text-sm">Opening saved research for Video Director…</p>}
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
          <p className="mt-1 text-xs text-muted-foreground">{bundle.plan.shots.length} scenes · {sampleMode?"Synthetic demo · explore without voice setup":"Editable source-linked draft"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Download className="size-4"/>} disabled={dirty||busy}
            onClick={()=>downloadJson("contentgen-project.json",{dossier,bundle})}>Save project</Button>
          <Button variant="outline" disabled={dirty||busy} onClick={()=>{
               if(projectId&&researchArtifactId&&sourceArtifactId===researchArtifactId){
                 try{sessionStorage.removeItem(directorSessionKey(projectId,researchArtifactId,sourceStoryboardSha));}catch{/* In-memory reset still works. */}
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
            {dirty&&<div className="flex flex-wrap items-center gap-2 rounded-control border border-amber-400/40 bg-amber-400/5 px-3 py-2">
              <span className="text-xs font-semibold text-foreground">Unsaved scene edits</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={discardEdits}>Discard unsaved edits</Button>
            </div>}
          </div>
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
                    disabled={busy||!!shot.sceneRecipe||shot.id===bundle.plan.shots[0].id||shot.id===bundle.plan.shots.at(-1)?.id}
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
              </div>
            </div>
            <Button icon={<Save className="size-4"/>} disabled={busy||!dirty}
              onClick={()=>{try{void apply(changes());}catch(error){setStatus(error instanceof Error?error.message:"Review the visual elements.");}}}>Apply selected-shot edit</Button>
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
              <p className="text-xs text-muted-foreground">Unchanged narration beats can reuse ContentGen's content-addressed TTS cache. This editor produces an invalidation manifest and revised preproduction bundle; it does not yet synthesize partial WAVs or export partial MP4 clips.</p>
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
          <AssetDiscoveryPanel bundle={bundle} projectId={dossier.id} selectedShotId={shotId}/>
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
          <ProductionPanel key={dossier.id} dossier={dossier} bundle={bundle} recheckToken={recheckToken}
            selectedShotId={shotId} onSelectShot={id=>chooseShot(id,true)}
            onApplyMotion={applyShotMotion} autoOpenSample={sampleMode}/>
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


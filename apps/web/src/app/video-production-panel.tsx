import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Film, Headphones, Play, RefreshCw, ShieldAlert, Square, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { LiveRendererPreview, type LiveVisualPreviewData } from "./live-renderer-preview";
import type { SceneMotion } from "../../scripts/video-production/scene-motion.mjs";

type Dossier = {id:string;topic:{title:string;audience:string}};
type Bundle = {kind:string;researchId:string;plan:{shots:Array<{id:string;onScreenText:string}>}};
type Preview = {schemaVersion:number;kind:string;job:{beats:Array<{id:string;narration:string;visual:{headline:string;subhead:string;items:string[]}}>};
  shotMap:Array<{shotId:string;beatId:string;visualAction:string}>;
  warnings:string[];editorialStatus:string};
type Report = {ready:boolean;findings:Array<{severity:string;code:string;message:string}>};
type Status = {state:string;phase:string;message:string;report?:Report|null;
  progress?:{phase:string;completedFrames?:number;totalFrames?:number}|null;
  mediaUrl?:string|null;regeneration?:{reusedSpeechBeatIds:string[];reusedVideoSegments:number;newlyEncodedVideoSegments:number|null}|null};
type Settings = {provider:"local"|"fish";voiceId:string;providerRevision:string;modelId:string;endpoint:string;
  apiKey:string;localVoiceAuthorized:boolean;voiceConsent:boolean;transmitText:boolean};
type Stage="preview"|"narration"|"review"|"export";
type SampleStatus={state:"idle"|"generating"|"done"|"failed"|"cancelled";message:string;audioUrl?:string|null};
type SfxSummary={approved?:number;muted?:number;extraLayers?:number};
const steps:{id:Stage;title:string;subtitle:string}[]=[
  {id:"preview",title:"Preview",subtitle:"Inspect animations"},
  {id:"narration",title:"Narration",subtitle:"Choose & hear a voice"},
  {id:"review",title:"Final review",subtitle:"Check before rendering"},
  {id:"export",title:"Export",subtitle:"Make & watch MP4"}
];
const field="mt-1.5 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const inputLabel="flex flex-col text-xs font-semibold text-muted-foreground";
const defaults:Settings={provider:"local",voiceId:"",providerRevision:"",modelId:"",
  endpoint:"http://127.0.0.1:8765",apiKey:"",localVoiceAuthorized:false,voiceConsent:false,transmitText:false};
async function request(path:string,payload?:unknown){
  const isPost=payload!==undefined;
  const response=await fetch("/api/contentgen-video/"+path,{
    method:isPost?"POST":"GET",cache:"no-store",
    headers:isPost?{"Content-Type":"application/json","X-Contentgen-Director":"local-only"}:undefined,
    ...(isPost?{body:JSON.stringify(payload)}:{}),
    signal:AbortSignal.timeout(path==="check"?360000:16000)
  });
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(data.error??"Local production service unavailable."));
  return data;
}
export function ProductionPanel({dossier,bundle,productionId,sourceRevision,selectedShotId,onSelectShot,onApplyMotion,autoOpenSample=false,recheckToken=0}:{dossier:Dossier;bundle:Bundle;productionId?:string;sourceRevision?:string;selectedShotId?:string;onSelectShot?:(shotId:string)=>void;onApplyMotion?:(shotId:string,motion:SceneMotion)=>Promise<Bundle>;autoOpenSample?:boolean;recheckToken?:number}){
  const [stage,setStage]=useState<Stage>("preview");
  const [settings,setSettings]=useState<Settings>(defaults);
  const [sampleStatus,setSampleStatus]=useState<SampleStatus>({state:"idle",message:""});
  const sampleRevision=useRef(0);
  const activeSampleRevision=useRef(0);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [actualPreview,setActualPreview]=useState<LiveVisualPreviewData|null>(null);
  const [previewFocus,setPreviewFocus]=useState<string|undefined>();
  const [sampleAutoLoaded,setSampleAutoLoaded]=useState(false);
  const previewAnchor=useRef<HTMLDivElement>(null);
  const demoScrolled=useRef(false);
  const lastBundle=useRef(bundle);
  const [animaticUrl,setAnimaticUrl]=useState("");
  const [ready,setReady]=useState(false);
  const [working,setWorking]=useState("");
  const [notice,setNotice]=useState("");
  const [state,setState]=useState<Status>({state:"idle",phase:"idle",message:""});
  const [sfxSummary,setSfxSummary]=useState<SfxSummary|null>(null);
  // Returning from scene/media/sound edits invalidates an old UI readiness approval,
  // without discarding voice settings, previews or an already running/completed render.
  const [handledRecheckToken,setHandledRecheckToken]=useState(recheckToken);
  // Adjust state during render when the parent changes revision; avoids a stale
  // readiness approval reaching the next paint without resetting voice settings.
  if(handledRecheckToken!==recheckToken){
    setHandledRecheckToken(recheckToken);
    if(recheckToken!==0){
      setSampleStatus(current=>current.state==="generating"?{
        state:"generating",message:"An older voice sample is finishing. Cancel it or wait, then audition the updated project."
      }:{state:"idle",message:"Storyboard or sound edits require a new voice audition."});
      setReady(false);
      setSfxSummary(null);
      setState(current=>["rendering","done"].includes(current.state)?current:
        {state:"idle",phase:"idle",message:"",report:null});
    }
  }
  useEffect(()=>{if(recheckToken!==0)sampleRevision.current++;},[recheckToken]);
  const change=(patch:Partial<Settings>)=>{
    sampleRevision.current++;
    setSampleStatus(current=>current.state==="generating"?{
      state:"generating",message:"An older sample is finishing. Cancel it or wait before auditioning the new voice."
    }:{state:"idle",message:"Voice changed. Generate a fresh sample to hear it."});
    setSettings(x=>({...x,...patch}));setReady(false);
    setSfxSummary(null);
    setState(current=>["rendering","done"].includes(current.state)?current:
      {state:"idle",phase:"idle",message:"",report:null});
  };
  const payload={dossier,bundle};
  useEffect(()=>{
    if(lastBundle.current===bundle)return;
    lastBundle.current=bundle;
    sampleRevision.current++;
    setSampleStatus(current=>current.state==="generating"?{
      state:"generating",message:"Scene changed during voice synthesis. Cancel or wait for this sample before retrying."
    }:{state:"idle",message:"Scene text changed. Audition it again."});
    setPreview(null);setReady(false);
    setSfxSummary(null);
    setState(current=>["rendering","done"].includes(current.state)?current:
      {state:"idle",phase:"idle",message:"",report:null});
    if(!actualPreview)return;
    let cancelled=false;
    void request("live-preview",{dossier,bundle}).then(data=>{
      if(cancelled)return;
      const updated=data as unknown as LiveVisualPreviewData;
      if(updated.kind!=="live-renderer-preview/v1")throw Error("Invalid scene preview.");
      setActualPreview(updated);setReady(false);
      setNotice("Storyboard changes are now visible in the actual renderer preview.");
    }).catch(error=>{
      if(!cancelled){
        setActualPreview(null);
        setNotice("Storyboard changed, but the visual preview could not refresh: "+
          (error instanceof Error?error.message:"Unknown error"));
      }
    });
    return ()=>{cancelled=true;};
  },[bundle,dossier,actualPreview]);
  async function navigate(target:Stage){
    if(working)return;
    if(target!=="preview"&&!preview){
      setWorking("plan");setNotice("");setReady(false);setAnimaticUrl("");
      try{
        const result=await request("plan",payload) as unknown as Preview;
        if(!Array.isArray(result.job?.beats))throw Error("The compiled storyboard contains no valid scenes.");
        setPreview(result);
      }catch(error){
        setNotice("Couldn't prepare your video: "+(error instanceof Error?error.message:"Unknown error")+". You can retry from Preview.");
        setWorking("");return;
      }
      setWorking("");
    }
    setStage(target);
  }
  async function showActual(){
    setWorking("real-preview");setNotice("");setReady(false);
    try{
      const result=await request("live-preview",payload) as unknown as LiveVisualPreviewData;
      if(result.kind!=="live-renderer-preview/v1"||result.sourcePlanSha256.length!==64)
        throw Error("Actual visual preview returned an invalid contract.");
      setActualPreview(result);setPreviewFocus(selectedShotId);
    }catch(error){
      setActualPreview(null);
      setNotice(error instanceof Error?error.message:"Actual scene preview failed.");
    }finally{setWorking("");}
  }
  async function saveMotion(id:string,motion:SceneMotion){
    if(!onApplyMotion)throw Error("Studio motion editing is not configured.");
    const updated=await onApplyMotion(id,motion);
    const result=await request("live-preview",{dossier,bundle:updated}) as unknown as LiveVisualPreviewData;
    if(result.kind!=="live-renderer-preview/v1")throw Error("Saved project preview could not be refreshed.");
    setPreviewFocus(id);setActualPreview(result);setReady(false);
    setNotice("Saved per-shot motion and refreshed the real export scene. Audio was not regenerated.");
  }
  async function animatic(){
    setWorking("animatic");setNotice("");
    try{
      const result=await request("preview",payload);
      setAnimaticUrl(String(result.url));
      setNotice("Rough cut ready. Open it for an offline, estimated-timing preview.");
    }catch(error){setNotice(error instanceof Error?error.message:"Preview failed.");}
    finally{setWorking("");}
  }
  async function audition(){
    setWorking("sample");setNotice("");
    activeSampleRevision.current=sampleRevision.current;
    try{
      const result=await request("narration-sample",{...payload,settings});
      if(result.started!==true)throw Error("The local narration service did not start.");
      setSampleStatus({state:"generating",message:"Synthesizing a short first-scene voice sample…"});
    }catch(error){
      setSampleStatus({state:"failed",message:error instanceof Error?error.message:"Could not start voice audition."});
    }finally{setWorking("");}
  }
  async function cancelSample(){
    try{await request("narration-sample/cancel",{confirmed:true});
      setSampleStatus({state:"generating",message:"Cancelling voice audition…"});
    }catch(error){setNotice(error instanceof Error?error.message:"Could not cancel narration audition.");}
  }
  useEffect(()=>{
    if(sampleStatus.state!=="generating")return;
    let mounted=true;
    const poll=async()=>{
      try{
        const result=await request("narration-sample/status") as unknown as SampleStatus;
        if(!mounted)return;
        if(result.state==="generating")return;
        setSampleStatus(activeSampleRevision.current===sampleRevision.current?result:
          {state:"idle",message:"Voice settings have changed. Generate a fresh sample to hear your selection."});
      }catch(error){if(mounted)setSampleStatus({state:"generating",message:
        "Voice preview connection interrupted; retrying status. You can cancel this job. "+
        (error instanceof Error?error.message:"Unknown error")});}
    };
    void poll();const timer=window.setInterval(()=>void poll(),1600);
    return ()=>{mounted=false;window.clearInterval(timer);};
  },[sampleStatus.state]);
  async function check(){
    setWorking("check");setNotice("");setReady(false);
    try{
      const response=await request("check",{...payload,settings,...(productionId?{productionId,sourceRevision}:{})});
      const report=response.report as Report;
      setSfxSummary((response.sfxSummary as SfxSummary|undefined)??null);
      setState({state:report.ready?"ready":"blocked",phase:"preflight",
        message:report.ready?"Ready to produce your test draft.":"Fix the listed requirements.",report});
      setReady(report.ready);
      if(!report.ready)setNotice("Ready check found missing tools or permissions. Resolve these issues before rendering.");
    }catch(error){setNotice(error instanceof Error?error.message:"Local readiness check failed.");}
    finally{setWorking("");}
  }
  async function start(){
    if(!ready)return;
    setWorking("start");setNotice("");
    try{
      const r=await request("start",{...payload,settings,...(productionId?{productionId,sourceRevision}:{}),confirmRender:true});
      setState({state:"rendering",phase:"starting",message:"Producing a real draft MP4. Leave Studio open."});
      setReady(false);
      setNotice("Render started. Only files in the new job-owned output folder will be written.");
      if(!r.started)throw Error("Studio did not confirm render startup.");
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to start render.");}
    finally{setWorking("");}
  }
  async function cancel(){
    try{await request("cancel",{confirmed:true});setNotice("Cancellation requested. Finalizing owned scratch cleanup.");}
    catch(error){setNotice(error instanceof Error?error.message:"Could not cancel.");}
  }
  useEffect(()=>{
    if(!autoOpenSample||sampleAutoLoaded)return;
    let active=true;
    async function loadSampleVisuals(){
      try{
        const result=await request("live-preview",{dossier,bundle}) as unknown as LiveVisualPreviewData;
        if(result.kind!=="live-renderer-preview/v1"||result.sourcePlanSha256?.length!==64)
          throw Error("The sample visual preview is unavailable. Check the Studio server.");
        if(!active)return;
        setActualPreview(result);setPreviewFocus(bundle.plan.shots[0]?.id);setSampleAutoLoaded(true);
        if(!demoScrolled.current){
          demoScrolled.current=true;
          requestAnimationFrame(()=>previewAnchor.current?.scrollIntoView?.({behavior:"smooth",block:"start"}));
        }
      }catch(error){
        if(active)setNotice("Sample loaded, but the live preview could not open: "+
          (error instanceof Error?error.message:"Unknown error")+
          ". Use Preview actual rendered scenes to retry.");
      }
    }
    void loadSampleVisuals();
    return ()=>{active=false;};
  },[autoOpenSample,sampleAutoLoaded,dossier,bundle]);
  useEffect(()=>{
    if(state.state!=="rendering"&&state.state!=="checking")return;
    let mounted=true;
    const poll=async()=>{
      try{
        const next=await request("status") as unknown as Status;
        if(mounted)setState(next);
      }catch(error){if(mounted)setNotice(error instanceof Error?error.message:"Progress connection interrupted.");}
    };
    const timer=window.setInterval(()=>void poll(),1800);
    return ()=>{mounted=false;window.clearInterval(timer);};
  },[state.state]);
  const progress=state.progress;
  const pct=progress?.totalFrames&&progress?.completedFrames!==undefined
    ?Math.min(100,Math.round(100*progress.completedFrames/progress.totalFrames)):null;
  return <div ref={previewAnchor} id="contentgen-interactive-preview" className="scroll-mt-4">
    <Surface header={<div className="space-y-1"><h2 className="flex items-center gap-2 text-lg font-semibold"><Film className="size-5"/>Preview & Export</h2>
      <p className="text-xs font-normal text-muted-foreground">From working scenes to a playable test video, one step at a time.</p></div>}>
    <div className="space-y-5 text-sm">
      <div role="tablist" aria-label="Preview and export steps" className="grid gap-2 sm:grid-cols-4">
        {steps.map((step,index)=><button key={step.id} type="button" role="tab" id={"production-step-"+step.id}
          aria-selected={stage===step.id} aria-controls="production-step-content" disabled={!!working}
          onClick={()=>void navigate(step.id)}
          className={"rounded-control border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 "+
            (stage===step.id?"border-primary bg-primary/10 text-foreground":"border-border bg-surface hover:bg-surface-subtle text-muted-foreground")}>
          <span className="block text-[10px] font-bold uppercase tracking-widest">0{index+1} / {step.title}</span>
          <span className="mt-1 block text-xs">{step.subtitle}</span>
        </button>)}
      </div>
      <section id="production-step-content" role="tabpanel" aria-labelledby={"production-step-"+stage} className="space-y-4">
      {stage==="preview"&&<>
        <div className="space-y-1"><h3 className="text-base font-semibold">See your story move</h3>
          <p className="text-muted-foreground">Play and tune the real Kumiki scene renderer, without generating audio or video files. The timing is estimated until narration is rendered.</p></div>
        {autoOpenSample&&!actualPreview&&<p role="status" className="rounded-control border border-border p-3 text-muted-foreground">Opening the built-in sample animation preview…</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!working||state.state==="rendering"} onClick={()=>void showActual()}>
            <Play className="mr-2 size-4"/>{working==="real-preview"?"Preparing scene…":actualPreview?"Refresh scene preview":"Play actual scene preview"}
          </Button>
          <Button variant="outline" disabled={!!working||state.state==="rendering"} onClick={()=>void animatic()}>
            <WandSparkles className="mr-2 size-4"/>Generate rough cut
          </Button>
          {animaticUrl&&<a target="_blank" rel="noopener noreferrer" href={animaticUrl}
            className="inline-flex items-center rounded-control border border-border px-3 py-2 underline">Open rough cut</a>}
        </div>
        {actualPreview&&<div className="rounded-control border border-border p-3">
          <LiveRendererPreview key={actualPreview.renderPlanSha256+":"+(previewFocus??selectedShotId)}
            preview={actualPreview} selectedShotId={previewFocus??selectedShotId}
            onSelectShot={id=>{setPreviewFocus(id);onSelectShot?.(id);}}
            onSaveMotion={onApplyMotion?saveMotion:undefined}/>
        </div>}
        {!actualPreview&&<div className="rounded-control border border-dashed border-border bg-surface-subtle px-6 py-10 text-center text-muted-foreground">
          <Film className="mx-auto mb-3 size-7 opacity-70"/><p className="font-medium text-foreground">Your video preview will appear here</p>
          <p className="mt-1 text-xs">Open the renderer to inspect composition, motion and clipping before you export.</p>
        </div>}
        <div className="flex justify-end"><Button disabled={!!working} onClick={()=>void navigate("narration")}>Continue to narration <ArrowRight className="ml-2 size-4"/></Button></div>
      </>}
      {stage==="narration"&&<>
        <div className="space-y-1"><h3 className="flex items-center gap-2 text-base font-semibold"><Headphones className="size-4"/>Choose your narrator</h3>
          <p className="text-muted-foreground">Select an authorized voice and listen to a short excerpt from your first scene. This is a voice test, not the finished soundtrack.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={inputLabel}>Voice provider
            <select className={field} aria-label="Production voice provider" value={settings.provider}
              onChange={e=>change({provider:e.target.value as "local"|"fish",localVoiceAuthorized:false,voiceConsent:false,transmitText:false})}>
              <option value="local">Local TTS</option><option value="fish">Fish Audio (free-model ID)</option>
            </select>
          </label>
          <label className={inputLabel}>Authorized voice ID<input className={field} aria-label="Production voice ID"
            value={settings.voiceId} onChange={e=>change({voiceId:e.target.value})}
            placeholder="Voice identifier you have permission to use"/></label>
          <label className={inputLabel}>Engine revision<input className={field} aria-label="Production engine revision"
            value={settings.providerRevision} onChange={e=>change({providerRevision:e.target.value})}
            placeholder="Installed or published engine version"/></label>
          {settings.provider==="local"?<>
            <label className={inputLabel}>Installed local model<input className={field} aria-label="Installed TTS model"
              value={settings.modelId} onChange={e=>change({modelId:e.target.value})} placeholder="Your local TTS model"/></label>
            <label className={inputLabel}>Local speech server<input className={field} aria-label="Local speech server URL"
              value={settings.endpoint} onChange={e=>change({endpoint:e.target.value})}/></label>
          </>:<label className={inputLabel}>Fish Audio API key<input type="password" autoComplete="off" className={field}
            aria-label="Fish Audio key" value={settings.apiKey} onChange={e=>change({apiKey:e.target.value})}
            placeholder="Sent to the local render process only"/></label>}
        </div>
        <div className="rounded-control border border-border bg-surface-subtle p-3">
          {settings.provider==="local"?<label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" aria-label="I am authorized to synthesize this local voice"
              checked={settings.localVoiceAuthorized} onChange={e=>change({localVoiceAuthorized:e.target.checked})}/>
            I am authorized to synthesize this local voice.
          </label>:<div className="space-y-2 text-xs">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={settings.voiceConsent}
              onChange={e=>change({voiceConsent:e.target.checked})}/> I have permission to use this Fish voice.</label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={settings.transmitText}
              onChange={e=>change({transmitText:e.target.checked})}/> I approve sending this script excerpt to Fish Audio.</label>
            <p className="text-muted-foreground">A free-model ID does not by itself establish commercial publishing rights. Check the provider's current terms.</p>
          </div>}
        </div>
        <div className="rounded-control border border-border p-4 space-y-3">
          <p className="font-semibold">Listen before you render</p>
          <p className="text-xs text-muted-foreground">Generates up to 180 characters from the first scene. This is an explicit TTS request and may take time on a local model.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!working||sampleStatus.state==="generating"||state.state==="rendering"}
              onClick={()=>void audition()}><Play className="mr-2 size-4"/>Generate voice sample</Button>
            {sampleStatus.state==="generating"&&<Button variant="outline" onClick={()=>void cancelSample()}><Square className="mr-2 size-4"/>Cancel sample</Button>}
          </div>
          {sampleStatus.message&&<p role="status" className="text-xs text-muted-foreground">{sampleStatus.message}</p>}
          {sampleStatus.state==="done"&&sampleStatus.audioUrl&&<audio key={sampleStatus.audioUrl} aria-label="Voice sample" controls preload="none" src={sampleStatus.audioUrl} className="w-full"/>}
        </div>
        <div className="flex items-center justify-between gap-2"><Button variant="outline" onClick={()=>void navigate("preview")}><ArrowLeft className="mr-2 size-4"/>Preview</Button>
          <Button onClick={()=>void navigate("review")}>Continue to final review <ArrowRight className="ml-2 size-4"/></Button></div>
      </>}
      {stage==="review"&&<>
        <div className="space-y-1"><h3 className="text-base font-semibold">Final review</h3>
          <p className="text-muted-foreground">Make sure the story, voice, sound choices and source rights are suitable. Then check the actual local render requirements.</p></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-control border border-border p-3"><p className="text-xs text-muted-foreground">Scenes</p><p className="mt-1 text-xl font-semibold">{preview?.job.beats.length??0}</p></div>
          <div className="rounded-control border border-border p-3"><p className="text-xs text-muted-foreground">Narrator</p><p className="mt-1 font-medium">{settings.voiceId||"Not chosen"}</p><p className="text-xs text-muted-foreground">{settings.provider==="local"?"Local TTS":"Fish Audio"}</p></div>
          <div className="rounded-control border border-border p-3"><p className="text-xs text-muted-foreground">Voice audition</p><p className="mt-1 font-medium">{sampleStatus.state==="done"?"Sample available":"Optional · not generated"}</p></div>
        </div>
        {preview&&<details className="rounded-control border border-border p-3">
          <summary className="cursor-pointer font-medium">Review all scene narration ({preview.job.beats.length})</summary>
          <ol className="mt-3 space-y-2">{preview.job.beats.map((beat,i)=><li key={beat.id} className="rounded-control bg-surface-subtle p-3">
            <p className="text-xs text-muted-foreground">Scene {i+1}</p><p className="font-semibold">{beat.visual.headline}</p>
            <p className="mt-1 text-xs">{beat.narration}</p></li>)}</ol>
        </details>}
        <div className="rounded-control border border-border bg-surface-subtle p-3">
          <p className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4"/>Publication still needs human review</p>
          <p className="mt-2 text-xs text-muted-foreground">The draft is test-only. Check factual claims, media attribution/licensing and the narrator's commercial-use rights independently.</p>
          {preview?.warnings?.length?<ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {preview.warnings.map((warning,i)=><li key={i}>{warning}</li>)}
          </ul>:null}
        </div>
        <div className="space-y-3 rounded-control border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Local production readiness</p>
            <p className="text-xs text-muted-foreground">Checks FFmpeg, Chromium, voice permissions and approved sound assets.</p></div>
            <Button variant="outline" disabled={!!working||state.state==="rendering"} onClick={()=>void check()}>
              <RefreshCw className="mr-2 size-4"/>{working==="check"?"Checking…":"Check readiness"}
            </Button></div>
          {state.report&&<div className="space-y-2 rounded-control bg-surface-subtle p-3">
            <p className="flex items-center gap-2 font-medium">{ready?<CheckCircle2 className="size-4"/>:<AlertCircle className="size-4"/>}
              {ready?"Local tools ready for a test render":"Resolve these issues"}</p>
            {state.report.findings.map((f,i)=><p key={i} className="text-xs text-muted-foreground">{f.severity}: {f.message}</p>)}
            {sfxSummary&&<p className="text-xs text-muted-foreground">Reviewed sound choices: {sfxSummary.approved??0} selected, {sfxSummary.extraLayers??0} extra layers, {sfxSummary.muted??0} muted.</p>}
          </div>}
          <Button disabled={!ready||!!working||state.state==="rendering"} onClick={()=>void navigate("export")}>Continue to export <ArrowRight className="ml-2 size-4"/></Button>
        </div>
        <Button variant="outline" onClick={()=>void navigate("narration")}><ArrowLeft className="mr-2 size-4"/>Narration</Button>
      </>}
      {stage==="export"&&<>
        <div className="space-y-1"><h3 className="text-base font-semibold">Render and watch your video</h3>
          <p className="text-muted-foreground">The MP4 uses the verified export pipeline with the selected narrator and reviewed sounds. Rendering may take several minutes.</p></div>
        {!ready&&state.state!=="rendering"&&<div className="rounded-control border border-border bg-surface-subtle p-3">
          <p className="font-medium">A fresh readiness check is required</p>
          <p className="mt-1 text-xs text-muted-foreground">Changed scene, sound or voice settings need a new check before another render.</p>
          <div className="mt-3"><Button size="sm" variant="outline" onClick={()=>void navigate("review")}>Go to final review</Button></div>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready||!!working||state.state==="rendering"} onClick={()=>void start()}>
            <Film className="mr-2 size-4"/>Render test MP4
          </Button>
          {state.state==="rendering"&&<Button variant="outline" onClick={()=>void cancel()}><Square className="mr-2 size-4"/>Cancel render</Button>}
        </div>
        {(state.state==="rendering"||state.state==="failed"||state.state==="done"||state.state==="cancelled")&&<div className="rounded-control border border-border p-3" role="status">
          <p className="font-medium">{state.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">{state.phase} {pct!==null?"· "+pct+"% frames complete":""}</p>
          {pct!==null&&<progress aria-label="Render progress" className="mt-3 h-2 w-full" max={100} value={pct}/>}
        </div>}
        {state.state==="done"&&state.mediaUrl&&<div className="space-y-3 rounded-control border border-border p-3">
          <p className="font-semibold">Your test video is ready — watch it before publishing</p>
          <video key={state.mediaUrl} src={state.mediaUrl} controls playsInline className="aspect-video w-full rounded-control bg-black" aria-label="Rendered ContentGen draft video"/>
          <a className="inline-flex items-center rounded-control border border-border px-3 py-2 font-medium underline" href={state.mediaUrl} download="contentgen-draft.mp4">Download MP4</a>
          {state.regeneration&&<p className="text-xs text-muted-foreground">Reused {state.regeneration.reusedSpeechBeatIds?.length??0} prior speech beats and {state.regeneration.reusedVideoSegments??0} verified video segments.</p>}
        </div>}
        <p className="text-xs text-muted-foreground">Rendering never publishes a video or automatically certifies facts, licensing or voice rights. The exported draft may use general diagrams where custom animations aren't yet supported.</p>
      </>}
      </section>
      {working==="plan"&&<p role="status" className="text-xs text-muted-foreground">Preparing the scene and narration plan…</p>}
      {notice&&<p role="alert" className="rounded-control border border-border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
    </div>
    </Surface>
  </div>;
}


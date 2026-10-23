import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Film, Play, RefreshCw, ShieldAlert, Square, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { LiveRendererPreview, type LiveVisualPreviewData } from "./live-renderer-preview";

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
export function ProductionPanel({dossier,bundle,selectedShotId,onSelectShot}:{dossier:Dossier;bundle:Bundle;selectedShotId?:string;onSelectShot?:(shotId:string)=>void}){
  const [settings,setSettings]=useState<Settings>(defaults);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [actualPreview,setActualPreview]=useState<LiveVisualPreviewData|null>(null);
  const [animaticUrl,setAnimaticUrl]=useState("");
  const [ready,setReady]=useState(false);
  const [working,setWorking]=useState("");
  const [notice,setNotice]=useState("");
  const [state,setState]=useState<Status>({state:"idle",phase:"idle",message:""});
  const change=(patch:Partial<Settings>)=>{setSettings(x=>({...x,...patch}));setReady(false);};
  const payload={dossier,bundle};
  async function prepare(){
    setWorking("plan");setNotice("");setReady(false);setAnimaticUrl("");
    try{setPreview(await request("plan",payload) as unknown as Preview);}
    catch(error){setPreview(null);setNotice(error instanceof Error?error.message:"Cannot compile renderable video.");}
    finally{setWorking("");}
  }
  async function showActual(){
    setWorking("real-preview");setNotice("");setReady(false);
    try{
      const result=await request("live-preview",payload) as unknown as LiveVisualPreviewData;
      if(result.kind!=="live-renderer-preview/v1"||result.sourcePlanSha256.length!==64)
        throw Error("Actual visual preview returned an invalid contract.");
      setActualPreview(result);
    }catch(error){
      setActualPreview(null);
      setNotice(error instanceof Error?error.message:"Actual scene preview failed.");
    }finally{setWorking("");}
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
  async function check(){
    setWorking("check");setNotice("");setReady(false);
    try{
      const response=await request("check",{...payload,settings});
      const report=response.report as Report;
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
      const r=await request("start",{...payload,settings,confirmRender:true});
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
  return <Surface header={<h2 className="flex items-center gap-2 font-medium"><Film className="size-4"/>5 · Preview and render a real video</h2>}>
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">No JSON editing or terminal rendering required. Review the translated scenes, preview the rough cut, then use a voice you are authorized to synthesize. All outputs are unverified drafts.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!!working||state.state==="rendering"}
          onClick={()=>void showActual()}><Play className="mr-2 size-4"/>
          {working==="real-preview"?"Preparing real scene…":"Preview actual rendered scenes"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!working||state.state==="rendering"} onClick={()=>void prepare()}>
          <WandSparkles className="mr-2 size-4"/> Review renderable scenes
        </Button>
        {preview&&<Button size="sm" variant="outline" disabled={!!working||state.state==="rendering"} onClick={()=>void animatic()}>
          <Play className="mr-2 size-4"/> Preview animated rough cut
        </Button>}
        {animaticUrl&&<a target="_blank" rel="noopener noreferrer" href={animaticUrl}
          className="inline-flex items-center rounded-control border border-border px-3 py-2 text-sm font-medium underline">
          Open rough cut
        </a>}
      </div>
      {actualPreview&&<div className="space-y-2 rounded-control border border-border p-3">
        <LiveRendererPreview key={actualPreview.renderPlanSha256+":"+selectedShotId}
          preview={actualPreview} selectedShotId={selectedShotId} onSelectShot={onSelectShot}/>
      </div>}
      {preview&&<>
        <div className="rounded-control border border-border bg-surface-subtle p-3">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">Renderable storyboard · {preview.job.beats.length} scenes</p>
          <div className="grid gap-2 md:grid-cols-2">
            {preview.job.beats.map((beat,i)=><div key={beat.id} className="rounded-control border border-border bg-surface p-3">
              <p className="text-xs text-muted-foreground">SCENE {i+1} · {preview.shotMap[i]?.shotId}</p>
              <p className="mt-1 font-semibold">{beat.visual.headline}</p>
              <p className="mt-1 text-xs text-muted-foreground">{beat.visual.subhead}</p>
              <p className="mt-2 text-xs leading-relaxed">{beat.narration}</p>
            </div>)}
          </div>
        </div>
        <div className="rounded-control border border-border p-3">
          <p className="flex items-center gap-2 text-xs font-semibold"><ShieldAlert className="size-4"/> Visual fidelity & rights limitations</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {preview.warnings.map((warning,i)=><li key={i}>{warning}</li>)}
          </ul>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={inputLabel}>Voice provider
            <select className={field} aria-label="Production voice provider" value={settings.provider}
              onChange={e=>change({provider:e.target.value as "local"|"fish",localVoiceAuthorized:false,voiceConsent:false,transmitText:false})}>
              <option value="local">Local TTS (recommended)</option><option value="fish">Fish Audio (free-model ID only)</option>
            </select>
          </label>
          <label className={inputLabel}>Authorized voice ID<input className={field} aria-label="Production voice ID"
            value={settings.voiceId} onChange={e=>change({voiceId:e.target.value})}
            placeholder="Your licensed voice identifier"/></label>
          <label className={inputLabel}>Provider / engine revision<input className={field} aria-label="Production engine revision"
            value={settings.providerRevision} onChange={e=>change({providerRevision:e.target.value})}
            placeholder="Pinned version for correct audio caching"/></label>
          {settings.provider==="local"?<>
            <label className={inputLabel}>Installed local TTS model<input className={field} aria-label="Installed TTS model"
              value={settings.modelId} onChange={e=>change({modelId:e.target.value})}
              placeholder="Your installed local TTS model"/></label>
            <label className={inputLabel}>Local speech server URL<input className={field} aria-label="Local speech server URL"
              value={settings.endpoint} onChange={e=>change({endpoint:e.target.value})}/></label>
          </>:<label className={inputLabel}>Fish Audio API key<input type="password" autoComplete="off" className={field}
            aria-label="Fish Audio key" value={settings.apiKey} onChange={e=>change({apiKey:e.target.value})}
            placeholder="Only sent to local render process"/></label>}
        </div>
        {settings.provider==="local"?<label className="flex items-center gap-2 text-xs">
          <input type="checkbox" aria-label="I am authorized to synthesize this local voice"
            checked={settings.localVoiceAuthorized} onChange={e=>change({localVoiceAuthorized:e.target.checked})}/>
          I am authorized to synthesize this local voice.
        </label>:<div className="space-y-2 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={settings.voiceConsent}
            onChange={e=>change({voiceConsent:e.target.checked})}/> I have permission to use this Fish voice.</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={settings.transmitText}
            onChange={e=>change({transmitText:e.target.checked})}/> I approve sending script text to Fish Audio.</label>
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!!working||state.state==="rendering"} onClick={()=>void check()}>
            <RefreshCw className="mr-2 size-4"/>{working==="check"?"Checking tools…":"Check readiness"}
          </Button>
          <Button disabled={!ready||!!working||state.state==="rendering"} onClick={()=>void start()}>
            <Film className="mr-2 size-4"/> Render unverified draft MP4
          </Button>
          {state.state==="rendering"&&<Button variant="outline" onClick={()=>void cancel()}>
            <Square className="mr-2 size-4"/> Cancel render
          </Button>}
        </div>
        {state.report&&<div className="space-y-2 rounded-control border border-border p-3">
          <p className="flex items-center gap-2 font-medium">
            {state.report.ready?<CheckCircle2 className="size-4"/>:<AlertCircle className="size-4"/>}
            {state.report.ready?"Local media tools ready":"Readiness findings"}</p>
          {state.report.findings.map((f,i)=><p key={i} className="text-xs text-muted-foreground">{f.severity}: {f.message}</p>)}
        </div>}
        {(state.state==="rendering"||state.state==="failed"||state.state==="done"||state.state==="cancelled")&&
          <div className="rounded-control border border-border p-3" role="status">
            <p className="font-medium">{state.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">{state.phase} {pct!==null?"· "+pct+"% verified frames":""}</p>
            {pct!==null&&<progress className="mt-3 h-2 w-full" max={100} value={pct}/>}
          </div>}
        {state.state==="done"&&state.mediaUrl&&<div className="space-y-2 rounded-control border border-border p-3">
          <p className="font-medium">New draft video · inspect before publishing</p>
          <video key={state.mediaUrl} src={state.mediaUrl} controls playsInline className="aspect-video w-full rounded-control bg-black"
            aria-label="Rendered ContentGen draft video"/>
          <a className="text-sm underline" href={state.mediaUrl} download="contentgen-draft.mp4">Download draft MP4</a>
          {state.regeneration&&<p className="text-xs text-muted-foreground">Reused {state.regeneration.reusedSpeechBeatIds?.length??0} prior speech beats and {state.regeneration.reusedVideoSegments??0} verified video segments.</p>}
        </div>}
      </>}
      {notice&&<p role="status" className="rounded-control border border-border px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
      <p className="text-xs text-muted-foreground">The actual visual preview uses the same scene component as MP4 capture, but has no voice audio and estimates scene durations. The current export uses general Kumiki diagrams, not every planned custom animation. It never publishes videos, installs models, or certifies sources/rights. The initial render may be slow; compatible subsequent edits reuse verified narration and video chunks.</p>
    </div>
  </Surface>;
}

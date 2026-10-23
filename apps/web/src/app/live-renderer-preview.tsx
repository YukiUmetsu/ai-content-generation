import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { DEFAULT_SCENE_MOTION, type SceneMotion } from "../../scripts/video-production/scene-motion.mjs";

const RendererScene=lazy(()=>import("./live-renderer-scene"));
export type LiveVisualPreviewData={
  schemaVersion:1;kind:"live-renderer-preview/v1";plan:GeneralVisualPlan;
  shotMap:Array<{shotId:string;beatId:string;startFrame:number;endFrame:number;visualAction:string}>;
  sourcePlanSha256:string;renderPlanSha256:string;
  timing:{basis:"estimated-text-only";spokenWpm:number;measuredNarration:false;note:string};
  visualLimits:string[];
};
const humanTime=(frame:number,fps:number)=>{
  const seconds=frame/fps;
  return Math.floor(seconds/60).toString().padStart(2,"0")+":"+Math.floor(seconds%60).toString().padStart(2,"0");
};
export function LiveRendererPreview({
  preview,selectedShotId,onSelectShot,onSaveMotion
}:{
  preview:LiveVisualPreviewData;selectedShotId?:string;onSelectShot?:(shotId:string)=>void;
  onSaveMotion?:(shotId:string,motion:SceneMotion)=>Promise<void>;
}){
  const {plan,shotMap}=preview;
  const total=plan.manifest.durationFrames;
  const rate=plan.manifest.fps.num/plan.manifest.fps.den;
  const maxFrame=Math.max(0,total-1);
  const clampFrame=(value:number)=>Number.isFinite(value)
    ?Math.max(0,Math.min(maxFrame,Math.round(value))):0;
  const initial=clampFrame(shotMap.find(s=>s.shotId===selectedShotId)?.startFrame??0);
  const [frame,setFrame]=useState(initial);
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(1);
  const [drafts,setDrafts]=useState<Record<string,SceneMotion>>({});
  const [saving,setSaving]=useState(false);
  const [feedback,setFeedback]=useState("");

  const frameRef=useRef(initial);
  function seek(next:number){
    const valid=clampFrame(next);
    frameRef.current=valid;setFrame(valid);
  }
  useEffect(()=>{
    if(!playing)return;
    let request=0;
    let startTimestamp:number|null=null;
    const from=frameRef.current;
    const tick=(now:number)=>{
      // RAF timestamps may describe the start of the previous frame and can
      // predate a useEffect/performance.now() call. Use one clock exclusively.
      if(startTimestamp===null)startTimestamp=now;
      const elapsed=Math.max(0,now-startTimestamp);
      const advance=Math.floor(elapsed*rate*speed/1000);
      const target=Number.isFinite(advance)
        ?Math.max(0,Math.min(total-1,from+advance)):0;
      if(target!==frameRef.current){frameRef.current=target;setFrame(target);}
      if(target>=total-1){setPlaying(false);return;}
      // A single callback only advances one frame: schedule the NEXT callback
      // until paused or the very last valid frame is reached.
      request=requestAnimationFrame(tick);
    };
    request=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(request);
  },[playing,rate,speed,total]);
  // Never send an invalid frame to the shared Chromium export component, even
  // if a stale seek is observed during a recompiled preview render.
  const displayFrame=clampFrame(frame);
  const chapterIndex=plan.chapters.findIndex(c=>displayFrame>=c.startFrame&&displayFrame<c.endFrame);
  const active=Math.max(0,chapterIndex);
  const chapter=plan.chapters[active];
  const shot=shotMap[active];
  const savedMotion=chapter.visual.motion??DEFAULT_SCENE_MOTION;
  const motionDraft=drafts[shot.shotId]??savedMotion;
  const dirty=JSON.stringify(motionDraft)!==JSON.stringify(savedMotion);
  const livePlan:GeneralVisualPlan=Object.keys(drafts).length
    ?{...plan,chapters:plan.chapters.map((item,index)=>drafts[shotMap[index].shotId]
      ?{...item,visual:{...item.visual,motion:drafts[shotMap[index].shotId]}}
      :item)}:plan;
  function changeMotion(patch:Partial<SceneMotion>){
    setPlaying(false);setFeedback("");
    setDrafts(current=>({...current,[shot.shotId]:{...motionDraft,...patch}}));
  }
  async function saveMotion(){
    if(!onSaveMotion||!dirty)return;
    setSaving(true);setPlaying(false);setFeedback("");
    try{
      await onSaveMotion(shot.shotId,motionDraft);
      setDrafts(current=>{const next={...current};delete next[shot.shotId];return next;});
      setFeedback("Scene motion saved to your project. This setting also applies to the next MP4.");
    }catch(error){setFeedback(error instanceof Error?error.message:"Could not save scene motion.");}
    finally{setSaving(false);}
  }
  const seekShot=(i:number)=>{
    const index=Math.max(0,Math.min(plan.chapters.length-1,i));
    setPlaying(false);seek(plan.chapters[index].startFrame);
  };
  return <section aria-label="Actual renderer preview" className="space-y-3" data-contentgen-visual-preview="">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm font-semibold">Actual Kumiki-backed visual preview</p>
        <p className="text-xs text-muted-foreground">Same scene component as MP4 export · estimated timing · silent</p>
      </div>
      <p className="text-xs text-muted-foreground">{humanTime(displayFrame,rate)} / {humanTime(total,rate)} · {rate.toFixed(0)} fps</p>
    </div>
    <Suspense fallback={<div role="status" className="aspect-video rounded-control bg-surface-subtle p-4 text-sm">
      Loading the actual scene renderer…
    </div>}>
      <RendererScene plan={livePlan} frame={displayFrame}/>
    </Suspense>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" aria-label={playing?"Pause visual preview":"Play visual preview"}
        onClick={()=>{if(!playing&&frameRef.current>=total-1)seek(0);setPlaying(v=>!v);}}>
        {playing?<Pause className="size-4"/>:<Play className="size-4"/>}
        {playing?"Pause":"Play"}
      </Button>
      <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        <span>Scrub video · frame {displayFrame}</span>
        <input aria-label="Scrub actual renderer frames" className="w-full accent-primary"
          type="range" min={0} max={total-1} step={1} value={displayFrame}
          onChange={e=>{setPlaying(false);seek(Number(e.target.value));}}/>
      </label>
      <label className="text-xs font-medium text-muted-foreground">Speed
        <select aria-label="Visual preview speed" className="ml-2 rounded-control border border-input bg-surface px-2 py-1 text-xs"
          value={speed} onChange={e=>setSpeed(Number(e.target.value))}>
          <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option>
        </select>
      </label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" icon={<ChevronLeft className="size-3"/>} disabled={active===0}
        onClick={()=>seekShot(active-1)}>Previous shot</Button>
      <Button variant="outline" size="sm" icon={<ChevronRight className="size-3"/>}
        disabled={active===plan.chapters.length-1} onClick={()=>seekShot(active+1)}>Next shot</Button>
      <Button variant="outline" size="sm" icon={<RotateCcw className="size-3"/>}
        onClick={()=>{setPlaying(false);seek(chapter.startFrame);}}>Restart shot</Button>
      <Button variant="outline" size="sm" onClick={()=>{setPlaying(false);seek(chapter.endFrame-1);}}>
        Inspect end of shot
      </Button>
    </div>
    <div className="space-y-2">
      <p className="text-xs font-semibold">Scene timeline · choose a segment to inspect</p>
      <div className="flex w-full gap-1 overflow-x-auto pb-2" role="group" aria-label="Video scene timeline">
        {shotMap.map((item,index)=><button key={item.shotId} type="button"
          aria-label={`Timeline shot ${index+1}: ${plan.chapters[index].visual.headline}`}
          aria-pressed={index===active}
          style={{flexGrow:plan.chapters[index].endFrame-plan.chapters[index].startFrame}}
          className={`min-w-24 rounded-control border px-2 py-3 text-left text-xs transition-colors ${index===active
            ?"border-primary bg-primary/10 text-foreground":"border-border bg-surface text-muted-foreground hover:bg-surface-subtle"}`}
          onClick={()=>seekShot(index)}>
          <span className="block font-semibold">{index+1} · {plan.chapters[index].intent.replace("general-","")}</span>
          <span className="mt-1 block truncate">{plan.chapters[index].visual.headline}</span>
        </button>)}
      </div>
    </div>
    <div className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
      <div>
        <p className="text-sm font-semibold">Scene motion · shot {active+1}</p>
        <p className="mt-1 text-xs text-muted-foreground">Adjust these controls while watching the actual exporter scene. Changes are previews until you save.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">Reveal start · {motionDraft.revealDelayPercent}% into the scene
          <input aria-label="Reveal start percent" className="accent-primary" type="range" min={0} max={30} step={5}
            value={motionDraft.revealDelayPercent} onChange={e=>changeMotion({revealDelayPercent:Number(e.target.value)})}/>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Reveal pace
          <select aria-label="Reveal pacing" className="rounded-control border border-input bg-surface px-2 py-2 text-xs"
            value={motionDraft.revealPace} onChange={e=>changeMotion({revealPace:e.target.value as SceneMotion["revealPace"]})}>
            <option value="snappy">Snappy · faster disclosures</option>
            <option value="balanced">Balanced</option>
            <option value="deliberate">Deliberate · spaced out</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Camera motion
          <select aria-label="Camera movement" className="rounded-control border border-input bg-surface px-2 py-2 text-xs"
            value={motionDraft.camera} onChange={e=>changeMotion({camera:e.target.value as SceneMotion["camera"]})}>
            <option value="locked">Locked · no camera movement</option>
            <option value="subtle">Subtle drift</option>
            <option value="cinematic">Cinematic drift</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Scene entry
          <select aria-label="Scene transition" className="rounded-control border border-input bg-surface px-2 py-2 text-xs"
            value={motionDraft.transition} onChange={e=>changeMotion({transition:e.target.value as SceneMotion["transition"]})}>
            <option value="cut">Cut · immediate</option>
            <option value="fade">Fade in from dark</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!dirty||saving||!onSaveMotion} onClick={()=>void saveMotion()}>
          {saving?"Saving motion…":"Save motion to project"}
        </Button>
        <Button size="sm" variant="outline" disabled={!drafts[shot.shotId]||saving}
          onClick={()=>{setDrafts(x=>{const next={...x};delete next[shot.shotId];return next;});setFeedback("");}}>
          Discard unsaved changes
        </Button>
        <Button size="sm" variant="outline" disabled={saving}
          onClick={()=>changeMotion({...DEFAULT_SCENE_MOTION})}>Restore default motion</Button>
        {dirty&&<span role="status" className="text-xs text-muted-foreground">Unsaved · only this preview is changed</span>}
      </div>
      {feedback&&<p role="status" className="text-xs text-muted-foreground">{feedback}</p>}
      <p className="text-xs text-muted-foreground">Reveal timing is relative to scene duration. The payoff cannot appear before its event. Fade means fade-in from dark, not a crossfade between shots. Voice timing is still estimated here.</p>
    </div>
    <label className="block text-xs font-medium text-muted-foreground">
      Select a rendered shot to inspect or edit
      <select aria-label="Select rendered scene" className="mt-1 block w-full rounded-control border border-input bg-surface px-3 py-2 text-sm"
        value={active} onChange={e=>seekShot(Number(e.target.value))}>
        {shotMap.map((item,index)=><option key={item.shotId} value={index}>
          {String(index+1).padStart(2,"0")} · {plan.chapters[index].visual.headline}
        </option>)}
      </select>
    </label>
    <div className="rounded-control border border-border bg-surface-subtle p-3 text-xs leading-relaxed">
      <p className="font-semibold">Shot {active+1} · {chapter.intent} · {shot?.shotId}</p>
      <p className="mt-1 text-muted-foreground">Directed action: {shot?.visualAction}</p>
      <p className="mt-2 text-muted-foreground">
        {preview.timing.note} Editing a scene requires applying changes in Video Director,
        then refreshing this visual preview. Source claims and final rights approval remain separate.
      </p>
      {onSelectShot&&<Button size="sm" variant="outline" onClick={()=>onSelectShot(shot.shotId)}>
        Edit this shot in Video Director
      </Button>}
    </div>
  </section>;
}

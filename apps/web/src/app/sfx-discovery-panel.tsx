import {useEffect,useState,type KeyboardEvent} from "react";
import {AudioLines,CheckCircle2,ExternalLink,Headphones,Layers3,LibraryBig,Search,ShieldCheck,Volume2,VolumeX} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Surface} from "@/components/ui/surface-card";
import {SoundAuditionControls} from "./sound-audition-controls";

type Bundle={plan:{shots:Array<{id:string;purpose?:string;family?:string;sceneRecipe?:string;subjectIds?:string[]}>;
  sound?:Array<{shotId:string;sfxIntent:string|null}>;
  teachingSequences?:Array<{technicalSubjectId?:string;visualStates?:unknown;visualMechanic?:unknown;
    phases:Array<{shotId:string;kind:string}>}>}};
type Candidate={provider:"openverse";assetId:string;title:string;creator:string;durationSeconds:number;
  sourceUrl:string;previewUrl:string;license:"cc0";licenseUrl:string;source:string;matchCount:number;
  rightsStatus:"needs-human-review";assetType:"sfx"|"music";tags:string[]};
type SearchResult={scenes:Array<{shotId:string;intent:string;query:string;candidates:Candidate[]}>;warnings:string[]};
type Approved={assetId:string;title:string;creator:string;sha256:string;license:"cc0";assetType?:"sfx"|"music";
  sourceUrl:string;rightsStatus:"user-reviewed";localPath:string;durationSeconds:number};
type Choice={shotId:string;mode:"auto"|"pin"|"mute";assetId:string|null;title:string|null;
  sha256:string|null;localPath:string|null;reason:string;
  trigger:"shot-start"|"first-visual-reveal"};
type Trigger="shot-start"|"first-visual-reveal";
type SoundMix={gainDb:number;fadeInMs:number;fadeOutMs:number};
type SoundLayer=SoundMix&{layerId:string;shotId:string;assetId:string;sha256:string;
  title:string;trigger:Trigger;offsetMs:number};
type SoundAmbience=SoundMix&{assetId:string;sha256:string;title:string};
type SoundDesign={layers:SoundLayer[];ambience:SoundAmbience|null};
const emptyDesign:SoundDesign={layers:[],ambience:null};
type CueDraft=SoundMix&{assetId:string;trigger:Trigger;offsetMs:number};

function SupplementaryLayerRow({layer,busy,unsupportedReveal,onSave,onRemove}:{layer:SoundLayer;busy:boolean;
  unsupportedReveal:boolean;onSave:(layer:SoundLayer)=>Promise<void>;onRemove:(layerId:string)=>Promise<void>}){
  const [draft,setDraft]=useState({trigger:layer.trigger,offsetMs:layer.offsetMs,gainDb:layer.gainDb,
    fadeInMs:layer.fadeInMs,fadeOutMs:layer.fadeOutMs});
  const change=(values:Partial<typeof draft>)=>setDraft(current=>({...current,...values}));
  return <div className="rounded-control border border-border p-3 space-y-2">
    <p className="text-xs font-medium">{layer.title} · {layer.shotId}</p>
    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <label>Timing<select className="mt-1 w-full rounded-control border border-border bg-surface p-2"
        value={draft.trigger} disabled={busy} onChange={e=>change({trigger:e.target.value as Trigger})}>
        <option value="shot-start">Shot start</option>
        <option value="first-visual-reveal" disabled={unsupportedReveal}>First element reveal</option>
      </select></label>
      <label>Offset (ms)<input className="mt-1 w-full rounded-control border border-border bg-surface p-2"
        type="number" min="0" max="10000" step="10" disabled={busy} value={draft.offsetMs}
        onChange={e=>change({offsetMs:Number(e.target.value)})}/></label>
      <label>Gain (dB)<input className="mt-1 w-full rounded-control border border-border bg-surface p-2"
        type="number" min="-48" max="0" step="1" disabled={busy} value={draft.gainDb}
        onChange={e=>change({gainDb:Number(e.target.value)})}/></label>
      <label>Fade in/out (ms)<span className="mt-1 flex gap-1">
        <input aria-label={`Fade in ${layer.layerId}`} className="w-1/2 min-w-0 rounded-control border border-border bg-surface p-2"
          type="number" min="0" max="2000" step="10" disabled={busy} value={draft.fadeInMs}
          onChange={e=>change({fadeInMs:Number(e.target.value)})}/>
        <input aria-label={`Fade out ${layer.layerId}`} className="w-1/2 min-w-0 rounded-control border border-border bg-surface p-2"
          type="number" min="0" max="2000" step="10" disabled={busy} value={draft.fadeOutMs}
          onChange={e=>change({fadeOutMs:Number(e.target.value)})}/>
      </span></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>void onSave({...layer,...draft})}>Save cue</Button>
      <Button size="sm" variant="subtle" disabled={busy} onClick={()=>void onRemove(layer.layerId)}>Remove cue</Button>
    </div>
  </div>;
}

async function localSfx(path:string,body?:unknown){
  const response=await fetch("/api/contentgen-sfx/"+path,{method:body===undefined?"GET":"POST",
    cache:"no-store",...(body===undefined?{}:{headers:{"Content-Type":"application/json",
      "X-Contentgen-Director":"local-only"},body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(body===undefined?12000:90000)});
  const result=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(result.error??"Local sound library unavailable."));
  return result;
}

/** Sound search is an explicit opt-in; imported sounds are shareable across projects. */
export function SfxDiscoveryPanel({projectId,bundle,selectedShotId,onSelectShot}:{projectId:string;bundle:Bundle;
  selectedShotId:string;onSelectShot?:(shotId:string)=>void}){
  const [search,setSearch]=useState<{bundle:Bundle;data:SearchResult}|null>(null);
  const [musicQuery,setMusicQuery]=useState("gentle instrumental ambient");
  const [musicResults,setMusicResults]=useState<Candidate[]>([]);
  const [library,setLibrary]=useState<Approved[]>([]);
  const [choices,setChoices]=useState<Choice[]>([]);
  const [design,setDesign]=useState<SoundDesign>(emptyDesign);
  const [cueDraft,setCueDraft]=useState<CueDraft>({assetId:"",trigger:"shot-start",offsetMs:0,
    gainDb:-24,fadeInMs:0,fadeOutMs:120});
  const [ambientDraft,setAmbientDraft]=useState({assetId:"",gainDb:-33,fadeInMs:1000,fadeOutMs:1500});
  const [pending,setPending]=useState<{shotId:string;asset:Candidate}|null>(null);
  const [acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("");
  const [view,setView]=useState<"arrange"|"library">("arrange");
  const [libraryQuery,setLibraryQuery]=useState("");
  const scene=search?.bundle===bundle?search.data.scenes.find(x=>x.shotId===selectedShotId):undefined;
  const planned=bundle.plan.sound?.find(x=>x.shotId===selectedShotId)?.sfxIntent?.trim()??"";
  const selectedShot=bundle.plan.shots.find(x=>x.id===selectedShotId);
  const visualSequence=bundle.plan.teachingSequences?.find(seq=>seq.phases.some(phase=>
    phase.shotId===selectedShotId&&["problem","mechanism","payoff"].includes(phase.kind)&&
    typeof seq.technicalSubjectId==="string"&&!!selectedShot?.subjectIds?.includes(seq.technicalSubjectId)&&
    (seq.visualStates||seq.visualMechanic)));
  const unsupportedReveal=Boolean(selectedShot?.sceneRecipe||
    ["question","process","mechanism","summary"].includes(selectedShot?.family??"")||visualSequence);
  const choice=choices.find(x=>x.shotId===selectedShotId);
  const review=pending?.shotId===selectedShotId?pending.asset:null;
  const shotLayers=design.layers.filter(layer=>layer.shotId===selectedShotId);
  const listed=library.filter(asset=>`${asset.title} ${asset.creator}`.toLowerCase().includes(libraryQuery.toLowerCase()));

  function tabKey(event:KeyboardEvent<HTMLButtonElement>){
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();
    const target=event.key==="Home"?"arrange":event.key==="End"?"library":
      view==="arrange"?"library":"arrange";
    setView(target);
    document.getElementById(`sound-tab-${target}`)?.focus();
  }

  function showDesign(raw:unknown){
    const value=raw as Partial<SoundDesign>|null;
    const resolved={layers:Array.isArray(value?.layers)?value.layers:[],ambience:value?.ambience??null};
    setDesign(resolved);
    setAmbientDraft({assetId:resolved.ambience?.assetId??"",gainDb:resolved.ambience?.gainDb??-33,
      fadeInMs:resolved.ambience?.fadeInMs??1000,fadeOutMs:resolved.ambience?.fadeOutMs??1500});
  }
  useEffect(()=>{
    let active=true;
    void Promise.all([localSfx("library"),localSfx("choices",{projectId,bundle}),
      localSfx("sound-design",{action:"resolve",projectId,bundle})]).then(([bank,resolved,soundDesign])=>{
      if(active){setLibrary(bank.assets as Approved[]);setChoices(resolved.scenes as Choice[]);showDesign(soundDesign);}
    }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:"Could not load local sounds.");});
    return()=>{active=false;};
  },[projectId,bundle]);
  async function reload(){
    const [bank,resolved,soundDesign]=await Promise.all([localSfx("library"),localSfx("choices",{projectId,bundle}),
      localSfx("sound-design",{action:"resolve",projectId,bundle})]);
    setLibrary(bank.assets as Approved[]);setChoices(resolved.scenes as Choice[]);showDesign(soundDesign);
  }
  async function saveLayer(layer:CueDraft,layerId?:string):Promise<boolean>{
    const asset=library.find(x=>x.assetId===layer.assetId);
    if(!asset){setNotice("Choose a reviewed local sound first.");return false;}
    setBusy("design");setNotice("");
    try{await localSfx("sound-design",{action:"upsert",projectId,shotId:selectedShotId,
      ...(layerId?{layerId}:{}),assetId:asset.assetId,sha256:asset.sha256,
      trigger:layer.trigger,offsetMs:layer.offsetMs,gainDb:layer.gainDb,
      fadeInMs:layer.fadeInMs,fadeOutMs:layer.fadeOutMs});
      await reload();setNotice("Sound cue saved. Run Check again before rendering.");return true;
    }catch(error){setNotice(error instanceof Error?error.message:"Could not save the sound cue.");return false;}
    finally{setBusy("");}
  }
  async function removeLayer(layerId:string){
    setBusy("design");setNotice("");
    try{await localSfx("sound-design",{action:"remove",projectId,layerId});await reload();
      setNotice("Sound cue removed. Run Check again before rendering.");}
    catch(error){setNotice(error instanceof Error?error.message:"Could not remove the sound cue.");}
    finally{setBusy("");}
  }
  async function saveAmbience(disable=false,selected?:Approved){
    const asset=selected??library.find(x=>x.assetId===ambientDraft.assetId);
    if(!disable&&!asset){setNotice("Choose a reviewed ambience sound first.");return;}
    setBusy("design");setNotice("");
    try{await localSfx("sound-design",disable?{action:"ambience",projectId,assetId:null}:
      {action:"ambience",projectId,assetId:asset?.assetId,sha256:asset?.sha256,
        gainDb:ambientDraft.gainDb,fadeInMs:ambientDraft.fadeInMs,fadeOutMs:ambientDraft.fadeOutMs});
      await reload();setNotice(disable?"Ambience disabled.":"Ambience saved. Run Check again before rendering.");}
    catch(error){setNotice(error instanceof Error?error.message:"Could not save ambience.");}
    finally{setBusy("");}
  }
  async function discover(){
    setView("library");setBusy("search");setNotice("");setPending(null);
    try{
      const result=await localSfx("suggest",{bundle,allowExternalSearch:true});
      setSearch({bundle,data:result as unknown as SearchResult});
      setNotice("Only CC0 metadata was searched. Review the original page and license before the first download.");
    }catch(error){setNotice(error instanceof Error?error.message:"SFX search failed.");}
    finally{setBusy("");}
  }
  async function discoverMusic(){
    setView("library");setBusy("music");setNotice("");setPending(null);setMusicResults([]);
    try{
      const result=await localSfx("suggest-music",{query:musicQuery,allowExternalSearch:true}) as
        {candidates:Candidate[]};
      setMusicResults(Array.isArray(result.candidates)?result.candidates:[]);
      setNotice("Review each track's original source and CC0 rights before importing. No music was downloaded.");
    }catch(error){setNotice(error instanceof Error?error.message:"Music search failed. Try again.");}
    finally{setBusy("");}
  }
  async function approve(){
    if(!review||!acknowledged)return;
    setBusy("approve");setNotice("");
    try{
      await localSfx("approve",{assetId:review.assetId,assetType:review.assetType,confirmRights:true,confirmDownload:true});
      await reload();setPending(null);setAcknowledged(false);
      setNotice("Sound saved to your reviewed local library. It can now be reused automatically in matching shots.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not import sound.");}
    finally{setBusy("");}
  }
  async function choose(mode:"auto"|"mute"|"pin",asset?:Approved):Promise<boolean>{
    setBusy("choice");setNotice("");
    try{
      await localSfx("set-choice",{projectId,shotId:selectedShotId,mode,
        trigger:choice?.trigger??"shot-start",
        ...(mode==="pin"&&asset?{assetId:asset.assetId,sha256:asset.sha256}:{})});
      await reload();
      setNotice(mode==="mute"?"This sound cue is muted.":mode==="auto"?
        "Automatically use the best matching sound from your approved library, or silence if none matches.":
        "This sound is pinned to the selected shot.");
      return true;
    }catch(error){setNotice(error instanceof Error?error.message:"Could not change scene sound.");return false;}
    finally{setBusy("");}
  }
  async function chooseTrigger(trigger:"shot-start"|"first-visual-reveal"){
    setBusy("choice");setNotice("");
    try{
      const mode=choice?.mode??"auto";
      const pinned=mode==="pin"?library.find(x=>x.assetId===choice?.assetId&&x.sha256===choice?.sha256):null;
      if(mode==="pin"&&!pinned)throw Error("Pinned sound is no longer available. Choose another approved sound.");
      await localSfx("set-choice",{projectId,shotId:selectedShotId,mode,trigger,
        ...(pinned?{assetId:pinned.assetId,sha256:pinned.sha256}:{})});
      await reload();
      setNotice(trigger==="shot-start"?"Sound will start with this shot's narration beat.":
        "Sound will follow the first measured on-screen element reveal, if the scene supports it.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not save sound timing.");}
    finally{setBusy("");}
  }

  return <Surface header={<div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-control bg-primary/10 text-primary"><AudioLines className="size-5"/></div>
      <div><h2 className="text-base font-semibold">Sound Studio</h2>
        <p className="text-xs text-muted-foreground">Find, arrange and audition commercial-use reviewed audio.</p></div>
    </div>
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs text-muted-foreground">
      <ShieldCheck className="size-3.5 text-emerald-500"/>Local · CC0 reviewed sounds only
    </span>
  </div>}>
    <div className="space-y-5 text-sm">
      <section className="rounded-surface border border-border bg-surface-subtle p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">01 · Select</p>
            <p className="mt-1 font-medium">Choose your scene</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">02 · Arrange</p>
            <p className="mt-1 font-medium">Layer approved sounds</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">03 · Listen</p>
            <p className="mt-1 font-medium">Audition before export</p></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scene strip</h3>
          <p className="text-xs text-muted-foreground">{bundle.plan.shots.length} scenes · {design.layers.length} added cues · ambience {design.ambience?"on":"off"}</p>
        </div>
        <nav aria-label="Sound scene selector" className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
          {bundle.plan.shots.map((shot,i)=>{
            const active=shot.id===selectedShotId,added=design.layers.filter(x=>x.shotId===shot.id).length;
            const main=choices.find(x=>x.shotId===shot.id);
            return <button key={shot.id} type="button" disabled={!onSelectShot||!!busy}
              aria-label={`Select scene ${i+1}: ${shot.id}`} aria-current={active?"step":undefined}
              onClick={()=>onSelectShot?.(shot.id)}
              className={`group min-w-32 max-w-52 shrink-0 snap-start rounded-control border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active?
                "border-primary bg-primary/10 text-foreground":"border-border bg-surface hover:border-primary/40 disabled:opacity-70"}`}>
              <span className="block text-[11px] font-semibold tabular-nums text-muted-foreground">Scene {String(i+1).padStart(2,"0")}</span>
              <span className="mt-1 block truncate text-xs font-semibold" title={shot.purpose??shot.id}>{shot.purpose??shot.id}</span>
              <span className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className={`size-1.5 rounded-full ${main?.assetId?"bg-sky-500": "bg-muted-foreground/40"}`}/>
                {main?.assetId?"Main cue":"Quiet"}{added?` · +${added} layers`:""}
              </span>
            </button>;
          })}
        </nav>
      </section>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.9fr)]">
        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Sound Studio views" className="flex gap-1 rounded-control border border-border bg-surface-subtle p-1">
            <button type="button" id="sound-tab-arrange" role="tab" aria-controls="sound-panel-arrange"
              aria-selected={view==="arrange"} tabIndex={view==="arrange"?0:-1}
              onKeyDown={tabKey} onClick={()=>setView("arrange")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold transition-colors ${view==="arrange"?"bg-surface text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}>
              <Layers3 className="size-4"/>Arrange
            </button>
            <button type="button" id="sound-tab-library" role="tab" aria-controls="sound-panel-library"
              aria-selected={view==="library"} tabIndex={view==="library"?0:-1}
              onKeyDown={tabKey} onClick={()=>setView("library")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold transition-colors ${view==="library"?"bg-surface text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}>
              <LibraryBig className="size-4"/>Library <span className="rounded-full bg-primary/10 px-1.5 text-[11px] text-primary">{library.length}</span>
            </button>
          </div>

          {view==="arrange"&&<section id="sound-panel-arrange" role="tabpanel" aria-labelledby="sound-tab-arrange"
            aria-label="Scene sound arrangement" className="space-y-4 rounded-surface border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected scene</p>
                <h3 className="mt-1 font-semibold">{selectedShot?.purpose??selectedShotId}</h3></div>
              <Button variant="outline" size="sm" onClick={()=>setView("library")}><Search className="mr-1.5 size-3.5"/>Browse sounds</Button>
            </div>
            <div className="rounded-control border border-border bg-surface-subtle p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-semibold"><Volume2 className="size-4 text-primary"/>Main scene sound</p>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {choice?.mode==="mute"?"Muted":choice?.assetId?choice.mode==="pin"?"Pinned":"Automatic":"Silence"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{planned?
                <>Story sound intent: <strong className="font-medium text-foreground">{planned}</strong></>:
                "No planned effect for this shot. Auto selection stays silent; you can pin a sound or add a layer."}</p>
              {choice?.assetId&&<div className="mt-3 rounded-control border border-border bg-surface p-3">
                <p className="truncate text-xs font-semibold">{choice.title}</p>
                {choice.sha256&&<audio className="mt-2 w-full" controls preload="none"
                  src={`/api/contentgen-sfx/preview/${choice.sha256}`} aria-label={`Listen to selected sound ${choice.title??"effect"}`}/>}
              </div>}
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block text-xs font-medium">Sound timing
                  <select className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2"
                    aria-label="Sound timing" disabled={!!busy} value={choice?.trigger??"shot-start"}
                    onChange={e=>void chooseTrigger(e.target.value as Trigger)}>
                    <option value="shot-start">At narration shot start</option>
                    <option value="first-visual-reveal" disabled={unsupportedReveal}>At first visible element reveal</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void choose("auto")}>Auto-match</Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void choose("mute")}>
                    <VolumeX className="mr-1.5 size-3.5"/>Mute</Button>
                </div>
              </div>
              {unsupportedReveal&&<p className="mt-2 text-xs text-muted-foreground">This dynamic scene has no measured reveal marker; use shot-start timing.</p>}
            </div>

            <details className="space-y-3 rounded-control border border-border p-4">
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex items-center gap-2"><Layers3 className="size-4 text-primary"/>Additional sound cues · {shotLayers.length}</span>
                <span className="text-xs font-normal text-muted-foreground">{shotLayers.length}/4</span>
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Layer up to four approved sounds. Fine-tune their start time, volume and fades independently.</p>
              <div className="mt-3 space-y-3">{shotLayers.map(layer=><SupplementaryLayerRow
                key={[layer.layerId,layer.assetId,layer.sha256,layer.trigger,layer.offsetMs,layer.gainDb,layer.fadeInMs,layer.fadeOutMs].join(":")} layer={layer} busy={!!busy} unsupportedReveal={unsupportedReveal}
                onSave={next=>saveLayer(next,next.layerId).then(()=>{})} onRemove={removeLayer}/>)}</div>
              <div className="mt-3 grid gap-3 rounded-control bg-surface-subtle p-3 text-xs sm:grid-cols-2">
                <label className="sm:col-span-2">Additional cue asset
                  <select aria-label="Additional cue asset" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                    disabled={!!busy} value={cueDraft.assetId}
                    onChange={e=>setCueDraft(x=>({...x,assetId:e.target.value}))}>
                    <option value="">Select an approved sound</option>
                    {library.map(asset=><option key={asset.assetId+asset.sha256} value={asset.assetId}>{asset.title}</option>)}
                  </select></label>
                <label>Timing<select aria-label="Additional cue timing" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                  disabled={!!busy} value={cueDraft.trigger}
                  onChange={e=>setCueDraft(x=>({...x,trigger:e.target.value as Trigger}))}>
                  <option value="shot-start">Shot start</option>
                  <option value="first-visual-reveal" disabled={unsupportedReveal}>First element reveal</option>
                </select></label>
                <label>Offset (ms)<input aria-label="Additional cue offset (ms)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                  type="number" min="0" max="10000" step="10" disabled={!!busy} value={cueDraft.offsetMs}
                  onChange={e=>setCueDraft(x=>({...x,offsetMs:Number(e.target.value)}))}/></label>
                <label>Gain (dB)<input aria-label="Additional cue gain (dB)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                  type="number" min="-48" max="0" step="1" disabled={!!busy} value={cueDraft.gainDb}
                  onChange={e=>setCueDraft(x=>({...x,gainDb:Number(e.target.value)}))}/></label>
                <div className="grid grid-cols-2 gap-2">
                  <label>Fade in (ms)<input aria-label="Additional cue fade in (ms)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                    type="number" min="0" max="2000" step="10" disabled={!!busy} value={cueDraft.fadeInMs}
                    onChange={e=>setCueDraft(x=>({...x,fadeInMs:Number(e.target.value)}))}/></label>
                  <label>Fade out (ms)<input aria-label="Additional cue fade out (ms)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                    type="number" min="0" max="2000" step="10" disabled={!!busy} value={cueDraft.fadeOutMs}
                    onChange={e=>setCueDraft(x=>({...x,fadeOutMs:Number(e.target.value)}))}/></label>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={!!busy||!cueDraft.assetId||shotLayers.length>=4}
                  onClick={()=>void saveLayer(cueDraft)}>Add cue</Button>
                {library.length===0&&<span className="text-xs text-muted-foreground">Start by approving sounds in the Library tab.</span>}
              </div>
            </details>
          </section>}

          {view==="library"&&<section id="sound-panel-library" role="tabpanel" aria-labelledby="sound-tab-library"
            aria-label="Approved sound library" className="space-y-4 rounded-surface border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">Your sound library</h3>
                <p className="mt-1 text-xs text-muted-foreground">Approved sounds stay local and can be reused across projects.</p></div>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void discover()}>
                <Search className="mr-1.5 size-3.5"/>{busy==="search"?"Searching…":"Find CC0 sound effects"}</Button>
            </div>
            <form className="flex flex-wrap items-end gap-2 rounded-control border border-border bg-surface-subtle p-3"
              onSubmit={event=>{event.preventDefault();if(!busy)void discoverMusic();}}>
              <label className="min-w-40 flex-1 text-xs font-medium">Search CC0 music by mood or instrument
                <input type="search" aria-label="Music search" maxLength={90} value={musicQuery}
                  onChange={event=>setMusicQuery(event.target.value)}
                  placeholder="e.g. gentle piano, ambient strings" className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm"/>
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={!!busy||musicQuery.trim().length<3}>
                <Search className="mr-1.5 size-3.5"/>{busy==="music"?"Finding music…":"Find background music"}
              </Button>
            </form>
            <label className="block text-xs font-medium">Filter approved sounds
              <input className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm"
                type="search" aria-label="Filter approved sounds" placeholder="Search your local sounds…"
                value={libraryQuery} onChange={e=>setLibraryQuery(e.target.value)}/>
            </label>
            <div className="space-y-2">
              {listed.length===0&&<p className="rounded-control border border-dashed border-border bg-surface-subtle p-5 text-center text-xs leading-relaxed text-muted-foreground">
                {libraryQuery?"No approved sounds match your search.":"Your library is empty. Find a CC0 sound, review its original source and approve it once."}</p>}
              {listed.slice(0,80).map(asset=><div key={asset.assetId+asset.sha256}
                className="rounded-control border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-semibold">{asset.title}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <CheckCircle2 className="size-3 text-emerald-500"/>{asset.durationSeconds.toFixed(1)}s · reviewed CC0 · {asset.assetType==="music"?"music":"SFX"}</p></div>
                  <div className="flex flex-wrap gap-2">
                    {asset.assetType==="music"?<Button size="sm" variant="outline" disabled={!!busy}
                      onClick={()=>void saveAmbience(false,asset)}>Use as background</Button>:<>
                      <Button size="sm" variant="outline" disabled={!!busy}
                        onClick={()=>void choose("pin",asset).then(saved=>{if(saved)setView("arrange");})}>Use as main</Button>
                      <Button size="sm" disabled={!!busy||shotLayers.length>=4}
                        onClick={()=>void saveLayer({...cueDraft,assetId:asset.assetId}).then(saved=>{if(saved)setView("arrange");})}>Add to shot</Button>
                    </>}
                  </div>
                </div>
                <audio className="mt-2 w-full" controls preload="none"
                  src={`/api/contentgen-sfx/preview/${asset.sha256}`} aria-label={`Listen to ${asset.title}`}/>
              </div>)}
            </div>
            {scene&&<div className="space-y-3 border-t border-border pt-4">
              <div><h4 className="font-semibold">New CC0 candidates</h4>
                <p className="mt-1 text-xs text-muted-foreground">{scene.query} · {scene.candidates.length} candidate sounds · review rights before import</p></div>
              <div className="grid gap-3 md:grid-cols-2">
                {scene.candidates.map(asset=>{
                  const saved=library.find(x=>x.assetId===asset.assetId);
                  return <div key={asset.assetId} className="min-w-0 space-y-2 rounded-control border border-border p-3">
                    <p className="font-semibold">{asset.title}</p>
                    <p className="text-xs text-muted-foreground">{asset.durationSeconds.toFixed(1)}s · {asset.creator||asset.source||"Openverse"} · CC0 claim</p>
                    <audio className="w-full" src={saved?`/api/contentgen-sfx/preview/${saved.sha256}`:asset.previewUrl}
                      controls preload="none" aria-label={`Preview ${asset.title}`}/>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <a className="underline" href={asset.sourceUrl} target="_blank" rel="noopener noreferrer">Original source <ExternalLink className="inline size-3"/></a>
                      <a className="underline" href={asset.licenseUrl} target="_blank" rel="noopener noreferrer">CC0 license</a>
                    </div>
                    {saved?<span className="inline-flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 className="size-3"/>In local library</span>:
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{
                        setPending({shotId:selectedShotId,asset});setAcknowledged(false);}}>Review and import</Button>}
                  </div>;
                })}
              </div>
              {scene.candidates.length===0&&<p className="text-xs text-muted-foreground">No suitable CC0 sounds found. Try a more specific sound intent.</p>}
            </div>}
            {musicResults.length>0&&<section aria-label="Music candidates" className="space-y-3 border-t border-border pt-4">
              <h4 className="font-semibold">Music candidates · {musicResults.length}</h4>
              <div className="grid gap-3 md:grid-cols-2">{musicResults.map(asset=>{
                const saved=library.find(x=>x.assetId===asset.assetId&&x.assetType==="music");
                return <div key={asset.assetId} className="space-y-2 rounded-control border border-border p-3">
                  <p className="font-medium">{asset.title}</p>
                  <p className="text-xs text-muted-foreground">{asset.durationSeconds.toFixed(0)}s · {asset.creator||"Creator not listed"} · CC0 claim</p>
                  <audio controls preload="none" className="w-full" src={saved?`/api/contentgen-sfx/preview/${saved.sha256}`:asset.previewUrl}
                    aria-label={`Preview music ${asset.title}`}/>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Original source</a>
                    <a href={asset.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">CC0 license</a>
                  </div>
                  {saved?<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void saveAmbience(false,saved)}>Use as background</Button>:
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{
                      setPending({shotId:selectedShotId,asset});setAcknowledged(false);}}>Review and import</Button>}
                </div>;
              })}</div>
            </section>}
            {review&&<div className="space-y-3 rounded-control border border-primary/50 bg-primary/5 p-4">
              <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4"/>Review rights before import</p>
              <p>{review.title} · {review.creator||"Creator not listed"}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">Openverse lists third-party metadata; it cannot guarantee a sound is CC0. Open the original source, confirm its license and approve the download.</p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>
                I checked the original sound and its rights and approve this download.
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!acknowledged||!!busy} onClick={()=>void approve()}>{busy==="approve"?"Importing…":"Approve and save"}</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>setPending(null)}>Cancel</Button>
              </div>
            </div>}
            {search?.bundle===bundle&&search.data.warnings.map((warning,i)=><p key={i} className="text-xs text-muted-foreground">{warning}</p>)}
            <p className="text-xs leading-relaxed text-muted-foreground">External Openverse lookup runs only when you click Find. Downloads require explicit human review; no local model or narration provider is invoked.</p>
          </section>}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <SoundAuditionControls key={JSON.stringify([selectedShotId,choice,design.layers,design.ambience,library])} shotId={selectedShotId} choice={choice} layers={design.layers}
            ambience={design.ambience} library={library}/>
          <details className="space-y-3 rounded-surface border border-border bg-surface p-4">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold">
              <span className="flex items-center gap-2"><Headphones className="size-4 text-primary"/>Background music / ambience · {design.ambience?"on":"off"}</span>
              <span className="rounded-full border border-border px-2 py-1 text-[11px] font-normal text-muted-foreground">Full video</span>
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Select a reviewed CC0 track. It loops quietly beneath narration, with your fade and volume settings.</p>
            <label className="mt-3 block text-xs">Music or ambience asset
              <select aria-label="Music or ambience asset" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                disabled={!!busy} value={ambientDraft.assetId}
                onChange={e=>setAmbientDraft(x=>({...x,assetId:e.target.value}))}>
                <option value="">No ambience selected</option>
                {library.map(asset=><option key={asset.assetId+asset.sha256} value={asset.assetId}>{asset.assetType==="music"?"♪ ":""}{asset.title}</option>)}
              </select></label>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <label>Gain (dB)<input aria-label="Ambience gain (dB)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                type="number" min="-48" max="-12" step="1" disabled={!!busy} value={ambientDraft.gainDb}
                onChange={e=>setAmbientDraft(x=>({...x,gainDb:Number(e.target.value)}))}/></label>
              <label>Fade in (ms)<input aria-label="Ambience fade in (ms)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                type="number" min="0" max="5000" step="100" disabled={!!busy} value={ambientDraft.fadeInMs}
                onChange={e=>setAmbientDraft(x=>({...x,fadeInMs:Number(e.target.value)}))}/></label>
              <label>Fade out (ms)<input aria-label="Ambience fade out (ms)" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
                type="number" min="0" max="5000" step="100" disabled={!!busy} value={ambientDraft.fadeOutMs}
                onChange={e=>setAmbientDraft(x=>({...x,fadeOutMs:Number(e.target.value)}))}/></label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!!busy||!ambientDraft.assetId} onClick={()=>void saveAmbience()}>Save ambience</Button>
              <Button size="sm" variant="subtle" disabled={!!busy||!design.ambience} onClick={()=>void saveAmbience(true)}>Disable ambience</Button>
            </div>
            {design.ambience&&<p className="mt-2 text-xs text-muted-foreground">Active: {design.ambience.title} · {design.ambience.gainDb} dB</p>}
          </details>
          <div className="rounded-control border border-border bg-surface-subtle p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="size-4 text-emerald-500"/>Ready for final mix?</p>
            <p className="mt-2">Each saved sound change requires Video Director's <strong>Check</strong> again. Your exported draft uses measured narration timing and verified WAV hashes.</p>
          </div>
        </aside>
      </div>
      {notice&&<p role="status" className="rounded-control border border-border bg-surface-subtle p-3 text-xs">{notice}</p>}
    </div>
  </Surface>;
}

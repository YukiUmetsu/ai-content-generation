import {useEffect,useState} from "react";
import {CheckCircle2,ExternalLink,Headphones,Search,ShieldCheck,VolumeX} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Surface} from "@/components/ui/surface-card";

type Bundle={plan:{shots:Array<{id:string;family?:string;sceneRecipe?:string;subjectIds?:string[]}>;
  sound?:Array<{shotId:string;sfxIntent:string|null}>;
  teachingSequences?:Array<{technicalSubjectId:string;visualStates?:unknown;visualMechanic?:unknown;
    phases:Array<{shotId:string;kind:string}>}>}};
type Candidate={provider:"openverse";assetId:string;title:string;creator:string;durationSeconds:number;
  sourceUrl:string;previewUrl:string;license:"cc0";licenseUrl:string;source:string;matchCount:number;
  rightsStatus:"needs-human-review";tags:string[]};
type SearchResult={scenes:Array<{shotId:string;intent:string;query:string;candidates:Candidate[]}>;warnings:string[]};
type Approved={assetId:string;title:string;creator:string;sha256:string;license:"cc0";
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
  useEffect(()=>setDraft({trigger:layer.trigger,offsetMs:layer.offsetMs,gainDb:layer.gainDb,
    fadeInMs:layer.fadeInMs,fadeOutMs:layer.fadeOutMs}),[layer]);
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
      <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void onRemove(layer.layerId)}>Remove cue</Button>
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
export function SfxDiscoveryPanel({projectId,bundle,selectedShotId}:{projectId:string;bundle:Bundle;selectedShotId:string}){
  const [search,setSearch]=useState<{bundle:Bundle;data:SearchResult}|null>(null);
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
  const scene=search?.bundle===bundle?search.data.scenes.find(x=>x.shotId===selectedShotId):undefined;
  const planned=bundle.plan.sound?.find(x=>x.shotId===selectedShotId)?.sfxIntent?.trim()??"";
  const selectedShot=bundle.plan.shots.find(x=>x.id===selectedShotId);
  const visualSequence=bundle.plan.teachingSequences?.find(seq=>seq.phases.some(phase=>
    phase.shotId===selectedShotId&&["problem","mechanism","payoff"].includes(phase.kind)&&
    !!selectedShot?.subjectIds?.includes(seq.technicalSubjectId)&&
    (seq.visualStates||seq.visualMechanic)));
  const unsupportedReveal=Boolean(selectedShot?.sceneRecipe||
    ["question","process","mechanism","summary"].includes(selectedShot?.family??"")||visualSequence);
  const choice=choices.find(x=>x.shotId===selectedShotId);
  const review=pending?.shotId===selectedShotId?pending.asset:null;

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
  async function saveLayer(layer:CueDraft,layerId?:string){
    const asset=library.find(x=>x.assetId===layer.assetId);
    if(!asset){setNotice("Choose a reviewed local sound first.");return;}
    setBusy("design");setNotice("");
    try{await localSfx("sound-design",{action:"upsert",projectId,shotId:selectedShotId,
      ...(layerId?{layerId}:{}),assetId:asset.assetId,sha256:asset.sha256,
      trigger:layer.trigger,offsetMs:layer.offsetMs,gainDb:layer.gainDb,
      fadeInMs:layer.fadeInMs,fadeOutMs:layer.fadeOutMs});
      await reload();setNotice("Sound cue saved. Run Check again before rendering.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not save the sound cue.");}
    finally{setBusy("");}
  }
  async function removeLayer(layerId:string){
    setBusy("design");setNotice("");
    try{await localSfx("sound-design",{action:"remove",projectId,layerId});await reload();
      setNotice("Sound cue removed. Run Check again before rendering.");}
    catch(error){setNotice(error instanceof Error?error.message:"Could not remove the sound cue.");}
    finally{setBusy("");}
  }
  async function saveAmbience(disable=false){
    const asset=library.find(x=>x.assetId===ambientDraft.assetId);
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
    setBusy("search");setNotice("");setPending(null);
    try{
      const result=await localSfx("suggest",{bundle,allowExternalSearch:true});
      setSearch({bundle,data:result as unknown as SearchResult});
      setNotice("Only CC0 metadata was searched. Review the original page and license before the first download.");
    }catch(error){setNotice(error instanceof Error?error.message:"SFX search failed.");}
    finally{setBusy("");}
  }
  async function approve(){
    if(!review||!acknowledged)return;
    setBusy("approve");setNotice("");
    try{
      await localSfx("approve",{assetId:review.assetId,confirmRights:true,confirmDownload:true});
      await reload();setPending(null);setAcknowledged(false);
      setNotice("Sound saved to your reviewed local library. It can now be reused automatically in matching shots.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not import sound.");}
    finally{setBusy("");}
  }
  async function choose(mode:"auto"|"mute"|"pin",asset?:Approved){
    setBusy("choice");setNotice("");
    try{
      await localSfx("set-choice",{projectId,shotId:selectedShotId,mode,
        trigger:choice?.trigger??"shot-start",
        ...(mode==="pin"&&asset?{assetId:asset.assetId,sha256:asset.sha256}:{})});
      await reload();
      setNotice(mode==="mute"?"This sound cue is muted.":mode==="auto"?
        "Automatically use the best matching sound from your approved library, or silence if none matches.":
        "This sound is pinned to the selected shot.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not change scene sound.");}
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

  return <Surface header={<h2 className="flex items-center gap-2 font-medium">
    <Headphones className="size-4"/>Sound effects · reusable CC0 library</h2>}>
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">ContentGen recommends sounds from the storyboard's explicit effect intent.
        Approved sounds are shared across projects and reused without new downloads. Silence is always valid.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={!!busy} onClick={()=>void discover()}>
          <Search className="mr-2 size-4"/>{busy==="search"?"Searching…":"Find CC0 sound effects"}
        </Button>
        <span className="text-xs text-muted-foreground">Network search only on click · Openverse · no local AI</span>
      </div>
      <div className="rounded-control border border-border bg-surface-subtle p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected shot · {selectedShotId}</p>
        <p className="mt-1">{planned?<>Sound intent: <strong>{planned}</strong></>:"No sound effect requested; keep this shot quiet."}</p>
        {choice&&<p className="mt-1 text-xs text-muted-foreground">
          {choice.mode==="mute"?"Muted by editor":choice.assetId?
            `${choice.mode==="pin"?"Pinned":"Automatic"}: ${choice.title}`:choice.reason}
        </p>}
        {choice?.sha256&&<audio className="mt-2 w-full" controls preload="none"
          src={`/api/contentgen-sfx/preview/${choice.sha256}`} aria-label={`Listen to selected sound ${choice.title??"effect"}`}/>}
        {planned&&<label className="mt-3 block text-xs font-medium">Sound timing
          <select className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2"
            aria-label="Sound timing" disabled={!!busy} value={choice?.trigger??"shot-start"}
            onChange={e=>void chooseTrigger(e.target.value as "shot-start"|"first-visual-reveal")}>
            <option value="shot-start">At narration shot start</option>
            <option value="first-visual-reveal" disabled={unsupportedReveal}>At first visible element reveal</option>
          </select>
          <span className="mt-1 block font-normal text-muted-foreground">{unsupportedReveal?
            "This shot uses custom or dynamic visuals without a measurable element-reveal clock. Use shot-start timing.":
            "Reveal timing follows the first measurable on-screen element change. If none occurs, production stops with a timing error."}</span>
        </label>}
        {planned&&<div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void choose("auto")}>Use approved match</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void choose("mute")}>
            <VolumeX className="mr-1 size-3"/>Mute this shot
          </Button>
        </div>}
      </div>
      <details className="space-y-3 rounded-control border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Additional sound cues · {design.layers.filter(x=>x.shotId===selectedShotId).length}</summary>
        <p className="mt-2 text-xs text-muted-foreground">Layer up to four extra reviewed CC0 sounds on this shot. Offset is relative to your selected timing event. Sounds are remixed on export.</p>
        {design.layers.filter(layer=>layer.shotId===selectedShotId).map(layer=><SupplementaryLayerRow
          key={layer.layerId} layer={layer} busy={!!busy} unsupportedReveal={unsupportedReveal}
          onSave={next=>saveLayer(next,next.layerId)} onRemove={removeLayer}/>)}
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <label className="sm:col-span-2">Additional cue asset
            <select aria-label="Additional cue asset" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
              disabled={!!busy} value={cueDraft.assetId}
              onChange={e=>setCueDraft(x=>({...x,assetId:e.target.value}))}>
              <option value="">Choose from reviewed sound library</option>
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
        <Button size="sm" variant="outline" disabled={!!busy||!cueDraft.assetId||
          design.layers.filter(x=>x.shotId===selectedShotId).length>=4}
          onClick={()=>void saveLayer(cueDraft)}>Add cue</Button>
      </details>
      <details className="space-y-3 rounded-control border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Background ambience · {design.ambience?"on":"off"}</summary>
        <p className="mt-2 text-xs text-muted-foreground">One quiet, continuously looping CC0 recording for the full video, with a gentle start and end fade. This is independent of individual shot cues.</p>
        <label className="block text-xs">Ambience asset
          <select aria-label="Ambience asset" className="mt-1 w-full rounded-control border border-border bg-surface p-2"
            disabled={!!busy} value={ambientDraft.assetId}
            onChange={e=>setAmbientDraft(x=>({...x,assetId:e.target.value}))}>
            <option value="">No ambience selected</option>
            {library.map(asset=><option key={asset.assetId+asset.sha256} value={asset.assetId}>{asset.title}</option>)}
          </select></label>
        <div className="grid grid-cols-3 gap-2 text-xs">
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
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy||!ambientDraft.assetId} onClick={()=>void saveAmbience()}>Save ambience</Button>
          <Button size="sm" variant="ghost" disabled={!!busy||!design.ambience} onClick={()=>void saveAmbience(true)}>Disable ambience</Button>
        </div>
        {design.ambience&&<p className="text-xs text-muted-foreground">Current bed: {design.ambience.title} · {design.ambience.gainDb} dB</p>}
      </details>
      {scene&&<div className="space-y-2">
        <p className="text-xs font-semibold">Search: {scene.query} · {scene.candidates.length} CC0 candidates</p>
        <div className="grid gap-3 md:grid-cols-2">
          {scene.candidates.map(asset=>{
            const saved=library.find(x=>x.assetId===asset.assetId);
            return <div key={asset.assetId} className="min-w-0 space-y-2 rounded-control border border-border p-3">
              <p className="font-medium">{asset.title}</p>
              <p className="text-xs text-muted-foreground">{asset.durationSeconds.toFixed(1)}s · {asset.creator||asset.source||"Openverse"} · CC0</p>
              <audio className="w-full" src={saved?`/api/contentgen-sfx/preview/${saved.sha256}`:asset.previewUrl}
                controls preload="none" aria-label={`Preview ${asset.title}`}/>
              <div className="flex flex-wrap gap-3 text-xs">
                <a className="underline" href={asset.sourceUrl} target="_blank" rel="noopener noreferrer">Original source <ExternalLink className="inline size-3"/></a>
                <a className="underline" href={asset.licenseUrl} target="_blank" rel="noopener noreferrer">CC0 license</a>
              </div>
              {saved?<div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 className="size-3"/>In local library</span>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void choose("pin",saved)}>Use for this shot</Button>
              </div>:<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{
                setPending({shotId:selectedShotId,asset});setAcknowledged(false);}}>Review and import</Button>}
            </div>;
          })}
        </div>
        {scene.candidates.length===0&&<p className="text-xs text-muted-foreground">No suitable CC0 metadata found. Use an approved local effect or silence.</p>}
      </div>}
      {review&&<div className="rounded-control border border-primary/50 bg-surface-subtle p-4 space-y-3">
        <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4"/>First-time SFX approval</p>
        <p>{review.title} · {review.creator||"Creator not listed"}</p>
        <p className="text-xs text-muted-foreground">Openverse cannot independently verify third-party licensing.
          Open the source and confirm this recording is genuinely CC0 and suitable for commercial videos.
          The approved sound will be downloaded locally and converted to WAV.</p>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>
          I checked the original sound and its rights and approve this download.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!acknowledged||!!busy} onClick={()=>void approve()}>
            {busy==="approve"?"Importing…":"Approve and save"}</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>setPending(null)}>Cancel</Button>
        </div>
      </div>}
      {planned&&library.length>0&&<details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold">Approved sound library · {library.length} reusable effects</summary>
        <div className="mt-3 space-y-2">
          {library.slice(0,80).map(asset=><div key={asset.assetId+asset.sha256}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2">
            <div className="min-w-0 flex-1"><p className="text-xs">{asset.title}</p>
              <audio className="mt-1 w-full max-w-xs" controls preload="none"
                src={`/api/contentgen-sfx/preview/${asset.sha256}`} aria-label={`Listen to ${asset.title}`}/></div>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void choose("pin",asset)}>Pin to shot</Button>
          </div>)}
        </div>
      </details>}
      {search?.bundle===bundle&&search.data.warnings.map((warning,i)=><p key={i} className="text-xs text-muted-foreground">{warning}</p>)}
      {notice&&<p role="status" className="rounded-control border border-border p-3 text-xs">{notice}</p>}
      <p className="text-xs text-muted-foreground">Approved effects play in exported drafts at the narration shot start or an actual measured on-screen reveal. Silence remains valid; no timing is guessed.</p>
    </div>
  </Surface>;
}

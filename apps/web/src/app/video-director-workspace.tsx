import { useState } from "react";
import { Download, RefreshCw, WandSparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";

type Shot={id:string;visualChange:string;onScreenText:string;purpose:string};
type Sound={shotId:string;narration:string;sfxIntent:string|null};
type Phase={shotId:string;visualAction:string;kind:string};
type Plan={shots:Shot[];sound:Sound[];teachingSequences:Array<{phases:Phase[]}>;story:{question:string}};
type Bundle={kind:string;researchId:string;plan:Plan};
type Dossier={kind:string;id:string;topic:{title:string;audience:string}};
type Variant={id:string;strategy:string;audienceSignal:string;curiosityQuestion:string;
  narration:string;firstVisual:string;onScreenText:string;payoffConnection:string;sfxIntent:string|null};
type Impact={changedFields:string[];speechRegenerate:string[];visualRerender:string[];
  sfxRemix:string[];downstreamRetiming:string[];timelineRecalculate:boolean;externalActionsPerformed:string[]};
type Revision={kind:string;bundle:Bundle;impacts:Impact;reviewRequired:boolean};
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
function shotDraft(bundle:Bundle,id:string){
  const shot=bundle.plan.shots.find(x=>x.id===id);
  const audio=bundle.plan.sound.find(x=>x.shotId===id);
  const phase=bundle.plan.teachingSequences?.flatMap(x=>x.phases).find(x=>x.shotId===id);
  return {narration:audio?.narration??"",onScreenText:shot?.onScreenText??"",
    visualChange:shot?.visualChange??"",visualAction:phase?.visualAction??shot?.visualChange??"",
    sfxIntent:audio?.sfxIntent??""};
}
export function VideoDirectorWorkspace({locale}:{locale:Locale}){
  const ja=locale==="ja";
  const [dossier,setDossier]=useState<Dossier|null>(null);
  const [bundle,setBundle]=useState<Bundle|null>(null);
  const [shotId,setShotId]=useState("");
  const [draft,setDraft]=useState({narration:"",onScreenText:"",visualChange:"",visualAction:"",sfxIntent:""});
  const [variants,setVariants]=useState<Variant[]>([]);
  const [voiceVariant,setVoiceVariant]=useState("");
  const [visualVariant,setVisualVariant]=useState("");
  const [soundVariant,setSoundVariant]=useState("");
  const [revisions,setRevisions]=useState<Array<{shotId:string;impacts:Impact}>>([]);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const shot=bundle?.plan.shots.find(x=>x.id===shotId);
  const audio=bundle?.plan.sound.find(x=>x.shotId===shotId);
  const phase=bundle?.plan.teachingSequences?.flatMap(x=>x.phases).find(x=>x.shotId===shotId);
  async function importDossier(file:File|undefined){
    if(!file)return;
    try{const x=await loadJson(file) as unknown as Dossier;
      if(x.kind!=="research-dossier"||!x.id||!x.topic)throw Error("Expected a research-dossier/v1 JSON file.");
      setDossier(x);setStatus("Research dossier loaded. No source was modified.");
    }catch(e){setStatus(e instanceof Error?e.message:"Dossier import failed.");}
  }
  async function importBundle(file:File|undefined){
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
  function changes(){
    if(!shot||!audio)return {};
    const result:Record<string,string|null>={};
    if(draft.narration!==audio.narration)result.narration=draft.narration;
    if(draft.onScreenText!==shot.onScreenText)result.onScreenText=draft.onScreenText;
    if(draft.visualChange!==shot.visualChange)result.visualChange=draft.visualChange;
    if(draft.visualAction!==(phase?.visualAction??shot.visualChange))result.visualAction=draft.visualAction;
    if(draft.sfxIntent!==(audio.sfxIntent??""))result.sfxIntent=draft.sfxIntent||null;
    return result;
  }
  async function apply(changed:Record<string,string|null>){
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
  const usable=!!dossier&&!!bundle&&dossier.id===bundle.researchId;
  const mergedImpact={
    speech:new Set(revisions.flatMap(x=>x.impacts.speechRegenerate)),
    visuals:new Set(revisions.flatMap(x=>x.impacts.visualRerender)),
    sfx:new Set(revisions.flatMap(x=>x.impacts.sfxRemix)),
    shifted:new Set(revisions.flatMap(x=>x.impacts.downstreamRetiming)),
  };
  return <main id="workspace" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6" aria-label="Video director">
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="font-serif text-xl font-semibold">Video Director · Segment Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">Edit just one scene, generate different hook and storytelling combinations, and create a precise audio/visual regeneration plan. The source bundle is never overwritten.</p>
      </div>
      <Surface header={<h2 className="font-medium">1 · Load an editorial project</h2>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={header}>Research dossier (.json)<input className={field+" mt-2"} type="file" accept=".json" aria-label="Research dossier JSON" onChange={e=>{void importDossier(e.target.files?.[0]);}}/></label>
          <label className={header}>Preproduction bundle (.json)<input className={field+" mt-2"} type="file" accept=".json" aria-label="Preproduction bundle JSON" onChange={e=>{void importBundle(e.target.files?.[0]);}}/></label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{usable
          ?"Matched: "+dossier.topic.title+" · "+bundle.plan.shots.length+" shots"
          :"Import both the matching research dossier and preproduction bundle. Studio does not send either to a cloud service."}</p>
      </Surface>
      {usable&&<>
        <Surface header={<h2 className="font-medium">2 · Choose and edit a shot</h2>}>
          <div className="flex flex-col gap-3">
            <label className={header}>Selected shot
              <select aria-label="Selected video shot" className={field+" mt-2"} value={shotId}
                onChange={e=>{if(!bundle)return;setShotId(e.target.value);setDraft(shotDraft(bundle,e.target.value));
                  setVariants([]);setVoiceVariant("");setVisualVariant("");setSoundVariant("");setStatus("");}}>
                {bundle.plan.shots.map((s,i)=><option key={s.id} value={s.id}>{String(i+1).padStart(2,"0")} · {s.id} · {s.purpose}</option>)}
              </select>
            </label>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className={header}>Narration script<textarea className={field+" mt-2"} rows={6} maxLength={2000} aria-label="Edit narration" value={draft.narration} onChange={e=>setDraft({...draft,narration:e.target.value})}/></label>
              <label className={header}>Visible explanation / motion intent<textarea className={field+" mt-2"} rows={6} maxLength={650} aria-label="Edit visual action" value={draft.visualAction} onChange={e=>setDraft({...draft,visualAction:e.target.value})}/></label>
              <label className={header}>Shot description<textarea className={field+" mt-2"} rows={3} maxLength={650} aria-label="Edit shot description" value={draft.visualChange} onChange={e=>setDraft({...draft,visualChange:e.target.value})}/></label>
              <div className="flex flex-col gap-3">
                <label className={header}>On-screen text<input className={field+" mt-2"} maxLength={240} aria-label="Edit on-screen text" value={draft.onScreenText} onChange={e=>setDraft({...draft,onScreenText:e.target.value})}/></label>
                <label className={header}>Sound effect intent (optional)<input className={field+" mt-2"} maxLength={250} aria-label="Edit sound effect intent" value={draft.sfxIntent} onChange={e=>setDraft({...draft,sfxIntent:e.target.value})}/></label>
              </div>
            </div>
            <Button icon={<Save className="size-4"/>} disabled={busy||Object.keys(changes()).length===0}
              onClick={()=>void apply(changes())}>Apply selected-shot edit</Button>
          </div>
        </Surface>
        <Surface header={<h2 className="font-medium">3 · Generate creative alternatives</h2>}>
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
              <Button disabled={busy} onClick={combine} icon={<RefreshCw className="size-4"/>}>
                Apply combined variation to selected shot
              </Button>
              <p className="text-xs text-muted-foreground">Generated choices are hypotheses, not measured hook winners. Claims and media rights still require editorial review.</p>
            </div>}
          </div>
        </Surface>
        <Surface header={<h2 className="font-medium">4 · Selective regeneration plan</h2>}>
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
      </>}
      {status&&<p role="status" className="text-sm text-muted-foreground">{status}</p>}
      <p className="text-xs text-muted-foreground">{ja?"すべての変更は下書きです。":"Every edit remains an unapproved draft. Source research, claims, voice permissions, and final export QA are never bypassed."}</p>
    </div>
  </main>;
}

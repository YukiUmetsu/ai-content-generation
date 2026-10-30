import {useEffect, useState} from "react";
import {CheckCircle2, Download, ExternalLink, Search, ShieldCheck} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Surface} from "@/components/ui/surface-card";

type Shot={id:string;purpose?:string;visualChange?:string;onScreenText?:string;
  visualElements?:Array<{label:string;detail:string}>};
type Bundle={plan:{shots:Shot[];sound?:Array<{shotId:string;narration?:string;sfxIntent?:string|null}>}};
type Candidate={provider:"polyhaven"|"pexels"|"openverse";assetId:string;assetType:"model"|"texture"|"hdri"|"photo"|"video";
  title:string;sourceUrl:string;previewUrl:string;license:string;licenseUrl:string;creator:string;durationSeconds?:number;
  width?:number;height?:number;match?:{grade:"strong"|"review"|"weak";reasons:string[];score:number}};
type Scene={shotId:string;query:string;strategy:"search"|"kumiki";reason:string;candidates:Candidate[];
  recommendedAssetKey:string|null;shotDuration:{seconds:number;source:"measured"|"estimated"}};
type Results={scenes:Scene[];warnings:string[]};
type Approved={shotId:string;assetId:string;provider:string;assetType:string;title:string;license:string;
  sourceUrl:string;localPath:string;sha256:string;sizeBytes:number;durationSeconds?:number};
type Selected={selections:Array<Approved&{focalPoint?:{x:number;y:number}}> ;invalidShots:string[]};

async function localAssets(path:string,body?:unknown){
  const response=await fetch("/api/contentgen-assets/"+path,{
    method:body===undefined?"GET":"POST",cache:"no-store",
    ...(body===undefined?{}:{headers:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
      body:JSON.stringify(body)}),signal:AbortSignal.timeout(body===undefined?12000:90000)});
  const result=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(result.error??"Local asset service unavailable."));
  return result;
}
const fmt=(bytes:number)=>bytes<1024*1024?`${Math.round(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
const key=(asset:Candidate)=>`${asset.provider}:${asset.assetType}:${asset.assetId}`;

/** Optional per-scene visual ingredients; does not alter the approved storyboard or renderer. */
export function AssetDiscoveryPanel({bundle,projectId,selectedShotId,productionId,onOpenJobs}:{bundle:Bundle;projectId:string;selectedShotId:string;productionId?:string;onOpenJobs?:()=>void}){
  const [destination,setDestination]=useState<"landscape"|"portrait">("landscape");
  const [search,setSearch]=useState<{bundle:Bundle;destination:"landscape"|"portrait";data:Results}|null>(null);
  const [approved,setApproved]=useState<Approved[]>([]);
  const [selected,setSelected]=useState<Selected>({selections:[],invalidShots:[]});
  const [pending,setPending]=useState<{bundle:Bundle;shotId:string;asset:Candidate}|null>(null);
  const [acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("");
  const [lastImportJobId,setLastImportJobId]=useState<string|null>(null);
  const [siteUpload,setSiteUpload]=useState<{shotId:string;file:File}|null>(null);
  const [siteUploadRevision,setSiteUploadRevision]=useState(0);
  const [siteUrl,setSiteUrl]=useState("");
  const [siteCreator,setSiteCreator]=useState("");
  const [siteReviewedShotId,setSiteReviewedShotId]=useState<string|null>(null);
  const [savedSearchRefresh,setSavedSearchRefresh]=useState(0);
  const [framing,setFraming]=useState<{shotId:string;sha256:string;x:number;y:number}|null>(null);
  const results=search?.bundle===bundle&&search.destination===destination?search.data:null;
  const review=pending?.bundle===bundle&&pending.shotId===selectedShotId?pending.asset:null;
  const scene=results?.scenes.find(x=>x.shotId===selectedShotId);
  const siteReviewed=siteReviewedShotId===selectedShotId;
  const sceneApproved=approved.filter(x=>x.shotId===selectedShotId);
  const sceneSelected=selected.selections.find(x=>x.shotId===selectedShotId);
  const currentFraming=sceneSelected?(framing?.shotId===selectedShotId&&framing.sha256===sceneSelected.sha256?
    framing:{shotId:selectedShotId,sha256:sceneSelected.sha256,
      x:Math.round((sceneSelected.focalPoint?.x??.5)*100),
      y:Math.round((sceneSelected.focalPoint?.y??.5)*100)}):null;

  useEffect(()=>{
    let active=true;
    void Promise.all([
      localAssets("approved?projectId="+encodeURIComponent(projectId)),
      localAssets("selected?projectId="+encodeURIComponent(projectId))]).then(([assets,selection])=>{
      if(active){setApproved(assets.assets as Approved[]);setSelected(selection as unknown as Selected);}
    }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:"Could not load scene assets.");});
    return()=>{active=false;};
  },[projectId]);
  useEffect(()=>{
    if(!productionId||!/^production-[a-f0-9]{24}$/u.test(productionId))return;
    const controller=new AbortController();
    void fetch("/api/contentgen-video/suggestions/"+encodeURIComponent(productionId),
      {cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error(`Saved media suggestions unavailable (HTTP ${response.status}).`);
      return await response.json() as {found?:boolean;sourceShots?:unknown;sourceSound?:unknown;suggestions?:Results};
    }).then(data=>{
      if(controller.signal.aborted)return;
      if(!data.found){
        if(savedSearchRefresh>0)setNotice("No saved media suggestions yet. Generate a draft or search for this scene now.");
        return;
      }
      if(!Array.isArray(data.sourceShots)||JSON.stringify(data.sourceShots)!==JSON.stringify(bundle.plan.shots)||
        !Array.isArray(data.sourceSound)||JSON.stringify(data.sourceSound)!==JSON.stringify(bundle.plan.sound??[])){
        setNotice("Saved media suggestions belong to an older scene plan. Search again for the updated scenes.");return;
      }
      if(!Array.isArray(data.suggestions?.scenes)||!Array.isArray(data.suggestions.warnings))
        throw Error("Saved scene suggestions have an invalid format.");
      setSearch(previous=>savedSearchRefresh===0&&previous?.bundle===bundle?previous:
        {bundle,destination:"landscape",data:data.suggestions!});
      setNotice("Draft media suggestions loaded. Compare the original sources and licenses before downloading anything.");
    }).catch(error=>{if(!controller.signal.aborted)setNotice(error instanceof Error?error.message:"Could not read saved media suggestions.");});
    return()=>controller.abort();
  },[productionId,bundle,savedSearchRefresh]);
  async function discover(){
    setBusy("search");setNotice("");setPending(null);
    try{
      // This button is the user-facing opt-in to public-provider requests.
      const result=await localAssets("suggest",{bundle,destination,providers:["polyhaven","openverse"],allowExternalSearch:true});
      setSearch({bundle,destination,data:result as unknown as Results});
      setNotice("Ranked search suggestions only—no files were downloaded or selected. Check original sources and rights before importing; some providers offer reference links only.");
    }catch(error){setNotice(error instanceof Error?error.message:"Asset search failed.");}
    finally{setBusy("");}
  }
  async function approve(asset:Candidate){
    if(!acknowledged||!pending||pending.bundle!==bundle||pending.shotId!==selectedShotId)return;
    setBusy(key(asset));setNotice("");
    try{
      await localAssets("approve",{projectId,shotId:selectedShotId,provider:asset.provider,
        assetId:asset.assetId,assetType:asset.assetType,confirmDownload:true,confirmRights:true});
      const result=await localAssets("approved?projectId="+encodeURIComponent(projectId));
      setApproved(result.assets as Approved[]);
      setNotice("Asset imported with source, license and SHA-256 provenance. Choose 'Use in scene' to pin it for a future render.");
      setPending(null);setAcknowledged(false);
    }catch(error){setNotice(error instanceof Error?error.message:"Asset could not be imported.");}
    finally{setBusy("");}
  }
  async function importSiteFile(){
    if(busy||!siteUpload||siteUpload.shotId!==selectedShotId||!siteReviewed)return;
    setBusy("site-upload");setNotice("");setLastImportJobId(null);
    try{
      const file=siteUpload.file;
      if(file.size<128||file.size>80*1024*1024)throw Error("Choose a Pexels download between 128 bytes and 80 MB.");
      const assetType=/\.mp4$/iu.test(file.name)?"video":/\.jpe?g$/iu.test(file.name)?"photo":null;
      if(!assetType)throw Error("Choose a .jpg or .mp4 downloaded from Pexels.");
      const query=new URLSearchParams({projectId,shotId:selectedShotId,sourceUrl:siteUrl.trim(),
        assetType,creator:siteCreator.trim(),confirmRights:"yes"});
      const response=await fetch("/api/contentgen-assets/import-downloaded?"+query,{
        method:"POST",cache:"no-store",headers:{"Content-Type":"application/octet-stream",
          "X-Contentgen-Director":"local-only"},body:file,signal:AbortSignal.timeout(90000)});
      const result=await response.json() as {error?:string;jobId?:string;reused?:boolean};
      if(!response.ok)throw Error(result.error??`Import failed (HTTP ${response.status}).`);
      const updated=await localAssets("approved?projectId="+encodeURIComponent(projectId));
      setApproved(updated.assets as Approved[]);
      setSiteUpload(null);setSiteReviewedShotId(null);setSiteUploadRevision(value=>value+1);
      setLastImportJobId(result.jobId??null);
      setNotice(result.reused?"Existing verified media reused. Choose Use in next draft to include it in this scene.":
        "Pexels download verified, saved with its source and SHA-256 hash. Choose Use in next draft to pin it to this scene.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not import downloaded Pexels media.");}
    finally{setBusy("");}
  }
  async function downloadSitePhoto(){
    if(busy||!siteReviewed||!siteUrl.trim())return;
    setBusy("site-photo");setNotice("");setLastImportJobId(null);
    try{
      const imported=await localAssets("import-from-page",{projectId,shotId:selectedShotId,sourceUrl:siteUrl.trim(),
        assetType:"photo",creator:siteCreator.trim(),confirmRights:true});
      const updated=await localAssets("approved?projectId="+encodeURIComponent(projectId));
      setApproved(updated.assets as Approved[]);
      setSiteReviewedShotId(null);
      setLastImportJobId(typeof imported.jobId==="string"?imported.jobId:null);
      setNotice(imported.reused===true?"Previously verified photo reused. Select Use in next draft to include it in this scene.":
        "Pexels photo downloaded and verified. Select Use in next draft to include it in this scene.");
    }catch(error){setNotice(error instanceof Error?error.message:"Pexels could not provide this photo automatically. Download the JPG manually and import it below.");}
    finally{setBusy("");}
  }
  async function choose(asset:Approved){
    setBusy("selection");setNotice("");
    try{
      await localAssets("select",{projectId,shotId:selectedShotId,provider:asset.provider,
        assetId:asset.assetId,sha256:asset.sha256});
      setSelected(await localAssets("selected?projectId="+encodeURIComponent(projectId)) as unknown as Selected);
      setNotice("Saved. This photo or video will appear in the next draft render of this scene.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not select scene asset.");}
    finally{setBusy("");}
  }
  async function clearSelection(){
    setBusy("selection");setNotice("");
    try{
      await localAssets("clear",{projectId,shotId:selectedShotId});
      setSelected(await localAssets("selected?projectId="+encodeURIComponent(projectId)) as unknown as Selected);
      setNotice("Scene selection cleared; imported assets remain available.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not clear scene selection.");}
    finally{setBusy("");}
  }
  async function saveFraming(){
    if(!sceneSelected||!currentFraming)return;
    setBusy("framing");setNotice("");
    try{
      await localAssets("select",{projectId,shotId:selectedShotId,provider:sceneSelected.provider,
        assetId:sceneSelected.assetId,sha256:sceneSelected.sha256,
        focalPoint:{x:currentFraming.x/100,y:currentFraming.y/100}});
      const refreshed=await localAssets("selected?projectId="+encodeURIComponent(projectId));
      setSelected(refreshed as unknown as Selected);
      setNotice("Image position saved. Only this scene's framing needs a new render.");
    }catch(error){setNotice(error instanceof Error?error.message:"Could not save scene framing.");}
    finally{setBusy("");}
  }
  return <Surface header={<h2 className="flex items-center gap-2 font-medium">
    <Search className="size-4"/>Scene asset discovery</h2>}>
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">Find relevant video footage, photos, 3D models and materials for each storyboard scene.
        Search uses <a href="https://polyhaven.com/" className="underline" target="_blank" rel="noopener noreferrer">Poly Haven</a> and Openverse. For Pexels, download directly from its website and import the file below—no API key needed.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group" aria-label="Target video orientation">
          <Button variant={destination==="landscape"?"primary":"outline"} size="sm" disabled={!!busy}
            onClick={()=>{setDestination("landscape");setPending(null);}}>Landscape · 16:9</Button>
          <Button variant={destination==="portrait"?"primary":"outline"} size="sm" disabled={!!busy}
            onClick={()=>{setDestination("portrait");setPending(null);}}>Portrait · 9:16</Button>
        </div>
        <Button variant="outline" disabled={!!busy} onClick={()=>void discover()}>
          <Search className="mr-2 size-4"/>{busy==="search"?"Searching public asset sites…":"Find assets for all scenes"}
        </Button>
        {productionId&&<Button size="sm" variant="outline" disabled={!!busy}
          onClick={()=>setSavedSearchRefresh(value=>value+1)}>Load draft suggestions</Button>}
        <p className="text-xs text-muted-foreground">Searches on click · no Pexels API key, bulk scraping, or dataset collection</p>
      </div>
      <div className="rounded-control border border-border bg-surface-subtle p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected scene · {selectedShotId}</p>
        {scene?.strategy==="kumiki"?<p className="mt-2 text-sm">{scene.reason}</p>:
          scene?<div className="mt-2 space-y-1 text-sm">
            <p>Matching physical subject: <strong>{scene.query}</strong> · {scene.candidates.length} suggestions</p>
            <p className="text-xs text-muted-foreground">{scene.shotDuration.source==="measured"?"Measured":"Estimated"} narration shot: {scene.shotDuration.seconds}s. Footage duration is checked against this; final timing still comes from audio.</p>
            {!scene.recommendedAssetKey&&scene.candidates.length>0&&<p className="text-xs text-muted-foreground">No confident metadata match. Inspect footage before deciding.</p>}
          </div>:
          <p className="mt-2 text-sm text-muted-foreground">Run discovery to see candidates tied to this scene.</p>}
      </div>
      {scene?.candidates.length===0&&scene.strategy==="search"&&
        <p className="text-xs text-muted-foreground">No confident matches. Keep the Kumiki animation or use an asset from another source manually.</p>}
      {scene&&scene.candidates.length>0&&<div className="grid gap-3 md:grid-cols-2">
        {scene.candidates.map(asset=>{
          const existing=sceneApproved.some(x=>x.assetId===asset.assetId&&x.provider===asset.provider&&x.assetType===asset.assetType);
          const top=scene.recommendedAssetKey===key(asset);
          return <div key={key(asset)} className={`min-w-0 overflow-hidden rounded-control border bg-surface ${top?"border-primary/60":"border-border"}`}>
            {asset.previewUrl&&<img src={asset.previewUrl} alt={asset.title} loading="lazy"
              referrerPolicy="no-referrer" className="h-36 w-full bg-surface-subtle object-cover"/>}
            <div className="space-y-2 p-3">
              <p className="font-semibold">{asset.title}</p>
              {top&&<p className="text-xs font-semibold text-primary">Top metadata suggestion · preview required</p>}
              <p className="text-xs text-muted-foreground">{asset.assetType}{asset.durationSeconds?` · ${asset.durationSeconds}s`:""} · {asset.provider==="polyhaven"?"Poly Haven":asset.provider==="openverse"?"Openverse":"Pexels"}
                {asset.creator?` · ${asset.creator}`:""}</p>
              {asset.match&&<details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{asset.match.grade==="strong"?"Promising metadata match":
                  asset.match.grade==="review"?"Needs suitability review":"Weak metadata match"} · Why?</summary>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {asset.match.reasons.map((reason,index)=><li key={index}>{reason}</li>)}
                </ul>
              </details>}
              <div className="flex flex-wrap gap-3 text-xs">
                <a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">View original <ExternalLink className="inline size-3"/></a>
                <a href={asset.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{asset.license} terms</a>
              </div>
              {asset.provider==="pexels"?<p className="text-xs text-muted-foreground">
                Pexels API search is retired. Open its source page, download the file yourself, and use Import downloaded Pexels file below.
              </p>:asset.provider==="openverse"?<p className="text-xs text-muted-foreground">
                Search reference only. Openverse indexes third-party CC0 claims; verify the original source before using it. Automatic import is not available for this provider.
              </p>:<Button size="sm" variant="outline" disabled={!!busy||existing}
                onClick={()=>{setPending({asset,bundle,shotId:selectedShotId});setAcknowledged(false);}}>
                {existing?<><CheckCircle2 className="mr-1 size-4"/> Imported</>:"Review before import"}
              </Button>}
            </div>
          </div>;
        })}
      </div>}
      <div className="space-y-3 rounded-control border border-border bg-surface-subtle p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-semibold">Add an image or video from Pexels</p>
            <p className="mt-1 text-xs text-muted-foreground">For scene {selectedShotId}. No API key needed. A single public photo page can be downloaded automatically; videos and unavailable photos can be uploaded as files.</p></div>
          <a className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline" href="https://www.pexels.com/" target="_blank" rel="noopener noreferrer">Browse Pexels <ExternalLink className="size-3"/></a>
        </div>
        <label className="block text-xs font-medium">Original Pexels photo or video page URL
          <input type="url" aria-label="Pexels source page URL" value={siteUrl} onChange={event=>{setSiteUrl(event.target.value);setSiteReviewedShotId(null);}}
            placeholder="https://www.pexels.com/photo/example-123456/" className="mt-1 w-full rounded-control border border-input bg-surface px-3 py-2"/>
        </label>
        <label className="block text-xs font-medium">Downloaded JPG or MP4 (up to 80 MB)
          <input key={selectedShotId+":"+siteUploadRevision} type="file" accept=".jpg,.jpeg,.mp4,image/jpeg,video/mp4" aria-label="Pexels downloaded file"
            className="mt-1 block w-full text-xs file:mr-3 file:rounded-control file:border file:border-border file:bg-surface file:px-3 file:py-2"
            onChange={event=>{const file=event.target.files?.[0];setSiteUpload(file?{shotId:selectedShotId,file}:null);setSiteReviewedShotId(null);}}/>
        </label>
        <label className="block text-xs font-medium">Photographer or creator (optional)
          <input value={siteCreator} aria-label="Pexels creator" maxLength={100} onChange={event=>setSiteCreator(event.target.value)}
            placeholder="As listed on the Pexels page" className="mt-1 w-full rounded-control border border-input bg-surface px-3 py-2"/>
        </label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={siteReviewed}
          onChange={event=>setSiteReviewedShotId(event.target.checked?selectedShotId:null)}/>
          I reviewed this Pexels page, license, people, and brand restrictions and authorize this scene's download or import.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy||!siteReviewed||!siteUrl.trim()} onClick={()=>void downloadSitePhoto()}>
            <Download className="mr-1 size-4"/>{busy==="site-photo"?"Downloading photo…":"Download photo from Pexels page"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy||!siteReviewed||!siteUpload||siteUpload.shotId!==selectedShotId||!siteUrl.trim()}
            onClick={()=>void importSiteFile()}><Download className="mr-1 size-4"/>{busy==="site-upload"?"Verifying file…":"Import downloaded Pexels file"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">ContentGen checks the JPEG/MP4 format, codec, resolution, duration, and file hash. Imported media remains unselected until you explicitly pin it to a scene.</p>
      </div>
      {review&&<div className="space-y-3 rounded-control border border-primary/40 bg-surface-subtle p-4">
        <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4"/>Approve this asset</p>
        <p><strong>{review.title}</strong> · {review.provider} · {review.assetType}</p>
        <p className="text-xs text-muted-foreground">This action downloads files to your local ContentGen data folder.
          Check the source and license, especially recognizable people, trademarks, or redistribution restrictions.
          Stock assets are illustrations, never evidence for a factual claim.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acknowledged}
          onChange={event=>setAcknowledged(event.target.checked)} className="mt-0.5"/>
          I reviewed this asset and its license, and approve downloading it for this video.</label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!acknowledged||!!busy} onClick={()=>void approve(review)}>
            <Download className="mr-1 size-4"/>{busy==key(review)?"Downloading…":"Approve and download"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{setPending(null);setAcknowledged(false);}}>Cancel</Button>
        </div>
      </div>}
      {sceneApproved.length>0&&<div className="space-y-2 rounded-control border border-border p-3">
        <p className="text-xs font-semibold">Approved local assets for this scene</p>
        {sceneApproved.map(asset=>{
          const renderable=asset.provider==="pexels"&&["photo","video"].includes(asset.assetType);
          return <div key={asset.provider+asset.assetType+asset.assetId+asset.sha256} className="space-y-1 border-t border-border pt-2 text-xs">
          <p className="font-medium">{asset.title} · {asset.license} · {fmt(asset.sizeBytes)}</p>
          <p className="break-all text-muted-foreground">{asset.localPath}</p>
          {sceneSelected?.sha256===asset.sha256?<span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 className="size-3"/>{renderable?"Included in the next draft video":"Saved, but this type is not renderable yet"}</span>:
            <Button size="sm" variant="outline" disabled={!!busy||!renderable} onClick={()=>void choose(asset)}>
              {renderable?"Use in next draft":"3D models are not yet rendered"}
            </Button>}
        </div>})}
      </div>}
      {sceneSelected&&<div className="flex items-center justify-between gap-3 rounded-control border border-primary/30 p-3 text-xs">
        <span>Selected: <strong>{sceneSelected.title}</strong> · {sceneSelected.assetType}</span>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void clearSelection()}>Clear selection</Button>
      </div>}
      {sceneSelected&&currentFraming&&["photo","video"].includes(sceneSelected.assetType)&&
        <div className="space-y-3 rounded-control border border-primary/20 bg-primary/5 p-3 text-xs">
          <div><p className="font-semibold text-foreground">Position image in scene</p>
            <p className="mt-1 text-muted-foreground">Choose which part stays in focus when the image fills its frame. Your selection is saved for this scene only.</p></div>
          <label className="flex flex-col gap-2 font-medium">Horizontal focus · {currentFraming.x}%
            <input type="range" min={0} max={100} step={1} aria-label="Image horizontal focus"
              value={currentFraming.x} disabled={!!busy}
              onChange={event=>setFraming({...currentFraming,x:Number(event.target.value)})}/>
          </label>
          <label className="flex flex-col gap-2 font-medium">Vertical focus · {currentFraming.y}%
            <input type="range" min={0} max={100} step={1} aria-label="Image vertical focus"
              value={currentFraming.y} disabled={!!busy}
              onChange={event=>setFraming({...currentFraming,y:Number(event.target.value)})}/>
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Default center: 50% / 50%</span>
            <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!!busy||currentFraming.x===50&&currentFraming.y===50}
              onClick={()=>setFraming({...currentFraming,x:50,y:50})}>Center</Button>
            <Button size="sm" disabled={!!busy||currentFraming.x===Math.round((sceneSelected.focalPoint?.x??.5)*100)&&
              currentFraming.y===Math.round((sceneSelected.focalPoint?.y??.5)*100)}
              onClick={()=>void saveFraming()}>Save scene framing</Button>
            </div>
          </div>
        </div>}
      {selected.invalidShots.includes(selectedShotId)&&<p role="status" className="rounded-control border border-destructive/40 p-3 text-xs">
        The saved scene reference is missing or modified. Import the asset again to restore the reference.</p>}
      {results?.warnings?.map((warning,index)=><p className="text-xs text-muted-foreground" key={index}>{warning}</p>)}
      {notice&&<p role="status" className="rounded-control border border-border p-3 text-xs">{notice}</p>}
      {lastImportJobId&&onOpenJobs&&<Button size="sm" variant="outline" onClick={onOpenJobs}>
        View media preparation in Jobs
      </Button>}
      <p className="text-xs text-muted-foreground">Reviewed Pexels photos and compatible H.264 footage appear in the next draft video with Kumiki.
        Existing videos are unchanged. Imported 3D models, textures and HDRIs are saved for future scene support.</p>
    </div>
  </Surface>;
}

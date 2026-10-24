import {useEffect, useState} from "react";
import {CheckCircle2, Download, ExternalLink, Search, ShieldCheck} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Surface} from "@/components/ui/surface-card";

type Shot={id:string;purpose?:string;visualChange?:string;onScreenText?:string;
  visualElements?:Array<{label:string;detail:string}>};
type Bundle={plan:{shots:Shot[]}};
type Candidate={provider:"polyhaven"|"pexels";assetId:string;assetType:"model"|"texture"|"hdri"|"photo";
  title:string;sourceUrl:string;previewUrl:string;license:string;licenseUrl:string;creator:string};
type Scene={shotId:string;query:string;strategy:"search"|"kumiki";reason:string;candidates:Candidate[]};
type Results={scenes:Scene[];warnings:string[]};
type Approved={shotId:string;assetId:string;provider:string;assetType:string;title:string;license:string;
  sourceUrl:string;localPath:string;sha256:string;sizeBytes:number};

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
const key=(asset:Candidate)=>`${asset.provider}:${asset.assetId}`;

/** Optional per-scene visual ingredients; does not alter the approved storyboard or renderer. */
export function AssetDiscoveryPanel({bundle,projectId,selectedShotId}:{bundle:Bundle;projectId:string;selectedShotId:string}){
  const [results,setResults]=useState<Results|null>(null);
  const [approved,setApproved]=useState<Approved[]>([]);
  const [pending,setPending]=useState<Candidate|null>(null);
  const [acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("");
  const scene=results?.scenes.find(x=>x.shotId===selectedShotId);
  const sceneApproved=approved.filter(x=>x.shotId===selectedShotId);

  useEffect(()=>{
    let active=true;
    void localAssets("approved?projectId="+encodeURIComponent(projectId)).then(result=>{
      if(active)setApproved(result.assets as Approved[]);
    }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:"Could not load approved assets.");});
    return()=>{active=false;};
  },[projectId]);
  useEffect(()=>{setResults(null);setPending(null);setAcknowledged(false);},[bundle]);

  async function discover(){
    setBusy("search");setNotice("");setPending(null);
    try{
      // This button is the user-facing opt-in to public-provider requests.
      const result=await localAssets("suggest",{bundle,providers:["polyhaven","pexels"],allowExternalSearch:true});
      setResults(result as unknown as Results);
      setNotice("Suggestions only—nothing was downloaded. Choose and approve each useful asset.");
    }catch(error){setNotice(error instanceof Error?error.message:"Asset search failed.");}
    finally{setBusy("");}
  }
  async function approve(asset:Candidate){
    if(!acknowledged)return;
    setBusy(key(asset));setNotice("");
    try{
      await localAssets("approve",{projectId,shotId:selectedShotId,provider:asset.provider,
        assetId:asset.assetId,assetType:asset.assetType,confirmDownload:true,confirmRights:true});
      const result=await localAssets("approved?projectId="+encodeURIComponent(projectId));
      setApproved(result.assets as Approved[]);
      setNotice("Asset saved locally with source, license and SHA-256 provenance. You can now bind it into a Kumiki scene.");
      setPending(null);setAcknowledged(false);
    }catch(error){setNotice(error instanceof Error?error.message:"Asset could not be imported.");}
    finally{setBusy("");}
  }
  return <Surface header={<h2 className="flex items-center gap-2 font-medium">
    <Search className="size-4"/>Scene asset discovery</h2>}>
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">Find relevant photos, 3D models and materials for each storyboard scene.
        Search uses public Poly Haven and optional Pexels metadata; nothing is imported without your approval.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={!!busy} onClick={()=>void discover()}>
          <Search className="mr-2 size-4"/>{busy==="search"?"Searching public asset sites…":"Find assets for all scenes"}
        </Button>
        <p className="text-xs text-muted-foreground">Uses network on click · no local AI workload · Pexels needs PEXELS_API_KEY</p>
      </div>
      <div className="rounded-control border border-border bg-surface-subtle p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected scene · {selectedShotId}</p>
        {scene?.strategy==="kumiki"?<p className="mt-2 text-sm">{scene.reason}</p>:
          scene?<p className="mt-2 text-sm">Matching physical subject: <strong>{scene.query}</strong> · {scene.candidates.length} suggestions</p>:
          <p className="mt-2 text-sm text-muted-foreground">Run discovery to see candidates tied to this scene.</p>}
      </div>
      {scene?.candidates.length===0&&scene.strategy==="search"&&
        <p className="text-xs text-muted-foreground">No confident matches. Keep the Kumiki animation or use an asset from another source manually.</p>}
      {scene&&scene.candidates.length>0&&<div className="grid gap-3 md:grid-cols-2">
        {scene.candidates.map(asset=>{
          const existing=sceneApproved.some(x=>x.assetId===asset.assetId&&x.provider===asset.provider);
          return <div key={key(asset)} className="min-w-0 overflow-hidden rounded-control border border-border bg-surface">
            {asset.previewUrl&&<img src={asset.previewUrl} alt={asset.title} loading="lazy"
              referrerPolicy="no-referrer" className="h-36 w-full bg-surface-subtle object-cover"/>}
            <div className="space-y-2 p-3">
              <p className="font-semibold">{asset.title}</p>
              <p className="text-xs text-muted-foreground">{asset.assetType} · {asset.provider==="polyhaven"?"Poly Haven":"Pexels"}
                {asset.creator?` · ${asset.creator}`:""}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                <a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">View original <ExternalLink className="inline size-3"/></a>
                <a href={asset.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{asset.license} terms</a>
              </div>
              <Button size="sm" variant="outline" disabled={!!busy||existing}
                onClick={()=>{setPending(asset);setAcknowledged(false);}}>
                {existing?<><CheckCircle2 className="mr-1 size-4"/> Imported</>:"Review before import"}
              </Button>
            </div>
          </div>;
        })}
      </div>}
      {pending&&<div className="space-y-3 rounded-control border border-primary/40 bg-surface-subtle p-4">
        <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4"/>Approve this asset</p>
        <p><strong>{pending.title}</strong> · {pending.provider} · {pending.assetType}</p>
        <p className="text-xs text-muted-foreground">This action downloads files to your local ContentGen data folder.
          Check the source and license, especially recognizable people, trademarks, or redistribution restrictions.
          Stock assets are illustrations, never evidence for a factual claim.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acknowledged}
          onChange={event=>setAcknowledged(event.target.checked)} className="mt-0.5"/>
          I reviewed this asset and its license, and approve downloading it for this video.</label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!acknowledged||!!busy} onClick={()=>void approve(pending)}>
            <Download className="mr-1 size-4"/>{busy==key(pending)?"Downloading…":"Approve and download"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{setPending(null);setAcknowledged(false);}}>Cancel</Button>
        </div>
      </div>}
      {sceneApproved.length>0&&<div className="space-y-2 rounded-control border border-border p-3">
        <p className="text-xs font-semibold">Approved local assets for this scene</p>
        {sceneApproved.map(asset=><div key={asset.provider+asset.assetId+asset.sha256} className="text-xs">
          <p className="font-medium">{asset.title} · {asset.license} · {fmt(asset.sizeBytes)}</p>
          <p className="break-all text-muted-foreground">{asset.localPath}</p>
        </div>)}
      </div>}
      {results?.warnings?.map((warning,index)=><p className="text-xs text-muted-foreground" key={index}>{warning}</p>)}
      {notice&&<p role="status" className="rounded-control border border-border p-3 text-xs">{notice}</p>}
      <p className="text-xs text-muted-foreground">Approved files are kept with scene-linked manifests for the Kumiki render adapter.
        The current generic video renderer does not automatically place imported images/models yet.</p>
    </div>
  </Surface>;
}

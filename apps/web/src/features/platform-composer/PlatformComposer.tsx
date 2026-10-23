import { useEffect, useMemo, useState } from "react";
import { Download, LayoutTemplate, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { FeatureSlotProps } from "@/features/registry";
import { createDeliveryLayout, PLATFORMS, type DeliveryInput, type DeliveryLayout } from "./model";

const field="w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labels:{[id:string]:string}={
  youtube:"YouTube · 16:9", "youtube-shorts":"YouTube Shorts · 9:16",
  "instagram-reels":"Instagram Reels · 9:16", tiktok:"TikTok · 9:16",
  "instagram-feed":"Instagram Feed · 4:5","social-square":"Square · 1:1",
};
function pct(n:number){return (n*100)+"%";}
function PlatformFrame({layout,guides}:{layout:DeliveryLayout;guides:boolean}){
  const rectStyle=(r:{x:number;y:number;width:number;height:number})=>({
    position:"absolute" as const,left:pct(r.x),top:pct(r.y),width:pct(r.width),height:pct(r.height),
  });
  return <div data-testid="platform-layout-frame" data-profile={layout.preset}
    className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-surface border border-border bg-[#132330] text-white shadow-sm"
    style={{aspectRatio:layout.width+"/"+layout.height,containerType:"inline-size"}}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_25%,rgba(70,196,182,.20),transparent_58%)]"/>
    <div className="absolute left-[5%] top-[3%] font-mono text-[9px] tracking-wider text-white/60">
      {labels[layout.preset]} · AUTHOR PREVIEW
    </div>
    <div style={rectStyle(layout.placements[0].rect)}
      className="flex items-center overflow-hidden font-bold leading-tight text-white"
      data-layout-element="headline">
      <span className="line-clamp-3 break-words" style={{fontSize:layout.orientation==="landscape"?"clamp(12px,4cqw,42px)":"clamp(12px,6cqw,44px)"}}>
        {layout.headline}
      </span>
    </div>
    <div style={rectStyle(layout.placements[1].rect)}
      className="flex items-center overflow-hidden text-white/75"
      data-layout-element="subtitle">
      <span className="line-clamp-3 break-words" style={{fontSize:layout.orientation==="landscape"?"clamp(10px,2.1cqw,27px)":"clamp(10px,3.2cqw,26px)"}}>
        {layout.supportingText}
      </span>
    </div>
    {layout.labels.map((text,index)=><div key={index}
      style={rectStyle(layout.placements[index+2].rect)}
      data-layout-element="graphic"
      className="flex items-center justify-center overflow-hidden rounded-[min(3cqw,18px)] border border-[#8dded0]/55 bg-[#2b5057]/90 px-[3%] text-center font-semibold">
      <span className="line-clamp-3 break-words" style={{fontSize:layout.orientation==="landscape"?"clamp(10px,2.6cqw,26px)":"clamp(10px,4cqw,27px)"}}>{text}</span>
    </div>)}
    {guides&& <>
      {layout.reserved.map(region=><div key={region.id} data-testid="safe-reserved"
        style={{...rectStyle(region.rect),background:"repeating-linear-gradient(135deg,rgba(255,165,0,.12) 0 7px,rgba(255,165,0,.24) 7px 13px)",outline:"1px solid rgba(255,165,0,.65)"}}/>)}
      <div style={{...rectStyle(layout.safeArea),outline:"2px dashed #7cdfca",pointerEvents:"none"}}/>
    </>}
  </div>;
}
export function PlatformComposer({locale,onPreviewChange}:FeatureSlotProps){
  const ja=locale==="ja";
  const [preset,setPreset]=useState<DeliveryInput["preset"]>("youtube-shorts");
  const [headline,setHeadline]=useState("Why does this actually cost so much?");
  const [supportingText,setSupportingText]=useState("The answer becomes clear when you separate the cost drivers.");
  const [labels,setLabels]=useState(["Materials","Labor","Long-term risk"]);
  const [guides,setGuides]=useState(true);
  const [notice,setNotice]=useState("");
  const result=useMemo(()=>{
    try{return {plan:createDeliveryLayout({preset,headline,supportingText,labels}),error:null};}
    catch(error){return {plan:null,error:error instanceof Error?error.message:"Invalid platform layout"};}
  },[preset,headline,supportingText,labels]);
  const plan=result.plan;
  const preview=useMemo(()=>plan?<PlatformFrame layout={plan} guides={guides}/>:null,[plan,guides]);
  useEffect(()=>{
    onPreviewChange?.(preview);
    return ()=>onPreviewChange?.(null);
  },[onPreviewChange,preview]);
  const exportPlan=()=>{
    if(!plan?.exportable)return;
    const json=JSON.stringify({...plan,exportNotice:"Layout metadata only. No video was rendered or uploaded."},null,2)+"\n";
    const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="contentgen-"+preset+"-layout.json";
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice(ja?"レイアウト JSON を保存しました。動画は生成されません。":"Layout JSON saved locally. No video has been rendered.");
  };
  return <div className="flex flex-col gap-4">
    <div>
      <h2 className="text-lg font-semibold">{ja?"配信先レイアウト":"Platform layout planner"}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {ja?"レイアウトを配信先ごとに再構成し、セーフエリアを確認します。動画投稿や書き出しは行いません。":
          "Compose a separate layout for each platform's output size and reserved UI. This produces a plan, not an MP4 or a published post."}
      </p>
    </div>
    <Surface header={<span className="flex items-center gap-2 text-sm font-medium"><LayoutTemplate aria-hidden className="size-4"/>Destination</span>}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Platform
          <select className={field} value={preset} onChange={e=>setPreset(e.target.value as DeliveryInput["preset"])}>
            {PLATFORMS.map(item=><option key={item} value={item}>{labels[item]}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">A new composition is measured for this canvas. Cropping an existing 16:9 frame is not used.</p>
      </div>
    </Surface>
    <Surface header={<span className="text-sm font-medium">Scene copy</span>}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Headline
          <textarea className={field} rows={2} maxLength={90} value={headline} onChange={e=>setHeadline(e.target.value)}/>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Supporting text
          <textarea className={field} rows={2} maxLength={140} value={supportingText} onChange={e=>setSupportingText(e.target.value)}/>
        </label>
        {labels.map((label,index)=><label key={index} className="flex flex-col gap-1 text-xs text-muted-foreground">
          {"Visual label "+(index+1)}
          <input className={field} value={label} maxLength={44}
            onChange={e=>setLabels(current=>current.map((value,i)=>i===index?e.target.value:value))}/>
        </label>)}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={labels.length>=4}
            onClick={()=>setLabels(current=>[...current,"New concept"])}>Add label</Button>
          <Button variant="outline" size="sm" disabled={labels.length<=2}
            onClick={()=>setLabels(current=>current.slice(0,-1))}>Remove last</Button>
        </div>
      </div>
    </Surface>
    <Surface header={<span className="flex items-center gap-2 text-sm font-medium"><ShieldCheck aria-hidden className="size-4"/>Safe areas & export</span>}>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>
          Show approximate reserved platform UI guides
        </label>
        <p className="text-xs text-muted-foreground">Guides are for preview only. Platforms can change their overlay geometry. Long copy still requires visual inspection.</p>
        {result.error&&<p role="alert" className="text-danger">{result.error}</p>}
        {plan&&<>
          <p className="text-xs text-muted-foreground">{plan.width} × {plan.height} · {plan.orientation} · {plan.placements.length} planned elements</p>
          {plan.diagnostics.length===0?<p className="text-xs text-status-success">No reserved-region collisions detected.</p>:
            <ul aria-label="Layout findings" className="space-y-1 text-xs text-muted-foreground">
              {plan.diagnostics.map((d,i)=><li key={d.code+"-"+i}>{d.severity==="error"?"Error":"Review"}: {d.message}</li>)}
            </ul>}
        </>}
        <Button onClick={exportPlan} disabled={!plan?.exportable} icon={<Download aria-hidden className="size-4"/>}>
          Export layout plan JSON
        </Button>
        {notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      </div>
    </Surface>
  </div>;
}

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";

export type VisualQualityFinding = {
  code:string;severity:"error"|"warning";shotId:string;relatedShotIds:string[];
  message:string;suggestion:string;
};
export type VisualQualityReport = {
  schemaVersion:1;kind:"rendered-scene-quality/v1";status:"ready"|"needs-review";
  basis:"compiled-renderer-static-preflight";
  summary:{errors:number;warnings:number;affectedShots:number;totalShots:number};
  findings:VisualQualityFinding[];limitation:string;
};

export function VisualQualityReview({report,activeShotId,shotIds,onInspectShot,onEditShot}:{
  report?:VisualQualityReport;activeShotId:string;shotIds:string[];
  onInspectShot:(shotId:string)=>void;onEditShot?:(shotId:string)=>void;
}){
  const [showAll,setShowAll]=useState(false);
  if(!report)return <section aria-label="Visual quality review" className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
    <p className="font-medium">Visual quality review is not available for this saved preview.</p>
    <p className="mt-1 text-xs text-muted-foreground">Refresh the actual scene preview to check repetition and text-fit risks.</p>
  </section>;
  const findings=report.findings;
  const here=findings.filter(f=>f.shotId===activeShotId);
  const activeIndex=shotIds.indexOf(activeShotId);
  const issues=report.summary.errors+report.summary.warnings;
  const shotLabel=(id:string)=>{
    const index=shotIds.indexOf(id);
    return index<0?"Scene":`Shot ${index+1}`;
  };
  return <section aria-label="Visual quality review" className="overflow-hidden rounded-control border border-border bg-surface" data-contentgen-quality-review="">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-subtle p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-control border border-border bg-surface p-2" aria-hidden="true">
          {issues?<AlertTriangle className="size-4 text-amber-600"/>:<CheckCircle2 className="size-4 text-emerald-600"/>}
        </span>
        <div>
          <h3 className="text-sm font-semibold">Scene quality review</h3>
          <p className="mt-1 text-xs text-muted-foreground">Checks the compiled visuals, not just the storyboard description.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {report.summary.errors>0&&<span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2.5 py-1 font-semibold text-foreground">{report.summary.errors} text-fit risk{report.summary.errors===1?"":"s"}</span>}
        <span className="rounded-full border border-border bg-surface px-2.5 py-1 font-semibold">{report.summary.warnings} storytelling note{report.summary.warnings===1?"":"s"}</span>
        <span className="text-muted-foreground">{report.summary.affectedShots}/{report.summary.totalShots} shots flagged</span>
      </div>
    </div>
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{activeIndex>=0?`Shot ${activeIndex+1}`:"Selected shot"} · {here.length?`${here.length} point${here.length===1?"":"s"} to review`:"No automated findings"}</h4>
        {onEditShot&&<Button size="sm" variant="outline" onClick={()=>onEditShot(activeShotId)}>Edit this shot</Button>}
      </div>
      {here.length?<ul className="space-y-2">
        {here.map(f=><li key={`${f.code}:${f.shotId}`} className="rounded-control border border-border bg-surface-subtle p-3 text-xs leading-relaxed">
          <div className="flex items-start gap-2"><span className="mt-0.5 shrink-0" aria-hidden="true">{f.severity==="error"?<AlertTriangle className="size-4 text-amber-600"/>:<ScanEye className="size-4 text-muted-foreground"/>}</span>
            <div><p className="font-semibold">{f.message}</p><p className="mt-1 text-muted-foreground">{f.suggestion}</p>
              {f.relatedShotIds.length>0&&<p className="mt-1 text-muted-foreground">Related: {f.relatedShotIds.map(shotLabel).join(", ")}</p>}
            </div>
          </div>
        </li>)}
      </ul>:<p className="rounded-control border border-border bg-surface-subtle px-3 py-3 text-xs text-muted-foreground">No static issues found here. Play this shot at normal speed to confirm it teaches something distinct.</p>}
      {issues>0&&<div className="border-t border-border pt-3">
        <button type="button" aria-expanded={showAll} aria-controls="contentgen-all-visual-findings"
          onClick={()=>setShowAll(value=>!value)} className="flex w-full items-center justify-between gap-2 rounded-control p-1 text-left text-xs font-semibold hover:bg-surface-subtle">
          <span>{showAll?"Hide":"Review all"} {issues} findings across the video</span>
          <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${showAll?"rotate-180":""}`}/>
        </button>
        {showAll&&<ul id="contentgen-all-visual-findings" className="mt-2 grid gap-2 sm:grid-cols-2">
          {findings.map((f,index)=><li key={`${f.shotId}:${f.code}:${index}`}>
            <button type="button" onClick={()=>onInspectShot(f.shotId)}
              aria-label={`Inspect ${shotLabel(f.shotId)}: ${f.message}`}
              className={`w-full rounded-control border p-3 text-left text-xs transition-colors hover:bg-surface-subtle ${f.shotId===activeShotId?"border-primary bg-primary/10":"border-border"}`}>
              <span className="block font-semibold">{shotLabel(f.shotId)} · {f.severity==="error"?"Text fit":"Storytelling"}</span>
              <span className="mt-1 block text-muted-foreground">{f.message}</span>
            </button>
          </li>)}
        </ul>}
      </div>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{report.limitation}</p>
    </div>
  </section>;
}

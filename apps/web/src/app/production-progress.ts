/** Pure stage derivation for the guided Production workspace. Status is never a UI progress guess. */
export type ProductionStageId = "brief" | "research" | "storyboard" | "visuals" | "audio" | "export";
export type ProductionStageStatus = "not_started" | "running" | "complete" | "needs_review" | "failed" | "stale";
export interface ProductionStage {
  id: ProductionStageId;
  status: ProductionStageStatus;
  reason: string;
  primaryAction: string;
}
export interface ProductionProgressInput {
  briefReady: boolean;
  researchJob?: {
    status: "queued" | "running" | "paused" | "failed" | "cancelled" | "completed";
    stage: string;
    artifactId?: string;
  } | null;
  researchArtifactId?: string | null;
  storyboardReady?: boolean;
  storyboardResearchArtifactId?: string | null;
  missingEvidenceClaims?: number;
  unreviewedClaims?: number;
  visualReady?: boolean;
  audioReady?: boolean;
  exportReady?: boolean;
}
const stage=(id:ProductionStageId,status:ProductionStageStatus,reason:string,primaryAction:string):ProductionStage=>
  ({id,status,reason,primaryAction});

export function getProductionStages(input:ProductionProgressInput): ProductionStage[] {
  const research=input.researchJob;
  const artifactId=research?.artifactId??input.researchArtifactId;
  const researchComplete=Boolean(artifactId) && (!research || research.status==="completed");
  const researchStatus:ProductionStageStatus = research?.status==="running" || research?.status==="queued"?"running":
    research?.status==="paused" && research.stage==="evidence-repair"?"needs_review":
    research?.status==="failed" || research?.status==="paused" || research?.status==="cancelled"?"failed":
      researchComplete?"complete":"not_started";
  const stale=Boolean(input.storyboardReady && input.storyboardResearchArtifactId &&
    artifactId && input.storyboardResearchArtifactId!==artifactId);
  const missing=input.missingEvidenceClaims??0;
  const reviews=input.unreviewedClaims??0;
  const storyboardStatus:ProductionStageStatus = stale?"stale":!input.storyboardReady?"not_started":
    missing>0 || reviews>0?"needs_review":"complete";
  const downstream=(ready:boolean):ProductionStageStatus=>stale&&ready?"stale":ready?"complete":"not_started";

  return [
    stage("brief",input.briefReady?"complete":"not_started",
      input.briefReady?"Video question saved.":"Start with a clear viewer question.","Create brief"),
    stage("research",researchStatus,
      researchStatus==="running"?"Research is progressing through saved stages.":
        researchStatus==="needs_review"?"Captured source links need editorial review or a fresh capture.":
        researchStatus==="failed"?"Saved research needs attention or retry.":
          researchComplete?"Captured research saved.":"Collect and assess captured sources.",
      researchStatus==="needs_review"?"Review source links":researchStatus==="failed"?"Retry research":"Start research"),
    stage("storyboard",storyboardStatus,
      stale?"Research changed; review the existing storyboard before replacing anything.":
        missing>0?`${missing} claim${missing===1?"":"s"} lack resolved source evidence.`:
          reviews>0?`${reviews} sourced claim${reviews===1?"":"s"} need factual review.`:
            input.storyboardReady?"Editable storyboard saved.":"Turn research into teachable visual beats.",
      input.storyboardReady?"Review storyboard":"Create editable storyboard"),
    stage("visuals",downstream(Boolean(input.visualReady)),
      stale&&input.visualReady?"Existing visuals need review against newer research.":
        input.visualReady?"Visual plan saved.":"Plan on-screen actions and motion.","Plan visuals"),
    stage("audio",downstream(Boolean(input.audioReady)),
      stale&&input.audioReady?"Existing audio needs review against newer research.":
        input.audioReady?"Narration audio saved.":"Generate or edit narration.","Create audio"),
    stage("export",downstream(Boolean(input.exportReady)),
      stale&&input.exportReady?"Previous export belongs to an earlier research version.":
        input.exportReady?"Export artifact saved.":"Review the video and export when ready.","Preview & export"),
  ];
}

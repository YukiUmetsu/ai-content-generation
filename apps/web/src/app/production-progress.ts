/** Persisted artifact state—not a decorative completion percentage—drives the eight-stage navigator. */
export const PRODUCTION_STAGE_ORDER = ["setup", "discover", "select", "script", "storyboard", "produce", "optimize", "export"] as const;
export type ProductionStageId = typeof PRODUCTION_STAGE_ORDER[number];
export type ProductionStageStatus = "not_started" | "running" | "complete" | "needs_review" | "failed" | "stale";
export interface ProductionStage {
  id: ProductionStageId;
  status: ProductionStageStatus;
  reason: string;
  primaryAction: string;
}
type Job = {
  status: "queued" | "running" | "paused" | "failed" | "cancelled" | "completed";
  stage: string;
  artifactId?: string;
};
export interface ProductionProgressInput {
  setupReady?: boolean;
  sessionId?: string | null;
  ideaId?: string | null;
  scriptReady?: boolean;
  discoveryJob?: Job | null;
  discoveryArtifactId?: string | null;
  discoveryReady?: boolean;
  storyboardReady?: boolean;
  storyboardResearchArtifactId?: string | null;
  missingEvidenceClaims?: number;
  unreviewedClaims?: number;
  storyboardEditorialWarnings?: number;
  visualReady?: boolean;
  audioReady?: boolean;
  optimizationReady?: boolean;
  exportReady?: boolean;
  /** Legacy names remain accepted while saved project-level research is migrated. */
  briefReady?: boolean;
  researchJob?: Job | null;
  researchArtifactId?: string | null;
}
const stage = (id:ProductionStageId,status:ProductionStageStatus,reason:string,primaryAction:string):ProductionStage =>
  ({id,status,reason,primaryAction});

export function getProductionStages(input:ProductionProgressInput): ProductionStage[] {
  const job=input.discoveryJob??input.researchJob;
  const evidenceId=job?.artifactId??input.discoveryArtifactId??input.researchArtifactId;
  const evidenceComplete=(Boolean(evidenceId)&&(!job||job.status==="completed"))||
    Boolean(input.discoveryReady||input.ideaId);
  const discoverStatus:ProductionStageStatus = job?.status==="running"||job?.status==="queued"?"running":
    job?.status==="paused"&&job.stage==="evidence-repair"?"needs_review":
    job?.status==="failed"||job?.status==="paused"||job?.status==="cancelled"?"failed":
    evidenceComplete?"complete":"not_started";
  const stale=Boolean(input.storyboardReady&&input.storyboardResearchArtifactId&&evidenceId&&
    input.storyboardResearchArtifactId!==evidenceId);
  const missing=input.missingEvidenceClaims??0;
  const reviews=input.unreviewedClaims??0;
  const repeated=input.storyboardEditorialWarnings??0;
  const boardStatus:ProductionStageStatus=stale?"stale":!input.storyboardReady?"not_started":
    missing>0||reviews>0||repeated>0?"needs_review":"complete";
  const downstream=(ready:boolean):ProductionStageStatus=>stale&&ready?"stale":ready?"complete":"not_started";
  return [
    stage("setup",input.setupReady||input.briefReady?"complete":"not_started",
      input.setupReady||input.briefReady?"Brand and destinations selected.":"Choose a project and at least one platform.","Choose project"),
    stage("discover",discoverStatus,
      discoverStatus==="running"?"Source and opportunity collection is running.":
      discoverStatus==="needs_review"?"Captured sources require review.":
      discoverStatus==="failed"?"The saved discovery job can be retried.":
      evidenceComplete?"A captured research snapshot is available.":
      input.sessionId?"This session is ready to discover ideas.":"Create or resume a discovery session.",
      discoverStatus==="needs_review"?"Review source links":discoverStatus==="failed"?"Retry discovery":"Discover ideas"),
    stage("select",input.ideaId?"complete":"not_started",
      input.ideaId?"An idea has been selected for this production.":"Review saved opportunities and select one idea.","Select an idea"),
    stage("script",input.scriptReady?"complete":"not_started",
      input.scriptReady?"The script has an approved revision.":"Review the AI-written script and its evidence.","Review script"),
    stage("storyboard",boardStatus,
      stale?"Research changed. Review the previous storyboard before rebuilding.":
      missing>0?`${missing} claims lack resolved source evidence.`:
      reviews>0?`${reviews} claims need factual review.`:
      repeated>0?`${repeated} scenes may repeat earlier information.`:
      input.storyboardReady?"An editable storyboard is saved.":"Plan visuals from the approved script.",
      input.storyboardReady?"Review storyboard":"Create storyboard"),
    stage("produce",downstream(Boolean(input.visualReady&&input.audioReady)),
      stale&&input.visualReady?"Existing media may need rebuilding against updated evidence.":
      input.visualReady&&input.audioReady?"Video and audio artifacts are available.":"Produce and review visuals, narration and sound.","Open producer"),
    stage("optimize",downstream(Boolean(input.optimizationReady)),
      stale&&input.optimizationReady?"Upload packages need review after source changes.":
      input.optimizationReady?"Platform packages approved.":"Generate and review each destination's upload package.","Review packages"),
    stage("export",downstream(Boolean(input.exportReady)),
      stale&&input.exportReady?"Previous export belongs to an older research revision.":
      input.exportReady?"An export artifact is available.":"Review and download platform-ready files.","Preview & export"),
  ];
}

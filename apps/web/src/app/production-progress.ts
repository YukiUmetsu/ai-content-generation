/** Persisted artifact state—not a decorative completion percentage—drives the production navigator. */
export const PRODUCTION_STAGE_ORDER = ["setup", "discover", "select", "script", "produce", "optimize", "export"] as const;
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
type SessionRun = {
  status: Job["status"] | "insufficient_evidence";
  stage: string;
};
export interface ProductionProgressInput {
  setupReady?: boolean;
  sessionId?: string | null;
  ideaId?: string | null;
  scriptReady?: boolean;
  scriptActivity?: "idle" | "running" | "failed";
  scriptStale?: boolean;
  discoveryJob?: Job | null;
  discoverySessionRun?: SessionRun | null;
  discoveryIdeaCount?: number | null;
  discoveryArtifactId?: string | null;
  discoveryReady?: boolean;
  storyboardReady?: boolean;
  storyboardScriptStale?: boolean;
  storyboardResearchArtifactId?: string | null;
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
  const sessionRun=input.discoverySessionRun;
  const researchJob=input.discoveryJob??input.researchJob;
  const job=sessionRun??researchJob;
  const evidenceId=researchJob?.artifactId??input.discoveryArtifactId??input.researchArtifactId;
  const hasSavedIdeas=Boolean(input.discoveryIdeaCount&&input.discoveryIdeaCount>0);
  const sessionComplete=Boolean(sessionRun&&(sessionRun.status==="completed"||
    sessionRun.status==="insufficient_evidence"));
  const evidenceComplete=Boolean(input.discoveryReady||input.ideaId) ||
    (sessionRun?sessionComplete&&hasSavedIdeas:
      Boolean(evidenceId)&&(!researchJob||researchJob.status==="completed"));
  const discoverStatus:ProductionStageStatus = job?.status==="running"||job?.status==="queued"?"running":
    job?.status==="paused"&&job.stage==="evidence-repair"?"needs_review":
    job?.status==="failed"||job?.status==="paused"||job?.status==="cancelled"?"failed":
    sessionComplete&&!evidenceComplete?"needs_review":
    evidenceComplete?"complete":"not_started";
  const stale=Boolean(input.storyboardScriptStale || input.scriptStale ||
    (input.storyboardReady&&input.storyboardResearchArtifactId&&evidenceId&&
    input.storyboardResearchArtifactId!==evidenceId));
  const downstream=(ready:boolean,hasSavedWork=ready):ProductionStageStatus=>
    stale&&hasSavedWork?"stale":ready?"complete":"not_started";
  return [
    stage("setup",input.setupReady||input.briefReady?"complete":"not_started",
      input.setupReady||input.briefReady?"Brand and destinations selected.":"Choose a project and at least one platform.","Choose project"),
    stage("discover",discoverStatus,
      discoverStatus==="running"?"Source and opportunity collection is running.":
      discoverStatus==="needs_review"?(job?.status==="paused"&&job.stage==="evidence-repair"
        ?"Captured sources require review.":"Discovery finished without usable saved ideas. Review this session or try again."):
      discoverStatus==="failed"?"The saved discovery job can be retried.":
      evidenceComplete?"A captured research snapshot is available.":
      input.sessionId?"This session is ready to discover ideas.":"Create or resume a discovery session.",
      discoverStatus==="needs_review"?"Review source links":discoverStatus==="failed"?"Retry discovery":"Discover ideas"),
    stage("select",input.ideaId?"complete":"not_started",
      input.ideaId?"An idea has been selected for this production.":"Review saved opportunities and select one idea.","Select an idea"),
    stage("script",input.scriptStale?"stale":input.scriptReady?"complete":input.scriptActivity==="running"?"running":input.scriptActivity==="failed"?"failed":"not_started",
      input.scriptStale?"Research or creative inputs changed. Reapprove the updated script.":
      input.scriptReady?"The script has an approved revision.":"Review the AI-written script and its evidence.","Review script"),
    stage("produce",downstream(Boolean(input.visualReady&&input.audioReady),Boolean(input.visualReady||input.audioReady)),
      stale&&(input.visualReady||input.audioReady)?"Existing media may need rebuilding against updated evidence.":
      input.visualReady&&input.audioReady?"Video and audio artifacts are available.":"Produce and review visuals, narration and sound.","Open producer"),
    stage("optimize",downstream(Boolean(input.optimizationReady)),
      stale&&input.optimizationReady?"Upload packages need review after source changes.":
      input.optimizationReady?"Platform packages approved.":"Generate and review each destination's upload package.","Review packages"),
    stage("export",downstream(Boolean(input.exportReady)),
      stale&&input.exportReady?"Previous export belongs to an older research revision.":
      input.exportReady?"An export artifact is available.":"Review and download platform-ready files.","Preview & export"),
  ];
}


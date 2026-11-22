/** A selected-scene MP4 is independently claimed in the existing Rust Jobs
 * system. A crashed worker leaves a recoverable attempt, never a fake success.
 */
import {createHash} from "node:crypto";
import {withWorkerJob} from "./worker-job.mjs";

const SHA=/^[a-f0-9]{64}$/u;
const ID=/^[a-z0-9][a-z0-9_-]{0,95}$/iu;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function withSceneClipJob({projectId="unsaved-project",shotId,sourceHash,runId,signal},render,options={}){
  if(!ID.test(projectId??"")||!ID.test(shotId??"")||!SHA.test(sourceHash??"")||!UUID.test(runId??"")||
    typeof render!=="function")throw Error("Scene preview Jobs need a stable storyboard scene and render plan.");
  const scope={projectId,shotId,sourceHash,runId};
  const {result,jobId}=await withWorkerJob({name:"Scene preview",signal,jobKind:"video-render-segment",
    idempotencyKey:"video-scene-preview:"+hash(scope),nodeKey:"scene-preview",nodeKind:"video.scene-preview",input:scope,
    output:artifact=>{
      if(artifact?.shotId!==shotId||!SHA.test(artifact.sha256??"")||
        !Number.isSafeInteger(artifact.sizeBytes)||artifact.sizeBytes<100)
        throw Error("The scene worker did not return a verified MP4.");
      return {shotId,sha256:artifact.sha256,sizeBytes:artifact.sizeBytes};
    },
    failure:{errorCode:"scene_preview_failed",
      errorDetail:"Scene preview rendering stopped. Check Chromium and FFmpeg, then retry."}},render,options);
  return {...result,jobId};
}

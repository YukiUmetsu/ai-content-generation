/** Render exactly one selected storyboard scene to a silent, reviewable MP4.
 * The same built Kumiki page and bounded FFmpeg segment encoder used for a
 * complete release are used here; no voice provider or published media runs.
 */
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat,link} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileLiveVisualPreview} from "./live-visual-preview.mjs";
import {renderVideoSegments} from "./render.mjs";
import {startLocalStageServer} from "./stage-server.mjs";

const SHA=/^[a-f0-9]{64}$/u;
const SHOT=/^[a-z0-9][a-z0-9_-]{0,95}$/iu;

export async function renderSelectedSceneClip({dossier,bundle,shotId,outDir,browserExecutable,
  distRoot=fileURLToPath(new URL("../../dist",import.meta.url)),signal,onProgress},
{compile=compileLiveVisualPreview,openStage=startLocalStageServer,render=renderVideoSegments}={}){
  if(!SHOT.test(shotId??"")||typeof outDir!=="string"||!outDir.trim())
    throw Error("Choose a saved storyboard scene before rendering its preview.");
  if(signal?.aborted)throw signal.reason??Error("Scene preview cancelled.");
  const prepared=compile(dossier,bundle);
  const scene=prepared?.shotMap?.find(item=>item.shotId===shotId);
  const chapter=prepared?.plan?.chapters?.find(item=>item.id===scene?.beatId);
  if(!scene||!chapter||!Number.isSafeInteger(chapter.startFrame)||
    !Number.isSafeInteger(chapter.endFrame)||chapter.endFrame<=chapter.startFrame||
    chapter.endFrame-chapter.startFrame>1800||!SHA.test(prepared?.renderPlanSha256??""))
    throw Error("This scene does not have a bounded, renderable visual timeline.");
  const stage=await openStage({distRoot,validatedPlan:prepared.plan});
  try{
    if(signal?.aborted)throw signal.reason??Error("Scene preview cancelled.");
    onProgress?.({message:"Rendering the selected scene with Kumiki and FFmpeg…"});
    const result=await render({stageUrl:stage.url,manifest:prepared.plan.manifest,
      visualPlan:prepared.plan,onlyChapterId:chapter.id,planHash:prepared.renderPlanSha256,
      buildHash:stage.buildHash,outDir:join(outDir,".render"),
      browserExecutable,signal,onProgress,maxBatchFrames:150});
    if(signal?.aborted)throw signal.reason??Error("Scene preview cancelled.");
    if(result.frameCount!==chapter.endFrame-chapter.startFrame||
      result.sourceChapterId!==chapter.id)throw Error("Selected scene did not render the expected frames.");
    const file=join(outDir,"video.mp4");
    // Hard links commit a verified preview without overwriting an existing
    // file. The preview is not a licensed or reviewed release.
    await link(result.videoOnlyPath,file);
    const info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size<100||info.size>256*1024*1024)
      throw Error("Rendered scene MP4 failed its output bounds check.");
    const checksum=createHash("sha256");
    for await(const chunk of createReadStream(file))checksum.update(chunk);
    return {shotId,sha256:checksum.digest("hex"),sizeBytes:info.size,
      durationFrames:result.frameCount,fps:prepared.plan.manifest.fps};
  }finally{await stage.close();}
}

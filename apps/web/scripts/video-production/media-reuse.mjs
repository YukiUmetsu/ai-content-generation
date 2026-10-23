/**
 * Safe per-chapter reuse for a previous ContentGen H.264 render.
 * Never infer that changed visuals are equivalent: only identical global
 * dependencies + the entire chapter at the same absolute frames may reuse.
 * Cross-build reuse is forbidden. Segments are still SHA-256 + FFprobe checked.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const hashJson = obj => createHash("sha256").update(JSON.stringify(obj)).digest("hex");

function globalDependencies(plan) {
  if(!plan||!Array.isArray(plan.chapters)||!plan.manifest)return null;
  const {durationFrames:unused,...manifest}=plan.manifest;
  void unused;
  const {chapters:ignored,manifest:omitted,...other}=plan;
  void ignored;void omitted;
  return {manifest,other};
}
export function reusableChapter(oldPlan,newPlan,chapterIndex,buildHash) {
  if(typeof buildHash!=="string"||!/^[a-f0-9]{64}$/i.test(buildHash)||
    oldPlan?.manifest?.durationFrames!==newPlan?.manifest?.durationFrames||
    !isDeepStrictEqual(globalDependencies(oldPlan),globalDependencies(newPlan))||
    oldPlan?.chapters?.length!==newPlan?.chapters?.length)
    return false;
  const old=oldPlan.chapters[chapterIndex],current=newPlan.chapters[chapterIndex];
  return !!old&&!!current&&isDeepStrictEqual(old,current);
}
/**
 * Chapter-aligned 150-frame chunks permit reusing one scene while rendering
 * only changed scenes. Legacy no-plan callers preserve fixed chunking.
 */
export function listRenderChunks(manifest,limit,plan){
  if(!Number.isSafeInteger(limit)||limit<1||limit>150||
    !Number.isSafeInteger(manifest?.durationFrames)||manifest.durationFrames<1)
    throw Error("Invalid render chunking options.");
  if(!plan)return Array.from({length:Math.ceil(manifest.durationFrames/limit)},(_,i)=>{
    const startFrame=i*limit;
    return {index:i,startFrame,frameCount:Math.min(limit,manifest.durationFrames-startFrame),chapterIndex:null};
  });
  if(!Array.isArray(plan.chapters)||!plan.chapters.length||
    !isDeepStrictEqual(plan.manifest,manifest))
    throw Error("Chunked render plan has an incompatible manifest or no chapters.");
  const chunks=[];
  let prev=0;
  plan.chapters.forEach((chapter,chapterIndex)=>{
    if(chapter.startFrame!==prev||!Number.isSafeInteger(chapter.endFrame)||
      chapter.endFrame<=prev||chapter.endFrame>manifest.durationFrames)
      throw Error("Render chapters must cover each frame in strict order.");
    for(let startFrame=prev;startFrame<chapter.endFrame;startFrame+=limit){
      chunks.push({index:chunks.length,startFrame,
        frameCount:Math.min(limit,chapter.endFrame-startFrame),chapterIndex});
    }
    prev=chapter.endFrame;
  });
  if(prev!==manifest.durationFrames)throw Error("Rendered chapters must cover the full timeline.");
  return chunks;
}

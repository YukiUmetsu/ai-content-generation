/** Select the exported scene clips needed to demonstrate both dialogue and a full blink.
 * A screenshot alone cannot prove that the blink exists in an encoded MP4.
 */
export function planRigQaCoverage({chapters,spokenChapterId,blinkStartFrame,blinkDurationFrames}){
  if(!Array.isArray(chapters)||!chapters.some(chapter=>chapter.id===spokenChapterId))
    throw Error("Rig QA spoken scene is missing from the render plan.");
  if(!Number.isSafeInteger(blinkDurationFrames)||blinkDurationFrames<1)
    throw Error("Rig QA blink duration must be at least one frame.");
  if(!Number.isSafeInteger(blinkStartFrame)||blinkStartFrame<1)
    throw Error("Rig QA blink start frame must follow an open-eye frame.");
  const review=[blinkStartFrame-1,blinkStartFrame,blinkStartFrame+blinkDurationFrames];
  const containing=chapters.find(chapter=>chapter.startFrame<=review[0]&&chapter.endFrame>review[2]);
  if(!containing)throw Error("Rig QA blink transition does not fit within a scene's exported frames.");
  return {spokenChapterId,blinkChapterId:containing.id===spokenChapterId?null:containing.id,
    blinkReviewFrames:review};
}

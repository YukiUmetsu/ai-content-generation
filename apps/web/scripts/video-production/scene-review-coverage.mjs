/** Review stills prove frame capture per scene, not that an asset's license or visual quality was approved. */
export const MAX_SCENE_REVIEW_STILLS = 64;
export const MAX_TOTAL_REVIEW_STILL_BYTES = 256 * 1024 * 1024;
const fail = (reason) => { throw new Error(`Scene review coverage invalid: ${reason}`); };
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

export function assertSceneReviewCapacity(sceneCount) {
  if (!Number.isSafeInteger(sceneCount) || sceneCount < 1 || sceneCount > MAX_SCENE_REVIEW_STILLS)
    fail(`the ${MAX_SCENE_REVIEW_STILLS}-still limit supports at most 64 narrated scenes; split the draft before narration`);
  return sceneCount;
}

export function assertReviewStillBudget(totalBytes, nextBytes) {
  if (!integer(totalBytes) || !integer(nextBytes) || nextBytes === 0 ||
    totalBytes + nextBytes > MAX_TOTAL_REVIEW_STILL_BYTES)
    fail("review still storage exceeds the 256 MiB budget or has an invalid byte count; shorten the storyboard");
  return totalBytes + nextBytes;
}

function checkedChapters(plan) {
  const frames = plan?.manifest?.durationFrames;
  const chapters = plan?.chapters;
  if (!Number.isSafeInteger(frames) || frames < 2 || !Array.isArray(chapters) || !chapters.length)
    fail("nonempty chapters and a minimum two-frame manifest are required");
  assertSceneReviewCapacity(chapters.length);
  const known = new Set();
  let cursor = 0;
  for (const chapter of chapters) {
    if (typeof chapter?.id !== "string" || !chapter.id.trim() || known.has(chapter.id)) fail("missing or duplicate scene id");
    known.add(chapter.id);
    if (!integer(chapter.startFrame) || !integer(chapter.endFrame) || chapter.startFrame !== cursor ||
      chapter.endFrame <= cursor || chapter.endFrame > frames) fail(`scene ${chapter.id} has a gap or invalid contiguous frame range`);
    cursor = chapter.endFrame;
  }
  if (cursor !== frames) fail("final scene does not cover the entire rendered frame range");
  return { frames, chapters };
}

/** A deterministic, bounded set that samples *every* narrated chapter. */
export function selectSceneReviewFrames(plan) {
  const { frames, chapters } = checkedChapters(plan);
  const midpoints = chapters.map(chapter => chapter.startFrame + Math.floor((chapter.endFrame - chapter.startFrame) / 2));
  const selected = new Set([0, frames - 1, ...midpoints]);
  // The opening and closing frames already prove their respective scenes.
  // At high scene counts, replace those two redundant midpoint captures
  // before sacrificing any interior scene's proof.
  for (const midpoint of [midpoints[0], midpoints.at(-1)]) {
    if (selected.size <= MAX_SCENE_REVIEW_STILLS) break;
    if (midpoint !== 0 && midpoint !== frames - 1) selected.delete(midpoint);
  }
  if (selected.size > MAX_SCENE_REVIEW_STILLS)
    fail(`review stills exceed the ${MAX_SCENE_REVIEW_STILLS}-image limit; split the storyboard`);
  const payoff = plan?.events?.[plan?.payoffEventId];
  if (integer(payoff) && payoff < frames) {
    const fps = plan.manifest.fps;
    const oneSecond = Number.isSafeInteger(fps?.num) && fps.num > 0 && Number.isSafeInteger(fps?.den) && fps.den > 0
      ? Math.max(1, Math.round(fps.num / fps.den)) : 1;
    if (selected.size < MAX_SCENE_REVIEW_STILLS) selected.add(Math.min(frames - 1, payoff + oneSecond));
  }
  const result = [...selected].sort((a, b) => a - b);
  return result;
}

/** Summarize source *declarations* with independently published, SHA-verified scene still metadata. */
export function summarizeSceneReviewCoverage(plan, reviewStills, shotMap) {
  const { frames, chapters } = checkedChapters(plan);
  const shotsByBeat = new Map();
  const usedShotIds = new Set();
  if (shotMap !== undefined) {
    if (!Array.isArray(shotMap) || shotMap.length > chapters.length) fail("invalid storyboard shot mapping");
    const known = new Set(chapters.map(chapter => chapter.id));
    for (const entry of shotMap) {
      if (typeof entry?.beatId !== "string" || !known.has(entry.beatId) ||
        typeof entry.shotId !== "string" || !entry.shotId.trim() || entry.shotId.length > 160 ||
        /[\u0000-\u001f]/u.test(entry.shotId) || shotsByBeat.has(entry.beatId) || usedShotIds.has(entry.shotId))
        fail("invalid or duplicate storyboard shot mapping");
      shotsByBeat.set(entry.beatId, entry.shotId);
      usedShotIds.add(entry.shotId);
    }
  }
  if (!Array.isArray(reviewStills) || reviewStills.length < 2 || reviewStills.length > MAX_SCENE_REVIEW_STILLS)
    fail("review stills must be a bounded collection");
  for (const [index, still] of reviewStills.entries()) {
    if (!integer(still?.frame) || still.frame >= frames ||
      (index > 0 && still.frame <= reviewStills[index - 1].frame) || !hash(still.sha256) ||
      still.file !== `stills/frame-${String(still.frame).padStart(6, "0")}.png`)
      fail("review still has an invalid frame, ordering, file or hash");
  }
  if (reviewStills[0].frame !== 0 || reviewStills.at(-1).frame !== frames - 1)
    fail("first and last rendered frames must have review stills");
  const counts = { stockVideo: 0, stockPhoto: 0, kumikiOnly: 0 };
  const scenesWithoutStockVideo = [];
  const scenes = chapters.map((chapter) => {
    const midpoint = chapter.startFrame + Math.floor((chapter.endFrame - chapter.startFrame) / 2);
    const still = reviewStills.find(({ frame }) => frame === midpoint) ??
      reviewStills.find(({ frame }) => frame >= chapter.startFrame && frame < chapter.endFrame);
    if (!still) fail(`missing captured review still for scene ${chapter.id}`);
    const media = chapter.visual?.stockMedia;
    if (media && !["video", "photo"].includes(media.assetType)) fail(`unknown stock media declaration in scene ${chapter.id}`);
    const sourceType = media?.assetType === "video" ? "stock-video" : media?.assetType === "photo" ? "stock-photo" : "kumiki";
    if (sourceType === "stock-video") counts.stockVideo++;
    else {
      scenesWithoutStockVideo.push(chapter.id);
      if (sourceType === "stock-photo") counts.stockPhoto++;
      else counts.kumikiOnly++;
    }
    return { id: chapter.id, ...(shotsByBeat.has(chapter.id) ? { shotId: shotsByBeat.get(chapter.id) } : {}),
      sourceType, startFrame: chapter.startFrame, endFrame: chapter.endFrame,
      reviewStill: still,
      ...(media?.rightsStatus ? { rightsStatus: media.rightsStatus } : {}),
      ...(media?.license ? { declaredLicense: media.license } : {}),
    };
  });
  return { schemaVersion: 1, sceneCount: scenes.length, reviewStillCount: reviewStills.length,
    mediaDeclarationCounts: counts, scenesWithoutStockVideo, scenes, humanVisualReviewRequired: true,
    disclaimer: "Captured stills verify a frame in each scene; source declarations do not prove footage quality, playback, or commercial rights." };
}

/** Authoring presets, not platform compliance certification. Sizes are best-practice
 * output recipes; platform UI overlays, eligible placements and duration rules evolve.
 * Shared JSON is also read by the Node exporter, avoiding two copies of platform specs.
 */
import catalog from "./platform-presets.json";

export type VideoPlatformPresetId =
  | "youtube" | "youtube-shorts"
  | "instagram-reels" | "instagram-feed" | "instagram-story"
  | "tiktok" | "tiktok-ads"
  | "facebook-reels" | "facebook-feed" | "facebook-ads-feed" | "facebook-ads-reels"
  | "linkedin-video" | "linkedin-square" | "social-square";
export interface VideoPlatformPreset {
  id: VideoPlatformPresetId;
  label: string;
  width: number;
  height: number;
  placement: "video"|"short"|"feed"|"story"|"ad";
  minSeconds: number|null;
  maxSeconds: number|null;
  referenceUrl: string;
  /** Approximate, user-adjustable creative safe area, NOT an official guarantee. */
  safeInset: {left:number;right:number;top:number;bottom:number};
}
export const VIDEO_PLATFORM_PRESETS:readonly VideoPlatformPreset[]=
  catalog as VideoPlatformPreset[];
export function videoPlatformPreset(id: VideoPlatformPresetId):VideoPlatformPreset {
  const result=VIDEO_PLATFORM_PRESETS.find(item=>item.id===id);
  if(!result)throw new Error(`Unknown video export preset: "${id}".`);
  return result;
}
export interface VideoPresetManifest {
  schemaVersion:1;
  id:string;
  durationFrames:number;
  width:number;
  height:number;
  fps:{num:number;den:number};
  preset?:VideoPlatformPresetId;
}
export interface VideoPresetFinding {
  severity:"error"|"warning";
  code:"preset-raster-mismatch"|"preset-duration-too-short"|"preset-duration-too-long"|"preset-audio-recommended";
  message:string;
}
export function inspectVideoPreset(manifest:VideoPresetManifest,
  presetId:VideoPlatformPresetId,hasAudio?:boolean):VideoPresetFinding[] {
  const preset=videoPlatformPreset(presetId),issues:VideoPresetFinding[]=[];
  if(manifest.width!==preset.width||manifest.height!==preset.height)
    issues.push({severity:"error",code:"preset-raster-mismatch",
      message:`The ${preset.label} preset requires an authored ${preset.width}×${preset.height} stage. Reflow the scene; do not blindly crop or stretch it.`});
  const seconds=manifest.durationFrames*manifest.fps.den/manifest.fps.num;
  if(preset.minSeconds!==null&&seconds<preset.minSeconds)
    issues.push({severity:"error",code:"preset-duration-too-short",
      message:`The ${preset.label} placement requires at least ${preset.minSeconds} seconds.`});
  if(preset.maxSeconds!==null&&seconds>preset.maxSeconds)
    issues.push({severity:"error",code:"preset-duration-too-long",
      message:`The ${preset.label} placement permits up to ${preset.maxSeconds} seconds for this recipe.`});
  if(presetId==="tiktok-ads"&&!hasAudio)
    issues.push({severity:"warning",code:"preset-audio-recommended",
      message:"TikTok ad creatives generally require audio; attach licensed narration or music."});
  return issues;
}
/** Create a correctly sized document *before rendering*. Duration remains
 * editorially authored, not arbitrarily truncated to fit a platform.
 */
export function createVideoPresetManifest(
  preset:VideoPlatformPresetId,
  source:{id:string;durationFrames:number;fps:{num:number;den:number}},
):VideoPresetManifest {
  const recipe=videoPlatformPreset(preset);
  return {schemaVersion:1,id:source.id,durationFrames:source.durationFrames,
    fps:{...source.fps},width:recipe.width,height:recipe.height,preset};
}

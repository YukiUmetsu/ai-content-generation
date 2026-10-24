import { safeFrameProfileFromInset } from "@/components/visual/safe-frame";
import { videoPlatformPreset } from "@/components/video/platform-presets";

/** Reserved overlay regions are approximate authoring guidance, not official UI guarantees. */
export function portraitProfile(preset: "youtube-shorts" | "instagram-reels" | "tiktok") {
  const item = videoPlatformPreset(preset);
  return safeFrameProfileFromInset({
    id: preset, label: item.label, width: item.width, height: item.height, inset: item.safeInset,
  });
}

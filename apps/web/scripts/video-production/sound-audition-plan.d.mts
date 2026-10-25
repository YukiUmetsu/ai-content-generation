/** A short editor-only sketch: times are estimates, not exported frame timing. */
export type SoundAuditionTrigger = "shot-start" | "first-visual-reveal";
export interface SoundAuditionAsset {
  assetId: string;
  sha256: string;
  title: string;
  durationSeconds: number;
  license: string;
  rightsStatus: string;
}
export interface SoundAuditionMix {
  assetId: string;
  sha256: string;
  title?: string;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  trigger?: SoundAuditionTrigger;
}
export interface SoundAuditionLayer extends SoundAuditionMix {
  layerId: string;
  shotId: string;
  trigger: SoundAuditionTrigger;
  offsetMs: number;
}
export interface SoundAuditionChoice {
  mode: string;
  assetId: string | null;
  sha256: string | null;
  trigger: SoundAuditionTrigger;
}
export interface SoundAuditionCue {
  id: string;
  kind: "primary" | "layer" | "ambience";
  title: string;
  sha256: string;
  url: string;
  startMs: number;
  durationMs: number;
  loop: boolean;
  gain: number;
  fadeInMs: number;
  fadeOutMs: number;
}
export interface SoundAuditionPlan {
  durationMs: number;
  cues: SoundAuditionCue[];
  warnings: string[];
}
export declare function planSoundAudition(input: {
  shotId: string;
  choice?: SoundAuditionChoice | null;
  layers?: SoundAuditionLayer[];
  ambience?: SoundAuditionMix | null;
  library?: SoundAuditionAsset[];
  windowMs?: number;
}): SoundAuditionPlan;

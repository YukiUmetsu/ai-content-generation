import type { SoundAuditionPlan } from "./sound-audition-plan.mjs";

/** Browser-only playback of reviewed local sound cues. */
export declare function createSoundAuditionPlayer(
  plan: SoundAuditionPlan,
  options: {
    createContext: () => AudioContext;
    fetchImpl?: typeof fetch;
    voiceFile?: Blob | null;
  },
): {
  ready: Promise<void>;
  stop: () => void;
};

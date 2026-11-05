import type { ObjectStorySpec } from "@/components/video/object-story";
export const STORY_STAGING: Readonly<Record<"maxOnStage" | "secondChangeSeconds" | "countShare" | "settleSeconds", number>>;
export interface StoryStage { order: string[]; objects: Map<string, unknown>; unit?: unknown }
export function newStoryStage(): StoryStage;
export function directSceneStory(scene: {
  id: string; fps: { num: number; den: number }; width: number; height: number; frames: number; locale?: string;
  phrases: { text: string; startFrame: number; endFrame: number }[];
}, context: { vocabulary: unknown; stage?: StoryStage; staging?: typeof STORY_STAGING }): { spec: ObjectStorySpec; stage: StoryStage };

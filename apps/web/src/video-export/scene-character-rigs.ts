import type { ExportRigMap } from "./conversation-characters";

/** A scene may pin a separate immutable revision of an existing performer. */
export type ExportRigPlan = { characterRigs?: ExportRigMap;
  characterRigsByScene?: Record<string, ExportRigMap> };

export function characterRigsForChapter(plan: ExportRigPlan, chapterId: string): ExportRigMap {
  return { ...plan.characterRigs, ...plan.characterRigsByScene?.[chapterId] };
}

export interface GeneralVisualPlan {
  schemaVersion: 1;
  kind: "general-explainer-visual-plan";
  title: string;
  manifest: { schemaVersion: 1; id: string; durationFrames: number; width: 1920; height: 1080; fps: { num: number; den: number }; preset: "youtube" };
  chapters: Array<{ id: string; intent: "general-intro" | "general-flow" | "general-comparison" | "general-breakdown" | "general-payoff"; visual: { headline: string; subhead: string; emphasis: string; items: string[] }; startFrame: number; endFrame: number; claimRefs: string[]; eventIds: string[] }>;
  events: Record<string, number>;
  payoffEventId: string;
  disclaimer: string;
  commercialReady: false;
}
export interface GeneralFrame {
  frame: number; chapterIndex: number; chapterCount: number;
  intent: GeneralVisualPlan["chapters"][number]["intent"];
  visual: GeneralVisualPlan["chapters"][number]["visual"];
  visibleItems: number; localFrame: number; enterProgress: number; progress: number; disclaimer: string;
}
export declare function compileGeneralVisuals(job: unknown, timeline: unknown): GeneralVisualPlan;
export declare function getGeneralFrame(plan: GeneralVisualPlan, absoluteFrame: number): GeneralFrame;

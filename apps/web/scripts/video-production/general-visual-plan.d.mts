export interface QuantitativeChart {
  kind: "quantitative-chart-v1";
  categories: string[];
  series: Array<{ id: string; label: string; values: Array<number | null> }>;
  unit: string;
  provenance:
    | { basis: "measured"; disclosure: string; claimRefs: string[]; evidenceRefs: string[] }
    | { basis: "illustrative"; disclosure: string; claimRefs: string[]; assumptions: string[] };
}

export interface GeneralVisualPlan {
  schemaVersion: 1;
  kind: "general-explainer-visual-plan";
  title: string;
  locale?: "en-US" | "ja-JP";
  manifest: { schemaVersion: 1; id: string; durationFrames: number; width: 1920; height: 1080; fps: { num: number; den: number }; preset: "youtube" };
  chapters: Array<{ id: string; intent: "general-intro" | "general-flow" | "general-comparison" | "general-breakdown" | "general-payoff"; visual: { headline: string; subhead: string; emphasis: string; items: string[]; chart?: QuantitativeChart }; startFrame: number; endFrame: number; claimRefs: string[]; evidenceRefs: string[]; eventIds: string[] }>;
  claims: Array<{ id: string; status: "verified" | "unverified" | "illustrative" | "disputed"; text: string; sourceRefs?: string[] }>;
  evidence: Array<{ id: string; title: string; sourceUri: string; retrievedAt: string; passageLocator: string; snapshotSha256: string }>;
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

export type ScriptLayoutStyle =
  | "question-lens"
  | "journey"
  | "contrast"
  | "decomposition"
  | "synthesis"
  | "example"
  | "cause"
  | "warning";
export type ScriptLayoutIntent =
  | "general-intro"
  | "general-flow"
  | "general-comparison"
  | "general-breakdown"
  | "general-payoff";
export interface ScriptInteractionSlot {
  index: number;
  style: ScriptLayoutStyle;
  intent: ScriptLayoutIntent;
  phrase: string;
  /** Present only when the local model copied this claim from the spoken window. */
  line?: string;
  action?: "show" | "move" | "connect" | "compare" | "ring";
  objects?: string[];
  startFrame: number;
  endFrame: number;
}
export interface ScriptInteractionSchedule {
  source: "model" | "rules";
  slots: ScriptInteractionSlot[];
}
export interface ScriptInteractionChapter {
  startFrame: number;
  endFrame: number;
  intent?: string;
  narration?: string;
  interactions?: ScriptInteractionSchedule;
  visual?: { items?: string[] };
}
export declare function layoutIntent(style: string): ScriptLayoutIntent | null;
export declare const SCRIPT_LAYOUTS: readonly ScriptLayoutStyle[];
export declare function planScriptInteractions(input: {
  text?: string;
  frames: number;
  fps?: { num: number; den: number };
  intent?: string;
}): ScriptInteractionSchedule;
export declare function chapterInteractions(
  chapter: ScriptInteractionChapter,
  fps?: { num: number; den: number },
): ScriptInteractionSchedule;
export declare function visibleScriptPhrase(phrase: string, items?: readonly string[], visibleCount?: number): string;
export declare function interactionAt(
  schedule: ScriptInteractionSchedule,
  localFrame: number,
): ScriptInteractionSlot & { durationFrames: number; localFrame: number; progress: number };
export declare function assetMotion(style: string, progress: number): { x: number; y: number; scale: number };

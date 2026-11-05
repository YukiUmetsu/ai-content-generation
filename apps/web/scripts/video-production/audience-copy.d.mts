export const HEADLINE_MAX: number;
export const SUPPORT_MAX: number;
export const KICKER_MAX: number;
export function spokenSentences(narration: unknown): string[];
export function fitCopy(value: unknown, max: number): string;
export function sameScreenText(a: unknown, b: unknown): boolean;
export function isAuthoredScreenText(value: unknown): boolean;
export function repeatsScreenText(line: unknown, shown?: readonly unknown[]): boolean;
export interface AudienceCopy {
  headline: string;
  support: string;
  source: { headline: "authored" | "narration"; support: "authored" | "narration" | "fallback" };
}
export function audienceCopy(narration: string, options?: {
  authoredHeadline?: string; authoredSupport?: string; fallbackSupport?: string; headlineMax?: number; supportMax?: number;
}): AudienceCopy;
export type ScenePlace = "opening" | "closing" | "postscript" | "step";
export const AUDIENCE_KICKERS: Readonly<Record<string, Readonly<Record<ScenePlace, string>>>>;
export function scenePlace(shots: readonly { purpose?: string }[], index: number): ScenePlace;
export function audienceKicker(scene: {
  place: ScenePlace; index: number; total: number; locale?: string; kickers?: Record<string, Record<string, string>>;
}): string;
export function editorialLeak(shown: unknown, directions?: readonly unknown[]): "outline-label" | "direction-note" | null;

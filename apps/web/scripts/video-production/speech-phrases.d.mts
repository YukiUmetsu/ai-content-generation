export function speechPhrases(narration: string): string[];
export function phraseWindows(input: {
  phrases: string[]; frames: number; fps: { num: number; den: number }; spokenSeconds?: number;
  pauses?: { start: number; end: number }[]; snapSeconds?: number; minPhraseSeconds?: number;
}): { text: string; startFrame: number; endFrame: number }[];

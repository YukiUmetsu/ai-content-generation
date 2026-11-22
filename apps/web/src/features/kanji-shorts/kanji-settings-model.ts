/** The settings form's draft and how it maps to the config's settings. Pure. */
import type { KanjiSettings } from "./kanji-shorts-api";

/** The reuse entry that reads every kanji's name with the audio of its kun'yomi line. */
export const NAME_FROM_KUNYOMI = "{name.kana}";
/** The bottom band that keeps the card above the platforms' title and caption overlay. */
export const ABOVE_CAPTIONS = 0.19;

export type Pairs = [string, string][];
export type Draft = {
  voiceId: string; ja: string; en: string; otherVoiceIds: Record<string, string>; pace: "" | "slow" | "measured" | "fast";
  nameFromKunyomi: boolean; reuse: Pairs; retakes: Pairs; speech: Pairs;
  maxWords: string; write: string; review: string;
  /** The switch, and the file's own bottom band, kept as it is while the switch is not changed. */
  aboveCaptions: boolean; savedBottom: number | undefined; otherInset: Record<string, number>;
};

const pairsOf = (map: Record<string, string | number> | null): Pairs => Object.entries(map ?? {}).map(([key, value]) => [key, String(value)]);
const numberOrNull = (text: string) => text.trim() === "" ? null : Number(text);

export function draftFrom(settings: KanjiSettings): Draft {
  const { ja = "", en = "", ...otherVoiceIds } = settings["voice.voiceIds"] ?? {};
  const { bottom, ...otherInset } = settings["card.safeInset"] ?? {};
  const reuse = pairsOf(settings["narration.reuse"]);
  const isNameSwitch = ([key, line]: [string, string]) => key === NAME_FROM_KUNYOMI && line === "kunyomi";
  return {
    voiceId: settings["voice.voiceId"] ?? "", ja, en, otherVoiceIds, pace: settings["voice.pace"] ?? "",
    // Only the switch's own entry is the switch; "{name.kana}" read from another line stays a row.
    nameFromKunyomi: reuse.some(isNameSwitch), reuse: reuse.filter(pair => !isNameSwitch(pair)),
    retakes: pairsOf(settings["narration.retakes"]), speech: pairsOf(settings["narration.speech"]),
    maxWords: settings.maxWords?.toString() ?? "", write: settings["timing.write"]?.toString() ?? "", review: settings["timing.review"]?.toString() ?? "",
    aboveCaptions: (bottom ?? 0) > 0, savedBottom: bottom, otherInset: otherInset as Record<string, number>,
  };
}

/** What stops a draft from being saved, by kind; the form words them. */
export type DraftProblem = "reuse-row" | "retakes-row" | "speech-row" | "retake-number" | "number";
export function draftProblems(draft: Draft): DraftProblem[] {
  const half = (pairs: Pairs) => pairs.some(([key, value]) => !key.trim() !== !value.trim());
  const problems: DraftProblem[] = [];
  if (half(draft.reuse)) problems.push("reuse-row");
  if (half(draft.retakes)) problems.push("retakes-row");
  if (half(draft.speech)) problems.push("speech-row");
  if (draft.retakes.some(([key, take]) => key.trim() && take.trim() && !(Number.isInteger(Number(take)) && Number(take) >= 2 && Number(take) <= 99))) problems.push("retake-number");
  if ([draft.maxWords, draft.write, draft.review].some(text => text.trim() !== "" && !Number.isFinite(Number(text)))) problems.push("number");
  return problems;
}

/** The draft's settings in the config's shape: empty rows are left out, an empty map is the default (null). */
export function settingsFromDraft(draft: Draft): KanjiSettings {
  const map = <T,>(pairs: Pairs, value: (text: string) => T) => {
    const kept = pairs.filter(([key, text]) => key.trim() && text.trim());
    return kept.length ? Object.fromEntries(kept.map(([key, text]) => [key.trim(), value(text.trim())])) : null;
  };
  const voiceIds = { ...draft.otherVoiceIds, ...(draft.ja.trim() ? { ja: draft.ja.trim() } : {}), ...(draft.en.trim() ? { en: draft.en.trim() } : {}) };
  const reuse: Record<string, string> = map(draft.reuse, text => text) ?? {};
  if (draft.nameFromKunyomi) reuse[NAME_FROM_KUNYOMI] = "kunyomi";
  // The file's own band while the switch says the same; the standard band when it is switched on.
  const savedOn = (draft.savedBottom ?? 0) > 0;
  const bottom = draft.aboveCaptions === savedOn ? draft.savedBottom : draft.aboveCaptions ? ABOVE_CAPTIONS : undefined;
  const inset = { ...draft.otherInset, ...(bottom !== undefined ? { bottom } : {}) };
  return {
    "voice.voiceId": draft.voiceId.trim() || null,
    "voice.voiceIds": Object.keys(voiceIds).length ? voiceIds : null,
    "voice.pace": draft.pace || null,
    "narration.reuse": Object.keys(reuse).length ? reuse : null,
    "narration.retakes": map(draft.retakes, Number),
    "narration.speech": map(draft.speech, text => text),
    maxWords: numberOrNull(draft.maxWords),
    "card.safeInset": Object.keys(inset).length ? inset : null,
    "timing.write": numberOrNull(draft.write),
    "timing.review": numberOrNull(draft.review),
  };
}

/** A value as text with its keys in order, so two maps that differ only in key order compare equal. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) =>
  inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : inner);
export const sameSettings = (a: KanjiSettings, b: KanjiSettings) => canonical(a) === canonical(b);

/**
 * The settings the person changed, for a save: { path: value | null }. Compared with the settings the
 * draft was made from, so a file changed elsewhere meanwhile keeps its other changes.
 */
export function changedSettings(base: KanjiSettings, next: KanjiSettings): Partial<KanjiSettings> {
  return Object.fromEntries(Object.entries(next).filter(([path, value]) => canonical(value) !== canonical(base[path as keyof KanjiSettings])));
}

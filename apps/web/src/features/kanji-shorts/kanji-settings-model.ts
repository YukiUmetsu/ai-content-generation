/** The settings form's draft and how it maps to the config's settings. Pure. */
import type { KanjiSettings } from "./kanji-shorts-api";

/** The reuse entry that reads every kanji's name with the audio of its kun'yomi line. */
export const NAME_FROM_KUNYOMI = "{name.kana}";
/** The bottom band that keeps the card above the platforms' title and caption overlay. */
const ABOVE_CAPTIONS = 0.19;

export type Pairs = [string, string][];
const pairsOf = (map: Record<string, string | number> | null): Pairs => Object.entries(map ?? {}).map(([key, value]) => [key, String(value)]);
const numberOrNull = (text: string) => text.trim() === "" ? null : Number(text);

/** The draft's settings in the config's shape: blank entries are left out, an empty map is the default (null). */
export function settingsFromDraft(draft: Draft): KanjiSettings {
  const map = <T,>(pairs: Pairs, value: (text: string) => T) => {
    const kept = pairs.filter(([key, text]) => key.trim() && text.trim());
    return kept.length ? Object.fromEntries(kept.map(([key, text]) => [key.trim(), value(text.trim())])) : null;
  };
  const voiceIds = { ...draft.otherVoiceIds, ...(draft.ja.trim() ? { ja: draft.ja.trim() } : {}), ...(draft.en.trim() ? { en: draft.en.trim() } : {}) };
  const reuse = map(draft.reuse, text => text) ?? {};
  if (draft.nameFromKunyomi) reuse[NAME_FROM_KUNYOMI] = "kunyomi"; else delete reuse[NAME_FROM_KUNYOMI];
  const inset = { ...draft.otherInset, ...(draft.aboveCaptions ? { bottom: ABOVE_CAPTIONS } : {}) };
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

export type Draft = {
  voiceId: string; ja: string; en: string; otherVoiceIds: Record<string, string>; pace: "" | "slow" | "measured" | "fast";
  nameFromKunyomi: boolean; reuse: Pairs; retakes: Pairs; speech: Pairs;
  maxWords: string; aboveCaptions: boolean; otherInset: Record<string, number>; write: string; review: string;
};
export function draftFrom(settings: KanjiSettings): Draft {
  const { ja = "", en = "", ...otherVoiceIds } = settings["voice.voiceIds"] ?? {};
  const { bottom, ...otherInset } = settings["card.safeInset"] ?? {};
  const reuse = pairsOf(settings["narration.reuse"]);
  return {
    voiceId: settings["voice.voiceId"] ?? "", ja, en, otherVoiceIds, pace: settings["voice.pace"] ?? "",
    nameFromKunyomi: reuse.some(([key, line]) => key === NAME_FROM_KUNYOMI && line === "kunyomi"),
    reuse: reuse.filter(([key]) => key !== NAME_FROM_KUNYOMI), retakes: pairsOf(settings["narration.retakes"]), speech: pairsOf(settings["narration.speech"]),
    maxWords: settings.maxWords?.toString() ?? "", aboveCaptions: (bottom ?? 0) > 0, otherInset: otherInset as Record<string, number>,
    write: settings["timing.write"]?.toString() ?? "", review: settings["timing.review"]?.toString() ?? "",
  };
}

/** A value as text with its keys in order, so two maps that differ only in key order compare equal. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) =>
  inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : inner);

/** The settings that differ from what the file has, for a save: { path: value | null }. */
export function changedSettings(saved: KanjiSettings, next: KanjiSettings): Partial<KanjiSettings> {
  return Object.fromEntries(Object.entries(next).filter(([path, value]) => canonical(value) !== canonical(saved[path as keyof KanjiSettings])));
}

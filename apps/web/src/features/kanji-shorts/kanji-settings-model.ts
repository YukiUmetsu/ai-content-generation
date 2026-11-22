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
export type DraftProblem = "reuse-row" | "retakes-row" | "speech-row" | "retake-number" | "number" | "duplicate" | "name-clash";
export function draftProblems(draft: Draft): DraftProblem[] {
  const half = (pairs: Pairs) => pairs.some(([key, value]) => !key.trim() !== !value.trim());
  const problems: DraftProblem[] = [];
  if (half(draft.reuse)) problems.push("reuse-row");
  if (half(draft.retakes)) problems.push("retakes-row");
  if (half(draft.speech)) problems.push("speech-row");
  if (draft.retakes.some(([key, take]) => key.trim() && take.trim() && !(Number.isInteger(Number(take)) && Number(take) >= 2 && Number(take) <= 99))) problems.push("retake-number");
  if ([draft.maxWords, draft.write, draft.review].some(text => text.trim() !== "" && !Number.isFinite(Number(text)))) problems.push("number");
  const keys = (pairs: Pairs) => pairs.map(([key]) => key.trim()).filter(Boolean);
  if ([draft.reuse, draft.retakes, draft.speech].some(pairs => new Set(keys(pairs)).size !== keys(pairs).length)) problems.push("duplicate");
  // The switch reads the name from the kun'yomi line; a row for the same text would be overwritten.
  if (draft.nameFromKunyomi && keys(draft.reuse).includes(NAME_FROM_KUNYOMI)) problems.push("name-clash");
  return problems;
}

/**
 * The draft's settings in the config's shape: empty rows are left out, an empty map is the default (null).
 * Texts are kept as written (the config's own reader compares them trimmed), so a file read and saved
 * unchanged stays unchanged.
 */
export function settingsFromDraft(draft: Draft): KanjiSettings {
  const map = <T,>(pairs: Pairs, value: (text: string) => T) => {
    const kept = pairs.filter(([key, text]) => key.trim() && text.trim());
    return kept.length ? Object.fromEntries(kept.map(([key, text]) => [key, value(text)])) : null;
  };
  const voiceIds = { ...draft.otherVoiceIds, ...(draft.ja.trim() ? { ja: draft.ja } : {}), ...(draft.en.trim() ? { en: draft.en } : {}) };
  const reuse: Record<string, string> = map(draft.reuse, text => text) ?? {};
  if (draft.nameFromKunyomi) reuse[NAME_FROM_KUNYOMI] = "kunyomi";
  // The file's own band while the switch says the same; the standard band when it is switched on.
  const savedOn = (draft.savedBottom ?? 0) > 0;
  const bottom = draft.aboveCaptions === savedOn ? draft.savedBottom : draft.aboveCaptions ? ABOVE_CAPTIONS : undefined;
  const inset = { ...draft.otherInset, ...(bottom !== undefined ? { bottom } : {}) };
  return {
    "voice.voiceId": draft.voiceId.trim() ? draft.voiceId : null,
    "voice.voiceIds": Object.keys(voiceIds).length ? voiceIds : null,
    "voice.pace": draft.pace || null,
    "narration.reuse": Object.keys(reuse).length ? reuse : null,
    "narration.retakes": map(draft.retakes, text => Number(text.trim())),
    "narration.speech": map(draft.speech, text => text),
    maxWords: numberOrNull(draft.maxWords),
    "card.safeInset": Object.keys(inset).length ? inset : null,
    "timing.write": numberOrNull(draft.write),
    "timing.review": numberOrNull(draft.review),
  };
}

/**
 * A value as text with its keys in order, so two maps that differ only in key order compare equal,
 * and an empty map is the same as none (the config treats {} and a missing map alike).
 */
const canonical = (value: unknown): string => JSON.stringify(value ?? null, (_key, inner: unknown) =>
  inner && typeof inner === "object" && !Array.isArray(inner)
    ? Object.keys(inner).length ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : null
    : inner);
export const sameSettings = (a: KanjiSettings, b: KanjiSettings) => canonical(a) === canonical(b);

/** The settings that differ between two sets: { path: value | null }. */
export function changedSettings(base: KanjiSettings, next: KanjiSettings): Partial<KanjiSettings> {
  return Object.fromEntries(Object.entries(next).filter(([path, value]) => canonical(value) !== canonical(base[path as keyof KanjiSettings])));
}

/** Settings that are maps of entries: an edit changes entries, not the whole map. */
const MAPS = new Set<keyof KanjiSettings>(["voice.voiceIds", "narration.reuse", "narration.retakes", "narration.speech", "card.safeInset"]);

/**
 * What a save sends: the person's edits (from `base`, what the draft was made from, to `next`) made
 * on the file as it is now (`latest`). In a map, only the entries edited here change, so an entry
 * changed elsewhere meanwhile (another retake, the other voice) is kept.
 */
export function editsOnto(base: KanjiSettings, next: KanjiSettings, latest: KanjiSettings): Partial<KanjiSettings> {
  const out: Record<string, unknown> = {};
  for (const path of Object.keys(next) as (keyof KanjiSettings)[]) {
    if (canonical(base[path]) === canonical(next[path])) continue;
    let value: unknown = next[path];
    if (MAPS.has(path)) {
      const before = (base[path] ?? {}) as Record<string, unknown>, after = (next[path] ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...((latest[path] ?? {}) as Record<string, unknown>) };
      for (const key of Object.keys(before)) if (!(key in after)) delete merged[key];
      for (const [key, entry] of Object.entries(after)) if (canonical(before[key]) !== canonical(entry)) merged[key] = entry;
      value = Object.keys(merged).length ? merged : null;
    }
    if (canonical(value) !== canonical(latest[path])) out[path] = value;
  }
  return out as Partial<KanjiSettings>;
}

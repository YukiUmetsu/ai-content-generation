/**
 * What the person has picked and edited on the Kanji shorts page but not saved. It lives as long as
 * the Studio tab, so visiting another section and coming back finds it again.
 */
import type { KanjiSettings } from "./kanji-shorts-api";
import type { Draft } from "./kanji-settings-model";

export const keptChoice = { selection: "", shown: null as string | null };
export const keptSettings: { value: { base: KanjiSettings; draft: Draft } | null } = { value: null };

/** Forget all of it (tests start from a clean page). */
export function forgetKanjiDrafts() {
  keptChoice.selection = ""; keptChoice.shown = null; keptSettings.value = null;
}

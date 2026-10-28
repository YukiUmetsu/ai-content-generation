import { validateProjectVoices, voiceFavoritesKey, type VoiceFavorite } from "@/app/project-voice-favorites";
import type { CharacterDraft } from "./character-drafts-api";

/** Revision-pinned browser-local character voice choices. Provider consent is never persisted here. */
export type CharacterVoiceBinding = {
  draftId: string;
  characterId: string;
  revision: string;
  voice: VoiceFavorite;
};
export type CharacterVoiceBindings = { schemaVersion: 1; projectId: string; bindings: CharacterVoiceBinding[] };
const PREFIX = "contentgen:character-voices:v1:";
const validId = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max &&
  ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function characterVoicesKey(projectId: string): string {
  voiceFavoritesKey(projectId);
  return PREFIX + projectId;
}

export function validateCharacterVoiceBindings(value: unknown, projectId: string): CharacterVoiceBindings {
  characterVoicesKey(projectId);
  if (!record(value) || value.schemaVersion !== 1 || value.projectId !== projectId ||
    !Array.isArray(value.bindings) || value.bindings.length > 250) {
    throw Error("Saved character voices are incompatible. Original data remains untouched.");
  }
  const seen = new Set<string>();
  const bindings = value.bindings.map((entry: unknown) => {
    if (!record(entry) || !/^character-draft-[a-f0-9]{32}$/.test(String(entry.draftId)) ||
      !validId(entry.characterId, 80) || !validId(entry.revision, 64)) {
      throw Error("Saved character voice refers to an invalid draft or revision.");
    }
    if (seen.has(entry.draftId as string)) throw Error("One character revision cannot have duplicate voice assignments.");
    seen.add(entry.draftId as string);
    const voice = validateProjectVoices({schemaVersion:1,projectId,voices:[entry.voice]},projectId).voices[0];
    return {draftId:entry.draftId as string,characterId:entry.characterId as string,
      revision:entry.revision as string,voice};
  });
  return {schemaVersion:1,projectId,bindings};
}

export function readCharacterVoiceBindings(projectId: string,
  storage: Pick<Storage, "getItem"> = localStorage): CharacterVoiceBindings {
  const raw = storage.getItem(characterVoicesKey(projectId));
  if (raw === null) return {schemaVersion:1,projectId,bindings:[]};
  try { return validateCharacterVoiceBindings(JSON.parse(raw) as unknown,projectId); }
  catch (caught) { throw Error((caught instanceof Error ? caught.message : "Cannot read saved character voices.") +
    " Reload or restore these settings; the existing data has not been overwritten."); }
}

export function changeCharacterVoice(registry: CharacterVoiceBindings, draft: CharacterDraft,
  choice: VoiceFavorite | null): CharacterVoiceBindings {
  if (draft.projectId !== registry.projectId || !/^character-draft-[a-f0-9]{32}$/.test(draft.id))
    throw Error("Cannot assign a voice from a different project or an invalid character revision.");
  const bindings = registry.bindings.filter(item => item.draftId !== draft.id);
  if (choice) {
    const voice = validateProjectVoices({schemaVersion:1,projectId:registry.projectId,voices:[choice]},registry.projectId).voices[0];
    bindings.push({draftId:draft.id,characterId:draft.characterId,revision:draft.revision,voice});
  }
  return validateCharacterVoiceBindings({schemaVersion:1,projectId:registry.projectId,bindings},registry.projectId);
}

export function saveCharacterVoiceBindings(next: CharacterVoiceBindings, expected: CharacterVoiceBindings,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const valid = validateCharacterVoiceBindings(next,next.projectId);
  const key = characterVoicesKey(valid.projectId);
  const previous = readCharacterVoiceBindings(valid.projectId,storage);
  if (JSON.stringify(previous) !== JSON.stringify(expected))
    throw Error("Character voice choices changed in another tab. Reload before saving to avoid lost updates.");
  storage.setItem(key,JSON.stringify(valid));
}

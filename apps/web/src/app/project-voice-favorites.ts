/** Browser-local project voice favorites. No credentials, consent or audio samples are stored. */
export const DEFAULT_FISH_VOICE_ID = "6ab4c6b0f37f4243a99046478647be94";
export type VoiceProvider = "fish" | "local";
export type VoiceGender = "unspecified" | "female" | "male" | "nonbinary";
export type VoiceFavorite = {
  provider: VoiceProvider;
  voiceId: string;
  name: string;
  gender: VoiceGender;
  situation: string;
  language: string;
};
export type ProjectVoiceFavorites = { schemaVersion: 1; projectId: string; voices: VoiceFavorite[] };

const PREFIX = "contentgen:project-voice-favorites:v1:";
const NARRATOR_PREFIX = "contentgen:production-voice-profile:v2:";
const MAX_VOICES = 16;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const safeText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= limit &&
  ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function voiceFavoritesKey(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(projectId)) throw Error("Invalid project ID for saved voices.");
  return PREFIX + projectId;
}

export function projectNarratorSettingsKey(projectId: string): string {
  voiceFavoritesKey(projectId);
  return NARRATOR_PREFIX + projectId;
}

/** Call only after a confirmed project deletion has successfully saved. */
export function clearProjectVoiceData(projectId: string,
  storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(voiceFavoritesKey(projectId));
  storage.removeItem(projectNarratorSettingsKey(projectId));
}

export function defaultProjectVoices(projectId: string): ProjectVoiceFavorites {
  voiceFavoritesKey(projectId);
  return { schemaVersion: 1, projectId, voices: [
    { provider: "fish", voiceId: DEFAULT_FISH_VOICE_ID, name: "Fish default",
      gender: "unspecified", situation: "narration", language: "und" },
  ] };
}

function validateFavorite(value: unknown): VoiceFavorite {
  if (!isRecord(value) || (value.provider !== "fish" && value.provider !== "local") ||
    !safeText(value.voiceId, 128) || (value.provider === "fish" && !/^[a-f0-9]{32}$/.test(value.voiceId)) ||
    !safeText(value.name, 72) || !["unspecified", "female", "male", "nonbinary"].includes(String(value.gender)) ||
    !safeText(value.situation, 48) || !safeText(value.language, 35)) {
    throw Error("Saved voice has invalid provider, ID, name, or tags.");
  }
  if (value.language !== "und") {
    try { if (Intl.getCanonicalLocales(value.language as string).length !== 1) throw Error(); }
    catch { throw Error("Choose a valid language code, such as en or ja."); }
  }
  return { provider: value.provider as VoiceProvider, voiceId: value.voiceId as string,
    name: value.name as string, gender: value.gender as VoiceGender,
    situation: value.situation as string, language: value.language as string };
}

export function validateProjectVoices(value: unknown, projectId: string): ProjectVoiceFavorites {
  voiceFavoritesKey(projectId);
  if (!isRecord(value) || value.schemaVersion !== 1 || value.projectId !== projectId ||
    !Array.isArray(value.voices) || value.voices.length > MAX_VOICES) {
    throw Error("Saved project voices are incompatible. Original data has not been overwritten.");
  }
  const voices = value.voices.map(validateFavorite), seen = new Set<string>();
  for (const voice of voices) {
    const id = `${voice.provider}:${voice.voiceId}`;
    if (seen.has(id)) throw Error("A voice ID cannot appear twice for the same provider.");
    seen.add(id);
  }
  return {schemaVersion:1,projectId,voices};
}

export function readProjectVoices(projectId: string, storage: Pick<Storage, "getItem"> = localStorage): ProjectVoiceFavorites {
  const raw = storage.getItem(voiceFavoritesKey(projectId));
  if (raw === null) return defaultProjectVoices(projectId);
  try { return validateProjectVoices(JSON.parse(raw) as unknown, projectId); }
  catch (error) { throw Error((error instanceof Error ? error.message : "Cannot read saved voices.") +
    " Restore the saved data before editing this project's voices."); }
}

export function saveProjectVoices(value: ProjectVoiceFavorites,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage, expected?: ProjectVoiceFavorites): void {
  const checked = validateProjectVoices(value, value.projectId);
  const key = voiceFavoritesKey(value.projectId);
  if (expected) {
    const raw = storage.getItem(key);
    const current = raw === null ? defaultProjectVoices(value.projectId) :
      validateProjectVoices(JSON.parse(raw) as unknown, value.projectId);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw Error("Project voices changed in another tab. Reload before editing to avoid losing changes.");
    }
  }
  storage.setItem(key, JSON.stringify(checked));
}

export function addVoiceFavorite(library: ProjectVoiceFavorites, entry: VoiceFavorite): ProjectVoiceFavorites {
  const voice = validateFavorite(entry);
  if (library.voices.some(item => item.provider === voice.provider && item.voiceId === voice.voiceId))
    throw Error("That voice is already saved in this project. Edit its tags instead.");
  return validateProjectVoices({...library,voices:[...library.voices,voice]},library.projectId);
}

export function updateVoiceFavorite(library: ProjectVoiceFavorites, original: VoiceFavorite,
  updated: VoiceFavorite): ProjectVoiceFavorites {
  const index=library.voices.findIndex(item=>item.provider===original.provider&&item.voiceId===original.voiceId);
  if(index<0)throw Error("This saved voice was removed. Reload the list and try again.");
  const voices=[...library.voices];voices[index]=validateFavorite(updated);
  return validateProjectVoices({...library,voices},library.projectId);
}

export function removeVoiceFavorite(library: ProjectVoiceFavorites, voice: VoiceFavorite): ProjectVoiceFavorites {
  return validateProjectVoices({...library,voices:library.voices.filter(item=>
    item.provider!==voice.provider||item.voiceId!==voice.voiceId)},library.projectId);
}

/** Rank 0 = primary, rank 1 = secondary. Reordering never sends any provider request. */
export function rankVoiceFavorite(library: ProjectVoiceFavorites, voice: VoiceFavorite, rank: number): ProjectVoiceFavorites {
  const voices=[...library.voices];
  const index=voices.findIndex(item=>item.provider===voice.provider&&item.voiceId===voice.voiceId);
  if(index<0||!Number.isInteger(rank)||rank<0||rank>=voices.length)throw Error("Unknown voice priority.");
  voices.splice(rank,0,...voices.splice(index,1));
  return validateProjectVoices({...library,voices},library.projectId);
}

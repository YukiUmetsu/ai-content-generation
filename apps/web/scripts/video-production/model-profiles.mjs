/** Locally persisted, credential-free LLM profiles shared by Studio and CLI stages. */
import { randomUUID } from "node:crypto";
import { readFile, rename, mkdir, writeFile, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { localChatEndpoint } from "./topic-generator.mjs";
import { DEFAULT_MODEL_ENDPOINT, MODEL_SETTINGS_PATH, validateResearchModelSettings,
  validateResearchGeneration } from "./research-model-settings.mjs";

export const MODEL_PROFILES_PATH = fileURLToPath(new URL("../../../../data/local-ai-profiles.json", import.meta.url));
export const PROVIDER_ENDPOINTS = Object.freeze({
  ollama: DEFAULT_MODEL_ENDPOINT,
  magnitude: "http://127.0.0.1:10100/inference/v1/chat/completions",
  "lm-studio": "http://127.0.0.1:1234/v1/chat/completions",
});
export const MODEL_TASKS = Object.freeze(["research", "story", "hooks", "script"]);
const fields = (value, keys) => !value || typeof value !== "object" || Array.isArray(value) ||
  Object.keys(value).some(key => !keys.includes(key));
const text = (value, label, max) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value))
    throw Error(`${label} must contain 1–${max} safe characters.`);
  return value.trim();
};

export function validateModelProfiles(candidate) {
  if (fields(candidate, ["version", "profiles", "defaultProfileId", "assignments", "generation"]) || candidate.version !== 1 ||
    !Array.isArray(candidate.profiles) || candidate.profiles.length < 1 || candidate.profiles.length > 12)
    throw Error("Expected local-ai-profiles/v1 with 1–12 profiles.");
  const profiles = candidate.profiles.map(profile => {
    if (fields(profile, ["id", "name", "provider", "endpoint", "model"]))
      throw Error("Unexpected model profile field.");
    const id = text(profile.id, "Profile ID", 48);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(id)) throw Error("Invalid model profile ID.");
    const name = text(profile.name, "Profile name", 80);
    if (!["magnitude", "ollama", "lm-studio", "custom"].includes(profile.provider))
      throw Error("Unknown local AI provider.");
    const endpoint = localChatEndpoint(profile.endpoint);
    if (typeof profile.model !== "string" || profile.model.length > 120 || /[\u0000-\u001f\u007f]/u.test(profile.model))
      throw Error("Model ID must contain at most 120 safe characters.");
    return { id, name, provider: profile.provider, endpoint, model: profile.model.trim() };
  });
  const ids = new Set(profiles.map(p => p.id));
  if (ids.size !== profiles.length) throw Error("Duplicate model profile ID.");
  if (!ids.has(candidate.defaultProfileId)) throw Error("Default model profile does not exist.");
  if (fields(candidate.assignments, MODEL_TASKS)) throw Error("Invalid model task assignments.");
  const assignments = {};
  for (const [task, id] of Object.entries(candidate.assignments)) {
    if (!ids.has(id)) throw Error(`Assignment for ${task} references a missing profile.`);
    assignments[task] = id;
  }
  return { version: 1, profiles, defaultProfileId: candidate.defaultProfileId, assignments,
    generation:validateResearchGeneration(candidate.generation) };
}

const providerForEndpoint = endpoint => endpoint?.includes("/inference/v1/") ? "magnitude" :
  endpoint === PROVIDER_ENDPOINTS["lm-studio"] ? "lm-studio" : endpoint === PROVIDER_ENDPOINTS.ollama ? "ollama" : "custom";
const starter = (legacy) => ({ version: 1, profiles: [{ id: "local-default", name: legacy ? "Imported research model" : "Local model", provider: providerForEndpoint(legacy?.endpoint ?? DEFAULT_MODEL_ENDPOINT),
  endpoint: legacy?.endpoint ?? DEFAULT_MODEL_ENDPOINT, model: legacy?.model ?? "" }], defaultProfileId: "local-default", assignments: {} });
function legacyProfiles(legacyPath) {
  try {
    return validateResearchModelSettings(JSON.parse(readFileSync(legacyPath, "utf8")));
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export function readModelProfilesSync(path = MODEL_PROFILES_PATH, legacyPath = MODEL_SETTINGS_PATH) {
  try { return validateModelProfiles(JSON.parse(readFileSync(path, "utf8"))); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const legacy = legacyProfiles(legacyPath);
    return starter(legacy);
  }
}
export async function readModelProfiles(path = MODEL_PROFILES_PATH, legacyPath = MODEL_SETTINGS_PATH) {
  try { return validateModelProfiles(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { return starter(validateResearchModelSettings(JSON.parse(await readFile(legacyPath, "utf8")))); }
    catch (legacyError) { if (legacyError.code === "ENOENT") return starter(null); throw legacyError; }
  }
}
export async function saveModelProfiles(candidate, path = MODEL_PROFILES_PATH) {
  const clean = validateModelProfiles(candidate);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(clean, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  return clean;
}
export function modelForTask(profiles, task) {
  if (!MODEL_TASKS.includes(task)) throw Error("Unknown model task.");
  const clean = validateModelProfiles(profiles);
  const selectedId = clean.assignments[task] ?? clean.defaultProfileId;
  const profile = clean.profiles.find(p => p.id === selectedId);
  return { endpoint: profile.endpoint, model: profile.model,
    ...(task==="story"?{generation:clean.generation}:{}) };
}
export function resolveModelForTaskSync(task, { path = MODEL_PROFILES_PATH, legacyPath = MODEL_SETTINGS_PATH } = {}) {
  return modelForTask(readModelProfilesSync(path, legacyPath), task);
}
export async function resolveModelForTask(task, { path = MODEL_PROFILES_PATH, legacyPath = MODEL_SETTINGS_PATH } = {}) {
  return modelForTask(await readModelProfiles(path, legacyPath), task);
}

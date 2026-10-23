/** Shared disk-backed local model selection. No API keys, no cloud endpoints. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localChatEndpoint } from "./topic-generator.mjs";

export const MODEL_SETTINGS_PATH = fileURLToPath(new URL("../../../../data/research-model.json", import.meta.url));
export const DEFAULT_MODEL_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
export function validateResearchModelSettings(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
    Object.keys(candidate).some(k => !["version","endpoint","model"].includes(k)) ||
    candidate.version !== 1)
    throw Error("Expected research-model-settings/v1 with endpoint and model.");
  const endpoint = localChatEndpoint(candidate.endpoint);
  if (typeof candidate.model !== "string" || !candidate.model.trim() ||
    candidate.model.length > 120 || /[\u0000-\u001f]/u.test(candidate.model))
    throw Error("Choose an installed local research model ID (1–120 characters).");
  return { version: 1, endpoint, model: candidate.model.trim() };
}
export function readResearchModelSettingsSync(path = MODEL_SETTINGS_PATH) {
  try { return validateResearchModelSettings(JSON.parse(readFileSync(path, "utf8"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function readResearchModelSettings(path = MODEL_SETTINGS_PATH) {
  try { return validateResearchModelSettings(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function saveResearchModelSettings(candidate, path = MODEL_SETTINGS_PATH) {
  const clean = validateResearchModelSettings(candidate);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(clean, null, 2) + "\n", { mode: 0o600 });
  return clean;
}
export function modelsEndpoint(chatEndpoint) {
  const url = new URL(localChatEndpoint(chatEndpoint));
  url.pathname = "/v1/models";
  return url.href;
}
export async function discoverResearchModels(endpoint, { transport = fetch } = {}) {
  const url = modelsEndpoint(endpoint);
  const response = await transport(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error("Local model server returned HTTP " + response.status + ".");
  if (Number(response.headers.get("content-length") ?? 0) > 64000)
    throw Error("Local model list exceeds 64 KiB.");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 64000) throw Error("Local model list exceeds 64 KiB.");
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.data)) throw Error("Local server did not return OpenAI-compatible /v1/models.");
  return [...new Set(payload.data.map(x => x?.id).filter(x => typeof x === "string" &&
    x.length > 0 && x.length <= 120 && !/[\u0000-\u001f]/u.test(x)))].slice(0, 100);
}

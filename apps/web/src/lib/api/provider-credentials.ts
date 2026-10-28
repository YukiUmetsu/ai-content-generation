/** Local-only provider settings client. Raw credentials are write-only. */

const PREFIX = `${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}/api/settings`;

export interface ProviderConnection {
  id: "youtube" | "fish";
  configured: boolean;
  source: "keychain" | "environment" | "missing" | "unavailable" | "error";
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw Error("Invalid local provider settings response.");
  }
  return value as Record<string, unknown>;
}

export function parseConnection(value: unknown): ProviderConnection {
  const raw = record(value);
  if (!["youtube", "fish"].includes(String(raw.id)) || typeof raw.configured !== "boolean" ||
      !["keychain", "environment", "missing", "unavailable", "error"].includes(String(raw.source)) ||
      raw.configured !== ["keychain", "environment"].includes(String(raw.source))) {
    throw Error("Invalid provider connection status from local server.");
  }
  return { id: raw.id as ProviderConnection["id"], configured: raw.configured, source: raw.source as ProviderConnection["source"] };
}

async function request(path: string, method = "GET", key?: string, token?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${PREFIX}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(key === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token === undefined ? {} : { "X-Contentgen-Settings": token }),
      },
      body: key === undefined ? undefined : JSON.stringify({ key }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw Error("Cannot reach the local ContentGen settings service.");
  }
  if (!response.ok) {
    // Never display arbitrary response text: it might accidentally contain a key.
    throw Error(`Local credential request failed (HTTP ${response.status}).`);
  }
  if (response.status === 204) return null;
  try { return await response.json() as unknown; }
  catch { throw Error("Invalid JSON from the local credentials service."); }
}

async function sessionToken(): Promise<string> {
  const raw = record(await request("/session"));
  if (typeof raw.token !== "string" || !/^[\w-]{8,256}$/.test(raw.token)) {
    throw Error("Invalid local settings session.");
  }
  return raw.token;
}

export async function loadProviderConnections(): Promise<ProviderConnection[]> {
  const raw = record(await request("/providers"));
  if (!Array.isArray(raw.providers) || raw.providers.length !== 2) {
    throw Error("Invalid provider connections list from local server.");
  }
  const providers = raw.providers.map(parseConnection);
  if (new Set(providers.map(provider => provider.id)).size !== 2) throw Error("Duplicate or missing provider connections.");
  return providers;
}

export async function saveProviderKey(provider: ProviderConnection["id"], key: string): Promise<ProviderConnection> {
  if (key.trim() !== key || key.length < 8 || key.length > 512 || /[\r\n\0]/.test(key)) {
    throw Error("Enter a valid API key (8–512 characters, no surrounding spaces).");
  }
  const token = await sessionToken();
  const result = parseConnection(await request(`/providers/${provider}/key`, "PUT", key, token));
  if (result.id !== provider) throw Error("Local server returned a different provider status.");
  return result;
}

export async function deleteProviderKey(provider: ProviderConnection["id"]): Promise<void> {
  const token = await sessionToken();
  await request(`/providers/${provider}/key`, "DELETE", undefined, token);
}

export const saveYoutubeKey = (key: string) => saveProviderKey("youtube", key);
export const deleteYoutubeKey = () => deleteProviderKey("youtube");

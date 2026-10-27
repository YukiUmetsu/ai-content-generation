import { CHARACTER_PACK_LIMITS } from "./character-pack";

const ROOT = `${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}/api/character-drafts`;

export interface CharacterDraft {
  id: string;
  projectId: string;
  characterId: string;
  revision: string;
  archiveSha256: string;
  sizeBytes: number;
  status: "unverified";
  createdAt: string;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid Character Studio server response.");
  return value as Record<string, unknown>;
};

export function parseDraft(value: unknown): CharacterDraft {
  const obj = record(value);
  const str = (key: string, limit: number) => typeof obj[key] === "string" && (obj[key] as string).length > 0 && (obj[key] as string).length <= limit;
  if (typeof obj.id !== "string" || !/^character-draft-[a-f0-9]{32}$/.test(obj.id) ||
      !str("projectId", 120) || !str("characterId", 80) || !str("revision", 64) ||
      !str("createdAt", 50) || typeof obj.archiveSha256 !== "string" || !/^[0-9a-f]{64}$/.test(obj.archiveSha256) ||
      !Number.isSafeInteger(obj.sizeBytes) || (obj.sizeBytes as number) < 22 ||
      (obj.sizeBytes as number) > CHARACTER_PACK_LIMITS.compressedBytes || obj.status !== "unverified") {
    throw Error("The local server returned an invalid character draft. Check server compatibility.");
  }
  return obj as unknown as CharacterDraft;
}

const params = (values: Record<string, string>) => `?${new URLSearchParams(values).toString()}`;

async function request(path: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ROOT}${path}`, { ...init, cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      if (response.status === 409) throw Error("This revision already has different artwork. Change its revision in character.json before saving.");
      if (response.status === 413) throw Error("The ZIP exceeds the 16 MiB server limit.");
      throw Error(`Character Studio server rejected the request (HTTP ${response.status}).`);
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw Error("Character Studio server timed out. Check that the local Rust service is running.");
    if (error instanceof TypeError) throw Error("Cannot reach the local Character Studio server. Start ContentGen's Rust server.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listCharacterDrafts(projectId: string): Promise<CharacterDraft[]> {
  const response = await request(params({ projectId }), { method: "GET", headers: { Accept: "application/json" } }, 12_000);
  const data = record(await response.json() as unknown);
  if (!Array.isArray(data.drafts) || data.drafts.length > 250) throw Error("Invalid Character Studio draft list.");
  const drafts = data.drafts.map(parseDraft);
  if (drafts.some(draft => draft.projectId !== projectId)) throw Error("Character Studio returned drafts from another project.");
  return drafts;
}

export async function saveCharacterDraft(projectId: string, characterId: string, revision: string, bytes: ArrayBuffer): Promise<CharacterDraft> {
  if (bytes.byteLength > CHARACTER_PACK_LIMITS.compressedBytes) throw Error("ZIP exceeds 16 MiB.");
  const response = await request(params({ projectId, characterId, revision }), {
    method: "POST", headers: { "Content-Type": "application/zip", "X-Contentgen-Character": "local-only", Accept: "application/json" },
    body: bytes,
  });
  const draft = parseDraft(await response.json() as unknown);
  if (draft.projectId !== projectId || draft.characterId !== characterId || draft.revision !== revision || draft.sizeBytes !== bytes.byteLength) {
    throw Error("Character draft response does not match the imported package.");
  }
  return draft;
}

export async function loadCharacterDraft(projectId: string, draft: CharacterDraft): Promise<ArrayBuffer> {
  if (draft.projectId !== projectId || !/^character-draft-[a-f0-9]{32}$/.test(draft.id)) throw Error("Invalid character draft reference.");
  const response = await request(`/${draft.id}/archive${params({ projectId })}`, { method: "GET", headers: { Accept: "application/zip" } });
  if (!response.headers.get("content-type")?.startsWith("application/zip")) throw Error("Character Studio did not return a ZIP archive.");
  const headerSize = Number(response.headers.get("content-length"));
  if (headerSize > CHARACTER_PACK_LIMITS.compressedBytes) throw Error("Saved ZIP exceeds the import limit.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== draft.sizeBytes || bytes.byteLength > CHARACTER_PACK_LIMITS.compressedBytes) throw Error("Downloaded character archive has an unexpected size.");
  if (!globalThis.crypto?.subtle) throw Error("Cannot verify the saved ZIP checksum in this browser.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== draft.archiveSha256) throw Error("Downloaded character archive failed its checksum verification.");
  return bytes;
}

/** Same-origin, scoped download; server forces ZIP attachment and no sniffing. */
export function characterDraftArchiveUrl(projectId: string, draft: CharacterDraft): string {
  if (draft.projectId !== projectId || !/^character-draft-[a-f0-9]{32}$/.test(draft.id)) throw Error("Invalid character draft reference.");
  return `${ROOT}/${draft.id}/archive${params({ projectId })}`;
}

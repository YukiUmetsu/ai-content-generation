import { PIP_RIG, QUILL_RIG } from "@/video-export/pip-quill-rigs";
import type { CharacterDefinition } from "@/components/character/definition";
import { CHARACTER_PACK_LIMITS } from "./character-pack";

/** Checked-in local ZIPs are the exact original vector rigs used by the video exporter,
 * rasterized to stable 360×420 transparent PNG layers for the Studio importer. */
export const STARTER_CHARACTERS = [
  {id: "pip", name: "Pip", definition: PIP_RIG, color: "#83E5CB", description: "Curious, energetic guide",
    sha256: "05d5bb57e96f0c6071a52ff3f5394872d1a61d77325bdf2fb39b30811d87e91f"},
  {id: "quill", name: "Quill", definition: QUILL_RIG, color: "#C5BFFF", description: "Thoughtful, precise explainer",
    sha256: "44f7a0f7601e8110abafe631aa95b44857ab14b7b10b739bcf90db5f948f259f"},
] as const satisfies ReadonlyArray<{id: string; name: string; definition: CharacterDefinition;
  color: string; description: string; sha256: string}>;

export type StarterCharacterId = typeof STARTER_CHARACTERS[number]["id"];

export function starterArchiveUrl(id: StarterCharacterId): string {
  if (!STARTER_CHARACTERS.some(starter => starter.id === id)) throw Error("Unknown bundled character.");
  return `/starter-characters/${id}.zip`;
}

/** Source and ZIP hash verification precede import/save. No third-party URL or voice permission. */
export async function loadStarterArchive(id: StarterCharacterId): Promise<ArrayBuffer> {
  const starter = STARTER_CHARACTERS.find(candidate => candidate.id === id);
  if (!starter) throw Error("Unknown bundled character.");
  let response: Response;
  try { response = await fetch(starterArchiveUrl(id), {cache: "no-store", credentials: "same-origin"}); }
  catch { throw Error(`Could not load ${starter.name}. Check that the ContentGen web app is running.`); }
  if (!response.ok) throw Error(`${starter.name}'s built-in ZIP is missing (HTTP ${response.status}). Rebuild bundled character packs.`);
  const size = Number(response.headers.get("content-length"));
  if (size > CHARACTER_PACK_LIMITS.compressedBytes) throw Error(`${starter.name}'s ZIP exceeds the 16 MB import limit.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 22 || bytes.byteLength > CHARACTER_PACK_LIMITS.compressedBytes)
    throw Error(`${starter.name}'s ZIP is empty or exceeds the import limit.`);
  if (!globalThis.crypto?.subtle) throw Error("Browser SHA-256 is required to verify bundled characters.");
  const sha = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(sha), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== starter.sha256) throw Error(`${starter.name}'s bundled ZIP failed integrity verification. Reinstall the web assets.`);
  return bytes;
}

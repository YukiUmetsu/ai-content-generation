import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { webcrypto as nodeCrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { DecompressionStream as NodeDecompressionStream } from "node:stream/web";
import { validateCharacterDefinition } from "@/components/character/validate";
import type { CharacterDefinition } from "@/components/character/definition";
import { inspectCharacterZip } from "./character-pack";
import { STARTER_CHARACTERS, loadStarterArchive, starterArchiveUrl } from "./starter-characters";

// Vitest rewrites import.meta.url to a virtual browser URL in jsdom; fixture
// reads must use the web package's actual process working directory.
const starterFile=(id:string)=>resolve(process.cwd(),"public","starter-characters",`${id}.zip`);

beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("DecompressionStream", NodeDecompressionStream);
  vi.stubGlobal("crypto", nodeCrypto);
});
afterAll(() => vi.unstubAllGlobals());

describe("original bundled character ZIPs", () => {
  for (const starter of STARTER_CHARACTERS) {
    it(`${starter.name} is a real importable rig with its exact source parts, gestures and rights metadata`, async () => {
      const bytes = await readFile(starterFile(starter.id));
      expect(bytes.byteLength).toBeGreaterThan(1_000);
      const pack = await inspectCharacterZip(Uint8Array.from(bytes).buffer);
      expect(pack.issues).toEqual([]);
      expect(pack.definition).toMatchObject({
        schemaVersion: 1, characterId: starter.id, revision: starter.definition.revision,
        mode: "puppet-2.5d", channels: starter.definition.channels,
        parts: starter.definition.parts, actions: starter.definition.actions,
        expressions: starter.definition.expressions, speech: starter.definition.speech,
      });
      expect(pack.images.size).toBe(Object.keys(starter.definition.assets).length);
      // The ZIP inspector intentionally validates only the safe import subset;
      // also exercise the independent actual animation-definition contract.
      expect(validateCharacterDefinition(pack.definition as unknown as CharacterDefinition)
        .filter(diagnostic=>diagnostic.severity==="error")).toEqual([]);
      expect(Object.values(pack.definition.assets).every(asset=>asset.kind==="image" && asset.sha256)).toBe(true);
      expect(Object.values(pack.definition.assets).every(asset=>asset.provenance.source.includes("ContentGen"))).toBe(true);
      for(const image of pack.images.values()) expect(image.type).toBe("image/png");
    });
  }

  it("fetches only the pinned local ZIP and rejects missing/tampered packages before import", async () => {
    const bytes=await readFile(starterFile("pip"));
    const good=Uint8Array.from(bytes).buffer;
    const fetcher=vi.fn().mockImplementation(async()=>new Response(good,{headers:{"content-length":String(bytes.length)}}));
    vi.stubGlobal("fetch",fetcher);
    try {
      const result=await loadStarterArchive("pip");
      expect(result.byteLength).toBe(bytes.length);
      expect(fetcher).toHaveBeenCalledWith("/starter-characters/pip.zip",{cache:"no-store",credentials:"same-origin"});
      const bad=new Uint8Array(good.slice(0));bad[bad.length-25]^=1;
      fetcher.mockResolvedValueOnce(new Response(bad.buffer));
      await expect(loadStarterArchive("pip")).rejects.toThrow(/integrity verification/i);
      fetcher.mockResolvedValueOnce(new Response(null,{status:404}));
      await expect(loadStarterArchive("pip")).rejects.toThrow(/missing.*404/i);
      fetcher.mockResolvedValueOnce(new Response(new Uint8Array(16*1024*1024+1)));
      await expect(loadStarterArchive("pip")).rejects.toThrow(/16 MB import limit/i);
      expect(()=>starterArchiveUrl("../../admin" as "pip")).toThrow(/Unknown bundled character/u);
    } finally {vi.unstubAllGlobals();}
  });
});

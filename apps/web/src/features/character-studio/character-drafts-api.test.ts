import { afterEach, describe, expect, it, vi } from "vitest";
import { listCharacterDrafts, parseDraft, saveCharacterDraft } from "./character-drafts-api";

const fixture = {
  id: "character-draft-0123456789abcdef0123456789abcdef",
  projectId: "project-local", characterId: "pip", revision: "1",
  archiveSha256: "a".repeat(64), sizeBytes: 35,
  status: "unverified", createdAt: "2026-10-26T12:00:00Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("saved Character Studio drafts", () => {
  it("rejects unsupported approval states and malformed server metadata", () => {
    expect(parseDraft(fixture).status).toBe("unverified");
    expect(() => parseDraft({ ...fixture, status: "approved" })).toThrow(/invalid character draft/);
    expect(() => parseDraft({ ...fixture, archiveSha256: "forged" })).toThrow(/invalid character draft/);
  });

  it("lists only the active project and rejects cross-project responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ drafts: [fixture] }), {
      headers: { "content-type": "application/json" }, status: 200,
    })));
    expect(await listCharacterDrafts("project-local")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("projectId=project-local");
    await expect(listCharacterDrafts("another-project")).rejects.toThrow(/another project/);
  });

  it("uploads ZIP bytes with local-only editing header and detects mismatched identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), {
      status: 201, headers: { "content-type": "application/json" },
    })));
    const archive = new ArrayBuffer(35);
    expect((await saveCharacterDraft("project-local", "pip", "1", archive)).id).toBe(fixture.id);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("characterId=pip&revision=1");
    expect(options?.headers).toMatchObject({ "Content-Type": "application/zip", "X-Contentgen-Character": "local-only" });
    expect(options?.body).toBe(archive);
    await expect(saveCharacterDraft("project-local", "other", "1", archive)).rejects.toThrow(/does not match/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CharacterPackInspector } from "./CharacterPackInspector";
import { inspectCharacterZip } from "./character-pack";
import { listCharacterDrafts, loadCharacterDraft, saveCharacterDraft } from "./character-drafts-api";
import type { InspectedCharacterPack } from "./character-pack";

vi.mock("./character-pack", async importOriginal => {
  const module = await importOriginal<typeof import("./character-pack")>();
  return { ...module, inspectCharacterZip: vi.fn() };
});
vi.mock("./character-drafts-api", async importOriginal => {
  const module = await importOriginal<typeof import("./character-drafts-api")>();
  return { ...module, listCharacterDrafts: vi.fn(), loadCharacterDraft: vi.fn(), saveCharacterDraft: vi.fn() };
});

const sprite = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const fixture: InspectedCharacterPack = {
  definition: {
    schemaVersion: 1, characterId: "pip", revision: "1", mode: "sprite-2d",
    design: { width: 512, height: 512 }, channels: ["body"], palette: {},
    assets: { torso: { kind: "image", uri: "layers/torso.png", mediaType: "image/png", width: 8, height: 8,
      provenance: { source: "original", license: "CC0" } } },
    parts: [{ id: "body", channel: "body", asset: "torso", pivot: { x: 3, y: 3 }, z: 0 }],
    poses: { idle: {} }, basePose: "idle", capabilities: [],
  },
  parts: [{ id: "body", channel: "body", asset: "torso", pivot: { x: 3, y: 3 }, z: 0 }],
  images: new Map([["layers/torso.png", sprite]]), issues: [], compressedBytes: 500, expandedBytes: 1200,
};
const existingArrayBuffer = Object.getOwnPropertyDescriptor(File.prototype, "arrayBuffer");

beforeEach(() => {
  vi.mocked(inspectCharacterZip).mockReset();
  vi.mocked(listCharacterDrafts).mockReset().mockResolvedValue([]);
  vi.mocked(loadCharacterDraft).mockReset();
  vi.mocked(saveCharacterDraft).mockReset();
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:local-character"), revokeObjectURL: vi.fn() });
  Object.defineProperty(File.prototype, "arrayBuffer", { configurable: true, value: vi.fn(async () => new ArrayBuffer(8)) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (existingArrayBuffer) Object.defineProperty(File.prototype, "arrayBuffer", existingArrayBuffer);
  else Reflect.deleteProperty(File.prototype, "arrayBuffer");
});

describe("CharacterPackInspector", () => {
  it("previews safely inspected layers and revokes temporary URLs when unmounted", async () => {
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    const { unmount } = render(<CharacterPackInspector locale="en" projectId="project-local" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    expect(await screen.findByText("Structure checked")).toBeInTheDocument();
    expect(screen.getByText(/cannot be used for publishing yet/)).toBeInTheDocument();
    expect(screen.getByAltText("body sprite layer")).toHaveAttribute("src", "blob:local-character");
    expect(inspectCharacterZip).toHaveBeenCalledTimes(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-character");
  });

  it("shows a safe, actionable error without inventing a saved character", async () => {
    vi.mocked(inspectCharacterZip).mockRejectedValue(Error("Missing character.json at the ZIP root."));
    render(<CharacterPackInspector locale="ja" projectId="project-local" />);
    fireEvent.change(screen.getByLabelText("キャラクターZIP"), { target: { files: [new File(["zip"], "bad.zip")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing character.json");
    expect(screen.queryByText("Structure checked")).not.toBeInTheDocument();
    expect(screen.getByText("未承認の下書き")).toBeInTheDocument();
  });

  it("does not let an older asynchronous import overwrite a newer selection", async () => {
    let releaseOld!: (pack: InspectedCharacterPack) => void;
    vi.mocked(inspectCharacterZip)
      .mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }))
      .mockResolvedValueOnce({ ...fixture, definition: { ...fixture.definition, characterId: "newest" } });
    render(<CharacterPackInspector locale="en" projectId="project-local" />);
    const input = screen.getByLabelText("Character ZIP");
    fireEvent.change(input, { target: { files: [new File(["a"], "old.zip")] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "new.zip")] } });
    await waitFor(() => expect(screen.getByText("newest")).toBeInTheDocument());
    releaseOld(fixture);
    await waitFor(() => expect(screen.queryByText("pip")).toBeNull());
    expect(screen.getByText("newest")).toBeInTheDocument();
  });

  it("saves the exact checked bytes in the active project and reopens an immutable draft", async () => {
    const draft = {
      id: "character-draft-0123456789abcdef0123456789abcdef", projectId: "brand-one",
      characterId: "pip", revision: "1", archiveSha256: "a".repeat(64),
      sizeBytes: 8, status: "unverified" as const, createdAt: "2026-10-26T12:00:00Z",
    };
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    vi.mocked(saveCharacterDraft).mockResolvedValue(draft);
    vi.mocked(loadCharacterDraft).mockResolvedValue(new ArrayBuffer(8));
    render(<CharacterPackInspector locale="en" projectId="brand-one" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Save draft locally" }));
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(saveCharacterDraft).toHaveBeenCalledWith("brand-one", "pip", "1", expect.any(ArrayBuffer));
    expect(screen.getByText("Saved drafts for this project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download ZIP" })).toHaveAttribute("href", expect.stringContaining("projectId=brand-one"));
    fireEvent.click(screen.getByRole("button", { name: "Reopen ZIP" }));
    await waitFor(() => expect(loadCharacterDraft).toHaveBeenCalledWith("brand-one", draft));
    expect(await screen.findByText("Structure checked")).toBeInTheDocument();
  });

  it("keeps preview available and shows the server conflict when a revision differs", async () => {
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    vi.mocked(saveCharacterDraft).mockRejectedValue(Error("This revision already has different artwork."));
    render(<CharacterPackInspector locale="en" projectId="project-local" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Save draft locally" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("different artwork");
    expect(screen.getByText("Structure checked")).toBeInTheDocument();
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
  });
});

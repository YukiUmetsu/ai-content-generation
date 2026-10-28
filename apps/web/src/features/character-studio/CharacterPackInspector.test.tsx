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
  it("binds a project favorite voice to a saved character revision without sending audio", async () => {
    const projectId="character-voice-test";
    const savedDraft={
      id:"character-draft-"+"c".repeat(32),projectId,characterId:"pip",revision:"3",
      archiveSha256:"a".repeat(64),sizeBytes:80,status:"unverified" as const,createdAt:"2026-10-28T00:00:00Z",
    };
    vi.mocked(listCharacterDrafts).mockResolvedValue([savedDraft]);
    try {
      render(<CharacterPackInspector locale="en" projectId={projectId} />);
      const select=await screen.findByRole("combobox",{name:"Voice for pip, revision 3"});
      fireEvent.change(select,{target:{value:"1"}});
      expect(select).toHaveValue("1");
      const stored=JSON.parse(localStorage.getItem("contentgen:character-voices:v1:"+projectId)??"null");
      expect(stored.bindings).toMatchObject([{draftId:savedDraft.id,characterId:"pip",revision:"3",
        voice:{provider:"fish",voiceId:"6ab4c6b0f37f4243a99046478647be94"}}]);
      fireEvent.change(select,{target:{value:""}});
      expect(JSON.parse(localStorage.getItem("contentgen:character-voices:v1:"+projectId)??"null").bindings).toEqual([]);
      localStorage.setItem("contentgen:project-voice-favorites:v1:"+projectId,JSON.stringify({
        schemaVersion:1,projectId,voices:[{provider:"fish",voiceId:"6ab4c6b0f37f4243a99046478647be94",
          name:"Changed in another tab",gender:"unspecified",situation:"narration",language:"und"}],
      }));
      fireEvent.change(select,{target:{value:"1"}});
      expect(screen.getByRole("alert")).toHaveTextContent("changed in another tab");
      expect(JSON.parse(localStorage.getItem("contentgen:character-voices:v1:"+projectId)??"null").bindings).toEqual([]);
    } finally {
      localStorage.removeItem("contentgen:character-voices:v1:"+projectId);
      localStorage.removeItem("contentgen:project-voice-favorites:v1:"+projectId);
    }
  });

  it("explains the real manifest schema and offers both importable ZIP and matching JSON downloads", () => {
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<CharacterPackInspector locale="en" projectId="project-local" />);
      fireEvent.click(screen.getByText(/ZIP format and rig instructions · examples & downloads/));
      expect(screen.getByText("1 · Arrange the ZIP files")).toBeInTheDocument();
      expect(screen.getByText("2 · What each field means")).toBeInTheDocument();
      expect(screen.getByText("3 · Complete example character.json")).toBeInTheDocument();
      expect(screen.getByLabelText("Example character.json")).toHaveTextContent('"characterId": "example-sprite"');
      expect(screen.getByText(/ZIP ≤16 MB compressed/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Download example character.json" }));
      fireEvent.click(screen.getByRole("button", { name: "Download example ZIP" }));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
      expect(clicked).toHaveBeenCalledTimes(2);
      vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw Error("Downloads are blocked."); });
      fireEvent.click(screen.getByRole("button", { name: "Download example ZIP" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Downloads are blocked.");
    } finally { clicked.mockRestore(); }
  });

  it("previews safely inspected layers and revokes temporary URLs when unmounted", async () => {
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    const { unmount } = render(<CharacterPackInspector locale="en" projectId="project-local" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    expect(await screen.findByText("Structure checked")).toBeInTheDocument();
    expect(screen.getByText(/cannot be used for publishing yet/)).toBeInTheDocument();
    expect(screen.getByText("Rig metadata, not playback-tested")).toBeInTheDocument();
    expect(screen.getByText("Rig & motion editor")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Character rig and animation canvas" })).toBeInTheDocument();
    expect(screen.getByText("No gesture actions declared")).toBeInTheDocument();
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

  it("discards calibration edits when another ZIP is inspected, even with the same identity", async () => {
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    render(<CharacterPackInspector locale="en" projectId="project-local" />);
    const input = screen.getByLabelText("Character ZIP");
    fireEvent.change(input, { target: { files: [new File(["a"], "pip.zip")] } });
    expect(await screen.findByText("Structure checked")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("X offset"), { target: { value: "12" } });
    expect(screen.getByLabelText("X offset")).toHaveValue(12);
    fireEvent.change(input, { target: { files: [new File(["b"], "pip.zip")] } });
    await waitFor(() => expect(inspectCharacterZip).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("X offset")).toHaveValue(0));
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

  it("refreshes all saved drafts when saving finishes before the initial draft list", async () => {
    const older = {
      id: "character-draft-11111111111111111111111111111111", projectId: "project-local",
      characterId: "owl", revision: "1", archiveSha256: "a".repeat(64),
      sizeBytes: 40, status: "unverified" as const, createdAt: "2026-10-25T12:00:00Z",
    };
    const saved = { ...older, id: "character-draft-22222222222222222222222222222222", characterId: "pip" };
    let finishInitialList!: (drafts: typeof older[]) => void;
    vi.mocked(listCharacterDrafts).mockImplementationOnce(() => new Promise(resolve => { finishInitialList = resolve; }))
      .mockResolvedValueOnce([saved, older]);
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    vi.mocked(saveCharacterDraft).mockResolvedValue(saved);

    render(<CharacterPackInspector locale="en" projectId="project-local" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Save draft locally" }));
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    finishInitialList([older]);
    await waitFor(() => expect(listCharacterDrafts).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("owl")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Download ZIP" })).toHaveLength(2);
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

  it("rejects a saved ZIP when its manifest identity differs from the recorded draft", async () => {
    const draft = {
      id: "character-draft-0123456789abcdef0123456789abcdef", projectId: "project-local",
      characterId: "pip", revision: "1", archiveSha256: "b".repeat(64),
      sizeBytes: 35, status: "unverified" as const, createdAt: "2026-10-26T12:00:00Z",
    };
    vi.mocked(listCharacterDrafts).mockResolvedValue([draft]);
    vi.mocked(loadCharacterDraft).mockResolvedValue(new ArrayBuffer(35));
    vi.mocked(inspectCharacterZip).mockResolvedValue({ ...fixture, definition: { ...fixture.definition, characterId: "other-character" } });
    render(<CharacterPackInspector locale="en" projectId="project-local" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reopen ZIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("manifest does not match");
    expect(screen.queryByText("Structure checked")).not.toBeInTheDocument();
  });

  it("keeps pending saves and previews scoped to the project that started them", async () => {
    const draftA = {
      id: "character-draft-0123456789abcdef0123456789abcdef", projectId: "project-a",
      characterId: "pip", revision: "1", archiveSha256: "a".repeat(64),
      sizeBytes: 8, status: "unverified" as const, createdAt: "2026-10-26T12:00:00Z",
    };
    let finishSave!: (draft: typeof draftA) => void;
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    vi.mocked(saveCharacterDraft).mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    const { rerender } = render(<CharacterPackInspector locale="en" projectId="project-a" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Save draft locally" }));
    expect(saveCharacterDraft).toHaveBeenCalledWith("project-a", "pip", "1", expect.any(ArrayBuffer));

    rerender(<CharacterPackInspector locale="en" projectId="project-b" />);
    await waitFor(() => expect(listCharacterDrafts).toHaveBeenCalledWith("project-b"));
    finishSave(draftA);

    await waitFor(() => expect(screen.getByText("No saved drafts yet. Import a ZIP and select Save draft locally.")).toBeInTheDocument());
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Structure checked")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download ZIP" })).not.toBeInTheDocument();
  });

  it("does not reopen a previous project's archive after switching projects", async () => {
    const draftA = {
      id: "character-draft-0123456789abcdef0123456789abcdef", projectId: "project-a",
      characterId: "pip", revision: "1", archiveSha256: "b".repeat(64),
      sizeBytes: 8, status: "unverified" as const, createdAt: "2026-10-26T12:00:00Z",
    };
    let finishLoad!: (bytes: ArrayBuffer) => void;
    vi.mocked(listCharacterDrafts).mockImplementation(async id => id === "project-a" ? [draftA] : []);
    vi.mocked(loadCharacterDraft).mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));
    vi.mocked(inspectCharacterZip).mockResolvedValue(fixture);
    const { rerender } = render(<CharacterPackInspector locale="en" projectId="project-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reopen ZIP" }));
    rerender(<CharacterPackInspector locale="en" projectId="project-b" />);
    finishLoad(new ArrayBuffer(8));
    await waitFor(() => expect(screen.getByText("No saved drafts yet. Import a ZIP and select Save draft locally.")).toBeInTheDocument());
    expect(screen.queryByText("Structure checked")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download ZIP" })).not.toBeInTheDocument();
  });
});

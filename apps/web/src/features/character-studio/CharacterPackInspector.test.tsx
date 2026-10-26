import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CharacterPackInspector } from "./CharacterPackInspector";
import { inspectCharacterZip } from "./character-pack";
import type { InspectedCharacterPack } from "./character-pack";

vi.mock("./character-pack", async importOriginal => {
  const module = await importOriginal<typeof import("./character-pack")>();
  return { ...module, inspectCharacterZip: vi.fn() };
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
    const { unmount } = render(<CharacterPackInspector locale="en" />);
    fireEvent.change(screen.getByLabelText("Character ZIP"), { target: { files: [new File(["zip"], "pip.zip")] } });
    expect(await screen.findByText("Structure checked")).toBeInTheDocument();
    expect(screen.getByText(/does not register a character yet/)).toBeInTheDocument();
    expect(screen.getByAltText("body sprite layer")).toHaveAttribute("src", "blob:local-character");
    expect(inspectCharacterZip).toHaveBeenCalledTimes(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-character");
  });

  it("shows a safe, actionable error without inventing a saved character", async () => {
    vi.mocked(inspectCharacterZip).mockRejectedValue(Error("Missing character.json at the ZIP root."));
    render(<CharacterPackInspector locale="ja" />);
    fireEvent.change(screen.getByLabelText("キャラクターZIP"), { target: { files: [new File(["zip"], "bad.zip")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing character.json");
    expect(screen.queryByText("Structure checked")).not.toBeInTheDocument();
    expect(screen.getByText("プレビューのみ")).toBeInTheDocument();
  });

  it("does not let an older asynchronous import overwrite a newer selection", async () => {
    let releaseOld!: (pack: InspectedCharacterPack) => void;
    vi.mocked(inspectCharacterZip)
      .mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }))
      .mockResolvedValueOnce({ ...fixture, definition: { ...fixture.definition, characterId: "newest" } });
    render(<CharacterPackInspector locale="en" />);
    const input = screen.getByLabelText("Character ZIP");
    fireEvent.change(input, { target: { files: [new File(["a"], "old.zip")] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "new.zip")] } });
    await waitFor(() => expect(screen.getByText("newest")).toBeInTheDocument());
    releaseOld(fixture);
    await waitFor(() => expect(screen.queryByText("pip")).toBeNull());
    expect(screen.getByText("newest")).toBeInTheDocument();
  });
});

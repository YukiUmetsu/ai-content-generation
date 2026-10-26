import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RigCalibrationEditor } from "./RigCalibrationEditor";
import type { CharacterPackDefinition } from "./character-pack";

const animal: CharacterPackDefinition = {
  schemaVersion: 1, characterId: "pip", revision: "r1", mode: "puppet-2.5d",
  design: { width: 768, height: 576 }, channels: ["body", "head", "tail"], palette: {},
  assets: { body: { kind: "image", uri: "layers/body.png", mediaType: "image/png", width: 250, height: 220,
    provenance: { source: "owner", license: "original" } } },
  parts: [
    { id: "body", channel: "body", asset: "body", pivot: { x: 110, y: 190 }, z: 0 },
    { id: "muzzle", parent: "body", channel: "head", asset: "body", pivot: { x: 80, y: 90 }, rest: { y: -130 }, z: 3 },
    { id: "fluffy-tail", parent: "body", channel: "tail", asset: "body", pivot: { x: 50, y: 50 }, z: -2 },
  ],
  poses: { idle: {} }, basePose: "idle", capabilities: [],
};

beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:updated-manifest"), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("RigCalibrationEditor", () => {
  it("lets an author revise a non-human joint without changing the imported definition", async () => {
    render(<RigCalibrationEditor definition={animal} locale="en" />);
    expect(screen.getByText("Anatomy & joint placement")).toBeInTheDocument();
    expect(screen.getByText(/no live animation preview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download revised character.json/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Part"), { target: { value: "muzzle" } });
    expect(screen.getByText(/Relative to body/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Y offset"), { target: { value: "-95" } });
    fireEvent.change(screen.getByLabelText("New revision"), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: /Download revised character.json/ }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const exported = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const json = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(exported);
    });
    const manifest = JSON.parse(json) as CharacterPackDefinition;
    expect(manifest.revision).toBe("r2");
    expect(manifest.parts.find(part => part.id === "muzzle")?.rest?.y).toBe(-95);
    expect(manifest.assets).toEqual(animal.assets);
    expect(animal.parts[1].rest?.y).toBe(-130);
  });

  it("shows an actionable validation message for collapsed body parts", () => {
    render(<RigCalibrationEditor definition={animal} locale="en" />);
    fireEvent.change(screen.getByLabelText("Part"), { target: { value: "fluffy-tail" } });
    fireEvent.change(screen.getByLabelText("Y scale"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("New revision"), { target: { value: "r2" } });
    expect(screen.getByText(/fluffy-tail.*scaleY/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download revised character.json/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset placement edits" }));
    expect(screen.getByLabelText("Y scale")).toHaveValue(1);
  });
});

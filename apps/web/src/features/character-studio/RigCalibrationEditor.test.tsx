import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByText("Rig & motion editor")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Character rig and animation canvas" })).toBeInTheDocument();
    expect(screen.getByText(/not yet connected to final video rendering/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download revised character.json/ })).toBeDisabled();
    fireEvent.click(within(screen.getByLabelText("Rig part list")).getByRole("button", { name: /muzzle/ }));
    expect(screen.getByText(/Parent: body/)).toBeInTheDocument();
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
    fireEvent.click(within(screen.getByLabelText("Rig part list")).getByRole("button", { name: /fluffy-tail/ }));
    fireEvent.change(screen.getByLabelText("Y scale"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("New revision"), { target: { value: "r2" } });
    expect(screen.getByText(/fluffy-tail.*scaleY/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download revised character.json/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset placement edits" }));
    expect(screen.getByLabelText("Y scale")).toHaveValue(1);
  });

  it("shows selected sprite artwork alongside non-human part controls and tracks adjusted parts", () => {
    const spriteUrls = new Map([["layers/body.png", "blob:pip-body"]]);
    render(<RigCalibrationEditor definition={animal} locale="en" spriteUrls={spriteUrls} />);
    expect(screen.getByAltText("body artwork (not composited)")).toHaveAttribute("src", "blob:pip-body");
    expect(within(screen.getByLabelText("Rig part list")).getByRole("button", { name: /muzzle/ })).toBeInTheDocument();
    expect(screen.getByText("0 placed · 0 corrected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset placement edits" })).toBeDisabled();

    fireEvent.click(within(screen.getByLabelText("Rig part list")).getByRole("button", { name: /muzzle/ }));
    expect(screen.getByAltText("muzzle artwork (not composited)")).toHaveAttribute("src", "blob:pip-body");
    fireEvent.change(screen.getByLabelText("Y offset"), { target: { value: "-95" } });
    expect(screen.getByText("1 placed · 0 corrected")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Rig part list")).getByRole("button", { name: /muzzle.*adjusted/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset placement edits" }));
    expect(screen.getByText("0 placed · 0 corrected")).toBeInTheDocument();
    expect(screen.getByLabelText("Y offset")).toHaveValue(-130);
  });

  it("reorders limb behind body with an immediate canvas update, Undo, and a layer-only export", async () => {
    render(<RigCalibrationEditor definition={animal} locale="en" />);
    fireEvent.click(within(screen.getByLabelText("Rig part list")).getByRole("button", { name: /muzzle/ }));
    const controls = within(screen.getByLabelText("Layer order controls"));
    expect(controls.getByRole("button", { name: "Move backward" })).toBeEnabled();
    fireEvent.click(controls.getByRole("button", { name: "Send to back" }));
    expect(screen.getByText(/layers changed/)).toBeInTheDocument();
    expect(controls.getByRole("button", { name: "Move backward" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("New revision"), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: /Download revised character.json/ }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const json = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(blob);
    });
    const revised = JSON.parse(json) as CharacterPackDefinition;
    expect(revised.parts.find(part => part.id === "muzzle")!.z).toBeLessThan(revised.parts.find(part => part.id === "body")!.z);
    expect(animal.parts.find(part => part.id === "muzzle")?.z).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText(/layers changed/)).not.toBeInTheDocument();
  });
});

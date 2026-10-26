import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RigCalibrationEditor } from "./RigCalibrationEditor";
import type { CharacterPackDefinition } from "./character-pack";

const animal: CharacterPackDefinition = {
  schemaVersion: 1, characterId: "pip", revision: "r1", mode: "puppet-2.5d", design: { width: 400, height: 300 },
  channels: ["body", "arms"], palette: {},
  assets: { sprite: { kind: "image", uri: "layers/arm.png", mediaType: "image/png", width: 80, height: 80,
    provenance: { source: "original", license: "original" } } },
  parts: [
    { id: "body", asset: "sprite", channel: "body", pivot: { x: 40, y: 40 }, rest: { x: 100, y: 80 }, z: 0 },
    { id: "arm", parent: "body", asset: "sprite", channel: "arms", pivot: { x: 10, y: 15 }, rest: { x: 30, y: 10 }, z: 1 },
  ],
  poses: { rest: {} }, basePose: "rest", capabilities: [],
};

describe("rig correction canvas", () => {
  it("moves the animal shoulder independently by dragging its joint handle", () => {
    render(<RigCalibrationEditor definition={animal} locale="en" spriteUrls={new Map([["layers/arm.png", "blob:arm"]])} />);
    fireEvent.click(screen.getByRole("button", { name: /arm.*Root|arm.*body/i }));
    const joint = screen.getByLabelText("Move arm joint");
    fireEvent.pointerDown(joint, { pointerId: 1, clientX: 120, clientY: 90 });
    fireEvent.pointerMove(joint, { pointerId: 1, clientX: 140, clientY: 90 });
    fireEvent.pointerUp(joint, { pointerId: 1 });
    expect((screen.getByLabelText("Pivot X") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("X offset") as HTMLInputElement).value).toBe("30");
  });

  it("adds an editable frame correction when a paused pose is dragged", () => {
    render(<RigCalibrationEditor definition={animal} locale="en" spriteUrls={new Map([["layers/arm.png", "blob:arm"]])} />);
    fireEvent.click(screen.getByRole("button", { name: /arm.*Root|arm.*body/i }));
    fireEvent.click(screen.getByRole("button", { name: /Animate/i }));
    fireEvent.change(screen.getByLabelText("Animation frame"), { target: { value: "12" } });
    const handle = screen.getByLabelText("Move arm pose");
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 120, clientY: 90 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 140, clientY: 90 });
    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(screen.getByRole("button", { name: /Download pose corrections/i })).toBeEnabled();
    expect(screen.getByText(/1 corrected/i)).toBeInTheDocument();
  });

  it("can rotate an animal limb at a paused frame without editing its rest rotation", () => {
    render(<RigCalibrationEditor definition={animal} locale="en" spriteUrls={new Map([["layers/arm.png", "blob:arm"]])} />);
    fireEvent.click(screen.getByRole("button", { name: /arm.*body/i }));
    fireEvent.click(screen.getByRole("button", { name: "Animate" }));
    fireEvent.change(screen.getByLabelText("Animation frame"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Rotate clockwise 5°" }));
    expect(screen.getByText("+5° correction")).toBeInTheDocument();
    expect((screen.getByLabelText("Rotation (°)") as HTMLInputElement).value).toBe("0");
  });

  it("restores the pending export revision when a reset is undone", () => {
    render(<RigCalibrationEditor definition={animal} locale="en" />);
    fireEvent.change(screen.getByLabelText("X offset"), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText("New revision"), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: /Reset placement edits/i }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByLabelText("New revision") as HTMLInputElement).value).toBe("r2");
    expect((screen.getByLabelText("X offset") as HTMLInputElement).value).toBe("101");
  });
});

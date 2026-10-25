import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlatformOptimization } from "./PlatformOptimization";
import type { PlatformOptimizationInput } from "./model";

const input: PlatformOptimizationInput = {
  productionId: "production-test",
  projectId: "project-test",
  title: "The real cost of a $500,000 house",
  summary: "A mortgage is only one part of the cost of owning a house.",
  platforms: ["youtube", "tiktok", "blog"],
  sourceRevision: "script-1",
  scriptSections: [{ id: "one", heading: "Taxes and upkeep", text: "Property taxes and repairs add to cost.", startSeconds: 0 }],
  assets: [{ id: "video-1", kind: "video", platform: "youtube", filename: "master.mp4" }],
};

describe("PlatformOptimization", () => {
  const entries = new Map<string, string>();
  beforeEach(() => {
    entries.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("auto-prepares metadata per destination and preserves manual edits across tabs and reopen", () => {
    const view = render(<PlatformOptimization input={input} />);
    const title = screen.getByLabelText("Upload title") as HTMLInputElement;
    expect(title.value).toContain("$500,000 house");
    fireEvent.change(title, { target: { value: "The Hidden Cost of Homeownership" } });
    fireEvent.click(screen.getByRole("tab", { name: /TikTok/ }));
    expect((screen.getByLabelText("Post caption") as HTMLTextAreaElement).value).toContain("mortgage is only one part");
    fireEvent.click(screen.getByRole("tab", { name: /^YouTube\b/ }));
    expect((screen.getByLabelText("Upload title") as HTMLInputElement).value).toBe("The Hidden Cost of Homeownership");
    view.unmount();
    render(<PlatformOptimization input={input} />);
    expect((screen.getByLabelText("Upload title") as HTMLInputElement).value).toBe("The Hidden Cost of Homeownership");
  });

  it("marks the review pending if a final video is not available instead of implying upload", () => {
    render(<PlatformOptimization input={{ ...input, assets: [] }} />);
    expect(screen.getByText(/attach a rendered destination-ready video/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve package/i })).toBeDisabled();
    expect(screen.getByText(/No upload, scheduling, or publishing/i)).toBeInTheDocument();
  });

  it("does not silently overwrite manually reviewed titles when the source script changes", () => {
    const view = render(<PlatformOptimization input={input} />);
    fireEvent.change(screen.getByLabelText("Upload title"), { target: { value: "Human title" } });
    view.rerender(<PlatformOptimization input={{ ...input, title: "Changed AI script title", sourceRevision: "script-2" }} />);
    expect((screen.getByLabelText("Upload title") as HTMLInputElement).value).toBe("Human title");
    expect(screen.getByText(/script, palette or assets changed/i)).toBeInTheDocument();
  });
});

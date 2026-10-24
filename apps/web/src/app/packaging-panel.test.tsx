import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PackagingPanel } from "./packaging-panel";

afterEach(() => vi.unstubAllGlobals());

describe("Packaging panel against the actual local backend", () => {
  it("shows a useful empty state for a new database instead of a 404 or example set", async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/creative/packaging");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", request);
    render(<PackagingPanel locale="en" />);
    expect(await screen.findByText("No saved packaging concepts yet")).toBeInTheDocument();
    expect(screen.getByText(/sample concepts are never substituted/i)).toBeInTheDocument();
    expect(screen.queryByText(/The packaging set could not be read/i)).not.toBeInTheDocument();
  });
});

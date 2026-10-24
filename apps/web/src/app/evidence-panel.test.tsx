import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvidencePanel } from "./evidence-panel";
import { searchEvidence } from "@/lib/api/client";
import type { EvidenceSearchResponse, EvidenceSearchResult } from "@/lib/api/types";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...original, searchEvidence: vi.fn() };
});

const search = vi.mocked(searchEvidence);

function response(overrides: Partial<EvidenceSearchResponse> = {}): EvidenceSearchResponse {
  return {
    schemaVersion: 1,
    query: "house cost",
    tokenizer: "unicode61",
    index: { state: "empty", indexedPassageCount: 0, sourcePassageCount: 0 },
    results: [],
    contradictions: [],
    degradation: { reason: "index_empty", hint: "No passages" },
    ...overrides,
  };
}

const passage: EvidenceSearchResult = {
  schemaVersion: 1, passageId: "psg-house-001", rank: 1, bm25: 0.25,
  excerpt: "A $500,000 house can have substantial lifetime costs.",
  language: "en", bodySha256: "a".repeat(64), locator: { kind: "page", page: 7 },
  source: {
    id: "src-house", sourceKind: "web", title: "Home ownership report",
    canonicalUri: "https://example.org/research/house", publisher: "Research Institute",
    rightsStatus: "unknown", createdAt: "2026-10-23T00:00:00Z", metadata: {},
  },
  version: {
    id: "ver-house", sourceId: "src-house", contentSha256: "b".repeat(64),
    retrievedAt: "2026-10-23T00:00:00Z", mediaType: "text/html", byteSize: 2048,
    parserVersion: "html-v1", rawArtifactId: null, createdAt: "2026-10-23T00:00:00Z", metadata: {},
  },
  provenance: {
    sourceVersionId: "ver-house", canonicalUri: "https://example.org/research/house",
    retrievedAt: "2026-10-23T00:00:00Z", rightsStatus: "unknown",
    licenseNote: "Attribution required", contentSha256: "b".repeat(64), parserVersion: "html-v1",
  },
  claims: [], numericValues: [],
};

async function runSearch() {
  const user = userEvent.setup();
  render(<EvidencePanel locale="en" />);
  await user.type(screen.getByRole("searchbox", { name: "Search stored evidence" }), "house cost");
  await user.click(screen.getByRole("button", { name: "Search evidence" }));
  return user;
}

describe("Evidence Library", () => {
  afterEach(() => { search.mockReset(); });

  it("uses an accessible Kumiki searchbox with help attached to the field", () => {
    render(<EvidencePanel locale="en" />);
    const field = screen.getByRole("searchbox", { name: "Search stored evidence" });
    expect(field).toHaveAttribute("type", "search");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/searches saved passages by keywords/i);
  });

  it("submits once on Enter and clears both the query and stale results while preserving focus", async () => {
    search.mockResolvedValue(response());
    const user = userEvent.setup();
    render(<EvidencePanel locale="en" />);
    const field = screen.getByRole("searchbox", { name: "Search stored evidence" });
    await user.type(field, "  house cost{Enter}");
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("house cost", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await screen.findByText("No passages saved yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByText("No passages saved yet")).not.toBeInTheDocument();
  });

  it("cancels an in-flight lookup when the search is cleared", async () => {
    search.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<EvidencePanel locale="en" />);
    await user.type(screen.getByRole("searchbox", { name: "Search stored evidence" }), "house cost{Enter}");
    expect(search).toHaveBeenCalledOnce();
    const signal = search.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("searchbox", { name: "Search stored evidence" })).toHaveValue("");
  });

  it("treats a fresh empty index as expected, not degraded or broken", async () => {
    search.mockResolvedValue(response());
    await runSearch();
    expect(await screen.findByText("No passages saved yet")).toBeInTheDocument();
    expect(screen.queryByText("Search degraded")).not.toBeInTheDocument();
    expect(screen.getByText(/research drafts are saved separately/i)).toBeInTheDocument();
  });

  it("distinguishes stale indexes and ordinary no-match searches", async () => {
    search.mockResolvedValueOnce(response({
      index: { state: "stale", indexedPassageCount: 1, sourcePassageCount: 2 },
      degradation: { reason: "index_stale", hint: null },
    }));
    const user = await runSearch();
    expect(await screen.findByText("Search degraded")).toBeInTheDocument();
    search.mockResolvedValueOnce(response({
      index: { state: "ready", indexedPassageCount: 2, sourcePassageCount: 2 },
      degradation: { reason: "no_matches", hint: null },
    }));
    await user.click(screen.getByRole("button", { name: "Search evidence" }));
    expect(await screen.findByText("No evidence matches this query")).toBeInTheDocument();
    expect(screen.queryByText("Search degraded")).not.toBeInTheDocument();
  });

  it("shows useful citations first and keeps full source provenance inspectable", async () => {
    search.mockResolvedValue(response({
      index: { state: "ready", indexedPassageCount: 1, sourcePassageCount: 1 },
      degradation: null, results: [passage],
    }));
    const user = await runSearch();
    expect(await screen.findByText("Home ownership report")).toBeInTheDocument();
    expect(screen.getByText(/substantial lifetime costs/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open original source" })).toHaveAttribute("href", "https://example.org/research/house");
    const details = screen.getByText("Source details");
    expect(details.closest("details")).not.toHaveAttribute("open");
    await user.click(details);
    expect(details.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Attribution required")).toBeInTheDocument();
    expect(screen.getByText("ver-house")).toBeInTheDocument();
  });

  it("does not create clickable links for unsupported source URI schemes", async () => {
    search.mockResolvedValue(response({
      index: { state: "ready", indexedPassageCount: 1, sourcePassageCount: 1 },
      degradation: null,
      results: [{ ...passage, source: { ...passage.source, canonicalUri: "javascript:alert(1)" } }],
    }));
    await runSearch();
    expect(await screen.findByText("Home ownership report")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open original source" })).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });
});

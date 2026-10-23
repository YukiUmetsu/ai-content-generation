import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RelatedYoutubePanel } from "./related-youtube-panel";

afterEach(() => vi.unstubAllGlobals());

const sample = {
  videoId: "abcABC12345", title: "Heat Pump Installation Costs Explained",
  channelId: "UCdemo", channelTitle: "Sample Channel", publishedAt: "2026-10-20T00:00:00Z",
  durationSeconds: 480, viewCount: 25000, likeCount: null, commentCount: null,
  subscriberCount: null, sourceUrl: "https://www.youtube.com/watch?v=abcABC12345",
  provider: "youtube-data-api", observedAt: 1792500000, expiresAt: 1795100000,
  watchlistName: "House Math", matchedTerms: ["heat", "pump"],
};

describe("related YouTube research context", () => {
  it("automatically retrieves cached videos, explains provenance, and selects URL-only references", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ videos: [sample] }), {status: 200});
    }));
    const onSelectUrls = vi.fn();
    const user = userEvent.setup();
    render(<RelatedYoutubePanel locale="en" topic="heat pump" selectedUrls={[]} onSelectUrls={onSelectUrls} />);
    expect(await screen.findByText("Heat Pump Installation Costs Explained")).toBeInTheDocument();
    expect(requests).toContain("/api/research/market/related?topic=heat%20pump");
    expect(screen.getByText(/House Math/)).toBeInTheDocument();
    expect(screen.getByText(/Matched: heat, pump/)).toBeInTheDocument();
    expect(screen.getByRole("link", {name:/watch on youtube/i})).toHaveAttribute("href", sample.sourceUrl);
    await user.click(screen.getByRole("checkbox", {name:/select.*inspiration/i}));
    expect(onSelectUrls).toHaveBeenCalledWith([sample.sourceUrl]);
    expect(JSON.stringify(onSelectUrls.mock.calls)).not.toContain("25000");
  });

  it("shows a helpful empty state and never calls the remote YouTube API", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      requests.push(String(url));
      return new Response(JSON.stringify({videos: []}), {status:200});
    }));
    const { rerender } = render(<RelatedYoutubePanel locale="en" topic="" selectedUrls={[]} onSelectUrls={vi.fn()} />);
    expect(screen.getByText(/Enter a research topic/i)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    rerender(<RelatedYoutubePanel locale="en" topic="HVAC replacement" selectedUrls={[]} onSelectUrls={vi.fn()} />);
    expect(await screen.findByText(/No related cached videos/i)).toBeInTheDocument();
    expect(requests.every(request => request.startsWith("/api/research/market/related"))).toBe(true);
    expect(screen.getByText(/YouTube Intelligence/i)).toBeInTheDocument();
  });

  it("ignores an older request when the topic changes", async () => {
    let release: ((response: Response) => void) | undefined;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => {
      calls.push(String(url));
      if (String(url).includes("heat")) return new Promise<Response>(resolve => { release = resolve; });
      return Promise.resolve(new Response(JSON.stringify({videos: []}), {status:200}));
    }));
    const onSelectUrls = vi.fn();
    const {rerender} = render(<RelatedYoutubePanel locale="en" topic="heat pump" selectedUrls={[]} onSelectUrls={onSelectUrls} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender(<RelatedYoutubePanel locale="en" topic="roof repair" selectedUrls={[]} onSelectUrls={onSelectUrls} />);
    expect(await screen.findByText(/No related cached videos/i)).toBeInTheDocument();
    release?.(new Response(JSON.stringify({videos:[sample]}), {status:200}));
    await Promise.resolve();
    expect(screen.queryByText("Heat Pump Installation Costs Explained")).not.toBeInTheDocument();
  });
});

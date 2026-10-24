import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { CATALOG_KEY, parseCatalog } from "./catalog-model";

afterEach(() => vi.unstubAllGlobals());

describe("Studio shell", () => {
  it("opens the guided Production workspace by default", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Production stages" })).toBeInTheDocument();
  });

  it("opens directly into a focused create workspace with a real preview and a tool guide", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", {name: "Create"}));

    expect(screen.getByRole("link", { name: /skip to workspace/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: /studio tools/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/how to use this tool/i)).toBeInTheDocument();

    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: /find tools/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing to preview yet/i)).not.toBeInTheDocument();
    expect(screen.getByText("Updates as you edit")).toBeInTheDocument();
    expect(screen.getByTestId("video-opening")).toBeInTheDocument();
    expect(screen.getByTestId("metric-reveal")).toBeInTheDocument();
    expect(screen.getByTestId("thumbnail-preview")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /view settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to (light|dark) mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByText("ContentGen")).not.toBeInTheDocument();
    expect(screen.queryByText("Untitled project")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /view settings/i }));
    const settingsDialog = within(screen.getByRole("dialog"));
    expect(settingsDialog.getByText("Density")).toBeInTheDocument();
    expect(settingsDialog.getByText("Language")).toBeInTheDocument();
  });

  it("lets the tool guide close and reopen from its own header and the preview toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.click(screen.getByRole("link", {name: "Create"}));

    await user.click(screen.getByRole("button", { name: /close tool guide/i }));
    expect(screen.getByRole("button", { name: /show tool guide/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show tool guide/i }));
    expect(screen.getByRole("button", { name: /close tool guide/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hide tool guide/i }));
    expect(screen.getByRole("button", { name: /show tool guide/i })).toBeInTheDocument();
  });

  it("updates the shared preview when a brand palette color changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.click(screen.getByRole("link", {name: "Create"}));

    const canvasInput = screen.getAllByLabelText(/hex$/i)[0];
    await user.clear(canvasInput);
    await user.type(canvasInput, "#FF5733");

    await waitFor(() => {
      expect(screen.getByTestId("video-opening").style.getPropertyValue("--ba-canvas")).toBe("#FF5733");
    });
  });

  it("opens the now-live platform planner with per-platform preview and Kumiki safe-area checks", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.click(screen.getByRole("link", {name: "Create"}));
    await user.click(screen.getByRole("tab", { name: /platform layouts/i }));
    expect(screen.queryByText(/The editor isn't connected yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Export layout plan JSON/i})).toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:/Platform/i})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByTestId("platform-layout-frame")).toHaveAttribute("data-profile","youtube-shorts"));
    await user.selectOptions(screen.getByRole("combobox",{name:/Platform/i}),"youtube");
    await waitFor(()=>expect(screen.getByTestId("platform-layout-frame")).toHaveAttribute("data-profile","youtube"));
    expect(within(screen.getByLabelText(/how to use this tool/i)).getByText("Live preview")).toBeInTheDocument();
  });

  it("carries a public YouTube observation into a saved, editable Content video idea", async () => {
    localStorage.removeItem(CATALOG_KEY);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.endsWith("/status")
        ? {apiKeyConfigured:true, collecting:false, searchCallsLast24h:2, searchCallLimit:20}
        : url.endsWith("/watchlists")
          ? {watchlists:[{id:"watch-demo",name:"House Math",query:"heat pump savings",queryMode:"manual",queryPlan:[],queryPlanSource:"user-edited",queryIndex:0,queryPlanRevision:0,lastSearchQuery:null,nextSearchQuery:"heat pump savings",region:"US",language:"en",enabled:true,createdAt:1,updatedAt:1,nextDueAt:1,lastFinishedAt:1,backoffUntil:0,errorCode:null}]}
          : url.endsWith("/videos")
            ? {videos:[{videoId:"abcABC12345",title:"Competitor video",channelId:"UCdemo",channelTitle:"Demo",publishedAt:"2026-01-01T00:00:00Z",durationSeconds:60,viewCount:12340,likeCount:null,commentCount:null,subscriberCount:null,sourceUrl:"https://www.youtube.com/watch?v=abcABC12345",provider:"youtube-data-api",observedAt:1,expiresAt:9999999999}]}
            : null;
      if (!data) throw Error("Unexpected route: " + url);
      return new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", {name:"Research"}));
    await user.click(screen.getByRole("tab", {name:"YouTube Intelligence"}));
    await user.click(await screen.findByRole("button", {name:"Use for video"}));
    const title = screen.getByRole("textbox", {name:"Working video title"});
    await user.clear(title);
    await user.type(title,"The Real Cost of Heat Pumps in Oklahoma");
    await user.click(screen.getByRole("button", {name:"Save video idea"}));
    await waitFor(() => {
      const saved = parseCatalog(localStorage.getItem(CATALOG_KEY)!);
      expect(saved.content).toEqual(expect.arrayContaining([expect.objectContaining({
        name:"The Real Cost of Heat Pumps in Oklahoma",kind:"video",stage:"idea",
        notes:"Public YouTube inspiration: https://www.youtube.com/watch?v=abcABC12345",
      })]));
    });
    expect(screen.getByText("The Real Cost of Heat Pumps in Oklahoma")).toBeInTheDocument();
  });
});

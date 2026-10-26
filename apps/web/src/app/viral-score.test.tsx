import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IdeaGoogleTrends, IdeaMarketAssessment, ViralPotential } from "@/lib/api/discovery-sessions";
import { ViralScore } from "./viral-score";

afterEach(() => vi.restoreAllMocks());

const market: IdeaMarketAssessment = {
  runId:"market-1",state:"succeeded",query:"hidden costs of homeownership",
  format:"long",observedAt:1760000000,searchedVideos:25,sampleSize:12,distinctChannels:5,
  medianViews:18000,p75Views:30000,medianViewsPerDay:52.4,recentUploads90d:4,
  comparisonScore:76,comparisonCohortSize:3,errorCode:null,videos:[],
};
const trends: IdeaGoogleTrends = {
  state:"succeeded",query:"hidden costs of homeownership",region:"US",
  observedAt:1760000000,recentMean:62.4,previousMean:40,changePercent:56,
  points:52,errorCode:null,
};
const potential: ViralPotential = {
  score:77,state:"measured",scoreVersion:"viral-potential-v1",format:"long",
  youtubeScore:76,trendScore:78,trendChangePercent:56,coveragePercent:100,
  sampleSize:12,distinctChannels:5,comparisonCohortSize:3,
  youtubeObservedAt:1760000000,trendsObservedAt:1760000000,
};

describe("ViralScore", () => {
  it("shows a compact donut and opens an evidence breakdown on click", async () => {
    const user = userEvent.setup();
    render(<ViralScore potential={potential} assessment={market} googleTrends={trends}
      format="long" locale="en" />);
    const trigger = screen.getByRole("button", {name:/Viral score: 77 out of 100/});
    expect(trigger).toHaveTextContent("Viral score");
    expect(trigger).toHaveTextContent("Strong signals");
    expect(trigger).toHaveTextContent("77");
    expect(screen.queryByText("How this score works")).not.toBeInTheDocument();

    await user.click(trigger);
    const panel = await screen.findByRole("dialog", {name:"Viral score evidence"});
    expect(within(panel).getByText("YouTube performance")).toBeInTheDocument();
    expect(within(panel).getByText("Search momentum")).toBeInTheDocument();
    expect(within(panel).getByText("100% signal coverage · Long-form")).toBeInTheDocument();
    expect(within(panel).getByText(/12 videos · 5 channels · 3 ideas/)).toBeInTheDocument();
    expect(within(panel).getByText(/\+56% in Google search interest/)).toBeInTheDocument();

    await user.click(within(panel).getByText("How this score works"));
    expect(within(panel).getByText(/75% YouTube within-session/)).toBeInTheDocument();
    expect(within(panel).getByText(/YouTube query/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", {name:"Viral score evidence"})).not.toBeInTheDocument());
  });

  it("opens on hover without requiring a click", async () => {
    const user = userEvent.setup();
    render(<ViralScore potential={potential} assessment={market} googleTrends={trends}
      format="long" locale="en" />);
    await user.hover(screen.getByRole("button", {name:/Viral score: 77 out of 100/}));
    expect(await screen.findByRole("dialog", {name:"Viral score evidence"})).toBeInTheDocument();
  });

  it("never substitutes an editorial score when market evidence is absent", async () => {
    const user = userEvent.setup();
    render(<ViralScore potential={null} assessment={null} googleTrends={null}
      format="long" locale="en" />);
    const trigger = screen.getByRole("button", {name:/Viral score: insufficient data/});
    expect(trigger).toHaveTextContent("Needs YouTube data");
    expect(trigger).not.toHaveTextContent("60");
    await user.click(trigger);
    expect(await screen.findByText(/No viral score yet/)).toBeInTheDocument();
    expect(screen.getByText(/Requires a comparable session cohort or at least 3 other public uploads/)).toBeInTheDocument();
  });

  it("marks a YouTube-only score as partial and does not invent Trends", async () => {
    const user = userEvent.setup();
    render(<ViralScore potential={{...potential,score:76,state:"partial",trendScore:null,
      trendChangePercent:null,coveragePercent:75,trendsObservedAt:null}}
      assessment={market} googleTrends={null} format="long" locale="en" />);
    const trigger = screen.getByRole("button", {name:/Viral score: 76 out of 100/});
    expect(trigger).toHaveTextContent("Partial evidence");
    await user.click(trigger);
    const panel = await screen.findByRole("dialog", {name:"Viral score evidence"});
    expect(within(panel).getByText(/75% signal coverage/)).toBeInTheDocument();
    expect(within(panel).getByText(/Trends is missing/)).toBeInTheDocument();
    expect(within(panel).getByText("Unavailable")).toBeInTheDocument();
  });

  it("hides a long-form score while comparing Shorts", () => {
    render(<ViralScore potential={potential} assessment={market} googleTrends={trends}
      format="shorts" locale="en" />);
    const trigger = screen.getByRole("button", {name:/Viral score: insufficient data/});
    expect(trigger).not.toHaveTextContent("77");
  });

  it("provides a Japanese label for keyboard and touch access", async () => {
    const user = userEvent.setup();
    render(<ViralScore potential={potential} assessment={market} googleTrends={trends}
      format="long" locale="ja" />);
    const trigger = screen.getByRole("button", {name:/バイラルスコア: 77 \/ 100/});
    await user.click(trigger);
    expect(await screen.findByRole("dialog", {name:"バイラルスコアの根拠"})).toBeInTheDocument();
  });

  it("shows one-channel data as provisional with explicit baseline and low confidence", async () => {
    const user = userEvent.setup();
    const estimate: ViralPotential = {...potential,
      state:"provisional",scoreVersion:"viral-potential-v2",score:72,
      confidence:"low",comparisonBasis:"channel_baseline",youtubeScore:72,
      trendScore:null,trendChangePercent:null,coveragePercent:75,
      sampleSize:2,distinctChannels:1,comparisonCohortSize:0,
      channelBreakoutScore:72,channelBaselineChannels:1,channelBaselineVideos:6,
      trendsObservedAt:null};
    render(<ViralScore potential={estimate} assessment={{...market,sampleSize:2,distinctChannels:1,
      comparisonCohortSize:0,comparisonScore:null}} googleTrends={null} format="long" locale="en" />);
    const button = screen.getByRole("button",{name:/Viral score: 72 out of 100/});
    expect(button).toHaveTextContent(/low confidence · provisional/);
    await user.click(button);
    const panel = await screen.findByRole("dialog",{name:"Viral score evidence"});
    expect(within(panel).getByText(/compared with 6 other uploads/)).toBeInTheDocument();
  });
});

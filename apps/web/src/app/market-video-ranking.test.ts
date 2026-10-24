import { describe, expect, it } from "vitest";
import type { MarketVideo } from "@/lib/api/market";
import { rankMarketVideos, videoAgeDays } from "./market-video-ranking";

const now = Date.parse("2026-10-24T12:00:00Z");
const dayMs = 86_400_000;
function video(id: string, views: number | null, ageDays: number, observedAt = 100): MarketVideo {
  return {
    videoId:id, title:id, channelId:"UC_demo", channelTitle:"Demo",
    publishedAt:new Date(now-ageDays*dayMs).toISOString(),durationSeconds:420,
    viewCount:views,likeCount:null,commentCount:null,subscriberCount:null,
    sourceUrl:`https://www.youtube.com/watch?v=${id}`,provider:"youtube-data-api",
    observedAt, expiresAt:9999999999,
  };
}

describe("YouTube performance-first ranking", () => {
  it("surfaces established high-view videos instead of very new low-view uploads", () => {
    const rows = [video("old-low",300,100),video("new-low",300,0.5),
      video("established",50_000,30),video("new-high",50_000,2)];
    expect(rankMarketVideos(rows,"established",10_000,now).map(x=>x.video.videoId))
      .toEqual(["established"]);
    expect(rankMarketVideos(rows,"all",10_000,now).map(x=>x.video.videoId))
      .toEqual(["established","new-high","new-low","old-low"]);
    expect(rankMarketVideos(rows,"established",100_000,now)).toEqual([]);
  });

  it("treats fast starters separately and labels their metric as a lifetime average", () => {
    const rows=[video("fast",6_000,3),video("low",200,2),video("too-new",9_000,0.1),
      video("old-popular",200_000,60),video("slow-new",1_100,10)];
    const fast=rankMarketVideos(rows,"fast-starters",10_000,now);
    expect(fast.map(x=>x.video.videoId)).toEqual(["fast"]);
    expect(fast[0].lifetimeAvgViewsPerDay).toBe(2000);
    expect(rankMarketVideos(rows,"all",10_000,now)).toHaveLength(5);
  });

  it("deduplicates repeat observations, keeping the latest snapshot", () => {
    const prior=video("same",25_000,30,100);
    const latest=video("same",30_000,30,200);
    const rows=rankMarketVideos([latest,prior,video("other",15_000,50)],"established",10_000,now);
    expect(rows.map(x=>x.video.videoId)).toEqual(["same","other"]);
    expect(rows[0].video.viewCount).toBe(30_000);
  });

  it("keeps missing counts and invalid or future dates visible only in All", () => {
    const rows=[video("null-views",null,30),{...video("bad",20_000,30),publishedAt:"invalid"},
      {...video("future",20_000,1),publishedAt:new Date(now+dayMs).toISOString()}];
    expect(rankMarketVideos(rows,"established",10_000,now)).toEqual([]);
    expect(rankMarketVideos(rows,"all",10_000,now)).toHaveLength(3);
    expect(videoAgeDays("invalid",now)).toBeNull();
    expect(videoAgeDays(new Date(now+dayMs).toISOString(),now)).toBeNull();
  });
});

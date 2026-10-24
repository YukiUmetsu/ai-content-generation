import type { MarketVideo } from "@/lib/api/market";

export type MarketVideoMode = "established" | "fast-starters" | "all";

export interface RankedMarketVideo {
  video: MarketVideo;
  ageDays: number | null;
  /** Lifetime average, NOT measured recent velocity or growth. */
  lifetimeAvgViewsPerDay: number | null;
}

const DAY_MS = 86_400_000;

/** Never infer recent acceleration from one cumulative YouTube view-count snapshot. */
export function videoAgeDays(publishedAt: string, nowMs: number): number | null {
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(nowMs)) return null;
  const ageDays = (nowMs - publishedMs) / DAY_MS;
  return ageDays >= 0 ? ageDays : null;
}

/** Deduplicate repeated observations and prioritize high-view, established examples. */
export function rankMarketVideos(
  videos: readonly MarketVideo[],
  mode: MarketVideoMode,
  minViews: number,
  nowMs: number,
): RankedMarketVideo[] {
  const latest = new Map<string, MarketVideo>();
  for (const video of videos) {
    const previous = latest.get(video.videoId);
    if (!previous || video.observedAt > previous.observedAt ||
        (video.observedAt === previous.observedAt && (video.viewCount ?? -1) > (previous.viewCount ?? -1))) {
      latest.set(video.videoId, video);
    }
  }
  const rows = [...latest.values()].map(video => {
    const ageDays = videoAgeDays(video.publishedAt, nowMs);
    const lifetimeAvgViewsPerDay = ageDays === null || ageDays < 1 || video.viewCount === null
      ? null
      : video.viewCount / ageDays;
    return {video, ageDays, lifetimeAvgViewsPerDay};
  });
  const filtered = rows.filter(({video, ageDays, lifetimeAvgViewsPerDay}) => {
    if (mode === "all") return true;
    if (video.viewCount === null || ageDays === null) return false;
    if (mode === "established") return ageDays >= 7 && video.viewCount >= minViews;
    // Promising *initial* performance, not a measured trend from historical snapshots.
    return ageDays >= 1 && ageDays <= 14 &&
      video.viewCount >= 1000 && lifetimeAvgViewsPerDay !== null &&
      lifetimeAvgViewsPerDay >= 500;
  });
  filtered.sort((a, b) => {
    if (mode === "fast-starters") {
      const velocityDiff = (b.lifetimeAvgViewsPerDay ?? -1) - (a.lifetimeAvgViewsPerDay ?? -1);
      if (velocityDiff) return velocityDiff;
    }
    const viewDiff = (b.video.viewCount ?? -1) - (a.video.viewCount ?? -1);
    if (viewDiff) return viewDiff;
    const observationDiff = b.video.observedAt - a.video.observedAt;
    return observationDiff || a.video.videoId.localeCompare(b.video.videoId);
  });
  return filtered;
}

import { describe, expect, it } from "vitest";
import {
  approvePlatformPackage,
  createPlatformOptimizationManifest,
  normalizeTarget,
  resetPlatformField,
  reconcilePlatformOptimizationManifest,
  reviewPlatformPackage,
  updatePlatformField,
  type PlatformOptimizationInput,
} from "./model";

const input: PlatformOptimizationInput = {
  productionId: "production-123",
  projectId: "project-123",
  title: "Why replacing an HVAC system costs so much",
  summary: "A clear breakdown of materials, installation labor, and hidden costs.",
  primaryKeyword: "hvac replacement cost",
  platforms: ["youtube", "tiktok", "instagram-reels", "facebook-reels", "blog"],
  sourceRevision: "script-v4",
  brandColors: { primary: "#143D3A", secondary: "#35615F", accent: "#DBA754", background: "#FAF9F5", text: "#172725" },
  scriptSections: [
    { id: "hook", heading: "The real question", text: "An HVAC quote can include more than just equipment.", startSeconds: 0 },
    { id: "labor", heading: "Why installation matters", text: "Installation affects the final total.", startSeconds: 62 },
    { id: "cost", heading: "What to compare", text: "Compare scoped line items before deciding.", startSeconds: 182 },
  ],
  assets: [
    { id: "landscape-video", kind: "video", platform: "youtube", filename: "hvac.mp4", durationSeconds: 540 },
    { id: "landscape-thumbnail", kind: "thumbnail", platform: "youtube", filename: "hvac.png" },
    { id: "portrait-video", kind: "video", platform: "tiktok", filename: "hvac-short.mp4", durationSeconds: 95 },
    { id: "captions", kind: "captions", filename: "hvac.srt" },
  ],
};

describe("platform optimization authoring", () => {
  it("prepares distinct, source-derived metadata for requested platforms without inventing timestamps", () => {
    const result = createPlatformOptimizationManifest(input);
    expect(result.packages.map((item) => item.platform)).toEqual(["youtube", "tiktok", "instagram", "facebook", "blog"]);
    expect(result.brandColors).toEqual(input.brandColors);
    const youtube = result.packages[0];
    expect(youtube.fields.title).toBe(input.title);
    expect(youtube.fields.description).toContain("materials, installation labor");
    expect(youtube.fields.chapters).toEqual([
      { seconds: 0, title: "The real question" },
      { seconds: 62, title: "Why installation matters" },
      { seconds: 182, title: "What to compare" },
    ]);
    expect(youtube.assetIds.video).toBe("landscape-video");
    expect(youtube.assetIds.thumbnail).toBe("landscape-thumbnail");
    expect(result.packages.at(-1)?.fields.slug).toBe("why-replacing-an-hvac-system-costs-so-much");
    expect(result.packages[1].fields.chapters).toEqual([]);
    expect(result.packages[1].fields.description).not.toEqual(youtube.fields.description);
    expect(result.packages.every((item) => item.status === "draft")).toBe(true);
  });

  it("normalizes existing platform preset names without duplicate platform packages", () => {
    expect(normalizeTarget("youtube-shorts")).toBe("youtube-shorts");
    expect(normalizeTarget("youtube_shorts")).toBe("youtube-shorts");
    expect(normalizeTarget("instagram-feed")).toBe("instagram");
    expect(normalizeTarget("facebook-reels")).toBe("facebook");
    expect(normalizeTarget("unknown")).toBeNull();
    const packages = createPlatformOptimizationManifest({ ...input, platforms: ["instagram-reels", "instagram", "instagram-feed"] }).packages;
    expect(packages).toHaveLength(1);
  });

  it("keeps manual edits when source changes and explicitly marks stale packages", () => {
    const first = createPlatformOptimizationManifest(input);
    const edited = updatePlatformField(first, "youtube", "title", "The Real Cost Behind Your HVAC Quote");
    const changed = reconcilePlatformOptimizationManifest(edited, {
      ...input,
      title: "What HVAC installers actually charge",
      sourceRevision: "script-v5",
    });
    expect(changed.packages[0].fields.title).toBe("The Real Cost Behind Your HVAC Quote");
    expect(changed.packages[0].stale).toBe(true);
    expect(changed.packages[0].status).toBe("draft");
    expect(changed.packages[0].manualFields).toContain("title");
    expect(changed.packages[1].fields.title).toBe("What HVAC installers actually charge");
    expect(changed.packages[0].revision).toBeGreaterThan(first.packages[0].revision);
    const restored = resetPlatformField(changed, "youtube", "title", { ...input, title: "What HVAC installers actually charge", sourceRevision: "script-v5" });
    expect(restored.packages[0].fields.title).toBe("What HVAC installers actually charge");
    expect(restored.packages[0].manualFields).not.toContain("title");
  });

  it("requires destination review and actual media/rights before a package is approved", () => {
    const first = createPlatformOptimizationManifest(input);
    expect(reviewPlatformPackage(first.packages[0], input).issues.some((item) => item.code === "rights-unreviewed")).toBe(true);
    expect(() => approvePlatformPackage(first, "youtube", input)).toThrow(/review/i);
    const rights = updatePlatformField(first, "youtube", "rightsConfirmed", true);
    const policies = updatePlatformField(rights, "youtube", "platformPolicyReviewed", true);
    const disclosed = updatePlatformField(policies, "youtube", "madeForKids", false);
    const approved = approvePlatformPackage(disclosed, "youtube", input);
    expect(approved.packages[0].status).toBe("approved");
    expect(approved.packages[0].approvedRevision).toBe(approved.packages[0].revision);
    expect(updatePlatformField(approved, "youtube", "title", "A new title").packages[0].status).toBe("draft");
    expect(reviewPlatformPackage(first.packages[2], input).issues.some((item) => item.code === "video-missing")).toBe(true);
  });

  it("does not treat absent media or unconfirmed disclosure as automatic publication readiness", () => {
    const manifest = createPlatformOptimizationManifest({ ...input, assets: [] });
    expect(manifest.packages[0].assetIds.video).toBeNull();
    expect(reviewPlatformPackage(manifest.packages[0], { ...input, assets: [] }).readyToUpload).toBe(false);
    expect(manifest.packages.every((item) => item.status !== "published")).toBe(true);
  });

  it("uses each destination's revised script without marking unrelated destination metadata stale", () => {
    const variants: PlatformOptimizationInput = {
      ...input,
      platforms: ["youtube", "tiktok"],
      platformScripts: {
        youtube: [{ id: "a", heading: "Long story", text: "The long form explains installation complexity.", startSeconds: 0 }],
        tiktok: [{ id: "b", heading: "Short story", text: "A concise explanation of contractor quotes." }],
      },
    };
    const first = createPlatformOptimizationManifest(variants);
    expect(first.packages[0].fields.description).toContain("long form");
    expect(first.packages[1].fields.description).toContain("concise explanation");
    const second = reconcilePlatformOptimizationManifest(first, {
      ...variants,
      platformScripts: { ...variants.platformScripts, tiktok: [{ id: "b", heading: "Short story", text: "A new short-form voiceover." }] },
    });
    expect(second.packages[0]).toBe(first.packages[0]);
    expect(second.packages[1].stale).toBe(true);
    expect(second.packages[1].fields.description).toContain("new short-form voiceover");
  });
});

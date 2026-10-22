import type { EpisodeDraft } from "./episode-draft";

/** Synthetic, unverified creative planning fixture — not a factual cost estimate. */
export const illustrativeHvacEpisode: EpisodeDraft = {
  schemaVersion: 1,
  kind: "episode-draft",
  id: "episode-hvac-cost",
  projectId: "house-math",
  revision: 1,
  locale: "en-US",
  status: "draft",
  topic: {
    subject: "Why replacing an HVAC system costs so much",
    viewerQuestion: "Why can the installed quote exceed the equipment price?",
    answerPromise: "Separate equipment, qualified labor and site-specific work into a transparent quote.",
    payoffEventId: "hvac-cost-breakdown",
    claimRefs: ["claim-cost-components"],
  },
  brandRef: { id: "brand-house-math", revision: 1 },
  packaging: [
    {
      id: "concept-cost",
      title: "Why Replacing an HVAC System Costs So Much",
      thumbnailRef: { id: "thumbnail-cost", revision: 1 },
      hook: {
        narration: "The equipment is only part of the replacement quote. What else are you paying for?",
        payoffEventId: "hvac-cost-breakdown",
      },
    },
    {
      id: "concept-breakdown",
      title: "What's Actually Inside an HVAC Replacement Quote?",
      thumbnailRef: { id: "thumbnail-breakdown", revision: 1 },
      hook: {
        narration: "Let's separate the quote into the work and materials it covers.",
        payoffEventId: "hvac-cost-breakdown",
      },
    },
  ],
  selectedPackagingId: "concept-cost",
  storyboard: {
    ref: { id: "storyboard-hvac", revision: 1 },
    openingBeatId: "beat-hook",
    payoffEventIds: ["hvac-cost-breakdown"],
    claimRefs: ["claim-cost-components"],
  },
  evidence: [
    { id: "claim-cost-components", status: "needs-verification", sourceRefs: [] },
  ],
  delivery: [
    {
      presetId: "youtube",
      layoutIntent: "Authored 16:9 cost breakdown, not cropped",
      status: "not-authored",
      authoredSceneRef: null,
    },
    {
      presetId: "youtube-shorts",
      layoutIntent: "Independently authored 9:16 vertical cost reveal",
      status: "not-authored",
      authoredSceneRef: null,
    },
  ],
  approvals: { editorial: "pending", rights: "pending", visual: "pending" },
};

import type { IdeaMarketAssessment } from "@/lib/api/discovery-sessions";

export type IdeaVideoFormat = "long" | "shorts";

/** Legacy editorial readiness must never be substituted for an absent market score. */
export function usableComparison(assessment: IdeaMarketAssessment | null | undefined,
  format: IdeaVideoFormat): number | null {
  if (!assessment || assessment.state !== "succeeded" || assessment.format !== format ||
    assessment.sampleSize < 8 || assessment.distinctChannels < 3 ||
    assessment.comparisonCohortSize < 3) return null;
  return assessment.comparisonScore;
}

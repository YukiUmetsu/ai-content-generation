export interface HouseMathVisualPlan {
  schemaVersion: 1;
  kind: "house-math-visual-plan";
  title: string;
  manifest: { schemaVersion: 1; id: string; durationFrames: number; width: number; height: number; fps: { num: number; den: number }; preset: "youtube" };
  chapters: Array<{ id: string; intent: "house-intro" | "cost-breakdown" | "cost-timeline" | "cost-comparison" | "cost-payoff"; visual: { headline: string; subhead: string; emphasis: string }; startFrame: number; endFrame: number; eventIds: string[]; claimRefs: string[] }>;
  events: Record<string, number>;
  payoffEventId: string;
  scenario: { kind: "house-cost-v1"; purchasePrice: number; downPayment: number; annualInterestRatePct: number; years: number; annualPropertyTax: number; annualInsurance: number; annualMaintenance: number };
  economics: {
    principal: number; downPayment: number; monthlyMortgagePayment: number; totalMortgagePayments: number;
    totalMortgageInterest: number; annualCarryingCosts: number; totalCarryingCosts: number; totalCashOutflow: number;
    cashByYear: Array<{ year: number; cash: number }>;
    categories: Array<{ id: string; label: string; amount: number; color: string }>;
  };
  disclaimer: string;
  commercialReady: false;
}
export interface HouseMathFrame {
  frame: number; chapterIndex: number; chapterCount: number;
  intent: HouseMathVisualPlan["chapters"][number]["intent"];
  headline: string; subhead: string; emphasis: string; localFrame: number;
  enterProgress: number; revealProgress: number; progress: number;
  disclaimer: string; economics: HouseMathVisualPlan["economics"]; scenario: HouseMathVisualPlan["scenario"];
}
export declare function compileHouseMathVisuals(job: unknown, timeline: unknown): HouseMathVisualPlan;
export declare function getHouseMathFrame(plan: HouseMathVisualPlan, absoluteFrame: number): HouseMathFrame;

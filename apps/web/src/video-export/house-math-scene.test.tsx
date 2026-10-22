import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HouseMathVisualPlan } from "../../scripts/video-production/visual-plan.mjs";
import { HouseMathExportScene } from "./house-math-scene";

const baseEconomics = {
  principal: 400000, downPayment: 100000, monthlyMortgagePayment: 2398,
  totalMortgagePayments: 863352, totalMortgageInterest: 463352,
  annualCarryingCosts: 15000, totalCarryingCosts: 450000,
  totalCashOutflow: 1413352,
  cashByYear: Array.from({ length: 31 }, (_, year) => ({ year, cash: 100000 + year * 43778.4 })),
  categories: [
    { id: "down", label: "Down payment", amount: 100000, color: "#79AFC2" },
    { id: "loan", label: "Loan repayments", amount: 863352, color: "#D7B27A" },
  ],
};
const plan: HouseMathVisualPlan = {
  schemaVersion: 1, kind: "house-math-visual-plan", title: "House Math",
  manifest: { schemaVersion: 1, id: "test", width: 1920, height: 1080, durationFrames: 180, fps: { num: 30, den: 1 }, preset: "youtube" },
  chapters: [
    { id: "opening", intent: "house-intro", visual: { headline: "PRICE IS NOT TOTAL COST", subhead: "Illustrative loan assumptions", emphasis: "$500,000" }, startFrame: 0, endFrame: 60, eventIds: [], claimRefs: [] },
    { id: "components", intent: "cost-breakdown", visual: { headline: "THE COST DRIVERS", subhead: "A synthetic example", emphasis: "BREAKDOWN" }, startFrame: 60, endFrame: 120, eventIds: [], claimRefs: [] },
    { id: "payoff", intent: "cost-payoff", visual: { headline: "LIFETIME OUTFLOW", subhead: "Not net wealth cost", emphasis: "REVEAL" }, startFrame: 120, endFrame: 180, eventIds: ["lifetime-total-reveal"], claimRefs: [] },
  ],
  events: { "lifetime-total-reveal": 120 }, payoffEventId: "lifetime-total-reveal",
  scenario: { kind: "house-cost-v1", purchasePrice: 500000, downPayment: 100000, annualInterestRatePct: 6, years: 30, annualPropertyTax: 7000, annualInsurance: 3000, annualMaintenance: 5000 },
  economics: baseEconomics, disclaimer: "ILLUSTRATIVE SCENARIO · NOT A MARKET FORECAST OR NET WEALTH COST", commercialReady: false,
};

describe("House Math deterministic export scene", () => {
  it("renders actual 1920x1080 authored SVG with unique chapter content and caveat", () => {
    const beginning = renderToStaticMarkup(<HouseMathExportScene plan={plan} frame={0} />);
    const middle = renderToStaticMarkup(<HouseMathExportScene plan={plan} frame={80} />);
    expect(beginning).toContain("viewBox=\"0 0 1920 1080\"");
    expect(beginning).toContain("PRICE IS NOT TOTAL COST");
    expect(middle).toContain("THE COST DRIVERS");
    expect(middle).toContain("ILLUSTRATIVE SCENARIO");
  });

  it("does not place the final amount in the DOM before the event, then reveals it", () => {
    const at = renderToStaticMarkup(<HouseMathExportScene plan={plan} frame={120} />);
    const later = renderToStaticMarkup(<HouseMathExportScene plan={plan} frame={155} />);
    expect(at).not.toContain("$1,413,352");
    expect(later).toMatch(/opacity="1"[^>]*>\$1,413,352<\/text>/);
  });

  it("does not spoil the total on a preceding comparison scene", () => {
    const withComparison: HouseMathVisualPlan = {
      ...plan,
      chapters: plan.chapters.map((chapter) => chapter.id === "components"
        ? { ...chapter, intent: "cost-comparison" }
        : chapter),
    };
    const comparison = renderToStaticMarkup(<HouseMathExportScene plan={withComparison} frame={90} />);
    expect(comparison).toContain("TOTAL REVEALED AT THE END");
    expect(comparison).not.toContain("$1,413,352");
  });
});

import type { PackagingGenerationRequest } from "@/lib/api/types";

/**
 * Checked-in illustrative synthetic brief used by the packaging panel.
 *
 * Copied verbatim from
 * `crates/creative/fixtures/house-math-request.json` so the panel sends a
 * stable, reviewable request rather than inventing parameters at render time.
 */
export const demoBrief: PackagingGenerationRequest = {
  schema_version: 1,
  requested_at: "2026-10-21T00:00:00Z",
  brief: {
    brief_id: "brief-house-math-001",
    revision: 1,
    audience_market: "US household-cost explainer audience",
    audience_intent: "understand what a home really costs beyond the sticker price",
    format: "long_form",
    subject_label: "$500,000 house",
    timeframe_label: "30-year",
    decision_pair: {
      a: "waiting and renting",
      b: "buying at the sticker price",
    },
    promise_question: "What does a $500,000 house actually cost over 30 years?",
    cannot_assert:
      "No rent model, mortgage rate, property-tax growth series or maintenance series is sourced for this scenario, so no lifetime total or break-even point may be asserted as measured.",
    brand_kit_ref: "brand-kit-house-math",
    destination_profile_id: "destination-youtube-long-form",
  },
  evidence: [
    {
      evidence_id: "ev-price-anchor-house",
      source_title: "Shared fixture: one original house-cost video (docs/10-build-plan.md)",
      source_url: "",
      observed_at: "2026-10-21",
      locator: "docs/10-build-plan.md section 'Shared fixture: one original house-cost video'",
      claim:
        "The synthetic scenario uses a $500,000 home with parameterized purchase, down-payment, mortgage, tax, insurance, maintenance and rate changes.",
      role: "price_anchor",
      measurement: {
        status: "estimated",
        value: 500000.0,
        unit: "USD sticker price",
        estimate_basis:
          "Illustrative scenario input from docs/10-build-plan.md shared fixture; not a market observation.",
        source_kind: "scenario_assumption",
      },
    },
    {
      evidence_id: "ev-property-tax-outside-sticker",
      source_title: "Scenario status note (docs/10-build-plan.md section 'Shared fixture')",
      source_url: "",
      observed_at: "2026-10-21",
      locator:
        "docs/10-build-plan.md section 'Shared fixture: one original house-cost video', parameterized tax changes",
      claim:
        "Property tax is a recurring owner cost outside the sticker price; the scenario parameterizes it but no rate or series is sourced.",
      role: "hidden_component",
      measurement: {
        status: "unknown",
        value: null,
        unit: null,
        estimate_basis: null,
        source_kind: "not_yet_sourced",
      },
    },
    {
      evidence_id: "ev-insurance-outside-sticker",
      source_title: "Scenario status note (docs/10-build-plan.md section 'Shared fixture')",
      source_url: "",
      observed_at: "2026-10-21",
      locator:
        "docs/10-build-plan.md section 'Shared fixture: one original house-cost video', parameterized insurance changes",
      claim:
        "Home insurance is a recurring owner cost outside the sticker price; the scenario parameterizes it but no premium series is sourced.",
      role: "hidden_component",
      measurement: {
        status: "unknown",
        value: null,
        unit: null,
        estimate_basis: null,
        source_kind: "not_yet_sourced",
      },
    },
    {
      evidence_id: "ev-pew-housing-concern",
      source_title:
        "Pew Research Center: Cost concerns dominate as public's economic ratings turn more negative (2026-10-08)",
      source_url:
        "https://www.pewresearch.org/politics/2026/10/08/cost-concerns-dominate-as-publics-economic-ratings-turn-more-negative/",
      observed_at: "2026-10-08",
      locator: "Survey fielded Sep 28-Oct 4, 2026; n=5,062",
      claim: "66% of surveyed US adults are very concerned about housing costs.",
      role: "market_context",
      measurement: {
        status: "measured",
        value: 66.0,
        unit: "percent of surveyed US adults very concerned about housing costs",
        estimate_basis: null,
        source_kind: "published_survey",
      },
    },
    {
      evidence_id: "ev-fed-premium-burden",
      source_title:
        "Federal Reserve: Economic Well-Being of US Households in 2025, executive summary (May 2026)",
      source_url:
        "https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-executive-summary.htm",
      observed_at: "2026-05-01",
      locator: "Fielded Oct 2025, released May 2026",
      claim: "14% of insured homeowners struggled to afford premiums.",
      role: "market_context",
      measurement: {
        status: "measured",
        value: 14.0,
        unit: "percent of insured homeowners who struggled to afford premiums",
        estimate_basis: null,
        source_kind: "published_survey",
      },
    },
    {
      evidence_id: "ev-rent-baseline-missing",
      source_title: "Scenario status note (docs/10-build-plan.md section 'Shared fixture')",
      source_url: "",
      observed_at: "2026-10-21",
      locator:
        "docs/10-build-plan.md section 'Shared fixture: one original house-cost video', comparison/break-even bullet",
      claim:
        "No rent model is implemented; any comparison is limited to the declared scenario assumptions.",
      role: "comparison_baseline",
      measurement: {
        status: "unknown",
        value: null,
        unit: null,
        estimate_basis: null,
        source_kind: "none",
      },
    },
    {
      evidence_id: "ev-scenario-assumptions",
      source_title: "Scenario status note (docs/10-build-plan.md section 'Shared fixture')",
      source_url: "",
      observed_at: "2026-10-21",
      locator: "docs/10-build-plan.md section 'Shared fixture: one original house-cost video'",
      claim:
        "Mortgage rate, property tax growth and maintenance assumptions are not yet sourced for this scenario.",
      role: "assumption",
      measurement: {
        status: "unknown",
        value: null,
        unit: null,
        estimate_basis: null,
        source_kind: "not_yet_sourced",
      },
    },
    {
      evidence_id: "ev-market-scan-opportunity",
      source_title: "2026-10-21 YouTube explainer market scan (dated, directional evidence)",
      source_url: "docs/research/2026-10-21-video-market-scan.md",
      observed_at: "2026-10-21",
      locator:
        "Section 'Practical near-term opportunity themes (ideas, not actual proven videos)', High priority row 1",
      claim:
        "The $500,000-house lifetime-cost explainer is listed as an opportunity hypothesis, not a demonstrated outcome.",
      role: "market_context",
      measurement: {
        status: "unknown",
        value: null,
        unit: null,
        estimate_basis: null,
        source_kind: "dated_market_scan",
      },
    },
  ],
};

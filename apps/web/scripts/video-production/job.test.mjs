import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVideoProductionJob } from "./job.mjs";

const original = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));
const general = JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json", import.meta.url), "utf8"));
const modified = (change) => change(structuredClone(original));
const errorCodes = (result) => result.findings.filter((item) => item.severity === "error").map((item) => item.code);

test("validates the illustrative House Math smoke job", () => {
  const result = parseVideoProductionJob(original);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.job.approval, "test-only");
  assert.equal(result.job.destination.presetId, "youtube");
});

test("validates a general explainer and rejects family-incompatible or unsafe diagram data", () => {
  assert.equal(parseVideoProductionJob(general).ok, true, JSON.stringify(parseVideoProductionJob(general).findings));
  const copy = structuredClone(general);
  copy.beats[1].visual.items[0] = "x".repeat(100);
  assert.ok(errorCodes(parseVideoProductionJob(copy)).includes("invalid-diagram-item"));
  const house = structuredClone(general);
  house.visualFamily = "house-math-v1";
  assert.ok(errorCodes(parseVideoProductionJob(house)).includes("unsupported-scene-intent"));
  const orphan = structuredClone(general);
  orphan.beats[3].visualIntent = "general-flow";
  assert.ok(errorCodes(parseVideoProductionJob(orphan)).includes("invalid-payoff-scene"));
  const missing = structuredClone(general);
  missing.beats[0].visual.items = [];
  assert.ok(errorCodes(parseVideoProductionJob(missing)).includes("invalid-diagram-items"));
});

test("does not allow a duplicate beat or event identifier", () => {
  const job = modified((value) => { value.beats.push(value.beats[0]); return value; });
  assert.equal(errorCodes(parseVideoProductionJob(job)).includes("duplicate-id"), true);
  const events = modified((value) => { value.events.push(value.events[0]); return value; });
  assert.equal(errorCodes(parseVideoProductionJob(events)).includes("duplicate-id"), true);
});

test("rejects missing payoff and orphan cue references", () => {
  const noPayoff = modified((value) => { value.events = []; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(noPayoff)).includes("missing-payoff"), true);
  const orphan = modified((value) => { value.sounds[0].eventId = "made-up-event"; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(orphan)).includes("orphan-sound-event"), true);
});

test("rejects changed schema, unknown fields and missing voice mapping", () => {
  const schema = modified((value) => { value.schemaVersion = 2; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(schema)).includes("unsupported-schema"), true);
  const unknown = modified((value) => { value.apiKey = "should-never-appear"; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(unknown)).includes("unknown-field"), true);
  const voice = modified((value) => { value.voice.modelId = ""; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(voice)).includes("required-text"), true);
});

test("long mode requires the 480-second policy and never mislabels smoke as commercial", () => {
  const shortLong = modified((value) => { value.mode = "youtube-long"; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(shortLong)).includes("invalid-duration-policy"), true);
  const validLongContract = modified((value) => {
    value.mode = "youtube-long";
    value.destination.minimumDurationSeconds = 480;
    value.destination.targetDurationSeconds = [540, 900];
    return value;
  });
  assert.equal(parseVideoProductionJob(validLongContract).ok, true);
  const fakeApproval = modified((value) => { value.approval = "approved"; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(fakeApproval)).includes("commercial-approval-blocked"), true);
});

test("rejects ungrounded claims, wrong scene intent and mismatched output geometry", () => {
  const claim = modified((value) => { value.beats[0].claimRefs = ["missing-claim"]; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(claim)).includes("unknown-claim-ref"), true);
  const scene = modified((value) => { value.beats[0].visualIntent = "made-up-intent"; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(scene)).includes("unsupported-scene-intent"), true);
  const dimensions = modified((value) => { value.destination.width = 100; return value; });
  assert.equal(errorCodes(parseVideoProductionJob(dimensions)).includes("preset-raster-mismatch"), true);
});

test("missing or malformed nested data returns errors instead of throwing", () => {
  for (const field of ["topic", "references", "destination", "voice", "policy", "beats", "events", "sounds", "claims"]) {
    const value = modified((job) => { job[field] = null; return job; });
    assert.doesNotThrow(() => parseVideoProductionJob(value), field);
    assert.equal(parseVideoProductionJob(value).ok, false, field);
  }
  const missingEventArray = modified((job) => { delete job.beats[2].eventIds; return job; });
  assert.doesNotThrow(() => parseVideoProductionJob(missingEventArray));
  assert.equal(parseVideoProductionJob(missingEventArray).ok, false);
});

test("unverified voice license always blocks commercial approval", () => {
  const unlicensed = modified((job) => {
    job.approval = "approved";
    job.policy.commercialRightsVerified = true;
    job.policy.reviewerApproved = true;
    job.claims.forEach((claim) => { claim.status = "verified"; claim.sourceRefs = ["synthetic-evidence-reference"]; });
    job.sounds.forEach((sound) => { sound.licenseStatus = "verified"; });
    return job;
  });
  assert.equal(errorCodes(parseVideoProductionJob(unlicensed)).includes("commercial-approval-blocked"), true);
});

test("source-unknown model claims remain valid drafts but cannot be commercially approved", () => {
  const authored = structuredClone(general);
  authored.claims[0].status = "unverified";
  assert.equal(parseVideoProductionJob(authored).ok, true);
  authored.approval = "approved";
  assert.ok(errorCodes(parseVideoProductionJob(authored)).includes("commercial-approval-blocked"));
});

test("verified claims need a resolvable, versioned source with a passage locator", () => {
  const supported = structuredClone(general);
  supported.evidence = [{
    id: "research-1", title: "Network architecture reference",
    sourceUri: "https://example.org/networking/reference",
    retrievedAt: "2026-10-22T14:00:00.000Z", passageLocator: "section 3, paragraph 2",
    snapshotSha256: "a".repeat(64),
  }];
  supported.claims[0] = { id: "network-fact", text: "Packets can traverse intermediary devices.", status: "verified", sourceRefs: ["research-1"] };
  supported.beats.forEach((beat) => { beat.claimRefs = ["network-fact"]; });
  assert.equal(parseVideoProductionJob(supported).ok, true, JSON.stringify(parseVideoProductionJob(supported).findings));

  const cases = [
    ["without registry", (j) => { delete j.evidence; }, "unknown-source-ref"],
    ["missing locator", (j) => { delete j.evidence[0].passageLocator; }, "invalid-evidence"],
    ["missing hash", (j) => { j.evidence[0].snapshotSha256 = "not-a-content-hash"; }, "invalid-evidence"],
    ["insecure URL", (j) => { j.evidence[0].sourceUri = "http://example.org/"; }, "invalid-evidence"],
    ["invalid timestamp", (j) => { j.evidence[0].retrievedAt = "yesterday"; }, "invalid-evidence"],
    ["duplicate evidence", (j) => { j.evidence.push(j.evidence[0]); }, "duplicate-id"],
    ["orphan reference", (j) => { j.claims[0].sourceRefs = ["unknown-id"]; }, "unknown-source-ref"],
  ];
  for (const [label, change, code] of cases) {
    const broken = structuredClone(supported);
    change(broken);
    assert.ok(errorCodes(parseVideoProductionJob(broken)).includes(code), label);
  }
});

test("model-authored drafts need no evidence registry, but cannot launder fake source references", () => {
  assert.equal(parseVideoProductionJob(general).ok, true);
  const fake = structuredClone(general);
  fake.claims[0].sourceRefs = ["invented-article"];
  assert.ok(errorCodes(parseVideoProductionJob(fake)).includes("unknown-source-ref"));
});

test("scenario economics and per-beat visual copy must be finite and fit authored scenes", () => {
  const valid = modified((j) => {
    j.scenario = { kind: "house-cost-v1", purchasePrice: 500000, downPayment: 100000, annualInterestRatePct: 6, years: 30, annualPropertyTax: 7000, annualInsurance: 3000, annualMaintenance: 5000 };
    j.beats[0].visual = { headline: "PRICE IS NOT COST", subhead: "A hypothetical thirty-year calculation", emphasis: "$500,000" };
    return j;
  });
  assert.equal(parseVideoProductionJob(valid).ok, true);
  const invalid = modified((j) => {
    j.scenario = { kind: "house-cost-v1", purchasePrice: 100, downPayment: 200, annualInterestRatePct: Infinity, years: 30, annualPropertyTax: -1, annualInsurance: 0, annualMaintenance: 0 };
    j.beats[0].visual = { headline: "A".repeat(130), subhead: "Safe", emphasis: "Price" };
    return j;
  });
  assert.ok(errorCodes(parseVideoProductionJob(invalid)).includes("invalid-scenario"));
  assert.ok(errorCodes(parseVideoProductionJob(invalid)).includes("visual-copy-overflow"));
});

const chartFixture = (basis = "measured") => {
  const job = structuredClone(general);
  job.evidence = [{
    id: "test-snapshot", title: "Synthetic test-only data table",
    sourceUri: "https://example.org/test-data", retrievedAt: "2026-10-22T14:00:00.000Z",
    passageLocator: "table 1, all rows", snapshotSha256: "b".repeat(64),
  }];
  job.claims.push({
    id: "chart-values", status: basis === "measured" ? "verified" : "illustrative",
    text: "Chart values are synthetic test-fixture numbers.",
    ...(basis === "measured" ? { sourceRefs: ["test-snapshot"] } : {}),
  });
  job.beats[1].claimRefs = ["chart-values"];
  job.beats[1].visual.chart = {
    kind: "quantitative-chart-v1", categories: ["Period A", "Period B", "Period C"],
    series: [
      { id: "group-a", label: "Group A", values: [12, 18, null] },
      { id: "group-b", label: "Group B", values: [0, 9, 14] },
    ],
    unit: "ms",
    provenance: {
      basis, disclosure: basis === "measured"
        ? "Synthetic measured-data contract test; verify real evidence before publication."
        : "Illustrative invented values, not measurements.",
      claimRefs: ["chart-values"],
      ...(basis === "measured" ? { evidenceRefs: ["test-snapshot"] }
        : { assumptions: ["Hypothetical values for a visualization demonstration."] }),
    },
  };
  return job;
};

test("optional quantitative chart payload accepts finite and null values with verified provenance", () => {
  const result = parseVideoProductionJob(chartFixture());
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.deepEqual(result.job.beats[1].visual.chart.series[0].values, [12, 18, null]);
  assert.equal(parseVideoProductionJob(general).ok, true, "legacy generic jobs remain valid");
  assert.equal(parseVideoProductionJob(original).ok, true, "legacy House Math jobs remain valid");
});

test("quantitative charts reject malformed categories, series, values and units", () => {
  const cases = [
    ["missing categories", (c) => { delete c.categories; }, "invalid-chart-categories"],
    ["empty category", (c) => { c.categories[1] = " "; }, "invalid-chart-category"],
    ["duplicate category", (c) => { c.categories[1] = "Period A"; }, "duplicate-chart-category"],
    ["unsafe label", (c) => { c.series[0].label = "Group\nA"; }, "invalid-chart-series-label"],
    ["duplicate series", (c) => { c.series[1].id = "group-a"; }, "duplicate-id"],
    ["inconsistent length", (c) => { c.series[0].values.pop(); }, "invalid-chart-values"],
    ["infinite number", (c) => { c.series[0].values[0] = Infinity; }, "invalid-chart-value"],
    ["NaN number", (c) => { c.series[0].values[0] = NaN; }, "invalid-chart-value"],
    ["numeric string", (c) => { c.series[0].values[0] = "12"; }, "invalid-chart-value"],
    ["all null", (c) => { c.series[0].values = [null, null, null]; }, "empty-chart-series"],
    ["missing unit", (c) => { delete c.unit; }, "invalid-chart-unit"],
    ["unknown field", (c) => { c.predictedGrowth = 0.9; }, "unknown-field"],
    ["non-chart object", (c) => { c.kind = "unknown"; }, "invalid-chart-kind"],
  ];
  for (const [label, change, expected] of cases) {
    const job = chartFixture();
    change(job.beats[1].visual.chart);
    assert.ok(errorCodes(parseVideoProductionJob(job)).includes(expected), label);
  }
});

test("measured chart data must follow a verified claim to exactly its evidence snapshots", () => {
  const cases = [
    ["missing provenance", (j, c) => { delete c.provenance; }, "invalid-object"],
    ["unsourced claim", (j) => { j.claims[1].sourceRefs = []; }, "chart-unverified-claim"],
    ["unverified claim", (j) => { j.claims[1].status = "unverified"; }, "chart-unverified-claim"],
    ["unrelated claim", (j, c) => { c.provenance.claimRefs = ["unrelated"]; }, "chart-claim-not-in-beat"],
    ["missing evidenceRefs", (j, c) => { delete c.provenance.evidenceRefs; }, "chart-evidence-mismatch"],
    ["unbound evidence", (j, c) => { c.provenance.evidenceRefs = ["not-a-source"]; }, "chart-evidence-mismatch"],
    ["extra evidence", (j, c) => { c.provenance.evidenceRefs.push("extra"); }, "chart-evidence-mismatch"],
    ["missing disclosure", (j, c) => { c.provenance.disclosure = ""; }, "invalid-chart-disclosure"],
  ];
  for (const [label, change, expected] of cases) {
    const job = chartFixture();
    change(job, job.beats[1].visual.chart);
    assert.ok(errorCodes(parseVideoProductionJob(job)).includes(expected), label);
  }
});

test("illustrative chart data require honest disclosure and assumption provenance", () => {
  const good = chartFixture("illustrative");
  assert.equal(parseVideoProductionJob(good).ok, true, JSON.stringify(parseVideoProductionJob(good).findings));
  const cases = [
    ["no assumptions", (c) => { delete c.provenance.assumptions; }, "invalid-chart-assumptions"],
    ["measured evidence disguised as illustrative", (c) => { c.provenance.evidenceRefs = ["test-snapshot"]; }, "invalid-chart-provenance"],
    ["no disclosure", (c) => { c.provenance.disclosure = ""; }, "invalid-chart-disclosure"],
    ["misleading disclosure", (c) => { c.provenance.disclosure = "Real-world measurements of these groups."; }, "invalid-chart-disclosure"],
    ["wrong kind of claim", (c, j) => { j.claims[1].status = "verified"; j.claims[1].sourceRefs = ["test-snapshot"]; }, "chart-claim-status-mismatch"],
    ["unknown basis", (c) => { c.provenance.basis = "predicted"; }, "invalid-chart-provenance"],
  ];
  for (const [label, change, expected] of cases) {
    const job = chartFixture("illustrative");
    change(job.beats[1].visual.chart, job);
    assert.ok(errorCodes(parseVideoProductionJob(job)).includes(expected), label);
  }
});

test("house-math scenes cannot silently attach an unrendered general chart", () => {
  const job = structuredClone(original);
  job.beats[0].visual = chartFixture().beats[1].visual;
  assert.ok(errorCodes(parseVideoProductionJob(job)).includes("unknown-field"));
});

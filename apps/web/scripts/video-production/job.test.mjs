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

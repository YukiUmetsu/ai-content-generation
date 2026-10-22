import { describe, expect, it } from "vitest";
import type { EpisodeDraft } from "./episode-draft";
import {
  choosePackaging,
  readEpisodeDraft,
  serializeEpisodeDraft,
  validateEpisodeDraft,
} from "./episode-draft";
import { illustrativeHvacEpisode } from "./fixture";

function fixture(): EpisodeDraft {
  return JSON.parse(JSON.stringify(illustrativeHvacEpisode)) as EpisodeDraft;
}
function errors(input: unknown): string[] {
  return validateEpisodeDraft(input)
    .filter((finding) => finding.severity === "error")
    .map((finding) => finding.code);
}

describe("Episode Draft handoff contract", () => {
  it("accepts a draft while warning that evidence and layouts are unapproved", () => {
    expect(errors(fixture())).toEqual([]);
    const codes = validateEpisodeDraft(fixture()).map((finding) => finding.code);
    expect(codes).toContain("unverified-claim");
    expect(codes).toContain("layout-not-authored");
  });

  it("round-trips deterministic JSON with a stable key order", () => {
    const doc = fixture();
    const saved = serializeEpisodeDraft(doc);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = readEpisodeDraft(saved.json);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.draft).toEqual(doc);
    expect(serializeEpisodeDraft(loaded.draft)).toEqual(saved);
    const reshuffled = { ...doc, id: doc.id, projectId: doc.projectId };
    const other = serializeEpisodeDraft(reshuffled);
    expect(other.ok && other.json).toBe(saved.json);
  });

  it("rejects unsupported versions and malformed JSON", () => {
    expect(readEpisodeDraft("{bad").findings[0]?.code).toBe("invalid-json");
    expect(errors({ ...fixture(), schemaVersion: 2 })).toContain("unsupported-schema");
  });

  it("detects duplicate concepts and invalid selections", () => {
    const doc = fixture();
    doc.selectedPackagingId = "not-found";
    expect(errors(doc)).toContain("unresolved-selection");
    doc.selectedPackagingId = "concept-cost";
    doc.packaging[1].id = doc.packaging[0].id;
    expect(errors(doc)).toContain("duplicate-id");
  });

  it("catches misleading title-hook promises", () => {
    const doc = fixture();
    doc.packaging[1].hook.payoffEventId = "unrelated-result";
    expect(errors(doc)).toContain("promise-drift");
  });

  it("rejects storyboard claim drift and missing promised payoff", () => {
    const doc = fixture();
    if (!doc.storyboard) throw new Error("Fixture missing storyboard.");
    doc.storyboard.claimRefs.push("out-of-scope");
    doc.storyboard.payoffEventIds = ["different-event"];
    expect(errors(doc)).toEqual(expect.arrayContaining(["storyboard-claim-drift", "payoff-missing"]));
  });

  it("requires source refs for verified claims and only known Kumiki output profiles", () => {
    const doc = fixture();
    doc.evidence[0].status = "verified";
    expect(errors(doc)).toContain("verified-without-source");
    doc.evidence[0].sourceRefs = ["source-doc-1"];
    expect(errors(doc)).not.toContain("verified-without-source");
    doc.delivery[0].presetId = "unknown-platform" as typeof doc.delivery[number]["presetId"];
    expect(errors(doc)).toContain("unknown-preset");
  });

  it("does not pretend an output was authored without an independent scene", () => {
    const doc = fixture();
    doc.delivery[0].status = "authored";
    expect(errors(doc)).toContain("missing-scene");
    doc.delivery[0].authoredSceneRef = { id: "portrait-scene", revision: 1 };
    expect(errors(doc)).not.toContain("missing-scene");
  });

  it("refuses falsely approved episodes until evidence, layouts and reviews are resolved", () => {
    const doc = fixture();
    doc.status = "approved";
    expect(errors(doc)).toContain("approval-blocked");
    expect(errors(doc)).toContain("review-incomplete");

    doc.evidence[0].status = "verified";
    doc.evidence[0].sourceRefs = ["reviewed-source-1"];
    doc.delivery.forEach((intent) => {
      intent.status = "authored";
      intent.authoredSceneRef = { id: "scene-" + intent.presetId, revision: 1 };
    });
    doc.approvals = { editorial: "approved", rights: "approved", visual: "approved" };
    expect(errors(doc)).toEqual([]);
  });

  it("does not mutate source objects when switching packages and invalidates approvals", () => {
    const doc = fixture();
    doc.approvals = { editorial: "approved", rights: "approved", visual: "approved" };
    const switched = choosePackaging(doc, "concept-breakdown");
    expect(switched).toMatchObject({
      selectedPackagingId: "concept-breakdown",
      revision: 2,
      status: "draft",
      approvals: { editorial: "pending", rights: "approved", visual: "pending" },
    });
    expect(doc.selectedPackagingId).toBe("concept-cost");
    expect(choosePackaging(doc, "does-not-exist")).toBeNull();
    expect(choosePackaging(doc, "concept-cost")).toBe(doc);
  });

  it("blocks invalid serialization instead of writing broken snapshots", () => {
    const doc = fixture();
    doc.brandRef = { id: "brand", revision: -3 };
    expect(serializeEpisodeDraft(doc)).toMatchObject({ ok: false });
  });

  it("rejects malformed nested payloads without crashing", () => {
    expect(errors({ ...fixture(), topic: 123 })).toContain("invalid-topic");
    expect(errors({ ...fixture(), packaging: [{}] })).toContain("required-text");
    expect(errors({ ...fixture(), storyboard: [] })).toContain("invalid-storyboard");
  });
});

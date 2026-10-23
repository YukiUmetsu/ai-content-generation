import { afterEach, describe, expect, it, vi } from "vitest";
import { countBySeverity, validateStoryboard } from "@/features/storyboard-planner/model/validate";
import {
  createDraft, draftToStoryboard, loadEditorialDraft, persistEditorialDraft,
  starterApproaches, validateEditorialDraft,
} from "./editorial-brief";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe("editorial niche to storyboard", () => {
  it("creates three different, editable storytelling strategies without needing observed videos", () => {
    const draft = createDraft("heat pump vs gas furnace cost");
    expect(draft.input.topic).toBe("heat pump vs gas furnace cost");
    expect(draft.approaches).toHaveLength(3);
    expect(new Set(draft.approaches.map(x => x.strategy)).size).toBe(3);
    expect(draft.approaches.every(x => x.hook.includes(draft.input.viewerQuestion))).toBe(true);
    expect(JSON.stringify(draft)).not.toContain("viewCount");
    draft.approaches[1].hook = "An original opening I wrote myself.";
    expect(validateEditorialDraft(draft).approaches[1].hook).toBe("An original opening I wrote myself.");
  });

  it("keeps local drafts separate by niche and bounds malformed storage", () => {
    const house = createDraft("new roof cost");
    house.input.audience = "First-time homeowners";
    persistEditorialDraft("watch-house", house);
    expect(loadEditorialDraft("watch-house", "anything").draft.input.audience).toBe("First-time homeowners");
    expect(loadEditorialDraft("watch-finance", "compound interest").draft.input.topic).toBe("compound interest");
    localStorage.setItem("contentgen:editorial-brief:v1:watch-house", JSON.stringify({...house, unknown:"unsafe"}));
    const restored = loadEditorialDraft("watch-house", "new roof cost");
    expect(restored.warning).toMatch(/invalid|unexpected/i);
    expect(restored.draft.input.topic).toBe("new roof cost");
  });

  it("produces a valid original storyboard that answers the opening question with unverified claims", () => {
    const draft = createDraft("heat pump cost");
    draft.input.audience = "Homeowners comparing quotes";
    draft.input.viewerQuestion = "What belongs in the full installed cost?";
    draft.input.payoff = "Compare complete installed scopes before deciding.";
    draft.input.reviewNotes = "Local permit rules need confirmation.";
    draft.input.inspirationUrl = "https://www.youtube.com/watch?v=abcABC12345";
    draft.approaches = starterApproaches(draft.input);
    const board = draftToStoryboard(draft, "project-new-123", "en");
    expect(board.kind).toBe("contentgen-semantic-storyboard");
    expect(board.beats[0].role).toBe("hook");
    expect(board.beats[0].opensQuestion).toBe(board.questions[0].id);
    expect(board.beats.at(-1)?.answersQuestion).toBe(board.questions[0].id);
    expect(board.beats[0].visualObjective).toMatch(/reveal|change|show|separat/i);
    expect(board.claims.every(x => x.status === "unverified")).toBe(true);
    expect(board.claims.every(x => x.sourceRefs.length === 0)).toBe(true);
    expect(board.assumptions.join(" ")).toContain("inspiration only");
    expect(countBySeverity(validateStoryboard(board)).errors).toBe(0);
    expect(JSON.stringify(board)).not.toMatch(/viewCount|subscriberCount|likeCount|channelTitle/);
  });

  it("rejects malformed approaches rather than persisting arbitrary object fields", () => {
    const draft = createDraft("property tax");
    expect(() => validateEditorialDraft({...draft, approaches: []})).toThrow();
    expect(() => validateEditorialDraft({...draft, approaches: [{...draft.approaches[0], hook: ""},...draft.approaches.slice(1)]})).toThrow();
  });
});

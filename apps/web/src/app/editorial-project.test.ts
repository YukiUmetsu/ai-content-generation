import { afterEach, describe, expect, it, vi } from "vitest";
import { newCatalog } from "./catalog-model";
import { createDraft } from "./editorial-brief";
import { createEditorialProject } from "./editorial-project";
import { loadProjectStoryboard, saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { HVAC_EXAMPLE } from "@/features/storyboard-planner/model/hvac-example";
import { researchedFixture } from "./researched-storyboard.test";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("editorial handoff transaction", () => {
  it("makes a new video project without overwriting the current storyboard", () => {
    const initial = newCatalog();
    saveProjectStoryboard(initial.activeProjectId, HVAC_EXAMPLE);
    const next = createEditorialProject(initial, createDraft("property tax basics"), "en");
    expect(next.activeProjectId).not.toBe(initial.activeProjectId);
    expect(next.projects).toHaveLength(2);
    expect(next.content).toHaveLength(1);
    expect(next.content[0].stage).toBe("draft");
    expect(loadProjectStoryboard(next.activeProjectId).board?.title).toMatch(/property tax basics/);
    expect(loadProjectStoryboard(initial.activeProjectId).board).toEqual(HVAC_EXAMPLE);
  });

  it("leaves the previous active project unchanged when catalog persistence fails", () => {
    const initial = newCatalog();
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this: Storage,key,value){
      if(key==="contentgen:studio-catalog:v1") throw Error("Quota reached");
      return originalSet.call(this,key,value);
    });
    expect(() => createEditorialProject(initial, createDraft("roof replacement"), "en")).toThrow(/Quota reached/);
    expect(initial.activeProjectId).toBe("project-local");
    expect(initial.projects).toHaveLength(1);
  });

  it("keeps creator-selected YouTube URLs in notes but never copies provider statistics", () => {
    const draft = createDraft("heat pump installation");
    draft.input.inspirationUrls = [
      "https://www.youtube.com/watch?v=abcABC12345",
      "https://www.youtube.com/watch?v=defDEF12345",
    ];
    const next = createEditorialProject(newCatalog(),draft,"en");
    expect(next.content[0].notes).toContain("abcABC12345");
    expect(next.content[0].notes).toContain("defDEF12345");
    expect(next.content[0].notes).not.toContain("views");
    const board = loadProjectStoryboard(next.activeProjectId).board!;
    expect(board.assumptions.join(" ")).toContain("defDEF12345");
    expect(board.claims.every(c => c.status === "unverified" && c.sourceRefs.length === 0)).toBe(true);
  });
  it("creates a separate project with researched shots and an audit link to the immutable snapshot",()=>{
    const next=createEditorialProject(newCatalog(),createDraft("home insulation"),"en",researchedFixture);
    const board=loadProjectStoryboard(next.activeProjectId).board!;
    expect(board.beats).toHaveLength(3);
    expect(board.beats[1].narration).toContain("Insulation resists");
    expect(next.content[0].notes).toContain("research_home");
    expect(board.claims[0].sourceRefs).toEqual(["source_01"]);
  });
});

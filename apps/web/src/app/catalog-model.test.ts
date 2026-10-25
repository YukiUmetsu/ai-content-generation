import { beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_KEY, catalogCounts, loadCatalog, newCatalog, parseCatalog, persistCatalog, saveProjectAppearance,
  validateCatalog, withoutProject, type StudioCatalog,
} from "./catalog-model";
import { DEFAULT_PROJECT_PALETTE } from "./project-brand-appearance";

describe("Studio local metadata catalog", () => {
  beforeEach(() => localStorage.clear());
  const second = {id:"project-second",name:"Another project",notes:"Research videos",createdAt:"2026-10-22T00:00:00.000Z"};
  function fixture(): StudioCatalog {
    const base=newCatalog("2026-10-22T00:00:00.000Z");
    return { ...base,projects:[...base.projects,second],activeProjectId:second.id,
      content:[{id:"item-script",projectId:second.id,name:"How networks work",notes:"",createdAt:second.createdAt,kind:"short",stage:"review"}],
      assets:[{id:"item-audio",projectId:second.id,name:"Licensed narrator",notes:"Contract reviewed",createdAt:second.createdAt,kind:"audio",rights:"cleared",source:"Owned recording"}],
      products:[{id:"item-course",projectId:second.id,name:"Network course",notes:"",createdAt:second.createdAt,kind:"course",stage:"planned"}] };
  }
  it("starts with one local project and persists only to same-browser metadata", () => {
    const fresh=loadCatalog();
    expect(fresh.warning).toBeNull();
    expect(fresh.catalog.projects).toHaveLength(1);
    const next=fixture();
    persistCatalog(next);
    expect(localStorage.getItem(CATALOG_KEY)).not.toBeNull();
    expect(loadCatalog().catalog).toEqual(next);
    expect(catalogCounts(next,second.id)).toEqual({
      content:1,assets:1,products:1,ready:0,published:0,rightsCleared:1,rightsNeedsReview:0,
    });
  });
  it("rejects unrecognized API credentials, bad refs, duplicated IDs and oversized imports", () => {
    const clean=fixture();
    expect(()=>validateCatalog({...clean,apiKey:"private"})).toThrow(/Unexpected field/);
    expect(()=>validateCatalog({...clean,voiceId:"secret"})).toThrow(/Unexpected field/);
    expect(()=>validateCatalog({...clean,content:[{...clean.content[0],apiKey:"leak"}]})).toThrow(/Unexpected field/);
    expect(()=>validateCatalog({...clean,content:[{...clean.content[0],projectId:"project-missing"}]})).toThrow(/missing project/);
    expect(()=>validateCatalog({...clean,projects:[clean.projects[0],clean.projects[0]]})).toThrow(/repeated IDs/);
    expect(()=>validateCatalog({...clean,content:[{...clean.content[0],stage:"fake-performance"}]})).toThrow(/unsupported value/);
    expect(()=>validateCatalog({...clean,assets:[{...clean.assets[0],rights:"auto-cleared"}]})).toThrow(/unsupported value/);
    expect(()=>parseCatalog("x".repeat(512*1024+1))).toThrow(/512 KB/);
  });
  it("removes one project and only its dependent local entries", () => {
    const clean=fixture();
    const removed=withoutProject(clean,second.id);
    expect(removed.activeProjectId).toBe(clean.projects[0].id);
    expect(removed.projects).toHaveLength(1);
    expect(removed.content).toHaveLength(0);
    expect(removed.assets).toHaveLength(0);
    expect(removed.products).toHaveLength(0);
    expect(()=>withoutProject(removed,removed.activeProjectId)).toThrow(/final project/);
  });
  it("refuses corrupt storage and does not silently write over the original", () => {
    localStorage.setItem(CATALOG_KEY,'{"version":1,"apiKey":"secret"}');
    const loaded=loadCatalog();
    expect(loaded.warning).toMatch(/could not be loaded/);
    expect(loaded.catalog.projects).toHaveLength(1);
    expect(localStorage.getItem(CATALOG_KEY)).toContain("secret");
    expect(()=>persistCatalog({...fixture(),products:[{...fixture().products[0],name:"\0unsafe"}]})).toThrow(/control codes/);
  });
  it("never invents publication, rights approval or sales metrics", () => {
    const catalog=fixture();
    expect(catalogCounts(catalog,second.id).published).toBe(0);
    expect(catalogCounts(catalog,second.id).rightsCleared).toBe(1);
    expect(JSON.stringify(catalogCounts(catalog,second.id))).not.toMatch(/views|revenue|viral|watchtime/i);
  });

  it("keeps Project brand revisions and reusable colors isolated across save/load", () => {
    const original = fixture();
    const now = "2026-10-25T00:00:00.000Z";
    const first = saveProjectAppearance(original, second.id, {
      palette: {...DEFAULT_PROJECT_PALETTE, accent:"#CA581D", custom:[]},
      typographyPreset:"calm-editorial",
    }, now);
    expect(first.projects.find(p=>p.id===second.id)?.brandAppearance?.revision).toBe(1);
    expect(first.projects[0].brandAppearance).toBeUndefined();
    const secondSave = saveProjectAppearance(first,second.id,{
      palette:{...DEFAULT_PROJECT_PALETTE,accent:"#1B758A",custom:[]},
      typographyPreset:"calm-editorial",
    },"2026-10-25T01:00:00.000Z");
    const changed = secondSave.projects.find(p=>p.id===second.id)!;
    expect(changed.brandAppearance?.revision).toBe(2);
    expect(changed.brandAppearanceHistory?.map(v=>v.palette.accent)).toEqual(["#CA581D"]);
    persistCatalog(secondSave);
    expect(loadCatalog().catalog).toEqual(secondSave);
    expect(original.projects[1].brandAppearance).toBeUndefined();
  });

  it("preserves imported legacy projects with no appearance fields and rejects corrupt history", () => {
    const old = fixture();
    expect(parseCatalog(JSON.stringify(old))).toEqual(old);
    const fresh = saveProjectAppearance(old,second.id,{
      palette:{...DEFAULT_PROJECT_PALETTE,custom:[]}, typographyPreset:"modern-analytical",
    },"2026-10-25T00:00:00.000Z");
    const invalid = {...fresh,projects:fresh.projects.map(p=>p.id===second.id?{...p,brandAppearanceHistory:[{...p.brandAppearance, revision:1000}]}:p)};
    expect(()=>validateCatalog(invalid)).toThrow(/revision|history/i);
  });
});


import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { compilePreproductionBundle } from "../../scripts/video-production/preproduction.mjs";
import { compileLiveVisualPreview } from "../../scripts/video-production/live-visual-preview.mjs";
import { compilePreproductionRenderJob } from "../../scripts/video-production/preproduction-render-bridge.mjs";
import { parseVideoProductionJob } from "../../scripts/video-production/job.mjs";
import { GeneralExportScene } from "./general-scene";
const fixture=(name:string)=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
function getSample(){
  const dossier=fixture("preproduction-research-smoke.json");
  const bundle=compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"));
  const preview=compileLiveVisualPreview(dossier,bundle);
  return {dossier,bundle,preview};
}
const video=(plan:ReturnType<typeof getSample>["preview"]["plan"],frame:number)=>
  renderToStaticMarkup(<GeneralExportScene plan={plan} frame={frame}/>);
describe("meaningful three-scene home ownership demo in the actual exporter",()=>{
  it("creates a consistent source-to-MP4 recipe with genuinely informative narration and illustrative status",()=>{
    const {dossier,bundle,preview}=getSample();
    expect(dossier.claims[0].status).toBe("illustrative");
    expect(dossier.claims[0].text).toMatch(/mortgage interest|financing interest/);
    expect(bundle.plan.shots.map((s:{sceneRecipe:string})=>s.sceneRecipe))
      .toEqual(["home-cost-story-v1","home-cost-story-v1","home-cost-story-v1"]);
    expect(bundle.plan.sound[1].narration).toMatch(/property tax|insurance|maintenance/i);
    expect(preview.plan.chapters.every(c=>c.visual.sceneRecipe==="home-cost-story-v1")).toBe(true);
    expect(preview.plan.commercialReady).toBe(false);
    const job=compilePreproductionRenderJob(dossier,bundle).job;
    expect(parseVideoProductionJob(job).ok).toBe(true);
    expect(job.beats.every(b=>b.visual.sceneRecipe==="home-cost-story-v1")).toBe(true);
  });
  it("starts with an identifiable illustrated house and prominent hypothetical $500K price hook",()=>{
    const {preview}=getSample(),opening=video(preview.plan,preview.plan.chapters[0].startFrame+35);
    expect(opening).toContain('data-story-scene="question"');
    expect(opening).toContain('data-story-object="house"');
    expect(opening).toContain('data-story-price-tag=""');
    expect(opening).toContain("$500,000");
    expect(opening).toContain("HYPOTHETICAL ASKING PRICE");
    expect(opening).toContain("So where does the rest of the money go?");
    expect(opening).not.toContain("DRAFT");
    expect(opening).not.toMatch(/\b0[1-3] \/ 0[1-3]\b/);
  });
  it("reveals four recognizable ownership expenses around the same house with no off-canvas cards",()=>{
    const {preview}=getSample(),scene=preview.plan.chapters[1];
    const first=video(preview.plan,scene.startFrame);
    const finish=video(preview.plan,scene.endFrame-1);
    expect(first).toContain('data-story-scene="mechanism"');
    expect(first).toContain('data-story-object="house"');
    expect(first).not.toContain('data-story-cost="3"');
    for(let i=0;i<4;i++)expect(finish).toContain(`data-story-cost="${i}"`);
    for(const term of ["Mortgage Interest","Property Tax","Home Insurance","Maintenance"]){
      expect(finish).toContain(term);
    }
    expect(finish).toContain("The bills keep arriving.");
    // Cards at x 812/1286, 445px wide, y 291/513, 178px high
    for(const [x,y] of [[812,291],[1286,291],[812,513],[1286,513]]){
      expect(x+445).toBeLessThan(1808);
      expect(y+178).toBeLessThan(945);
      expect(finish).toContain(`x="${x}" y="${y}" width="445" height="178"`);
    }
    expect(finish).not.toContain("DRAFT ·");
  });
  it("holds back the earned takeaway until the payoff event, then shows a conditional concept rather than fabricated total",()=>{
    const {preview}=getSample(),chapter=preview.plan.chapters[2];
    const event=video(preview.plan,chapter.startFrame),late=video(preview.plan,chapter.endFrame-1);
    expect(event).toContain('data-story-payoff-locked="true"');
    expect(event).not.toContain("MORE THAN");
    expect(event).not.toContain('data-story-takeaway=""');
    expect(late).toContain("Purchase price");
    expect(late).toContain("Mortgage Interest");
    expect(late).toContain("Home Insurance");
    expect(late).toContain("Maintenance");
    expect(late).toContain('data-story-takeaway=""');
    expect(late).toContain("MORE THAN");
    expect(late).toContain("$500,000");
    expect(late).toContain("Sale proceeds are excluded.");
    expect(late).not.toContain("UNVERIFIED EDITORIAL DRAFT");
    expect(late).not.toContain("DRAFT ·");
  });
  it("rejects fabricated custom recipe names rather than pretending an unsupported animation is rendered",()=>{
    const {dossier,bundle}=getSample();
    const bad=structuredClone(bundle.plan);
    bad.shots[0].sceneRecipe="magically-generate-film";
    expect(()=>compilePreproductionBundle(dossier,bad)).toThrow(/unknown-scene-recipe|invalid/i);
  });
});

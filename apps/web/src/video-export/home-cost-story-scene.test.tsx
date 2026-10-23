
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { GeneralExportScene } from "./general-scene";

const names=["House","Mortgage Interest","Property Tax","Home Insurance","Maintenance"];
const plan:GeneralVisualPlan={
  schemaVersion:1,kind:"general-explainer-visual-plan",
  title:"Why a $500,000 house can cost more than $500,000",locale:"en-US",
  manifest:{schemaVersion:1,id:"illustrative-home",durationFrames:330,width:1920,height:1080,
    fps:{num:30,den:1},preset:"youtube"},
  chapters:[
    {id:"hook",intent:"general-intro",startFrame:0,endFrame:110,
      visual:{headline:"A $500K house isn't a $500K bill",subhead:"The listing price is not everything",
        emphasis:"HOOK",items:names,sceneRecipe:"home-cost-story-v1"},claimRefs:[],evidenceRefs:[],eventIds:[]},
    {id:"mechanism",intent:"general-flow",startFrame:110,endFrame:220,
      visual:{headline:"Four costs beyond the price",subhead:"Other spending over time",
        emphasis:"MECHANISM",items:names,sceneRecipe:"home-cost-story-v1"},claimRefs:[],evidenceRefs:[],eventIds:[]},
    {id:"payoff",intent:"general-payoff",startFrame:220,endFrame:330,
      visual:{headline:"Price is only the beginning",subhead:"A conditional spending total",
        emphasis:"PAYOFF",items:names,sceneRecipe:"home-cost-story-v1"},claimRefs:[],evidenceRefs:[],eventIds:["payoff"]},
  ],claims:[],evidence:[],events:{payoff:220},payoffEventId:"payoff",
  disclaimer:"UNVERIFIED EDITORIAL DRAFT · REVIEW CLAIMS AND RIGHTS",commercialReady:false
};
const video=(frame:number)=>renderToStaticMarkup(<GeneralExportScene plan={plan} frame={frame}/>);
describe("authored home ownership visuals in the actual renderer",()=>{
  it("begins with a recognizable house, a hypothetical $500K price tag and immediate viewer relevance",()=>{
    const opening=video(35);
    expect(opening).toContain('data-story-scene="question"');
    expect(opening).toContain('data-story-object="house"');
    expect(opening).toContain('data-story-price-tag=""');
    expect(opening).toContain("$500,000");
    expect(opening).toContain("HYPOTHETICAL ASKING PRICE");
    expect(opening).toContain("So where does the rest of the money go?");
    expect(opening).not.toContain("UNVERIFIED EDITORIAL DRAFT");
    expect(opening).not.toContain("DRAFT ·");
    expect(opening).not.toContain("01 / 03");
  });
  it("reveals four concrete ownership costs sequentially in safe on-canvas positions",()=>{
    const start=video(110),end=video(219);
    expect(start).toContain('data-story-scene="mechanism"');
    expect(start).toContain('data-story-object="house"');
    expect(start).not.toContain('data-story-cost="3"');
    for(let i=0;i<4;i++){
      expect(end).toContain(`data-story-cost="${i}"`);
      expect(end).toContain(`data-story-cost-icon="${i}"`);
      expect(end).toContain(`data-story-cost-connection="${i}"`);
    }
    for(const term of ["Mortgage Interest","Property Tax","Home Insurance","Maintenance"])expect(end).toContain(term);
    expect(end).toContain("The bills keep arriving.");
    for(const [x,y] of [[812,291],[1286,291],[812,513],[1286,513]]){
      expect(x+445).toBeLessThan(1808);
      expect(y+178).toBeLessThan(945);
      expect(end).toContain(`x="${x}" y="${y}" width="445" height="178"`);
    }
    expect(end).not.toContain("DRAFT ·");
  });
  it("locks the real payoff event, then assembles useful components without a made-up ownership forecast",()=>{
    const start=video(220),finish=video(329);
    expect(start).toContain('data-story-payoff-locked="true"');
    expect(start).not.toContain('data-story-takeaway=""');
    expect(start).not.toContain("MORE THAN");
    expect(finish).toContain("Purchase price");
    expect(finish).toContain("Mortgage Interest");
    expect(finish).toContain("Home Insurance");
    expect(finish).toContain("Maintenance");
    expect(finish).toContain('data-story-takeaway=""');
    expect(finish).toContain("MORE THAN");
    expect(finish).toContain("$500,000");
    expect(finish).toContain("Sale proceeds are excluded.");
    expect(finish).not.toContain("UNVERIFIED EDITORIAL DRAFT");
  });
  it("rendering is deterministic and a motion edit changes the actual illustrated frame",()=>{
    const same=video(170);
    expect(video(170)).toBe(same);
    const newPlan:GeneralVisualPlan={...plan,chapters:plan.chapters.map((chapter,index)=>
      index===1?{...chapter,visual:{...chapter.visual,
        motion:{revealDelayPercent:25,revealPace:"deliberate",camera:"cinematic",transition:"fade"}}}:chapter)};
    const edited=renderToStaticMarkup(<GeneralExportScene plan={newPlan} frame={170}/>);
    expect(edited).not.toBe(same);
  });
});


describe("home-cost sample editor parity",()=>{
 it("displays revised on-screen teaching explanations from the selected source shot",()=>{
  const edited:GeneralVisualPlan={...plan,chapters:plan.chapters.map((chapter,index)=>
   index===1?{...chapter,visual:{...chapter.visual,itemNotes:[
    "The quoted price is not the full spending total",
    "Edited: borrowing has an interest cost",
    "A recurring local expense",
    "Insures against covered risks",
    "Edited: repairs arrive when necessary"
   ]}}:chapter)};
  const output=renderToStaticMarkup(<GeneralExportScene plan={edited} frame={219}/>);
  expect(output).toContain("Edited: borrowing has an interest cost");
  expect(output).toContain("Edited: repairs arrive when necessary");
  expect(output).toContain('data-story-cost-detail="1"');
  expect(output).toContain('data-story-cost-detail="3"');
 });
});

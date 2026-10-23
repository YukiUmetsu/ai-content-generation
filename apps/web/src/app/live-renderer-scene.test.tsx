import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import LiveRendererScene from "./live-renderer-scene";
import { GeneralExportScene } from "../video-export/general-scene";
const plan:GeneralVisualPlan={
 schemaVersion:1,kind:"general-explainer-visual-plan",title:"What is a home?",
 manifest:{schemaVersion:1,id:"preview-synthetic",durationFrames:180,width:1920,height:1080,
  fps:{num:30,den:1},preset:"youtube"},
 chapters:[
  {id:"start",intent:"general-intro",startFrame:0,endFrame:60,
   visual:{headline:"THE PRICE",subhead:"An illustrative problem",emphasis:"QUESTION",
    items:["House","Other Costs"]},claimRefs:[],evidenceRefs:[],eventIds:[]},
  {id:"middle",intent:"general-breakdown",startFrame:60,endFrame:120,
   visual:{headline:"HIDDEN COSTS",subhead:"Illustrative categories",emphasis:"MECHANISM",
    items:["Repairs","Taxes","Insurance"]},claimRefs:[],evidenceRefs:[],eventIds:[]},
  {id:"finish",intent:"general-payoff",startFrame:120,endFrame:180,
   visual:{headline:"THE ANSWER",subhead:"Depends on assumptions",emphasis:"PAYOFF",
    items:["Budget","Assumptions"]},claimRefs:[],evidenceRefs:[],eventIds:["revealed"]}
 ],claims:[],evidence:[],events:{revealed:120},payoffEventId:"revealed",
 disclaimer:"UNVERIFIED EDITORIAL DRAFT",commercialReady:false
};
describe("actual exporter inside visual-first Studio",()=>{
 it("wraps precisely the real MP4 scene markup at the same frame",()=>{
  const frame=116;
  const direct=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={frame}/>);
  const inStudio=renderToStaticMarkup(<LiveRendererScene plan={plan} frame={frame}/>);
  expect(inStudio).toContain('data-contentgen-real-renderer=""');
  expect(inStudio).toContain(direct);
  expect(inStudio).toContain("QUALITATIVE · NOT TO SCALE");
  expect(inStudio).toContain("HIDDEN COSTS");
 });
 it("preserves payoff concealment and deterministic output on seeks",()=>{
  const locked=renderToStaticMarkup(<LiveRendererScene plan={plan} frame={120}/>);
  const payoff=renderToStaticMarkup(<LiveRendererScene plan={plan} frame={165}/>);
  expect(locked).not.toContain("THE ANSWER");
  expect(locked).toContain('data-payoff-locked="true"');
  expect(payoff).toContain("THE ANSWER");
  expect(renderToStaticMarkup(<LiveRendererScene plan={plan} frame={120}/>)).toBe(locked);
 });
});

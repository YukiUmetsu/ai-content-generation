import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { LiveRendererPreview, type LiveVisualPreviewData } from "./live-renderer-preview";

vi.mock("./live-renderer-scene",()=>({
 default:({frame}:{frame:number})=><div data-testid="exported-scene-frame">Actual exporter at frame {frame}</div>
}));
afterEach(()=>vi.restoreAllMocks());
const plan:GeneralVisualPlan={
 schemaVersion:1,kind:"general-explainer-visual-plan",title:"A house price",
 locale:"en-US",manifest:{schemaVersion:1,id:"synthetic",durationFrames:180,
   width:1920,height:1080,preset:"youtube",fps:{num:30,den:1}},
 chapters:[
  {id:"scene-1",intent:"general-intro",visual:{headline:"What is missing?",subhead:"A question",
   emphasis:"HOOK",items:["House","Price"]},startFrame:0,endFrame:60,claimRefs:[],evidenceRefs:[],eventIds:[]},
  {id:"scene-2",intent:"general-breakdown",visual:{headline:"Cost layers",subhead:"An example",
   emphasis:"BREAKDOWN",items:["Tax","Upkeep","Fees"]},startFrame:60,endFrame:120,claimRefs:[],evidenceRefs:[],eventIds:[]},
  {id:"scene-3",intent:"general-payoff",visual:{headline:"Context matters",subhead:"A conditional answer",
   emphasis:"ANSWER",items:["Assumptions","Total"]},startFrame:120,endFrame:180,claimRefs:[],evidenceRefs:[],eventIds:["payoff"]}
 ],
 claims:[],evidence:[],events:{payoff:120},payoffEventId:"payoff",
 disclaimer:"UNVERIFIED EDITORIAL DRAFT",commercialReady:false
};
const preview:LiveVisualPreviewData={
 schemaVersion:1,kind:"live-renderer-preview/v1",plan,
 shotMap:[
  {shotId:"shot-hook",beatId:"scene-1",startFrame:0,endFrame:60,visualAction:"Conceal the later costs"},
  {shotId:"shot-costs",beatId:"scene-2",startFrame:60,endFrame:120,visualAction:"Reveal cost layers"},
  {shotId:"shot-end",beatId:"scene-3",startFrame:120,endFrame:180,visualAction:"Assemble the answer"}
 ],sourcePlanSha256:"a".repeat(64),renderPlanSha256:"b".repeat(64),
 timing:{basis:"estimated-text-only",spokenWpm:145,measuredNarration:false,
 note:"This is estimated narration timing, not aligned audio."},
 visualLimits:[]
};
describe("real export scene reviewer",()=>{
 it("previews the selected scene, seeks reproducibly and jumps to the editor only explicitly",async()=>{
  const user=userEvent.setup(),edit=vi.fn();
  render(<LiveRendererPreview preview={preview} selectedShotId="shot-costs" onSelectShot={edit}/>);
  expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 60");
  expect(screen.getByText(/estimated narration timing/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Inspect end of shot"}));
  expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 119");
  await user.click(screen.getByRole("button",{name:"Restart shot"}));
  expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 60");
  await user.click(screen.getByRole("button",{name:"Next shot"}));
  expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 120");
  expect(edit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("slider",{name:"Scrub actual renderer frames"}),{target:{value:"176"}});
  expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 176");
  await user.click(screen.getByRole("button",{name:"Edit this shot in Video Director"}));
  expect(edit).toHaveBeenCalledWith("shot-end");
 });
 it("shows actual scene controls without invoking model, sound, browser or render endpoints",async()=>{
  const network=vi.spyOn(globalThis,"fetch");
  render(<LiveRendererPreview preview={preview}/>);
  expect(await screen.findByTestId("exported-scene-frame")).toBeInTheDocument();
  expect(screen.getByRole("slider",{name:"Scrub actual renderer frames"})).toHaveAttribute("max","179");
  expect(screen.getByRole("combobox",{name:"Select rendered scene"})).toHaveValue("0");
  expect(screen.queryByRole("button",{name:"Edit this shot in Video Director"})).not.toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
 });
});


describe("normal-user scene timeline editor",()=>{
 it("changes only the live scene until explicit save, then saves the selected shot's motion",async()=>{
   const user=userEvent.setup(),save=vi.fn(async()=>{});
   render(<LiveRendererPreview preview={preview} selectedShotId="shot-costs" onSaveMotion={save}/>);
   expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 60");
   expect(screen.getByRole("button",{name:"Save motion to project"})).toBeDisabled();
   fireEvent.change(screen.getByRole("slider",{name:"Reveal start percent"}),{target:{value:"20"}});
   await user.selectOptions(screen.getByRole("combobox",{name:"Reveal pacing"}),"deliberate");
   await user.selectOptions(screen.getByRole("combobox",{name:"Camera movement"}),"locked");
   await user.selectOptions(screen.getByRole("combobox",{name:"Scene transition"}),"fade");
   expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
   expect(save).not.toHaveBeenCalled();
   await user.click(screen.getByRole("button",{name:"Save motion to project"}));
   expect(save).toHaveBeenCalledTimes(1);
   expect(save).toHaveBeenCalledWith("shot-costs",{
      revealDelayPercent:20,revealPace:"deliberate",camera:"locked",transition:"fade"
   });
   expect(await screen.findByText(/Scene motion saved/)).toBeInTheDocument();
 });
 it("visually navigates timeline segments without inadvertently saving or sending API calls",async()=>{
   const user=userEvent.setup(),save=vi.fn(async()=>{});
   const network=vi.spyOn(globalThis,"fetch");
   render(<LiveRendererPreview preview={preview} onSaveMotion={save}/>);
   expect(await screen.findByTestId("exported-scene-frame")).toBeInTheDocument();
   await user.click(screen.getByRole("button",{name:/Timeline shot 3/}));
   expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 120");
   await user.selectOptions(screen.getByRole("combobox",{name:"Camera movement"}),"cinematic");
   await user.click(screen.getByRole("button",{name:"Discard unsaved changes"}));
   expect(screen.getByRole("combobox",{name:"Camera movement"})).toHaveValue("subtle");
   expect(save).not.toHaveBeenCalled();
   expect(network).not.toHaveBeenCalled();
 });
});


describe("real-time preview playback frame boundaries",()=>{
  it("uses one RAF clock, never renders negative frames, continues at 30fps and stops on last valid frame",async()=>{
    const pending=new Map<number,FrameRequestCallback>();
    let nextId=0;
    const schedule=vi.spyOn(globalThis,"requestAnimationFrame")
      .mockImplementation(callback=>{const id=++nextId;pending.set(id,callback);return id;});
    vi.spyOn(globalThis,"cancelAnimationFrame").mockImplementation(id=>{pending.delete(id);});
    function advance(timestamp:number){
      const first=pending.entries().next().value as [number,FrameRequestCallback]|undefined;
      expect(first).toBeDefined();
      if(!first)return;
      pending.delete(first[0]);act(()=>first[1](timestamp));
    }
    const user=userEvent.setup();
    render(<LiveRendererPreview preview={preview}/>);
    await screen.findByTestId("exported-scene-frame");
    await user.click(screen.getByRole("button",{name:"Play visual preview"}));
    expect(schedule).toHaveBeenCalledTimes(1);
    // The first RAF timestamp might precede the effect's performance.now().
    // Old code used separate clocks and produced frame -1 on the initial tick.
    advance(-150);
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 0");
    expect(pending.size).toBe(1);
    advance(-116);
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 1");
    expect(pending.size).toBe(1);
    advance(350);
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 15");
    expect(pending.size).toBe(1);
    advance(100000);
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 179");
    expect(screen.getByRole("button",{name:"Play visual preview"})).toBeInTheDocument();
    expect(pending.size).toBe(0);
    // Replaying from the end must restart at the beginning with valid frames.
    await user.click(screen.getByRole("button",{name:"Play visual preview"}));
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 0");
    advance(5);
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 0");
  });
  it("cancels pending RAF callbacks when paused and clamps a stale selected shot frame",async()=>{
    let id=0;
    const callbacks=new Map<number,FrameRequestCallback>();
    vi.spyOn(globalThis,"requestAnimationFrame").mockImplementation(cb=>{
      callbacks.set(++id,cb);return id;
    });
    vi.spyOn(globalThis,"cancelAnimationFrame").mockImplementation(requestId=>{
      callbacks.delete(requestId);
    });
    const user=userEvent.setup();
    const outdated:LiveVisualPreviewData={...preview,
      shotMap:preview.shotMap.map((s,index)=>index===1?{...s,startFrame:9999}:s)};
    render(<LiveRendererPreview preview={outdated} selectedShotId="shot-costs"/>);
    expect(await screen.findByTestId("exported-scene-frame")).toHaveTextContent("frame 179");
    await user.click(screen.getByRole("button",{name:"Play visual preview"}));
    expect(screen.getByTestId("exported-scene-frame")).toHaveTextContent("frame 0");
    expect(callbacks.size).toBe(1);
    await user.click(screen.getByRole("button",{name:"Pause visual preview"}));
    expect(callbacks.size).toBe(0);
  });
});

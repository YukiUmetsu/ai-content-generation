import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductionPanel } from "./video-production-panel";

vi.mock("./live-renderer-scene",()=>({default:({frame}:{frame:number})=>
  <div data-testid="real-export-frame">Exporter frame {frame}</div>}));

afterEach(()=>{vi.restoreAllMocks();});
const dossier={id:"home-research",topic:{title:"Why a house costs more",audience:"Homeowners"}};
const bundle={kind:"preproduction-bundle",researchId:"home-research",plan:{
  shots:[{id:"question",onScreenText:"Where is the money?"},{id:"process",onScreenText:"Costs accumulate"},
    {id:"payoff",onScreenText:"It depends"}]}};
const preview={
  schemaVersion:1,kind:"research-to-render-job/v1",editorialStatus:"unverified-test-draft",
  job:{beats:[{id:"beat-01",narration:"An example spoken opening.",visual:{headline:"WHAT IS MISSING",subhead:"The first question",items:["Home","Costs"]}},
    {id:"beat-02",narration:"A middle explanatory segment.",visual:{headline:"THE PROCESS",subhead:"Costs add up",items:["Home","Costs"]}},
    {id:"beat-03",narration:"A conditional final takeaway.",visual:{headline:"IT DEPENDS",subhead:"Assumptions matter",items:["Home","Costs"]}}]},
  shotMap:[{shotId:"question",beatId:"beat-01",visualAction:"Reveal the house"},
    {shotId:"process",beatId:"beat-02",visualAction:"Add costs"},
    {shotId:"payoff",beatId:"beat-03",visualAction:"Show conditional total"}],
  warnings:["Custom 3D motion is represented by schematic diagrams."],
};
describe("Studio user video production",()=>{
  it("reviews the translated scenes and creates an offline animatic without any speech call",async()=>{
    const paths:string[]=[];
    const api=vi.spyOn(globalThis,"fetch").mockImplementation(async(url,options)=>{
      paths.push(String(url));
      if(String(url).endsWith("/plan"))return new Response(JSON.stringify(preview),{status:200});
      if(String(url).endsWith("/preview"))return new Response(JSON.stringify({
        url:"/api/contentgen-video/preview/synthetic",durationSeconds:27.3,status:"unreviewed-rough-cut"
      }),{status:200});
      throw Error("Unexpected request "+url+" "+options?.method);
    });
    const user=userEvent.setup();render(<ProductionPanel dossier={dossier} bundle={bundle}/>);
    expect(screen.queryByText("Production voice provider")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Review renderable scenes"}));
    expect(await screen.findByText("WHAT IS MISSING")).toBeInTheDocument();
    expect(screen.getByText(/schematic diagrams/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Preview animated rough cut"}));
    expect(await screen.findByRole("link",{name:"Open rough cut"})).toHaveAttribute("href",
      "/api/contentgen-video/preview/synthetic");
    expect(paths).toEqual(["/api/contentgen-video/plan","/api/contentgen-video/preview"]);
    api.mockRestore();
  });
  it("demands voice permission and tool preflight before enabling a real render",async()=>{
    const paths:string[]=[];let ready=false;
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,options)=>{
      const path=String(url);paths.push(path);
      if(path.endsWith("/plan"))return new Response(JSON.stringify(preview),{status:200});
      if(path.endsWith("/check")){
        const input=JSON.parse(String(options?.body)) as {settings:{localVoiceAuthorized:boolean}};
        ready=input.settings.localVoiceAuthorized;
        return new Response(JSON.stringify({ready,report:{ready,findings:ready?[]:[{
          severity:"error",code:"consent-required",message:"Local voice authorization required."}]}}),{status:200});
      }
      if(path.endsWith("/start"))return new Response(JSON.stringify({started:true,runId:"some-run"}),{status:202});
      if(path.endsWith("/status"))return new Response(JSON.stringify({
        state:"done",phase:"review",message:"Draft video ready",mediaUrl:"/api/contentgen-video/media/some-run/video.mp4"
      }),{status:200});
      throw Error("Unexpected route");
    });
    const user=userEvent.setup();render(<ProductionPanel dossier={dossier} bundle={bundle}/>);
    await user.click(screen.getByRole("button",{name:"Review renderable scenes"}));
    expect(await screen.findByText("WHAT IS MISSING")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Render unverified draft MP4"})).toBeDisabled();
    await user.type(screen.getByRole("textbox",{name:"Production voice ID"}),"own-voice");
    await user.type(screen.getByRole("textbox",{name:"Production engine revision"}),"local-v1");
    await user.type(screen.getByRole("textbox",{name:"Installed TTS model"}),"installed-model");
    await user.click(screen.getByRole("checkbox",{name:"I am authorized to synthesize this local voice"}));
    await user.click(screen.getByRole("button",{name:"Check readiness"}));
    expect(await screen.findByText("Local media tools ready")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Render unverified draft MP4"})).toBeEnabled();
    await user.click(screen.getByRole("button",{name:"Render unverified draft MP4"}));
    await waitFor(()=>expect(paths.some(p=>p.endsWith("/start"))).toBe(true));
    expect(screen.getByText(/Leave Studio open/)).toBeInTheDocument();
  });
});

describe("visual-first editing in normal Studio",()=>{
  it("shows the real scene player without requesting voice readiness, audio or video rendering",async()=>{
    const paths:string[]=[];
    const exportPlan={
      schemaVersion:1,kind:"general-explainer-visual-plan",title:"Example",
      manifest:{schemaVersion:1,id:"test",width:1920,height:1080,durationFrames:180,
        fps:{num:30,den:1},preset:"youtube"},
      chapters:[
        {id:"beat-01",intent:"general-intro",startFrame:0,endFrame:60,
          visual:{headline:"House",subhead:"Look closer",items:["Price","Costs"]}},
        {id:"beat-02",intent:"general-flow",startFrame:60,endFrame:120,
          visual:{headline:"Costs",subhead:"Breakdown",items:["Property tax","Upkeep"]}},
        {id:"beat-03",intent:"general-payoff",startFrame:120,endFrame:180,
          visual:{headline:"Total",subhead:"A range",items:["Assumptions","Result"]}},
      ]
    };
    vi.spyOn(globalThis,"fetch").mockImplementation(async url=>{
      paths.push(String(url));
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify({
        kind:"live-renderer-preview/v1",schemaVersion:1,plan:exportPlan,
        shotMap:[
          {shotId:"question",beatId:"beat-01",startFrame:0,endFrame:60,visualAction:"Show the question"},
          {shotId:"process",beatId:"beat-02",startFrame:60,endFrame:120,visualAction:"Show components"},
          {shotId:"payoff",beatId:"beat-03",startFrame:120,endFrame:180,visualAction:"Reveal the answer"}
        ],sourcePlanSha256:"a".repeat(64),renderPlanSha256:"b".repeat(64),
        timing:{basis:"estimated-text-only",spokenWpm:145,measuredNarration:false,
          note:"Estimated timing, not actual speech"},visualLimits:[]
      }),{status:200});
      throw Error("Preview triggered unexpected external/media API: "+url);
    });
    const user=userEvent.setup();
    render(<ProductionPanel dossier={dossier} bundle={bundle} selectedShotId="process"/>);
    await user.click(screen.getByRole("button",{name:"Preview actual rendered scenes"}));
    expect(await screen.findByTestId("real-export-frame")).toHaveTextContent("frame 60");
    expect(screen.getByText(/Same scene component as MP4 export/)).toBeInTheDocument();
    expect(paths).toEqual(["/api/contentgen-video/live-preview"]);
    expect(screen.queryByRole("button",{name:"Render unverified draft MP4"})).not.toBeInTheDocument();
  });
});

test("opens narration controls for the guided Audio stage using the saved bundle",async()=>{
  const paths:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(url)=>{
    paths.push(String(url));
    if(String(url).endsWith("/plan"))return new Response(JSON.stringify(preview),{status:200});
    throw Error("Unexpected request "+url);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} focusStage="audio"/>);
  expect(await screen.findByLabelText("Production voice provider")).toBeInTheDocument();
  expect(paths).toEqual(["/api/contentgen-video/plan"]);
  expect(screen.queryByText("New draft video · inspect before publishing")).not.toBeInTheDocument();
});

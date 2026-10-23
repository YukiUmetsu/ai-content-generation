import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductionPanel } from "./video-production-panel";

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

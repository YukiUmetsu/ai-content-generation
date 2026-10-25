import {afterEach,expect,it,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProductionPanel} from "./video-production-panel";

afterEach(()=>vi.restoreAllMocks());

const dossier={id:"research",topic:{title:"Why repairs cost more",audience:"Homeowners"}};
const bundle={kind:"preproduction-bundle",researchId:"research",plan:{
  shots:[{id:"shot1",onScreenText:"Hidden costs"}]
}};
const plan={schemaVersion:1,kind:"preview",job:{beats:[{id:"beat1",narration:"Expensive permits and labor.",visual:{headline:"The bill",subhead:"",items:[]}}]},
  shotMap:[{shotId:"shot1",beatId:"beat1",visualAction:"Reveal costs"}],warnings:["Review factual claims."],editorialStatus:"draft"};
const reply=(payload:unknown)=>new Response(JSON.stringify(payload),{status:200});

it("guides the user from narration to final review and keeps voice settings when readiness resets",async()=>{
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const endpoint=String(input);calls.push(endpoint);
    if(endpoint.endsWith("/plan"))return reply(plan);
    if(endpoint.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    throw Error("Unexpected production request: "+endpoint);
  });
  const user=userEvent.setup();
  const view=render(<ProductionPanel dossier={dossier} bundle={bundle} recheckToken={0}/>);
  expect(screen.getByRole("tab",{name:/Preview/})).toHaveAttribute("aria-selected","true");
  await user.click(screen.getByRole("tab",{name:/Narration/}));
  await screen.findByRole("textbox",{name:"Production voice ID"});
  expect(screen.queryByRole("button",{name:/Render test MP4/i})).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox",{name:"Production voice ID"}),"licensed-voice");
  await user.click(screen.getByRole("tab",{name:/Final review/}));
  expect(screen.getByText(/Review factual claims/)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:/Check readiness/i}));
  await waitFor(()=>expect(screen.getByRole("button",{name:/Continue to export/i})).toBeEnabled());
  await user.click(screen.getByRole("tab",{name:/Export/}));
  expect(screen.getByRole("button",{name:/Render test MP4/i})).toBeEnabled();

  view.rerender(<ProductionPanel dossier={dossier} bundle={bundle} recheckToken={1}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:/Render test MP4/i})).toBeDisabled());
  await user.click(screen.getByRole("tab",{name:/Narration/}));
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toHaveValue("licensed-voice");
  expect(calls.filter(x=>x.endsWith("/check"))).toHaveLength(1);
});

it("auditions a voice only on request and hides stale audio when provider settings change",async()=>{
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const url=String(input);calls.push(url);
    if(url.endsWith("/plan"))return reply(plan);
    if(url.endsWith("/narration-sample"))return new Response(JSON.stringify({started:true}),{status:202});
    if(url.endsWith("/narration-sample/status"))return reply({state:"done",message:"Sample ready",audioUrl:"/api/contentgen-video/narration-sample/one.wav"});
    throw Error("Unexpected production request: "+url);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle}/>);
  await user.click(screen.getByRole("tab",{name:/Narration/}));
  const voice=await screen.findByRole("textbox",{name:"Production voice ID"});
  expect(calls.every(x=>!x.endsWith("/narration-sample"))).toBe(true);
  await user.type(voice,"my-voice");
  await user.type(screen.getByRole("textbox",{name:"Production engine revision"}),"v1");
  await user.type(screen.getByRole("textbox",{name:"Installed TTS model"}),"test-model");
  await user.click(screen.getByRole("checkbox",{name:/I am authorized/}));
  await user.click(screen.getByRole("button",{name:/Generate voice sample/i}));
  expect(await screen.findByLabelText("Voice sample")).toHaveAttribute("src","/api/contentgen-video/narration-sample/one.wav");
  await user.type(voice,"-new");
  expect(screen.queryByLabelText("Voice sample")).not.toBeInTheDocument();
});

it("keeps render progress when switching production steps",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const url=String(input);
    if(url.endsWith("/plan"))return reply(plan);
    if(url.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(url.endsWith("/start"))return new Response(JSON.stringify({started:true}),{status:202});
    if(url.endsWith("/status"))return reply({state:"rendering",phase:"rendering",message:"Encoding scenes",progress:{phase:"rendering",completedFrames:4,totalFrames:10}});
    throw Error("Unexpected production request: "+url);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle}/>);
  await user.click(screen.getByRole("tab",{name:/Final review/}));
  await screen.findByRole("button",{name:/Check readiness/i});
  await user.click(screen.getByRole("button",{name:/Check readiness/i}));
  await waitFor(()=>expect(screen.getByRole("button",{name:/Continue to export/i})).toBeEnabled());
  await user.click(screen.getByRole("button",{name:/Continue to export/i}));
  await user.click(screen.getByRole("button",{name:/Render test MP4/i}));
  expect(await screen.findByText(/Producing a real draft MP4/)).toBeInTheDocument();
  await user.click(screen.getByRole("tab",{name:/Narration/}));
  await user.click(screen.getByRole("tab",{name:/Export/}));
  expect(screen.getByRole("button",{name:/Cancel render/i})).toBeInTheDocument();
});

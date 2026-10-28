import {afterEach,expect,it,vi} from "vitest";
import { StrictMode } from "react";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProductionPanel} from "./video-production-panel";

afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});

const dossier={id:"research",topic:{title:"Why repairs cost more",audience:"Homeowners"}};
const bundle={kind:"preproduction-bundle",researchId:"research",plan:{
  shots:[{id:"shot1",onScreenText:"Hidden costs"}]
}};
const plan={schemaVersion:1,kind:"preview",job:{beats:[{id:"beat1",narration:"Expensive permits and labor.",visual:{headline:"The bill",subhead:"",items:[]}}]},
  shotMap:[{shotId:"shot1",beatId:"beat1",visualAction:"Reveal costs"}],warnings:["Review factual claims."],editorialStatus:"draft"};
const reply=(payload:unknown)=>new Response(JSON.stringify(payload),{status:200});

it("restores a matching saved draft after Studio navigation and links directly to its video",async()=>{
  const productionId="production-"+"e".repeat(24);
  const url="/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4";
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.endsWith(`/status/${productionId}?sourceRevision=current-script`))return reply({
      state:"done",phase:"review",message:"Your saved draft is ready.",mediaUrl:url});
    throw Error("Unexpected request "+path);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} productionId={productionId}
    sourceRevision="current-script"/>);
  const reopen=await screen.findByRole("button",{name:"Review saved video"});
  await userEvent.setup().click(reopen);
  expect(screen.getByLabelText("Rendered ContentGen draft video")).toHaveAttribute("src",url);
  expect(screen.getByRole("link",{name:"Download MP4"})).toHaveAttribute("href",url);
});

it("does not let delayed job recovery overwrite a newer readiness result",async()=>{
  const productionId="production-"+"e".repeat(24);
  let completeRecovery:(response:Response)=>void=()=>{};
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.includes(`/status/${productionId}`))return new Promise<Response>(resolve=>{completeRecovery=resolve;});
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/plan"))return reply(plan);
    throw Error("Unexpected request "+path);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} productionId={productionId} initialStage="review"/>);
  await screen.findByRole("button",{name:/Check readiness/i});
  await userEvent.setup().click(screen.getByRole("button",{name:/Check readiness/i}));
  await waitFor(()=>expect(screen.getByRole("button",{name:/Continue to export/i})).toBeEnabled());
  completeRecovery(reply({state:"failed",phase:"production",message:"An earlier draft failed",jobId:"old-job"}));
  await waitFor(()=>expect(screen.queryByText("An earlier draft needs attention.")).not.toBeInTheDocument());
  expect(screen.getByRole("button",{name:/Continue to export/i})).toBeEnabled();
});

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

it("remembers only nonsecret narrator preferences, never provider credentials or consent",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    throw Error("Unexpected request: "+input);
  });
  const user=userEvent.setup();
  const first=render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await user.selectOptions(screen.getByRole("combobox",{name:"Production voice provider"}),"fish");
  await user.type(screen.getByRole("textbox",{name:"Production voice ID"}),"authorized-voice");
  await user.type(screen.getByLabelText("Fish Audio key"),"secret-api-key");
  const saved=localStorage.getItem("contentgen:production-voice-profile:v1")??"";
  expect(saved).toContain("authorized-voice");
  expect(saved).not.toContain("secret-api-key");
  expect(saved).not.toContain("voiceConsent");
  first.unmount();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toHaveValue("authorized-voice");
  expect(screen.getByLabelText("Fish Audio key")).toHaveValue("");
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

it("auditions the selected scene instead of always using the opening narration",async()=>{
  let submitted:Record<string,unknown>|null=null;
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.endsWith("/plan"))return reply(plan);
    if(url.endsWith("/narration-sample")){
      submitted=JSON.parse(String(init?.body));
      return new Response(JSON.stringify({started:true}),{status:202});
    }
    if(url.endsWith("/narration-sample/status"))return reply({state:"done",message:"Selected scene voice ready",
      audioUrl:"/api/contentgen-video/narration-sample/scene.wav"});
    throw Error("Unexpected request "+url);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} selectedShotId="shot1" initialStage="narration"/>);
  const button=await screen.findByRole("button",{name:"Preview selected scene voice"});
  await userEvent.setup().click(button);
  await waitFor(()=>expect(submitted).not.toBeNull());
  expect(submitted).toMatchObject({sceneShotId:"shot1"});
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
  expect(await screen.findByText(/Encoding scenes|Producing a real draft MP4/)).toBeInTheDocument();
  await user.click(screen.getByRole("tab",{name:/Narration/}));
  await user.click(screen.getByRole("tab",{name:/Export/}));
  expect(screen.getByRole("button",{name:/Cancel render/i})).toBeInTheDocument();
});

it("opens voice setup directly and prepares the approved scene plan automatically",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    throw Error("Unexpected request: "+input);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  expect(await screen.findByRole("textbox",{name:"Production voice ID"})).toBeInTheDocument();
  expect(screen.getByRole("tab",{name:/Narration/})).toHaveAttribute("aria-selected","true");
});

it("opens voice setup when React remounts effects in Strict Mode",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    throw Error("Unexpected request: "+input);
  });
  render(<StrictMode><ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/></StrictMode>);
  expect(await screen.findByRole("textbox",{name:"Production voice ID"})).toBeInTheDocument();
});

it("keeps voice controls usable when the local scene planner is unavailable",async()=>{
  vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Local director is offline"));
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toBeInTheDocument();
  expect(await screen.findByText(/Local director is offline/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/Generate draft video/i})).toBeEnabled();
});

it("runs preflight and starts the MP4 on one Generate draft video click",async()=>{
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);calls.push(path);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true});
    if(path.endsWith("/status"))return reply({state:"rendering",phase:"production",message:"Encoding",progress:{completedFrames:5,totalFrames:10}});
    throw Error("Unexpected request: "+path);
  });
  const user=userEvent.setup();render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await screen.findByRole("textbox",{name:"Production voice ID"});
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  expect(await screen.findByText(/Encoding|Producing a real draft MP4/)).toBeInTheDocument();
  expect(screen.getByRole("tab",{name:/Export/})).toHaveAttribute("aria-selected","true");
  expect(calls.filter(path=>path.endsWith("/check"))).toHaveLength(1);
  expect(calls.filter(path=>path.endsWith("/start"))).toHaveLength(1);
});

it("offers captions alongside the playable MP4 after a successful render",async()=>{
  const url="/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4";
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true});
    if(path.endsWith("/status"))return reply({state:"done",phase:"review",message:"Draft rendered",mediaUrl:url});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  expect(await screen.findByRole("link",{name:"Download MP4"})).toHaveAttribute("href",url);
  expect(screen.getByRole("link",{name:"Download captions (SRT)"})).toHaveAttribute("href",
    url.replace("/video.mp4","/captions.srt"));
});

it("shows one recovery action that rechecks and retries a failed draft without losing narration setup",async()=>{
  let checks=0,starts=0;
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check")){checks++;return reply({report:{ready:true,findings:[]}});}
    if(path.endsWith("/start")){starts++;return reply({started:true});}
    if(path.endsWith("/status"))return reply(starts===1?
      {state:"failed",phase:"production",message:"Scene rendering failed. Check Chromium and visual assets, then retry the draft."}:
      {state:"rendering",phase:"rendering",message:"Retrying scene render"});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  const retry=await screen.findByRole("button",{name:"Retry draft video"});
  expect(retry).toBeEnabled();
  await user.click(retry);
  await waitFor(()=>expect(starts).toBe(2));
  expect(checks).toBe(2); // Retry must recheck current settings, never reuse stale readiness.
});

it("passes the optional online media-search choice to both readiness and render without a second action",async()=>{
  const requests:Array<{path:string;body:Record<string,unknown>}>=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input),body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:{};
    requests.push({path,body});
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true});
    if(path.endsWith("/status"))return reply({state:"rendering",phase:"asset-search",message:"Finding scene media"});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration" productionId={"production-"+"a".repeat(24)}/>);
  const consent=await screen.findByRole("checkbox",{name:"Search free scene media during rendering"});
  expect(consent).not.toBeChecked();
  await user.click(consent);
  expect(localStorage.getItem("contentgen:production-free-media:v1")).toBe("enabled");
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  await waitFor(()=>expect(requests.some(x=>x.path.endsWith("/start"))).toBe(true));
  expect(requests.filter(x=>x.path.endsWith("/check")||x.path.endsWith("/start"))
    .every(x=>x.body.searchFreeMedia===true)).toBe(true);
});

it("automatically begins the saved production when invoked from Generate draft video",async()=>{
  const paths:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);paths.push(path);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true,jobId:"job-production-1"});
    if(path.endsWith("/status"))return reply({state:"rendering",phase:"rendering",message:"Encoding",jobId:"job-production-1"});
    throw Error("Unexpected automatic production request: "+path);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} productionId={"production-"+"a".repeat(24)}
    autoStartDraft onOpenJobs={vi.fn()}/>);
  await waitFor(()=>expect(paths.filter(path=>path.endsWith("/start"))).toHaveLength(1));
  expect(screen.getByRole("tab",{name:/Export/})).toHaveAttribute("aria-selected","true");
  expect(screen.getByRole("button",{name:"View in Jobs"})).toBeEnabled();
});

it("explains failed preflight without starting a render or disabling retry",async()=>{
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);calls.push(path);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:false,findings:[{severity:"error",code:"voice",message:"Install a local TTS voice first."}]}});
    throw Error("Render should not start: "+path);
  });
  const user=userEvent.setup();render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await screen.findByRole("textbox",{name:"Production voice ID"});
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  expect(await screen.findByText(/Install a local TTS voice first/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/Generate draft video/i})).toBeEnabled();
  expect(calls.some(path=>path.endsWith("/start"))).toBe(false);
});

it("never renders with an obsolete voice chosen while readiness is still running",async()=>{
  let finishCheck:((response:Response)=>void)|undefined;
  const inFlight=new Promise<Response>(resolve=>{finishCheck=resolve;});
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);calls.push(path);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return inFlight;
    throw Error("Render should not start with stale voice settings: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  const voice=await screen.findByRole("textbox",{name:"Production voice ID"});
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  await waitFor(()=>expect(calls.some(path=>path.endsWith("/check"))).toBe(true));
  await user.type(voice,"new-voice");
  finishCheck?.(reply({report:{ready:true,findings:[]}}));
  expect(await screen.findByText(/Voice or scene settings changed/)).toBeInTheDocument();
  expect(calls.some(path=>path.endsWith("/start"))).toBe(false);
});

it("starts at most one preflight for repeated draft clicks",async()=>{
  let completeCheck:((response:Response)=>void)|undefined;
  const checking=new Promise<Response>(resolve=>{completeCheck=resolve;});
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);calls.push(path);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return checking;
    throw Error("Unexpected render request: "+path);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await screen.findByRole("textbox",{name:"Production voice ID"});
  const button=screen.getByRole("button",{name:/Generate draft video/i});
  fireEvent.click(button);fireEvent.click(button);
  await waitFor(()=>expect(calls.filter(path=>path.endsWith("/check"))).toHaveLength(1));
  completeCheck?.(reply({report:{ready:false,findings:[{severity:"error",code:"setup",message:"Choose a voice"}]}}));
  expect(await screen.findByText("Choose a voice")).toBeInTheDocument();
  expect(calls.some(path=>path.endsWith("/start"))).toBe(false);
});

import {afterEach,expect,it,vi} from "vitest";
import { StrictMode } from "react";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProductionPanel} from "./video-production-panel";
import {DEFAULT_FISH_VOICE_ID,readProjectVoices} from "./project-voice-favorites";

afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});

const dossier={id:"research",topic:{title:"Why repairs cost more",audience:"Homeowners"}};
const bundle={kind:"preproduction-bundle",researchId:"research",plan:{
  shots:[{id:"shot1",onScreenText:"Hidden costs"}]
}};
const plan={schemaVersion:1,kind:"preview",job:{beats:[{id:"beat1",narration:"Expensive permits and labor.",visual:{headline:"The bill",subhead:"",items:[]}}]},
  shotMap:[{shotId:"shot1",beatId:"beat1",visualAction:"Reveal costs"}],warnings:["Review factual claims."],editorialStatus:"draft"};
const reply=(payload:unknown)=>new Response(JSON.stringify(payload),{status:200});

it("starts a new project's narrator on the requested Fish primary without TTS or consent",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    if(String(input).includes("/api/project-voices/")){
      if(init?.method!=="PUT")return reply({revision:0,library:null});
      const body=JSON.parse(String(init.body)) as {library:unknown};
      return reply({revision:1,library:body.library});
    }
    throw Error("No provider or other request was authorized: "+input);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-one" initialStage="narration"/>);
  expect(await screen.findByRole("textbox",{name:"Production voice ID"})).toHaveValue(DEFAULT_FISH_VOICE_ID);
  expect(screen.getByRole("combobox",{name:"Production voice provider"})).toHaveValue("fish");
  expect(screen.getByText(/language unverified/)).toBeInTheDocument();
  expect(screen.getByText(/Fish Audio API key once/i)).toBeInTheDocument();
  expect(screen.getByRole("checkbox",{name:/permission to use this Fish voice/i})).not.toBeChecked();
  expect(readProjectVoices("project-one").voices[0].voiceId).toBe(DEFAULT_FISH_VOICE_ID);
});

it("sends the seeded primary to preflight only after the draft action, with no implicit Fish authorization",async()=>{
  let preflight:Record<string,unknown>|null=null;
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check")){
      preflight=JSON.parse(String(init?.body)) as Record<string,unknown>;
      return reply({report:{ready:false,findings:[{severity:"error",code:"voice-consent",message:"Approve Fish voice and script transmission."}]}});
    }
    throw Error("No TTS or render call was authorized: "+path);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-one" initialStage="narration"/>);
  await screen.findByRole("textbox",{name:"Production voice ID"});
  await userEvent.setup().click(screen.getByRole("button",{name:"Generate draft video"}));
  await waitFor(()=>expect(preflight).not.toBeNull());
  expect(preflight).toMatchObject({settings:{provider:"fish",voiceId:DEFAULT_FISH_VOICE_ID,voiceConsent:false,transmitText:false}});
  expect(screen.getByText(/Approve Fish voice and script transmission/)).toBeInTheDocument();
});

it("migrates an existing manually selected legacy voice to only the first opened project",async()=>{
  localStorage.setItem("contentgen:production-voice-profile:v1",JSON.stringify({provider:"local",voiceId:"saved-local-voice",modelId:"local-model"}));
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    throw Error("Unexpected request: "+input);
  });
  const first=render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-one" initialStage="narration"/>);
  expect(await screen.findByRole("textbox",{name:"Production voice ID"})).toHaveValue("saved-local-voice");
  first.unmount();
  render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-two" initialStage="narration"/>);
  expect(await screen.findByRole("textbox",{name:"Production voice ID"})).toHaveValue(DEFAULT_FISH_VOICE_ID);
  expect(localStorage.getItem("contentgen:production-voice-profile:legacy-owner:v1")).toBe("project-one");
});

it("adds and ranks project voices, applies one narrator explicitly and isolates another project",async()=>{
  const remote=new Map<string,{revision:number;library:unknown}>();
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.includes("/api/project-voices/")){
      const id=path.split("/").at(-1)!;
      if(init?.method!=="PUT")return reply(remote.get(id)??{revision:0,library:null});
      const body=JSON.parse(String(init.body)) as {revision:number;library:unknown};
      if(body.revision!==(remote.get(id)?.revision??0))return new Response(JSON.stringify({error:{message:"stale"}}),{status:409});
      const saved={revision:body.revision+1,library:body.library};remote.set(id,saved);return reply(saved);
    }
    throw Error("Unexpected request: "+input);
  });
  const user=userEvent.setup();
  const first=render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-one" initialStage="narration"/>);
  await screen.findByRole("textbox",{name:"Production voice ID"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Add voice"})).toBeEnabled());
  await user.click(screen.getByRole("button",{name:"Add voice"}));
  await user.type(screen.getByRole("textbox",{name:"Voice ID"}),"b".repeat(32));
  await user.type(screen.getByRole("textbox",{name:"Display name"}),"Calm guide");
  await user.selectOptions(screen.getByRole("combobox",{name:"Gender tag"}),"female");
  await user.clear(screen.getByRole("textbox",{name:"Situation tag"}));
  await user.type(screen.getByRole("textbox",{name:"Situation tag"}),"conversation");
  await user.clear(screen.getByRole("textbox",{name:"Language code"}));
  await user.type(screen.getByRole("textbox",{name:"Language code"}),"en");
  await user.click(screen.getByRole("button",{name:"Save voice"}));
  await waitFor(()=>expect(readProjectVoices("project-one").voices[1]).toMatchObject({name:"Calm guide",gender:"female",situation:"conversation",language:"en"}));
  await user.click(screen.getByRole("button",{name:"Make primary"}));
  await waitFor(()=>expect(readProjectVoices("project-one").voices[0].name).toBe("Calm guide"));
  await user.click(screen.getByRole("button",{name:"Use"}));
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toHaveValue("b".repeat(32));
  first.unmount();
  render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-two" initialStage="narration"/>);
  expect(await screen.findByRole("textbox",{name:"Production voice ID"})).toHaveValue(DEFAULT_FISH_VOICE_ID);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Add voice"})).toBeEnabled());
  expect(screen.queryByText("Calm guide")).not.toBeInTheDocument();
  expect(readProjectVoices("project-two").voices).toHaveLength(1);
});

it("keeps corrupted project voice data intact and exposes an actionable alert",async()=>{
  localStorage.setItem("contentgen:project-voice-favorites:v1:project-one","{broken");
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    throw Error("Unexpected request: "+input);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} voiceProjectId="project-one" initialStage="narration"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/saved data/i);
  expect(screen.getByRole("button",{name:"Add voice"})).toBeDisabled();
  expect(localStorage.getItem("contentgen:project-voice-favorites:v1:project-one")).toBe("{broken");
});

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
  expect(screen.getByText(/Save your Fish Audio API key once/i)).toBeInTheDocument();
  const saved=localStorage.getItem("contentgen:production-voice-profile:v1")??"";
  expect(saved).toContain("authorized-voice");
  expect(saved).not.toContain("apiKey");
  expect(saved).not.toContain("voiceConsent");
  first.unmount();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toHaveValue("authorized-voice");
  expect(screen.queryByLabelText("Fish Audio key")).not.toBeInTheDocument();
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
  expect(await screen.findByText(/Cannot reach local video production/)).toBeInTheDocument();
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

it("shows saved scene cast, requires explicit extra-voice permission and sends it through check and start",async()=>{
  const castVoice="a".repeat(32);
  const castBundle={...bundle,plan:{...bundle.plan,sound:[{shotId:"shot1",speaker:{id:"pip",role:"character" as const,
    provider:"fish" as const,voiceId:castVoice}}]}};
  const requests:Array<{path:string;body:Record<string,unknown>}> = [];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);
    const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:{};
    requests.push({path,body});
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:body.castVoiceConsent===true,findings:body.castVoiceConsent===true?[]:[{
      severity:"error",code:"cast-consent",message:"Authorize additional cast voices"}]}});
    if(path.endsWith("/start"))return reply({started:true,jobId:"job-cast-1"});
    if(path.endsWith("/status"))return reply({state:"rendering",phase:"speech",message:"Speaking as Pip",jobId:"job-cast-1"});
    throw Error("Unexpected call: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={castBundle} initialStage="narration"/>);
  expect(await screen.findByLabelText("Scene cast voices")).toHaveTextContent("Pip");
  const consent=screen.getByRole("checkbox",{name:"Authorize additional cast voices"});
  expect(consent).not.toBeChecked();
  await user.click(screen.getByRole("button",{name:"Generate draft video"}));
  await waitFor(()=>expect(requests.some(item=>item.path.endsWith("/check"))).toBe(true));
  expect(requests.some(item=>item.path.endsWith("/start"))).toBe(false);
  expect(requests.find(item=>item.path.endsWith("/check"))?.body.castVoiceConsent).toBe(false);
  await user.click(consent);
  await user.click(screen.getByRole("button",{name:"Generate draft video"}));
  await waitFor(()=>expect(requests.some(item=>item.path.endsWith("/start"))).toBe(true));
  expect(requests.filter(item=>item.path.endsWith("/check")).at(-1)?.body.castVoiceConsent).toBe(true);
  expect(requests.find(item=>item.path.endsWith("/start"))?.body).toMatchObject({
    castVoiceConsent:true,bundle:{plan:{sound:[{shotId:"shot1",speaker:{id:"pip",voiceId:castVoice}}]}}
  });
  expect(screen.getByRole("tab",{name:/Export/})).toHaveAttribute("aria-selected","true");
});

it("revokes cast permission whenever the narrator changes and flags mixed providers",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    throw Error("Unexpected call: "+input);
  });
  const castBundle={...bundle,plan:{...bundle.plan,sound:[{shotId:"shot1",speaker:{
    id:"quill",role:"character" as const,provider:"fish" as const,voiceId:"b".repeat(32)}}]}};
  const user=userEvent.setup();
  const view=render(<ProductionPanel dossier={dossier} bundle={castBundle} initialStage="narration"/>);
  const consent=screen.getByRole("checkbox",{name:"Authorize additional cast voices"});
  await user.click(consent);
  expect(consent).toBeChecked();
  fireEvent.change(screen.getByRole("textbox",{name:"Production voice ID"}),{target:{value:"c".repeat(32)}});
  expect(consent).not.toBeChecked();
  await user.click(consent);
  fireEvent.change(screen.getByRole("combobox",{name:"Production voice provider"}),{target:{value:"local"}});
  expect(consent).not.toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent(/different provider/i);
  view.unmount();
});

it("restores an active production and keeps its durable Jobs link visible",async()=>{
  const productionId="production-"+"a".repeat(24);
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.includes(`/status/${productionId}`))return reply({state:"rendering",phase:"recovering",
      message:"Draft is recovering from Jobs",jobId:"job-still-running"});
    if(path.endsWith("/status"))return reply({state:"idle",phase:"idle",message:"No local worker"});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup(),onOpenJobs=vi.fn();
  render(<ProductionPanel dossier={dossier} bundle={bundle} productionId={productionId}
    sourceRevision="rev1" initialStage="export" onOpenJobs={onOpenJobs}/>);
  expect(await screen.findByText(/Draft is recovering from Jobs/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"View in Jobs"}));
  expect(onOpenJobs).toHaveBeenCalledOnce();
  expect(screen.queryByText("No local worker")).not.toBeInTheDocument();
});

it("requires exactly one confirmation before regenerating an existing video version",async()=>{
  const productionId="production-"+"b".repeat(24),requests:Array<{path:string;body:Record<string,unknown>}> = [];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input),body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:{};
    requests.push({path,body});
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith(`/version-policy/${productionId}`))return reply({requiresConfirmation:true,completedVersions:1});
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true,jobId:"job-updated-version"});
    if(path.endsWith("/status"))return reply({state:"rendering",phase:"rendering",message:"Rendering updated video"});
    if(path.includes(`/status/${productionId}`))return reply({state:"idle",message:""});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} productionId={productionId}
    sourceRevision="edited-revision" initialStage="narration"/>);
  await user.click(await screen.findByRole("button",{name:/Generate draft video/i}));
  expect(await screen.findByText(/updated version.*confirmation/i)).toBeInTheDocument();
  expect(requests.some(item=>item.path.endsWith("/check"))).toBe(false);
  expect(requests.some(item=>item.path.endsWith("/start"))).toBe(false);
  await user.click(screen.getByRole("button",{name:"Generate updated version"}));
  await waitFor(()=>expect(requests.filter(item=>item.path.endsWith("/start"))).toHaveLength(1));
  expect(requests.find(item=>item.path.endsWith("/start"))?.body.confirmUpdatedVersion).toBe(true);
  expect(screen.getByRole("tab",{name:/Export/})).toHaveAttribute("aria-selected","true");
});

it("uses the same version confirmation from the manual Export render action",async()=>{
  const productionId="production-"+"b".repeat(24),starts:Record<string,unknown>[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.includes(`/status/${productionId}`))return reply({state:"idle",phase:"idle",message:""});
    if(path.endsWith(`/version-policy/${productionId}`))return reply({requiresConfirmation:true,completedVersions:1});
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start")){starts.push(JSON.parse(String(init?.body)));return reply({started:true,jobId:"job-manual-v2"});}
    if(path.endsWith("/status"))return reply({state:"rendering",phase:"rendering",message:"Updated render underway"});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} productionId={productionId}
    sourceRevision="updated-story" initialStage="review"/>);
  await user.click(await screen.findByRole("button",{name:/Check readiness/i}));
  await waitFor(()=>expect(screen.getByRole("button",{name:/Continue to export/i})).toBeEnabled());
  await user.click(screen.getByRole("button",{name:/Continue to export/i}));
  await user.click(screen.getByRole("button",{name:/Render test MP4/i}));
  expect(await screen.findByRole("button",{name:"Generate updated version"})).toBeEnabled();
  expect(starts).toHaveLength(0);
  await user.click(screen.getByRole("button",{name:"Generate updated version"}));
  await waitFor(()=>expect(starts).toHaveLength(1));
  expect(starts[0]?.confirmUpdatedVersion).toBe(true);
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

it("shows scene-by-scene visual proof and outstanding footage coverage next to the exported MP4",async()=>{
  const url="/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4";
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true});
    if(path.endsWith("/status"))return reply({state:"done",phase:"review",message:"Draft rendered",mediaUrl:url,
      visualCoverage:{sceneCount:3,reviewStillCount:5,
        mediaDeclarationCounts:{stockVideo:1,stockPhoto:1,kumikiOnly:1},scenesWithoutStockVideo:["intro","payoff"]}});
    throw Error("Unexpected production request: "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration"/>);
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  expect(await screen.findByText(/3 of 3 scenes have captured review stills/i)).toBeInTheDocument();
  expect(screen.getByText(/1 stock video · 1 stock photo · 1 Kumiki graphic/i)).toBeInTheDocument();
  expect(screen.getByText(/2 scenes still lack stock footage/i)).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Review technical QA report"})).toHaveAttribute("href",
    url.replace("/video.mp4","/qa-report.json"));
});

it("only offers a direct missing-footage action when scene order matches the current storyboard",async()=>{
  const goto=vi.fn();
  const url="/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4";
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const path=String(input);
    if(path.endsWith("/plan"))return reply(plan);
    if(path.endsWith("/check"))return reply({report:{ready:true,findings:[]}});
    if(path.endsWith("/start"))return reply({started:true});
    if(path.endsWith("/status"))return reply({state:"done",phase:"review",message:"Draft ready",mediaUrl:url,
      visualCoverage:{sceneCount:1,reviewStillCount:2,mediaDeclarationCounts:{stockVideo:0,stockPhoto:0,kumikiOnly:1},
        scenesWithoutStockVideo:["beat1"],missingStockVideoShotIds:["shot1"]}});
    throw Error("Unexpected request "+path);
  });
  const user=userEvent.setup();
  render(<ProductionPanel dossier={dossier} bundle={bundle} initialStage="narration" onFindVisuals={goto}/>);
  await user.click(screen.getByRole("button",{name:/Generate draft video/i}));
  await user.click(await screen.findByRole("button",{name:"Find footage for scene 1"}));
  expect(goto).toHaveBeenCalledExactlyOnceWith("shot1");
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
    if(path.includes("/version-policy/"))return reply({requiresConfirmation:false,completedVersions:0});
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
    if(path.includes("/version-policy/"))return reply({requiresConfirmation:false,completedVersions:0});
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

it("shows a missing narrator as an actionable error when auto-started from the script",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    if(String(input).endsWith("/plan"))return reply(plan);
    if(String(input).endsWith("/check"))return new Response(JSON.stringify({error:
      "Choose a voice provider, authorized voice ID and pinned engine revision."}),{status:422});
    throw Error("Unexpected draft request: "+input);
  });
  render(<ProductionPanel dossier={dossier} bundle={bundle} autoStartDraft/>);
  expect(await screen.findByText(/Choose a voice provider, authorized voice ID/)).toBeInTheDocument();
  expect(screen.getByRole("tab",{name:/Narration/})).toHaveAttribute("aria-selected","true");
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/Generate draft video/i})).toBeEnabled();
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

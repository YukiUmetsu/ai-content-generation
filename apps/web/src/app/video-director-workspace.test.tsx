import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptStudio } from "./prompt-studio";
import { VideoDirectorWorkspace } from "./video-director-workspace";
import * as projectStorage from "@/features/storyboard-planner/model/project-storage";

vi.mock("./live-renderer-scene",()=>({default:({frame}:{frame:number})=>
  <div data-testid="demo-real-scene">Actual exporter at frame {frame}</div>}));

// Asset and sound libraries are independent local sidecars, not AI generation.
function localMediaCatalogResponse(url:unknown):Response|null {
  const path=String(url);
  const result=path.startsWith("/api/contentgen-assets/approved?")?{assets:[]}:
    path.startsWith("/api/contentgen-assets/selected?")?{selections:[],invalidShots:[]}:
    path==="/api/contentgen-sfx/library"?{assets:[]}:
    path==="/api/contentgen-sfx/choices"?{scenes:[]}:null;
  return result?new Response(JSON.stringify(result),{status:200}):null;
}

afterEach(()=>{
  vi.restoreAllMocks();
  // Isolate durable Director drafts between tests without clearing unrelated app preferences.
  for(let i=localStorage.length-1;i>=0;i--){
    const key=localStorage.key(i);
    if(key?.startsWith("contentgen:director-session:"))localStorage.removeItem(key);
  }
});
describe("AI Prompt Studio",()=>{
  it("edits and saves a custom hook prompt while leaving all other stage overrides intact",async()=>{
    const actions:Array<{path:string;data:unknown}>=[];
    const fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async (url,options)=>{
      actions.push({path:String(url),data:options?.body?JSON.parse(String(options.body)):null});
      if(options?.method==="POST")return new Response(JSON.stringify({saved:true,
        settings:JSON.parse(String(options.body))}),{status:200});
      return new Response(JSON.stringify({
        defaults:{research:"Verify the source.",story:"Explain it.",hooks:"Be relevant and curious.",
          script:"Write clearly.",visuals:"Reveal.",audio:"Be expressive.",thumbnails:"Keep clear.",
          captions:"Legible.",review:"Check evidence."},
        settings:{version:1,overrides:{research:"Keep citations precise."}}
      }),{status:200});
    });
    const user=userEvent.setup();render(<PromptStudio locale="en"/>);
    expect(await screen.findByText("Be relevant and curious.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox",{name:"Custom AI system instruction"}),"Speak to first-time homebuyers and explain why it matters.");
    await user.click(screen.getByRole("button",{name:"Save AI prompts"}));
    await waitFor(()=>expect(actions.some(a=>a.data && (a.data as {overrides?:Record<string,string>}).overrides?.hooks?.includes("homebuyers"))).toBe(true));
    const saved=actions.at(-1)?.data as {overrides:Record<string,string>};
    expect(saved.overrides.research).toBe("Keep citations precise.");
    expect(saved.overrides.hooks).toMatch(/homebuyers/);
    await user.click(screen.getByRole("button",{name:"Restore default"}));
    await user.click(screen.getByRole("button",{name:"Save AI prompts"}));
    await waitFor(()=>expect(actions.at(-1)?.data).toEqual({version:1,overrides:{research:"Keep citations precise."}}));
    fetcher.mockRestore();
  });
});
describe("Video Director selected-shot workbench",()=>{
  const dossier={kind:"research-dossier",id:"r1",topic:{title:"Why owning a home costs more",audience:"Homeowners"}};
  const plan={story:{question:"Why?"},shots:[
    {id:"hook",purpose:"hook",visualChange:"Show a house.",onScreenText:"Why?"},
    {id:"middle",purpose:"explain",visualChange:"Show costs.",onScreenText:"What costs?"}],
    sound:[{shotId:"hook",narration:"How much does this really cost?",sfxIntent:null,pauseAfterMs:160},
      {shotId:"middle",narration:"There are multiple costs.",sfxIntent:"soft click",pauseAfterMs:160}],
    teachingSequences:[{phases:[
      {kind:"problem",shotId:"hook",visualAction:"Reveal the house"},
      {kind:"mechanism",shotId:"middle",visualAction:"Reveal the costs"}]}]};
  const bundle={kind:"preproduction-bundle",researchId:"r1",plan};
  const variants=[{id:"hook-1",strategy:"Personal problem",audienceSignal:"You are buying a house",
    curiosityQuestion:"What are you missing?",narration:"You saw a low price. What did you miss?",
    firstVisual:"Unfold the same home into three costs",onScreenText:"What's missing?",
    payoffConnection:"Show full cost",sfxIntent:"click"},
    {id:"hook-2",strategy:"Contrast",audienceSignal:"Your house cost estimate",
    curiosityQuestion:"How can the two estimates differ?",narration:"Why do identical homes cost differently?",
    firstVisual:"Split the cost estimate",onScreenText:"Two estimates",
    payoffConnection:"Show assumptions",sfxIntent:null},
    {id:"hook-3",strategy:"Demonstration",audienceSignal:"Buyer cost breakdown",
    curiosityQuestion:"What happens when costs build?",narration:"Watch these costs appear one at a time.",
    firstVisual:"Stack the cost layers",onScreenText:"Price, then costs",
    payoffConnection:"Show total",sfxIntent:"tick"}];
  it("renders only the selected saved scene as a playable silent MP4",async()=>{
    const requests:Array<{url:string;body:Record<string,unknown>}> = [];
    const previewId="123e4567-e89b-42d3-a456-426614174000";
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,opts)=>{
      const path=String(url),body=opts?.body?JSON.parse(String(opts.body)) as Record<string,unknown>:{};
      requests.push({url:path,body});
      const catalog=localMediaCatalogResponse(url);
      if(catalog)return catalog;
      if(path.endsWith("/live-preview"))return new Response(JSON.stringify({
        kind:"live-renderer-preview/v1",schemaVersion:1,renderPlanSha256:"a".repeat(64),
        plan:{kind:"general-explainer-visual-plan",schemaVersion:1,
          manifest:{schemaVersion:1,id:"test",width:1920,height:1080,durationFrames:90,
            fps:{num:30,den:1},preset:"youtube"},
          chapters:[{id:"beat-1",startFrame:0,endFrame:45,visual:{items:["A","B"]}},
            {id:"beat-2",startFrame:45,endFrame:90,visual:{items:["C","D"]}}],events:{}},
        shotMap:[{shotId:"hook",beatId:"beat-1",startFrame:0,endFrame:45},
          {shotId:"middle",beatId:"beat-2",startFrame:45,endFrame:90}],
        timing:{basis:"estimated-text-only",spokenWpm:145,measuredNarration:false,note:""},visualLimits:[]
      }),{status:200});
      if(path.endsWith("/scene-clip/start"))return new Response(JSON.stringify({started:true,id:previewId}),{status:202});
      if(path.endsWith("/scene-clip/status"))return new Response(JSON.stringify({state:"done",shotId:"middle",
        message:"This scene's silent MP4 is ready.",
        videoUrl:`/api/contentgen-video/scene-clip/media/${previewId}/video.mp4`}),{status:200});
      throw Error("Unexpected network request "+path);
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"selected-scene.json",{type:"application/json"})]}});
    await user.click(await screen.findByRole("button",{name:/Scene 2: What costs\?/}));
    const renderButton=await screen.findByRole("button",{name:"Render this scene MP4"});
    await user.click(renderButton);
    await waitFor(()=>expect(requests.some(item=>item.url.endsWith("/scene-clip/start")&&
      item.body.shotId==="middle")).toBe(true));
    const video=await screen.findByLabelText("Selected scene MP4 preview");
    expect(video).toHaveAttribute("src",`/api/contentgen-video/scene-clip/media/${previewId}/video.mp4`);
    expect(screen.getByText(/complete draft adds narration, sound/i)).toBeInTheDocument();
  });
  it("opens the full narrated draft directly from a saved scene edit",async()=>{
    const calls:string[]=[],starts:Array<Record<string,unknown>>=[];
    const editedBundle={...bundle,plan:{...bundle.plan,shots:bundle.plan.shots.map((shot,index)=>
      index===0?{...shot,onScreenText:"Why? today"}:shot)}};
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,opts)=>{
      const path=String(url);calls.push(path);
      const catalog=localMediaCatalogResponse(url);if(catalog)return catalog;
      if(path.endsWith("/edit"))return new Response(JSON.stringify({kind:"preproduction-edit/v1",
        bundle:editedBundle,impacts:{changedFields:["onScreenText"],speechRegenerate:[],visualRerender:["hook"],
          sfxRemix:[],downstreamRetiming:[],timelineRecalculate:false,externalActionsPerformed:[]}}),{status:200});
      if(path.endsWith("/plan"))return new Response(JSON.stringify({job:{beats:[{id:"beat-1",narration:"Hello"}]}}),{status:200});
      if(path.endsWith("/check"))return new Response(JSON.stringify({report:{ready:true,findings:[]}}),{status:200});
      if(path.endsWith("/start")){
        starts.push(JSON.parse(String(opts?.body)) as Record<string,unknown>);
        return new Response(JSON.stringify({started:true,jobId:"job-edited-film"}),{status:202});
      }
      if(path.endsWith("/status"))return new Response(JSON.stringify({state:"done",phase:"review",
        message:"Narrated draft finished",jobId:"job-edited-film",
        mediaUrl:"/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4"}),{status:200});
      if(path.endsWith("/live-preview"))return new Response(JSON.stringify({kind:"live-renderer-preview/v1",
        sourcePlanSha256:"a".repeat(64),plan:{chapters:[]},shotMap:[]}),{status:200});
      throw Error("Unexpected request "+path+" "+String(opts?.method));
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"scene-project.json",{type:"application/json"})]}});
    await screen.findByRole("button",{name:"Generate updated draft"});
    const text=screen.getByRole("textbox",{name:"Edit on-screen text"});
    await user.type(text," today");
    await user.click(screen.getByRole("button",{name:"Save & generate draft"}));
    expect(screen.getByRole("heading",{name:"Preview & produce your draft"})).toBeInTheDocument();
    await waitFor(()=>expect(calls.some(path=>path.endsWith("/plan"))).toBe(true));
    expect(await screen.findByRole("link",{name:"Download MP4"})).toHaveAttribute("href",
      "/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4");
    expect(starts).toHaveLength(1);
    expect((starts[0]?.bundle as typeof editedBundle).plan.shots[0].onScreenText).toBe("Why? today");
    expect(calls.findIndex(path=>path.endsWith("/edit"))).toBeLessThan(calls.findIndex(path=>path.endsWith("/start")));
  });
  it("opens an approved script's visual shortcut at the rendered scene editor",async()=>{
    const productionId="production-"+"b".repeat(24);
    sessionStorage.setItem("contentgen:director-approved-script:v1:"+productionId,JSON.stringify({
      productionId,scriptRevision:"2026-10-27T00:00:00Z",sourcePrefix:"approved-script:",
      dossier,bundle:{...bundle,researchSha256:"a".repeat(64),planSha256:"b".repeat(64)}
    }));
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
      if(String(input).endsWith("/live-preview"))return new Response(JSON.stringify({
        kind:"live-renderer-preview/v1",schemaVersion:1,sourcePlanSha256:"a".repeat(64),
        renderPlanSha256:"b".repeat(64),plan:{kind:"general-explainer-visual-plan",schemaVersion:1,chapters:[],
          manifest:{schemaVersion:1,id:"test",width:1920,height:1080,durationFrames:1,fps:{num:30,den:1},preset:"youtube"},events:{}},
        shotMap:[],timing:{basis:"estimated-text-only",spokenWpm:145,measuredNarration:false,note:""},visualLimits:[]
      }),{status:200});
      throw Error("Unexpected request");
    });
    render(<VideoDirectorWorkspace locale="en" projectId={productionId} focusStage="visuals"/>);
    expect(await screen.findByRole("heading",{name:"Scene editor"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/01 Storyboard/})).toHaveAttribute("aria-current","step");
    expect(screen.queryByRole("heading",{name:"Find the right visuals"})).not.toBeInTheDocument();
    sessionStorage.removeItem("contentgen:director-approved-script:v1:"+productionId);
  });
  it("binds a saved production's updated MP4 to the edited plan revision, not its earlier source",async()=>{
    const productionId="production-"+"c".repeat(24);
    const original={...bundle,researchSha256:"a".repeat(64),planSha256:"b".repeat(64)};
    const edited={...original,planSha256:"c".repeat(64),plan:{...plan,
      shots:plan.shots.map((shot,index)=>index===0?{...shot,onScreenText:"Why now?"}:shot)}};
    sessionStorage.setItem("contentgen:director-approved-script:v1:"+productionId,JSON.stringify({
      productionId,scriptRevision:"2026-10-28T00:00:00Z",sourcePrefix:"approved-script:",
      dossier,bundle:original}));
    const starts:Array<Record<string,unknown>>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
      const path=String(input),catalog=localMediaCatalogResponse(input);
      if(catalog)return catalog;
      if(path.endsWith("/edit"))return new Response(JSON.stringify({kind:"preproduction-edit/v1",bundle:edited,
        impacts:{changedFields:["onScreenText"],speechRegenerate:[],visualRerender:["hook"],
          sfxRemix:[],downstreamRetiming:[],timelineRecalculate:false,externalActionsPerformed:[]}}),{status:200});
      if(path.endsWith("/live-preview"))return new Response(JSON.stringify({kind:"live-renderer-preview/v1",
        sourcePlanSha256:"a".repeat(64),plan:{chapters:[]},shotMap:[]}),{status:200});
      if(path.includes(`/status/${productionId}`))return new Response(JSON.stringify({state:"idle",phase:"idle",message:""}),{status:200});
      if(path.endsWith(`/version-policy/${productionId}`))return new Response(JSON.stringify({requiresConfirmation:false,completedVersions:0}),{status:200});
      if(path.endsWith("/plan"))return new Response(JSON.stringify({job:{beats:[{id:"beat-1",narration:"Hello"}]}}),{status:200});
      if(path.endsWith("/check"))return new Response(JSON.stringify({report:{ready:true,findings:[]}}),{status:200});
      if(path.endsWith("/start")){starts.push(JSON.parse(String(init?.body)) as Record<string,unknown>);
        return new Response(JSON.stringify({started:true,jobId:"job-edited-plan"}),{status:202});}
      if(path.endsWith("/status"))return new Response(JSON.stringify({state:"done",phase:"review",
        message:"Narrated MP4 ready",mediaUrl:"/api/contentgen-video/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/video.mp4"}),{status:200});
      throw Error("Unexpected request "+path);
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en" projectId={productionId}/>);
    const text=await screen.findByRole("textbox",{name:"Edit on-screen text"});
    await user.type(text," now");
    await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
    await user.click(await screen.findByRole("button",{name:"Generate updated draft"}));
    await waitFor(()=>expect(starts).toHaveLength(1));
    expect(starts[0]?.sourceRevision).toBe(edited.planSha256);
    sessionStorage.removeItem("contentgen:director-approved-script:v1:"+productionId);
  });
  it("rejects a saved project without any editable shots instead of crashing the scene editor",async()=>{
    const emptyBundle={...bundle,plan:{...plan,shots:[]}};
    render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle:emptyBundle})],"empty-project.json",{type:"application/json"})]}});
    expect(await screen.findByText("Saved project has no editable shots.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox",{name:"Visible scene layout"})).not.toBeInTheDocument();
  });

  it("loads two matched files, generates 3 local alternatives and independently selects script/visual/SFX",async()=>{
    const calls:Array<{url:string;body:Record<string,unknown>}>= [];
    const api=vi.spyOn(globalThis,"fetch").mockImplementation(async (url,opts)=>{
      const body=JSON.parse(String(opts?.body??"{}")) as Record<string,unknown>;
      calls.push({url:String(url),body});
      if(String(url).endsWith("/variants"))
        return new Response(JSON.stringify({variants}),{status:200});
      if(String(url).endsWith("/edit")){
        const revised=structuredClone(bundle);
        const edits=body.changes as Record<string,string|null>;
        revised.plan.sound[0].narration=edits.narration??revised.plan.sound[0].narration;
        revised.plan.shots[0].visualChange=edits.visualChange??revised.plan.shots[0].visualChange;
        revised.plan.shots[0].onScreenText=edits.onScreenText??revised.plan.shots[0].onScreenText;
        return new Response(JSON.stringify({kind:"preproduction-edit/v1",bundle:revised,reviewRequired:true,
          impacts:{changedFields:Object.keys(edits),speechRegenerate:["hook"],visualRerender:["hook"],
            sfxRemix:["hook"],timelineRecalculate:true,downstreamRetiming:["hook","middle"],
            externalActionsPerformed:[]}}),{status:200});
      }
      throw Error("Unexpected call");
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    const dossierInput=screen.getByLabelText("Research dossier JSON") as HTMLInputElement;
    fireEvent.change(dossierInput,{target:{files:[new File([JSON.stringify(dossier)],"research.json",{type:"application/json"})]}});
    const bundleInput=screen.getByLabelText("Preproduction bundle JSON") as HTMLInputElement;
    fireEvent.change(bundleInput,{target:{files:[new File([JSON.stringify(bundle)],"bundle.json",{type:"application/json"})]}});
    expect(await screen.findByText("Video project loaded")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/01 Storyboard/i})).toHaveAttribute("aria-current","step");
    await user.click(screen.getByRole("button",{name:"Generate 3 local AI variations"}));
    expect((await screen.findAllByText("Personal problem")).length).toBeGreaterThanOrEqual(1);
    await user.selectOptions(screen.getByRole("combobox",{name:"Script candidate"}),"hook-2");
    await user.selectOptions(screen.getByRole("combobox",{name:"Visual candidate"}),"hook-3");
    await user.click(screen.getByRole("button",{name:"Apply combined variation to selected shot"}));
    await waitFor(()=>expect(calls.some(c=>c.url.endsWith("/edit"))).toBe(true));
    const edit=calls.find(c=>c.url.endsWith("/edit"))?.body;
    expect(edit?.shotId).toBe("hook");
    expect((edit?.changes as Record<string,string>)?.narration).toBe(variants[1].narration);
    expect((edit?.changes as Record<string,string>)?.visualAction).toBe(variants[2].firstVisual);
    expect(await screen.findByText(/New narration: hook/)).toBeInTheDocument();
    expect(screen.getByText(/Unchanged narration is kept/)).toBeInTheDocument();
    api.mockRestore();
  });
  it("offers a scene timeline and reversible saved edits without modifying untouched scenes",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,opts)=>{
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify({error:"No renderer fixture"}),{status:503});
      const body=JSON.parse(String(opts?.body)) as {bundle:typeof bundle;changes:{narration:string}};
      const revised=structuredClone(body.bundle);
      revised.plan.sound[0].narration=body.changes.narration;
      return new Response(JSON.stringify({bundle:revised,impacts:{changedFields:["narration"],
        speechRegenerate:["hook"],visualRerender:[],sfxRemix:[],downstreamRetiming:["hook","middle"],timelineRecalculate:true}}),{status:200});
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"scenes.json",{type:"application/json"})]}});
    expect(await screen.findByRole("group",{name:"Scene timeline"})).toBeInTheDocument();
    const voice=screen.getByRole("textbox",{name:"Edit narration"});
    fireEvent.change(voice,{target:{value:"What does this house really cost over time?"}});
    await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
    await waitFor(()=>expect(voice).toHaveValue("What does this house really cost over time?"));
    await user.click(screen.getByRole("button",{name:"Undo saved edit"}));
    expect(voice).toHaveValue("How much does this really cost?");
    await user.click(screen.getByRole("button",{name:"Redo"}));
    expect(voice).toHaveValue("What does this house really cost over time?");
    await user.click(screen.getByRole("button",{name:/Scene 2: What costs\?/}));
    expect(voice).toHaveValue("There are multiple costs.");
  });
  it("edits scene pacing without requesting voice regeneration",async()=>{
    const edits:Array<Record<string,unknown>>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,opts)=>{
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify({error:"No renderer fixture"}),{status:503});
      const body=JSON.parse(String(opts?.body)) as {bundle:typeof bundle;changes:Record<string,unknown>};
      edits.push(body.changes);
      const revised=structuredClone(body.bundle);
      revised.plan.sound[1].pauseAfterMs=Number(body.changes.pauseAfterMs);
      return new Response(JSON.stringify({bundle:revised,impacts:{changedFields:["pauseAfterMs"],
        speechRegenerate:[],visualRerender:["middle"],sfxRemix:[],downstreamRetiming:["middle"],
        timelineRecalculate:true,externalActionsPerformed:[]}}),{status:200});
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"scene-timing.json",{type:"application/json"})]}});
    await user.click(await screen.findByRole("button",{name:/Scene 2: What costs\?/}));
    fireEvent.change(screen.getByRole("spinbutton",{name:"Scene pause duration"}),{target:{value:"950"}});
    await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
    await waitFor(()=>expect(edits).toEqual([{pauseAfterMs:950}]));
    expect(screen.getByText(/New narration: none/)).toBeInTheDocument();
  });
  it("saves camera, reveal timing and transition on only the selected scene",async()=>{
    const edits:Array<{shotId:string;changes:Record<string,unknown>}>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,opts)=>{
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify({error:"No renderer fixture"}),{status:503});
      const body=JSON.parse(String(opts?.body)) as {bundle:typeof bundle;shotId:string;changes:Record<string,unknown>};
      edits.push({shotId:body.shotId,changes:body.changes});
      const revised=structuredClone(body.bundle);
      Object.assign(revised.plan.shots.find(s=>s.id===body.shotId)!,{motion:body.changes.motion});
      return new Response(JSON.stringify({bundle:revised,impacts:{changedFields:["motion"],
        speechRegenerate:[],visualRerender:[body.shotId],sfxRemix:[],downstreamRetiming:[],
        timelineRecalculate:false,externalActionsPerformed:[]}}),{status:200});
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"scene-motion.json",{type:"application/json"})]}});
    await user.click(await screen.findByRole("button",{name:/Scene 2: What costs\?/}));
    await user.selectOptions(screen.getByRole("combobox",{name:"Scene camera movement"}),"cinematic");
    fireEvent.change(screen.getByRole("slider",{name:"Scene reveal delay"}),{target:{value:"15"}});
    await user.selectOptions(screen.getByRole("combobox",{name:"Scene reveal pace"}),"deliberate");
    await user.selectOptions(screen.getByRole("combobox",{name:"Scene transition"}),"fade");
    await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
    await waitFor(()=>expect(edits).toEqual([{shotId:"middle",changes:{motion:{
      revealDelayPercent:15,revealPace:"deliberate",camera:"cinematic",transition:"fade"
    }}}]));
    expect(screen.getByText(/New narration: none/)).toBeInTheDocument();
    expect(screen.getByText(/Rerender visuals: middle/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:/Scene 1: Why\?/}));
    expect(screen.getByRole("combobox",{name:"Scene camera movement"})).toHaveValue("subtle");
    await user.click(screen.getByRole("button",{name:/Scene 2: What costs\?/}));
    expect(screen.getByRole("combobox",{name:"Scene camera movement"})).toHaveValue("cinematic");
  });
  it("carries a compatible scene edit into a regenerated script without reverting new narration",async()=>{
    const productionId="production-"+"9".repeat(24);
    const sessionKey="contentgen:director-approved-script:v1:"+productionId;
    const source={...structuredClone(bundle),researchSha256:"a".repeat(64),planSha256:"b".repeat(64)};
    const handoff=(scriptRevision:string,plan:typeof source)=>JSON.stringify({
      productionId,scriptRevision,sourcePrefix:"approved-script:"+scriptRevision+":",dossier,bundle:plan
    });
    sessionStorage.setItem(sessionKey,handoff("first",source));
    const edits:Array<Record<string,unknown>>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async (url,opts)=>{
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify({error:"No renderer fixture"}),{status:503});
      if(!String(url).endsWith("/edit"))throw Error("Unexpected request: "+url);
      const body=JSON.parse(String(opts?.body)) as {bundle:typeof source;shotId:string;changes:Record<string,unknown>};
      edits.push(body.changes);
      const revised=structuredClone(body.bundle);
      Object.assign(revised.plan.shots.find(s=>s.id===body.shotId)!,body.changes);
      revised.planSha256="e".repeat(64);
      return new Response(JSON.stringify({bundle:revised,impacts:{changedFields:Object.keys(body.changes),
        speechRegenerate:[],visualRerender:[body.shotId],sfxRemix:[],downstreamRetiming:[],
        timelineRecalculate:false,externalActionsPerformed:[]}}),{status:200});
    });
    const first=render(<VideoDirectorWorkspace locale="en" projectId={productionId} focusStage="visuals"/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:/Scene 2: What costs\?/}));
    fireEvent.change(screen.getByRole("textbox",{name:"Edit on-screen text"}),{target:{value:"Edited cost graphic"}});
    await userEvent.setup().click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
    await waitFor(()=>expect(screen.getByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("Edited cost graphic"));
    const savedKey="contentgen:director-session:v1:"+productionId+":approved-script:first:"+source.planSha256;
    await waitFor(()=>expect((JSON.parse(localStorage.getItem(savedKey)??"null") as
      {bundle?:{plan:{shots:Array<{onScreenText:string}>}}}|null)?.bundle?.plan.shots[1].onScreenText)
      .toBe("Edited cost graphic"));
    first.unmount();
    const regenerated=structuredClone(source);
    regenerated.planSha256="c".repeat(64);
    regenerated.plan.sound[1].narration="New and more accurate voiceover";
    sessionStorage.setItem(sessionKey,handoff("second",regenerated));
    render(<VideoDirectorWorkspace locale="en" projectId={productionId} focusStage="visuals"/>);
    expect(await screen.findByText(/Carried 1 compatible scene edit/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button",{name:/Scene 2: Edited cost graphic/}));
    expect(screen.getByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("Edited cost graphic");
    expect(screen.getByRole("textbox",{name:"Edit narration"})).toHaveValue("New and more accurate voiceover");
    expect(edits).toEqual([{onScreenText:"Edited cost graphic"},{onScreenText:"Edited cost graphic"}]);
    sessionStorage.removeItem(sessionKey);
  });
});

describe("first-run complete Studio demo",()=>{
  it("opens sample animations automatically, exposes a timeline, and does not ask for a JSON file or voice",async()=>{
    const sampleDossier={kind:"research-dossier",id:"demo-id",topic:{title:"Home cost demo",audience:"Homeowners"}};
    const sampleBundle={kind:"preproduction-bundle",researchId:"demo-id",plan:{
      shots:[{id:"hook",purpose:"hook",visualChange:"Show home",onScreenText:"Why does it cost more?"},
        {id:"mechanism",purpose:"explain",visualChange:"Show cost groups",onScreenText:"Extra costs"},
        {id:"payoff",purpose:"payoff",visualChange:"Reveal answer",onScreenText:"Context matters"}],
      sound:[{shotId:"hook",narration:"What is the cost?",sfxIntent:null},
        {shotId:"mechanism",narration:"It involves more than a mortgage.",sfxIntent:null},
        {shotId:"payoff",narration:"It depends on assumptions.",sfxIntent:null}],
      teachingSequences:[{phases:[{shotId:"hook",kind:"problem",visualAction:"Open question"},
        {shotId:"mechanism",kind:"mechanism",visualAction:"Show categories"},
        {shotId:"payoff",kind:"payoff",visualAction:"Answer"}]}],story:{question:"Why?"}}};
    const chapters=sampleBundle.plan.shots.map((item,i)=>({
      id:item.id,intent:i===0?"general-intro":i===2?"general-payoff":"general-breakdown",
      startFrame:i*60,endFrame:(i+1)*60,visual:{headline:item.onScreenText,subhead:"Demonstration",
        items:["Home","Costs"]},claimRefs:[],evidenceRefs:[],eventIds:[]
    }));
    const preview={kind:"live-renderer-preview/v1",schemaVersion:1,
      sourcePlanSha256:"a".repeat(64),renderPlanSha256:"b".repeat(64),
      plan:{kind:"general-explainer-visual-plan",schemaVersion:1,chapters,
        manifest:{schemaVersion:1,id:"demo-id",width:1920,height:1080,durationFrames:180,
          fps:{num:30,den:1},preset:"youtube"},events:{},payoffEventId:"payoff",
        claims:[],evidence:[],locale:"en-US",title:"Demo",disclaimer:"DRAFT",commercialReady:false},
      shotMap:sampleBundle.plan.shots.map((item,i)=>({
        shotId:item.id,beatId:item.id,startFrame:i*60,endFrame:(i+1)*60,
        visualAction:item.visualChange})),
      timing:{basis:"estimated-text-only",spokenWpm:145,measuredNarration:false,note:"Estimated timing"},
      visualLimits:[]};
    const calls:string[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url)=>{
      const sidecar=localMediaCatalogResponse(url);if(sidecar)return sidecar;
      calls.push(String(url));
      if(String(url).endsWith("/demo"))return new Response(JSON.stringify({
        dossier:sampleDossier,bundle:sampleBundle}),{status:200});
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify(preview),{status:200});
      throw Error("Demo unexpectedly started research, TTS or full media production: "+String(url));
    });
    const user=userEvent.setup();
    render(<VideoDirectorWorkspace locale="en"/>);
    expect(screen.getByRole("button",{name:"Open interactive sample"})).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Open interactive sample"}));
    expect(await screen.findByText("Interactive sample loaded")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/04 Preview & Export/i})).toHaveAttribute("aria-current","step");
    expect(await screen.findByTestId("demo-real-scene")).toHaveTextContent("frame 0");
    expect(screen.getByRole("group",{name:"Video scene timeline"})).toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:"Camera movement"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Save project"})).toBeInTheDocument();
    expect(screen.queryByText(/Import both the matching research dossier/)).not.toBeInTheDocument();
    expect(calls).toEqual(["/api/contentgen-video/demo","/api/contentgen-video/live-preview"]);
    await user.click(screen.getByRole("button",{name:"Edit this shot in Video Director"}));
    expect(screen.getByRole("button",{name:/01 Storyboard/i})).toHaveAttribute("aria-current","step");
    await user.click(screen.getByRole("button",{name:/04 Preview & Export/i}));
    expect(screen.getByRole("group",{name:"Video scene timeline"})).toBeInTheDocument();
    // The storyboard opens its own selected scene preview, without TTS or a render job.
    await waitFor(()=>expect(calls).toEqual(["/api/contentgen-video/demo",
      "/api/contentgen-video/live-preview","/api/contentgen-video/live-preview"]));
  });
});

describe("storyboard scene layout editing",()=>{
  it("sends a visual-only family revision from the shot editor for a general middle scene",async()=>{
    const dossier={kind:"research-dossier",id:"r-family",topic:{title:"Roof economics",audience:"Homeowners"}};
    const plan={story:{question:"What makes roof work expensive?"},
      shots:["hook","middle","closing"].map((id,index)=>({id,
        family:index===0?"question":index===2?"summary":"mechanism",
        purpose:id,visualChange:"Show costs",onScreenText:"Roof costs"})),
      sound:["hook","middle","closing"].map(shotId=>({shotId,narration:"Why do repairs add up?",sfxIntent:null})),
      teachingSequences:[{phases:["hook","middle","closing"].map(shotId=>({shotId,kind:"mechanism",visualAction:"Show costs"}))}]};
    const bundle={kind:"preproduction-bundle",researchId:dossier.id,plan};
    const calls:Array<Record<string,unknown>>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,opts)=>{
      if(!String(url).endsWith("/edit"))throw Error("Unexpected request");
      const data=JSON.parse(String(opts?.body)) as {changes:{family:string};shotId:string};
      calls.push(data as unknown as Record<string,unknown>);
      const revised=structuredClone(bundle);
      revised.plan.shots[1].family=data.changes.family;
      return new Response(JSON.stringify({kind:"preproduction-edit/v1",bundle:revised,reviewRequired:true,
        impacts:{changedFields:["family"],speechRegenerate:[],visualRerender:["middle"],sfxRemix:[],
          downstreamRetiming:[],timelineRecalculate:false,externalActionsPerformed:[]}}),{status:200});
    });
    const user=userEvent.setup();render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"roof.json",{type:"application/json"})]}});
    await screen.findByText("Video project loaded");
    expect(screen.getByRole("combobox",{name:"Visible scene layout"})).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox",{name:"Selected video shot"}),"middle");
    await user.selectOptions(screen.getByRole("combobox",{name:"Visible scene layout"}),"comparison");
    await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
    await waitFor(()=>expect(calls).toHaveLength(1));
    expect(calls[0].shotId).toBe("middle");
    expect(calls[0].changes).toEqual({family:"comparison"});
    expect(screen.getByRole("combobox",{name:"Visible scene layout"})).toHaveValue("comparison");
  });
});

describe("editing meaningful visible teaching elements as a normal Studio user",()=>{
 it("accepts readable label + explanation lines and saves only the selected visual shot",async()=>{
   const dossier={kind:"research-dossier",id:"r1",topic:{title:"Learning video",audience:"Learners"}};
   const shot={id:"hook",purpose:"hook",visualChange:"Show the lesson",onScreenText:"How does it work?"};
   const plan={shots:[shot],story:{question:"Why?"},sound:[{
     shotId:"hook",narration:"Understand the subject by seeing it change.",sfxIntent:null
   }],teachingSequences:[{phases:[{shotId:"hook",kind:"problem",visualAction:"Show the subject"}]}]};
   const bundle={kind:"preproduction-bundle",researchId:"r1",plan};
   const edits:Array<Record<string,unknown>>=[];
   vi.spyOn(globalThis,"fetch").mockImplementation(async (url,opts)=>{
     if(String(url).endsWith("/edit")){
       const body=JSON.parse(String(opts?.body)) as Record<string,unknown>;
       edits.push(body);
       const changed=structuredClone(bundle);
       changed.plan.shots[0]={...shot,...(body.changes as Record<string,unknown>)} as typeof shot;
       return new Response(JSON.stringify({kind:"preproduction-edit/v1",bundle:changed,reviewRequired:true,
         impacts:{changedFields:["visualElements"],speechRegenerate:[],visualRerender:["hook"],
           sfxRemix:[],timelineRecalculate:false,downstreamRetiming:[],externalActionsPerformed:[]}}),{status:200});
     }
     throw Error("Visual edit unexpectedly invoked "+url);
   });
   const user=userEvent.setup();
   render(<VideoDirectorWorkspace locale="en"/>);
   const file=new File([JSON.stringify({dossier,bundle})],"example.json",{type:"application/json"});
   fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[file]}});
   expect(await screen.findByText("Video project loaded")).toBeInTheDocument();
   const editor=screen.getByRole("textbox",{name:"Visible teaching elements"});
   fireEvent.change(editor,{target:{value:"Home insurance | Recurring premium protects the house\nMaintenance | Repairs and upkeep cost money"}});
   await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
   await waitFor(()=>expect(edits).toHaveLength(1));
   expect(edits[0].shotId).toBe("hook");
   expect(edits[0].changes).toEqual({visualElements:[
     {label:"Home insurance",detail:"Recurring premium protects the house"},
     {label:"Maintenance",detail:"Repairs and upkeep cost money"}
   ]});
 });
 it("rejects placeholder visual labels in the UI before sending an edit",async()=>{
   const dossier={kind:"research-dossier",id:"r1",topic:{title:"Learning video",audience:"Learners"}};
   const bundle={kind:"preproduction-bundle",researchId:"r1",plan:{
     story:{question:"Why?"},shots:[{id:"hook",purpose:"hook",visualChange:"Show something",onScreenText:"Why?"}],
     sound:[{shotId:"hook",narration:"The question is interesting for learners.",sfxIntent:null}],
     teachingSequences:[{phases:[{shotId:"hook",kind:"problem",visualAction:"Show question"}]}]
   }};
   const network=vi.spyOn(globalThis,"fetch").mockImplementation(async url=>{
     const sidecar=localMediaCatalogResponse(url);if(sidecar)return sidecar;
     throw Error("Invalid visual edit unexpectedly requested "+String(url));
   });
   const user=userEvent.setup();
   render(<VideoDirectorWorkspace locale="en"/>);
   fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
     new File([JSON.stringify({dossier,bundle})],"bad-example.json",{type:"application/json"})
   ]}});
   await screen.findByText("Video project loaded");
   fireEvent.change(screen.getByRole("textbox",{name:"Visible teaching elements"}),{
     target:{value:"House | Some house\nCategories | Many categories"}});
   await user.click(screen.getByRole("button",{name:"Apply selected-shot edit"}));
   expect(await screen.findByText(/specific visual elements/i)).toBeInTheDocument();
   expect(network.mock.calls.filter(([url])=>String(url).endsWith("/edit"))).toHaveLength(0);
 });
});

describe("guided Video Director navigation",()=>{
  it("preserves unsaved scene text and requires explicit discard before switching stages",async()=>{
    const dossier={kind:"research-dossier",id:"r1",topic:{title:"How insulation works",audience:"Homeowners"}};
    const bundle={kind:"preproduction-bundle",researchId:"r1",plan:{
      story:{question:"Why?"},shots:[{id:"hook",purpose:"Question",visualChange:"Show room",onScreenText:"Warm room"}],
      sound:[{shotId:"hook",narration:"What keeps heat inside?",sfxIntent:null}],teachingSequences:[]
    }};
    const user=userEvent.setup();
    render(<VideoDirectorWorkspace locale="en"/>);
    fireEvent.change(screen.getByLabelText("Saved ContentGen project"),{target:{files:[
      new File([JSON.stringify({dossier,bundle})],"video.json",{type:"application/json"})
    ]}});
    await screen.findByText("Video project loaded");
    const narration=screen.getByRole("textbox",{name:"Edit narration"});
    fireEvent.change(narration,{target:{value:"New hook that isn't saved"}});
    await user.click(screen.getByRole("button",{name:/04 Preview & Export/i}));
    expect(screen.getByRole("button",{name:/01 Storyboard/i})).toHaveAttribute("aria-current","step");
    expect(narration).toHaveValue("New hook that isn't saved");
    expect(screen.getByText(/Save or discard your scene edits before continuing/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Discard unsaved edits"}));
    expect(narration).toHaveValue("What keeps heat inside?");
    await user.click(screen.getByRole("button",{name:/04 Preview & Export/i}));
    expect(screen.getByRole("button",{name:/04 Preview & Export/i})).toHaveAttribute("aria-current","step");
  });
});

describe("saved research to Video Director handoff",()=>{
  const artifactId="research_hvac-123456789abc";
  const dossier={kind:"research-dossier",id:"research_hvac",topic:{title:"Heat pump installation",audience:"Homeowners"}};
  const bundle={kind:"preproduction-bundle",researchId:"research_hvac",plan:{
    shots:[{id:"shot_1",visualChange:"Show equipment",onScreenText:"The real cost",purpose:"reveal"}],
    sound:[{shotId:"shot_1",narration:"Installation includes labor.",sfxIntent:null}],
    teachingSequences:[],story:{question:"Why is replacement expensive?"}}};
  it("opens the exact saved research artifact without generating a fresh storyboard",async()=>{
    const calls:string[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
      const sidecar=localMediaCatalogResponse(url);if(sidecar)return sidecar;
      calls.push(String(url));
      expect(init?.method).toBe("POST");
      if(String(url).endsWith("/live-preview"))return new Response(JSON.stringify({error:"Preview unavailable in this fixture"}),{status:503});
      expect(JSON.parse(String(init?.body))).toEqual({artifactId});
      return new Response(JSON.stringify({artifactId,dossier,bundle}),{status:200});
    });
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByText("Video project loaded")).toBeInTheDocument();
    expect(screen.getByText("Heat pump installation")).toBeInTheDocument();
    expect(screen.getByText(/1 scenes/)).toBeInTheDocument();
    await waitFor(()=>expect(calls).toEqual(["/api/contentgen-director/compile-saved-research",
      "/api/contentgen-video/live-preview"]));
  });
  it("opens the requested guided production stage after loading saved research",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url)=>{
      const sidecar=localMediaCatalogResponse(url);if(sidecar)return sidecar;
      return new Response(JSON.stringify({artifactId,dossier,bundle}),{status:200});
    });
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId} focusStage="visuals"/>);
    expect(await screen.findByText("Video project loaded")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/01 Storyboard/i})).toHaveAttribute("aria-current","step");
    expect(screen.getByRole("button",{name:/04 Preview & Export/i})).not.toHaveAttribute("aria-current","step");
  });
  it("resumes saved shot edits only for the matching snapshot",async()=>{
    const sessionKey="contentgen:director-session:v1:project-demo:"+artifactId;
    const revised=structuredClone(bundle);
    revised.plan.shots[0].onScreenText="Approved local draft edit";
    const sourceBundle={...bundle,researchSha256:"b".repeat(64),planSha256:"a".repeat(64)};
    const savedBundle={...revised,researchSha256:"b".repeat(64),planSha256:"c".repeat(64)};
    sessionStorage.setItem(sessionKey,JSON.stringify({version:1,artifactId,dossier,bundle:savedBundle}));
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
      artifactId,dossier,bundle:sourceBundle,
    }),{status:200}));
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("Approved local draft edit");
    sessionStorage.removeItem(sessionKey);
  });
  it("restores source-matched saved edits after tab-scoped storage is cleared",async()=>{
    const key="contentgen:director-session:v1:project-demo:"+artifactId;
    const revised=structuredClone(bundle);
    revised.plan.shots[0].onScreenText="Persisted scene headline";
    const savedBundle={...revised,researchSha256:"b".repeat(64),planSha256:"c".repeat(64)};
    localStorage.setItem(key,JSON.stringify({version:1,artifactId,dossier,bundle:savedBundle}));
    sessionStorage.removeItem(key);
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({artifactId,dossier,
      bundle:{...bundle,researchSha256:"b".repeat(64),planSha256:"a".repeat(64)}}),{status:200}));
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("Persisted scene headline");
  });
  it("does not restore draft edits from a different research fingerprint",async()=>{
    const sessionKey="contentgen:director-session:v1:project-demo:"+artifactId;
    const savedBundle={...structuredClone(bundle),researchSha256:"0".repeat(64),planSha256:"c".repeat(64)};
    savedBundle.plan.shots[0].onScreenText="Wrong source edits";
    sessionStorage.setItem(sessionKey,JSON.stringify({version:1,artifactId,dossier,bundle:savedBundle}));
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
      artifactId,dossier,bundle:{...bundle,researchSha256:"b".repeat(64),planSha256:"a".repeat(64)},
    }),{status:200}));
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("The real cost");
    sessionStorage.removeItem(sessionKey);
  });
  it("passes saved storyboard into Director and does not resume an older storyboard revision",async()=>{
    const digest="c".repeat(64),oldDigest="d".repeat(64);
    const board={assumptions:["Research artifact: "+artifactId]};
    vi.spyOn(projectStorage,"loadProjectStoryboard").mockReturnValue({
      board:board as unknown as NonNullable<ReturnType<typeof projectStorage.loadProjectStoryboard>["board"]>,
      warning:null,
    });
    const sessionKey="contentgen:director-session:v2:project-demo:"+artifactId+":"+oldDigest;
    const older={...structuredClone(bundle),researchSha256:"b".repeat(64),planSha256:"d".repeat(64)};
    older.plan.shots[0].onScreenText="Outdated storyboard shot";
    sessionStorage.setItem(sessionKey,JSON.stringify({version:1,artifactId,dossier,bundle:older}));
    vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{
      expect(JSON.parse(String(init?.body))).toEqual({artifactId,projectId:"project-demo",storyboard:board});
      return new Response(JSON.stringify({artifactId,dossier,
        bundle:{...bundle,researchSha256:"b".repeat(64),planSha256:"a".repeat(64)},
        synchronization:{storyboardSha256:digest,applied:["shot_1:narration"],
          manualReview:["Storyboard camera edits are not yet imported into Director."]},
      }),{status:200});
    });
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByText("Saved storyboard → Director")).toBeInTheDocument();
    expect(screen.getByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("The real cost");
    expect(screen.getByText(/Storyboard camera edits are not yet imported/)).toBeInTheDocument();
    sessionStorage.removeItem(sessionKey);
  });
  it("shows a warning and compiles only saved research when the local storyboard belongs to another artifact",async()=>{
    const older={assumptions:["Research artifact: research_old-123456789abc"]};
    vi.spyOn(projectStorage,"loadProjectStoryboard").mockReturnValue({
      board:older as unknown as NonNullable<ReturnType<typeof projectStorage.loadProjectStoryboard>["board"]>,
      warning:null,
    });
    vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{
      expect(JSON.parse(String(init?.body))).toEqual({artifactId});
      return new Response(JSON.stringify({artifactId,dossier,
        bundle:{...bundle,researchSha256:"b".repeat(64),planSha256:"a".repeat(64)},
        synchronization:null,
      }),{status:200});
    });
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/different research artifact/);
    expect(await screen.findByRole("textbox",{name:"Edit on-screen text"})).toHaveValue("The real cost");
  });
  it("rejects a result from a different saved artifact",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
      artifactId:"research_other-123456789abc",dossier,bundle,
    }),{status:200}));
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent(/did not match the selected .*research artifact/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/did not match the selected .*research artifact/i);
    expect(screen.queryByText("Video project loaded")).not.toBeInTheDocument();
  });
});

describe("approved script to Director handoff",()=>{
  it("opens a compiled script's scenes without fetching a second research plan",async()=>{
    const productionId="production-"+"a".repeat(24);
    const sha="b".repeat(64);
    const dossier={kind:"research-dossier",id:"script_"+"a".repeat(24),
      topic:{title:"Actual renewal factors",audience:"Homeowners"}};
    const bundle={kind:"preproduction-bundle",researchId:dossier.id,researchSha256:"a".repeat(64),
      planSha256:sha,plan:{story:{question:"Why did prices change?"},
        shots:[{id:"shot_1",family:"question",purpose:"hook",onScreenText:"Renewal factors",
          visualChange:"Reveal changed risk"}],
        sound:[{shotId:"shot_1",narration:"Look at the individual coverage factors.",sfxIntent:null}],
        teachingSequences:[]}};
    sessionStorage.setItem("contentgen:director-approved-script:v1:"+productionId,
      JSON.stringify({productionId,scriptRevision:"2026-10-25T12:00:00.000Z",dossier,bundle}));
    const calls:string[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url)=>{
      calls.push(String(url));
      const sidecar=localMediaCatalogResponse(url);
      if(sidecar)return sidecar;
      throw Error("Unexpected research compilation request");
    });
    render(<VideoDirectorWorkspace locale="en" projectId={productionId} focusStage="visuals"/>);
    expect(await screen.findByText("Actual renewal factors")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/01 Storyboard/i})).toHaveAttribute("aria-current","step");
    expect(calls).not.toContain("/api/contentgen-director/compile-saved-research");
    sessionStorage.removeItem("contentgen:director-approved-script:v1:"+productionId);
  });
});


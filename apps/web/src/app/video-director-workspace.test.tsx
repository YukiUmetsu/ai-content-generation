import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptStudio } from "./prompt-studio";
import { VideoDirectorWorkspace } from "./video-director-workspace";

vi.mock("./live-renderer-scene",()=>({default:({frame}:{frame:number})=>
  <div data-testid="demo-real-scene">Actual exporter at frame {frame}</div>}));

afterEach(()=>{vi.restoreAllMocks();});
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
    sound:[{shotId:"hook",narration:"How much does this really cost?",sfxIntent:null},
      {shotId:"middle",narration:"There are multiple costs.",sfxIntent:"soft click"}],
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
    expect(screen.getByText(/does not yet synthesize partial WAVs/)).toBeInTheDocument();
    api.mockRestore();
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
    expect(await screen.findByTestId("demo-real-scene")).toHaveTextContent("frame 0");
    expect(screen.getByRole("group",{name:"Video scene timeline"})).toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:"Camera movement"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Save project"})).toBeInTheDocument();
    expect(screen.queryByText(/Import both the matching research dossier/)).not.toBeInTheDocument();
    expect(calls).toEqual(["/api/contentgen-video/demo","/api/contentgen-video/live-preview"]);
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
   const network=vi.spyOn(globalThis,"fetch");
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
   expect(network).not.toHaveBeenCalled();
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
      calls.push(String(url));
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({artifactId});
      return new Response(JSON.stringify({artifactId,dossier,bundle}),{status:200});
    });
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    expect(await screen.findByText("Video project loaded")).toBeInTheDocument();
    expect(screen.getByText(/Heat pump installation · 1 scenes/)).toBeInTheDocument();
    expect(calls).toEqual(["/api/contentgen-director/compile-saved-research"]);
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
  it("rejects a result from a different saved artifact",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
      artifactId:"research_other-123456789abc",dossier,bundle,
    }),{status:200}));
    render(<VideoDirectorWorkspace locale="en" projectId="project-demo" researchArtifactId={artifactId}/>);
    await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent(/did not match the selected research artifact/i));
    expect(screen.queryByText("Video project loaded")).not.toBeInTheDocument();
  });
});

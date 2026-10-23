import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptStudio } from "./prompt-studio";
import { VideoDirectorWorkspace } from "./video-director-workspace";

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
    expect(await screen.findByText(/Matched: Why owning a home costs more/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Generate 3 local AI variations"}));
    expect(await screen.findByText("Personal problem")).toBeInTheDocument();
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

import {afterEach,expect,it,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {SfxDiscoveryPanel} from "./sfx-discovery-panel";

afterEach(()=>vi.unstubAllGlobals());

it("saves an explicit first-visual-reveal trigger without changing automatic sound selection",async()=>{
  const requests:Array<{path:string;body:Record<string,unknown>|undefined}>=[];
  vi.stubGlobal("fetch",vi.fn(async (url:string,options?:RequestInit)=>{
    const path=String(url).split("/").at(-1)??"";
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:undefined;
    requests.push({path,body});
    const payload=path==="library"?{assets:[]}:
      path==="choices"?{scenes:[{shotId:"shot1",mode:"auto",trigger:"shot-start",
        assetId:null,sha256:null,title:null,localPath:null,reason:"No match"}]}:
      {projectId:"demo",shotId:"shot1",mode:"auto",trigger:"first-visual-reveal"};
    return {ok:true,json:async()=>payload};
  }));
  const user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="demo" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1"}],sound:[{shotId:"shot1",sfxIntent:"soft click"}]}}}/>);
  const timing=await screen.findByRole("combobox",{name:/sound timing/i});
  await user.selectOptions(timing,"first-visual-reveal");
  await waitFor(()=>expect(requests.some(x=>x.path==="set-choice"&&
    x.body?.mode==="auto"&&x.body?.trigger==="first-visual-reveal"&&
    x.body?.shotId==="shot1")).toBe(true));
});

it("does not offer visual-reveal timing for a bespoke scene without measured element states",async()=>{
  vi.stubGlobal("fetch",vi.fn(async (url:string)=>({ok:true,json:async()=>
    String(url).endsWith("library")?{assets:[]}:{scenes:[]}})));
  render(<SfxDiscoveryPanel projectId="demo" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1",sceneRecipe:"custom-scene-v1"}],
      sound:[{shotId:"shot1",sfxIntent:"whoosh"}]}}}/>);
  const choice=await screen.findByRole("option",{name:/first visible element reveal/i});
  expect(choice.hasAttribute("disabled")).toBe(true);
});

it("does not offer visual-reveal timing for dynamic flow-family scenes",async()=>{
  vi.stubGlobal("fetch",vi.fn(async (url:string)=>({ok:true,json:async()=>
    String(url).endsWith("library")?{assets:[]}:{scenes:[]}})));
  render(<SfxDiscoveryPanel projectId="demo" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1",family:"mechanism"}],
      sound:[{shotId:"shot1",sfxIntent:"electric pulse"}]}}}/>);
  const option=await screen.findByRole("option",{name:/first visible element reveal/i});
  expect(option.hasAttribute("disabled")).toBe(true);
});

it("adds a supplemental effect from the approved library with independent timing and envelope",async()=>{
  const sent:Array<Record<string,unknown>>=[];
  vi.stubGlobal("fetch",vi.fn(async (url:string,options?:RequestInit)=>{
    const path=String(url).split("/").at(-1)??"";
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:{};
    if(path==="sound-design"&&"action" in body&&body.action==="upsert")sent.push(body);
    const payload=path==="library"?{assets:[{assetId:"11111111-2222-3333-4444-555555555555",
      sha256:"a".repeat(64),title:"Soft mechanical click",rightsStatus:"user-reviewed",license:"cc0"}]}:
      path==="choices"?{scenes:[]}:
      path==="sound-design"&&body.action==="resolve"?{layers:[],ambience:null}:{};
    return {ok:true,json:async()=>payload};
  }));
  const user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="test" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1",family:"comparison"}],sound:[]}}}/>);
  await user.click(screen.getByText(/Additional sound cues/i));
  await user.selectOptions(await screen.findByRole("combobox",{name:"Additional cue asset"}),
    "11111111-2222-3333-4444-555555555555");
  await user.clear(screen.getByRole("spinbutton",{name:"Additional cue offset (ms)"}));
  await user.type(screen.getByRole("spinbutton",{name:"Additional cue offset (ms)"}),"250");
  await user.click(screen.getByRole("button",{name:"Add cue"}));
  await waitFor(()=>expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({action:"upsert",shotId:"shot1",offsetMs:250,gainDb:-24});
});

it("saves and disables one independent reviewed ambience bed",async()=>{
  const sent:Array<Record<string,unknown>>=[];
  let savedAmbience:Record<string,unknown>|null=null;
  vi.stubGlobal("fetch",vi.fn(async (url:string,options?:RequestInit)=>{
    const path=String(url).split("/").at(-1)??"";
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:{};
    if(path==="sound-design"&&body.action==="ambience"){
      sent.push(body);savedAmbience=body.assetId===null?null:{...body,title:"Wind room tone"};
    }
    const payload=path==="library"?{assets:[{assetId:"11111111-2222-3333-4444-555555555555",
      sha256:"a".repeat(64),title:"Wind room tone",rightsStatus:"user-reviewed",license:"cc0"}]}:
      path==="choices"?{scenes:[]}:
      path==="sound-design"&&body.action==="resolve"?{layers:[],ambience:savedAmbience}:{};
    return {ok:true,json:async()=>payload};
  }));
  const user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="test" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1",family:"comparison"}],sound:[]}}}/>);
  await user.click(screen.getByText(/Background ambience/i));
  await user.selectOptions(await screen.findByRole("combobox",{name:"Ambience asset"}),
    "11111111-2222-3333-4444-555555555555");
  await user.click(screen.getByRole("button",{name:"Save ambience"}));
  await waitFor(()=>expect(sent[0]).toMatchObject({action:"ambience",gainDb:-33}));
  await user.click(screen.getByRole("button",{name:"Disable ambience"}));
  await waitFor(()=>expect(sent[1]).toMatchObject({action:"ambience",assetId:null}));
});

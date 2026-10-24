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

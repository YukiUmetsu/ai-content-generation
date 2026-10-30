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
  await user.click(screen.getByText(/Background music \/ ambience/i));
  await user.selectOptions(await screen.findByRole("combobox",{name:"Music or ambience asset"}),
    "11111111-2222-3333-4444-555555555555");
  await user.click(screen.getByRole("button",{name:"Save ambience"}));
  await waitFor(()=>expect(sent[0]).toMatchObject({action:"ambience",gainDb:-33}));
  await user.click(screen.getByRole("button",{name:"Disable music"}));
  await waitFor(()=>expect(sent[1]).toMatchObject({action:"ambience",assetId:null}));
});

it("searches CC0 music by mood and imports only after explicit rights review",async()=>{
  const requests:Array<{path:string;body:Record<string,unknown>}> = [];
  const music={assetType:"music",assetId:"11111111-2222-3333-4444-555555555555",provider:"openverse",
    title:"Gentle piano",creator:"Composer",durationSeconds:65,license:"cc0",source:"wikimedia",
    sourceUrl:"https://commons.wikimedia.org/wiki/File:piano.ogg",previewUrl:"https://upload.wikimedia.org/piano.ogg",
    licenseUrl:"https://creativecommons.org/publicdomain/zero/1.0/",rightsStatus:"needs-human-review",tags:[],matchCount:2};
  vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
    const path=String(url).split("/").at(-1)??"";
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:{};
    requests.push({path,body});
    const payload=path==="library"?{assets:[]}:path==="choices"?{scenes:[]}:
      path==="sound-design"?{layers:[],ambience:null}:path==="suggest-music"?{candidates:[music]}:{};
    return {ok:true,json:async()=>payload};
  }));
  const user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="test" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1"}],sound:[]}}}/>);
  await user.click(screen.getByRole("tab",{name:/library/i}));
  await user.clear(screen.getByRole("searchbox",{name:"Music search"}));
  await user.type(screen.getByRole("searchbox",{name:"Music search"}),"soft piano ambient");
  await user.click(screen.getByRole("button",{name:/find background music/i}));
  await screen.findByText("Gentle piano");
  expect(requests.find(x=>x.path==="suggest-music")?.body).toMatchObject({
    query:"soft piano ambient",allowExternalSearch:true});
  await user.click(screen.getByRole("button",{name:"Review and import"}));
  expect(requests.some(x=>x.path==="approve")).toBe(false);
  await user.click(screen.getByRole("checkbox",{name:/I checked the original sound/i}));
  await user.click(screen.getByRole("button",{name:"Approve and save"}));
  await waitFor(()=>expect(requests.find(x=>x.path==="approve")?.body).toMatchObject({
    assetId:music.assetId,assetType:"music",confirmRights:true,confirmDownload:true}));
});

it("uses a reviewed music clip only as a quiet full-video background bed",async()=>{
  const sent:Array<Record<string,unknown>>=[];
  const music={assetId:"11111111-2222-3333-4444-555555555555",sha256:"a".repeat(64),
    title:"Calm guitar",assetType:"music",creator:"Creator",durationSeconds:60,
    rightsStatus:"user-reviewed",license:"cc0"};
  vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
    const path=String(url).split("/").at(-1)??"";
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:{};
    if(path==="sound-design"&&body.action==="ambience")sent.push(body);
    return {ok:true,json:async()=>path==="library"?{assets:[music]}:path==="choices"?{scenes:[]}:
      path==="sound-design"?{layers:[],ambience:null}: {}};
  }));
  const user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="test" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1"}],sound:[]}}}/>);
  await user.click(screen.getByRole("tab",{name:/library/i}));
  expect(await screen.findByText("Calm guitar")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Add to shot"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Use as background"}));
  await waitFor(()=>expect(sent[0]).toMatchObject({action:"ambience",assetId:music.assetId,
    sha256:music.sha256,gainDb:-33}));
});

it("identifies automatic music and lets editors mute or restore it without pinning the track",async()=>{
  const sent:Array<Record<string,unknown>>=[];
  let mode:"auto"|"off"="auto";
  const music={assetId:"11111111-2222-3333-4444-555555555555",sha256:"a".repeat(64),
    title:"Gentle ambient",assetType:"music",creator:"Composer",rightsStatus:"user-reviewed",license:"cc0"};
  vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
    const path=String(url).split("/").at(-1)??"";
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:{};
    if(path==="sound-design"&&body.action!=="resolve"){
      sent.push(body);mode=body.action==="auto-ambience"?"auto":"off";
    }
    const payload=path==="library"?{assets:[music]}:path==="choices"?{scenes:[]}:
      path==="sound-design"?{layers:[],ambience:mode==="auto"?{...music,gainDb:-34,fadeInMs:1200,fadeOutMs:1500}:null,
        ambienceMode:mode}:{};
    return {ok:true,json:async()=>payload};
  }));
  const user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="test" selectedShotId="shot1"
    bundle={{plan:{shots:[{id:"shot1"}],sound:[]}}}/>);
  await user.click(screen.getByText(/Background music \/ ambience/i));
  expect(await screen.findByText(/Automatically selected:/i)).toHaveTextContent("Gentle ambient");
  await user.click(screen.getByRole("button",{name:"Disable music"}));
  await waitFor(()=>expect(sent[0]).toMatchObject({action:"ambience",projectId:"test",assetId:null}));
  expect(await screen.findByText(/Music is off/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Use automatic music"}));
  await waitFor(()=>expect(sent[1]).toMatchObject({action:"auto-ambience",projectId:"test"}));
  expect(await screen.findByText(/Automatically selected:/i)).toHaveTextContent("Gentle ambient");
});

it("makes the selected shot and Arrange/Library workflow independently navigable",async()=>{
  vi.stubGlobal("fetch",vi.fn(async (url:string)=>({ok:true,json:async()=>
    String(url).endsWith("library")?{assets:[]}:
      String(url).endsWith("choices")?{scenes:[]}:{layers:[],ambience:null}})));
  const selectShot=vi.fn(),user=userEvent.setup();
  render(<SfxDiscoveryPanel projectId="demo" selectedShotId="shot1" onSelectShot={selectShot}
    bundle={{plan:{shots:[{id:"shot1"},{id:"shot2"}],sound:[]}}}/>);
  expect(await screen.findByText(/Scene 01/i)).toBeInTheDocument();
  expect(screen.getByRole("tab",{name:/arrange/i})).toHaveAttribute("aria-selected","true");
  await user.click(screen.getByRole("button",{name:/select scene 2/i}));
  expect(selectShot).toHaveBeenCalledWith("shot2");
  await user.click(screen.getByRole("tab",{name:/library/i}));
  expect(screen.getByRole("tab",{name:/library/i})).toHaveAttribute("aria-selected","true");
  expect(screen.getByRole("button",{name:/find cc0 sound effects/i})).toBeInTheDocument();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab",{name:/arrange/i})).toHaveAttribute("aria-selected","true");
});

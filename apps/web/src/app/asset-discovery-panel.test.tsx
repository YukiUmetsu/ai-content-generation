import {afterEach,expect,it,vi} from "vitest";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {AssetDiscoveryPanel} from "./asset-discovery-panel";

const productionId="production-"+"e".repeat(24);
const bundle={plan:{shots:[{id:"scene-1",purpose:"Show a home",visualChange:"Show the front porch",
  onScreenText:"Home expenses"}]}};
const suggestions={scenes:[{shotId:"scene-1",query:"front porch",strategy:"search",reason:"Physical subject",
  recommendedAssetKey:"pexels:photo:42",shotDuration:{seconds:7,source:"estimated"},
  candidates:[{provider:"pexels",assetId:"42",assetType:"photo",title:"Residential porch",
    sourceUrl:"https://www.pexels.com/photo/porch-42",previewUrl:"",license:"Pexels License",
    licenseUrl:"https://www.pexels.com/license/",creator:"Test Artist",
    match:{grade:"review",score:4,reasons:["Related subject"]}}]}],warnings:[]};

afterEach(()=>vi.unstubAllGlobals());

function mockFetch(saved:{found:boolean;sourceShots?:unknown;sourceSound?:unknown;suggestions?:unknown}){
  const paths:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    const path=String(url);paths.push(path);
    const data=path.includes("/suggestions/")?saved:
      path.includes("/approved?")?{assets:[]}:{selections:[],invalidShots:[]};
    return {ok:true,json:async()=>data};
  }));
  return paths;
}

it("restores auto-searched scene media without downloading or selecting it",async()=>{
  const paths=mockFetch({found:true,sourceShots:bundle.plan.shots,sourceSound:[],suggestions});
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1" productionId={productionId}/>);
  expect(await screen.findByText("Residential porch")).toBeInTheDocument();
  expect(screen.getByText(/Draft media suggestions loaded/)).toBeInTheDocument();
  expect(screen.getByRole("link",{name:/View original/})).toHaveAttribute("href",suggestions.scenes[0].candidates[0].sourceUrl);
  expect(screen.queryByRole("button",{name:"Review before import"})).not.toBeInTheDocument();
  expect(screen.getByText(/Pexels API search is retired/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Import downloaded Pexels file"})).toBeDisabled();
  expect(paths.some(path=>path.includes("/suggestions/"+productionId))).toBe(true);
  expect(paths.every(path=>!path.endsWith("/approve")&&!path.endsWith("/select"))).toBe(true);
});

it("imports a website-downloaded Pexels file with explicit source and rights without any API key",async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const saved={shotId:"scene-1",provider:"pexels",assetType:"photo",assetId:"42",sha256:"a".repeat(64),
    title:"Residential porch",license:"Pexels License",sizeBytes:512,localPath:"/approved/photo.jpg"};
  let uploaded=false;
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    const path=String(url);calls.push({url:path,init});
    if(path.includes("/import-downloaded?")){uploaded=true;return {ok:true,json:async()=>({sha256:saved.sha256})};}
    return {ok:true,json:async()=>path.includes("/approved?")?{assets:uploaded?[saved]:[]}:
      {selections:[],invalidShots:[]}};
  }));
  const user=userEvent.setup();
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1"/>);
  await screen.findByText(/Add an image or video from Pexels/);
  await user.type(screen.getByLabelText("Pexels source page URL"),"https://www.pexels.com/photo/porch-42/");
  const file=new File([new Uint8Array(512)],"porch.jpg",{type:"image/jpeg"});
  await user.upload(screen.getByLabelText("Pexels downloaded file"),file);
  await user.click(screen.getByRole("checkbox",{name:/I reviewed this Pexels page/}));
  await user.click(screen.getByRole("button",{name:"Import downloaded Pexels file"}));
  await waitFor(()=>expect(calls.some(item=>item.url.includes("/import-downloaded?"))).toBe(true));
  const upload=calls.find(item=>item.url.includes("/import-downloaded?"))!;
  const url=new URL(upload.url,"http://127.0.0.1:5173");
  expect(url.searchParams.get("sourceUrl")).toBe("https://www.pexels.com/photo/porch-42/");
  expect(url.searchParams.get("shotId")).toBe("scene-1");
  expect(upload.init?.headers).toMatchObject({"Content-Type":"application/octet-stream"});
  expect(upload.init?.body).toBe(file);
  expect(await screen.findByText(/download verified, saved with its source/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Use in next draft"})).toBeEnabled();
});

it("downloads a single chosen Pexels photo page without submitting any API credential",async()=>{
  const calls:Array<{path:string;body?:string}>=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    const path=String(url);calls.push({path,body:typeof init?.body==="string"?init.body:undefined});
    return {ok:true,json:async()=>path.includes("/approved?")?{assets:[]}:
      path.endsWith("/import-from-page")?{assetId:"42",provider:"pexels"}:{selections:[],invalidShots:[]}};
  }));
  const user=userEvent.setup();
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1"/>);
  await user.type(screen.getByLabelText("Pexels source page URL"),"https://www.pexels.com/photo/porch-42/");
  await user.click(screen.getByRole("checkbox",{name:/I reviewed this Pexels page/}));
  await user.click(screen.getByRole("button",{name:"Download photo from Pexels page"}));
  await waitFor(()=>expect(calls.some(item=>item.path.endsWith("/import-from-page"))).toBe(true));
  const sent=calls.find(item=>item.path.endsWith("/import-from-page"))!;
  expect(sent.body).toContain("https://www.pexels.com/photo/porch-42/");
  expect(sent.body).not.toContain("apiKey");
});

it("shows Openverse CC0 search leads as references without offering an unsupported importer",async()=>{
  const openverse={...suggestions,scenes:[{...suggestions.scenes[0],recommendedAssetKey:null,
    candidates:[{...suggestions.scenes[0].candidates[0],provider:"openverse",
      assetId:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",title:"Front porch photo",
      sourceUrl:"https://example.org/front-porch",license:"CC0-1.0 (unverified index)",
      licenseUrl:"https://creativecommons.org/publicdomain/zero/1.0/"}]}]};
  const requests=mockFetch({found:true,sourceShots:bundle.plan.shots,sourceSound:[],suggestions:openverse});
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1" productionId={productionId}/>);
  expect(await screen.findByText("Front porch photo")).toBeInTheDocument();
  expect(screen.getByText(/Openverse indexes third-party CC0 claims/)).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Review before import"})).not.toBeInTheDocument();
  expect(screen.getByRole("link",{name:/View original/})).toHaveAttribute("href","https://example.org/front-porch");
  expect(requests.every(path=>!path.endsWith("/approve"))).toBe(true);
});

it("does not offer stale media suggestions after scene edits",async()=>{
  mockFetch({found:true,sourceShots:[{id:"scene-1",purpose:"Older scene"}],sourceSound:[],suggestions});
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1" productionId={productionId}/>);
  expect(await screen.findByText(/older scene plan/i)).toBeInTheDocument();
  expect(screen.queryByText("Residential porch")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Find assets for all scenes"})).toBeEnabled();
});

it("does not reuse media ranked for an older narration when scene IDs stayed the same",async()=>{
  mockFetch({found:true,sourceShots:bundle.plan.shots,
    sourceSound:[{shotId:"scene-1",narration:"An earlier explanation."}],suggestions});
  const revised={plan:{...bundle.plan,sound:[{shotId:"scene-1",narration:"A rewritten explanation about taxes."}]}};
  render(<AssetDiscoveryPanel bundle={revised} projectId="director-demo" selectedShotId="scene-1" productionId={productionId}/>);
  expect(await screen.findByText(/older scene plan/i)).toBeInTheDocument();
  expect(screen.queryByText("Residential porch")).not.toBeInTheDocument();
});

it("a manual refresh reports when no completed draft has stored media suggestions",async()=>{
  mockFetch({found:false});
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1" productionId={productionId}/>);
  await userEvent.setup().click(screen.getByRole("button",{name:"Load draft suggestions"}));
  await waitFor(()=>expect(screen.getByText(/No saved media suggestions yet/i)).toBeInTheDocument());
});

it("marks Pexels selections as usable in the next video and keeps unsupported models unselectable",async()=>{
  const selectedPhoto={shotId:"scene-1",provider:"pexels",assetType:"photo",assetId:"42",sha256:"a".repeat(64),
    rightsStatus:"user-reviewed",title:"Residential porch",license:"Pexels License",sizeBytes:1200,localPath:"/approved/photo.jpg"};
  const model={...selectedPhoto,provider:"polyhaven",assetType:"model",assetId:"building",sha256:"b".repeat(64),
    title:"A building model",license:"CC0-1.0",localPath:"/approved/building.gltf"};
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>String(url).includes("/approved?")?
    {assets:[selectedPhoto,model]}:String(url).includes("/selected?")?
    {selections:[selectedPhoto],invalidShots:[]}:{found:false}})));
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1"/>);
  expect(await screen.findByText("Residential porch",{selector:"strong"})).toBeInTheDocument();
  expect(screen.getByText(/included in the next draft video/i)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/3D models are not yet rendered/i})).toBeDisabled();
});

it("lets the editor position an individual pinned photo and persists only its focal point",async()=>{
  const selectedPhoto={shotId:"scene-1",provider:"pexels",assetType:"photo",assetId:"42",sha256:"a".repeat(64),
    rightsStatus:"user-reviewed",title:"Residential porch",license:"Pexels License",sizeBytes:1200,
    localPath:"/approved/photo.jpg"};
  const changes:unknown[]=[];
  let saved={...selectedPhoto,focalPoint:{x:.5,y:.5}};
  vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
    const path=String(url);
    if(path.endsWith("/select")){
      const body=JSON.parse(String(options?.body));changes.push(body);
      saved={...selectedPhoto,focalPoint:body.focalPoint};
    }
    const data=path.includes("/approved?")?{assets:[selectedPhoto]}:
      path.includes("/selected?")?{selections:[saved],invalidShots:[]}:{ok:true};
    return {ok:true,json:async()=>data};
  }));
  render(<AssetDiscoveryPanel bundle={bundle} projectId="director-demo" selectedShotId="scene-1"/>);
  const horizontal=await screen.findByLabelText("Image horizontal focus");
  fireEvent.change(horizontal,{target:{value:"20"}});
  fireEvent.change(screen.getByLabelText("Image vertical focus"),{target:{value:"75"}});
  await userEvent.setup().click(screen.getByRole("button",{name:"Save scene framing"}));
  await waitFor(()=>expect(changes).toHaveLength(1));
  expect(changes[0]).toMatchObject({projectId:"director-demo",shotId:"scene-1",assetId:"42",
    focalPoint:{x:.2,y:.75}});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Save scene framing"})).toBeDisabled());
  expect(screen.getByText(/only this scene.s framing needs a new render/i)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button",{name:"Center"}));
  expect(screen.getByLabelText("Image horizontal focus")).toHaveValue("50");
  expect(screen.getByRole("button",{name:"Save scene framing"})).toBeEnabled();
});

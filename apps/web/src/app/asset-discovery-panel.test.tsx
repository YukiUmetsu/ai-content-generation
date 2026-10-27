import {afterEach,expect,it,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
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
  expect(screen.getByRole("button",{name:"Review before import"})).toBeEnabled();
  expect(paths.some(path=>path.includes("/suggestions/"+productionId))).toBe(true);
  expect(paths.every(path=>!path.endsWith("/approve")&&!path.endsWith("/select"))).toBe(true);
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

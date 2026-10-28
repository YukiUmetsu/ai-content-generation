import {afterEach,expect,it,vi} from "vitest";
import {castEdits,castEqual,castFromBundle,loadSceneCast,validateSceneCast,writeSceneCast} from "./scene-cast-api";

afterEach(()=>vi.restoreAllMocks());
const source="a".repeat(64),project="production-"+"a".repeat(24);
const pip={id:"pip",role:"character" as const,provider:"fish" as const,voiceId:"b".repeat(32)};
const base={plan:{sound:[{shotId:"hook"},{shotId:"middle"},{shotId:"payoff"}]}};

it("stores only explicit scene voices, rejects forged IDs and applies server changes without touching narration",()=>{
  const cast=castFromBundle(project,source,{plan:{sound:[{shotId:"hook",speaker:pip},{shotId:"middle"}]}});
  expect(cast.assignments).toEqual([{shotId:"hook",speaker:pip}]);
  const swapped=castEdits({plan:{sound:[{shotId:"hook"},{shotId:"middle",speaker:pip}]}},cast);
  expect(swapped).toEqual([{shotId:"hook",speaker:pip},{shotId:"middle",speaker:null}]);
  expect(castEqual(cast,{...cast,assignments:[...cast.assignments].reverse()})).toBe(true);
  expect(castEdits(base,cast)).toEqual([{shotId:"hook",speaker:pip}]);
  expect(()=>castEdits({plan:{sound:[{shotId:"middle"}]}},cast)).toThrow(/absent from this source/i);
  expect(()=>validateSceneCast({...cast,assignments:[...cast.assignments,...cast.assignments]},project,source)).toThrow(/multiple saved/i);
  expect(()=>validateSceneCast({...cast,assignments:[{shotId:"hook",speaker:{...pip,apiKey:"secret"}}]},project,source)).toThrow(/malformed/i);
  expect(()=>validateSceneCast({...cast,assignments:[{shotId:"hook",speaker:{...pip,voiceId:"wrong"}}]},project,source)).toThrow(/invalid speaker/i);
});

it("loads a project/source-scoped server revision and only saves with an expected revision",async()=>{
  let saved:unknown=null,revision=0;
  const calls:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    calls.push(String(input));
    if(init?.method==="PUT"){
      const body=JSON.parse(String(init.body)) as {revision:number;cast:unknown};
      expect(init.headers).toEqual(expect.objectContaining({"X-Contentgen-Scene-Cast":"local-only"}));
      if(body.revision!==revision)return new Response(JSON.stringify({error:{message:"stale writer"}}),{status:409});
      saved=body.cast;revision++;
    }
    return new Response(JSON.stringify({revision,cast:saved}),{status:200});
  });
  const empty=await loadSceneCast(project,source);
  expect(empty).toEqual({revision:0,cast:null});
  const cast=castFromBundle(project,source,{plan:{sound:[{shotId:"hook",speaker:pip}]}});
  const updated=await writeSceneCast(project,source,empty.revision,cast);
  expect(updated.revision).toBe(1);
  expect((await loadSceneCast(project,source)).cast).toEqual(cast);
  await expect(writeSceneCast(project,source,0,cast)).rejects.toThrow(/stale writer/);
  expect(calls.every(path=>path.endsWith(`/api/scene-cast/${project}/${source}`))).toBe(true);
});

it("fails closed on unavailable storage, untrusted server data and invalid source identity",async()=>{
  vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(
    new Response(JSON.stringify({revision:1,cast:{schemaVersion:1,projectId:project,sourcePlanSha256:source,
      assignments:[{shotId:"hook",speaker:{...pip,voiceId:"not-a-fish-id"}}]}}),{status:200}));
  await expect(loadSceneCast(project,source)).rejects.toThrow(/Rust server/);
  await expect(loadSceneCast(project,source)).rejects.toThrow(/invalid speaker/);
  await expect(loadSceneCast(project,"other")).rejects.toThrow(/source revision/);
});

it("rejects fabricated revision-zero cast and revision-positive missing cast",async()=>{
  vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({revision:0,
    cast:castFromBundle(project,source,{plan:{sound:[{shotId:"hook",speaker:pip}]}})}),{status:200}))
    .mockResolvedValueOnce(new Response(JSON.stringify({revision:1,cast:null}),{status:200}));
  await expect(loadSceneCast(project,source)).rejects.toThrow(/revision is invalid/);
  await expect(loadSceneCast(project,source)).rejects.toThrow(/revision is invalid/);
});

import { afterEach, expect, it, vi } from "vitest";
import type { LocalProject } from "@/app/catalog-model";
import { streamProjectKeywords } from "./discovery";

afterEach(()=>vi.restoreAllMocks());

const project={id:"house",name:"House Math",notes:"Economics of homeownership"} as LocalProject;
const quality={modelRequests:1,batches:1,proposed:2,rejected:0,partial:true,evidence:"unverified"};

it("keeps active exclusions separate from topical keyword coverage in the request",async()=>{
  const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(
    JSON.stringify({type:"done",quality})+"\n",{
      status:200,headers:{"Content-Type":"application/x-ndjson"},
    }));
  await streamProjectKeywords(project,["property tax assessment"],{
    excludedKeywords:["property tax myths"],onBatch:()=>{},
  });
  const init=fetchMock.mock.calls[0][1];
  expect(JSON.parse(String(init?.body))).toEqual({
    name:"House Math",description:"Economics of homeownership",
    keywords:["property tax assessment"],excludedKeywords:["property tax myths"],
  });
});

it("delivers each small keyword batch even when NDJSON crosses UTF-8 chunk boundaries",async()=>{
  const first={type:"batch",suggestions:[{text:"住宅保険の更新費用",kind:"topic",rationale:"Insurance renewal"}],
    quality,step:1,totalSteps:6};
  const next={type:"batch",suggestions:[{text:"Property tax reassessments",kind:"topic",rationale:"After buying a home"}],
    quality:{...quality,modelRequests:2,batches:2},step:2,totalSteps:6};
  const bytes=new TextEncoder().encode(`${JSON.stringify(first)}\n${JSON.stringify(next)}\n${JSON.stringify({type:"done",quality:next.quality})}\n`);
  const received:unknown[]=[];
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(new ReadableStream({start(controller){
    controller.enqueue(bytes.slice(0,49));controller.enqueue(bytes.slice(49,57));
    controller.enqueue(bytes.slice(57,193));controller.enqueue(bytes.slice(193));controller.close();
  }}),{status:200,headers:{"Content-Type":"application/x-ndjson"}}));
  const result=await streamProjectKeywords(project,[],{onBatch:event=>received.push(event)});
  expect(received).toHaveLength(2);
  expect((received[0] as typeof first).suggestions[0].text).toBe("住宅保険の更新費用");
  expect(result.modelRequests).toBe(2);
});

it("keeps delivered batches but reports a truncated keyword stream as an error",async()=>{
  const seen:string[]=[];
  const payload=JSON.stringify({type:"batch",suggestions:[{text:"Roof replacement estimate",kind:"topic",rationale:"Budgeting"}],
    quality,step:1,totalSteps:6})+"\n";
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(payload));controller.close();
  }}),{status:200,headers:{"Content-Type":"application/x-ndjson"}}));
  await expect(streamProjectKeywords(project,[],{onBatch:event=>seen.push(...event.suggestions.map(item=>item.text))}))
    .rejects.toThrow(/incomplete|ended/i);
  expect(seen).toEqual(["Roof replacement estimate"]);
});

it("preserves earlier suggestions when a later model batch explicitly fails",async()=>{
  const seen:string[]=[];
  const payload=[
    {type:"batch",suggestions:[{text:"Roof replacement estimate",kind:"topic",rationale:"Budgeting"}],
      quality,step:1,totalSteps:6},
    {type:"error",message:"Local AI unavailable after the first batch."},
  ].map(value=>JSON.stringify(value)).join("\n")+"\n";
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(payload));controller.close();
  }}),{status:200,headers:{"Content-Type":"application/x-ndjson"}}));
  await expect(streamProjectKeywords(project,[],{onBatch:event=>seen.push(...event.suggestions.map(item=>item.text))}))
    .rejects.toThrow("Local AI unavailable after the first batch.");
  expect(seen).toEqual(["Roof replacement estimate"]);
});

it("rejects a malformed later frame without losing the first verified suggestion",async()=>{
  const seen:string[]=[];
  const payload=JSON.stringify({type:"batch",suggestions:[{text:"Property tax increase",kind:"query",rationale:"Ownership costs"}],
    quality,step:1,totalSteps:6})+"\n{this is not JSON}\n";
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(payload));controller.close();
  }}),{status:200,headers:{"Content-Type":"application/x-ndjson"}}));
  await expect(streamProjectKeywords(project,[],{onBatch:event=>seen.push(...event.suggestions.map(item=>item.text))}))
    .rejects.toThrow("Invalid local keyword progress data.");
  expect(seen).toEqual(["Property tax increase"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { captureSavedSources, buildDeterministicDossier, selectEvidenceForScene } from "./research-job-evidence.mjs";

const brief={title:"Heat pump lifetime costs",viewerQuestion:"Why are heat pump installation costs high?",audience:"Homeowners",locale:"en-US"};
const search={results:[
  {title:"Energy savings",url:"https://energy.example.org/guide",snippet:"Energy savings"},
  {title:"Unreachable",url:"https://failed.example.org/page",snippet:"No capture"},
]};
const article="Heat pump installation cost varies with equipment size, ductwork condition, and local labor rates. A home with inadequate ductwork may require additional labor before the new equipment can operate efficiently. Equipment purchase price is only one portion of the overall installation cost.";

test("capture saves only successfully fetched public pages and records gaps",async()=>{
  const result=await captureSavedSources(search,brief,{maxSources:2,fetchPage:async url=>{
    if(url.includes("failed."))throw Error("permission denied");
    return {type:"text/html",html:`<main><p>${article}</p></main>`};
  },now:()=>new Date("2026-10-23T00:00:00.000Z")});
  assert.equal(result.captures.length,1);
  assert.equal(result.captures[0].url,"https://energy.example.org/guide");
  assert.equal(result.captures[0].text,article);
  assert.equal(result.gaps.length,1);
  assert.match(result.gaps[0],/failed\.example\.org/);
});

test("deterministic research keeps exact quotes and marks claims unverified",()=>{
  const captures=[{id:"source_01",url:"https://energy.example.org/guide",title:"Energy savings",retrievedAt:"2026-10-23T00:00:00.000Z",text:article}];
  const result=buildDeterministicDossier(brief,captures,[]);
  assert.ok(result.dossier.claims.length>0);
  assert.equal(result.dossier.claims[0].status,"unverified");
  for(const quote of result.quotes){
    assert.ok(article.includes(quote.quote));
    assert.ok(result.dossier.claims.some(claim=>claim.id===quote.claimId));
  }
  assert.deepEqual(selectEvidenceForScene(result.dossier,result.quotes,[result.dossier.claims[0].id]).map(x=>x.claimId),[result.dossier.claims[0].id]);
  assert.deepEqual(buildDeterministicDossier(brief,captures,[]).quotes,result.quotes);
});

test("no relevant captured passages never become fabricated citations",()=>{
  const unrelated=[{id:"source_01",url:"https://energy.example.org/guide",title:"Bird species",retrievedAt:"2026-10-23T00:00:00.000Z",text:"Songbirds migrate through this region during spring. Migratory birds often follow rivers and seek sheltered habitats. Their wings allow travel across long distances."}];
  assert.throws(()=>buildDeterministicDossier(brief,unrelated,[]),/no relevant source excerpts/i);
});

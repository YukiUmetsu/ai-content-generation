import test from "node:test";
import assert from "node:assert/strict";
import {captureSavedSources,buildDeterministicDossier,selectEvidenceForScene} from "./research-job-evidence.mjs";

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

const capture=(text)=>[{id:"source_01",url:"https://energy.example.org/guide",title:"Guide",text,
  retrievedAt:"2026-10-23T00:00:00.000Z"}];

test("Japanese research captures a relevant unspaced sentence as verbatim evidence",()=>{
  const brief={title:"家庭用蓄電池の寿命",viewerQuestion:"蓄電池はどうして劣化するのでしょうか",audience:"一般家庭",locale:"ja-JP"};
  const text="家庭に設置した蓄電池は高温や充電と放電を繰り返す影響で性能が低下していきます。適切な温度管理と充電条件の調整は長期使用に重要とされています。";
  const result=buildDeterministicDossier(brief,capture(text));
  assert.ok(result.dossier.claims.length>=1);
  assert.ok(result.quotes.every(quote=>text.includes(quote.quote)));
});

test("Japanese short substantive quote is retained and unrelated page is excluded",()=>{
  const brief={title:"蓄電池の劣化",viewerQuestion:"なぜ蓄電池が劣化するのか",audience:"家庭向け",locale:"ja-JP"};
  const captures=[...capture("蓄電池は充放電で劣化します。"),
    {id:"source_02",url:"https://gardens.example.org/flowers",title:"Flowers",text:"庭の花々が春に咲きます。",retrievedAt:"2026-10-23T00:00:00.000Z"}];
  const result=buildDeterministicDossier(brief,captures);
  assert.ok(result.quotes.some(quote=>quote.quote==="蓄電池は充放電で劣化します。"));
  assert.ok(result.quotes.every(quote=>quote.sourceId==="source_01"));
});

test("Japanese katakana topic with long-vowel marks matches captured excerpts",()=>{
  const brief={title:"コーヒーのいれかた",viewerQuestion:"コーヒーはどうやっていれるのでしょうか",audience:"初心者",locale:"ja-JP"};
  const text="コーヒーは温度によって風味が変わります。コーヒーをゆっくり抽出すると香りを楽しめます。";
  const result=buildDeterministicDossier(brief,capture(text));
  assert.ok(result.quotes.length>0);
  assert.ok(result.quotes.every(quote=>text.includes(quote.quote)));
});

test("Japanese hiragana-only topic is not lost in word segmentation",()=>{
  const brief={title:"さくらのさきかた",viewerQuestion:"さくらはいつさくのでしょうか",audience:"初心者",locale:"ja-JP"};
  const text="さくらは春になると花を咲かせます。さくらの花は暖かい日に開きはじめます。";
  const result=buildDeterministicDossier(brief,capture(text));
  assert.ok(result.quotes.length>0);
  assert.ok(result.quotes.every(quote=>text.includes(quote.quote)));
});

test("English relevance does not accept a source unrelated to its question",()=>{
  const brief={title:"Heat pump installation",viewerQuestion:"Why does heat pump installation need labor?",audience:"Homeowners",locale:"en-US"};
  assert.throws(()=>buildDeterministicDossier(brief,capture("The spring garden has blooming flowers and butterflies. The weather is lovely in the park.")),/No relevant source excerpts/i);
});

test("generic Japanese location overlap does not turn unrelated cuisine into battery evidence",()=>{
  const brief={title:"日本の蓄電池価格",viewerQuestion:"日本で蓄電池はいくらかかるのでしょうか",audience:"家庭向け",locale:"ja-JP"};
  const text="日本の伝統料理は地域ごとに多彩です。季節の野菜を使った献立は家庭の食卓で親しまれています。";
  assert.throws(()=>buildDeterministicDossier(brief,capture(text)),/No relevant source excerpts/i);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateEditorialVariants, validateEditorialPrompt } from "./editorial-variants.mjs";

const input = {topic:"heat pump vs furnace",audience:"homeowners",viewerQuestion:"Which makes sense for my house?",payoff:"Compare total ownership costs",reviewNotes:"Verify local price assumptions"};

describe("editorial AI variations", () => {
  it("only accepts creator-authored context (never API observations)", () => {
    assert.deepEqual(validateEditorialPrompt(input),input);
    assert.throws(() => validateEditorialPrompt({...input, viewCount:1_000_000}),/Unexpected/);
    assert.throws(() => validateEditorialPrompt({...input, sourceUrl:"https://youtube.com"}),/Unexpected/);
  });

  it("returns three validated approaches using only a configured loopback model", async () => {
    let request;
    const result = await generateEditorialVariants(input, {
      modelSettings: {model:"local-model",endpoint:"http://127.0.0.1:11434/v1/chat/completions"},
      transport: async (url, options) => {
        request={url,options};
        return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({variants:[
          {strategy:"Audience",title:"How to compare heat pumps",hook:"Homeowners: which heating system fits?",firstVisual:"Split two houses and show cost factors one by one",onScreenText:"Heating choice",thumbnail:"House split diagram",sfxIntent:"Soft tick",payoffConnection:"Compare full ownership costs"},
          {strategy:"Process",title:"The heating system decision",hook:"Watch the heating decision unfold",firstVisual:"Reveal the pipeline step by step",onScreenText:"How it works",thumbnail:"Pipeline illustration",sfxIntent:"",payoffConnection:"Evaluate the whole process"},
          {strategy:"Comparison",title:"Two ways to heat a home",hook:"Two options for one real household question",firstVisual:"Move two panels into comparison",onScreenText:"Compare options",thumbnail:"Side-by-side options",sfxIntent:"Quiet impact",payoffConnection:"Choose based on total costs"}
        ]})}}]})};
      },
    });
    assert.equal(result.length,3);
    assert.deepEqual(result.map(v=>v.id),["direct","process","comparison"]);
    assert.equal(request.url,"http://127.0.0.1:11434/v1/chat/completions");
    const messages=JSON.parse(request.options.body).messages;
    assert.equal(messages[1].content.includes("viewCount"),false);
    assert.match(messages[0].content,/curiosity/i);
  });

  it("rejects model output inventing numbers beyond the creator prompt", async () => {
    await assert.rejects(() => generateEditorialVariants(input,{
      modelSettings:{model:"local-model",endpoint:"http://127.0.0.1:11434/v1/chat/completions"},
      transport:async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({variants:Array.from({length:3},(_,i)=>({strategy:"strategy "+i,title:"Invented $90,000 figure "+i,hook:"A specific question?",firstVisual:"Reveal a label",onScreenText:"The cost",thumbnail:"Two options",sfxIntent:"",payoffConnection:"Answer the question"}))})}}]})}),
    }),/unprovided numerical claim/i);
  });
});

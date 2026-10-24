import test from "node:test";
import assert from "node:assert/strict";
import {generateOutline,generateOutlineSkeleton,generateOutlineBeat,assembleOutline,generateSceneUnit,generateSceneStructure,generateSceneCore,generateSceneStates,assembleSceneStructure,generateSceneVisual,generateSceneDirection,generateSceneElements,assembleSceneVisual,generateSceneNarration,assembleSceneUnit,assembleResumablePlan,RESEARCH_MODEL_LIMITS} from "./research-job-planner.mjs";
import {parsePreproductionPlan} from "./preproduction.mjs";

const dossier={schemaVersion:1,kind:"research-dossier",id:"research_abc123",topic:{title:"Heat pump costs",viewerQuestion:"Why do installations cost so much?",audience:"Homeowners",locale:"en-US"},evidence:[{id:"source_01",title:"Energy guide",sourceUri:"https://energy.example.org/guide",retrievedAt:"2026-10-23T00:00:00.000Z",passageLocator:"captured-text:[0,82)",snapshotSha256:"a".repeat(64)}],claims:[{id:"claim_01",text:"Installation requires equipment and labor.",status:"unverified",sourceRefs:["source_01"]}],assets:[],gaps:[],review:{status:"draft"}};
const quotes=[{claimId:"claim_01",sourceId:"source_01",quote:"Installation requires equipment and labor."}];
const outline={pattern:"cost-dissection",premise:"Why cost differs from sticker price",hook:"Why is installation expensive?",beats:[{question:"What is being paid for?",claimIds:["claim_01"],purpose:"Reveal cost components",payoff:"Equipment and labor both matter"},{question:"Why can labor change?",claimIds:["claim_01"],purpose:"Explain the installation job",payoff:"Installation includes work beyond the unit"}]};
const unit=(kind)=>({subject:"Installation work",before:"Unit price shown alone",action:"Reveal equipment and labor components",after:"Total includes equipment and labor",parts:["Equipment","Labor"],operator:"split",phases:[
  {visualAction:"Show the price label hiding its parts",learningChange:"Viewers see that the price is incomplete",onScreenText:"The sticker price",narration:"The unit has a sticker price, but that is only part of the cost.",visualElements:[{label:"Price label",detail:"Shows the advertised unit cost"},{label:"Covered breakdown",detail:"Additional components are initially hidden"}]},
  {visualAction:"Split the installation into equipment and labor",learningChange:"Viewers learn the two cost categories",onScreenText:"What the bill includes",narration:"Equipment and labor both contribute to installation.",visualElements:[{label:"Equipment",detail:"The physical heat pump hardware"},{label:"Labor",detail:"The work required for installation"}]},
  {visualAction:"Bring both categories together into the final cost",learningChange:"Viewers understand the combined bill",onScreenText:kind,narration:"The final cost combines the unit and installation work.",visualElements:[{label:"Equipment cost",detail:"Hardware portion of the bill"},{label:"Labor cost",detail:"Installation work portion of the bill"}]},
]});
const settings={model:"small-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};
const transportFor=body=>async (_endpoint,options)=>{
  const sent=JSON.parse(options.body);
  assert.ok(sent.max_tokens>0&&sent.max_tokens<=4096);
  assert.ok(options.signal);
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(body)}}]})};
};

test("short outline request validates known claim IDs",async()=>{
  const result=await generateOutline(dossier,quotes,settings,{transport:transportFor(outline)});
  assert.equal(result.beats.length,2);
  await assert.rejects(generateOutline(dossier,quotes,settings,{transport:transportFor({...outline,beats:[{...outline.beats[0],claimIds:["invented_claim"]},outline.beats[1]]})}),/claim/i);
});

test("scene task only needs its beat, and assembled plan passes full contract",async()=>{
  const first=await generateSceneUnit(outline,0,dossier,quotes,settings,{transport:transportFor(unit("Price = equipment + labor"))});
  const second=await generateSceneUnit(outline,1,dossier,quotes,settings,{transport:transportFor(unit("Installation work matters"))});
  const plan=assembleResumablePlan(dossier,outline,[first,second]);
  assert.equal(plan.shots.length,6);
  assert.equal(plan.teachingSequences.length,2);
  assert.equal(parsePreproductionPlan(plan,dossier).ok,true);
  assert.equal(plan.shots[0].purpose,"hook");
  assert.equal(plan.shots.at(-1).purpose,"answer");
});

test("invalid scene output cannot invent unapproved quantities or empty visuals",async()=>{
  await assert.rejects(generateSceneUnit(outline,0,dossier,quotes,settings,{transport:transportFor({...unit("The cost"),parts:["$5,000","Labor"]})}),/parts|quantity/i);
  await assert.rejects(generateSceneUnit(outline,0,dossier,quotes,settings,{transport:transportFor({...unit("The cost"),phases:unit("The cost").phases.map(x=>({...x,visualElements:[]}))})}),/visual|visible/i);
});

test("oversized streaming model output is stopped before consuming the whole response",async()=>{
  let reads=0,cancelled=false;
  const transport=async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array(64000)};},
    cancel:async()=>{cancelled=true;},releaseLock:()=>{},
  })}});
  await assert.rejects(generateOutline(dossier,quotes,settings,{transport}),/oversized|exceeds/i);
  assert.ok(reads<=3);
  assert.equal(cancelled,true);
});

test("local model fenced JSON is recovered without changing the content",async()=>{
  const transport=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
    finish_reason:"stop",message:{content:"```json\n"+JSON.stringify(outline)+"\n```"}}]})});
  assert.equal((await generateOutline(dossier,quotes,settings,{transport})).beats.length,2);
});

test("safe trailing-comma repair preserves commas inside quoted text",async()=>{
  const malformed=JSON.stringify({...outline,premise:"Hardware, labor, and permits matter"})
    .replace('"payoff":"Installation includes work beyond the unit"}',
      '"payoff":"Installation includes work beyond the unit",}')
    .replace('}]}','},]}');
  const transport=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
    finish_reason:"stop",message:{content:malformed}}]})});
  const result=await generateOutline(dossier,quotes,settings,{transport});
  assert.equal(result.premise,"Hardware, labor, and permits matter");
  assert.equal(result.beats.length,2);
});

test("truncated model output exposes safe finish reason without leaking generated text",async()=>{
  const transport=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
    finish_reason:"length",message:{content:'{"private":"secret passage"'}}]})});
  await assert.rejects(generateOutline(dossier,quotes,settings,{transport}),error=>{
    assert.equal(error.code,"output_truncated");
    assert.equal(error.field,"response");
    assert.doesNotMatch(error.message,/secret passage/);
    return true;
  });
});

test("outline and scene requests use generous fixed budgets, including after truncation",async()=>{
  const budgets=[];
  const transport=async(_endpoint,options)=>{
    const sent=JSON.parse(options.body);budgets.push(sent.max_tokens);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:"stop",message:{content:JSON.stringify(budgets.length<=2?outline:unit("Complete cost"))}}]})};
  };
  await generateOutline(dossier,quotes,settings,{transport});
  await generateOutline(dossier,quotes,settings,{transport,feedback:"The previous JSON was cut off at the output limit."});
  await generateSceneUnit(outline,0,dossier,quotes,settings,{transport,feedback:"The previous JSON was cut off at the output limit."});
  assert.deepEqual(budgets,[2048,2048,4096]);
  assert.equal(RESEARCH_MODEL_LIMITS.timeoutMs,240000);
});

test("saved generation settings override defaults for each research model request",async()=>{
  const budgets=[];
  const generation={outlineTokens:1024,sceneTokens:3072,timeoutSeconds:360};
  const transport=async(_endpoint,options)=>{
    budgets.push(JSON.parse(options.body).max_tokens);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(budgets.length===1?outline:unit("Complete cost"))}}]})};
  };
  await generateOutline(dossier,quotes,{...settings,generation},{transport});
  await generateSceneUnit(outline,0,dossier,quotes,{...settings,generation},{transport});
  assert.deepEqual(budgets,[1024,3072]);
});

test("scene request asks a small model for concise JSON fields",async()=>{
  let system="";
  const transport=async(_endpoint,options)=>{
    system=JSON.parse(options.body).messages[0].content;
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      message:{content:JSON.stringify(unit("Complete cost"))}}]})};
  };
  await generateSceneUnit(outline,0,dossier,quotes,settings,{transport});
  assert.match(system,/short narration|concise narration/i);
  assert.match(system,/exactly 2 visual elements/i);
});

test("schema errors identify the invalid field with no source text",async()=>{
  await assert.rejects(generateSceneUnit(outline,0,dossier,quotes,settings,{
    transport:transportFor({...unit("The cost"),phases:unit("The cost").phases.map((phase,i)=>i===1?{...phase,visualElements:[]}:phase)})
  }),error=>{
    assert.equal(error.code,"schema_invalid");
    assert.equal(error.field,"phases[1].visualElements");
    assert.doesNotMatch(error.message,/Installation requires equipment/);
    return true;
  });
});

test("small model generates scene structure, independent visuals and narrations without a full-scene response",async()=>{
  const original=unit("Installation cost components");
  const {phases,...structure}=original;
  const requests=[];
  const responses=[structure,...phases.flatMap(phase=>{
    const {narration,...visual}=phase;
    return [visual,{narration}];
  })];
  let index=0;
  const customSettings={...settings,generation:{outlineTokens:1024,sceneTokens:1536,timeoutSeconds:360}};
  const transport=async(_url,options)=>{
    const payload=JSON.parse(options.body);
    requests.push(payload);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(responses[index++])}}]})};
  };
  const main=await generateSceneStructure(outline,0,dossier,quotes,customSettings,{transport});
  const results=[];
  for(let phase=0;phase<3;phase++){
    const visual=await generateSceneVisual(outline,0,phase,main,results.map(p=>p.visual),dossier,quotes,customSettings,{transport});
    const narration=await generateSceneNarration(outline,0,phase,main,visual,dossier,quotes,customSettings,{transport});
    results.push({visual,narration});
  }
  const rebuilt=assembleSceneUnit(main,results);
  assert.deepEqual(rebuilt,original);
  assert.equal(assembleResumablePlan(dossier,outline,[rebuilt,rebuilt]).shots.length,6);
  assert.equal(requests.length,7);
  assert.ok(requests.every(request=>request.max_tokens===1536));
  assert.ok(requests.every(request=>request.messages[1].content.length<5000));
  assert.ok(requests.slice(2).filter((_request,i)=>i%2===0).every(request=>/narration/i.test(request.messages[0].content)&&!/visualElements:\[/i.test(request.messages[0].content)));
});

test("independent visual generation reports truncation and rejects repeated phase actions",async()=>{
  const original=unit("Complete bill");
  const {phases,...structure}=original;
  const visual={...phases[0]};delete visual.narration;
  const truncated=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{finish_reason:"length",message:{content:'{"untrusted":"secret"'}}]})});
  await assert.rejects(generateSceneVisual(outline,0,0,structure,[],dossier,quotes,settings,{transport:truncated}),error=>{
    assert.equal(error.code,"output_truncated");
    assert.doesNotMatch(error.message,/secret/);
    return true;
  });
  await assert.rejects(generateSceneVisual(outline,0,1,structure,[visual],dossier,quotes,settings,{transport:transportFor(visual)}),error=>{
    assert.equal(error.code,"schema_invalid");
    assert.equal(error.field,"visualAction");
    return true;
  });
});

test("a truncated subtask is retried with a stricter, smaller JSON text budget",async()=>{
  const original=unit("Full cost");
  const {phases,...structure}=original;
  const answer={...phases[0]};delete answer.narration;
  const systems=[];
  const transport=async(_url,options)=>{
    systems.push(JSON.parse(options.body).messages[0].content);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]})};
  };
  await generateSceneVisual(outline,0,0,structure,[],dossier,quotes,settings,{transport});
  await generateSceneVisual(outline,0,0,structure,[],dossier,quotes,settings,{
    transport,feedback:"The previous JSON was cut off at the output limit. Keep every required field but use shorter text."});
  assert.notEqual(systems[0],systems[1]);
  assert.match(systems[1],/compact|shorter|minimum/i);
  assert.match(systems[1],/visualElements/i);
});

test("Qwen-specific no-thinking hint is not sent to unrelated local models",async()=>{
  const original=unit("Full cost");
  const {phases,...structure}=original;
  const systems=[];
  const transport=async(_url,options)=>{
    systems.push(JSON.parse(options.body).messages[0].content);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(structure)}}]})};
  };
  await generateSceneStructure(outline,0,dossier,quotes,settings,{transport});
  await generateSceneStructure(outline,0,dossier,quotes,{...settings,model:"qwen3.5:9b"},{transport});
  assert.doesNotMatch(systems[0],/\/no_think/u);
  assert.match(systems[1],/\/no_think/u);
});

test("outline truncation retry narrows output to two short beats and discourages Qwen thinking",async()=>{
  const prompts=[];
  const transport=async(_url,options)=>{
    prompts.push(JSON.parse(options.body).messages[0].content);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(outline)}}]})};
  };
  const qwen={...settings,model:"Qwen3.5 9B (Q4)"};
  await generateOutline(dossier,quotes,qwen,{transport});
  await generateOutline(dossier,quotes,qwen,{transport,feedback:"The previous JSON was cut off at the output limit. Keep every required field but use shorter text."});
  assert.match(prompts[0],/\/no_think/u);
  assert.match(prompts[1],/exactly (?:2|two) (?:short|concise) beats/i);
  assert.doesNotMatch(prompts[0],/exactly (?:2|two) (?:short|concise) beats/i);
});

test("small local outline jobs assemble source-backed story without any full outline response",async()=>{
  const {beats,...skeletonFields}=outline;
  const responses=[{...skeletonFields,beatCount:2},...beats];
  const requests=[];
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    requests.push(request);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:"stop",message:{content:JSON.stringify(responses[requests.length-1])}}]})};
  };
  const limits={outlineTokens:1280,sceneTokens:2048,timeoutSeconds:360};
  const withLimits={...settings,generation:limits};
  const skeleton=await generateOutlineSkeleton(dossier,quotes,withLimits,{transport});
  const results=[];
  for(let index=0;index<skeleton.beatCount;index++){
    results.push(await generateOutlineBeat(skeleton,index,results,dossier,quotes,withLimits,{transport}));
  }
  assert.deepEqual(assembleOutline(dossier,skeleton,results),outline);
  assert.equal(requests.length,3);
  assert.ok(requests.every(request=>request.max_tokens===1280));
  assert.ok(requests.every(request=>request.messages[1].content.length<4500));
});

test("one-at-a-time outline beats reject invented claims and repeated questions",async()=>{
  const skeleton={pattern:outline.pattern,premise:outline.premise,hook:outline.hook,beatCount:2};
  await assert.rejects(generateOutlineBeat(skeleton,0,[],dossier,quotes,settings,{
    transport:transportFor({...outline.beats[0],claimIds:["invented_claim"]})
  }),error=>error.code==="schema_invalid"&&error.field==="claimIds");
  await assert.rejects(generateOutlineBeat(skeleton,1,[outline.beats[0]],dossier,quotes,settings,{
    transport:transportFor({...outline.beats[1],question:outline.beats[0].question})
  }),error=>error.code==="schema_invalid"&&error.field==="question");
});

test("scene structure is assembled from two tiny, independently sourced JSON answers",async()=>{
  const {phases,...expected}=unit("Complete installed cost");
  const {before,action,after,...coreExpected}=expected;
  const replies=[coreExpected,{before,action,after}];
  const prompts=[];
  let count=0;
  const transport=async(_url,options)=>{
    const body=JSON.parse(options.body);
    prompts.push(body);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:"stop",message:{content:JSON.stringify(replies[count++])}}]})};
  };
  const configured={...settings,generation:{outlineTokens:1024,sceneTokens:1800,timeoutSeconds:420}};
  const core=await generateSceneCore(outline,0,dossier,quotes,configured,{transport});
  const states=await generateSceneStates(outline,0,core,dossier,quotes,configured,{transport});
  assert.deepEqual(assembleSceneStructure(core,states),expected);
  assert.equal(prompts.length,2);
  assert.ok(prompts.every(prompt=>prompt.max_tokens===1800));
  assert.ok(prompts.every(prompt=>!prompt.messages[0].content.includes("narration")));
  assert.ok(prompts.every(prompt=>/untrusted/iu.test(prompt.messages[0].content)));
  assert.ok(prompts.every(prompt=>prompt.messages[1].content.length<4500));
});

test("each scene visual assembles direction and two visible elements without a multi-phase reply",async()=>{
  const {phases,...structure}=unit("Complete installed cost");
  const expected=phases[0];
  const {narration,visualElements,...directionExpected}=expected;
  const replies=[directionExpected,{visualElements}];
  let count=0;
  const prompts=[];
  const transport=async(_url,options)=>{
    const payload=JSON.parse(options.body);
    prompts.push(payload);
    assert.equal(payload.max_tokens,2300);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:"stop",message:{content:JSON.stringify(replies[count++])}}]})};
  };
  const configured={...settings,generation:{outlineTokens:1024,sceneTokens:2300,timeoutSeconds:420}};
  const direction=await generateSceneDirection(outline,0,0,structure,[],dossier,quotes,configured,{transport});
  const elements=await generateSceneElements(outline,0,0,structure,direction,dossier,quotes,configured,{transport});
  assert.deepEqual(assembleSceneVisual(direction,elements,[]),{
    visualAction:expected.visualAction,learningChange:expected.learningChange,
    onScreenText:expected.onScreenText,visualElements:expected.visualElements});
  assert.equal(count,2);
  assert.ok(prompts.every(prompt=>/untrusted/iu.test(prompt.messages[0].content)));
});

test("invalid split scene fragments never assemble into an accepted visual or structure",async()=>{
  const {phases,...structure}=unit("Complete installed cost");
  const {before,action,after,...core}=structure;
  await assert.rejects(generateSceneStates(outline,0,core,dossier,quotes,settings,{
    transport:transportFor({before:"Identical state",action:"Identical state",after:"Identical state"})
  }),error=>error.code==="schema_invalid"&&error.field==="before/action/after");
  await assert.rejects(generateSceneElements(outline,0,0,structure,phases[0],dossier,quotes,settings,{
    transport:transportFor({visualElements:[]})
  }),error=>error.code==="schema_invalid"&&error.field==="visualElements");
  await assert.rejects(generateSceneElements(outline,0,0,structure,phases[0],dossier,quotes,settings,{
    transport:transportFor({visualElements:[...phases[0].visualElements,{label:"Labor meter",detail:"Tracks installation work"}]})
  }),error=>error.code==="schema_invalid"&&error.field==="visualElements");
  const previous=[phases[0]];
  const {narration,visualElements,...direction}=phases[0];
  assert.throws(()=>assembleSceneVisual(direction,{visualElements},previous),
    error=>error.code==="schema_invalid"&&error.field==="visualAction");
});

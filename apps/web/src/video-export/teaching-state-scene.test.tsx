import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import type {GeneralFrame,GeneralVisualPlan} from "../../scripts/video-production/general-visual-plan.mjs";
import {sampleSemanticMotion} from "./semantic-scene-motion";
import {TeachingStateScene} from "./teaching-state-scene";
import {GeneralExportScene} from "./general-scene";

const transformation={subjectId:"home_costs",before:"Only the asking price is visible",
  action:"Reveal financing and ongoing expenses",after:"The budget includes additional costs"};
function markup(phase:"problem"|"mechanism"|"payoff",progress:number,locked=false){
  const state={frame:locked?0:40,chapterIndex:0,chapterCount:3,intent:phase==="payoff"?"general-payoff":"general-flow",
    visual:{headline:"Where does the extra money go?",subhead:"Several costs contribute",emphasis:"COSTS",
      items:["house","interest","taxes"],direction:{phase,subjectIds:["home_costs"],
        visualAction:"Show individual ownership cost categories",learningChange:"Listing price is not the total",
        transformation}},visibleItems:locked?0:3,localFrame:locked?0:40,enterProgress:1,
    progress,disclaimer:"Draft"} as GeneralFrame;
  const motion=sampleSemanticMotion({intent:state.intent,phase,
    localFrame:locked?0:Math.round(progress*119),durationFrames:120,
    visibleItems:locked?0:3,itemCount:3});
  return renderToStaticMarkup(<svg><TeachingStateScene state={state} motion={motion}/></svg>);
}

describe("source-grounded state transformation scenes",()=>{
  it("shows the observable initial state and withholds the unknown result in the question",()=>{
    const html=markup("problem",.6);
    expect(html).toContain('data-teaching-state-stage="problem"');
    expect(html).toContain("Only the asking price is visible");
    expect(html).not.toContain("The budget includes additional costs");
  });
  it("animates the action but protects the answer until the payoff",()=>{
    const html=markup("mechanism",.55);
    expect(html).toContain("Reveal financing and ongoing expenses");
    expect(html).not.toContain("The budget includes additional costs");
    expect(html).toContain('data-teaching-travel-progress=');
    expect(markup("mechanism",.55)).toBe(html);
  });
  it("keeps the event frame empty, then reveals the exact learned result",()=>{
    const first=markup("payoff",0,true);
    expect(first).not.toContain("The budget includes additional costs");
    expect(first).toContain('data-teaching-payoff-locked="true"');
    const later=markup("payoff",.55);
    expect(later).toContain("The budget includes additional costs");
  });
  it("keeps authored geometry inside the safe right-side 1920×1080 scene",()=>{
    const html=markup("mechanism",.52);
    expect(html).toContain('data-teaching-safe-bounds="1040,230,1820,920"');
    expect(html).toContain("home costs");
  });
});

it("selects the new state transformation in the real exported general scene and locks its payoff event",()=>{
  const baseVisual={headline:"Where does the extra money go?",subhead:"Ownership adds categories",
    emphasis:"COSTS",items:["House","Tax","Insurance"],direction:{phase:"problem" as const,
      subjectIds:["home_costs"],visualAction:"Show cost categories emerging",
      learningChange:"Price differs from ongoing costs",transformation}};
  const plan:GeneralVisualPlan={schemaVersion:1,kind:"general-explainer-visual-plan",title:"Home costs",
    manifest:{schemaVersion:1,id:"states",durationFrames:180,width:1920,height:1080,
      fps:{num:30,den:1},preset:"youtube"},
    chapters:[
      {id:"problem",intent:"general-flow",visual:baseVisual,startFrame:0,endFrame:60,
        claimRefs:["claim_1"],evidenceRefs:[],eventIds:[]},
      {id:"mechanism",intent:"general-flow",visual:{...baseVisual,direction:{...baseVisual.direction,
        phase:"mechanism"}},startFrame:60,endFrame:120,claimRefs:["claim_1"],evidenceRefs:[],eventIds:[]},
      {id:"payoff",intent:"general-payoff",visual:{...baseVisual,direction:{...baseVisual.direction,
        phase:"payoff"}},startFrame:120,endFrame:180,claimRefs:["claim_1"],evidenceRefs:[],eventIds:["answer"]},
    ],claims:[{id:"claim_1",status:"unverified",text:"An editorial claim"}],evidence:[],
    events:{answer:120},payoffEventId:"answer",disclaimer:"Draft",commercialReady:false};
  const problem=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={40}/>);
  const mechanism=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={95}/>);
  const exactPayoff=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={120}/>);
  const revealed=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={150}/>);
  expect(problem).toContain('data-teaching-state-stage="problem"');
  expect(mechanism).toContain('data-teaching-state-stage="mechanism"');
  expect(mechanism).toContain("Reveal financing and ongoing expenses");
  expect(problem).not.toContain("The budget includes additional costs");
  expect(mechanism).not.toContain("The budget includes additional costs");
  expect(exactPayoff).not.toContain("The budget includes additional costs");
  expect(revealed).toContain("The budget includes additional costs");
});

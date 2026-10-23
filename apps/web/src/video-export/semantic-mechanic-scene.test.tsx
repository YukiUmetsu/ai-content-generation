import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {compileSemanticMechanic} from "./semantic-mechanic-compiler";
import {SemanticMechanicScene} from "./semantic-mechanic-scene";
import type {VisualMechanicV1,VisualOperator} from "../../scripts/video-production/semantic-mechanic.mjs";
import {sampleSemanticMotion} from "./semantic-scene-motion";
import {GeneralExportScene} from "./general-scene";
import type {GeneralVisualPlan} from "../../scripts/video-production/general-visual-plan.mjs";

function mechanic(operator:VisualOperator):VisualMechanicV1 {
  const spec:VisualMechanicV1={version:1,operator,subjectId:"packet",actors:[
    {id:"packet",label:"Network packet",role:"subject",claimIds:["claim"]},
    {id:"part_a",label:"Header",role:"part",claimIds:["claim"]},
    {id:"part_b",label:"Payload",role:"part",claimIds:["claim"]},
    {id:"joined",label:"Complete packet",role:"result",claimIds:["claim"]},
    {id:"sender",label:"Sender",role:"source",claimIds:["claim"]},
    {id:"receiver",label:"Receiver",role:"destination",claimIds:["claim"]}],
    operands:["part_a","part_b"],outcomeId:"joined"};
  if(operator==="split"||operator==="compare")spec.outcomeId="packet";
  if(operator==="transfer"){spec.operands=["sender","receiver"];spec.outcomeId="packet";}
  if(operator==="reveal"){spec.operands=["sender","part_a"];spec.outcomeId="part_a";}
  const required=new Set([spec.subjectId,...spec.operands,spec.outcomeId]);
  spec.actors=spec.actors.filter(actor=>required.has(actor.id));
  return spec;
}
const poses=(operator:VisualOperator,phase:"problem"|"mechanism"|"payoff",progress:number)=>
  compileSemanticMechanic(mechanic(operator),{phase,progress,payoffLocked:phase==="payoff"&&progress===0});
function scene(operator:VisualOperator,phase:"problem"|"mechanism"|"payoff",progress:number){
  const duration=120;const frame=Math.round(progress*(duration-1));
  const motion=sampleSemanticMotion({intent:phase==="payoff"?"general-payoff":"general-flow",phase,
    localFrame:frame,durationFrames:duration,visibleItems:phase==="payoff"&&frame===0?0:3,itemCount:3});
  return renderToStaticMarkup(<svg><SemanticMechanicScene mechanic={mechanic(operator)} phase={phase} motion={motion}/></svg>);
}

describe("semantic animation engine",()=>{
  it("implements six visibly different operation geometries",()=>{
    const descriptions=new Set<string>();
    for(const operator of ["split","assemble","transfer","accumulate","compare","reveal"] as VisualOperator[]){
      const first=poses(operator,"problem",0),middle=poses(operator,"mechanism",.55);
      expect(first.actors.length).toBe(middle.actors.length);
      expect(first.actors.map(x=>x.id)).toEqual(middle.actors.map(x=>x.id));
      expect(middle.actors.some((a,i)=>Math.abs(a.x-first.actors[i].x)>10||Math.abs(a.y-first.actors[i].y)>10||Math.abs(a.opacity-first.actors[i].opacity)>.1)).toBe(true);
      descriptions.add(JSON.stringify(middle.actors.map(x=>[x.id,x.x,x.y,x.opacity])));
      expect(scene(operator,"mechanism",.55)).toContain(`data-semantic-operator="${operator}"`);
    }
    expect(descriptions.size).toBe(6);
  });
  it("keeps the same subject identity in all three phases",()=>{
    for(const phase of ["problem","mechanism","payoff"] as const){
      expect(poses("transfer",phase,.6).actors.some(a=>a.id==="packet")).toBe(true);
      expect(scene("transfer",phase,.6)).toContain('data-semantic-actor="packet"');
    }
  });
  it("never discloses the payoff label in problem, mechanism or first payoff frame",()=>{
    for(const operator of ["assemble","accumulate"] as VisualOperator[]){
      expect(scene(operator,"problem",.7)).not.toContain("Complete packet");
      expect(scene(operator,"mechanism",.7)).not.toContain("Complete packet");
      expect(scene(operator,"payoff",0)).not.toContain("Complete packet");
      expect(scene(operator,"payoff",.75)).toContain("Complete packet");
    }
  });
  it("is deterministic for nonsequential seeking and stays within documented safe bounds",()=>{
    for(const operator of ["split","assemble","transfer","accumulate","compare","reveal"] as VisualOperator[]){
      const expected=poses(operator,"mechanism",.48);
      poses(operator,"payoff",.99);poses(operator,"problem",0);
      expect(poses(operator,"mechanism",.48)).toEqual(expected);
      for(const actor of expected.actors){
        expect(actor.x).toBeGreaterThanOrEqual(1040);
        expect(actor.y).toBeGreaterThanOrEqual(230);
        expect(actor.x+actor.width).toBeLessThanOrEqual(1820);
        expect(actor.y+actor.height).toBeLessThanOrEqual(920);
      }
    }
  });
  it("evaluates existing Kumiki VT1/MG1 at the Video Director local frame without another clock",()=>{
    const spec=mechanic("split"),fps={num:30,den:1};
    const at=(frame:number)=>compileSemanticMechanic(spec,{phase:"mechanism",progress:frame/119,
      localFrame:frame,durationFrames:120,fps});
    expect(at(60).kumikiBacked).toBe(true);
    expect(at(60)).toEqual(at(60));
    expect(at(60).actors.find(x=>x.id==="part_a")?.x).not.toBe(at(0).actors.find(x=>x.id==="part_a")?.x);
    expect(at(119).actors.find(x=>x.id==="part_a")?.x).toBe(poses("split","mechanism",1).actors.find(x=>x.id==="part_a")?.x);
  });
  it("offers a final reduced-motion still, but protects an exact payoff event",()=>{
    const locked=compileSemanticMechanic(mechanic("reveal"),{phase:"payoff",progress:0,payoffLocked:true,reducedMotion:true});
    const revealed=compileSemanticMechanic(mechanic("reveal"),{phase:"payoff",progress:.5,payoffLocked:false,reducedMotion:true});
    expect(locked.actors.find(x=>x.id==="part_a")?.opacity).toBe(0);
    expect(revealed.actors.find(x=>x.id==="part_a")?.opacity).toBe(1);
  });
  it("checks seven sampled times and a maximum six-operand stage without screenshot AI",()=>{
    const six=mechanic("accumulate");
    for(const [id,label] of [["part_c","Taxes"],["part_d","Insurance"],["part_e","Maintenance"],["part_f","Financing"]]){
      six.actors.push({id,label,role:"part",claimIds:["claim"]});six.operands.push(id);
    }
    for(const time of [0,.1,.25,.5,.75,.95,1]){
      const rendered=compileSemanticMechanic(six,{phase:"mechanism",progress:time});
      for(const actor of rendered.actors){
        expect(actor.x).toBeGreaterThanOrEqual(1040);
        expect(actor.y).toBeGreaterThanOrEqual(230);
        expect(actor.x+actor.width).toBeLessThanOrEqual(1820);
        expect(actor.y+actor.height).toBeLessThanOrEqual(920);
      }
    }
    const finished=compileSemanticMechanic(six,{phase:"payoff",progress:1});
    const occupied=finished.actors.filter(a=>a.opacity>.9&&six.operands.includes(a.id));
    for(let i=0;i<occupied.length;i++)for(let j=i+1;j<occupied.length;j++){
      const a=occupied[i],b=occupied[j];
      expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
    }
  });
  it("the real Video Director frame route uses the semantic scene before legacy text cards",()=>{
    const transfer=mechanic("transfer");
    const common={headline:"How a packet crosses a link",subhead:"A packet keeps its identity",
      emphasis:"NETWORK",items:["Packet","Sender","Receiver"]};
    const make=(phase:"problem"|"mechanism"|"payoff")=>({...common,direction:{phase,
      subjectIds:["packet"],visualAction:"Move the packet",learningChange:"Preserve the packet identity",
      transformation:{subjectId:"packet",before:"Packet begins at sender",action:"Route packet to receiver",
        after:"Packet arrives at receiver"},visualMechanic:transfer}});
    const plan:GeneralVisualPlan={schemaVersion:1,kind:"general-explainer-visual-plan",title:"Packet transfer",
      manifest:{schemaVersion:1,id:"packet-scenes",durationFrames:180,width:1920,height:1080,fps:{num:30,den:1},preset:"youtube"},
      chapters:[{id:"one",intent:"general-flow",visual:make("problem"),startFrame:0,endFrame:60,claimRefs:["claim"],evidenceRefs:[],eventIds:[]},
        {id:"two",intent:"general-flow",visual:make("mechanism"),startFrame:60,endFrame:120,claimRefs:["claim"],evidenceRefs:[],eventIds:[]},
        {id:"three",intent:"general-payoff",visual:make("payoff"),startFrame:120,endFrame:180,claimRefs:["claim"],evidenceRefs:[],eventIds:["answer"]}],
      claims:[{id:"claim",status:"illustrative",text:"Test packet movement"}],evidence:[],
      events:{answer:120},payoffEventId:"answer",disclaimer:"Draft",commercialReady:false};
    const mechanism=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={95}/>);
    expect(mechanism).toContain('data-semantic-operator="transfer"');
    expect(mechanism).toContain('data-kumiki-vt1="true"');
    expect(mechanism).toContain('data-semantic-actor="packet"');
    expect(mechanism).not.toContain("data-teaching-state-stage");
    expect(renderToStaticMarkup(<GeneralExportScene plan={plan} frame={120}/>)).toContain('data-semantic-payoff-locked="true"');
  });
});

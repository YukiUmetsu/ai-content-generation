/**
 * Pure, seek-invariant poses for source-grounded *qualitative* SVG teaching.
 * All positions are prescribed here—not LLM output. The caller supplies its
 * Kumiki-directed local frame progress; this module never starts a clock.
 */
import {validateVisualMechanic} from "../../scripts/video-production/semantic-mechanic.mjs";
import type {VisualMechanicV1,VisualOperator,VisualActorRole} from "../../scripts/video-production/semantic-mechanic.mjs";
import {sampleKumikiMechanicLayouts} from "./semantic-mechanic-kumiki";
import type {RationalFps} from "@/components/motion/types";

export const SEMANTIC_SAFE_BOUNDS={left:1040,top:230,right:1820,bottom:920} as const;
export interface SemanticActorPose {
  id:string;label:string;role:VisualActorRole;
  x:number;y:number;width:number;height:number;opacity:number;
  emphasis:boolean;
}
export interface SemanticScenePose {
  operator:VisualOperator;phase:"problem"|"mechanism"|"payoff";
  actors:SemanticActorPose[];progress:number;showOutcome:boolean;
  operands:string[];outcomeId:string;subjectId:string;
  kumikiBacked:boolean;
}
type Phase=SemanticScenePose["phase"];
type Options={phase:Phase;progress:number;payoffLocked?:boolean;reducedMotion?:boolean;
  localFrame?:number;durationFrames?:number;fps?:RationalFps};
const smooth=(n:number)=>{const v=Math.max(0,Math.min(1,n));return v*v*(3-2*v);};
const lerp=(a:number,b:number,t:number)=>Math.round((a+(b-a)*t)*1000)/1000;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const size={width:148,height:88};
const center={x:1332,y:440,width:204,height:136};
type Rect={x:number;y:number;width:number;height:number};
const positions=(ids:string[],kind:"spread"|"stack"|"compare")=>new Map<string,Rect>(ids.map((id,i):[string,Rect]=>{
  if(kind==="stack")return [id,{x:1490,y:351+i*64,width:196,height:54}];
  if(kind==="compare")return [id,{x:1098+(i%3)*225,y:400+Math.floor(i/3)*190,width:190,height:120}];
  return [id,{x:1100+(i%3)*225,y:343+Math.floor(i/3)*172,...size}];
}));
const hidden={x:1326,y:474,width:180,height:100};
function move(a:SemanticActorPose,to:Partial<SemanticActorPose>,t:number){
  return {...a,x:lerp(a.x,to.x??a.x,t),y:lerp(a.y,to.y??a.y,t),
    width:lerp(a.width,to.width??a.width,t),height:lerp(a.height,to.height??a.height,t),
    opacity:clamp(lerp(a.opacity,to.opacity??a.opacity,t)),emphasis:to.emphasis??a.emphasis};
}
/** Re-validates untrusted plan fragments at the final render boundary. */
export function compileSemanticMechanic(spec:VisualMechanicV1,options:Options):SemanticScenePose {
  const claims=new Set(Array.isArray(spec?.actors)?spec.actors.flatMap(actor=>Array.isArray(actor?.claimIds)?actor.claimIds:[]):[]);
  const verdict=validateVisualMechanic(spec,{technicalSubjectId:spec?.subjectId,
    knownClaimIds:claims,knownAssetKeys:new Set()});
  if(!verdict.ok)throw Error("Semantic visual rejected: "+verdict.findings.map(f=>f.code).join(", "));
  if(!["problem","mechanism","payoff"].includes(options.phase)||
    !Number.isFinite(options.progress)||options.progress<0||options.progress>1)
    throw Error("Semantic visual requires a bounded teaching phase and progress.");
  const showOutcome=options.phase==="payoff"&&!options.payoffLocked&&options.progress>0;
  const t=options.phase==="problem"?0:options.phase==="payoff"?1:
    options.reducedMotion?1:smooth(options.progress);
  const reveal=showOutcome?(options.reducedMotion?1:smooth(options.progress)):0;
  const spread=positions(spec.operands,"spread");
  const stack=positions(spec.operands,"stack");
  const compare=positions(spec.operands,"compare");
  let actors=spec.actors.map(actor=>{
    const base:SemanticActorPose={id:actor.id,label:actor.label,role:actor.role,
      ...center,opacity:0,emphasis:false};
    const index=spec.operands.indexOf(actor.id);
    const isSubject=actor.id===spec.subjectId;
    const isOutcome=actor.id===spec.outcomeId;
    if(spec.operator==="split"){
      if(isSubject)return {...base,opacity:clamp(1-t*.87)};
      if(index>=0)return move({...base,...center,opacity:0},
        {...spread.get(actor.id),opacity:1,emphasis:t>.6},t);
    }
    if(spec.operator==="assemble"){
      if(index>=0)return move({...base,...spread.get(actor.id),opacity:1},
        {x:1332+(index%3)*61,y:447+Math.floor(index/3)*59,width:64,height:60,opacity:.94},t);
      if(isOutcome)return {...base,x:1309,y:640,width:250,height:106,opacity:reveal,emphasis:true};
      if(isSubject)return {...base,x:1304,y:426,width:250,height:162,opacity:.18+t*.25};
    }
    if(spec.operator==="transfer"){
      if(actor.role==="source")return {...base,x:1080,y:452,width:200,height:137,opacity:1};
      if(actor.role==="destination")return {...base,x:1582,y:452,width:200,height:137,opacity:1};
      if(isSubject)return {...base,x:lerp(1300,1535,t),y:473,width:98,height:92,opacity:1,emphasis:t>.5};
    }
    if(spec.operator==="accumulate"){
      if(index>=0)return move({...base,x:1085,y:317+index*70,width:195,height:57,opacity:1},
        {...stack.get(actor.id),opacity:1},t);
      if(isSubject)return {...base,x:1070,y:782,width:242,height:88,opacity:1};
      if(isOutcome)return {...base,x:1500,y:782,width:244,height:88,opacity:reveal,emphasis:true};
    }
    if(spec.operator==="compare"){
      if(index>=0)return move({...base,x:1110+(index%3)*225,y:335+Math.floor(index/3)*190,width:190,height:120,opacity:1},
        {...compare.get(actor.id),opacity:1,emphasis:true},t);
      if(isSubject)return {...base,x:1320,y:720,width:244,height:92,opacity:showOutcome?1:0};
    }
    if(spec.operator==="reveal"){
      if(actor.id===spec.operands[0])return move({...base,x:1270,y:425,width:305,height:178,opacity:1},
        {x:1620,y:425,width:164,height:178,opacity:.78},t);
      if(isOutcome)return {...base,...hidden,opacity:reveal,emphasis:true};
      if(isSubject)return {...base,x:1103,y:717,width:200,height:107,opacity:1};
    }
    return base;
  });
  let kumikiBacked=false;
  if(options.phase==="mechanism"&&options.localFrame!==undefined&&options.durationFrames!==undefined&&options.fps){
    if(!Number.isSafeInteger(options.localFrame)||!Number.isSafeInteger(options.durationFrames)||
      options.durationFrames<4||options.localFrame<0||options.localFrame>=options.durationFrames)
      throw Error("Kumiki semantic animation needs a valid Video Director frame and duration.");
    const from=compileSemanticMechanic(spec,{phase:"problem",progress:0}).actors;
    const to=compileSemanticMechanic(spec,{phase:"mechanism",progress:1}).actors;
    const positions=sampleKumikiMechanicLayouts({operator:spec.operator,operands:spec.operands,
      from,to,localFrame:options.localFrame,durationFrames:options.durationFrames,fps:options.fps});
    if(actors.some(actor=>!positions.has(actor.id)))
      throw Error("Kumiki semantic transition lost an actor identity; inspect the authored operation.");
    actors=actors.map(actor=>({...actor,...positions.get(actor.id)}));
    kumikiBacked=true;
  }
  for(const actor of actors){
    if(actor.x<SEMANTIC_SAFE_BOUNDS.left||actor.y<SEMANTIC_SAFE_BOUNDS.top||
      actor.x+actor.width>SEMANTIC_SAFE_BOUNDS.right||
      actor.y+actor.height>SEMANTIC_SAFE_BOUNDS.bottom)
      throw Error(`Semantic actor ${actor.id} exceeded safe stage; shorten its actor list or choose a different visual operation.`);
  }
  return {operator:spec.operator,phase:options.phase,actors,progress:t,
    showOutcome,operands:[...spec.operands],outcomeId:spec.outcomeId,subjectId:spec.subjectId,kumikiBacked};
}

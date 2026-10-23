/**
 * VT1/MG1 is the sole transformation evaluator for actual video frames.
 * ContentGen supplies safe authored endpoints; pinned Kumiki owns interpolation.
 */
import {createAssemblyTransformation,createLayoutTransformation} from "@/components/motion/transformation-recipes";
import {compileVisualTransformation,evaluateVisualTransformation} from "@/components/motion/visual-transformation";
import type {CompiledVisualTransformation,VisualScene} from "@/components/motion/visual-transformation-types";
import type {RationalFps} from "@/components/motion/types";
import type {VisualOperator} from "../../scripts/video-production/semantic-mechanic.mjs";
import type {SemanticActorPose} from "./semantic-mechanic-compiler";

type ActorRect=Pick<SemanticActorPose,"x"|"y"|"width"|"height">;
const store=new Map<string,CompiledVisualTransformation>();
const layout=(pose:ActorRect)=>({x:pose.x,y:pose.y,width:pose.width,height:pose.height});

export function sampleKumikiMechanicLayouts({operator,operands,from,to,localFrame,durationFrames,fps}:{
  operator:VisualOperator;operands:string[];from:SemanticActorPose[];to:SemanticActorPose[];
  localFrame:number;durationFrames:number;fps:RationalFps;
}):Map<string,ActorRect>{
  const frames=Math.max(4,durationFrames),range={startFrame:0,endFrame:frames-2};
  const byId=new Map(to.map(a=>[a.id,a]));
  const key=JSON.stringify([operator,operands,from.map(a=>[a.id,a.x,a.y,a.width,a.height]),
    to.map(a=>[a.id,a.x,a.y,a.width,a.height]),frames,fps]);
  let compiled=store.get(key);
  if(!compiled){
    const scene:VisualScene={id:"contentgen-semantic-actors",elements:from.map(actor=>({
      id:actor.id,semanticId:actor.id,layout:layout(actor),
      content:{kind:"text" as const,bounds:{x:0,y:0,width:1,height:1},text:actor.id,fontSize:1}
    }))};
    const timing={id:"contentgen-mechanic",fps,durationFrames:frames,range};
    const spec=(operator==="split"||operator==="assemble")
      ?createAssemblyTransformation({...timing,scene,direction:operator==="split"?"disassemble":"assemble",
        parts:operands.map(id=>{
          const first=from.find(a=>a.id===id)!,last=byId.get(id)!;
          return {id,assembled:layout(operator==="split"?first:last),
            separated:layout(operator==="split"?last:first)};
        })})
      :createLayoutTransformation({...timing,scene,layouts:Object.fromEntries(to.map(a=>[a.id,layout(a)]))});
    compiled=compileVisualTransformation(spec);
    if(store.size>=24)store.delete(store.keys().next().value!);
    store.set(key,compiled);
  }
  const sample=evaluateVisualTransformation(compiled,Math.max(0,Math.min(frames-1,localFrame)));
  const found=new Map<string,ActorRect>();
  for(const layer of sample.layers){
    if(found.has(layer.semanticId))continue;
    const m=layer.transform;
    // Intrinsic VT1 text bounds are a unit square, so affine origin + scale
    // are the exact actor rectangle. Rotational transforms aren't authored.
    if(![m.a,m.d,m.e,m.f].every(Number.isFinite)||m.a<=0||m.d<=0||
      Math.abs(m.b)>1e-7||Math.abs(m.c)>1e-7)
      throw Error("Kumiki produced an invalid semantic layout; repair the authored operation.");
    found.set(layer.semanticId,{x:m.e,y:m.f,width:m.a,height:m.d});
  }
  return found;
}

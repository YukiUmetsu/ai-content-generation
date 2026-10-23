/** Deterministic, absolute-frame-only stage direction. No clock, randomness, LLM or screenshot review.
 * Delays reflect narrator beat duration; progress never substitutes for sourced data.
 */
export type Intent = "general-intro" | "general-flow" | "general-comparison" | "general-breakdown" | "general-payoff";
export type TeachingPhase = "problem" | "analogy" | "mechanism" | "payoff" | "none";
export type MotionStyle = "question-lens" | "journey" | "contrast" | "decomposition" | "synthesis";
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(x:number)=>{const t=clamp(x);return t*t*(3-2*t);};
const quantize=(v:number)=>Math.round(v*1000)/1000;
export interface SemanticFrame {
  style:MotionStyle;
  phase:TeachingPhase;
  cameraX:number;
  cameraY:number;
  cameraScale:number;
  focusIndex:number;
  reveal:Array<{visible:boolean;opacity:number;offset:number;scale:number;focused:boolean}>;
  lightSweep:number;
  connectorProgress:number;
  completion:number;
  isPayoffPending:boolean;
}
export function sampleSemanticMotion({
  intent,phase="none",localFrame,durationFrames,visibleItems,itemCount,reducedMotion=false,
  cameraMode="subtle",revealStartFrame,revealStepFrames
}:{
  intent:Intent;phase?:TeachingPhase;localFrame:number;durationFrames:number;visibleItems:number;
  itemCount:number;reducedMotion?:boolean;
  cameraMode?:"locked"|"subtle"|"cinematic";revealStartFrame?:number;revealStepFrames?:number;
}):SemanticFrame {
  if(!Number.isSafeInteger(localFrame)||!Number.isSafeInteger(durationFrames)||durationFrames<1||
    localFrame<0||localFrame>=durationFrames||!Number.isInteger(itemCount)||itemCount<2||itemCount>5||
    !Number.isInteger(visibleItems)||visibleItems<0||visibleItems>itemCount)
    throw Error("Semantic scene requires a valid bounded frame and diagram state.");
  const style:Record<Intent,MotionStyle>={
    "general-intro":"question-lens","general-flow":"journey",
    "general-comparison":"contrast","general-breakdown":"decomposition","general-payoff":"synthesis"
  };
  // A payoff's editorial state switches all parts on after the event.
  // Stagger their visual entries *within* that reveal instead of hiding the
  // last elements until the narration has nearly finished.
  const revealStep=intent==="general-payoff"
    ?Math.max(1,Math.floor(20/Math.max(1,itemCount-1)))
    :Math.max(1,Math.min(24,Math.floor(durationFrames/itemCount)));
  const focusIndex=Math.min(itemCount-1,Math.max(0,visibleItems-1));
  const timeline=localFrame/Math.max(1,durationFrames-1);
  const completion=ease(timeline);
  const entry=ease(localFrame/Math.max(1,Math.min(18,Math.floor(durationFrames*.22))));
  const reveals=Array.from({length:itemCount},(_,index)=>{
    const visible=index<visibleItems;
    // The editorial sampler owns *whether* an item exists. This controls only
    // its visual introduction and cannot leak future answers or labels.
    const startedAt=revealStartFrame!==undefined&&revealStepFrames!==undefined
      ?revealStartFrame+index*revealStepFrames
      :index*revealStep+(intent==="general-payoff"?1:0);
    const local=Math.max(0,localFrame-startedAt);
    const actualStep=revealStepFrames??revealStep;
    const p=reducedMotion?1:ease((local+1)/Math.max(1,Math.min(12,actualStep)));
    return {visible,opacity:visible?quantize(p):0,
      offset:visible&&!reducedMotion?quantize((1-p)*30):0,
      scale:visible&&!reducedMotion?quantize(.94+.06*p):1,
      focused:visible&&index===focusIndex};
  });
  const glide=reduceMotionGuard(reducedMotion,Math.sin(timeline*Math.PI*1.7));
  const cameraMultiplier=cameraMode==="locked"?0:cameraMode==="cinematic"?1.65:1;
  const cameraX=quantize(((1-entry)*-14+glide*5)*cameraMultiplier);
  const cameraY=quantize(((1-entry)*11-Math.sin(timeline*Math.PI)*7*(reducedMotion?0:1))*cameraMultiplier);
  const cameraScale=quantize(1+(reducedMotion?0:.012*ease(timeline)*cameraMultiplier));
  return {
    style:style[intent],phase,cameraX,cameraY,cameraScale,
    focusIndex,reveal:reveals,
    lightSweep:quantize(ease(timeline)),
    connectorProgress:quantize(ease((localFrame-Math.min(9,revealStep))/Math.max(1,durationFrames*.6))),
    completion:quantize(completion),
    isPayoffPending:intent==="general-payoff"&&visibleItems===0
  };
}
function reduceMotionGuard(reduced:boolean,v:number){return reduced?0:v;}

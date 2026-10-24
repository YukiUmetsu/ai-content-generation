/** Deterministic teaching-state disclosure. Absolute scene timing is owned by the caller.
 * A mechanism may animate toward its result but never prints the payoff early.
 */
const clamp=t=>Math.min(1,Math.max(0,t));
const ease=t=>{const x=clamp(t);return x*x*(3-2*x);};
const q=x=>Math.round(x*1000)/1000;

export function sampleTeachingTransition({phase,progress,payoffLocked=false}){
  if(!["problem","mechanism","payoff"].includes(phase))
    throw Error("Unsupported visible teaching phase.");
  if(!Number.isFinite(progress)||progress<0||progress>1||typeof payoffLocked!=="boolean")
    throw Error("Invalid visible teaching progress.");
  if(payoffLocked)return {beforeVisible:false,actionVisible:false,afterVisible:false,
    beforeOpacity:0,actionOpacity:0,afterOpacity:0,travelProgress:0};
  if(phase==="problem")return {beforeVisible:true,actionVisible:false,afterVisible:false,
    beforeOpacity:q(ease(progress/.2)),actionOpacity:0,afterOpacity:0,travelProgress:0};
  if(phase==="mechanism")return {beforeVisible:true,actionVisible:progress>.08,afterVisible:false,
    beforeOpacity:1,actionOpacity:q(ease((progress-.08)/.22)),afterOpacity:0,
    travelProgress:q(ease((progress-.15)/.7))};
  return {beforeVisible:true,actionVisible:progress>.03,afterVisible:progress>.03,
    beforeOpacity:.6,actionOpacity:q(ease((progress-.03)/.25)),
    afterOpacity:q(ease((progress-.03)/.25)),travelProgress:1};
}

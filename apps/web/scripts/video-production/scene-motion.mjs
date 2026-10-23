/** Exact finite controls shared by the validated preproduction, renderer and frame sampler.
 * No arbitrary CSS, JS, instructions or numeric keyframes. Defaults preserve prior renders.
 */
export const DEFAULT_SCENE_MOTION=Object.freeze({
  revealDelayPercent:0,revealPace:"balanced",camera:"subtle",transition:"cut"
});
const keys=Object.keys(DEFAULT_SCENE_MOTION);
export function isSceneMotion(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))return false;
  return Number.isSafeInteger(value.revealDelayPercent)&&value.revealDelayPercent>=0&&
    value.revealDelayPercent<=30&&
    ["snappy","balanced","deliberate"].includes(value.revealPace)&&
    ["locked","subtle","cinematic"].includes(value.camera)&&
    ["cut","fade"].includes(value.transition);
}
export function normalizedSceneMotion(motion){
  if(motion===undefined)return {...DEFAULT_SCENE_MOTION};
  if(!isSceneMotion(motion))throw Error("Scene motion needs a 0–30% delay, supported pacing, camera and transition preset.");
  return {...motion};
}
export function motionRevealState({
  frame,frames,itemCount,intent,motion
}){
  const preset=normalizedSceneMotion(motion);
  if(!Number.isSafeInteger(frame)||!Number.isSafeInteger(frames)||frames<1||
    frame<0||frame>=frames||!Number.isInteger(itemCount)||itemCount<2||itemCount>5)
    throw Error("Scene reveal requires valid absolute/local frames and 2–5 items.");
  const isPayoff=intent==="general-payoff";
  // The exact payoff event frame must always show zero elements, regardless
  // of user settings. No editor setting can move that disclosure earlier.
  if(isPayoff&&frame===0)return {visibleItems:0,revealStartFrame:1,revealStepFrames:1};
  const delay=isPayoff
    ? Math.max(1,Math.floor((frames-1)*preset.revealDelayPercent/100))
    : Math.floor(frames*preset.revealDelayPercent/100);
  const remaining=Math.max(1,frames-delay-1);
  const intervals=Math.max(1,itemCount-1);
  const base=Math.max(1,Math.floor(remaining/intervals));
  const multiplier={snappy:.55,balanced:.78,deliberate:1}[preset.revealPace];
  const step=Math.max(1,Math.min(base,Math.floor(base*multiplier)));
  const visible=frame<delay?0:Math.min(itemCount,1+Math.floor((frame-delay)/step));
  return {visibleItems:visible,revealStartFrame:delay,revealStepFrames:step};
}
export function entryFadeOpacity(frame,frames,motion){
  const preset=normalizedSceneMotion(motion);
  if(preset.transition==="cut")return 0;
  const duration=Math.min(16,Math.max(1,Math.floor(frames/6)));
  return Math.max(0,1-frame/duration);
}

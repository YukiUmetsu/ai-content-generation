/** Resolve explicitly requested SFX visual cues against the real, frame-sampled
 * general explainer. Never infer a timestamp from prose or target duration.
 */
import {getGeneralFrame} from "./general-visual-plan.mjs";
import {AUDIO_SAMPLE_RATE,toFrame} from "./timeline.mjs";

const fail=message=>{throw Error(`Visual SFX timing unavailable: ${message}`);};
const audioSampleAtFrame=(frame,fps)=>{
  const n=BigInt(frame)*BigInt(AUDIO_SAMPLE_RATE)*BigInt(fps.den);
  const d=BigInt(fps.num);
  const sample=Number((2n*n+d)/(2n*d));
  if(!Number.isSafeInteger(sample)||toFrame(sample,fps)!==frame)
    fail(`Frame ${frame} cannot be represented by the measured audio clock.`);
  return sample;
};

export function resolveVisualSfxTimeline(job,timeline,visualPlan){
  const anchored=(job?.events??[]).filter(event=>event.anchor==="first-visual-reveal");
  if(!anchored.length)return timeline;
  if(job?.visualFamily!=="general-explainer-v1"||visualPlan?.kind!=="general-explainer-visual-plan")
    fail("Only general explainer visible-element reveals are supported.");
  if(visualPlan.manifest?.fps?.num!==timeline.fps?.num||
    visualPlan.manifest?.fps?.den!==timeline.fps?.den||
    visualPlan.manifest?.durationFrames!==timeline.totalFrames)
    fail("Visual frame manifest does not match measured narration.");
  const eventSamples={...timeline.eventSamples},eventFrames={...timeline.eventFrames};
  for(const event of anchored){
    if(event.id===job.topic?.payoffEventId)fail("The narrative payoff must stay at its original beat-start event.");
    const chapter=visualPlan.chapters?.find(x=>x.id===event.beatId);
    const range=timeline.beats?.find(x=>x.id===event.beatId);
    if(!chapter||!range||chapter.startFrame!==range.startFrame||
      chapter.endFrame<=chapter.startFrame||!Object.hasOwn(eventSamples,event.id))
      fail(`Shot for event ${event.id} is not matched to its measured beat.`);
    if(chapter.intent==="general-flow"||chapter.visual?.sceneRecipe||chapter.visual?.chart||
      chapter.visual?.direction?.visualMechanic||chapter.visual?.direction?.transformation||
      (chapter.intent==="general-intro"&&chapter.visual?.hookStrategy==="unexpected-reveal"))
      fail(`Shot ${event.beatId} has an unsupported dynamic visual presentation without authoritative element-reveal cues.`);
    let last=getGeneralFrame(visualPlan,chapter.startFrame).visibleItems,frame=null;
    for(let at=chapter.startFrame+1;at<chapter.endFrame;at++){
      const visible=getGeneralFrame(visualPlan,at).visibleItems;
      if(visible>last){frame=at;break;}
      last=visible;
    }
    if(frame===null)fail(`Shot ${event.beatId} has no measurable visible-element reveal after its opening frame.`);
    const sample=audioSampleAtFrame(frame,timeline.fps);
    if(sample<range.startSample||sample>=range.pauseEndSample)
      fail(`Shot ${event.beatId} visual cue is outside its measured audio beat.`);
    eventFrames[event.id]=frame;eventSamples[event.id]=sample;
  }
  return Object.freeze({...timeline,eventSamples:Object.freeze(eventSamples),
    eventFrames:Object.freeze(eventFrames)});
}

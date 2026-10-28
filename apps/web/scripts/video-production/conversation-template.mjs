/** Apply a reviewable two-character conversation over the existing visual scene.
 * The source-backed narration remains unchanged as the last turn. This is an
 * editorial template, never provider authorization or a completed video. */
import {createHash} from "node:crypto";
import {compilePreproductionBundle} from "./preproduction.mjs";

const sha=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const DEMO_FISH_VOICE_ID="6ab4c6b0f37f4243a99046478647be94";

export function createConversationNarrationTemplate(dossier,source,{voiceId=DEMO_FISH_VOICE_ID}={}){
  if(!dossier||source?.kind!=="preproduction-bundle"||source.researchId!==dossier.id||
    source.researchSha256!==sha(dossier)||source.planSha256!==sha(source.plan))
    throw Error("Open an untampered research-linked storyboard before applying the conversation template.");
  if(!/^[a-f0-9]{32}$/u.test(voiceId))throw Error("The conversation template needs a valid saved Fish voice ID.");
  const plan=structuredClone(source.plan);
  if(!Array.isArray(plan.shots)||plan.shots.length<3||!Array.isArray(plan.sound))
    throw Error("A conversation template needs at least three storyboard scenes.");
  const target=plan.sound.find(sound=>sound.shotId===plan.shots[Math.floor(plan.shots.length/2)].id);
  if(!target||target.speechTurns||target.speaker)
    throw Error("The middle scene already has a voice assignment. Choose a different scene in the Director.");
  const pip="Could you explain what we're looking at?";
  const quill="Let's follow what the diagram actually shows.";
  if(target.narration.length+pip.length+quill.length+2>2000)
    throw Error("The middle scene has too much narration for the conversation starter. Shorten it first.");
  target.speechTurns=[
    {id:"pip-question",narration:pip,pauseAfterMs:180,
      speaker:{id:"pip",role:"character",provider:"fish",voiceId}},
    {id:"quill-reply",narration:quill,pauseAfterMs:180,
      speaker:{id:"quill",role:"character",provider:"fish",voiceId}},
    {id:"narrator-explains",narration:target.narration.trim(),pauseAfterMs:0}
  ];
  target.narration=target.speechTurns.map(turn=>turn.narration).join(" ");
  const bundle=compilePreproductionBundle(dossier,plan);
  bundle.status="draft-needs-review";
  bundle.assessment.ready=false;
  bundle.assessment.findings.push({severity:"error",code:"dialogue-template-needs-review",path:"sound",
    message:"Review both character lines and assign different voice IDs before a real dialogue export."});
  return bundle;
}

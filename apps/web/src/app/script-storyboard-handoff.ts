/** Converts an approved, source-linked script to an editable semantic storyboard outline.
 * This is a ContentGen authoring adapter, not a replacement for Kumiki's scene,
 * motion, camera, storyboard or export engines. Visual directions require review.
 */
import { DEFAULT_FPS, STORYBOARD_KIND, STORYBOARD_SCHEMA_VERSION,
  type SemanticStoryboard, type StoryboardBeat, type NarrativeRole, type VisualIntent } from
  "@/features/storyboard-planner/model/types";
import { validateStoryboard } from "@/features/storyboard-planner/model/validate";
import { estimatedNarrationSeconds, type ScriptDraft, type ScriptEvidence, type ScriptRole } from "./script-review-model";

const ROLES:Record<ScriptRole,NarrativeRole>={
  hook:"hook",context:"setup",mechanism:"explanation",practical:"evidence",closing:"takeaway",
};
const INTENTS:Record<ScriptRole,VisualIntent>={
  hook:"question",context:"explanation",mechanism:"explanation",practical:"comparison",closing:"takeaway",
};

export function scriptToStoryboard(script:ScriptDraft,evidence:readonly ScriptEvidence[]):SemanticStoryboard {
  if(script.status!=="approved"||!script.approvedAt||script.sections.some(section=>!section.text.trim())){
    throw Error("Approve a complete script before creating its storyboard outline.");
  }
  const evidenceByClaim=new Map(evidence.map(item=>[item.claimId,item]));
  const allClaimIds=[...new Set(script.sections.flatMap(section=>section.claimRefs))];
  const claims=allClaimIds.map(id=>{
    const source=evidenceByClaim.get(id);
    return {id,status:"unverified" as const,
      note:source?.claimText??"Narration assertion needs a matching source and editorial review.",
      sourceRefs:source?[source.sourceId]:[],
    };
  });
  const beats:StoryboardBeat[]=script.sections.map((section,index)=>{
    const subjectId=`script-concept-${section.id}`;
    const questionId="script-central-question";
    const isFirst=index===0,isLast=index===script.sections.length-1;
    const readingSeconds=estimatedNarrationSeconds(section.text,script.input.locale);
    return {
      id:`script-beat-${section.id}`,role:ROLES[section.id],
      objective:section.purpose,narration:section.text,onScreenText:section.heading,
      visualIntent:INTENTS[section.id],
      visualObjective:`Design a meaningful visual change that teaches: ${section.purpose}`,
      semanticObjects:[subjectId],focusTarget:subjectId,
      durationFrames:Math.max(90,Math.ceil(readingSeconds*DEFAULT_FPS.num/DEFAULT_FPS.den)),
      claimRefs:[...section.claimRefs],
      namedEvents:isFirst?["script-question-opens"]:isLast?["script-answer-reveals"]:[],
      staticFallback:`${section.heading}: ${section.purpose}`,
      ...(isFirst?{opensQuestion:questionId}:{}),
      ...(isLast?{answersQuestion:questionId}:{}),
    };
  });
  const board:SemanticStoryboard={
    schemaVersion:STORYBOARD_SCHEMA_VERSION,kind:STORYBOARD_KIND,
    id:`storyboard-${script.input.productionId}`,title:script.input.title,locale:script.input.locale,
    fps:{...DEFAULT_FPS},beats,
    questions:[{id:"script-central-question",text:script.input.viewerQuestion}],
    claims,semanticObjects:script.sections.map(section=>({id:`script-concept-${section.id}`,label:section.heading})),
    semanticEvents:[
      {id:"script-question-opens",label:"Open the motivating question",objectId:"script-concept-hook"},
      {id:"script-answer-reveals",label:"Reveal the final answer",objectId:"script-concept-closing"},
    ],
    assumptions:[
      `Approved script revision: ${script.updatedAt}.`,
      "This is an editable storyboard outline, not a generated or validated visual plan. Review and direct each scene in Kumiki.",
      "Captured source passages are not independent fact verification. Review each assertion before release.",
      ...evidence.map(item=>`Captured source ${item.sourceId}: ${item.sourceUrl}`),
    ],illustrativeData:false,
  };
  const errors=validateStoryboard(board).filter(issue=>issue.severity==="error");
  if(errors.length)throw Error(`Generated storyboard outline is structurally invalid: ${errors.map(issue=>issue.code).join(", ")}`);
  return board;
}

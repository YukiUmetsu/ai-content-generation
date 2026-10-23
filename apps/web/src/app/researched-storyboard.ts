/** Browser-side projection of a validated local research/preproduction draft.
 * A quote matches captured text, but claims remain unverified until human review.
 */
import { DEFAULT_FPS, STORYBOARD_KIND, STORYBOARD_SCHEMA_VERSION, type Locale,
  type SemanticStoryboard, type StoryboardBeat, type NarrativeRole, type VisualIntent } from "@/features/storyboard-planner/model/types";
import { validateStoryboard } from "@/features/storyboard-planner/model/validate";

interface ResearchSource { id:string; title:string; sourceUri:string; retrievedAt:string; passageLocator:string; snapshotSha256:string }
interface ResearchClaim { id:string; text:string; status:"unverified"|"verified"|"disputed"|"illustrative"; sourceRefs:string[] }
interface PlanShot {id:string;explanationId:string;family:string;purpose:string;subjectIds:string[];visualChange:string;onScreenText:string;claimIds:string[];assetRefs:string[]}
interface PlanVoice {shotId:string;narration:string;delivery:string;energy:string;pauseAfterMs:number;sfxIntent:string|null}
interface PlanExplanation {id:string;actId:string;claimIds:string[];before:string;demonstration:string;after:string}
interface TeachingPhase {kind:string;shotId:string;visualAction:string;learningChange:string}
interface VisualStates {before:string;action:string;after:string}
export interface ResearchDraftResult {
  snapshotId:string;
  artifactId?:string;
  warnings:string[];
  quotes:{claimId:string;sourceId:string;quote:string}[];
  dossier:{schemaVersion:1;kind:"research-dossier";id:string;
    topic:{title:string;viewerQuestion:string;audience:string;locale:string};
    evidence:ResearchSource[];claims:ResearchClaim[];gaps:string[];review:{status:string}};
  plan:{schemaVersion:1;kind:"preproduction-plan";researchId:string;
    story:{pattern:string;premise:string;hook:string;question:string;answerExplanationId:string;acts:{id:string;question:string;purpose:string;payoff:string}[]};
    explanation:PlanExplanation[];shots:PlanShot[];sound:PlanVoice[];
    teachingSequences:{id:string;mode:string;question:string;technicalSubjectId:string;claimIds:string[];phases:TeachingPhase[];visualStates?:VisualStates}[]};
}

function readable(text:string,max=64):string{
  const chars=Array.from(text.trim());
  return chars.length>max ? chars.slice(0,max-1).join("")+"…" : text.trim();
}
function roleFor(shot:PlanShot,i:number,last:number):NarrativeRole{
  if(i===0)return "hook";
  if(i===last)return "takeaway";
  if(shot.purpose==="prove"||shot.family==="evidence")return "evidence";
  if(shot.purpose==="reveal")return "reveal";
  if(shot.purpose==="compare")return "explanation";
  return i===1?"setup":"explanation";
}
function intentFor(family:string,i:number,last:number):VisualIntent{
  if(i===0)return "question";
  if(i===last)return "takeaway";
  if(family==="cost-breakdown")return "cost-accumulation";
  if(family==="comparison")return "comparison";
  if(family==="evidence")return "evidence";
  return "explanation";
}

export function researchToStoryboard(result:ResearchDraftResult,projectId:string,locale:Locale):SemanticStoryboard{
  const {dossier,plan,quotes}=result;
  if(!/^research_[a-z0-9_-]{1,78}$/iu.test(result.snapshotId)||
    result.snapshotId!==dossier?.id||plan?.researchId!==dossier.id||
    !Array.isArray(dossier?.evidence)||!dossier.evidence.length||
    !Array.isArray(dossier?.claims)||!dossier.claims.length||
    !Array.isArray(plan?.shots)||plan.shots.length<2||
    !Array.isArray(plan?.sound)||!Array.isArray(quotes))throw Error("Research draft is missing a matching captured research and plan.");
  const claimIds=new Set(dossier.claims.map(x=>x.id));
  const sourceIds=new Set(dossier.evidence.map(x=>x.id));
  const referenced=new Map(dossier.claims.map(x=>[x.id,x]));
  const byVoice=new Map(plan.sound.map(x=>[x.shotId,x]));
  const byExplanation=new Map(plan.explanation.map(x=>[x.id,x]));
  const phaseByShot=new Map(plan.teachingSequences.flatMap(seq=>seq.phases.map(phase=>
    [phase.shotId,{phase,sequence:seq}] as const)));
  if(dossier.claims.some(x=>x.status!=="unverified"||!x.sourceRefs.length||x.sourceRefs.some(s=>!sourceIds.has(s)))||
    dossier.claims.some(x=>!quotes.some(q=>q.claimId===x.id&&x.sourceRefs.includes(q.sourceId)&&q.quote.length>=10)))
    throw Error("Draft includes an unsupported or already-approved research claim.");
  if(plan.shots.some(x=>!x.claimIds.every(c=>claimIds.has(c))||!byVoice.has(x.id)||!byExplanation.has(x.explanationId)))
    throw Error("A shot references a missing claim, explanation or narration.");
  const semanticObjects=[...new Set(plan.shots.flatMap(x=>x.subjectIds))].map(id=>({id,label:id.replace(/[_-]/gu," ")}));
  if(!semanticObjects.length)throw Error("Research plan must contain visible semantic subjects.");
  const semanticEvents=[{id:"research-question-opens",label:"Show the motivating question",objectId:plan.shots[0].subjectIds[0]},
    {id:"research-payoff-reveals",label:"Demonstrate the researched takeaway",objectId:plan.shots.at(-1)!.subjectIds[0]}];
  const beats:StoryboardBeat[]=plan.shots.map((shot,i)=>{
    const voice=byVoice.get(shot.id)!;
    const learning=byExplanation.get(shot.explanationId)!;
    const linked=phaseByShot.get(shot.id);
    const phase=linked?.phase,sequence=linked?.sequence;
    const state=sequence?.visualStates && phase &&
      ["problem","mechanism","payoff"].includes(phase.kind) &&
      shot.subjectIds.includes(sequence.technicalSubjectId)
      ? {phase:phase.kind as "problem"|"mechanism"|"payoff",subjectId:sequence.technicalSubjectId,
          sequenceId:sequence.id,
          ...sequence.visualStates} : undefined;
    const isFirst=i===0,isLast=i===plan.shots.length-1;
    const spokenWords=voice.narration.trim().split(/\s+/u).length;
    const durationFrames=Math.min(900,Math.max(150,Math.ceil(spokenWords/2.2)*30+Math.ceil((voice.pauseAfterMs||0)*0.03)));
    return {id:shot.id,role:roleFor(shot,i,plan.shots.length-1),
      objective:phase?.learningChange||learning.after,narration:voice.narration,
      onScreenText:readable(shot.onScreenText),visualIntent:intentFor(shot.family,i,plan.shots.length-1),
      visualObjective:[shot.visualChange,phase?.visualAction].filter(Boolean).join("; "),
      semanticObjects:[...shot.subjectIds],focusTarget:shot.subjectIds[0],durationFrames,
      claimRefs:[...shot.claimIds],namedEvents:isFirst?[semanticEvents[0].id]:isLast?[semanticEvents[1].id]:[],
      staticFallback:`${readable(shot.onScreenText)} — ${shot.visualChange}`,
      ...(state?{teachingState:state}:{}),
      ...(isFirst?{opensQuestion:"research-main-question"}:{}),
      ...(isLast?{answersQuestion:"research-main-question"}:{}),
    };
  });
  const board:SemanticStoryboard={schemaVersion:STORYBOARD_SCHEMA_VERSION,kind:STORYBOARD_KIND,
    id:`storyboard-${projectId}`,title:readable(dossier.topic.title,120),locale,fps:{...DEFAULT_FPS},beats,
    questions:[{id:"research-main-question",text:plan.story.question}],
    claims:dossier.claims.map(x=>({id:x.id,status:"unverified" as const,note:x.text,sourceRefs:x.sourceRefs})),
    semanticObjects,semanticEvents,illustrativeData:false,
    assumptions:["Research-grounded editorial draft only. Exact source quotes are NOT independent fact verification.",
      `Immutable research snapshot: ${result.snapshotId}. Human review required before final production.`,
      ...dossier.evidence.map(s=>`Source ${s.id}: ${s.title} — ${s.sourceUri} (captured ${s.retrievedAt}; SHA-256 ${s.snapshotSha256}).`),
      ...dossier.gaps.map(g=>`Research gap: ${g}`)],
  };
  const errors=validateStoryboard(board).filter(x=>x.severity==="error");
  if(errors.length)throw Error("Research storyboard invalid: "+errors.map(x=>x.code).join(", "));
  if([...referenced.values()].some(x=>!board.claims.some(c=>c.id===x.id)))throw Error("Lost researched claim.");
  return board;
}

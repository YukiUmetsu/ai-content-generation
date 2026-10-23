/**
 * Deterministic structural + narrative checks for the authoring model.
 *
 * These checks are intentionally independent of React and of Kumiki. They never
 * throw and they never invent a score: each finding is an actionable statement
 * with a stable code, severity and optional beat/question reference. Kumiki's
 * lower-level validator runs again on the compiled projection.
 */

import { estimateNarration } from "./timeline";
import {validateVisualMechanic} from "../../../../scripts/video-production/semantic-mechanic.mjs";
import {
  MAX_ON_SCREEN_CHARS,
  isTeachingVisualState,
  isPositiveInteger,
  type SemanticStoryboard,
  type StoryboardBeat,
} from "./types";

export type DiagnosticSeverity = "error" | "warning";

export interface StoryboardDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  beatId?: string;
  questionId?: string;
  path: string;
  params?: Record<string, string | number>;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function validateStoryboard(board: SemanticStoryboard): StoryboardDiagnostic[] {
  const diagnostics: StoryboardDiagnostic[] = [];
  const beats = Array.isArray(board.beats) ? board.beats : [];

  if (beats.length === 0) {
    diagnostics.push({
      code: "storyboard-no-beats",
      severity: "error",
      path: "beats",
    });
  }

  if (!(isPositiveInteger(board.fps?.num) && isPositiveInteger(board.fps?.den))) {
    diagnostics.push({
      code: "storyboard-invalid-fps",
      severity: "error",
      path: "fps",
    });
  }

  if (beats.length > 0 && beats[0].role !== "hook") {
    diagnostics.push({
      code: "storyboard-no-opening-hook",
      severity: "warning",
      beatId: beats[0].id,
      path: "beats[0].role",
    });
  }

  const knownObjects = new Set(board.semanticObjects.map((object) => object.id));
  const knownEvents = new Map(board.semanticEvents.map((event) => [event.id, event]));
  const knownClaims = new Map(board.claims.map((claim) => [claim.id, claim]));
  const knownQuestions = new Set(board.questions.map((question) => question.id));
  const answeredQuestions = new Set(
    beats.map((beat) => beat.answersQuestion).filter((id): id is string => hasText(id))
  );
  const seenBeatIds = new Set<string>();
  const teachingSequences = new Map<string,{subjectId:string;before:string;action:string;after:string}>();
  const teachingMechanics=new Map<string,string>();

  const addForBeat = (
    beat: StoryboardBeat,
    code: string,
    severity: DiagnosticSeverity,
    path: string,
    params?: Record<string, string | number>
  ): void => {
    diagnostics.push({ code, severity, beatId: beat.id, path, params });
  };

  for (const [index, beat] of beats.entries()) {
    const path = `beats[${index}]`;

    if (!hasText(beat.id)) {
      addForBeat(beat, "storyboard-beat-id-missing", "error", `${path}.id`, { index: index + 1 });
    } else if (seenBeatIds.has(beat.id)) {
      addForBeat(beat, "storyboard-duplicate-beat-id", "error", `${path}.id`, { id: beat.id });
    } else {
      seenBeatIds.add(beat.id);
    }

    if (!isPositiveInteger(beat.durationFrames)) {
      addForBeat(beat, "storyboard-invalid-duration", "error", `${path}.durationFrames`, {
        id: beat.id,
        value: String(beat.durationFrames),
      });
    }

    if (!hasText(beat.narration)) {
      addForBeat(beat, "storyboard-narration-missing", "warning", `${path}.narration`, { id: beat.id });
    }

    if (!hasText(beat.objective)) {
      addForBeat(beat, "storyboard-objective-missing", "warning", `${path}.objective`, { id: beat.id });
    }

    if (!hasText(beat.visualObjective)) {
      addForBeat(beat, "storyboard-visual-objective-missing", "warning", `${path}.visualObjective`, {
        id: beat.id,
      });
    }

    if (!hasText(beat.onScreenText)) {
      addForBeat(beat, "storyboard-on-screen-text-missing", "warning", `${path}.onScreenText`, {
        id: beat.id,
      });
    } else {
      const length = Array.from(beat.onScreenText.trim()).length;
      if (length > MAX_ON_SCREEN_CHARS) {
        addForBeat(beat, "storyboard-on-screen-text-long", "warning", `${path}.onScreenText`, {
          id: beat.id,
          count: length,
          max: MAX_ON_SCREEN_CHARS,
        });
      }
    }

    if (!hasText(beat.focusTarget)) {
      addForBeat(beat, "storyboard-focus-missing", "warning", `${path}.focusTarget`, { id: beat.id });
    }

    if (hasText(beat.cameraIntent) && !hasText(beat.focusTarget)) {
      addForBeat(beat, "storyboard-camera-without-focus", "warning", `${path}.cameraIntent`, {
        id: beat.id,
      });
    }

    if (!hasText(beat.staticFallback)) {
      addForBeat(beat, "storyboard-static-fallback-missing", "warning", `${path}.staticFallback`, {
        id: beat.id,
      });
    }

    if (beat.teachingState !== undefined) {
      if (!isTeachingVisualState(beat.teachingState) ||
        !beat.semanticObjects.includes(beat.teachingState.subjectId)) {
        addForBeat(beat, "storyboard-teaching-state-invalid", "error", `${path}.teachingState`);
      } else if (beat.teachingState.sequenceId) {
        const {sequenceId,subjectId,before,action,after}=beat.teachingState;
        const expected=teachingSequences.get(sequenceId);
        if(expected && (expected.subjectId!==subjectId || expected.before!==before ||
          expected.action!==action || expected.after!==after))
          addForBeat(beat, "storyboard-teaching-state-diverged", "error", `${path}.teachingState`);
        else if(!expected)teachingSequences.set(sequenceId,{subjectId,before,action,after});
      }
    }

    if(beat.teachingMechanic!==undefined){
      const authored=beat.teachingMechanic,mechanic=authored.mechanic;
      const result=validateVisualMechanic(mechanic,{
        technicalSubjectId:mechanic?.subjectId,
        knownClaimIds:new Set(board.claims.map(c=>c.id)),knownAssetKeys:new Set()
      });
      for(const issue of result.findings)
        addForBeat(beat,`storyboard-${issue.code}`,"error",`${path}.teachingMechanic.${issue.path}`);
      if(!["problem","mechanism","payoff"].includes(authored.phase)||
        !beat.semanticObjects.includes(mechanic?.subjectId)||
        !Array.isArray(mechanic?.actors)||
        !mechanic.actors.some(a=>a.claimIds?.some(c=>beat.claimRefs.includes(c))))
        addForBeat(beat,"storyboard-mechanic-unlinked","error",`${path}.teachingMechanic`);
      if(authored.sequenceId){
        const key=JSON.stringify(mechanic),previous=teachingMechanics.get(authored.sequenceId);
        if(previous!==undefined&&previous!==key)
          addForBeat(beat,"storyboard-mechanic-diverged","error",`${path}.teachingMechanic`);
        else if(previous===undefined)teachingMechanics.set(authored.sequenceId,key);
      }
    }

    for (const objectId of beat.semanticObjects) {
      if (!knownObjects.has(objectId)) {
        addForBeat(beat, "storyboard-object-unknown", "warning", `${path}.semanticObjects`, {
          id: beat.id,
          objectId,
        });
      }
    }

    for (const claimId of beat.claimRefs) {
      const claim = knownClaims.get(claimId);
      if (!claim) {
        addForBeat(beat, "storyboard-claim-unknown", "warning", `${path}.claimRefs`, {
          id: beat.id,
          claimId,
        });
        continue;
      }
      if (claim.status === "unverified" || (claim.status === "sourced" && claim.sourceRefs.length === 0)) {
        addForBeat(beat, "storyboard-claim-unresolved", "warning", `${path}.claimRefs`, {
          id: beat.id,
          claimId,
          status: claim.status,
        });
      }
    }

    for (const eventId of beat.namedEvents) {
      const event = knownEvents.get(eventId);
      if (!event) {
        addForBeat(beat, "storyboard-event-without-object", "warning", `${path}.namedEvents`, {
          id: beat.id,
          eventId,
        });
      } else if (!beat.semanticObjects.includes(event.objectId)) {
        addForBeat(beat, "storyboard-event-without-object", "warning", `${path}.namedEvents`, {
          id: beat.id,
          eventId,
          objectId: event.objectId,
        });
      }
    }

    if (hasText(beat.opensQuestion) && !knownQuestions.has(beat.opensQuestion)) {
      addForBeat(beat, "storyboard-opens-question-unknown", "warning", `${path}.opensQuestion`, {
        id: beat.id,
        questionId: beat.opensQuestion,
      });
    }

    if (hasText(beat.answersQuestion) && !knownQuestions.has(beat.answersQuestion)) {
      addForBeat(beat, "storyboard-question-unknown", "warning", `${path}.answersQuestion`, {
        id: beat.id,
        questionId: beat.answersQuestion,
      });
    }

    if (hasText(beat.narration) && isPositiveInteger(beat.durationFrames)) {
      const estimate = estimateNarration(beat, board.fps, board.locale);
      if (estimate.status === "over") {
        addForBeat(beat, "storyboard-narration-over-budget", "warning", `${path}.durationFrames`, {
          id: beat.id,
          estimate: estimate.estimatedSeconds.toFixed(1),
          allotted: estimate.allottedSeconds.toFixed(1),
        });
      }
    }
  }

  for (const [index, question] of board.questions.entries()) {
    if (!answeredQuestions.has(question.id)) {
      diagnostics.push({
        code: "storyboard-question-unanswered",
        severity: "warning",
        questionId: question.id,
        path: `questions[${index}]`,
        params: { questionId: question.id, text: question.text },
      });
    }
  }

  if (
    !board.illustrativeData &&
    board.claims.some((claim) => claim.status === "illustrative")
  ) {
    diagnostics.push({
      code: "storyboard-illustrative-unlabeled",
      severity: "warning",
      path: "illustrativeData",
    });
  }

  return diagnostics;
}

export function countBySeverity(
  diagnostics: StoryboardDiagnostic[]
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

export function diagnosticsForBeat(
  diagnostics: StoryboardDiagnostic[],
  beatId: string
): StoryboardDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.beatId === beatId);
}

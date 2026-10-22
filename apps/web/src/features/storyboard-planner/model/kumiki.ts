/**
 * Adapter from ContentGen's semantic authoring document to Kumiki's implemented
 * `Storyboard` / `StoryboardShot` contract (vendored at the pinned commit).
 *
 * It is deliberately a *projection*, not a composition: fields Kumiki's shot
 * model cannot represent (camera intent, claim provenance, named semantic
 * events, questions) stay in the authoring document and are reported as
 * adapter notes. No scene, keyframe or media clock is invented here.
 */

import {
  createStoryboard,
  toStoryboardCues,
  validateStoryboard,
  type Storyboard,
  type StoryboardShot,
} from "@/components/motion/storyboard";
import type { Diagnostic, MotionCue } from "@/components/motion/types";
import { canonicalJson } from "./serialize";
import { computeTimeline } from "./timeline";
import type { SemanticStoryboard, StoryboardBeat } from "./types";

export type AdapterNoteCode =
  | "camera-intent-unmapped"
  | "claim-provenance-authoring-only"
  | "semantic-events-authoring-only"
  | "questions-authoring-only";

export interface AdapterNote {
  code: AdapterNoteCode;
  beatId?: string;
}

export interface KumikiProjection {
  storyboard: Storyboard;
  cues: MotionCue[];
  diagnostics: Diagnostic[];
  notes: AdapterNote[];
}

function shotFor(beat: StoryboardBeat, startFrame: number): StoryboardShot {
  const onScreen = beat.onScreenText.trim();
  const shot: StoryboardShot = {
    id: beat.id,
    sceneRef: `scene-${beat.id}`,
    startFrame,
    durationFrames: beat.durationFrames,
    // `objective` is the one coherent proposition; it maps to Kumiki `claim`.
    claim: beat.objective.trim(),
    visualObjective: beat.visualObjective.trim(),
    focusTarget: beat.focusTarget.trim(),
    onScreenLabels: onScreen === "" ? [] : [beat.onScreenText],
  };
  if (beat.narrationCueId !== undefined && beat.narrationCueId.trim() !== "") {
    shot.narrationCue = beat.narrationCueId;
  }
  if (beat.staticFallback.trim() !== "") {
    shot.staticFallback = beat.staticFallback;
  }
  return shot;
}

export function compileToKumiki(board: SemanticStoryboard): KumikiProjection {
  const timeline = computeTimeline(board.beats, board.fps);
  const shots = board.beats.map((beat, index) => shotFor(beat, timeline.entries[index].startFrame));

  const storyboard = createStoryboard({
    id: board.id,
    title: board.title,
    fps: board.fps,
    shots,
    durationFrames: timeline.totalFrames,
  });

  const cues = toStoryboardCues(storyboard);
  // Include generated cues (shot starts + narration anchors) so a valid
  // narration reference is not reported as unresolved.
  const diagnostics = validateStoryboard(storyboard, {
    knownCues: cues.map((cue) => cue.id),
  });

  const notes: AdapterNote[] = [];
  for (const beat of board.beats) {
    if (beat.cameraIntent !== undefined && beat.cameraIntent.trim() !== "") {
      notes.push({ code: "camera-intent-unmapped", beatId: beat.id });
    }
  }
  if (board.claims.length > 0) notes.push({ code: "claim-provenance-authoring-only" });
  if (board.semanticEvents.length > 0) notes.push({ code: "semantic-events-authoring-only" });
  if (board.questions.length > 0) notes.push({ code: "questions-authoring-only" });

  return { storyboard, cues, diagnostics, notes };
}

/** Deterministic JSON projection for inspection, review or a later adapter. */
export function serializeKumikiProjection(board: SemanticStoryboard): string {
  const projection = compileToKumiki(board);
  return canonicalJson({
    kind: "contentgen-kumiki-storyboard-projection",
    schemaVersion: 1,
    adapter: "storyboard-planner.kumiki-projection.v1",
    sourceId: board.id,
    storyboard: projection.storyboard,
    diagnostics: projection.diagnostics,
    notes: projection.notes,
  });
}

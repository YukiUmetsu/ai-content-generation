/**
 * Pure, immutable beat operations. UI state changes never rely on array index
 * as identity: every operation preserves each beat's stable id and content.
 */

import {
  DEFAULT_FPS,
  STORYBOARD_KIND,
  STORYBOARD_SCHEMA_VERSION,
  type SemanticStoryboard,
  type StoryboardBeat,
  type TeachingVisualState,
} from "./types";

function nextNumericSuffix(board: SemanticStoryboard): number {
  let max = 0;
  for (const beat of board.beats) {
    const match = /^beat-(\d+)$/.exec(beat.id);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return max + 1;
}

export function nextBeatId(board: SemanticStoryboard): string {
  const existing = new Set(board.beats.map((beat) => beat.id));
  let suffix = nextNumericSuffix(board);
  let candidate = `beat-${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `beat-${suffix}`;
  }
  return candidate;
}

export function createBeat(
  board: SemanticStoryboard,
  patch: Partial<StoryboardBeat> = {}
): StoryboardBeat {
  return {
    id: nextBeatId(board),
    role: "explanation",
    objective: "",
    narration: "",
    onScreenText: "",
    visualIntent: "explanation",
    visualObjective: "",
    semanticObjects: [],
    focusTarget: "",
    durationFrames: 90,
    claimRefs: [],
    namedEvents: [],
    staticFallback: "",
    ...patch,
  };
}

export function emptyStoryboard(): SemanticStoryboard {
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    kind: STORYBOARD_KIND,
    id: "storyboard-untitled",
    title: "Untitled storyboard",
    locale: "en",
    fps: { ...DEFAULT_FPS },
    beats: [],
    questions: [],
    claims: [],
    semanticObjects: [],
    semanticEvents: [],
    assumptions: [],
    illustrativeData: false,
  };
}

export function insertBeat(
  board: SemanticStoryboard,
  beat: StoryboardBeat,
  index: number = board.beats.length
): SemanticStoryboard {
  const beats = [...board.beats];
  const at = Math.max(0, Math.min(beats.length, Math.round(index)));
  beats.splice(at, 0, beat);
  return { ...board, beats };
}

export function deleteBeat(board: SemanticStoryboard, beatId: string): SemanticStoryboard {
  const beats = board.beats.filter((beat) => beat.id !== beatId);
  if (beats.length === board.beats.length) return board;
  return { ...board, beats };
}

/** Move a beat to a new index (0-based). Out-of-range indices clamp. */
export function reorderBeat(
  board: SemanticStoryboard,
  fromIndex: number,
  toIndex: number
): SemanticStoryboard {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= board.beats.length) {
    return board;
  }
  const beats = [...board.beats];
  const [moved] = beats.splice(fromIndex, 1);
  const at = Math.max(0, Math.min(beats.length, Math.round(toIndex)));
  beats.splice(at, 0, moved);
  return { ...board, beats };
}

export function moveBeat(
  board: SemanticStoryboard,
  beatId: string,
  direction: -1 | 1
): SemanticStoryboard {
  const index = board.beats.findIndex((beat) => beat.id === beatId);
  if (index < 0) return board;
  const target = index + direction;
  if (target < 0 || target >= board.beats.length) return board;
  return reorderBeat(board, index, target);
}

/** Shallow merge one beat. Only the supplied fields change. */
export function updateBeat(
  board: SemanticStoryboard,
  beatId: string,
  patch: Partial<StoryboardBeat>
): SemanticStoryboard {
  let changed = false;
  const beats = board.beats.map((beat) => {
    if (beat.id !== beatId) return beat;
    changed = true;
    return { ...beat, ...patch, id: beat.id };
  });
  return changed ? { ...board, beats } : board;
}

/** Keep all three phases of one authored teaching sequence semantically aligned.
 * Each beat owns its phase/timing, but their before/action/after copy is shared.
 */
export function updateTeachingState(board:SemanticStoryboard,beatId:string,next:TeachingVisualState):SemanticStoryboard{
  const selected=board.beats.find(beat=>beat.id===beatId);
  if(!selected?.teachingState)return board;
  const sequenceId=selected.teachingState.sequenceId;
  if(!sequenceId||next.sequenceId!==sequenceId||next.subjectId!==selected.teachingState.subjectId)
    return updateBeat(board,beatId,{teachingState:next});
  return {...board,beats:board.beats.map(beat=>{
    const previous=beat.teachingState;
    if(!previous||previous.sequenceId!==sequenceId)return beat;
    return {...beat,teachingState:{...previous,before:next.before,action:next.action,after:next.after}};
  })};
}

/**
 * Accepts the raw value so an invalid (zero/negative/fractional) entry can be
 * represented in the editor and reported by validation instead of being
 * silently repaired.
 */
export function setBeatDuration(
  board: SemanticStoryboard,
  beatId: string,
  durationFrames: number
): SemanticStoryboard {
  return updateBeat(board, beatId, { durationFrames });
}

export function duplicateBeat(
  board: SemanticStoryboard,
  beatId: string
): SemanticStoryboard {
  const index = board.beats.findIndex((beat) => beat.id === beatId);
  if (index < 0) return board;
  const source = board.beats[index];
  const detached=source.teachingState?{...source.teachingState}:undefined;
  if(detached)delete detached.sequenceId;
  const copy: StoryboardBeat = {
    ...source,
    id: nextBeatId(board),
    semanticObjects: [...source.semanticObjects],
    claimRefs: [...source.claimRefs],
    namedEvents: [...source.namedEvents],
    ...(detached?{teachingState:detached}:{}),
  };
  return insertBeat(board, copy, index + 1);
}

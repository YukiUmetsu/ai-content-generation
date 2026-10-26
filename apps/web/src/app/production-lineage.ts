import type {SemanticStoryboard} from "@/features/storyboard-planner/model/types";
/** Only an exact script + editable outline can claim a saved render as current. */
export function productionMediaSource(scriptRevision:string,board:SemanticStoryboard):string {
  const raw=JSON.stringify(board);
  let hash=2166136261;
  for(let i=0;i<raw.length;i++)hash=Math.imul(hash^raw.charCodeAt(i),16777619)>>>0;
  return `approved-script:${scriptRevision}:board-${hash.toString(16)}:`;
}

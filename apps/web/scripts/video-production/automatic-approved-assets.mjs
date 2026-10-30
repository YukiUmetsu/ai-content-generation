/** Choose only already imported, rights-reviewed, SHA-verified Pexels media.
 * No metadata-only search result becomes a trusted downloadable asset.
 * A manual pin always wins and is never written or cleared by automation.
 */
import { rankShotCandidates } from "./asset-matching.mjs";

export function withAutomaticApprovedMedia(selected, approved, shotMap, bundle) {
  if (!Array.isArray(selected?.selections) || !Array.isArray(selected?.invalidShots) ||
    !Array.isArray(approved) || !Array.isArray(shotMap)) {
    throw Error("Approved scene media catalog is invalid.");
  }
  const occupied = new Set([...selected.selections.map(s => s.shotId),...selected.invalidShots]);
  const used = new Set(selected.selections.map(s => s.sha256));
  const shots = new Map((bundle?.plan?.shots ?? []).map(shot => [shot.id,shot]));
  const sound = new Map((bundle?.plan?.sound ?? []).map(item => [item.shotId,item]));
  const automatic = [];
  for(const {shotId} of shotMap) {
    if(occupied.has(shotId)) continue;
    const candidateAssets = approved.filter(item => item.shotId === shotId &&
      item.provider === "pexels" && ["photo","video"].includes(item.assetType) &&
      item.rightsStatus === "user-reviewed" && !used.has(item.sha256));
    if (!candidateAssets.length || !shots.has(shotId)) continue;
    const results = rankShotCandidates({shot:shots.get(shotId),narration:sound.get(shotId),
      candidates:candidateAssets,destination:"landscape"});
    const best = results.candidates.find(item => item.match.grade === "strong" && item.match.score >= 40);
    if (!best) continue;
    used.add(best.sha256);
    automatic.push({...best,automaticallySelected:true});
  }
  return {...selected,selections:[...selected.selections,...automatic]};
}

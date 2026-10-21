/**
 * Motion core — deterministic stagger ordering (docs/08 §2).
 *
 * Given a list of items, `staggerOrder` assigns a rank to every index; the rank
 * multiplied by `intervalFrames` gives the item's start offset. Items may be
 * grouped, and later groups start after earlier groups.
 */

import type { StaggerDirection } from "./types";

/**
 * Rank per index for `count` items.
 *
 * - `forward`: `0..count-1`
 * - `reverse`: `count-1..0`
 * - `from-center`: sorted by distance from the middle, ties lower index first
 * - `from-edges`: sorted by distance from the nearest end, ties lower index first
 */
export function staggerOrder(count: number, direction: StaggerDirection): number[] {
  const size = Math.max(0, Math.trunc(count));
  const ranks = new Array<number>(size);

  if (direction === "forward") {
    for (let i = 0; i < size; i += 1) ranks[i] = i;
    return ranks;
  }
  if (direction === "reverse") {
    for (let i = 0; i < size; i += 1) ranks[i] = size - 1 - i;
    return ranks;
  }

  const center = (size - 1) / 2;
  const indices = Array.from({ length: size }, (_, i) => i);
  const distance = (i: number): number =>
    direction === "from-center" ? Math.abs(i - center) : Math.min(i, size - 1 - i);

  indices.sort((x, y) => {
    const dx = distance(x);
    const dy = distance(y);
    if (dx !== dy) return dx - dy;
    return x - y;
  });

  for (let rank = 0; rank < indices.length; rank += 1) {
    ranks[indices[rank]] = rank;
  }
  return ranks;
}

/**
 * Start frame for every item.
 *
 * Items are grouped by `group` (ascending, stable; `undefined` = group `0`).
 * Within each group the rank comes from {@link staggerOrder}; across groups each
 * new group is offset by the previous group's span plus `groupSpacingFrames`.
 */
export function staggerStartFrames(
  items: { group?: number }[],
  intervalFrames: number,
  direction: StaggerDirection,
  groupSpacingFrames = 0,
): number[] {
  const result = new Array<number>(items.length).fill(0);
  if (items.length === 0) return result;

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i += 1) {
    const group = items[i].group ?? 0;
    const members = groups.get(group);
    if (members) members.push(i);
    else groups.set(group, [i]);
  }

  const orderedGroups = [...groups.keys()].sort((x, y) => x - y);
  let base = 0;
  for (const group of orderedGroups) {
    const members = groups.get(group)!;
    const ranks = staggerOrder(members.length, direction);
    for (let k = 0; k < members.length; k += 1) {
      result[members[k]] = base + ranks[k] * intervalFrames;
    }
    const span = Math.max(0, members.length - 1) * intervalFrames;
    base += span + groupSpacingFrames;
  }
  return result;
}

/**
 * Layout engines: `editorial-grid` and `bento-grid`.
 *
 * These two answer different questions and refuse to be each other:
 *
 * - **editorial-grid** is *composed*: the author states an asymmetric column/row
 *   rhythm (plus an optional pinned focal region) and content is poured into the
 *   resulting cells in reading order. Vertical rhythm can be snapped to a
 *   baseline so headings and body copy across cells sit on the same lines.
 * - **bento-grid** is *packed*: tiles declare how much room they need and how
 *   much they may claim, and a deterministic packer decides where they land.
 *   Salience drives the order, so the hero tile gets first refusal on space.
 *
 * Neither engine scales content to fit. When a constraint cannot be satisfied
 * they emit a diagnostic and either degrade predictably (editorial: a single
 * cell) or report the tile as unplaced (bento), because silently shrinking
 * essential copy is exactly what docs/12 §5 forbids.
 */

import {
  clamp,
  gridCells,
  overlapArea,
  rectBottom,
  rectRight,
  round,
  splitColumns,
  splitRows,
} from "./primitives";
import type {
  Importance,
  InfographicPrimitive,
  RectInfo,
  SectionRenderContext,
} from "./types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Round a measurement to the nearest multiple of `baseline`. */
export function snapToBaseline(value: number, baseline: number): number {
  if (!(baseline > 0)) return round(value);
  return round(Math.round(value / baseline) * baseline);
}

/** Accumulated vertical offsets for row weights, snapped so tops share a baseline. */
export function baselineTops(
  area: RectInfo,
  weights: readonly number[],
  rowGap: number,
  baseline: number
): number[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0) || 1;
  const usable = Math.max(0, area.height - rowGap * (weights.length - 1));
  const tops: number[] = [];
  let cursor = area.y;
  for (const weight of weights) {
    const y = baseline > 0 ? snapToBaseline(cursor, baseline) : round(cursor);
    tops.push(round(Math.min(y, rectBottom(area))));
    cursor += (usable * Math.max(0, weight)) / total + rowGap;
  }
  return tops;
}

function reportImpossible(
  context: SectionRenderContext,
  sectionId: string | undefined,
  message: string
): void {
  context.report({
    code: "grid-impossible",
    severity: "error",
    message,
    sectionId,
  });
}

// ---------------------------------------------------------------------------
// editorial-grid
// ---------------------------------------------------------------------------

export interface EditorialFocal {
  /** Zero-based column where the focal region starts. */
  column: number;
  /** Zero-based row where the focal region starts. */
  row: number;
  /** @default 1 */
  columnSpan?: number;
  /** @default 1 */
  rowSpan?: number;
}

export interface EditorialGridSpec {
  id: string;
  /** Column weights, e.g. `[2, 1, 1]` for a wide lead column. At least one entry. */
  columns: readonly number[];
  /** Row weights. @default [1] */
  rows?: readonly number[];
  /** Gutter between columns. @default style.spacing[3] */
  gap?: number;
  /** Gutter between rows. @default gap */
  rowGap?: number;
  /**
   * Snap cell tops to this vertical rhythm (design px). `0` disables snapping.
   * @default 0
   */
  baseline?: number;
  /** Optional pinned focal region. Its cells are removed from the content flow. */
  focal?: EditorialFocal;
  /** Explicit content order for the remaining cells (`"<column>:<row>"` keys). */
  order?: readonly string[];
}

export interface EditorialGridCell {
  /** Stable cell key: `"<column>:<row>"`, or `"focal"` for the pinned region. */
  key: string;
  box: RectInfo;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  /** True for the pinned focal region. */
  focal: boolean;
}

export interface EditorialGridResult {
  area: RectInfo;
  columnRects: RectInfo[];
  rowRects: RectInfo[];
  /** Content cells in reading order (focal first when present). */
  cells: EditorialGridCell[];
  focal: EditorialGridCell | null;
  baseline: number;
}

/**
 * Build an asymmetric editorial grid and hand back its cells in reading order.
 *
 * Reading order is the guarantee that matters: after a reflow the same content
 * list maps onto the same sequence of cells, so a heading can never end up
 * beneath the body it introduces.
 */
export function editorialGrid(
  area: RectInfo,
  spec: EditorialGridSpec,
  context: SectionRenderContext
): EditorialGridResult {
  const style = context.style;
  const gap = spec.gap ?? style.spacing[3];
  const rowGap = spec.rowGap ?? gap;
  const baseline = spec.baseline ?? 0;

  const columnWeights = spec.columns.filter((weight) => Number.isFinite(weight));
  const rowWeights = (spec.rows ?? [1]).filter((weight) => Number.isFinite(weight));

  const degenerate = (message: string): EditorialGridResult => {
    reportImpossible(context, spec.id, message);
    const cell: EditorialGridCell = {
      key: "0:0",
      box: area,
      column: 0,
      row: 0,
      columnSpan: 1,
      rowSpan: 1,
      focal: false,
    };
    return {
      area,
      columnRects: [area],
      rowRects: [area],
      cells: [cell],
      focal: null,
      baseline,
    };
  };

  if (columnWeights.length === 0) {
    return degenerate("editorial-grid needs at least one column.");
  }
  if (rowWeights.length === 0) {
    return degenerate("editorial-grid needs at least one row.");
  }
  const totalGapX = gap * (columnWeights.length - 1);
  const totalGapY = rowGap * (rowWeights.length - 1);
  if (totalGapX >= area.width || totalGapY >= area.height) {
    return degenerate(
      `editorial-grid gutters (${round(totalGapX)}×${round(totalGapY)}px) do not fit the available area (${round(area.width)}×${round(area.height)}px).`
    );
  }

  const columnRects = splitColumns(area, columnWeights, gap);
  let rowRects = splitRows(area, rowWeights, rowGap);

  if (baseline > 0 && rowRects.length > 1) {
    const tops = baselineTops(area, rowWeights, rowGap, baseline);
    rowRects = rowRects.map((rect, index) => {
      const next = index + 1 < rowRects.length ? rectBottom(rowRects[index + 1]) - rowGap : rectBottom(area);
      const top = tops[index];
      return { x: rect.x, y: top, width: rect.width, height: round(Math.max(0, next - top)) };
    });
  }

  const columns = columnRects.length;
  const rows = rowRects.length;

  // Validate the focal region before it is used to punch holes in the grid.
  let focalCell: EditorialGridCell | null = null;
  if (spec.focal) {
    const columnSpan = spec.focal.columnSpan ?? 1;
    const rowSpan = spec.focal.rowSpan ?? 1;
    const fitsColumns = spec.focal.column >= 0 && spec.focal.column + columnSpan <= columns;
    const fitsRows = spec.focal.row >= 0 && spec.focal.row + rowSpan <= rows;
    if (!fitsColumns || !fitsRows) {
      reportImpossible(
        context,
        spec.id,
        `Focal region ${columnSpan}×${rowSpan} at (${spec.focal.column},${spec.focal.row}) exceeds the ${columns}×${rows} grid.`
      );
    } else {
      const first = columnRects[spec.focal.column];
      const last = columnRects[spec.focal.column + columnSpan - 1];
      const top = rowRects[spec.focal.row];
      const bottom = rowRects[spec.focal.row + rowSpan - 1];
      focalCell = {
        key: "focal",
        box: {
          x: first.x,
          y: top.y,
          width: round(rectRight(last) - first.x),
          height: round(rectBottom(bottom) - top.y),
        },
        column: spec.focal.column,
        row: spec.focal.row,
        columnSpan,
        rowSpan,
        focal: true,
      };
    }
  }

  const covered = (column: number, row: number): boolean =>
    Boolean(
      focalCell &&
        column >= focalCell.column &&
        column < focalCell.column + focalCell.columnSpan &&
        row >= focalCell.row &&
        row < focalCell.row + focalCell.rowSpan
    );

  const reading: EditorialGridCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (covered(column, row)) continue;
      reading.push({
        key: `${column}:${row}`,
        box: columnRects[column] && rowRects[row]
          ? {
              x: columnRects[column].x,
              y: rowRects[row].y,
              width: columnRects[column].width,
              height: rowRects[row].height,
            }
          : { x: area.x, y: area.y, width: 0, height: 0 },
        column,
        row,
        columnSpan: 1,
        rowSpan: 1,
        focal: false,
      });
    }
  }

  const ordered = spec.order
    ? [
        ...spec.order
          .map((key) => reading.find((cell) => cell.key === key))
          .filter((cell): cell is EditorialGridCell => Boolean(cell)),
        ...reading.filter((cell) => !spec.order?.includes(cell.key)),
      ]
    : reading;

  return {
    area,
    columnRects,
    rowRects,
    cells: focalCell ? [focalCell, ...ordered] : ordered,
    focal: focalCell,
    baseline,
  };
}

/** How many content cells an editorial grid offers, focal region excluded. */
export function editorialCellCount(result: EditorialGridResult): number {
  return result.cells.filter((cell) => !cell.focal).length;
}

// ---------------------------------------------------------------------------
// bento-grid
// ---------------------------------------------------------------------------

export interface BentoSpan {
  columns?: number;
  rows?: number;
}

export interface BentoTile {
  id: string;
  /** Drives packing order and default spans. @default "supporting" */
  importance?: Importance;
  /** Explicit authored span. Clamped to `minSpan`/`maxSpan` and the grid. */
  span?: BentoSpan;
  /** @default { columns: 1, rows: 1 } */
  minSpan?: BentoSpan;
  /** @default { columns: tileColumns, rows: Infinity } */
  maxSpan?: BentoSpan;
  /** Preferred width ÷ height of the tile. Used to derive the row span. */
  aspect?: number;
  /**
   * Smallest box the tile's essential copy needs. A tile is never silently
   * cropped below this: the packer reports `bento-content-minimum` instead.
   */
  minContent?: { width: number; height: number };
  /** Higher packs first within the same importance tier. */
  priority?: number;
}

export interface BentoGridSpec {
  id: string;
  /** Fixed column count. */
  columns: number;
  tiles: readonly BentoTile[];
  /** Gutter between tiles. @default style.spacing[2] */
  gap?: number;
  /** Row height. @default derived from the widest tile aspect (0.62 fallback) */
  rowHeight?: number;
  /** Fraction of the column width a tile spans by default if it declares none. @default 1 */
  defaultColumns?: number;
}

export interface BentoTilePlacement {
  id: string;
  box: RectInfo;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  importance: Importance;
  /** True when `minContent` could not be honoured inside the area. */
  compromised: boolean;
}

export interface BentoGridResult {
  area: RectInfo;
  /** Placement rects in packing order. */
  placements: BentoTilePlacement[];
  /** Convenience lookup, keyed by tile id. */
  byId: Record<string, BentoTilePlacement>;
  /** Tiles that could not be placed inside `area`. */
  unplaced: string[];
  rows: number;
  columnWidth: number;
  rowHeight: number;
  usedHeight: number;
}

const IMPORTANCE_RANK: Record<Importance, number> = { hero: 0, supporting: 1, detail: 2 };

const IMPORTANCE_COLUMNS: Record<Importance, number> = { hero: 2, supporting: 1, detail: 1 };

/** Default row height for a bento grid: a plausible tile proportion of a column. */
export function bentoRowHeight(
  area: RectInfo,
  columns: number,
  gap: number,
  fallbackAspect = 1.6
): number {
  const columnWidth = (area.width - gap * (columns - 1)) / columns;
  return round(Math.max(1, columnWidth / Math.max(0.1, fallbackAspect)));
}

interface Occupancy {
  rows: number;
  columns: number;
  taken: boolean[][];
}

function ensureRows(occupancy: Occupancy, row: number): void {
  while (occupancy.rows <= row) {
    occupancy.taken.push(new Array(occupancy.columns).fill(false));
    occupancy.rows += 1;
  }
}

function isFree(occupancy: Occupancy, column: number, row: number, columnSpan: number, rowSpan: number): boolean {
  if (column + columnSpan > occupancy.columns) return false;
  for (let r = row; r < row + rowSpan; r += 1) {
    for (let c = column; c < column + columnSpan; c += 1) {
      if (occupancy.taken[r]?.[c]) return false;
    }
  }
  return true;
}

function occupy(occupancy: Occupancy, column: number, row: number, columnSpan: number, rowSpan: number): void {
  ensureRows(occupancy, row + rowSpan - 1);
  for (let r = row; r < row + rowSpan; r += 1) {
    for (let c = column; c < column + columnSpan; c += 1) {
      occupancy.taken[r][c] = true;
    }
  }
}

/**
 * Pack bento tiles into a fixed-column grid.
 *
 * The algorithm is deliberately simple and fully deterministic: tiles are
 * ordered hero → supporting → detail (then priority, then authored order), and
 * each tile takes the first row-major slot where its span fits. That keeps
 * layouts reproducible frame-for-frame while still letting importance drive who
 * gets the good space.
 */
export function bentoGrid(
  area: RectInfo,
  spec: BentoGridSpec,
  context: SectionRenderContext
): BentoGridResult {
  const style = context.style;
  const gap = spec.gap ?? style.spacing[2];
  const columns = Math.max(1, Math.floor(spec.columns));

  if (spec.tiles.length === 0) {
    context.report({
      code: "bento-empty",
      severity: "error",
      message: "bento-grid was given no tiles.",
      sectionId: spec.id,
    });
    return {
      area,
      placements: [],
      byId: {},
      unplaced: [],
      rows: 0,
      columnWidth: area.width,
      rowHeight: 0,
      usedHeight: 0,
    };
  }

  const columnWidth = (area.width - gap * (columns - 1)) / columns;
  const explicitRowHeight = spec.rowHeight;
  const aspectFallback =
    spec.tiles.find((tile) => tile.aspect && tile.aspect > 0)?.aspect ?? 1.6;
  const rowHeight = explicitRowHeight ?? bentoRowHeight(area, columns, gap, aspectFallback);
  const areaRows = Math.max(1, Math.floor((area.height + gap) / (rowHeight + gap)));

  const seen = new Set<string>();
  for (const tile of spec.tiles) {
    if (seen.has(tile.id)) {
      context.report({
        code: "bento-duplicate-tile",
        severity: "error",
        message: `bento-grid received two tiles with id "${tile.id}".`,
        sectionId: tile.id,
      });
    }
    seen.add(tile.id);
  }

  const ordered = spec.tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const importance =
        IMPORTANCE_RANK[a.tile.importance ?? "supporting"] - IMPORTANCE_RANK[b.tile.importance ?? "supporting"];
      if (importance !== 0) return importance;
      const priority = (b.tile.priority ?? 0) - (a.tile.priority ?? 0);
      if (priority !== 0) return priority;
      return a.index - b.index;
    });

  const occupancy: Occupancy = { rows: 0, columns, taken: [] };
  const placements: BentoTilePlacement[] = [];
  const byId: Record<string, BentoTilePlacement> = {};
  const unplaced: string[] = [];

  for (const { tile } of ordered) {
    const importance = tile.importance ?? "supporting";
    const minColumns = Math.max(1, Math.floor(tile.minSpan?.columns ?? 1));
    const minRows = Math.max(1, Math.floor(tile.minSpan?.rows ?? 1));
    const maxColumns = Math.min(columns, Math.floor(tile.maxSpan?.columns ?? columns));
    const maxRows = Math.max(minRows, Math.floor(tile.maxSpan?.rows ?? Number.POSITIVE_INFINITY));

    const wantsColumns = Math.floor(
      tile.span?.columns ?? spec.defaultColumns ?? IMPORTANCE_COLUMNS[importance]
    );
    let columnSpan = clamp(wantsColumns, Math.max(1, Math.min(minColumns, maxColumns)), maxColumns);

    // Aspect preference trims the row span so tiles do not become letterboxes.
    const tileWidth = columnWidth * columnSpan + gap * (columnSpan - 1);
    const wantedRows = tile.span?.rows ?? (tile.aspect ? Math.round(tileWidth / tile.aspect / rowHeight) : minRows);
    let rowSpan = clamp(Math.max(1, wantedRows), minRows, maxRows);

    if (tile.minContent) {
      // Grow up to the declared maximums before reporting that copy would crop.
      while (
        (tileWidth < tile.minContent.width || rowSpan * rowHeight + gap * (rowSpan - 1) < tile.minContent.height) &&
        (columnSpan < maxColumns || rowSpan < maxRows)
      ) {
        if (columnSpan < maxColumns) {
          columnSpan += 1;
        } else if (rowSpan < maxRows) {
          rowSpan += 1;
        } else {
          break;
        }
      }
    }

    const resolvedWidth = columnWidth * columnSpan + gap * (columnSpan - 1);
    const resolvedHeight = rowSpan * rowHeight + gap * (rowSpan - 1);
    const compromised = Boolean(
      tile.minContent &&
        (resolvedWidth < tile.minContent.width || resolvedHeight < tile.minContent.height)
    );

    let placed: { column: number; row: number } | null = null;
    for (let row = 0; row <= areaRows - rowSpan && !placed; row += 1) {
      for (let column = 0; column <= columns - columnSpan; column += 1) {
        if (isFree(occupancy, column, row, columnSpan, rowSpan)) {
          placed = { column, row };
          break;
        }
      }
    }

    if (!placed) {
      unplaced.push(tile.id);
      context.report({
        code: "bento-overflow",
        severity: "error",
        message: `Tile "${tile.id}" does not fit the remaining bento space (${columns} columns × ${maxRows} rows at ${round(rowHeight)}px).`,
        sectionId: spec.id,
        targetId: tile.id,
        overflow: round(resolvedHeight),
      });
      continue;
    }

    occupy(occupancy, placed.column, placed.row, columnSpan, rowSpan);
    const box: RectInfo = {
      x: round(area.x + placed.column * (columnWidth + gap)),
      y: round(area.y + placed.row * (rowHeight + gap)),
      width: round(resolvedWidth),
      height: round(resolvedHeight),
    };
    const placement: BentoTilePlacement = {
      id: tile.id,
      box,
      column: placed.column,
      row: placed.row,
      columnSpan,
      rowSpan,
      importance,
      compromised,
    };
    placements.push(placement);
    byId[tile.id] = placement;

    if (compromised && tile.minContent) {
      context.report({
        code: "bento-content-minimum",
        severity: "error",
        message: `Tile "${tile.id}" cannot fit its minimum content box (${tile.minContent.width}×${tile.minContent.height}px) at ${round(resolvedWidth)}×${round(resolvedHeight)}px.`,
        sectionId: spec.id,
        targetId: tile.id,
      });
    }
  }

  const usedRows = placements.reduce((max, placement) => Math.max(max, placement.row + placement.rowSpan), 0);

  return {
    area,
    placements,
    byId,
    unplaced,
    rows: usedRows,
    columnWidth: round(columnWidth),
    rowHeight: round(rowHeight),
    usedHeight: round(usedRows * rowHeight + Math.max(0, usedRows - 1) * gap),
  };
}

/** Total overlap area of a bento placement set — the packer's own QA measure. */
export function bentoOverlap(placements: readonly BentoTilePlacement[]): number {
  let overlap = 0;
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      overlap += overlapArea(placements[i].box, placements[j].box);
    }
  }
  return round(overlap);
}

/** Uniform cell rects for a bento grid (row-major), for previews and tests. */
export function bentoCellRects(area: RectInfo, columns: number, rows: number, gap: number): RectInfo[] {
  return gridCells(area, columns, rows, gap);
}

/** Convenience re-export so consumers can reason about grid geometry in one import. */
export type { InfographicPrimitive };

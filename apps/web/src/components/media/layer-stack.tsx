import { Fragment, forwardRef, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import type { FontAsset, ImageAsset, Layer, LayerTreeNode, ShapeSpec, TextSpec } from "./document";
import {
  buildLayerTree,
  isLayerEffectivelyHidden,
  isLayerEffectivelyLocked,
  layerAccessibleName,
  layerKindLabel,
  visibleLayersInPaintOrder,
} from "./document";
import { useMediaCanvasOrDefault } from "./media-context";
import { EditableText } from "./editable-text";
import { MediaFrame } from "./media-frame";

/** Stable empty identities so defaulted props never invalidate a `useMemo`. */
const EMPTY_FONTS: Record<string, FontAsset> = {};
const EMPTY_ASSETS: Record<string, ImageAsset> = {};
const EMPTY_IDS: readonly string[] = [];

/** Merge conditional class lists, dropping empty entries. */
function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Everything a painter needs to draw one layer without reaching into the stack.
 * `index` is the layer's position in the resolved visible stack (the same order
 * the DOM uses for `z-index`), so a custom painter can reason about stacking
 * without re-sorting the document.
 */
export interface LayerRenderContext {
  /** Resolved paint index within the visible stack (0 = bottom). */
  index: number;
  /** Nesting depth; 0 for roots. */
  depth: number;
  /** True when the surrounding canvas is in authoring/edit mode. */
  editing: boolean;
  /** True when the layer (or an ancestor) is hidden. */
  hidden: boolean;
  /** True when the layer (or an ancestor) is locked. */
  locked: boolean;
  fonts: Record<string, FontAsset>;
  assets: Record<string, ImageAsset>;
}

export interface LayerStackProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "onSelect"> {
  /** Layers to paint. The document owns identity, `z` and parentage; the stack never mutates them. */
  layers: readonly Layer[];
  /**
   * Font registry keyed by `FontAsset.id`, forwarded to the default text painter.
   * @default {}
   */
  fonts?: Record<string, FontAsset>;
  /**
   * Image registry keyed by `ImageAsset.id`, forwarded to the default media painter.
   * @default {}
   */
  assets?: Record<string, ImageAsset>;
  /**
   * Overrides the built-in painter for one layer. Receives the layer and its
   * resolved context. This is a *partial* override hook: return `undefined`
   * (or `null`) to fall back to the built-in painter for that layer, so a caller
   * can decorate one kind of layer and leave the rest untouched. Returning a node
   * replaces the built-in painter for that layer entirely.
   */
  renderLayer?: (layer: Layer, context: LayerRenderContext) => ReactNode;
  /**
   * Layer ids excluded from rendering (e.g. a layer being dragged by an overlay).
   * Excluding a group also excludes its whole subtree.
   * @default []
   */
  excludeIds?: readonly string[];
  /**
   * Complete selected layer ids. Drives `data-layer-selected` and is the single
   * source of truth for selection: the stack is controlled and stores no
   * selection state of its own — only the `Shift`-range anchor lives in a ref.
   * @default the surrounding canvas selection (`[]` when standalone)
   */
  selectedIds?: readonly string[];
  /**
   * Called with the activated layer id, or `null` when the stack background is
   * clicked. In `multiSelect` mode a `Shift` range activation reports the range
   * anchor id instead, so a consumer that toggles a single id keeps working.
   * @default the surrounding canvas handler, if any
   */
  onSelect?: (id: string | null) => void;
  /**
   * Enables modifier-key selection. With `multiSelect` the stack computes the
   * resulting selection from `selectedIds` and reports it through
   * {@link onSelectionChange}: a plain click selects one layer, Ctrl/Cmd-click
   * toggles a layer, `Shift`-click selects the contiguous range in paint order
   * from the anchor (the last-selected layer) to the clicked layer, and a
   * background click clears. A plain click on an already-selected layer keeps
   * the selection rather than collapsing it to one id, so clicking inside a
   * multi-selection is never destructive. `Shift` wins when combined with
   * Ctrl/Cmd. The component stays controlled — nothing but the anchor is stored
   * internally. Ignored (single-select behaviour) when `false`.
   * @default false
   */
  multiSelect?: boolean;
  /**
   * Called with the full resulting selection after a layer, key or background
   * activation while `multiSelect` is enabled. Receives `[]` when the selection
   * is cleared. Never called in single-select mode, where `onSelect` is the only
   * callback.
   * @default undefined
   */
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Clip each group's children to the group's own (rectangular) bounds. This is
   * the only supported clipping model — non-rectangular clipping is out of scope.
   * @default true
   */
  clipGroups?: boolean;
  /**
   * How text layers whose `TextSpec.as` is a heading tag are rendered in the preview.
   *
   * `"authored"` renders the document's own tag (`h1`/`h2`/`h3`), which is correct when
   * the caller controls the whole document — for example an export-fidelity preview.
   * `"neutral"` renders the same text with an equivalent non-heading element and
   * identical styling, so a previewed composition cannot inject headings into the
   * host page's outline. Embedded previews should pass `"neutral"`.
   *
   * Only the default text painter is affected, and only for `h1`/`h2`/`h3` — `p`,
   * `span` and `div` pass through untouched. The remap builds a shallow copy of the
   * `TextSpec` and never mutates `layer.text`, so the document the caller owns (and
   * therefore export and editability) stays intact. A custom {@link renderLayer}
   * receives the original layer unchanged and is responsible for its own semantics;
   * returning `undefined` from it falls back to the built-in painter, where the
   * `"neutral"` remap still applies.
   * This is the supported mechanism: do not work around it by rewriting the
   * document's layers, which would break export/editability parity.
   * @default "authored"
   */
  headingSemantics?: "authored" | "neutral";
}

// `"onSelect"` joins `"onChange"` in the omission: the DOM event handler would
// otherwise clash with the layer-id callback below (TS2430), the same way the
// frozen `LayerStackProps` already omits it.
export interface LayerListProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "onSelect"> {
  /** Layers to list. Hidden and locked layers are still listed; only painting skips them. */
  layers: readonly Layer[];
  /** Currently selected layer ids. @default [] */
  selectedIds?: readonly string[];
  /** Called with a row's id when activated, or `null` when the selection is cleared. */
  onSelect?: (id: string | null) => void;
  /** Called with the requested next visibility; the document owns the value. */
  onVisibilityChange?: (id: string, visible: boolean) => void;
  /** Called with the requested next lock state; the document owns the value. */
  onLockChange?: (id: string, locked: boolean) => void;
  /** Move a layer in the stacking order. Implementations report intent; the document owns `z`. */
  onReorder?: (id: string, direction: "up" | "down" | "top" | "bottom") => void;
  /**
   * Render lock/visibility/reorder controls (each control also needs its own
   * handler to appear). @default true
   */
  interactive?: boolean;
  /** Ids whose controls are read-only. @default [] */
  disabledIds?: readonly string[];
}

/** Root of the paint surface: full-bleed, transparent to pointer events so empty space reaches the artboard. */
const STACK_CLASSES = "pointer-events-none absolute inset-0";

const LIST_CLASSES = "flex max-h-full flex-col overflow-y-auto rounded-surface border border-border bg-surface";

/** Structural wrapper for a treeitem's children. Purely semantic: no focus, no tab stop. */
const GROUP_CLASSES = "flex flex-col";

const EMPTY_CLASSES = "px-3 py-4 text-sm text-muted-foreground";

const ROW_CLASSES = [
  "relative flex items-center gap-2 py-1.5 pe-2",
  "text-sm text-foreground",
  "border-b border-border last:border-b-0",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity motion-reduce:transition-none",
  "data-[selected]:bg-surface-subtle",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
].join(" ");

/**
 * Selected-row indicator: a 2px `bg-checked` bar pinned to the inline-start edge.
 * It is a real element (not a pseudo-element) absolutely positioned inside the
 * row's own `relative` box, so it can never shift layout, and it is a non-colour
 * cue in addition to the `data-[selected]:bg-surface-subtle` tint — selection
 * must not rely on colour alone (WCAG 1.4.1). Decorative for assistive
 * technology (`aria-hidden`); the row's own `aria-selected` carries the state.
 * It has no transition, so reduced motion needs no special case.
 */
const ROW_SELECTED_INDICATOR_CLASSES = [
  "pointer-events-none absolute inset-y-2 start-0 w-0.5 rounded-full bg-checked",
].join(" ");

const ROW_NAME_CLASSES = "min-w-0 flex-1 truncate";

const ROW_BADGE_CLASSES = [
  "inline-flex shrink-0 items-center rounded-sm border border-border bg-surface-floating",
  "px-1.5 py-0.5 text-caption text-muted-foreground",
].join(" ");

const ROW_CONTROLS_CLASSES = "flex shrink-0 items-center gap-0.5";

/**
 * Row control (visibility/lock/reorder). The square target follows the repo's
 * density token `--km-control-height` (32px compact / 40px default / 48px
 * spacious), so the default is 40px — above the 32px floor and near the ~44px
 * touch guidance — and scales with density instead of being pinned to one size.
 * Tradeoff: taller controls make each row taller; the readable content keeps its
 * own size (`text-sm`, `truncate`) and is never shrunk to compensate.
 */
const CONTROL_CLASSES = [
  "inline-flex size-[var(--km-control-height)] shrink-0 items-center justify-center rounded-sm text-muted-foreground",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity motion-reduce:transition-none",
  "hover:bg-surface-floating hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-40",
].join(" ");

/** Base inline start padding (design-space chrome) plus per-depth indentation. */
const ROW_PADDING_INLINE_START = 8;
const ROW_INDENT = 16;

const DEFAULT_LIST_LABEL = "Layers";

/** Decorative control glyphs; the enclosing button carries the accessible name. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <Glyph>
      <path d="M1.5 8S4 3.75 8 3.75 14.5 8 14.5 8 12 12.25 8 12.25 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
      {visible ? null : <path d="m2.5 2.5 11 11" />}
    </Glyph>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <Glyph>
      <rect x="3.75" y="7" width="8.5" height="6" rx="1.5" />
      {locked ? (
        <path d="M5.75 7V4.75a2.25 2.25 0 0 1 4.5 0V7" />
      ) : (
        <path d="M5.75 7V4.75a2.25 2.25 0 0 1 4.2-1.1" />
      )}
    </Glyph>
  );
}

function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <Glyph>
      {direction === "up" ? (
        <>
          <path d="M8 12.5v-9" />
          <path d="m4 7.5 4-4 4 4" />
        </>
      ) : (
        <>
          <path d="M8 3.5v9" />
          <path d="m4 8.5 4 4 4-4" />
        </>
      )}
    </Glyph>
  );
}

/**
 * Default shape painter. A `rect` is a plain tokenized box; `ellipse` and `line`
 * are a single stretched SVG primitive. The SVG uses `preserveAspectRatio="none"`
 * so its geometry follows the layer box exactly, and the stroke keeps its authored
 * width via `vector-effect: non-scaling-stroke`. Colours come from the document —
 * `undefined` renders no fill/stroke rather than the SVG default black.
 */
function shapeContent(shape: ShapeSpec): ReactNode {
  if (shape.kind === "rect") {
    const style: CSSProperties = { background: shape.fill };
    if (shape.radius != null) style.borderRadius = `${shape.radius}px`;
    if (shape.stroke != null) {
      style.border = `${shape.strokeWidth ?? 1}px solid ${shape.stroke}`;
    }
    return <div data-km-shape="rect" className="h-full w-full" style={style} />;
  }

  const strokeWidth = shape.stroke != null ? shape.strokeWidth ?? 1 : undefined;

  if (shape.kind === "ellipse") {
    return (
      <svg
        data-km-shape="ellipse"
        className="block h-full w-full"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        focusable="false"
      >
        <ellipse
          cx="0.5"
          cy="0.5"
          rx="0.5"
          ry="0.5"
          fill={shape.fill ?? "none"}
          stroke={shape.stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  return (
    <svg
      data-km-shape="line"
      className="block h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      focusable="false"
    >
      <line
        x1="0"
        y1="0"
        x2="1"
        y2="1"
        stroke={shape.stroke}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Neutralise authored heading tags for an embedded preview: `h1`/`h2`/`h3` become a
 * plain `div`, everything else passes through. The result is a shallow copy with a
 * swapped `as`, so every styling field (font, size, weight, wrapping) is identical and
 * the caller's `TextSpec` is never mutated — export and editability keep the authored
 * tag. Purely a render-time presentation choice; the document stays authoritative.
 */
function neutralTextSpec(text: TextSpec): TextSpec {
  switch (text.as) {
    case "h1":
    case "h2":
    case "h3":
      return { ...text, as: "div" };
    default:
      return text;
  }
}

/**
 * Layer paint surface for the M0 media artboard.
 *
 * `LayerStack` draws whatever order the document hands it: it iterates the
 * resolved visible stack, positions each layer in design px and never regenerates
 * ids or rewrites `z`. Hidden branches (a layer or any ancestor is invisible) are
 * not rendered at all. Groups render a wrapper whose children are painted inside
 * the group's own box; with `clipGroups` (the default) the wrapper gets
 * `overflow: hidden`, which is deliberately the only clipping model — rectangular
 * group clipping, with non-rectangular clipping out of scope.
 *
 * The root is `pointer-events-none` so empty artboard space stays clickable
 * through to the artboard; only selectable (unlocked) layers take
 * `pointer-events-auto`. Because of that pass-through, the background
 * `onSelect(null)` handler fires only when the stack itself is the hit target —
 * empty space normally reaches the artboard, which owns deselection there.
 *
 * `renderLayer` overrides the built-in painter for one layer: `text` → a
 * `EditableText` bound to the layer box, `media` → a `MediaFrame` resolved against
 * `assets`, `shape` → a tokenized box or stretched SVG, `group` → its children.
 * It is a partial override: returning `undefined` leaves that layer to the
 * built-in painter, which is what a caller decorating only, say, text layers
 * wants. Returning a node takes over the layer completely — including a group,
 * whose subtree is then the override's responsibility.
 */
const LayerStack = forwardRef<HTMLDivElement, LayerStackProps>(function LayerStack(
  {
    layers,
    fonts = EMPTY_FONTS,
    assets = EMPTY_ASSETS,
    renderLayer,
    excludeIds = EMPTY_IDS,
    selectedIds: selectedIdsProp,
    onSelect: onSelectProp,
    multiSelect = false,
    onSelectionChange,
    clipGroups = true,
    headingSemantics = "authored",
    className,
    onClick,
    ...props
  },
  ref
) {
  const canvas = useMediaCanvasOrDefault();
  const editing = canvas.editing;
  const selectedIds = selectedIdsProp ?? canvas.selectedIds;
  const onSelect = onSelectProp ?? canvas.onSelect;

  // The `Shift`-range anchor: the last layer a plain/Ctrl click landed on. It is
  // the only selection fact the stack keeps locally; the selection itself always
  // comes from `selectedIds`.
  const anchorRef = useRef<string | null>(null);

  // A layer is selectable when there is a callback to receive the activation.
  // `onSelectionChange` alone can drive multi-selection, so it counts too.
  const canSelect = onSelect != null || (multiSelect && onSelectionChange != null);

  // Resolved paint order is the single source of both paint sequence and the
  // `z-index` values; memoised so drag-heavy consumers do not re-sort per render.
  const paintOrder = useMemo(() => visibleLayersInPaintOrder(layers), [layers]);

  const excludedSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    paintOrder.forEach((layer, index) => map.set(layer.id, index));
    return map;
  }, [paintOrder]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Layer[]>();
    for (const layer of paintOrder) {
      const parentId = layer.parentId ?? null;
      const bucket = map.get(parentId);
      if (bucket) bucket.push(layer);
      else map.set(parentId, [layer]);
    }
    return map;
  }, [paintOrder]);

  const layerFlags = useMemo(() => {
    const map = new Map<string, { hidden: boolean; locked: boolean }>();
    for (const layer of layers) {
      map.set(layer.id, {
        hidden: isLayerEffectivelyHidden(layers, layer),
        locked: isLayerEffectivelyLocked(layers, layer),
      });
    }
    return map;
  }, [layers]);

  /**
   * Resolve the resulting selection for one activation while `multiSelect` is on.
   * `Shift` extends the contiguous paint-order range from the stored anchor;
   * Ctrl/Cmd toggles a single layer; a plain click replaces the selection — except
   * over an already-selected layer, where it keeps the whole selection so a click
   * inside a multi-selection is not destructive. `Shift` takes precedence when
   * combined with Ctrl/Cmd. Only the anchor is kept locally; the selection stays
   * derived from `selectedIds`.
   */
  const resolveMultiSelect = (
    clickedId: string,
    modifiers: { toggle: boolean; range: boolean }
  ): { ids: string[]; reportId: string } => {
    if (modifiers.range) {
      const anchor = anchorRef.current ?? clickedId;
      const anchorIndex = indexById.get(anchor);
      const clickedIndex = indexById.get(clickedId);
      if (anchorIndex == null || clickedIndex == null) {
        anchorRef.current = clickedId;
        return { ids: [clickedId], reportId: clickedId };
      }
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const ids = paintOrder.slice(start, end + 1).map((layer) => layer.id);
      return { ids, reportId: anchor };
    }
    if (modifiers.toggle) {
      anchorRef.current = clickedId;
      const ids = selectedIds.includes(clickedId)
        ? selectedIds.filter((id) => id !== clickedId)
        : [...selectedIds, clickedId];
      return { ids, reportId: clickedId };
    }
    anchorRef.current = clickedId;
    if (selectedIds.includes(clickedId)) return { ids: [...selectedIds], reportId: clickedId };
    return { ids: [clickedId], reportId: clickedId };
  };

  /**
   * Report one activation. Single-select mode is unchanged: only `onSelect` runs.
   * Multi-select mode keeps calling `onSelect` (with the clicked id, or the range
   * anchor) and additionally reports the computed selection.
   */
  const activate = (
    layerId: string,
    modifiers: { toggle: boolean; range: boolean }
  ): void => {
    if (!multiSelect) {
      onSelect?.(layerId);
      return;
    }
    const { ids, reportId } = resolveMultiSelect(layerId, modifiers);
    onSelect?.(reportId);
    onSelectionChange?.(ids);
  };

  const renderChildren = (parentId: string | null, depth: number): ReactNode[] => {
    const bucket = childrenByParent.get(parentId) ?? [];
    const nodes: ReactNode[] = [];
    for (const layer of bucket) {
      if (excludedSet.has(layer.id)) continue;
      nodes.push(renderNode(layer, depth));
    }
    return nodes;
  };

  const defaultContent = (layer: Layer, context: LayerRenderContext): ReactNode => {
    switch (layer.kind) {
      case "text":
        return (
          <EditableText
            text={headingSemantics === "neutral" ? neutralTextSpec(layer.text) : layer.text}
            box={{ width: layer.transform.width, height: layer.transform.height }}
            fonts={context.fonts}
            editable={context.editing}
          />
        );
      case "media":
        return <MediaFrame media={layer.media} asset={context.assets[layer.media.assetId]} />;
      case "shape":
        return shapeContent(layer.shape);
      case "group":
        return renderChildren(layer.id, context.depth + 1);
    }
  };

  const renderNode = (layer: Layer, depth: number): ReactNode => {
    const flags = layerFlags.get(layer.id);
    const hidden = flags?.hidden ?? false;
    const locked = flags?.locked ?? false;
    const index = indexById.get(layer.id) ?? 0;
    const selected = selectedSet.has(layer.id);
    const selectable = canSelect && !locked;

    const context: LayerRenderContext = {
      index,
      depth,
      editing,
      hidden,
      locked,
      fonts,
      assets,
    };

    const style: CSSProperties = {
      position: "absolute",
      left: layer.transform.x,
      top: layer.transform.y,
      width: layer.transform.width,
      height: layer.transform.height,
      zIndex: index,
    };
    if (layer.opacity !== 1) style.opacity = layer.opacity;
    if (layer.blend !== "normal") style.mixBlendMode = layer.blend;
    const shadow = layer.appearance?.dropShadow;
    if (shadow) {
      const red = parseInt(shadow.color.slice(1, 3), 16);
      const green = parseInt(shadow.color.slice(3, 5), 16);
      const blue = parseInt(shadow.color.slice(5, 7), 16);
      style.filter = `drop-shadow(${shadow.dx}px ${shadow.dy}px ${shadow.blur}px rgba(${red}, ${green}, ${blue}, ${shadow.opacity}))`;
    }

    const rotation = layer.transform.rotation;
    if (rotation) {
      style.transform = `rotate(${rotation}deg)`;
      style.transformOrigin = `${(layer.transform.anchorX ?? 0) * 100}% ${
        (layer.transform.anchorY ?? 0) * 100
      }%`;
    }

    if (layer.kind === "group" && clipGroups) style.overflow = "hidden";

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (!selectable) return;
      activate(layer.id, {
        toggle: event.metaKey || event.ctrlKey,
        range: event.shiftKey,
      });
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!selectable) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // Keyboard activation honours the same modifiers the browser reports on
        // the key event, so Enter/Space behave like the equivalent click.
        activate(layer.id, {
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        });
      }
    };

    return (
      <div
        key={layer.id}
        data-km-layer={layer.kind === "group" ? "group" : "root"}
        data-layer-id={layer.id}
        data-layer-kind={layer.kind}
        data-layer-visible={hidden ? "false" : "true"}
        data-layer-locked={locked ? "true" : "false"}
        data-layer-selected={selected ? "true" : "false"}
        data-layer-depth={depth}
        // A selectable layer is a labelled `group`, not a `button`: its subtree
        // legitimately contains interactive and heading content (an `EditableText`
        // contentEditable textbox while editing, `<img>`/`<video>`, authored
        // `h1`/`h2`/`h3` tags), which a `button` role must not own — that would
        // flatten the semantics for screen readers. `group` keeps the subtree's
        // own semantics intact while `aria-label` names the selection target; the
        // keyboard activation below is preserved. `LayerList` is the accessible,
        // fully keyboard-operable selection equivalent when a widget role is wanted.
        role={selectable ? "group" : undefined}
        tabIndex={selectable ? 0 : undefined}
        aria-label={selectable ? layerAccessibleName(layer) : undefined}
        className={joinClasses(
          selectable ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
          selectable &&
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
          layer.className
        )}
        style={style}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {renderLayer?.(layer, context) ?? defaultContent(layer, context)}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      data-km-layer-stack="root"
      data-km-layer-stack-multiselect={multiSelect ? "true" : "false"}
      className={joinClasses(STACK_CLASSES, className)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (multiSelect) {
          // A background click clears the selection and the range anchor.
          anchorRef.current = null;
          onSelect?.(null);
          onSelectionChange?.([]);
          return;
        }
        onSelect?.(null);
      }}
      {...props}
    >
      {renderChildren(null, 0)}
    </div>
  );
});

LayerStack.displayName = "LayerStack";

/**
 * Layer management panel for the M0 media artboard.
 *
 * `LayerList` renders the forest from `buildLayerTree` with the top-most layer
 * first (the reverse of paint order) so it matches designer expectation; groups
 * stay above their indented children. The hierarchy is a real ARIA tree: a
 * parent's children are wrapped in a non-focusable `role="group"` container
 * (marked `data-km-layer-group`), so every `treeitem` is a child of the tree or
 * of a group and `aria-level` matches its nesting depth, while depth only drives
 * the visual indentation.
 *
 * Keyboard model (a composite widget — the tree is one tab stop, not one per row):
 * - The tree uses a roving tabindex. Exactly one operable, non-disabled row is
 *   `tabIndex={0}` (the active row); every other row is `tabIndex={-1}`. Before
 *   any interaction the first operable row is the tab stop, and a row that stops
 *   being focusable (deleted, disabled, relocked) hands the tab stop back to the
 *   first operable row. Roving applies whenever rows are operable.
 * - `ArrowDown`/`ArrowUp` move the active row and real DOM focus by one row;
 *   `Home`/`End` jump to the first/last operable row. Moving the active row also
 *   calls `onSelect` for the newly focused row when supplied, so focus and the
 *   reported selection agree (single-select tree semantics).
 * - `ArrowRight` on the row moves focus into the row's own controls (visibility,
 *   lock, reorder); this tree has no expand/collapse, so the standard "open"
 *   arrow opens the row's controls instead. Inside the controls, `ArrowRight`/
 *   `ArrowLeft` step between them and `ArrowLeft`/`Escape` on the first control
 *   return focus to the row.
 * - `Enter`/`Space` select the focused row. Row controls are `tabIndex={-1}` and
 *   are only reached from the focused row, so a document with many layers stays a
 *   single tab stop.
 * - Reorder shortcuts are unchanged and never move focus or the active row:
 *   `Alt+ArrowUp`/`Alt+ArrowDown` request one step, `Alt+Home`/`Alt+End` request
 *   `bottom`/`top`. `altKey` is checked first, before any navigation branch.
 *
 * Every control is a real `<button>` with an `aria-pressed` state and a name that
 * includes the layer (for example `Hide "Headline"`), so visibility, lock and
 * reorder are announced by screen readers.
 *
 * The list is controlled twice over: it stores no state of its own and no order
 * — only the active-row focus cursor. Selection is reported through `onSelect`,
 * visibility/lock through their handlers and stacking through `onReorder`, which
 * reports intent only — the document owns `z`. Ids in `disabledIds` render their
 * controls `disabled`; effectively locked layers keep working toggles (so they can
 * be unlocked) but carry `aria-disabled` and are not selectable from the row.
 */
const LayerList = forwardRef<HTMLDivElement, LayerListProps>(function LayerList(
  {
    layers,
    selectedIds = EMPTY_IDS,
    onSelect,
    onVisibilityChange,
    onLockChange,
    onReorder,
    interactive = true,
    disabledIds = EMPTY_IDS,
    "aria-label": ariaLabel,
    className,
    ...props
  },
  ref
) {
  const tree = useMemo(() => buildLayerTree(layers), [layers]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const disabledSet = useMemo(() => new Set(disabledIds), [disabledIds]);
  const lockedSet = useMemo(() => {
    const set = new Set<string>();
    for (const layer of layers) {
      if (isLayerEffectivelyLocked(layers, layer)) set.add(layer.id);
    }
    return set;
  }, [layers]);

  const showVisibility = interactive && onVisibilityChange != null;
  const showLock = interactive && onLockChange != null;
  const showReorder = interactive && onReorder != null;
  const showControls = showVisibility || showLock || showReorder;

  const rowIsOperable = onSelect != null || onReorder != null;

  // Rows in DOM (visual) order: top-most first, children after their parent, the
  // exact order `renderNodes` emits below. Used for the roving focus cursor.
  const orderedIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: readonly LayerTreeNode[]): void => {
      for (const node of [...nodes].reverse()) {
        ids.push(node.layer.id);
        walk(node.children);
      }
    };
    walk(tree);
    return ids;
  }, [tree]);

  // The roving-tabindex set: only operable, non-disabled rows are focusable — the
  // same per-row rule the component used before roving. Disabled and locked rows
  // stay out of the arrow order so a keyboard user is never parked on an inert row.
  const focusableIds = useMemo(
    () => orderedIds.filter((id) => rowIsOperable && !disabledSet.has(id) && !lockedSet.has(id)),
    [orderedIds, rowIsOperable, disabledSet, lockedSet]
  );
  const focusableSet = useMemo(() => new Set(focusableIds), [focusableIds]);

  /**
   * Active-row focus cursor. This is the only local state the list keeps: it is a
   * focus index, never a selection — selection stays controlled through
   * `selectedIds`/`onSelect`.
   */
  const [activeId, setActiveId] = useState<string | null>(null);

  // If the stored active row is no longer focusable (deleted, disabled, relocked),
  // the first operable row takes the tab stop instead of leaving the tree with none.
  const resolvedActiveId =
    activeId != null && focusableSet.has(activeId) ? activeId : focusableIds[0] ?? null;

  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  /** Make `id` the active row and move real DOM focus to it. */
  const focusRow = (id: string, select: boolean): void => {
    if (!focusableSet.has(id)) return;
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
    // Single-select tree semantics: moving focus also agrees with the selection.
    if (select) onSelect?.(id);
  };

  /** Move the active row by `delta`, clamped to the ends. Selects the focused row. */
  const moveActive = (delta: number): void => {
    if (focusableIds.length === 0) return;
    const currentIndex =
      resolvedActiveId == null ? -1 : focusableIds.indexOf(resolvedActiveId);
    if (currentIndex === -1) {
      focusRow(focusableIds[0], true);
      return;
    }
    const nextIndex = Math.min(focusableIds.length - 1, Math.max(0, currentIndex + delta));
    focusRow(focusableIds[nextIndex], true);
  };

  /** Jump the active row to the first or last operable row. Selects the focused row. */
  const focusEdge = (edge: "first" | "last"): void => {
    if (focusableIds.length === 0) return;
    focusRow(edge === "first" ? focusableIds[0] : focusableIds[focusableIds.length - 1], true);
  };

  /** Enter the focused row's own controls (`ArrowRight`). */
  const focusFirstControl = (rowElement: HTMLElement): void => {
    rowElement
      .querySelector<HTMLButtonElement>("[data-km-layer-control]:not([disabled])")
      ?.focus();
  };

  const renderRow = (layer: Layer, depth: number): ReactNode => {
    const name = layerAccessibleName(layer);
    const isDisabled = disabledSet.has(layer.id);
    const isLocked = lockedSet.has(layer.id);
    const rowDisabled = isDisabled || isLocked;
    const selected = selectedSet.has(layer.id);
    const controlsDisabled = !interactive || isDisabled;
    const reorderDisabled = controlsDisabled || isLocked || !rowIsOperable;
    const rowFocusable = rowIsOperable && !rowDisabled;
    const isTabStop = rowFocusable && resolvedActiveId === layer.id;

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      // Ignore keys that originate inside the row's controls; the controls'
      // container handles those so a key is never handled twice.
      if (event.target !== event.currentTarget) return;
      const { key } = event;

      // Reorder shortcuts are checked first, before any navigation branch, so
      // `Alt+Arrow…`/`Alt+Home`/`Alt+End` never move focus or the active row.
      if (event.altKey) {
        if (!onReorder || rowDisabled) return;
        let direction: "up" | "down" | "top" | "bottom" | null = null;
        if (key === "ArrowUp") direction = "up";
        else if (key === "ArrowDown") direction = "down";
        else if (key === "Home") direction = "bottom";
        else if (key === "End") direction = "top";
        if (direction == null) return;
        event.preventDefault();
        onReorder(layer.id, direction);
        return;
      }

      switch (key) {
        case "ArrowDown":
          event.preventDefault();
          moveActive(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveActive(-1);
          break;
        case "Home":
          event.preventDefault();
          focusEdge("first");
          break;
        case "End":
          event.preventDefault();
          focusEdge("last");
          break;
        case "ArrowRight":
          // This tree has no expand/collapse, so the standard "open the node"
          // arrow opens the row's own controls instead.
          event.preventDefault();
          focusFirstControl(event.currentTarget);
          break;
        case "Enter":
        case " ":
          if (rowDisabled) return;
          event.preventDefault();
          onSelect?.(layer.id);
          break;
        default:
          break;
      }
    };

    const handleControlsKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
      const controls = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "[data-km-layer-control]:not([disabled])"
        )
      );
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") {
        event.preventDefault();
        focusRow(layer.id, false);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (index > 0) controls[index - 1]?.focus();
        else focusRow(layer.id, false);
        return;
      }
      if (event.key === "ArrowRight" && index >= 0 && index < controls.length - 1) {
        event.preventDefault();
        controls[index + 1]?.focus();
      }
    };

    return (
      <div
        ref={(node) => {
          if (node) rowRefs.current.set(layer.id, node);
          else rowRefs.current.delete(layer.id);
        }}
        role="treeitem"
        data-km-layer="row"
        data-layer-id={layer.id}
        data-layer-kind={layer.kind}
        data-layer-depth={depth}
        data-layer-locked={isLocked ? "true" : "false"}
        data-selected={selected ? "" : undefined}
        aria-selected={selected}
        aria-level={depth + 1}
        aria-disabled={rowDisabled ? true : undefined}
        tabIndex={rowFocusable ? (isTabStop ? 0 : -1) : undefined}
        className={ROW_CLASSES}
        style={{ paddingInlineStart: `${ROW_PADDING_INLINE_START + depth * ROW_INDENT}px` }}
        onClick={() => {
          if (rowDisabled) return;
          setActiveId(layer.id);
          onSelect?.(layer.id);
        }}
        onKeyDown={handleKeyDown}
      >
        {selected ? (
          <span
            aria-hidden="true"
            data-km-layer-selected-indicator=""
            className={ROW_SELECTED_INDICATOR_CLASSES}
          />
        ) : null}
        <span className={ROW_NAME_CLASSES}>{name}</span>
        <span className={ROW_BADGE_CLASSES}>{layerKindLabel(layer)}</span>
        {showControls ? (
          <span className={ROW_CONTROLS_CLASSES} onKeyDown={handleControlsKeyDown}>
            {showVisibility ? (
              <button
                type="button"
                tabIndex={-1}
                data-km-layer-control=""
                aria-pressed={layer.visible}
                aria-label={layer.visible ? `Hide "${name}"` : `Show "${name}"`}
                disabled={controlsDisabled}
                className={CONTROL_CLASSES}
                onClick={(event) => {
                  event.stopPropagation();
                  onVisibilityChange?.(layer.id, !layer.visible);
                }}
              >
                <VisibilityIcon visible={layer.visible} />
              </button>
            ) : null}
            {showLock ? (
              <button
                type="button"
                tabIndex={-1}
                data-km-layer-control=""
                aria-pressed={layer.locked}
                aria-label={layer.locked ? `Unlock "${name}"` : `Lock "${name}"`}
                disabled={controlsDisabled}
                className={CONTROL_CLASSES}
                onClick={(event) => {
                  event.stopPropagation();
                  onLockChange?.(layer.id, !layer.locked);
                }}
              >
                <LockIcon locked={layer.locked} />
              </button>
            ) : null}
            {showReorder ? (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  data-km-layer-control=""
                  aria-label={`Move "${name}" up`}
                  disabled={reorderDisabled}
                  className={CONTROL_CLASSES}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReorder?.(layer.id, "up");
                  }}
                >
                  <ArrowIcon direction="up" />
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  data-km-layer-control=""
                  aria-label={`Move "${name}" down`}
                  disabled={reorderDisabled}
                  className={CONTROL_CLASSES}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReorder?.(layer.id, "down");
                  }}
                >
                  <ArrowIcon direction="down" />
                </button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    );
  };

  // Top-most first at every level; a parent's children go in a follow-on group so
  // the DOM mirrors the hierarchy without adding a tab stop.
  const renderNodes = (nodes: readonly LayerTreeNode[]): ReactNode[] =>
    [...nodes].reverse().map((node) => (
      <Fragment key={node.layer.id}>
        {renderRow(node.layer, node.depth)}
        {node.children.length > 0 ? (
          <div role="group" data-km-layer-group="" className={GROUP_CLASSES}>
            {renderNodes(node.children)}
          </div>
        ) : null}
      </Fragment>
    ));

  return (
    <div
      ref={ref}
      data-km-layer-list="root"
      role="tree"
      aria-label={ariaLabel ?? DEFAULT_LIST_LABEL}
      className={joinClasses(LIST_CLASSES, className)}
      {...props}
    >
      {layers.length === 0 ? (
        <div data-km-layer-list="empty" className={EMPTY_CLASSES}>
          No layers yet. Add a layer to start composing.
        </div>
      ) : (
        renderNodes(tree)
      )}
    </div>
  );
});

LayerList.displayName = "LayerList";

export { LayerStack, LayerList };
export default LayerStack;

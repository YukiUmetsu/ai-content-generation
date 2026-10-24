import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, HTMLAttributes, ReactNode } from "react";
import type { FontAsset, Size, TextSpec, TextSpan } from "./document";
import { textSpecToString } from "./document";
import type { MeasureText, TextLayoutResult } from "./text-layout";
import { createCanvasMeasurer, fontFamilyChain, layoutText } from "./text-layout";
import { useMediaCanvasOrDefault } from "./media-context";

/** Fallback stack used when a referenced font is missing, matching `layoutText`'s own substitution. */
const MISSING_FONT_FAMILY = "system-ui, sans-serif";

const ROOT_CLASSES = [
  "text-foreground",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity motion-reduce:transition-none",
].join(" ");

/** Line blocks are forced to block layout so `span`/`div` line tags still stack one per line. */
const LINE_CLASSES = "block m-0";

const EDITABLE_BLOCK_CLASSES = [
  "block m-0 cursor-text bg-transparent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity motion-reduce:transition-none",
].join(" ");

const PLACEHOLDER_CLASSES =
  "pointer-events-none absolute inset-0 select-none text-muted-foreground";

/** Authoring-only diagnostic caption copy; semantic caption size and danger colour. */
const DIAGNOSTIC_CLASSES = "text-caption text-danger";

/**
 * The diagnostics region is rendered inside a layer box, so in a real
 * composition it sits on top of artwork and its contrast would otherwise depend
 * on the picture behind it. It therefore carries its own opaque surface
 * (`bg-surface`) and a border: the caption's contrast is measured against a
 * surface the component controls, never against the composition. The box stays
 * caption-sized and never widens the layer (`max-w-full`).
 */
const DIAGNOSTIC_REGION_CLASSES = [
  "inline-flex max-w-full flex-col gap-1",
  "rounded-sm border border-border bg-surface px-1.5 py-1",
  "text-caption text-danger",
].join(" ");

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * CSS mirror of the styling `layoutText` measured for one run. The family comes
 * from the resolved `FontAsset` (its quoted fallback chain), the weight/italic
 * from the span override or the asset, and `fontSize`/`letterSpacing` are
 * inherited from the enclosing block, so the DOM wraps exactly what the engine
 * measured.
 */
function spanStyle(
  span: TextSpan,
  spec: TextSpec,
  fonts: Record<string, FontAsset>,
  size: number
): CSSProperties {
  const font = fonts[span.fontId ?? spec.fontId];
  const italic = span.italic ?? (font ? font.style === "italic" : false);
  const style: CSSProperties = {
    fontSize: `${size}px`,
    fontWeight: span.weight ?? font?.weight ?? 400,
    fontStyle: italic ? "italic" : "normal",
    fontFamily: font ? fontFamilyChain(font) : MISSING_FONT_FAMILY,
  };
  if (span.color) style.color = span.color;
  if (span.underline) style.textDecorationLine = "underline";
  return style;
}

/** Shared block geometry: resolved size, absolute line height, tracking and alignment. */
function blockStyle(spec: TextSpec, size: number, lineHeight: number): CSSProperties {
  const style: CSSProperties = {
    fontSize: `${size}px`,
    lineHeight: `${lineHeight}px`,
    margin: 0,
    textAlign: spec.align,
  };
  if (spec.letterSpacing !== 0) style.letterSpacing = `${spec.letterSpacing}px`;
  return style;
}

export interface EditableTextProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange"> {
  /** The text layer's spec: spans, font, size, alignment, direction and fit policy. */
  text: TextSpec;
  /** Font registry keyed by `FontAsset.id`; the spec and its spans reference it by id. */
  fonts: Record<string, FontAsset>;
  /**
   * Design-space box the text is laid out inside. Defaults to the enclosing
   * design box read from the media canvas context (the artboard size, until a
   * layer-size context exists); when neither is usable the box falls back to
   * `{ width: text.size * 20, height: text.size * 4 }`.
   * @default the enclosing media canvas box, or the `text.size` estimate
   */
  box?: Size;
  /**
   * Enable in-place editing. While on, the spec renders as a single
   * `contentEditable` block so caret, selection and IME stay native; the
   * deterministic per-line layout is used only for read-only display.
   * @default false
   */
  editable?: boolean;
  /** Shown when the text has no visible content and `editable` is on. */
  placeholder?: string;
  /**
   * Called with the next spec on every accepted edit; the component is controlled.
   *
   * Flattening a styled-span staging into a single `contentEditable` region
   * collapses runs, so the resulting spec keeps span *styling* only for the runs
   * that survive: the first span owns the whole edited string and the remaining
   * spans are dropped rather than blanked, so no dead empty spans are emitted.
   * Span-preserving rich editing is out of scope for M0.
   */
  onChange?: (next: TextSpec) => void;
  /**
   * Reports the measured layout by value whenever it changes.
   *
   * Its meaning follows what is actually rendered. Read-only it is the spec's own
   * fit policy, so it may report truncation, shrink or clipping exactly as today.
   * While `editable` the browser wraps the whole spec in an unclipped block, so it
   * reports the rendered block instead: every line is kept (`truncated` is
   * `false`), `overflow` measures the natural content height against the box and
   * `size` stays the authored size. The two differ only when the read-only policy
   * would have truncated or shrunk; the root then carries `fit-suspended`.
   */
  onLayoutChange?: (result: TextLayoutResult) => void;
  /**
   * Explicit measurer. Defaults to a canvas-backed measurer in the browser.
   * @default `createCanvasMeasurer(fonts)`
   */
  measure?: MeasureText;
  /**
   * Surface layout diagnostics inline (missing font, overflow, truncation).
   * @default true
   */
  showDiagnostics?: boolean;
}

/**
 * Rich-text primitive for media compositions.
 *
 * Text stays text: the component never rasterizes and owns no box — the caller
 * (`LayerStack`) sizes the layer and this renders pure content inside it. Every
 * line break comes from the frozen `layoutText` engine, so the DOM preview and
 * the SVG export share one wrap/fit policy, one locale-aware segmentation and
 * one font-fallback resolution.
 *
 * Read-only text renders one block element per line, each containing one
 * `<span>` per run so colour, weight, italic and underline survive wrapping; the
 * chosen tag (`text.as`) keeps headings as headings for assistive technology.
 * `fit: "clip"` sets `overflow: hidden` on the content; `wrap`/`none` never
 * clip and instead report `data-km-text-overflow` / `data-km-text-truncated` on
 * the root, plus a caption marker rendered *outside* the clipped content so a
 * diagnostic can never be swallowed by the clip it reports.
 *
 * While `editable` the whole spec renders as a single `contentEditable` block
 * (`role="textbox"`, `aria-multiline`) so the browser manages wrapping, caret
 * and IME natively. That block is rendered with **no React-managed children**:
 * its text is written imperatively only when the incoming plain text differs
 * from the value the component last emitted, so a browser edit can never
 * desynchronise React's child tree (the source of the `removeChild` crash).
 * `onInput` is ignored during composition and edits are
 * reported as a new controlled spec — never for an unchanged value. The editor
 * carries `aria-placeholder` when a placeholder is set (the visual hint stays
 * `aria-hidden` decoration) and `aria-describedby` pointing at the diagnostics
 * captions, written only while at least one diagnostic exists so the reference
 * is never dangling. A non-editable root with an `aria-label` gains
 * `role="group"` so its label is actually exposed.
 *
 * The reported layout follows what is on screen, not the authored policy. While
 * `editable` the block grows with its content and is never height-clipped, so
 * `fit`/`maxLines`/`shrink` cannot apply to it: the layout is computed as
 * `fit: "none"` with `maxLines` ignored — `lineCount` counts the lines actually
 * rendered, `truncated` is always `false`, `overflow` is the truthful
 * natural-height-versus-box test and `size` stays the spec's size. The read-only
 * path keeps its exact fit behaviour, so the two can differ; when the read-only
 * policy would in fact have truncated or shrunk, the root exposes that the
 * difference is deliberate rather than hidden: it sets
 * `data-km-text-editing="true"` for the duration of the edit and appends a
 * `fit-suspended` token to `data-km-text-diagnostic` (space-joined after the
 * existing tokens). A short spec the policy would not have touched gains neither.
 *
 * An accepted edit cannot recover run boundaries from `textContent`, so a
 * multi-span spec collapses to the span that carries the edited text (styling
 * survives only for that first run) and no empty spans are emitted; a
 * single-span spec keeps its run apart from the text. When an edit collapses a
 * multi-span spec the root gains `data-km-text-diagnostic="spans-collapsed"`
 * (space-joined with any other root diagnostic) so the loss is machine-readable.
 * Span-preserving rich editing is out of scope for M0.
 */
const EditableText = forwardRef<HTMLDivElement, EditableTextProps>(function EditableText(
  {
    text,
    fonts,
    box,
    editable = false,
    placeholder,
    onChange,
    onLayoutChange,
    measure,
    showDiagnostics = true,
    className,
    style,
    "aria-label": ariaLabel,
    ...props
  },
  ref
) {
  const canvas = useMediaCanvasOrDefault();

  // Stable id for the diagnostics region. It is referenced by the editor only
  // when a diagnostic actually renders, so no dangling `aria-describedby` is
  // ever written.
  const diagnosticsId = useId();

  // Records that an accepted edit collapsed a multi-span spec. It only drives a
  // machine-readable root attribute (never visible text) and only for the edited
  // case, so an unedited render stays byte-identical.
  const [collapsedSpans, setCollapsedSpans] = useState(false);

  // The editable element renders no React children, so the text node inside it is
  // owned by the browser. React therefore never reconciles (or removes) children
  // it did not create, which is exactly what threw
  // `NotFoundError: Failed to execute 'removeChild'` while a multi-span spec was
  // edited in place.
  const editorRef = useRef<HTMLElement | null>(null);

  // Plain text this component last wrote to the editor (or emitted as the
  // controlling value). The seeding effect rewrites `textContent` only when the
  // model diverges from it, so a continuous run of native edits is never
  // clobbered and the caret never jumps to the start on every keystroke.
  const lastEmittedText = useRef<string | null>(null);

  // A freshly attached element starts empty, so forget the last emitted value to
  // force the effect to seed it — including when `editable` toggles back on.
  const setEditorRef = useCallback((node: HTMLElement | null) => {
    editorRef.current = node;
    if (node) lastEmittedText.current = null;
  }, []);

  // Resolve the layout box. `box` (owned by LayerStack) always wins; otherwise
  // the enclosing design box is the canvas artboard, since M0 has no layer-size
  // context yet. A malformed context falls back to an intrinsic estimate scaled
  // to the text, so layout is always finite and never throws.
  const resolvedBox = useMemo<Size>(() => {
    if (box) return box;
    const { artboard } = canvas;
    if (
      Number.isFinite(artboard.width) &&
      Number.isFinite(artboard.height) &&
      artboard.width > 0 &&
      artboard.height > 0
    ) {
      return { width: artboard.width, height: artboard.height };
    }
    return { width: text.size * 20, height: text.size * 4 };
  }, [box, canvas, text.size]);

  // One canvas-backed measurer per font table; callers may inject their own so
  // preview and export can share a deterministic stand-in.
  const canvasMeasurer = useMemo(() => createCanvasMeasurer(fonts), [fonts]);
  const measurer = measure ?? canvasMeasurer;

  // The read-only presentation: the spec's own fit policy, unchanged.
  const readOnlyLayout = useMemo<TextLayoutResult>(
    () => layoutText(text, resolvedBox, fonts, measurer),
    [text, resolvedBox, fonts, measurer]
  );

  // The editable presentation, which is what that path actually renders: the
  // browser wraps the whole spec in one unclipped `contentEditable` block with no
  // height limit, so nothing is dropped or shrunk. Laying it out as `fit: "none"`
  // (with `maxLines` therefore ignored) yields the truthful figures — every
  // wrapped line is kept, `truncated` is always `false`, `overflow` is the real
  // natural-height-vs-box test and `size` is the authored size, never a shrink.
  const editableSpec = useMemo<TextSpec>(() => ({ ...text, fit: "none" }), [text]);
  const editableLayout = useMemo<TextLayoutResult>(
    () => layoutText(editableSpec, resolvedBox, fonts, measurer),
    [editableSpec, resolvedBox, fonts, measurer]
  );

  // The layout this render reports: what is on screen. While editing that is the
  // editable block's own layout, so the readout can never claim a truncation or
  // overflow the viewer cannot see (the "honest states" rule). The read-only
  // layout is still computed while editing so the two can be compared below.
  const layout = editable ? editableLayout : readOnlyLayout;

  // True only while editing a spec whose read-only presentation would genuinely
  // have differed — it would have truncated (dropped) lines or shrunk the text.
  // This is the one signal that the deterministic fit policy is suspended for the
  // duration of the edit; it drives the `fit-suspended` token so a DOM reader can
  // tell that the read-only figure was not simply what is rendered.
  const fitSuspended =
    editable && (readOnlyLayout.truncated || readOnlyLayout.size !== editableLayout.size);

  const missingFontIds = useMemo(() => {
    const ids = new Set<string>();
    if (!fonts[text.fontId]) ids.add(text.fontId);
    for (const span of text.spans) {
      const id = span.fontId ?? text.fontId;
      if (!fonts[id]) ids.add(id);
    }
    return Array.from(ids);
  }, [fonts, text]);

  // Report layout changes by value, not identity. A signature of the fields
  // consumers react to prevents the (freshly built) result object from
  // re-reporting on every render and creating a feedback loop.
  const previousSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!onLayoutChange) return;
    const signature = [
      layout.size,
      layout.lineCount,
      layout.overflow ? "1" : "0",
      layout.truncated ? "1" : "0",
      layout.usedFallbackFamily ? "1" : "0",
    ].join("|");
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    onLayoutChange(layout);
  }, [layout, onLayoutChange]);

  // Controlled `contentEditable`: the element has no React children, so its text
  // is written imperatively and only when the incoming plain text differs from
  // the value this component last emitted. A composition in progress never
  // reaches here (its `input` is rejected by the `isComposing` guard below, so
  // the model does not change), so an IME candidate window is never overwritten.
  useLayoutEffect(() => {
    if (!editable) return;
    const element = editorRef.current;
    if (!element) return;
    const nextText = textSpecToString(text);
    if (lastEmittedText.current === nextText) return;
    element.textContent = nextText;
    lastEmittedText.current = nextText;
  }, [editable, text]);

  const handleInput = (event: FormEvent<HTMLElement>) => {
    const native = event.nativeEvent;
    // IME safety: the browser owns composition; edits are accepted only once it
    // commits, so a controlled re-render never interrupts a candidate window.
    if (native instanceof InputEvent && native.isComposing) return;
    if (!onChange) return;
    if (text.spans.length === 0) return;

    const nextText = event.currentTarget.textContent ?? "";
    // Compared against what this component last emitted, not the (possibly
    // stale) prop: a rapid second keystroke before React re-renders is accepted
    // rather than swallowed as "unchanged".
    if (nextText === lastEmittedText.current) return;

    // M0 simplification: run boundaries cannot be reconstructed from
    // `textContent`, so a multi-span spec collapses into the FIRST span and the
    // remaining spans are DROPPED rather than blanked — a blanked span is a dead
    // entry that layout, measurement and export would have to skip defensively,
    // and it misrepresents the author's document. A single-span spec keeps its
    // run untouched apart from the text, so its result is unchanged.
    const collapsed = text.spans.length > 1;
    const spans: TextSpan[] = collapsed
      ? [{ ...text.spans[0], text: nextText }]
      : text.spans.map((span) => ({ ...span, text: nextText }));

    if (collapsed) setCollapsedSpans(true);

    // Record the value the model now holds so the seeding effect treats the DOM
    // as already in sync and does not reset the caret on the re-render it causes.
    lastEmittedText.current = nextText;

    onChange({ ...text, spans });
  };

  const resolvedSize = layout.size;
  const resolvedLineHeight = text.lineHeight * resolvedSize;
  const lineStyle: CSSProperties = { ...blockStyle(text, resolvedSize, resolvedLineHeight),
    ...(text.lineBreak === "explicit-only" ? { whiteSpace: "pre" as const } : {}) };
  const editableStyle: CSSProperties = { ...lineStyle, whiteSpace: text.lineBreak === "explicit-only" ? "pre" : "pre-wrap" };

  const plainText = textSpecToString(text);
  const showPlaceholder = editable && placeholder != null && plainText.trim().length === 0;

  const diagnostics: ReactNode[] = [];
  if (showDiagnostics && layout.overflow) {
    diagnostics.push(
      <span key="overflow" data-km-text-diagnostic="overflow" className={DIAGNOSTIC_CLASSES}>
        Text overflows its box
      </span>
    );
  }
  if (showDiagnostics && layout.truncated) {
    diagnostics.push(
      <span key="truncated" data-km-text-diagnostic="truncated" className={DIAGNOSTIC_CLASSES}>
        Text is truncated
      </span>
    );
  }
  if (showDiagnostics && missingFontIds.length > 0) {
    diagnostics.push(
      <span key="font" data-km-text-diagnostic="font-missing" className={DIAGNOSTIC_CLASSES}>
        {`Missing font: ${missingFontIds.join(", ")}`}
      </span>
    );
  }

  // Machine-readable diagnostics aggregated on the root, next to the caption
  // markers above. The existing tokens mirror the captions; `spans-collapsed` is
  // appended once an accepted edit flattened a multi-span spec, and
  // `fit-suspended` once the read-only fit policy would have truncated or shrunk
  // (so the reader knows the reported layout describes the editable render, not
  // the policy). The attribute exists only when one of those root-only tokens
  // applies, so an unedited render that only mirrors the captions gains nothing,
  // and the tokens are space-joined so every value stays discoverable in the
  // single `data-km-text-diagnostic` attribute.
  const rootDiagnostics: string[] = [];
  if (showDiagnostics && layout.overflow) rootDiagnostics.push("overflow");
  if (showDiagnostics && layout.truncated) rootDiagnostics.push("truncated");
  if (showDiagnostics && missingFontIds.length > 0) rootDiagnostics.push("font-missing");
  if (collapsedSpans) rootDiagnostics.push("spans-collapsed");
  if (fitSuspended) rootDiagnostics.push("fit-suspended");
  const rootDiagnostic =
    (collapsedSpans || fitSuspended) && rootDiagnostics.length > 0
      ? rootDiagnostics.join(" ")
      : undefined;

  let content: ReactNode;
  if (editable) {
    const Tag = text.as;
    content = (
      <Tag
        ref={setEditorRef}
        data-km-text="editor"
        dir={text.direction}
        lang={text.language}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        aria-describedby={diagnostics.length > 0 ? diagnosticsId : undefined}
        spellCheck
        onInput={handleInput}
        className={EDITABLE_BLOCK_CLASSES}
        style={editableStyle}
      />
    );
  } else {
    const Tag = text.as;
    content = (
      <div
        data-km-text="content"
        className={text.fit === "clip" ? "overflow-hidden" : undefined}
      >
        {layout.lines.map((line, lineIndex) => (
          <Tag
            key={lineIndex}
            data-km-text="line"
            dir={text.direction}
            lang={text.language}
            className={LINE_CLASSES}
            style={lineStyle}
          >
            {line.runs.map((run, runIndex) => {
              const span = text.spans[run.spanIndex] ?? text.spans[0];
              if (!span) return null;
              return (
                <span key={runIndex} style={spanStyle(span, text, fonts, resolvedSize)}>
                  {run.text}
                </span>
              );
            })}
          </Tag>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-km-text="root"
      data-km-text-fit={text.fit}
      data-km-text-truncated={layout.truncated ? "" : undefined}
      data-km-text-overflow={layout.overflow ? "" : undefined}
      data-km-text-font-missing={missingFontIds.length > 0 ? missingFontIds.join(",") : undefined}
      data-km-text-diagnostic={rootDiagnostic}
      data-km-text-editing={editable ? "true" : undefined}
      aria-label={editable ? undefined : ariaLabel}
      role={!editable && ariaLabel != null ? "group" : undefined}
      {...props}
      className={joinClasses(ROOT_CLASSES, editable && "relative", className)}
      style={style}
    >
      {content}
      {showPlaceholder ? (
        <span data-km-text="placeholder" aria-hidden="true" className={PLACEHOLDER_CLASSES} style={editableStyle}>
          {placeholder}
        </span>
      ) : null}
      {diagnostics.length > 0 ? (
        <div id={diagnosticsId} data-km-text-diagnostics="" className={DIAGNOSTIC_REGION_CLASSES}>
          {diagnostics}
        </div>
      ) : null}
    </div>
  );
});

EditableText.displayName = "EditableText";

export { EditableText };
export default EditableText;

import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import { Button } from "../ui/button";
import type { Diagnostic, ExportProfile, Layer, MediaDocument, Size, TextSpec } from "./document";
import { countBySeverity, round } from "./document";
import { Artboard } from "./artboard";
import { LayerStack } from "./layer-stack";
import { aspectParts, downloadBlob, exportFilename } from "./export-preview-utils";
import { useExportPreview } from "./use-export-preview";

/** Default small-format widths. */
const DEFAULT_INSPECTION_SIZES: readonly number[] = [320, 160, 96];

/** Stable empty array so defaulted props never invalidate a `useMemo`. */
const EMPTY_FAMILIES: readonly string[] = [];

/** Authored text tags that carry document-outline semantics. */
const HEADING_TAGS: readonly TextSpec["as"][] = ["h1", "h2", "h3"];

/** Non-heading tag substituted for authored headings inside a scoped preview. */
const NEUTRAL_TEXT_TAG: TextSpec["as"] = "div";

/**
 * Relative tolerance (0.5%) between the caller's requested output aspect and
 * the artboard's before the mismatch is reported. The exporter scales uniformly
 * from the requested width, so the height always follows the artboard aspect and
 * can only match the request when the two boxes share an aspect ratio.
 */
const OUTPUT_ASPECT_TOLERANCE = 0.005;

/** Stable code for the local advisory raised when an `outputSize` cannot be honoured. */
const OUTPUT_ASPECT_MISMATCH_CODE = "output-size-aspect-mismatch";

/** Merge conditional class lists, dropping empty entries; consumer classes win. */
function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/** Overall export state summarised by the header chip. */
type ExportStatusVariant = "ready" | "warning" | "blocking";

/**
 * Chip treatment per state. The label always uses `text-foreground` on the
 * opaque `bg-surface`, so its contrast is measured against a surface the
 * component controls and never depends on a status hue; severity is carried by
 * the visible word and the shape-distinct `StatusGlyph`, not by colour. Each
 * state still adds a distinct status-token *left border* as a decorative,
 * non-announced accent so the states read apart at a glance.
 */
const STATUS_CHIP_CLASSES: Record<ExportStatusVariant, string> = {
  ready: "border-l-status-success",
  warning: "border-l-status-warning",
  blocking: "border-l-status-danger",
};

/**
 * Shape-distinct status glyph so the chip never signals by colour alone — a
 * check, a warning triangle and a cross are told apart without colour vision.
 * It is decorative: the chip's visible label names the state for assistive
 * technology, so the glyph is `aria-hidden`.
 */
function StatusGlyph({ variant }: { variant: ExportStatusVariant }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 shrink-0"
    >
      {variant === "ready" ? (
        <>
          <circle cx="6" cy="6" r="4.6" />
          <path d="m3.9 6.1 1.5 1.5 2.8-3.2" />
        </>
      ) : null}
      {variant === "warning" ? (
        <>
          <path d="M6 1.6 11 10.4H1Z" />
          <path d="M6 4.7v2.4" />
          <path d="M6 8.8h.01" />
        </>
      ) : null}
      {variant === "blocking" ? (
        <>
          <circle cx="6" cy="6" r="4.6" />
          <path d="m4.2 4.2 3.6 3.6" />
          <path d="m7.8 4.2-3.6 3.6" />
        </>
      ) : null}
    </svg>
  );
}

/**
 * Take the heading semantics out of a document's text layers by rendering their
 * authored heading tags (`h1`/`h2`/`h3` — the heading levels `TextSpec` allows)
 * as the neutral `div` tag, so a previewed composition cannot join the host
 * page's heading outline. Only `text.as` is replaced: layer
 * ids, geometry, paint order and content are untouched, and non-text layers pass
 * through by reference. The preview stays pixel-identical because `EditableText`
 * derives its styling from the spec, never from the chosen tag.
 */
function withoutHeadingSemantics(layers: readonly Layer[]): Layer[] {
  return layers.map((layer) =>
    layer.kind === "text" && HEADING_TAGS.includes(layer.text.as)
      ? { ...layer, text: { ...layer.text, as: NEUTRAL_TEXT_TAG } }
      : layer
  );
}

export interface ExportPreviewProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "title"> {
  /** Document to inspect and export. */
  document: MediaDocument;
  /** Design-space scale of the DOM preview. @default 1 */
  scale?: number;
  /**
   * Output size override, e.g. a platform's exact pixel size. Defaults to the
   * artboard size.
   *
   * Only `width` drives the export scale: the height is *derived* from the
   * artboard's aspect ratio so the artwork is never stretched. When the
   * requested box's aspect differs from the artboard's beyond 0.5% the requested
   * height cannot be produced and the preview surfaces an
   * `output-size-aspect-mismatch` warning naming both sizes.
   */
  outputSize?: Size;
  /** @default true */
  showBleed?: boolean;
  /** @default true */
  showCrop?: boolean;
  /** @default true */
  showSafeRegion?: boolean;
  /** Widths used for small-format inspection. @default [320, 160, 96] */
  inspectionSizes?: readonly number[];
  /** Families confirmed present in the target environment; drives missing-font warnings. @default [] */
  availableFontFamilies?: readonly string[];
  /** Passed through to the exporter so assets can be inlined. */
  resolveAssetHref?: (assetId: string, uri: string, mediaType: string) => string | null;
  /** Injected @font-face CSS so rasterisation matches the preview. */
  fontCss?: string;
  /** Called before a download. Return `false` to cancel it. */
  onExport?: (payload: { profile: ExportProfile; size: Size; svg: string; blob?: Blob }) => boolean | void;
  /** Render the export actions. @default true */
  showActions?: boolean;
  /**
   * Element the title is rendered as. The title is the preview's own heading, so
   * embedding an `ExportPreview` inside a page section that is already an `<h2>`
   * would create two sibling `<h2>`s and no `<h3>` under the section. Pass the
   * level that fits the host outline, or `"div"` to render a non-heading element
   * that looks identical (same classes) when the title is decorative and the
   * surrounding content already names the region.
   * @default "h2"
   */
  titleAs?: "h1" | "h2" | "h3" | "div";
  /**
   * Keep the previewed composition's own headings out of the host page's
   * heading outline. While on, the preview region is exposed as a single
   * labelled image (`role="img"`, named `Preview of {title}`) and the
   * composition's authored `h1`–`h6` text tags render as neutral elements.
   * Set `false` to accept the document's headings entering your outline.
   * @default true
   */
  scopedPreviewHeadings?: boolean;
}



/**
 * "Check before you ship" surface for M0 still exports.
 *
 * The DOM preview is intentionally WYSIWYG: it paints the same `Artboard` and
 * `LayerStack` components used in production, so typefaces, line breaking and
 * overlays cannot diverge from the deliverable. The small-format strip and the
 * download actions are driven by the exact SVG string returned by the exporter,
 * which is the same string passed to `documentToPng`. This closed loop means
 * what you inspect is what you ship.
 *
 * One advisory is computed here rather than by the exporter: when the caller's
 * `outputSize` aspect disagrees with the artboard's, only the width can be
 * honoured and the height silently follows the artboard aspect. The exporter
 * sees the document, not the caller's requested box, so it cannot detect this;
 * `ExportPreview` merges the resulting `output-size-aspect-mismatch` warning
 * into the *rendered* diagnostics list only. `useExportPreview`'s returned
 * `diagnostics` still mirrors the exporter exactly.
 */
export const ExportPreview = forwardRef<HTMLDivElement, ExportPreviewProps>(
  function ExportPreview(
    {
      document,
      scale = 1,
      outputSize,
      showBleed = true,
      showCrop = true,
      showSafeRegion = true,
      inspectionSizes = DEFAULT_INSPECTION_SIZES,
      availableFontFamilies = EMPTY_FAMILIES,
      resolveAssetHref,
      fontCss,
      onExport,
      showActions = true,
      scopedPreviewHeadings = true,
      titleAs = "h2",
      className,
      ...props
    },
    ref
  ) {
    const {
      size,
      svg,
      diagnostics,
      blocking,
      canExport,
      exportPng,
      downloadSvg,
    } = useExportPreview(document, {
      outputSize,
      availableFontFamilies,
      resolveAssetHref,
      fontCss,
      scale,
    });

    const [pngPending, setPngPending] = useState(false);
    const [exportError, setExportError] = useState<Diagnostic | null>(null);

    /**
     * Width actually available to the small-format strip, measured so an item
     * capped to fit can disclose that it is shown smaller than requested. The
     * cap itself is expressed in CSS (`min(100%, …)`), so the page never
     * overflows even before the first measurement; this only feeds the label.
     * `null` means "not measured yet" (server/first paint/jsdom), which reads as
     * "shown at the requested width" and therefore adds no disclosure.
     */
    const inspectionRef = useRef<HTMLUListElement | null>(null);
    const [inspectionWidth, setInspectionWidth] = useState<number | null>(null);

    useLayoutEffect(() => {
      const element = inspectionRef.current;
      if (!element) return;
      const measure = () => {
        const width = element.getBoundingClientRect().width;
        setInspectionWidth(width > 0 ? width : null);
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const title = document.metadata?.title || document.id;
    const { label: aspectLabel } = aspectParts(size);

    const handleDownloadSvg = () => {
      if (onExport?.({ profile: "still-svg", size, svg }) === false) return;
      downloadSvg();
    };

    const handleDownloadPng = async () => {
      setPngPending(true);
      setExportError(null);
      try {
        const result = await exportPng();
        if (onExport?.({ profile: "still-png", size, svg, blob: result.blob }) === false) return;
        downloadBlob(result.blob, exportFilename(document.id, result.size, "still-png"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "PNG export failed.";
        setExportError({
          severity: "error",
          code: "export-png-failed",
          message,
          sceneId: document.id,
        });
      } finally {
        setPngPending(false);
      }
    };

    const aspectRatio = size.width > 0 && size.height > 0 ? size.width / size.height : 1;

    /**
     * Advisory for an `outputSize` whose aspect the exporter cannot honour. It is
     * computed here rather than inside `preflightExport` because the exporter sees
     * the document, not the caller's requested output box, so it has no way to
     * detect the mismatch. It never enters `useExportPreview`'s `diagnostics`,
     * which must keep mirroring the exporter exactly — it is merged only into the
     * list this component renders.
     */
    const outputSizeDiagnostic = useMemo<Diagnostic | null>(() => {
      if (!outputSize || outputSize.width <= 0 || outputSize.height <= 0) return null;
      if (size.width <= 0 || size.height <= 0) return null;
      const requestedAspect = outputSize.width / outputSize.height;
      const actualAspect = size.width / size.height;
      const deviation = Math.abs(actualAspect - requestedAspect) / requestedAspect;
      if (round(deviation, 6) <= OUTPUT_ASPECT_TOLERANCE) return null;
      return {
        severity: "warning",
        code: OUTPUT_ASPECT_MISMATCH_CODE,
        sceneId: document.id,
        message:
          `Requested output ${outputSize.width} × ${outputSize.height} px has an aspect of ` +
          `${round(requestedAspect)}, but the artboard is ${round(actualAspect)}. Only the width ` +
          `drives the export scale, so the height follows the artboard aspect: the exported size ` +
          `is ${round(size.width)} × ${round(size.height)} px and the composition is not ` +
          `stretched. Request an output that matches the artboard aspect, or retarget the artboard.`,
      };
    }, [outputSize, size, document.id]);

    const displayedDiagnostics = useMemo(() => {
      const merged = outputSizeDiagnostic
        ? [...diagnostics, outputSizeDiagnostic]
        : [...diagnostics];
      return merged.sort((a, b) => {
        if (a.severity === b.severity) return 0;
        return a.severity === "error" ? -1 : 1;
      });
    }, [diagnostics, outputSizeDiagnostic]);

    /**
     * The chip counts the diagnostics the component actually renders, not the raw
     * exporter output. `output-size-aspect-mismatch` is computed here (the
     * exporter never sees the requested box), so counting `diagnostics` directly
     * would let the chip say "Ready to export" while the list below shows a
     * warning. Counting `displayedDiagnostics` keeps the chip and the list in
     * agreement by construction.
     */
    const { errors, warnings } = countBySeverity(displayedDiagnostics);

    const statusLabel =
      errors > 0
        ? `${errors} blocking issue${errors === 1 ? "" : "s"}`
        : warnings > 0
          ? `${warnings} warning${warnings === 1 ? "" : "s"}`
          : "Ready to export";

    const statusVariant: ExportStatusVariant =
      errors > 0 ? "blocking" : warnings > 0 ? "warning" : "ready";

    // The document itself is never mutated: a scoped preview paints a copy whose
    // text layers carry a non-heading tag, while the exporter keeps the original.
    const previewLayers = useMemo(
      () => (scopedPreviewHeadings ? withoutHeadingSemantics(document.layers) : document.layers),
      [document.layers, scopedPreviewHeadings]
    );

    // The title's element is caller-controlled so an embedded preview does not
    // duplicate the host page's heading outline; the classes keep it identical.
    const TitleElement = titleAs;

    return (
      <div
        ref={ref}
        data-km-export="root"
        className={joinClasses(
          "flex flex-col gap-6 rounded-surface border border-border bg-surface p-6 text-foreground",
          className
        )}
        {...props}
      >
        <div
          data-km-export="header"
          className="flex flex-wrap items-start justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <TitleElement className="text-heading-sm font-medium">{title}</TitleElement>
            <p className="text-caption text-muted-foreground">
              {size.width} × {size.height} px · {aspectLabel}
            </p>
          </div>
          <span
            data-status={statusVariant}
            className={joinClasses(
              "inline-flex shrink-0 items-center gap-1 rounded-full border border-l-4 border-border bg-surface px-2.5 py-1 text-caption font-medium text-foreground",
              STATUS_CHIP_CLASSES[statusVariant]
            )}
          >
            <StatusGlyph variant={statusVariant} />
            {statusLabel}
          </span>
        </div>

        <div
          data-km-export="preview"
          className="overflow-hidden rounded-surface border border-border bg-canvas p-4"
        >
          <div
            data-km-export="preview-scope"
            role={scopedPreviewHeadings ? "img" : undefined}
            aria-label={scopedPreviewHeadings ? `Preview of ${title}` : undefined}
            className="mx-auto w-full max-w-full"
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
          >
            <Artboard
              artboard={document.artboard}
              fit="contain"
              showBleed={showBleed}
              showCrop={showCrop}
              showSafeRegion={showSafeRegion}
              zoom={scale}
              className="h-full w-full"
            >
              <LayerStack
                layers={previewLayers}
                fonts={document.fonts}
                assets={document.assets}
              />
            </Artboard>
          </div>
        </div>

        <div data-km-export="inspection" className="min-w-0">
          <h3 className="mb-3 text-body-sm font-medium">Small-format check</h3>
          {blocking.length > 0 ? (
            <div className="rounded-surface border border-dashed border-border bg-surface-subtle px-4 py-3 text-body-sm text-muted-foreground">
              Small-format preview unavailable: {blocking.length} blocking issue
              {blocking.length === 1 ? "" : "s"} must be fixed before export.
            </div>
          ) : null}
          <ul
            ref={inspectionRef}
            className={joinClasses(
              "flex min-w-0 max-w-full flex-wrap gap-4",
              blocking.length > 0 && "pointer-events-none opacity-40"
            )}
            aria-label="Small-format previews"
          >
            {inspectionSizes.map((width) => {
              const height = width / aspectRatio;
              // The requested width is a preference: the item never exceeds the
              // strip, so no consumer can be pushed wider than its container.
              const shownWidth =
                inspectionWidth === null ? width : Math.min(width, inspectionWidth);
              const scaledDown = shownWidth < width;
              return (
                <li
                  key={width}
                  className="flex min-w-0 flex-col gap-1"
                  style={{ width: `min(100%, ${width}px)` }}
                >
                  <div
                    className="w-full max-w-full overflow-hidden rounded-surface border border-border bg-canvas"
                    style={{ aspectRatio: `${width} / ${height}` }}
                  >
                    <img
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                      alt={`${title} at ${width}px wide`}
                      width={width}
                      height={height}
                      className="block h-full w-full"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <span className="text-caption text-muted-foreground">
                    {width}px{scaledDown ? ` · shown at ${Math.round(shownWidth)}px` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div data-km-export="diagnostics">
          <h3 className="mb-3 text-body-sm font-medium">Export issues</h3>
          {displayedDiagnostics.length === 0 ? (
            <p className="rounded-surface border border-border bg-surface-subtle px-4 py-3 text-body-sm text-muted-foreground">
              No export issues. The downloadable file matches the preview above.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Export diagnostics">
              {displayedDiagnostics.map((diagnostic, index) => {
                const isBlocking = diagnostic.severity === "error";
                return (
                  <li
                    key={`${index}-${diagnostic.code}`}
                    data-severity={diagnostic.severity}
                    className={joinClasses(
                      "rounded-r-surface border-l-2 px-3 py-2 text-body-sm",
                      isBlocking
                        ? "border-danger bg-danger/5 text-foreground"
                        : "border-border bg-surface-subtle text-foreground"
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span
                        className={joinClasses(
                          "font-medium",
                          isBlocking ? "text-danger" : "text-muted-foreground"
                        )}
                      >
                        {isBlocking ? "Blocking" : "Warning"}
                      </span>
                      <code className="font-mono text-caption break-all text-muted-foreground">
                        {diagnostic.code}
                      </code>
                    </div>
                    <p className="break-words">{diagnostic.message}</p>
                    {diagnostic.layerId ? (
                      <p className="mt-1 text-caption text-muted-foreground">
                        Layer{" "}
                        <code className="font-mono break-all">{diagnostic.layerId}</code>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {exportError ? (
            <div
              aria-live="polite"
              data-km-export="error"
              className="mt-3 rounded-surface border border-danger/20 bg-danger/5 px-4 py-3 text-body-sm text-danger"
            >
              <strong className="font-medium">PNG export failed:</strong>{" "}
              <span className="break-words">{exportError.message}</span>
              {exportError.message.includes("tainted") ||
              exportError.message.includes("SecurityError") ? (
                <span className="block mt-1">
                  Inline remote assets with <code className="font-mono">resolveAssetHref</code> so
                  the canvas stays same-origin.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {showActions ? (
          <div
            data-km-export="actions"
            className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4"
          >
            <Button
              variant="outline"
              disabled={!canExport}
              onClick={handleDownloadSvg}
            >
              Download SVG
            </Button>
            <Button
              variant="outline"
              disabled={!canExport}
              isLoading={pngPending}
              loadingLabel="Exporting PNG…"
              onClick={handleDownloadPng}
            >
              <span className="grid">
                <span className={pngPending ? "invisible" : ""}>Download PNG</span>
                <span
                  aria-hidden={!pngPending}
                  className={joinClasses(
                    "col-start-1 row-start-1",
                    pngPending ? "" : "invisible"
                  )}
                >
                  Exporting PNG…
                </span>
              </span>
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
);

ExportPreview.displayName = "ExportPreview";

export default ExportPreview;

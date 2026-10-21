import { forwardRef, useEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { ImageAsset, Insets, MediaFit, MediaMask, MediaSpec } from "./document";

/** Lifecycle of the referenced asset inside the frame. */
export type MediaLoadState = "idle" | "loading" | "loaded" | "error";

export interface MediaFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Placement contract: fit, focal point, mask and source-space crop. */
  media: MediaSpec;
  /** Asset metadata. When omitted the frame renders an honest "missing asset" state. */
  asset?: ImageAsset;
  /** Resolved src that overrides `asset.uri` (e.g. an object URL or optimised rendition). */
  src?: string;
  /** Alt override; resolution order is `media.alt` > `alt` > `asset.alt`. */
  alt?: string;
  /** Native loading hint forwarded to `<img>`. @default "lazy" */
  loading?: "eager" | "lazy";
  /** Forwarded to `<img>` for cross-origin assets. */
  crossOrigin?: "anonymous" | "use-credentials";
  /** Rendered when the asset is missing or fails to load. */
  fallback?: ReactNode;
  /** Non-jittery skeleton while the asset decodes. @default true */
  showPlaceholder?: boolean;
  /** Called whenever the load state settles or changes, including on mount. */
  onLoadStateChange?: (state: MediaLoadState) => void;
}

/** A crop that would remove the whole source on an axis is dropped rather than clamped further. */
const CROP_EDGE_LIMIT = 0.98;

const FRAME_CLASSES = "relative overflow-hidden bg-surface-inset";

/** The media element always fills its positioned parent; `object-fit` is applied inline. */
const MEDIA_CLASSES = "block h-full w-full";

const SKELETON_CLASSES =
  "pointer-events-none absolute inset-0 animate-pulse bg-surface-inset motion-reduce:animate-none";

const MESSAGE_CLASSES = "flex h-full w-full items-center justify-center p-4 text-center";
const MESSAGE_TEXT_CLASSES = "text-sm text-muted-foreground";

const OBJECT_FIT: Record<MediaFit, CSSProperties["objectFit"]> = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
  none: "none",
};

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/** Clamp to 0..1, falling back to a caller-chosen value for non-finite input. */
function clamp01(value: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** Clamp a source-space crop fraction into `[0, CROP_EDGE_LIMIT]`. */
function clampCropFraction(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(CROP_EDGE_LIMIT, Math.max(0, value));
}

interface ResolvedCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Normalise a source-space crop into clamped fractions, or `null` when no crop
 * should be applied. Fractions are clamped to `[0, 0.98]` so the enlarged inner
 * box can never divide by zero, and a crop whose fractions sum to `>= 1` on
 * either axis is ignored entirely: it would describe a zero-or-negative source
 * region, which is meaningless rather than merely extreme.
 */
function resolveCrop(crop: Insets | undefined): ResolvedCrop | null {
  if (!crop) return null;
  const top = clampCropFraction(crop.top);
  const right = clampCropFraction(crop.right);
  const bottom = clampCropFraction(crop.bottom);
  const left = clampCropFraction(crop.left);
  if (left + right >= 1 || top + bottom >= 1) return null;
  if (left === 0 && right === 0 && top === 0 && bottom === 0) return null;
  return { top, right, bottom, left };
}

/**
 * Enlarges and offsets an inner box so the visible frame shows exactly the
 * cropped region of the source. This is a pure view transform: it never touches
 * `asset.width`/`asset.height`. The `top`/`left` percentages resolve against the
 * frame (containing block), so an inner width of `100 / (1 - left - right)%`
 * offset by `-left / (1 - left - right) * 100%` aligns source fraction `left`
 * with the frame's leading edge.
 */
function cropStyle(crop: ResolvedCrop): CSSProperties {
  const widthScale = 1 - crop.left - crop.right;
  const heightScale = 1 - crop.top - crop.bottom;
  return {
    position: "absolute",
    top: `${(-crop.top / heightScale) * 100}%`,
    left: `${(-crop.left / widthScale) * 100}%`,
    width: `${(1 / widthScale) * 100}%`,
    height: `${(1 / heightScale) * 100}%`,
  };
}

/**
 * Mask is a view transform on the frame, never on the source. `rounded` uses the
 * authored radius (or 0); `inset` clips per edge; `circle` uses a `50%` radius,
 * which is deliberately not paired with a forced `aspect-ratio: 1` — on a
 * non-square frame that yields an ellipse, which is the honest result of the
 * mask the author asked for.
 */
function maskStyle(mask: MediaMask | undefined): CSSProperties {
  if (!mask) return {};
  switch (mask.kind) {
    case "rounded":
      return { borderRadius: `${mask.radius ?? 0}px` };
    case "circle":
      return { borderRadius: "50%" };
    case "inset": {
      const inset = mask.inset;
      return {
        clipPath: `inset(${inset?.top ?? 0}px ${inset?.right ?? 0}px ${
          inset?.bottom ?? 0
        }px ${inset?.left ?? 0}px)`,
      };
    }
    case "none":
    default:
      return {};
  }
}

/**
 * Places a referenced image, video or vector inside a layer box with an explicit
 * fit/fill policy, focal point, mask and crop.
 *
 * Every control here is a view transform: crop enlarges an inner box inside an
 * `overflow: hidden` frame, masks clip the frame, and the focal point maps to
 * `object-position` — the only crop control that leaves the source untouched.
 * The frame therefore never mutates the asset's intrinsic `width`/`height`.
 *
 * `cover` centred on a focal point is the least surprising default for editorial
 * media; `contain` letterboxes against the frame background, `fill` stretches
 * and `none` centres the media at its intrinsic size. A `video/*` asset renders
 * as a muted, non-autoplaying, control-free `<video>` (a static authoring frame,
 * with `media.poster` shown until metadata arrives); anything else — including
 * `image/*` and `image/svg+xml` — renders as a decoding `<img>`.
 *
 * The load state is exposed as `data-km-media-state` and streamed through
 * `onLoadStateChange`. While loading, a skeleton overlay fades in without
 * reflowing the frame. A missing or failed asset renders `fallback`, or an
 * honest static message; there is no retry affordance because the component has
 * no way to retry. The referenced asset id is exposed only as the
 * `data-km-media-asset` attribute, never as user-visible text.
 */
const MediaFrame = forwardRef<HTMLDivElement, MediaFrameProps>(function MediaFrame(
  {
    media,
    asset,
    src,
    alt,
    loading = "lazy",
    crossOrigin,
    fallback,
    showPlaceholder = true,
    onLoadStateChange,
    className,
    style,
    ...props
  },
  ref
) {
  const resolvedSrc = src ?? asset?.uri;
  const hasAsset =
    asset !== undefined && typeof resolvedSrc === "string" && resolvedSrc.length > 0;

  const [state, setState] = useState<MediaLoadState>(() => (hasAsset ? "loading" : "error"));

  // Reset to `loading` when the resolved source changes so a swapped rendition
  // does not briefly present the previous asset as loaded.
  const previousSrcRef = useRef(resolvedSrc);
  useEffect(() => {
    if (previousSrcRef.current === resolvedSrc) return;
    previousSrcRef.current = resolvedSrc;
    setState(hasAsset ? "loading" : "error");
  }, [resolvedSrc, hasAsset]);

  useEffect(() => {
    onLoadStateChange?.(state);
  }, [state, onLoadStateChange]);

  const decorative = media.decorative === true;
  const isVideo = (asset?.mediaType ?? "").startsWith("video/");
  const altText = media.alt ?? alt ?? asset?.alt;

  const focal = media.focalPoint ?? { x: 0.5, y: 0.5 };
  const objectPosition =
    media.fit === "none"
      ? "center"
      : `${clamp01(focal.x, 0.5) * 100}% ${clamp01(focal.y, 0.5) * 100}%`;

  const mediaStyle: CSSProperties = {
    objectFit: OBJECT_FIT[media.fit],
    objectPosition,
  };

  const handleLoad = () => setState("loaded");
  const handleError = () => setState("error");

  const crop = resolveCrop(media.crop);

  const mediaNode = isVideo ? (
    <video
      data-km-media="video"
      src={resolvedSrc}
      poster={media.poster}
      muted
      playsInline
      preload="metadata"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : altText}
      aria-hidden={decorative || undefined}
      className={MEDIA_CLASSES}
      style={mediaStyle}
      onLoadedMetadata={handleLoad}
      onError={handleError}
    />
  ) : (
    <img
      data-km-media="image"
      src={resolvedSrc}
      alt={decorative ? "" : altText ?? ""}
      aria-hidden={decorative || undefined}
      loading={loading}
      crossOrigin={crossOrigin}
      decoding="async"
      draggable={false}
      className={MEDIA_CLASSES}
      style={mediaStyle}
      onLoad={handleLoad}
      onError={handleError}
    />
  );

  const isMissing = !hasAsset;
  const isErrored = isMissing || state === "error";

  let body: ReactNode;
  if (isErrored) {
    body =
      fallback != null ? (
        fallback
      ) : (
        <div data-km-media="message" className={MESSAGE_CLASSES}>
          <span className={MESSAGE_TEXT_CLASSES}>
            {isMissing ? "Missing asset" : "Asset failed to load"}
          </span>
        </div>
      );
  } else {
    body = (
      <>
        {crop ? (
          <div data-km-media="crop" style={cropStyle(crop)}>
            {mediaNode}
          </div>
        ) : (
          mediaNode
        )}
        {showPlaceholder && (state === "idle" || state === "loading") ? (
          <div data-km-media="skeleton" aria-hidden="true" className={SKELETON_CLASSES} />
        ) : null}
      </>
    );
  }

  return (
    <div
      ref={ref}
      data-km-media-frame="root"
      data-km-media-state={state}
      data-km-media-asset={media.assetId}
      {...props}
      className={joinClasses(FRAME_CLASSES, className)}
      style={{ ...style, ...maskStyle(media.mask) }}
    >
      {body}
    </div>
  );
});

MediaFrame.displayName = "MediaFrame";

export { MediaFrame };
export default MediaFrame;

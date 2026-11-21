import { forwardRef, useEffect, useId, useMemo, useRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { AffineMatrix } from "../motion/types";
import type { CharacterAsset, CharacterCue, CharacterDefinition, CharacterDiagnostic, CharacterFrameState, CharacterInstance, CharacterPart, CharacterPartState, CharacterShape } from "./definition";
import { evaluateCharacter, partAssetKey, partLocalMatrix, resolveCharacterAppearance } from "./evaluate";

/** Original-part watercolor texture: the material follows animated vector assets,
 * never applies a global frame-wide posterization to the completed character.
 * Values are stylized controls, not measured pigment properties.
 */
export interface CharacterWatercolourMaterial {
  /** Stable paper-fibre granulation, 0..1. */
  granulation: number;
  /** Edge capillary softness, 0..1. */
  bleed: number;
  /** Cotton-paper surface relief, 0..1. */
  tooth: number;
  /** Same seed + part + pose always renders the same material. */
  seed: number;
}
/** Optional dry-brush paper rendering for characters with approved ink-oriented artwork.
 * This treats each rigged shape separately; it is not a filter over a completed video.
 */
export interface CharacterInkPartFinish {
  /** 0–1 strength of the soft capillary fringe on this precise rig part. */
  bleed?: number;
  /** Reserve a crisp un-displaced edge (eyes, pupils, mouth, props, fine lines). */
  dryContour?: boolean;
}
export interface CharacterInkMaterial {
  /** 0..1, controls paper-edge spread on each separate shape. */
  absorption: number;
  /** 0..1, stable spatial edge irregularity; identical at every frame. */
  grain: number;
  /** Static seeded fiber map, independent from blink and action frame. */
  seed: number;
  /** Optional per-part wet/dry treatment without replacing approved rig geometry. */
  partFinish?: Readonly<Record<string, CharacterInkPartFinish>>;
}
export interface CharacterPresenterProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  definition: CharacterDefinition;
  instance: CharacterInstance;
  cues: readonly CharacterCue[];
  /** Absolute frame. The presenter owns no clock. */
  frame: number;
  /** Host-resolved URLs for `kind: "image"` assets, keyed by `asset.uri`. Missing URLs are reported, never fetched. */
  assetUrls?: Record<string, string>;
  /** Material treatment for watercolor rigs. */
  watercolourMaterial?: CharacterWatercolourMaterial;
  /** Opt-in shape-native ink wash. Flat renderer is unchanged when absent. */
  inkMaterial?: CharacterInkMaterial;
  /** Required accessible name. The SVG art is hidden from assistive technology. */
  label: string;
  /** `auto` follows prefers-reduced-motion. `true` suppresses blink and idle motion for this performer. */
  reducedMotion?: boolean | "auto";
  /** Allow rigged limbs and pigment beyond the character's design rectangle. The outer FilmStage still clips the shot. Default false for backward compatibility. */
  allowOverflow?: boolean;
  /** Called from an effect whenever the evaluated diagnostics change. */
  onDiagnostics?: (diagnostics: CharacterDiagnostic[]) => void;
}

/** One drawing of a part: an asset key at an optional cross-fade opacity. */
interface Layer { key: string; opacity?: number }
interface PresenterModel {
  state: CharacterFrameState;
  palette: Record<string, string>;
  assets: Record<string, CharacterAsset>;
  layers: Record<string, Layer[]>;
  diagnostics: CharacterDiagnostic[];
}
interface Scene {
  model: PresenterModel; children: Record<string, CharacterPart[]>;
  urls: Record<string, string> | undefined;
  ink: CharacterInkMaterial | undefined;
  inkId: string;
  watercolour?: CharacterWatercolourMaterial;
  materialId: string;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Parts in ascending z (stable on array index), grouped under their parent. Orphans and roots render at top level. */
function buildHierarchy(parts: readonly CharacterPart[]) {
  const ids = new Set(parts.map(part => part.id));
  const sorted = parts.map((part, index) => ({ part, index })).sort((a, b) => a.part.z - b.part.z || a.index - b.index).map(entry => entry.part);
  const children: Record<string, CharacterPart[]> = {}, roots: CharacterPart[] = [];
  for (const part of sorted) {
    if (part.parent !== undefined && ids.has(part.parent)) (children[part.parent] ??= []).push(part);
    else roots.push(part);
  }
  return { roots, children };
}

/** Asset keys drawn for a part, bottom to top. A mouth cross-fade draws both shapes at their mix. */
function partLayers(part: CharacterPart, state: CharacterPartState): Layer[] {
  if (state.variantFrom !== undefined && state.variantMix !== undefined) {
    const mix = Math.min(1, Math.max(0, state.variantMix));
    // The outgoing drawing stays opaque underneath, so the body never shows through mid-swap.
    return [{ key: partAssetKey(part, state.variantFrom) }, { key: partAssetKey(part, state.variant), opacity: mix }];
  }
  return [{ key: partAssetKey(part, state.variant) }];
}

/** Palette references (`$name`) resolve through the appearance; only hex literals pass through. */
function paint(value: string | undefined, palette: Record<string, string>): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("$")) return palette[value.slice(1)] ?? "none";
  return HEX.test(value) ? value : "none";
}

function shapeNode(shape: CharacterShape, index: number, partId: string, scene: Scene): ReactNode {
  const palette = scene.model.palette;
  const paintProps = { fill: paint(shape.fill, palette), stroke: paint(shape.stroke, palette), strokeWidth: shape.strokeWidth, opacity: shape.opacity };
  const base = shape.type === "path"
    ? <path d={shape.d} {...paintProps} />
    : shape.type === "ellipse"
      ? <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...paintProps} />
      : <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} {...paintProps} />;
  if (!scene.ink) {
    if (!scene.watercolour) return <g key={index}>{base}</g>;
    return <g key={index} data-km-watercolour-character-part="">
      <g filter={"url(#" + scene.materialId + "-edge)"}>{base}</g>
      <g opacity={.045 + scene.watercolour.bleed * .11}
        filter={"url(#" + scene.materialId + "-bleed)"}>{base}</g>
    </g>;
  }
  const finish = scene.ink.partFinish?.[partId];
  const fringe = finish?.bleed ?? 1;
  // Like 筆墨分解 (separated brush / ink values), the character's original
  // articulated shapes own the fringe, dark core and paper-grain displacement.
  // This makes eyes and mouth deform with the face, not with a shot-wide wash.
  return <g key={index} data-km-ink-character-shape="" data-km-ink-character-part={partId}
    data-km-ink-part-bleed={fringe.toFixed(2)} data-km-ink-part-dry={finish?.dryContour ? "" : undefined}>
    {fringe > 0 && <g opacity={( .15 + scene.ink.absorption * .24) * fringe}
      filter={"url(#" + scene.inkId + "-bleed)"}>{base}</g>}
    <g filter={finish?.dryContour ? undefined : "url(#" + scene.inkId + "-edge)"}>{base}</g>
  </g>;
}

function assetNode(layer: Layer, index: number, partId: string, scene: Scene): ReactNode {
  const asset = scene.model.assets[layer.key];
  if (!asset) return null;
  let body: ReactNode = null;
  if (asset.kind === "shapes") body = asset.shapes.map((shape, i) => shapeNode(shape, i, partId, scene));
  // A missing URL draws nothing; the warning is raised with the other diagnostics.
  else if (scene.urls?.[asset.uri]) body = <image href={scene.urls[asset.uri]} x={0} y={0} width={asset.width} height={asset.height} />;
  return body === null ? null : <g key={index} data-asset={layer.key} opacity={layer.opacity}>{body}</g>;
}

/** Nested <g>s carry the parent chain: each child's local matrix is composed by the SVG transform stack. Children with a lower z than their parent draw beneath it. */
function partNode(part: CharacterPart, scene: Scene): ReactNode {
  const state = scene.model.state.parts[part.id];
  if (!state) return null;
  const kids = scene.children[part.id] ?? [];
  const m: AffineMatrix = partLocalMatrix(part, state);
  return <g key={part.id} data-part={part.id} transform={`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}>
    {kids.filter(child => child.z < part.z).map(child => partNode(child, scene))}
    {(scene.model.layers[part.id] ?? []).map((layer, i) => assetNode(layer, i, part.id, scene))}
    {kids.filter(child => child.z >= part.z).map(child => partNode(child, scene))}
  </g>;
}

/** Evaluates one performer at one absolute frame and draws the resulting pose. Pure: no state, timers or frame loops. */
export const CharacterPresenter = forwardRef<HTMLDivElement, CharacterPresenterProps>(function CharacterPresenter({
  definition, instance, cues, frame, assetUrls, label, reducedMotion = "auto", watercolourMaterial, onDiagnostics, inkMaterial, allowOverflow = false, style, ...props
}, ref) {
  if (watercolourMaterial && (
    !Number.isSafeInteger(watercolourMaterial.seed) || watercolourMaterial.seed < 0 ||
    watercolourMaterial.seed > 2147483647 ||
    ![watercolourMaterial.tooth, watercolourMaterial.bleed, watercolourMaterial.granulation]
      .every(v => Number.isFinite(v) && v >= 0 && v <= 1)
  )) throw new RangeError("Watercolour character material needs bounded tooth/bleed/granulation and seed.");
  if (watercolourMaterial && inkMaterial)
    throw new RangeError("Choose one native character material treatment at a time.");
  if (inkMaterial && (!Number.isSafeInteger(inkMaterial.seed) || inkMaterial.seed < 0 ||
      inkMaterial.seed > 2147483647 || !Number.isFinite(inkMaterial.absorption) ||
      inkMaterial.absorption < 0 || inkMaterial.absorption > 1 || !Number.isFinite(inkMaterial.grain) ||
      inkMaterial.grain < 0 || inkMaterial.grain > 1))
    throw new RangeError("Ink character seed, absorption or grain is outside its valid range.");
  if (inkMaterial?.partFinish) {
    const known = new Set(definition.parts.map(p => p.id));
    for (const [id, finish] of Object.entries(inkMaterial.partFinish)) {
      if (!known.has(id) || !finish ||
          (finish.bleed !== undefined && (!Number.isFinite(finish.bleed) || finish.bleed < 0 || finish.bleed > 1)) ||
          (finish.dryContour !== undefined && typeof finish.dryContour !== "boolean"))
        throw new RangeError("Ink part finish must name an existing rig part and contain bounded wet/dry values.");
    }
  }
  const rawInkId = useId();
  const inkId = "kmcharink" + rawInkId.replace(/[^a-zA-Z0-9_-]/g, "");
  const materialId = "kmwc" + rawInkId.replace(/[^a-zA-Z0-9_-]/g, "");
  const reduce = reducedMotion === "auto" ? typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches : reducedMotion;
  const hierarchy = useMemo(() => buildHierarchy(definition.parts), [definition.parts]);
  const model = useMemo<PresenterModel>(() => {
    const performer = reduce ? { ...instance, reducedMotion: true } : instance;
    const state = evaluateCharacter(definition, performer, cues, frame);
    const appearance = resolveCharacterAppearance(definition, instance.skin);
    const layers: Record<string, Layer[]> = {}, warnings: CharacterDiagnostic[] = [], reported = new Set<string>();
    for (const part of definition.parts) {
      const current = state.parts[part.id];
      if (!current) continue;
      layers[part.id] = partLayers(part, current);
      for (const layer of layers[part.id]) {
        const asset = appearance.assets[layer.key];
        if (asset?.kind !== "image" || assetUrls?.[asset.uri]) continue;
        const id = `${part.id}\u0000${asset.uri}`;
        if (reported.has(id)) continue;
        reported.add(id);
        warnings.push({ code: "missing-asset-url", severity: "warning", frame, partId: part.id,
          message: `Part "${part.id}" draws "${asset.uri}", which has no resolved URL, so it is not drawn.` });
      }
    }
    return { state, palette: appearance.palette, assets: appearance.assets, layers, diagnostics: [...state.diagnostics, ...warnings] };
  }, [definition, instance, cues, frame, reduce, assetUrls]);

  // Latest values in refs so the effect depends only on the serialized diagnostics.
  const notify = useRef(onDiagnostics), latest = useRef(model.diagnostics);
  notify.current = onDiagnostics; latest.current = model.diagnostics;
  const signature = JSON.stringify(model.diagnostics);
  useEffect(() => { notify.current?.(latest.current); }, [signature]);

  const scene: Scene = { model, children: hierarchy.children, urls: assetUrls, ink: inkMaterial, inkId,
    watercolour: watercolourMaterial, materialId };
  const { width, height } = definition.design;
  return <div {...props} ref={ref} role="img" aria-label={label} data-km-character-presenter=""
    data-reduced-motion={reduce ? "" : undefined} data-blinking={model.state.blinking ? "" : undefined} data-diagnostics={model.diagnostics.length}
    style={{ display: "block", position: "relative", width: "100%", aspectRatio: `${width} / ${height}`, overflow: allowOverflow ? "visible" : "hidden", ...style }}>
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
      strokeLinejoin="round" strokeLinecap="round" style={{ display: "block", width: "100%", height: "100%", overflow: allowOverflow ? "visible" : "hidden" }}>
      {watercolourMaterial && <defs>
        {/* Spatial texture is fixed to the character's local SVG coordinate system.
            It follows arms, eyes, mouth and clothes through their rig transforms. */}
        <filter id={materialId + "-edge"} x="-15%" y="-15%" width="130%" height="130%"
          colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise"
            baseFrequency={.025 + watercolourMaterial.tooth * .055}
            numOctaves={3} seed={1 + watercolourMaterial.seed % 997} result="paper"/>
          <feDisplacementMap in="SourceGraphic" in2="paper"
            scale={.1 + watercolourMaterial.granulation * 1.75}
            xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id={materialId + "-bleed"} x="-25%" y="-25%" width="150%" height="150%"
          colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={.15 + watercolourMaterial.bleed * 1.55}/>
        </filter>
      </defs>}
      {inkMaterial && <defs>
        <filter id={inkId + "-bleed"} x="-25%" y="-25%" width="150%" height="150%"
          colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={.45 + inkMaterial.absorption * 1.7}/>
        </filter>
        <filter id={inkId + "-edge"} x="-18%" y="-18%" width="136%" height="136%"
          colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={.07 + inkMaterial.grain * .13}
            numOctaves={3} seed={inkMaterial.seed % 1000} stitchTiles="stitch" result="paperFibers"/>
          <feDisplacementMap in="SourceGraphic" in2="paperFibers" scale={.25 + inkMaterial.grain * 1.35}
            xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs>}
      {hierarchy.roots.map(part => partNode(part, scene))}
    </svg>
  </div>;
});

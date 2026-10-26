import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { AffineMatrix } from "../motion/types";
import type { CharacterAsset, CharacterCue, CharacterDefinition, CharacterDiagnostic, CharacterFrameState, CharacterInstance, CharacterPart, CharacterPartState, CharacterShape } from "./definition";
import { evaluateCharacter, partAssetKey, partLocalMatrix, resolveCharacterAppearance } from "./evaluate";

export interface CharacterPresenterProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  definition: CharacterDefinition;
  instance: CharacterInstance;
  cues: readonly CharacterCue[];
  /** Absolute frame. The presenter owns no clock. */
  frame: number;
  /** Host-resolved URLs for `kind: "image"` assets, keyed by `asset.uri`. Missing URLs are reported, never fetched. */
  assetUrls?: Record<string, string>;
  /** Required accessible name. The SVG art is hidden from assistive technology. */
  label: string;
  /** `auto` follows prefers-reduced-motion. `true` suppresses blink and idle motion for this performer. */
  reducedMotion?: boolean | "auto";
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
interface Scene { model: PresenterModel; children: Record<string, CharacterPart[]>; urls: Record<string, string> | undefined }

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

function shapeNode(shape: CharacterShape, index: number, palette: Record<string, string>): ReactNode {
  const paintProps = { fill: paint(shape.fill, palette), stroke: paint(shape.stroke, palette), strokeWidth: shape.strokeWidth, opacity: shape.opacity };
  if (shape.type === "path") return <path key={index} d={shape.d} {...paintProps} />;
  if (shape.type === "ellipse") return <ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...paintProps} />;
  return <rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} {...paintProps} />;
}

function assetNode(layer: Layer, index: number, scene: Scene): ReactNode {
  const asset = scene.model.assets[layer.key];
  if (!asset) return null;
  let body: ReactNode = null;
  if (asset.kind === "shapes") body = asset.shapes.map((shape, i) => shapeNode(shape, i, scene.model.palette));
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
    {(scene.model.layers[part.id] ?? []).map((layer, i) => assetNode(layer, i, scene))}
    {kids.filter(child => child.z >= part.z).map(child => partNode(child, scene))}
  </g>;
}

/** Evaluates one performer at one absolute frame and draws the resulting pose. Pure: no state, timers or frame loops. */
export const CharacterPresenter = forwardRef<HTMLDivElement, CharacterPresenterProps>(function CharacterPresenter({
  definition, instance, cues, frame, assetUrls, label, reducedMotion = "auto", onDiagnostics, style, ...props
}, ref) {
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

  const scene: Scene = { model, children: hierarchy.children, urls: assetUrls };
  const { width, height } = definition.design;
  return <div {...props} ref={ref} role="img" aria-label={label} data-km-character-presenter=""
    data-reduced-motion={reduce ? "" : undefined} data-blinking={model.state.blinking ? "" : undefined} data-diagnostics={model.diagnostics.length}
    style={{ display: "block", position: "relative", width: "100%", aspectRatio: `${width} / ${height}`, overflow: "hidden", ...style }}>
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
      strokeLinejoin="round" strokeLinecap="round" style={{ display: "block", width: "100%", height: "100%", overflow: "hidden" }}>
      {hierarchy.roots.map(part => partNode(part, scene))}
    </svg>
  </div>;
});

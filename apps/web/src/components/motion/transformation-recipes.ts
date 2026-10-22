import type { FrameRange, RationalFps, Rect } from "./types";
import type {
  TransformationOptions, VisualElement, VisualMapping, VisualScene, VisualTransformationSpec,
} from "./visual-transformation-types";

/** Recipes author correspondence; they never infer mathematical or code equivalence. */
export interface TransformationRecipeTiming extends TransformationOptions {
  id: string;
  fps: RationalFps;
  durationFrames: number;
  range: FrameRange;
}

export interface TransformationPair extends TransformationOptions {
  from: string;
  to: string;
  semanticId: string;
}

export interface ScenePairRecipe extends TransformationRecipeTiming {
  from: VisualScene;
  to: VisualScene;
}

export const TRANSFORMATION_RECIPES = [
  { id: "shape", title: "Shape to shape", description: "Pair authored contours; incompatible topology uses an explicit dissolve." },
  { id: "diagram", title: "Diagram to diagram", description: "Move named nodes while replacing independently authored connectors." },
  { id: "diagram-equation", title: "Diagram to equation", description: "Assign one or more diagram elements to each authored equation term." },
  { id: "equation-code", title: "Equation to code", description: "Map authored symbols to code fragments; changed text dissolves." },
  { id: "scene-shared", title: "Scene with shared elements", description: "Hand named elements between scenes and deliberately enter or exit the rest." },
  { id: "assembly", title: "Assembly and disassembly", description: "Keep part identities while moving between assembled and separated layouts." },
  { id: "layout", title: "Layout rearrangement", description: "Reflow existing elements into caller-supplied bounds." },
] as const;

export function createShapeTransformation(
  options: ScenePairRecipe & { shapes: TransformationPair[]; shared?: TransformationPair[] },
): VisualTransformationSpec {
  return sceneRecipe(options, [...options.shapes.map((pair, index): VisualMapping => ({
    ...pair, id: `${options.id}-shape-${index}`, kind: "one-to-one", strategy: pair.strategy ?? options.strategy ?? "geometric-morph",
    fallback: options.fallback ?? "crossfade",
  })), ...(options.shared ?? []).map((pair, index): VisualMapping => ({
    ...pair, id: `${options.id}-shared-${index}`, kind: "one-to-one", strategy: pair.strategy ?? "shared-element",
  }))]);
}

export function createDiagramTransformation(
  options: ScenePairRecipe & { nodes: TransformationPair[]; connectors?: TransformationPair[] },
): VisualTransformationSpec {
  return sceneRecipe(options, [
    ...options.nodes.map((pair, index): VisualMapping => ({
      ...pair, id: `${options.id}-node-${index}`, kind: "one-to-one", strategy: pair.strategy ?? options.strategy ?? "auto",
    })),
    ...(options.connectors ?? []).map((pair, index): VisualMapping => ({
      ...pair, id: `${options.id}-connector-${index}`, kind: "one-to-one", strategy: pair.strategy ?? options.strategy ?? "crossfade",
    })),
  ]);
}

export function createDiagramEquationTransformation(
  options: ScenePairRecipe & {
    terms: Array<TransformationOptions & { from: [string, ...string[]]; to: string; semanticId: string }>;
  },
): VisualTransformationSpec {
  return sceneRecipe(options, options.terms.map((term, index): VisualMapping => term.from.length === 1
    ? { id: `${options.id}-term-${index}`, kind: "one-to-one", from: term.from[0], to: term.to, semanticId: term.semanticId, strategy: term.strategy ?? options.strategy ?? "crossfade" }
    : { id: `${options.id}-term-${index}`, kind: "many-to-one", from: [...term.from], to: term.to, semanticId: term.semanticId, strategy: "crossfade" }));
}

export function createEquationCodeTransformation(
  options: ScenePairRecipe & { symbols: TransformationPair[] },
): VisualTransformationSpec {
  return sceneRecipe(options, options.symbols.map((pair, index) => ({
    ...pair, id: `${options.id}-symbol-${index}`, kind: "one-to-one", strategy: pair.strategy ?? options.strategy ?? "crossfade",
  })));
}

/** Geometry, text, paint and parent relationships come from the supplied scene. */
export function createAssemblyTransformation(
  options: TransformationRecipeTiming & {
    scene: VisualScene;
    parts: Array<{ id: string; assembled: Rect; separated: Rect }>;
    direction: "assemble" | "disassemble";
  },
): VisualTransformationSpec {
  const parts = new Map(options.parts.map((part) => [part.id, part]));
  if (parts.size !== options.parts.length) throw new Error(`Assembly recipe "${options.id}" repeats a part. Give each part one assembled and separated layout.`);
  for (const part of options.parts) requireElement(options.scene, part.id, options.id);
  const makeScene = (pose: "assembled" | "separated"): VisualScene => ({
    id: `${options.scene.id}-${pose}`,
    elements: options.scene.elements.map((element) => ({ ...element, ...(parts.has(element.id) ? { layout: { ...parts.get(element.id)![pose] } } : {}) })),
  });
  const from = makeScene(options.direction === "assemble" ? "separated" : "assembled");
  const to = makeScene(options.direction === "assemble" ? "assembled" : "separated");
  return sceneRecipe({ ...options, from, to }, options.scene.elements.map((element, index) => ({
    id: `${options.id}-part-${index}`, kind: "one-to-one", from: element.id, to: element.id,
    semanticId: element.semanticId, strategy: options.strategy ?? "shared-element",
  })));
}

export function createLayoutTransformation(
  options: TransformationRecipeTiming & { scene: VisualScene; layouts: Record<string, Rect>; sceneId?: string },
): VisualTransformationSpec {
  for (const id of Object.keys(options.layouts)) requireElement(options.scene, id, options.id);
  const to = {
    id: options.sceneId ?? `${options.scene.id}-reflow`,
    elements: options.scene.elements.map((element) => ({ ...element,
      ...(options.layouts[element.id] ? { layout: { ...options.layouts[element.id] } } : {}),
    })),
  };
  return sceneRecipe({ ...options, from: options.scene, to }, options.scene.elements.map((element, index) => ({
    id: `${options.id}-layout-${index}`, kind: "one-to-one", from: element.id, to: element.id,
    semanticId: element.semanticId, strategy: options.strategy ?? "shared-element",
  })));
}

export function createSharedSceneTransformation(
  options: ScenePairRecipe & { shared: TransformationPair[] },
): VisualTransformationSpec {
  return sceneRecipe(options, options.shared.map((pair, index) => ({
    ...pair, id: `${options.id}-shared-${index}`, kind: "one-to-one", strategy: pair.strategy ?? options.strategy ?? "shared-element",
  })));
}

function sceneRecipe(options: ScenePairRecipe, mappings: VisualMapping[]): VisualTransformationSpec {
  return {
    schemaVersion: 1, id: options.id, fps: { ...options.fps }, durationFrames: options.durationFrames,
    range: { ...options.range }, from: options.from, to: options.to, mappings,
    ...(options.easing === undefined ? {} : { easing: options.easing }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    ...(options.particles === undefined ? {} : { particles: { ...options.particles } }),
  };
}

function requireElement(scene: VisualScene, id: string, recipeId: string): VisualElement {
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (!element) throw new Error(`Transformation recipe "${recipeId}" references missing element "${id}" in scene "${scene.id}". Add the element or correct the part/layout ID.`);
  return element;
}

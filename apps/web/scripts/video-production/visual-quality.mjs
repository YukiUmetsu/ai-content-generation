/** Fast, deterministic preflight of scenes the general exporter will actually draw.
 * Advisory only: static text geometry cannot substitute for browser-frame QA.
 */
import { fitSvgText } from "./text-layout.mjs";
import { layoutTeachingCard } from "./teaching-card-layout.mjs";

const stop = new Set("a an and are as at be but by for from has have how in into is it its of on or our that the their there these this to was were what when where which why with you your will can do does more than beyond new add adds".split(" "));
const normalized = value => String(value ?? "").toLocaleLowerCase().normalize("NFKC")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokens = value => new Set(normalized(value).split(/\s+/u).filter(word => word.length > 1 && !stop.has(word)));
const same = (left, right) => normalized(left) === normalized(right) && normalized(left).length >= 8;
const overlap = (left, right) => {
  const a = left instanceof Set ? left : tokens(left), b = right instanceof Set ? right : tokens(right);
  if (!a.size || !b.size) return { score: 0, shared: 0 };
  const shared = [...a].filter(word => b.has(word)).length;
  return { score: shared / (a.size + b.size - shared), shared };
};
const strongMatch = (a, b, minimum) => same(a, b) || (tokens(a).size >= minimum && tokens(b).size >= minimum &&
  overlap(a, b).shared >= minimum && overlap(a, b).score >= .7);
const sceneIsAuthored = visual => Boolean(visual.sceneRecipe || visual.chart ||
  visual.direction?.visualMechanic || visual.direction?.transformation);
const placeholders = /^(?:main idea|how it changes|house|categories|item\s*\d+|step\s*\d+|node\s*\d+)$/iu;
const impossibleDirection = /\b(?:split[- ]screen|cutaway|isometric|3d|three[- ]dimensional|camera orbit|photorealistic|morph(?:ing)?|stock footage|picture[- ]in[- ]picture)\b/iu;

// Dimensions mirror the Node instances in general-scene.tsx and
// semantic-scene-diagrams.tsx. Keep this in sync if those layouts change.
function cardSize(chapter, index, itemCount) {
  switch (chapter.intent) {
    case "general-intro": return index === 0 ? [640, 146] : itemCount >= 4 ? [345, 124] : [610, 124];
    case "general-payoff": return [625, 100];
    case "general-comparison": return itemCount > 3 ? [348, 132] : itemCount === 3 ? [220, 165] : [325, 165];
    case "general-breakdown": return [680, 94];
    // Normal narration yields a Kumiki journey (650px cards). Very short
    // ranges use the static 555×110 fallback; never mix their dimensions.
    case "general-flow": {
      const edges = itemCount - 1;
      const duration = chapter.endFrame - chapter.startFrame;
      return duration >= 8 + edges * 4 + (edges - 1) * 4
        ? [650, itemCount >= 5 ? 84 : itemCount === 4 ? 100 : 116]
        : [555, 110];
    }
    default: return [555, 110];
  }
}
function validateTextGeometry(chapter) {
  const visual = chapter.visual;
  fitSvgText(visual.headline, { maxWidthPx: 760, preferredSize: 72, minSize: 35, maxLines: 3 });
  fitSvgText(visual.subhead, { maxWidthPx: 750, preferredSize: 32, minSize: 22, maxLines: 4 });
  // Dedicated authored recipes and quantitative charts have independent layouts.
  if (visual.sceneRecipe || visual.chart || visual.direction?.visualMechanic || visual.direction?.transformation) return;
  for (let index = 0; index < visual.items.length; index++) {
    const [width, height] = cardSize(chapter, index, visual.items.length);
    const note = visual.itemNotes?.[index];
    if (note) layoutTeachingCard({ label: visual.items[index], note, width, height });
    else fitSvgText(visual.items[index], { maxWidthPx: width - 55, preferredSize: 29, minSize: 17, maxLines: 2 });
  }
}
const elementsSimilar = (a, b) => {
  const left = new Set(a.map(normalized)), right = new Set(b.map(normalized));
  return left.size >= 2 && right.size >= 2 && overlap(left, right).score >= .75;
};

export function analyzeRenderedSceneQuality({ plan, shotMap, beats }) {
  if (plan?.kind !== "general-explainer-visual-plan" || !Array.isArray(plan.chapters) ||
    !Array.isArray(shotMap) || !Array.isArray(beats) ||
    plan.chapters.length !== shotMap.length || plan.chapters.length !== beats.length ||
    shotMap.some((shot, i) => !shot?.shotId || shot.beatId !== plan.chapters[i].id)) {
    throw Error("Visual quality review requires an aligned compiled renderer plan, source shot map and narration beats.");
  }
  const findings = [];
  const add = (code, severity, index, message, suggestion, related = []) => findings.push({
    code, severity, shotId: shotMap[index].shotId,
    relatedShotIds: related.map(i => shotMap[i].shotId), message, suggestion,
  });
  for (let i = 0; i < plan.chapters.length; i++) {
    const chapter = plan.chapters[i], visual = chapter.visual;
    try { validateTextGeometry(chapter); }
    catch {
      add("renderer-text-overflow", "error", i,
        "Some copy cannot fit the renderer's defined title or card text area.",
        "Shorten the on-screen headline, supporting copy, or specific visible-element explanations, then refresh Preview.");
    }
    if (!sceneIsAuthored(visual) && visual.items.some(item => placeholders.test(item.trim()))) {
      add("placeholder-visual", "warning", i,
        "The scene contains generic labels rather than a specific object, mechanism or comparison.",
        "Edit Visible Elements: name 2–5 concrete things the viewer should see and explain what changes.");
    }
    if (!sceneIsAuthored(visual) && impossibleDirection.test(visual.direction?.visualAction ?? "")) {
      add("unrealized-direction", "warning", i,
        "The requested visual action is more specific than the current schematic renderer can execute.",
        "Author a supported semantic mechanic/scene recipe or revise the storyboard to explain the idea using visible diagram elements. The action text alone cannot create footage or 3D.");
    }
    for (let j = 0; j < i; j++) {
      const earlier = plan.chapters[j];
      if (strongMatch(visual.headline, earlier.visual.headline, 3)) {
        add("repeated-headline", "warning", i,
          `On-screen headline closely repeats shot ${j + 1}.`,
          "Give this shot one new teaching point or merge the redundant shots.", [j]);
        break;
      }
    }
    const narration = beats[i].narration ?? "";
    if (typeof narration === "string" && narration.length >= 48) {
      for (let j = 0; j < i; j++) {
        const earlier = beats[j].narration ?? "";
        if (typeof earlier !== "string" || earlier.length < 48) continue;
        if (strongMatch(narration, earlier, 7)) {
          add("repeated-narration", "warning", i,
            `Spoken explanation closely repeats shot ${j + 1}.`,
            "Change the narration to advance the explanation with new evidence, a consequence or a payoff.", [j]);
          break;
        }
      }
    }
    if (i >= 2) {
      const run = plan.chapters.slice(i - 2, i + 1);
      if (run.every(c => c.intent === chapter.intent && !sceneIsAuthored(c.visual)) &&
        elementsSimilar(run[0].visual.items, run[1].visual.items) &&
        elementsSimilar(run[1].visual.items, run[2].visual.items)) {
        add("repeated-schematic", "warning", i,
          "Three consecutive scenes use the same renderer layout and almost the same visible elements.",
          "Change the teaching structure: show a comparison, breakdown, a distinct visual state, or consolidate these shots.", [i - 2, i - 1]);
      }
    }
  }
  const errors = findings.filter(f => f.severity === "error").length;
  const warnings = findings.length - errors;
  return {
    schemaVersion: 1, kind: "rendered-scene-quality/v1",
    status: findings.length ? "needs-review" : "ready",
    basis: "compiled-renderer-static-preflight",
    summary: { errors, warnings, affectedShots: new Set(findings.map(f => f.shotId)).size,
      totalShots: plan.chapters.length },
    findings,
    limitation: "Static text-fit and structure checks cannot certify browser-pixel clipping, cinematic quality, or factual accuracy. Watch the full renderer preview at normal speed before publishing.",
  };
}

/**
 * Synthetic, offline HVAC example. Dollar amounts are illustrative only and
 * are never presented as market data. The sequence demonstrates a semantic
 * transformation: the equipment separates from the installed quote, the
 * remaining cost components accumulate, and the payoff compares installed
 * scope with equipment price alone.
 */

import {
  DEFAULT_FPS,
  STORYBOARD_KIND,
  STORYBOARD_SCHEMA_VERSION,
  type SemanticStoryboard,
} from "./types";

export const HVAC_EXAMPLE: SemanticStoryboard = {
  schemaVersion: STORYBOARD_SCHEMA_VERSION,
  kind: STORYBOARD_KIND,
  id: "storyboard-hvac-replacement-cost",
  title: "Why Replacing an HVAC System Costs So Much",
  locale: "en",
  fps: { ...DEFAULT_FPS },
  illustrativeData: true,
  assumptions: [
    "All dollar amounts are synthetic and rounded for explanation only.",
    "A real replacement quote varies with region, equipment efficiency, duct condition, permits and labor access.",
    "The cost shares are illustrative, not a market average or a prediction.",
  ],
  questions: [
    {
      id: "q-hvac-total",
      text: "Where does the rest of a replacement quote go, beyond the equipment?",
    },
  ],
  claims: [
    {
      id: "claim-illustrative-example",
      status: "illustrative",
      note: "Synthetic example: $12,400 installed quote, $7,100 equipment, $3,200 labor, $1,400 ductwork, $700 permits.",
      sourceRefs: [],
    },
  ],
  semanticObjects: [
    { id: "hvac-system", label: "HVAC system" },
    { id: "installed-quote", label: "Installed quote $12,400" },
    { id: "equipment-price", label: "Equipment $7,100" },
    { id: "labor-cost", label: "Labor $3,200" },
    { id: "ductwork-cost", label: "Ductwork $1,400" },
    { id: "permits-cost", label: "Permits $700" },
    { id: "running-total", label: "Running installed total $12,400" },
    { id: "cost-breakdown", label: "Completed cost breakdown" },
    { id: "comparison-bracket", label: "Installed scope vs equipment price" },
    { id: "assumptions-note", label: "Illustrative figures and assumptions" },
  ],
  semanticEvents: [
    { id: "quote-opens", label: "The quote separates from the equipment price", objectId: "installed-quote" },
    { id: "equipment-separates", label: "Equipment becomes one component", objectId: "equipment-price" },
    { id: "costs-accumulate", label: "Labor, ductwork and permits join the total", objectId: "running-total" },
    { id: "total-reveal", label: "The completed installed total is revealed", objectId: "cost-breakdown" },
  ],
  beats: [
    {
      id: "beat-hook",
      role: "hook",
      objective:
        "Make the gap between a full replacement quote and the equipment price the question the film answers.",
      narration:
        "A replacement quote can be much more than the price of the equipment. Where does the rest go?",
      onScreenText: "A $12,400 quote. Where does it go?",
      visualIntent: "question",
      visualObjective:
        "Separate the quoted installed total from the equipment sticker price, then hold the unresolved gap.",
      semanticObjects: ["hvac-system", "installed-quote", "equipment-price"],
      focusTarget: "installed-quote",
      durationFrames: 240,
      claimRefs: ["claim-illustrative-example"],
      narrationCueId: "cue-hook",
      cameraIntent:
        "Slow push from the HVAC unit to the quote, keeping the gap and the question visible.",
      namedEvents: ["quote-opens"],
      staticFallback:
        "Still: HVAC unit beside a $12,400 installed quote, a dashed gap and the opening question.",
      opensQuestion: "q-hvac-total",
    },
    {
      id: "beat-equipment",
      role: "setup",
      objective: "Show that equipment is one component, not the whole installed cost.",
      narration: "The equipment is one major part of the expense.",
      onScreenText: "Equipment ≈ $7,100 of the quote",
      visualIntent: "explanation",
      visualObjective:
        "Split the equipment price out of the installed quote and keep the remaining scope visible.",
      semanticObjects: ["installed-quote", "equipment-price", "running-total"],
      focusTarget: "equipment-price",
      durationFrames: 210,
      claimRefs: ["claim-illustrative-example"],
      narrationCueId: "cue-equipment",
      namedEvents: ["equipment-separates"],
      staticFallback:
        "Still: the installed quote split into an equipment block and a still-unexplained remainder.",
    },
    {
      id: "beat-installation",
      role: "explanation",
      objective: "Show labor, ductwork and permits adding to the installed total.",
      narration:
        "Installation can also include skilled labor and changes to the ductwork.",
      onScreenText: "Labor + ductwork + permits",
      visualIntent: "cost-accumulation",
      visualObjective:
        "Add labor, ductwork and permits to the running total so the viewer sees the number change.",
      semanticObjects: [
        "equipment-price",
        "labor-cost",
        "ductwork-cost",
        "permits-cost",
        "running-total",
      ],
      focusTarget: "running-total",
      durationFrames: 240,
      claimRefs: ["claim-illustrative-example"],
      narrationCueId: "cue-installation",
      namedEvents: ["costs-accumulate"],
      staticFallback:
        "Still: four labelled cost bars feeding one running total, with the total visibly larger.",
    },
    {
      id: "beat-evidence",
      role: "evidence",
      objective: "Qualify the example: the shares are illustrative, not market averages.",
      narration:
        "In this example, labor and ductwork are not rounding errors; they change the number you compare.",
      onScreenText: "Illustrative shares — not market averages",
      visualIntent: "evidence",
      visualObjective:
        "Label the measured-looking chart as synthetic and show the largest non-equipment shares.",
      semanticObjects: ["cost-breakdown", "assumptions-note", "running-total"],
      focusTarget: "cost-breakdown",
      durationFrames: 210,
      claimRefs: ["claim-illustrative-example"],
      narrationCueId: "cue-evidence",
      namedEvents: ["costs-accumulate"],
      staticFallback:
        "Still: a labelled cost-share chart with an illustrative-data stamp and assumptions note.",
    },
    {
      id: "beat-payoff",
      role: "takeaway",
      objective:
        "Answer the opening question with the complete installed scope and its assumptions.",
      narration:
        "The meaningful comparison is the complete installed scope—not the equipment price alone.",
      onScreenText: "Compare installed scope, not equipment alone",
      visualIntent: "comparison",
      visualObjective:
        "Compare the equipment price with the completed installed total and show the difference.",
      semanticObjects: [
        "installed-quote",
        "equipment-price",
        "cost-breakdown",
        "comparison-bracket",
        "assumptions-note",
      ],
      focusTarget: "comparison-bracket",
      durationFrames: 240,
      claimRefs: ["claim-illustrative-example"],
      narrationCueId: "cue-payoff",
      cameraIntent: "Hold the complete comparison; no orbit while the total and caveat are read.",
      namedEvents: ["total-reveal"],
      staticFallback:
        "Still: equipment price beside the installed total, a labelled difference and the assumptions note.",
      answersQuestion: "q-hvac-total",
    },
  ],
};

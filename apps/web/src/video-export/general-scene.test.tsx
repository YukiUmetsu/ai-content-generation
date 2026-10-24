import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { GeneralExportScene } from "./general-scene";

const plan: GeneralVisualPlan = {
  schemaVersion: 1, kind: "general-explainer-visual-plan", title: "The invisible network",
  manifest: { schemaVersion: 1, id: "test", durationFrames: 180, width: 1920, height: 1080, fps: { num: 30, den: 1 }, preset: "youtube" },
  chapters: [
    { id: "question", intent: "general-intro", visual: { headline: "WHAT HAPPENS TO A MESSAGE?", subhead: "An illustrative model", emphasis: "QUESTION", items: ["Phone", "Router", "Destination"] }, startFrame: 0, endFrame: 60, claimRefs: [], evidenceRefs: [], eventIds: [] },
    { id: "path", intent: "general-flow", visual: { headline: "A PACKET MOVES", subhead: "Across the network", emphasis: "PROCESS", items: ["Phone", "Router", "Network", "Receiver"] }, startFrame: 60, endFrame: 120, claimRefs: [], evidenceRefs: [], eventIds: [] },
    { id: "answer", intent: "general-payoff", visual: { headline: "DELIVERED, NOT MAGIC", subhead: "A useful mental model", emphasis: "ANSWER", items: ["Send", "Route", "Deliver"] }, startFrame: 120, endFrame: 180, claimRefs: [], evidenceRefs: [], eventIds: ["message-arrives"] },
  ],
  claims: [], evidence: [], events: { "message-arrives": 120 }, payoffEventId: "message-arrives", commercialReady: false,
  disclaimer: "UNVERIFIED EDITORIAL DRAFT · REVIEW CLAIMS AND RIGHTS",
};

describe("generic deterministic explainer scene", () => {
  it("renders meaningful visual labels and accessible 16:9 SVG", () => {
    const svg = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={94} />);
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).toContain("A PACKET MOVES");
    expect(svg).toContain("Router");
    expect(svg).not.toContain("UNVERIFIED EDITORIAL DRAFT");
    expect(svg).not.toContain("DRAFT ·");
    expect(svg).not.toContain("02 / 03");
  });

  it("uses Kumiki's process journey to move exactly one semantic subject through flow stages", () => {
    const start = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={65} />);
    const middle = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={94} />);
    expect(start).toContain("data-km-diagram-stage");
    expect(middle).toContain("data-diagram-node=\"step-2\"");
    expect(middle).toContain("data-process-journey-subject=\"topic-flow\"");
    expect(middle.match(/data-process-journey-subject=/g)).toHaveLength(1);
    expect(middle).toContain('data-diagram-overlaps="0"');
    expect(start).not.toEqual(middle);
    expect(middle).not.toContain("<foreignObject");
  });

  it("has no DOM payoff content until after its event, then reveals named nodes", () => {
    const at = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={120} />);
    const after = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={155} />);
    expect(at).not.toContain("DELIVERED, NOT MAGIC");
    expect(at).not.toContain(">Deliver</text>");
    expect(after).toContain("DELIVERED, NOT MAGIC");
    expect(after).toContain("Deliver");
  });

  it("fits three comparison cards entirely within the right-hand canvas", () => {
    const comparison: GeneralVisualPlan = { ...plan, chapters: plan.chapters.map((chapter) => chapter.id === "path"
      ? { ...chapter, intent: "general-comparison", visual: { ...chapter.visual, items: ["Option A", "Option B", "Option C"] } }
      : chapter) };
    const svg = renderToStaticMarkup(<GeneralExportScene plan={comparison} frame={119} />);
    const cards = [...svg.matchAll(/<rect x="([\d.]+)" y="470" width="([\d.]+)"/g)];
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(Number(card[1]) + Number(card[2])).toBeLessThanOrEqual(1800);
  });

  it("shows qualitative breakdowns as equal-sized categories, never invented quantitative bars", () => {
    const breakdown: GeneralVisualPlan = { ...plan, chapters: plan.chapters.map((chapter) => chapter.id === "path"
      ? { ...chapter, intent: "general-breakdown", visual: { ...chapter.visual, items: ["Labor", "Materials", "Permits", "Equipment"] } }
      : chapter) };
    const svg = renderToStaticMarkup(<GeneralExportScene plan={breakdown} frame={119} />);
    expect(svg).toContain('data-general-breakdown="qualitative"');
    expect(svg).toContain("QUALITATIVE · NOT TO SCALE");
    expect(svg.match(/data-general-node=/g)).toHaveLength(4);
    expect(svg.match(/width="680" height="94"/g)).toHaveLength(4);
    expect(svg).not.toContain('height="23"');
  });

  it("draws a measured chart with visible source title, locator and exact disclosure instead of an unrelated diagram", () => {
    const chartPlan: GeneralVisualPlan = {
      ...plan,
      evidence: [{ id: "source-1", title: "Budget report", sourceUri: "https://example.org/report",
        retrievedAt: "2026-10-22T00:00:00.000Z", passageLocator: "Table 4", snapshotSha256: "a".repeat(64) }],
      chapters: plan.chapters.map((chapter) => chapter.id === "path" ? { ...chapter, visual: {
        ...chapter.visual,
        chart: { kind: "quantitative-chart-v1", categories: ["A", "B"], unit: "USD",
          series: [{ id: "cost", label: "Annual cost", values: [10, 15] }],
          provenance: { basis: "measured", disclosure: "Measured values; editorial review still required.", claimRefs: ["claim-a"], evidenceRefs: ["source-1"] },
        },
      } } : chapter),
    };
    const rendered = renderToStaticMarkup(<GeneralExportScene plan={chartPlan} frame={75} />);
    expect(rendered).toContain('data-km-chart-story=""');
    expect(rendered).toContain('data-chart-provenance-basis="measured"');
    expect(rendered).toContain("Measured values; editorial review still required.");
    expect(rendered).toContain("Budget report");
    expect(rendered).toContain("Table 4");
    expect(rendered).toContain('data-chart-story-status="ready"');
    expect(rendered).not.toContain('data-general-node=');
  });
});


describe("cinematic semantic visual treatments on the actual exported frame",()=>{
  function asIntent(intent:"general-intro"|"general-flow"|"general-comparison"|"general-breakdown"|"general-payoff",
    items:string[], frame:number){
    const altered:GeneralVisualPlan={...plan,
      chapters:plan.chapters.map((chapter,index)=>index===1?{
        ...chapter,intent,visual:{...chapter.visual,items,headline:"SCENE VISUALIZATION"}
      }:chapter)
    };
    return renderToStaticMarkup(<GeneralExportScene plan={altered} frame={frame}/>);
  }
  it("uses a dedicated moving curiosity lens rather than the same card stack as the breakdown",()=>{
    const early=asIntent("general-intro",["House","Taxes","Insurance","Maintenance"],61);
    const later=asIntent("general-intro",["House","Taxes","Insurance","Maintenance"],115);
    expect(early).toContain('data-semantic-scene="question-lens"');
    expect(early).toContain('data-semantic-node="0"');
    expect(early).not.toContain("Maintenance");
    expect(later).toContain("Maintenance");
    expect(early).not.toEqual(later);
  });
  it("turns comparison into a progressing contrast with visible qualitative disclosure",()=>{
    const first=asIntent("general-comparison",["Rent","Buy","Repair"],61);
    const later=asIntent("general-comparison",["Rent","Buy","Repair"],110);
    expect(first).toContain('data-semantic-layout="contrast"');
    expect(first).toContain("QUALITATIVE COMPARISON");
    expect(first).not.toContain("Repair");
    expect(later).toContain("Repair");
    expect(later).toContain('data-semantic-focus="true"');
  });
  it("reveals breakdown parts with no fabricated values or unequal quantitative bar geometry",()=>{
    const late=asIntent("general-breakdown",["Labor","Equipment","Permits","Materials"],119);
    expect(late).toContain('data-semantic-layout="decomposition"');
    expect(late).toContain("QUALITATIVE · NOT TO SCALE");
    expect(late.match(/data-semantic-node=/g)).toHaveLength(4);
    expect(late.match(/width="680" height="94"/g)).toHaveLength(4);
    expect(late).not.toContain("50%");
  });
  it("uses a locked payoff until its exact event and later assembles the final connection",()=>{
    const exact=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={120}/>);
    const late=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={165}/>);
    expect(exact).toContain('data-payoff-locked="true"');
    expect(exact).not.toContain("DELIVERED, NOT MAGIC");
    expect(exact).not.toContain('data-semantic-conclusion=""');
    expect(late).toContain('data-semantic-scene="synthesis"');
    expect(late).toContain('data-semantic-conclusion=""');
    expect(late).toContain("DELIVERED, NOT MAGIC");
  });
});


describe("authored timeline motion in the actual MP4 export React scene",()=>{
  it("changes only controlled visual frames and fades without modifying authored labels",()=>{
    const tuned:GeneralVisualPlan={...plan,chapters:plan.chapters.map((chapter,index)=>
      index===1?{...chapter,intent:"general-breakdown",visual:{...chapter.visual,
        items:["Tax","Insurance","Repairs","Utilities"],
        motion:{revealDelayPercent:25,revealPace:"deliberate",camera:"locked",transition:"fade"}
      }}:chapter)};
    const first=renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={60}/>);
    const later=renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={118}/>);
    expect(first).toContain('data-scene-entry-fade=""');
    expect(first).not.toContain('>Tax</text>');
    expect(first).not.toContain('>Utilities</text>');
    expect(later).toContain('>Tax</text>');
    expect(later).toContain('>Utilities</text>');
    expect(later).not.toContain('data-scene-entry-fade=""');
    expect(later).toContain('data-semantic-scene="decomposition"');
    const changedCamera:GeneralVisualPlan={...tuned,chapters:tuned.chapters.map((chapter,index)=>
      index===1?{...chapter,visual:{...chapter.visual,motion:{
        ...chapter.visual.motion!,camera:"cinematic" as const}}}:chapter)};
    expect(renderToStaticMarkup(<GeneralExportScene plan={changedCamera} frame={100}/>))
      .not.toBe(renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={100}/>));
  });
  it("never spoils an authored payoff on its event frame and reveals it later",()=>{
    const tuned:GeneralVisualPlan={...plan,chapters:plan.chapters.map((chapter,index)=>
      index===2?{...chapter,visual:{...chapter.visual,motion:{
        revealDelayPercent:30,revealPace:"deliberate",camera:"cinematic",transition:"fade"}}}:chapter)};
    const event=renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={120}/>);
    const revealed=renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={179}/>);
    expect(event).toContain('data-payoff-locked="true"');
    expect(event).not.toContain('DELIVERED, NOT MAGIC');
    expect(revealed).toContain('DELIVERED, NOT MAGIC');
    expect(revealed).toContain('data-semantic-scene="synthesis"');
  });
  it("gates unrevealed Kumiki process stages rather than only title cards",()=>{
    const tuned:GeneralVisualPlan={...plan,chapters:plan.chapters.map((chapter,index)=>
      index===1?{...chapter,visual:{...chapter.visual,motion:{
        revealDelayPercent:30,revealPace:"balanced",camera:"subtle",transition:"cut"}}}:chapter)};
    const start=renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={60}/>);
    const finish=renderToStaticMarkup(<GeneralExportScene plan={tuned} frame={119}/>);
    expect(start).toContain('id="contentgen-flow-reveal"');
    expect(start).toContain('height="0"');
    expect(finish).toContain('data-km-diagram-stage');
    expect(finish).not.toContain('height="0"');
  });
});

describe("visual export safety for all generic projects",()=>{
  it("contains the Kumiki journey within the 770×640 safe area even for 5 stages",()=>{
    const five:GeneralVisualPlan={...plan,chapters:plan.chapters.map((c,index)=>index===1?{
      ...c,visual:{...c.visual,items:["Opening","Processing","Transport","Arrival","Result"]}
    }:c)};
    const svg=renderToStaticMarkup(<GeneralExportScene plan={five} frame={115}/>);
    expect(svg).toContain('id="contentgen-flow-safe-bounds"');
    expect(svg).toContain('width="770" height="640"');
    expect(svg).toContain('clip-path="url(#contentgen-flow-safe-bounds)"');
    expect(svg).not.toContain("DRAFT ·");
  });
});


describe("specific teaching details in the actual encoded video frames",()=>{
 const informative={
  ...plan,
  chapters:plan.chapters.map((chapter,index)=>index===1?{...chapter,intent:"general-breakdown" as const,
   visual:{...chapter.visual,items:["Mortgages","Property tax","Maintenance"],
    itemNotes:["Borrowing adds interest","Annual local ownership charge","Repairs and upkeep over time"]}}:chapter)
 };
 it("renders both named elements and their meanings instead of only subject identifiers",()=>{
   const output=renderToStaticMarkup(<GeneralExportScene plan={informative} frame={117}/>);
   expect(output).toContain("Borrowing adds interest");
   expect(output).toContain("Annual local ownership charge");
   expect(output).toContain("Repairs and upkeep over time");
   expect(output.match(/data-teaching-detail/g)).toHaveLength(3);
   expect(output).not.toContain("How it changes");
 });
 it("never leaks the next teaching detail before that item is revealed",()=>{
   const first=renderToStaticMarkup(<GeneralExportScene plan={informative} frame={60}/>);
   expect(first).toContain("Borrowing adds interest");
   expect(first).not.toContain("Annual local ownership charge");
   expect(first).not.toContain("Repairs and upkeep over time");
   const late=renderToStaticMarkup(<GeneralExportScene plan={informative} frame={117}/>);
   expect(late).toContain("Repairs and upkeep over time");
 });
 it("allows legacy footage to omit explanations without changing existing node presentation",()=>{
   const legacy=renderToStaticMarkup(<GeneralExportScene plan={plan} frame={96}/>);
   expect(legacy).not.toContain('data-teaching-detail=""');
   expect(legacy).toContain("Router");
 });
});

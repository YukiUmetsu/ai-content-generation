import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compileObjectStory } from "@/components/video/object-story";
import { FINANCE_OBJECTS } from "@/components/domains/finance-object-model";
import { BUSINESS_OBJECTS } from "@/components/domains/business-object-model";
import { TECHNOLOGY_OBJECTS } from "@/components/domains/technology-object-model";
import { checkObjectStory } from "./story-entry";
import { directSceneStory, newStoryStage } from "../../scripts/video-production/story-director.mjs";
import { phraseWindows, speechPhrases } from "../../scripts/video-production/speech-phrases.mjs";

vi.mock("@/components/video/object-story-react", async importOriginal => ({
  ...(await importOriginal<typeof import("@/components/video/object-story-react")>()),
  createStoryTextMeasure: () => (font: string, text: string) => text.length * Number(/(\d+)px/u.exec(font)?.[1] ?? 16) * .5,
}));
import { StoryScene } from "../video-export/story-scene";

const vocabulary = JSON.parse(readFileSync("scripts/video-production/story-vocabulary.json", "utf8"));
const reference = JSON.parse(readFileSync("fixtures/reference/invoice-receipt-gap.json", "utf8"));
const fps = { num: 30, den: 1 };

function directed() {
  let stage = newStoryStage();
  return reference.script.sections.map((section: { id: string; text: string }) => {
    const frames = Math.round(section.text.length * 2.2);
    const result = directSceneStory({ id: section.id, fps, width: 1920, height: 1080, frames, locale: "en",
      phrases: phraseWindows({ phrases: speechPhrases(section.text), frames, fps }) }, { vocabulary, stage });
    stage = result.stage;
    return result.spec;
  });
}

describe("object story scenes", () => {
  it("every vocabulary art names an object Kumiki can draw", () => {
    const known = new Set([...FINANCE_OBJECTS.map(item => `finance:${item.kind}`), ...BUSINESS_OBJECTS.map(item => `business:${item.kind}`), ...TECHNOLOGY_OBJECTS.map(item => `technology:${item.kind}`)]);
    for (const entry of vocabulary.objects) expect(known.has(entry.art), entry.art).toBe(true);
  });

  it("the directed reference script compiles and meets the stillness budget", () => {
    for (const spec of directed()) {
      const verdict = checkObjectStory(spec);
      expect(verdict.diagnostics.filter(item => item.severity === "error"), spec.id).toEqual([]);
      expect(verdict.pacing?.longestStillSeconds, spec.id).toBeLessThanOrEqual(2.5);
    }
  });

  it("the Node check agrees with a compile at wider text", () => {
    const measure = (font: string, text: string) => text.length * Number(/(\d+)px/u.exec(font)?.[1] ?? 16) * .54;
    for (const spec of directed()) expect(compileObjectStory(spec, { measure }).ok, spec.id).toBe(true);
  });

  it("draws illustrated objects, their values and the caption at a frame", () => {
    const [opening] = directed();
    const { container } = render(<StoryScene spec={opening} localFrame={80} />);
    expect(container.querySelector('[data-km-story-object="invoice"] svg')).not.toBeNull();
    expect(container.querySelector("[data-km-story-value]")?.textContent).toBe("$120");
    expect(container.querySelector('[data-km-story-object="invoice"]')?.textContent).toContain("Invoice");
    expect(container.querySelector("[data-km-story-caption]")?.textContent).toContain("invoice");
  });

  it("reports an invalid story instead of drawing it", () => {
    const [opening] = directed();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<StoryScene spec={{ ...opening, beats: [{ ...opening.beats[0], ops: [], endFrame: opening.durationFrames }] , objects: [] }} localFrame={0} />)).toThrow(/Story hook/u);
    error.mockRestore();
  });
});

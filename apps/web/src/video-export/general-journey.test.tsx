import { describe, expect, it } from "vitest";
import { createGeneralJourney } from "./general-journey";
import { evaluateProcessJourney } from "@/components/motion/process-journey";

describe("generic graph journey choreography", () => {
  it("places 2–5 meaningful labeled stages inside a compact nonoverlapping canvas", () => {
    for (const size of [2, 3, 4, 5]) {
      const labels = Array.from({ length: size }, (_, index) => `Stage ${index + 1}`);
      const journey = createGeneralJourney(labels, 120, { num: 30, den: 1 });
      expect(journey).toBeDefined();
      expect(journey!.graph.nodes.map((node) => node.label)).toEqual(labels);
      expect(journey!.route).toHaveLength(size - 1);
      for (const frame of [0, 49, 119]) {
        const sampled = evaluateProcessJourney(journey!, frame);
        expect(sampled.diagram.overlaps).toEqual([]);
        for (const node of sampled.diagram.nodes) {
          expect(node.bounds.x).toBeGreaterThanOrEqual(0);
          expect(node.bounds.y).toBeGreaterThanOrEqual(0);
          expect(node.bounds.x + node.bounds.width).toBeLessThanOrEqual(770);
          expect(node.bounds.y + node.bounds.height).toBeLessThanOrEqual(640);
        }
      }
    }
  });

  it("moves one named subject through complete route, handoffs, and arrival on arbitrary seeks", () => {
    const plan = createGeneralJourney(["Phone", "Router", "Cloud", "Receiver"], 120, { num: 30, den: 1 })!;
    expect(evaluateProcessJourney(plan, 0).phase).toBe("ready");
    expect(evaluateProcessJourney(plan, plan.route[0].startFrame).phase).toBe("moving");
    expect(evaluateProcessJourney(plan, plan.route[0].endFrame).phase).toBe("handoff");
    expect(evaluateProcessJourney(plan, 119).phase).toBe("arrived");
    expect(evaluateProcessJourney(plan, 119).currentNodeId).toBe("step-3");
    const sequentialSample = evaluateProcessJourney(plan, 29);
    evaluateProcessJourney(plan, 119);
    evaluateProcessJourney(plan, 0);
    expect(evaluateProcessJourney(plan, 29)).toEqual(sequentialSample);
    expect(evaluateProcessJourney(plan, 15).position).not.toEqual(evaluateProcessJourney(plan, 55).position);
  });

  it("falls back safely when a chapter cannot fit a minimum route", () => {
    expect(createGeneralJourney(["A"], 80, { num: 30, den: 1 })).toBeNull();
    expect(createGeneralJourney(["A", "B", "C", "D", "E"], 8, { num: 30, den: 1 })).toBeNull();
  });
});

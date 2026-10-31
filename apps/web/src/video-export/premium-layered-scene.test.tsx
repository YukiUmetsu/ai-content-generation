import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PremiumLayeredScene } from "./premium-layered-scene";
import type { PremiumVisualScene } from "./premium-layered-scene";

const sha = "a".repeat(64);
const scene: PremiumVisualScene = {
  beatId: "invoice-beat",
  brief: { subject: "The missing twenty dollars", initialState: "Invoice shown", action: "Compare the receipt",
    finalState: "Difference verified", onScreenText: ["Invoice $120", "Receipt $100", "Difference $20"] },
  layers: ["background", "subject", "foreground"].map((role) => ({
    id: `layer-${role}`, role, url: `/__visual_assets/${sha}.png`, width: 1024, height: 1024,
  })),
};

describe("premium scene integration with approved Kumiki ST1", () => {
  it("seeks deterministically to establish, inspect, and resolve phases", () => {
    const sample = (frame: number) => renderToStaticMarkup(<PremiumLayeredScene scene={scene} frame={frame} frames={300} fps={{ num: 30, den: 1 }}/>);
    const first = sample(0);
    const middle = sample(150);
    const final = sample(290);
    expect(first).toContain('data-premium-phase="establish"');
    expect(middle).toContain('data-premium-phase="inspect"');
    expect(final).toContain('data-premium-phase="resolve"');
    expect(final).toContain('data-km-environment-camera');
    expect(final).toContain('data-premium-resolution="true"');
    expect(final).toContain('data-premium-invoice=""');
    expect(final).toContain('data-premium-receipt=""');
    expect(final).toContain('data-premium-comparison=""');
    expect(final).toContain("Difference $20");
    expect(sample(150)).toBe(middle);
    expect((final.match(/src="\/__visual_assets\//g) ?? []).length).toBe(3);
  });

  it("fails closed when an expected plane is missing or points to an unapproved URL", () => {
    const frame = (value: PremiumVisualScene) => renderToStaticMarkup(<PremiumLayeredScene scene={value} frame={150} frames={300} fps={{ num: 30, den: 1 }}/>);
    expect(() => frame({ ...scene, layers: scene.layers.filter((item) => item.role !== "foreground") })).toThrow(/foreground artwork/);
    expect(() => frame({ ...scene, layers: scene.layers.map((item) => item.role === "subject" ? { ...item, url: "https://untrusted.example/art.png" } : item) })).toThrow(/subject artwork/);
  });
});

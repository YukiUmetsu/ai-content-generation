import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformanceClipScene } from "./performance-clip-scene";

const fps = { num: 30, den: 1 };
const label = { text: "$20 gap", x: 960, y: 200, startFrame: 240, endFrame: 300 };
const html = (frame: number) => renderToStaticMarkup(<PerformanceClipScene media={{ url: "/__video_media/a.mp4" }} clip={{ label }} localFrame={frame} fps={fps}/>);

describe("performance clip scene", () => {
  it("asks the video element for the exact frame time", () => {
    expect(html(150)).toContain('data-media-time="5.000000"');
  });
  it("uses the shared video readiness hook", () => {
    expect(html(0)).toContain("data-contentgen-stock-video");
  });
  it("shows the label only inside its window", () => {
    expect(html(100)).not.toContain("$20 gap");
    expect(html(270)).toContain("$20 gap");
    expect(html(299)).toContain("$20 gap");
  });
  it("draws no diagram scrim over the shot", () => {
    expect(html(270)).not.toContain("data-contentgen-stock-scrim");
  });
});

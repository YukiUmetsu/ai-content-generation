/** A rendered performance shot, full frame, plus at most one short label.
 * The clip plays through the same frame-verified video element as reviewed footage.
 */
import type { RationalFps } from "@/components/motion/types";

export interface PerformanceLabel {
  text: string;
  /** Design pixels at 1920 × 1080. */
  x: number;
  y: number;
  startFrame: number;
  endFrame: number;
}
export interface PerformanceClip { label?: PerformanceLabel }

const FADE_FRAMES = 9;

export function PerformanceClipScene({ media, clip, localFrame, fps }: {
  media: { url: string };
  clip: PerformanceClip;
  localFrame: number;
  fps: RationalFps;
}) {
  const label = clip.label;
  const fade = label ? Math.min((localFrame - label.startFrame) / FADE_FRAMES, (label.endFrame - localFrame) / FADE_FRAMES, 1) : 0;
  const opacity = Math.max(0, fade);
  const seconds = localFrame * fps.den / fps.num;
  return <div data-contentgen-performance-clip="" role="img" aria-label="Rendered scene"
    style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "hidden", background: "#000" }}>
    <video data-contentgen-stock-video="" data-media-time={seconds.toFixed(6)} src={media.url} preload="auto" muted playsInline
      aria-hidden="true" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    {label && opacity > 0 && <div data-contentgen-performance-label="" style={{
      position: "absolute", left: label.x, top: label.y, transform: `translate(-50%, ${(1 - opacity) * 10}px)`, opacity,
      padding: "12px 26px", borderRadius: 999, background: "rgba(16,29,45,.86)", border: "2px solid #D9AF7C",
      color: "#F5F2EB", fontFamily: "Geist Variable, sans-serif", fontSize: 46, fontWeight: 650, letterSpacing: "-.01em",
      whiteSpace: "nowrap" }}>{label.text}</div>}
  </div>;
}

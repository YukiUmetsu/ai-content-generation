/** A 2.5D establishing → evidence → resolution shot using approved Kumiki ST1 motion. */
import { SceneTemplateView } from "@/components/video/scene-templates-react";
import type { SceneTemplateSpec } from "@/components/video/scene-templates";

export interface PremiumVisualScene {
  beatId: string;
  brief: { subject: string; initialState: string; action: string; finalState: string; onScreenText: string[] };
  layers: { id: string; role: string; url: string; width: number; height: number }[];
}

const easing = (progress: number) => { const x = Math.max(0, Math.min(1, progress)); return x*x*(3-2*x); };
const white = "#F8F4E9";
const gold = "#E7B878";

export function PremiumLayeredScene({ scene, frame, frames, fps }: {
  scene: PremiumVisualScene; frame: number; frames: number; fps: { num: number; den: number };
}) {
  const layer = (role: string) => {
    const found = scene.layers.find((item) => item.role === role);
    if (!found || !/^\/__visual_assets\/[a-f0-9]{64}\.png$/u.test(found.url))
      throw Error(`Premium scene ${scene.beatId} lacks reviewed ${role} artwork`);
    return { id: found.id, src: found.url, alt: `${scene.brief.subject}: ${role} plane`,
      width: found.width, height: found.height };
  };
  const markers = [Math.max(1, Math.floor(frames * .15)), Math.max(2, Math.floor(frames * .35)),
    Math.max(3, Math.floor(frames * .62))] as [number, number, number];
  const spec: SceneTemplateSpec<"environment-reveal"> = {
    schemaVersion: 1, recipeVersion: 1, id: scene.beatId, fps, durationFrames: frames,
    width: 1920, height: 1080, cueFrames: markers,
    recipeId: "environment-reveal", background: "#0F1726", accent: gold,
    content: { environment: layer("background"), foreground: layer("foreground"),
      focal: layer("subject"), title: scene.brief.subject,
      camera: { from: { x: .38, y: .40, zoom: 1.035 }, to: { x: .57, y: .47, zoom: 1.28 } },
      parallax: { foregroundStrength: 1.35, haze: .12, lightRays: true },
      atmosphere: { tint: "#102333", opacity: .1 } },
  };
  const line = scene.brief.onScreenText;
  const first = easing((frame - markers[0]) / 17);
  const second = easing((frame - markers[1]) / 19);
  const third = easing((frame - markers[2]) / 20);
  return <div data-premium-layered-scene={scene.beatId} data-premium-phase={frame < markers[0] ? "establish" : frame < markers[2] ? "inspect" : "resolve"}
    style={{ position: "relative", width: 1920, height: 1080, background: "#0F1726", overflow: "hidden" }}>
    <SceneTemplateView spec={spec} frame={frame} style={{ width: 1920, height: 1080, padding: 0, position: "absolute", inset: 0 }}/>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,rgba(6,18,31,.92),rgba(6,18,31,.65) 27%,transparent 63%),linear-gradient(0deg,rgba(5,15,28,.65),transparent 32%)", pointerEvents: "none" }}/>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "Geist Variable, Geist, Arial, sans-serif" }}>
      <g opacity={first} transform={`translate(${(1-first)*-52} 0)`}>
        <rect x="112" y="255" width="9" height="78" rx="4" fill={gold}/>
        <text data-general-copy="premium" x="143" y="310" fill={white} fontSize="48" fontWeight="750">{line[0]}</text>
      </g>
      {line[1] && <g opacity={second} transform={`translate(${(1-second)*-80} 0)`}>
        <rect x="112" y="365" width="745" height="110" rx="18" fill="#102C3A" fillOpacity=".9" stroke={gold} strokeWidth="2"/>
        <text data-premium-evidence="second" x="145" y="434" fill={white} fontSize="46" fontWeight="700">{line[1]}</text>
      </g>}
      {line[2] && <g opacity={third} transform={`translate(0 ${(1-third)*54})`}>
        <path d="M480 482 L480 603" stroke={gold} strokeWidth="5" strokeDasharray="15 10"/>
        <rect x="112" y="612" width="820" height="124" rx="20" fill="#D3A16B"/>
        <text data-premium-resolution="true" x="148" y="689" fill="#14242E" fontSize="55" fontWeight="790">{line[2]}</text>
      </g>}
      <text x="115" y="980" fill={white} fontSize="22" letterSpacing="3.2" opacity=".9">ILLUSTRATIVE 2.5D SCENE · EDITABLE EVIDENCE</text>
    </svg>
  </div>;
}

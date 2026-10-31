/** A 2.5D establishing → evidence → resolution shot using approved Kumiki ST1 motion. */
import { SceneTemplateView } from "@/components/video/scene-templates-react";
import type { SceneTemplateSpec } from "@/components/video/scene-templates";
import { fitSvgText } from "../../scripts/video-production/text-layout.mjs";

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
  const invoiceText = fitSvgText(line[0] ?? "", { maxWidthPx: 760, preferredSize: 48, minSize: 28, maxLines: 1 });
  const receiptText = line[1] ? fitSvgText(line[1], { maxWidthPx: 680, preferredSize: 46, minSize: 28, maxLines: 1 }) : null;
  const resultText = line[2] ? fitSvgText(line[2], { maxWidthPx: 720, preferredSize: 55, minSize: 32, maxLines: 1 }) : null;
  const invoiceDocText = fitSvgText(line[0] ?? "", { maxWidthPx: 318, preferredSize: 41, minSize: 16, maxLines: 1 });
  const receiptDocText = line[1] ? fitSvgText(line[1], { maxWidthPx: 270, preferredSize: 37, minSize: 16, maxLines: 1 }) : null;
  const first = easing((frame - markers[0]) / 17);
  const second = easing((frame - markers[1]) / 19);
  const third = easing((frame - markers[2]) / 20);
  return <div data-premium-layered-scene={scene.beatId} data-premium-phase={frame < markers[0] ? "establish" : frame < markers[2] ? "inspect" : "resolve"}
    style={{ position: "relative", width: 1920, height: 1080, background: "#0F1726", overflow: "hidden" }}>
    <SceneTemplateView spec={spec} frame={frame} style={{ width: 1920, height: 1080, padding: 0, position: "absolute", inset: 0 }}/>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,rgba(6,18,31,.92),rgba(6,18,31,.65) 27%,transparent 63%),linear-gradient(0deg,rgba(5,15,28,.65),transparent 32%)", pointerEvents: "none" }}/>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "Geist Variable, Geist, Arial, sans-serif" }}>
      <defs><filter id="premium-paper-shadow" x="-30%" y="-30%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="14"/>
      </filter></defs>
      {/* All printed figures are editable SVG from the approved brief, never ComfyUI pixels. */}
      <g data-premium-invoice="" opacity={first}
        transform={`translate(${(1-first)*225} ${(1-first)*-105}) rotate(-3 1272 577)`}>
        <rect x="1073" y="337" width="408" height="504" rx="7" fill="#081620" opacity=".6"
          transform="translate(12 18)" filter="url(#premium-paper-shadow)"/>
        <rect x="1073" y="337" width="408" height="504" rx="7" fill="#F5EBD8" stroke="#D2C4AB" strokeWidth="3"/>
        <rect x="1110" y="376" width="6" height="54" fill="#B78957"/>
        <text x="1132" y="417" fontSize="40" fontWeight="780" fill="#293743">INVOICE</text>
        <path d="M1117 451 H1438 M1117 488 H1400 M1117 516 H1360" stroke="#A6A79E" strokeWidth="3" opacity=".6"/>
        <text x="1117" y="580" fontSize="22" letterSpacing="2" fill="#53636A">AMOUNT DUE</text>
        <text x="1117" y="652" fontSize={invoiceDocText.fontSize} fontWeight="780" fill="#213F4B">{invoiceDocText.lines[0]}</text>
        <path d="M1117 686 H1439" stroke="#BFAE93" strokeWidth="2"/>
        <path d="M1117 739 H1325 M1117 773 H1386" stroke="#B6B3A8" strokeWidth="3" opacity=".6"/>
      </g>
      <g data-premium-receipt="" opacity={second}
        transform={`translate(${(1-second)*270} ${(1-second)*-95}) rotate(4 1568 652)`}>
        <rect x="1431" y="414" width="337" height="433" rx="5" fill="#081620" opacity=".58"
          transform="translate(11 15)" filter="url(#premium-paper-shadow)"/>
        <rect x="1431" y="414" width="337" height="433" rx="5" fill="#FFFAEB" stroke="#CFC5AF" strokeWidth="3"/>
        <text x="1462" y="481" fontSize="37" fontWeight="740" fill="#253D46">RECEIPT</text>
        <path d="M1464 511 H1733 M1464 544 H1699" stroke="#BABAAF" strokeWidth="2.6"/>
        <text x="1464" y="593" fontSize="22" letterSpacing="2" fill="#52666D">PAID</text>
        <text x="1464" y="655" fontSize={receiptDocText?.fontSize ?? 37} fontWeight="770" fill="#1D4850">{receiptDocText?.lines[0]}</text>
        <path d="M1464 689 H1733 M1464 722 H1679 M1464 752 H1710" stroke="#BABAAF" strokeWidth="2.8"/>
      </g>
      <g data-premium-comparison="" opacity={third}>
        <path d="M1290 679 Q1396 776 1539 690" fill="none" stroke="#F4CF8C" strokeWidth="7"
          strokeLinecap="round" strokeDasharray="19 13" strokeDashoffset={(1-third)*220}/>
        <circle cx="1278" cy="650" r={57+12*third} fill="none" stroke="#F4CF8C" strokeWidth="6"/>
        <circle cx="1591" cy="649" r={57+12*third} fill="none" stroke="#F4CF8C" strokeWidth="6"/>
      </g>
      <g opacity={first} transform={`translate(${(1-first)*-52} 0)`}>
        <rect x="112" y="255" width="9" height="78" rx="4" fill={gold}/>
        <text data-general-copy="premium" x="143" y="310" fill={white} fontSize={invoiceText.fontSize} fontWeight="750">{invoiceText.lines[0]}</text>
      </g>
      {line[1] && <g opacity={second} transform={`translate(${(1-second)*-80} 0)`}>
        <rect x="112" y="365" width="745" height="110" rx="18" fill="#102C3A" fillOpacity=".9" stroke={gold} strokeWidth="2"/>
        <text data-premium-evidence="second" x="145" y="434" fill={white} fontSize={receiptText?.fontSize ?? 46} fontWeight="700">{receiptText?.lines[0]}</text>
      </g>}
      {line[2] && <g opacity={third} transform={`translate(0 ${(1-third)*54})`}>
        <path d="M480 482 L480 603" stroke={gold} strokeWidth="5" strokeDasharray="15 10"/>
        <rect x="112" y="612" width="820" height="124" rx="20" fill="#D3A16B"/>
        <text data-premium-resolution="true" x="148" y="689" fill="#14242E" fontSize={resultText?.fontSize ?? 55} fontWeight="790">{resultText?.lines[0]}</text>
      </g>}
      <text x="115" y="980" fill={white} fontSize="22" letterSpacing="3.2" opacity=".9">ILLUSTRATIVE 2.5D SCENE · EDITABLE EVIDENCE</text>
    </svg>
  </div>;
}

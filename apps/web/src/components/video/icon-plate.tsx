import type { CSSProperties } from "react";

export interface IconPlateProps {
  name: string;
  /** One verbatim claim from the narration; never fabricate a product promise. */
  claim: string;
  /** Only supply a mark with confirmed rights. Missing mark renders original ledger geometry. */
  markSrc?: string;
  markAlt?: string;
  /** Controlled from the absolute-frame reveal; independently installed plates show the claim by default. */
  showClaim?: boolean;
  width?: number;
  height?: number;
  /** Logical geometry inside the subject box; portrait uses 848×620. */
  canvasWidth?: number;
  canvasHeight?: number;
  style?: CSSProperties;
}
/** Break at word boundaries when possible and split long identifiers without clipping. */
export function wrapPlateText(value: string, max: number): string[] {
  const chars = Array.from(value.trim().replace(/\s+/g, " "));
  if (!chars.length) return [];
  const lines: string[] = [];
  while (chars.length) {
    if (chars.length <= max) { lines.push(chars.join("")); break; }
    // Favor whitespace only if the remainder still fits the next line.
    // Long 40-character product names and 88-character claims must never
    // unexpectedly grow into a third line under a 620px portrait plate.
    const space = chars.slice(0, max + 1).lastIndexOf(" ");
    const minBreak = Math.max(1, chars.length - max);
    const length = space >= minBreak ? space : max;
    lines.push(chars.splice(0, length).join("").trim());
    while (chars[0] === " ") chars.shift();
  }
  return lines;
}
export function IconPlate({ name, claim, markSrc, markAlt, showClaim = true,
  width = 980, height = 640, canvasWidth = 980, canvasHeight = 640, style }: IconPlateProps) {
  if (!name.trim() || Array.from(name).length > 40 || !claim.trim() || Array.from(claim).length > 88)
    throw new Error("IconPlate requires a name (1–40 characters) and a concise sourced claim (1–88 characters).");
  if (![width,height,canvasWidth,canvasHeight].every(n => Number.isFinite(n) && n > 0))
    throw new Error("IconPlate dimensions must be finite and positive.");
  const center = canvasWidth / 2, markY = 74, markSize = 280;
  const lines = wrapPlateText(name, 22);
  const claimLines = wrapPlateText(claim, 44);
  return <svg data-km-icon-plate="" data-mark={markSrc ? "provided" : "generic"}
    data-claim-visible={String(showClaim)}
    role="img" aria-label={name + (showClaim ? ": " + claim : "")}
    viewBox={"0 0 " + canvasWidth + " " + canvasHeight} width={width} height={height}
    preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "100%", ...style }}>
    {markSrc ? <image href={markSrc} x={center - 140} y={markY} width={markSize} height={markSize}
      aria-label={markAlt ?? name} preserveAspectRatio="xMidYMid meet"/> :
      <g data-km-generic-ledger="" transform={"translate(" + (center - 140) + " " + markY + ")"}
        fill="none">
        <rect x="16" y="8" width="248" height="264" rx="24"
          fill="var(--km-shot-node, #224e62)" stroke="var(--km-shot-accent, #9fe0d1)" strokeWidth="9"/>
        <path d="M68 8V272" stroke="var(--km-shot-accent, #a7e3d8)" strokeWidth="9"/>
        <path d="M106 70H223M106 120H223M106 170H223M106 220H223"
          stroke="var(--km-shot-ink, #e7f5ed)" strokeWidth="13" strokeLinecap="round"/>
        <path d="M149 63V228" stroke="var(--km-shot-ink, #e7f5ed)" strokeOpacity=".3" strokeWidth="5"/>
      </g>}
    {lines.map((line,i) => <text key={i} x={center} y={401 + i * 43}
      textAnchor="middle" fontSize="35" fontWeight="700" fill="var(--km-shot-ink, #f2f5f7)"
      fontFamily="var(--km-shot-font, system-ui, sans-serif)">{line}</text>)}
    {showClaim && claimLines.map((line,i) => <text key={i} data-km-icon-claim=""
      x={center} y={(lines.length === 1 ? 503 : 530) + i * 36}
      textAnchor="middle" fontSize="28" fill="var(--km-shot-muted-ink, #bed2d8)"
      fontFamily="var(--km-shot-font, system-ui, sans-serif)">{line}</text>)}
  </svg>;
}

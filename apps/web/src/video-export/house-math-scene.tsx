import { getHouseMathFrame } from "../../scripts/video-production/visual-plan.mjs";
import type { HouseMathVisualPlan, HouseMathFrame } from "../../scripts/video-production/visual-plan.mjs";

const cash = (amount: number) => "$" + Math.round(amount).toLocaleString("en-US");
const short = (amount: number) => amount >= 1_000_000 ? "$" + (amount / 1_000_000).toFixed(2) + "M" : "$" + (amount / 1000).toFixed(0) + "K";
const ink = "#F4F1E9", muted = "#A7B5C3", amber = "#D7B27A";

function wrapHeading(value: string, limit = 26) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length > limit && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function HouseIllustration({ frame }: { frame: HouseMathFrame }) {
  const lift = (1 - frame.enterProgress) * 42;
  return <g transform={`translate(0 ${lift})`} opacity={frame.enterProgress}>
    <circle cx="1450" cy="520" r="325" fill="#E2C08B" opacity="0.045" />
    <ellipse cx="1450" cy="830" rx="370" ry="64" fill="#000000" opacity="0.27" />
    <path d="M1126 494 L1437 281 L1760 489 L1760 808 L1126 808 Z" fill="#223B4B" stroke="#88A8AC" strokeWidth="5" />
    <path d="M1091 494 L1437 240 L1793 496 L1750 534 L1437 311 L1133 536 Z" fill="#AD856C" stroke="#E8C69A" strokeWidth="4" />
    <rect x="1198" y="563" width="152" height="147" rx="8" fill="#B8CAD0" />
    <rect x="1221" y="582" width="108" height="109" fill="#142838" />
    <path d="M1275 582 V691 M1221 636 H1329" stroke="#B8CAD0" strokeWidth="9" />
    <rect x="1510" y="562" width="157" height="246" rx="7" fill="#B29B87" />
    <rect x="1530" y="582" width="118" height="226" fill="#4A5A66" />
    <circle cx="1618" cy="699" r="8" fill="#E9CA90" />
    <path d="M1134 810 H1752" stroke="#6C8E94" strokeWidth="9" />
    <g transform="translate(1440 860)">
      <rect x="-224" y="-18" width="448" height="84" rx="18" fill="#172A37" stroke="#516C75" strokeWidth="2" />
      <text x="0" y="18" textAnchor="middle" fill={ink} fontSize="34" fontWeight="700" letterSpacing="1">LISTING  {cash(frame.scenario.purchasePrice)}</text>
    </g>
  </g>;
}

function Breakdown({ frame }: { frame: HouseMathFrame }) {
  const max = Math.max(...frame.economics.categories.map((item) => item.amount));
  return <g>
    <text x="1060" y="265" fill={muted} fontSize="26" letterSpacing="4">CASH COMPONENTS · 30-YEAR EXAMPLE</text>
    {frame.economics.categories.map((item, i) => {
      const y = 330 + i * 112;
      const appearance = Math.max(0, Math.min(1, frame.enterProgress * 2 - i * 0.18));
      return <g key={item.id} opacity={appearance}>
        <text x="1060" y={y} fill={ink} fontSize="30" fontWeight="550">{item.label}</text>
        <text x="1782" y={y} textAnchor="end" fill={ink} fontSize="30" fontWeight="700">{short(item.amount)}</text>
        <rect x="1060" y={y + 21} width="725" height="20" rx="10" fill="#27404E" />
        <rect x="1060" y={y + 21} width={Math.max(0, 725 * item.amount / max * appearance)} height="20" rx="10" fill={item.color} />
      </g>;
    })}
    <text x="1060" y="933" fill={muted} fontSize="24">Principal is included in loan repayments. Do not add it twice.</text>
  </g>;
}

function LifetimeTimeline({ frame }: { frame: HouseMathFrame }) {
  const series = frame.economics.cashByYear;
  const max = frame.economics.totalCashOutflow;
  const left = 1090, top = 354, width = 676, height = 385;
  const visible = Math.max(1, Math.ceil((series.length - 1) * frame.progress));
  const points = series.slice(0, visible + 1).map((item) => `${left + width * item.year / (series.length - 1)},${top + height * (1 - item.cash / max)}`).join(" ");
  return <g>
    <text x={left} y="260" fill={muted} fontSize="26" letterSpacing="4">CUMULATIVE CASH PAID</text>
    {[0, 0.25, 0.5, 0.75, 1].map((p) => <g key={p}>
      <line x1={left} y1={top + height * (1 - p)} x2={left + width} y2={top + height * (1 - p)} stroke="#405568" strokeWidth="2" strokeDasharray="8 12" />
      <text x={left - 24} y={top + height * (1 - p) + 10} fill={muted} fontSize="22" textAnchor="end">{short(max * p)}</text>
    </g>)}
    <polyline fill="none" stroke={amber} strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" points={points} />
    {series.filter((item) => item.year % 5 === 0).map((item) => <text key={item.year} x={left + width * item.year / (series.length - 1)} y={top + height + 58} fill={muted} fontSize="24" textAnchor="middle">{item.year}y</text>)}
    <rect x={left + 36} y="870" width="620" height="90" rx="18" fill="#213645" stroke="#425D6B" />
    <text x={left + 72} y="921" fill={ink} fontSize="29">Mortgage payment {cash(frame.economics.monthlyMortgagePayment)} / mo.</text>
  </g>;
}

function Comparison({ frame }: { frame: HouseMathFrame }) {
  const total = frame.economics.totalCashOutflow;
  const paidRatio = frame.scenario.purchasePrice / total;
  const appear = frame.enterProgress;
  return <g opacity={appear}>
    <text x="1070" y="265" fill={muted} fontSize="25" letterSpacing="4">SAME HOUSE · DIFFERENT MEASURES</text>
    <text x="1070" y="378" fill={ink} fontSize="30">Asking price</text>
    <rect x="1070" y="416" width={730 * paidRatio * appear} height="92" rx="12" fill="#79AFC2" />
    <text x="1783" y="483" fill={ink} textAnchor="end" fontSize="41" fontWeight="700">{short(frame.scenario.purchasePrice)}</text>
    <text x="1070" y="620" fill={ink} fontSize="30">Illustrative 30-year cash outflow</text>
    <rect x="1070" y="660" width={730 * appear} height="108" rx="12" fill={amber} />
    <text x="1783" y="736" fill="#13212C" textAnchor="end" fontSize="44" fontWeight="800">{short(total)}</text>
    <rect x="1065" y="836" width="720" height="105" rx="18" fill="#203441" stroke="#415C6A" />
    <text x="1101" y="886" fill={muted} fontSize="24">These are cash flows, not after-sale net costs.</text>
    <text x="1101" y="922" fill={ink} fontSize="23">Home equity and resale value are separate.</text>
  </g>;
}

function Payoff({ frame }: { frame: HouseMathFrame }) {
  const p = frame.revealProgress;
  return <g>
    <circle cx="1440" cy="536" r={275 + (1 - p) * 70} fill="none" stroke={amber} strokeWidth="3" opacity={p * 0.6} />
    <circle cx="1440" cy="536" r={234 + (1 - p) * 90} fill={amber} opacity={p * 0.09} />
    <text x="1440" y="365" textAnchor="middle" fill={muted} fontSize="27" letterSpacing="4" opacity={p}>CASH PAID OVER {frame.scenario.years} YEARS</text>
    <text x="1440" y={555 + (1 - p) * 38} textAnchor="middle" fill={ink} fontSize="94" fontWeight="750" letterSpacing="-6" opacity={p}>{cash(frame.economics.totalCashOutflow)}</text>
    <rect x="1180" y="622" width="520" height="68" rx="14" fill="#27403F" opacity={p} />
    <text x="1440" y="665" textAnchor="middle" fill="#B5DACB" fontSize="24" fontWeight="650" opacity={p}>ILLUSTRATIVE · NO RESALE OFFSET</text>
    <g opacity={Math.max(0, frame.enterProgress - p * 0.5)}>
      <text x="1440" y="846" textAnchor="middle" fill={muted} fontSize="28">A better question:</text>
      <text x="1440" y="897" textAnchor="middle" fill={ink} fontSize="31" fontWeight="600">Which assumptions change the outcome?</text>
    </g>
  </g>;
}

export function HouseMathExportScene({ plan, frame }: { plan: HouseMathVisualPlan; frame: number }) {
  const state = getHouseMathFrame(plan, frame);
  const lines = wrapHeading(state.headline);
  const subheadLines = wrapHeading(state.subhead, 44);
  const isPayoff = state.intent === "cost-payoff";
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label={`${state.headline}: ${state.subhead}`} style={{ fontFamily: "Geist Variable, Geist, Arial, sans-serif" }}>
    <defs>
      <linearGradient id="house-bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#101B29" /><stop offset="1" stopColor="#203A45" /></linearGradient>
      <linearGradient id="house-glow" x1="0" x2="1"><stop offset="0" stopColor="#D7B27A" stopOpacity=".12" /><stop offset="1" stopColor="#D7B27A" stopOpacity="0" /></linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#house-bg)" />
    <circle cx="1830" cy="60" r="580" fill="url(#house-glow)" />
    <path d="M120 153 H1800" stroke="#4C6570" strokeWidth="2" opacity="0.7" />
    <rect x="120" y="89" width="13" height="13" rx="3" fill={amber} />
    <text x="156" y="105" fill={amber} fontSize="26" fontWeight="740" letterSpacing="5">HOUSE MATH</text>
    <text x="1800" y="105" textAnchor="end" fill={muted} fontSize="26" letterSpacing="2">{String(state.chapterIndex + 1).padStart(2, "0")} / {String(state.chapterCount).padStart(2, "0")}</text>
    <g opacity={state.enterProgress} transform={`translate(${(1 - state.enterProgress) * -50} 0)`}>
      <text x="125" y="240" fill={amber} fontSize="28" fontWeight="700" letterSpacing="3.2">{state.emphasis.toUpperCase()}</text>
      {lines.map((line, index) => <text key={`${line}-${index}`} x="120" y={345 + 90 * index} fill={ink} fontSize={lines.length > 2 ? 63 : 73} fontWeight="750" letterSpacing="-2.1">{line}</text>)}
      {subheadLines.map((line, index) => <text key={`${line}-${index}`} x="125" y={Math.max(650, 425 + lines.length * 90) + index * 49} fill={muted} fontSize="31">{line}</text>)}
    </g>
    <line x1="973" y1="214" x2="973" y2="924" stroke="#415766" strokeWidth="2" opacity="0.68" />
    {state.intent === "house-intro" && <HouseIllustration frame={state} />}
    {state.intent === "cost-breakdown" && <Breakdown frame={state} />}
    {state.intent === "cost-timeline" && <LifetimeTimeline frame={state} />}
    {state.intent === "cost-comparison" && <Comparison frame={state} />}
    {isPayoff && <Payoff frame={state} />}
    <path d="M120 979 H1800" stroke="#4C6570" strokeWidth="2" />
    <rect x="120" y="979" width={1680 * ((state.chapterIndex + state.progress) / state.chapterCount)} height="5" fill={amber} />
    <text x="120" y="1034" fill={muted} fontSize="22" letterSpacing="1.5">{state.disclaimer}</text>
    <text x="1800" y="1034" fill={muted} fontSize="22" textAnchor="end">EXAMPLE · {frame}f</text>
  </svg>;
}

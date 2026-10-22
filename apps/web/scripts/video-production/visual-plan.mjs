/** Validated, reproducible House Math scene semantics. No browser/media imports. */
import { parseVideoProductionJob } from "./job.mjs";

const INTENTS = new Set(["house-intro", "cost-breakdown", "cost-timeline", "cost-comparison", "cost-payoff"]);
const disclaimer = "ILLUSTRATIVE SCENARIO · NOT A MARKET FORECAST OR NET WEALTH COST";
const fail = (message) => { throw new Error(`House Math scene plan invalid: ${message}`); };
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const ease = (fraction) => { const x = clamp01(fraction); return x * x * (3 - 2 * x); };

function computeEconomics(s) {
  const principal = s.purchasePrice - s.downPayment;
  const payments = s.years * 12;
  const monthlyRate = s.annualInterestRatePct / 1200;
  const monthlyMortgagePayment = monthlyRate === 0
    ? principal / payments
    : principal * monthlyRate / (1 - (1 + monthlyRate) ** -payments);
  const totalMortgagePayments = monthlyMortgagePayment * payments;
  const totalMortgageInterest = totalMortgagePayments - principal;
  const annualCarryingCosts = s.annualPropertyTax + s.annualInsurance + s.annualMaintenance;
  const totalCarryingCosts = annualCarryingCosts * s.years;
  const totalCashOutflow = s.downPayment + totalMortgagePayments + totalCarryingCosts;
  const cashByYear = Array.from({ length: s.years + 1 }, (_, year) => ({
    year,
    cash: s.downPayment + monthlyMortgagePayment * 12 * year + annualCarryingCosts * year,
  }));
  if (![monthlyMortgagePayment, totalMortgagePayments, totalCashOutflow].every((v) => Number.isFinite(v) && v >= 0)) fail("non-finite scenario arithmetic");
  return {
    principal, downPayment: s.downPayment, monthlyMortgagePayment, totalMortgagePayments,
    totalMortgageInterest, annualCarryingCosts, totalCarryingCosts, totalCashOutflow, cashByYear,
    categories: [
      { id: "down", label: "Down payment", amount: s.downPayment, color: "#79AFC2" },
      { id: "loan", label: "Loan repayments", amount: totalMortgagePayments, color: "#D7B27A" },
      { id: "tax", label: "Property tax", amount: s.annualPropertyTax * s.years, color: "#82AF9E" },
      { id: "insurance", label: "Insurance", amount: s.annualInsurance * s.years, color: "#B9A2CD" },
      { id: "upkeep", label: "Maintenance", amount: s.annualMaintenance * s.years, color: "#CF8F87" },
    ],
  };
}

/** Server-side compilation from the already validated narration timeline and authored job. */
export function compileHouseMathVisuals(job, timeline) {
  const parsed = parseVideoProductionJob(job);
  if (!parsed.ok) fail(parsed.findings.map((f) => f.code).join(", "));
  if (!job.scenario || job.scenario.kind !== "house-cost-v1") fail("an explicitly authored house-cost-v1 scenario is required");
  if (job.destination.presetId !== "youtube" || job.destination.width !== 1920 || job.destination.height !== 1080) fail("first House Math renderer supports YouTube 1920x1080 only");
  if (!timeline || timeline.sampleRate !== 48000 || !Number.isSafeInteger(timeline.totalFrames) || timeline.totalFrames < 1) fail("measured 48 kHz narration timeline is required");
  if (timeline.fps?.num !== job.destination.fps.num || timeline.fps?.den !== job.destination.fps.den) fail("timeline and destination rational FPS differ");
  if (job.mode === "youtube-long" && timeline.totalSamples < 480 * 48000) fail("long-form requires at least 480 seconds of measured narration, not padding");
  if (!Array.isArray(timeline.beats) || timeline.beats.length !== job.beats.length) fail("scene chapter count must match narrated beats");
  const chapters = job.beats.map((beat, index) => {
    const range = timeline.beats[index];
    if (range.id !== beat.id || !INTENTS.has(beat.visualIntent)) fail(`unsupported/misaligned scene intent at beat ${beat.id}`);
    const startFrame = range.startFrame;
    const endFrame = index === job.beats.length - 1 ? timeline.totalFrames : timeline.beats[index + 1].startFrame;
    if (endFrame <= startFrame) fail(`scene beat ${beat.id} is too short to display one frame`);
    const visual = beat.visual ?? {
      headline: ({ "house-intro": "THE PRICE IS JUST THE BEGINNING", "cost-breakdown": "THE TRUE COST DRIVERS", "cost-timeline": "THIRTY YEARS, ONE HOUSE", "cost-comparison": "LISTING PRICE VS. OUTFLOW", "cost-payoff": "THE CUMULATIVE CASH TOTAL" })[beat.visualIntent],
      subhead: "Every figure is an illustrative scenario assumption.",
      emphasis: "HOUSE MATH",
    };
    return { id: beat.id, intent: beat.visualIntent, visual, startFrame, endFrame, eventIds: [...beat.eventIds], claimRefs: [...beat.claimRefs] };
  });
  const payoff = job.topic.payoffEventId;
  if (!Object.hasOwn(timeline.eventFrames, payoff)) fail("payoff event is missing from resolved timeline");
  const eventChapter = chapters.find((chapter) => chapter.eventIds.includes(payoff));
  if (!eventChapter || eventChapter.intent !== "cost-payoff" || timeline.eventFrames[payoff] !== eventChapter.startFrame) {
    fail("payoff event must be anchored to the start of a cost-payoff scene");
  }
  const economics = computeEconomics(job.scenario);
  return {
    schemaVersion: 1, kind: "house-math-visual-plan", title: job.topic.title,
    manifest: { schemaVersion: 1, id: job.id, durationFrames: timeline.totalFrames,
      width: job.destination.width, height: job.destination.height, fps: { ...job.destination.fps }, preset: "youtube" },
    chapters, events: { ...timeline.eventFrames }, payoffEventId: payoff,
    scenario: { ...job.scenario }, economics, disclaimer, commercialReady: false,
  };
}

/** Pure absolute-frame state; no incremental clock, hidden animation or randomization. */
export function getHouseMathFrame(plan, absoluteFrame) {
  if (!Number.isSafeInteger(absoluteFrame) || absoluteFrame < 0 || absoluteFrame >= plan?.manifest?.durationFrames) fail("frame is outside the validated manifest");
  let chapterIndex = plan.chapters.findIndex((chapter) => absoluteFrame >= chapter.startFrame && absoluteFrame < chapter.endFrame);
  if (chapterIndex < 0) fail("frame has no authored House Math scene");
  const chapter = plan.chapters[chapterIndex];
  const localFrame = absoluteFrame - chapter.startFrame;
  const revealAt = plan.events[plan.payoffEventId];
  const revealProgress = chapter.intent === "cost-payoff" && absoluteFrame > revealAt ? ease((absoluteFrame - revealAt) / 32) : 0;
  const enterProgress = ease(localFrame / 22);
  const chapterFrames = chapter.endFrame - chapter.startFrame;
  const progress = clamp01(localFrame / Math.max(1, chapterFrames - 1));
  return {
    frame: absoluteFrame, chapterIndex, chapterCount: plan.chapters.length, intent: chapter.intent,
    headline: chapter.visual.headline, subhead: chapter.visual.subhead, emphasis: chapter.visual.emphasis,
    localFrame, enterProgress, revealProgress, progress,
    disclaimer: plan.disclaimer, economics: plan.economics, scenario: plan.scenario,
  };
}

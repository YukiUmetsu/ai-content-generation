import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CheckCircle2, Film, Layers3, Scan, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Surface } from "@/components/ui/surface-card";
import { Tabs } from "@/components/ui/tabs";
import { AlignmentGuides } from "@/components/media/alignment-guides";
import { Artboard } from "@/components/media/artboard";
import { createDocument } from "@/components/media/document";
import { ExportPreview } from "@/components/media/export-preview";
import { LayerList, LayerStack } from "@/components/media/layer-stack";
import { renderCostWaterfall } from "@/components/infographic/cost-waterfall";
import { EconomicChartView } from "@/components/infographic/economic-react";
import type { CostWaterfallSpec } from "@/components/infographic/cost-waterfall";
import { compileMotionDirector, evaluateMotionDirector } from "@/components/motion/motion-director";
import type { MotionDirection } from "@/components/motion/director-types";
import { CameraStage } from "@/components/motion/camera-stage";
import { usePrefersReducedMotion } from "@/components/motion/react";
import { createVideoPresetManifest, videoPlatformPreset } from "@/components/video/platform-presets";
import type { VideoPlatformPresetId } from "@/components/video/platform-presets";
import { VideoExportStage } from "@/components/video/video-export-stage";
import type { FeatureSlotProps } from "@/features/registry";
import "./motion-gallery.css";

const DURATION_FRAMES = 180;
const FPS = { num: 30, den: 1 } as const;
const PRESET_IDS: VideoPlatformPresetId[] = ["youtube", "youtube-shorts"];

const HVAC_COST_SPEC: CostWaterfallSpec = {
  id: "house-math-hvac-demo",
  title: "Illustrative HVAC installed cost",
  subtitle: "A transparent example of how the quote adds up",
  unit: { currency: "USD", minorDigits: 2 },
  steps: [
    { id: "equipment", label: "Equipment", amount: 7100 },
    { id: "labor", label: "Labor", amount: 3200 },
    { id: "ductwork", label: "Ductwork", amount: 1400 },
    { id: "permits", label: "Permits & misc.", amount: 700 },
  ],
  total: { label: "Installed total", stated: 12400 },
  layout: "auto",
  reveal: { start: 6, stepFrames: 14, gapFrames: 3 },
  provenance: {
    source: "Synthetic values authored for this UI demonstration",
    asOf: "Demonstration only",
    note: "Not a contractor quote or a market estimate. Verify costs with local quotes.",
    illustrative: true,
  },
};

function makeTextLayer(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  content: string,
  size: number,
  color: string,
  z: number,
  weight = 600,
  as: "h1" | "h2" | "h3" | "p" = "p",
) {
  return {
    id, name, kind: "text" as const,
    transform: { x, y, width, height }, z,
    visible: true, locked: false, opacity: 1, blend: "normal" as const, clip: false,
    summary: name,
    text: {
      spans: [{ text: content, color, weight }],
      fontId: "geist", size, lineHeight: 1.12, letterSpacing: 0,
      align: "start" as const, direction: "ltr" as const, language: "en-US",
      fit: "shrink" as const, minSize: size * 0.72, maxSize: size, as,
    },
  };
}

function makeShapeLayer(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
  shape: { kind: "rect" | "ellipse"; fill?: string; stroke?: string; strokeWidth?: number; radius?: number },
  opacity = 1,
) {
  return {
    id, name, kind: "shape" as const,
    transform: { x, y, width, height }, z,
    visible: true, locked: false, opacity, blend: "normal" as const, clip: false,
    shape,
  };
}

const STILL_DOCUMENT = createDocument({
  id: "house-math-hvac-title-card",
  artboard: { id: "house-math-hvac-artboard", preset: "16:9", background: "#0B1421" },
  fonts: {
    geist: {
      id: "geist", family: "Geist", weight: 700, style: "normal",
      fallback: ["Arial", "sans-serif"], availability: "system",
    },
  },
  layers: [
    makeShapeLayer("accent-orbit", "Accent orbit", 900, 76, 240, 240, 0,
      { kind: "ellipse", fill: "#E8A24A", stroke: "#F4D6A3", strokeWidth: 2 }, 0.16),
    makeTextLayer("brand-eyebrow", "Brand eyebrow", 76, 62, 640, 42,
      "HOUSE MATH  /  COST GUIDE", 20, "#E8A24A", 1, 700),
    makeTextLayer("hero-title", "Hero title", 76, 132, 730, 190,
      "THE REAL COST\nOF A NEW HVAC SYSTEM", 65, "#F5F0E6", 2, 700, "h1"),
    makeShapeLayer("accent-rule", "Accent rule", 78, 350, 92, 7, 3,
      { kind: "rect", fill: "#E8A24A", radius: 3 }),
    makeTextLayer("installed-cost", "Installed cost", 76, 386, 440, 90,
      "$12,400", 70, "#F5F0E6", 4, 700, "h2"),
    makeTextLayer("cost-caption", "Cost caption", 80, 482, 560, 40,
      "ILLUSTRATIVE INSTALLED COST", 18, "#AEBAC8", 5, 600),
    makeShapeLayer("driver-card", "Cost driver panel", 730, 374, 470, 252, 6,
      { kind: "rect", fill: "#142438", stroke: "#31475C", strokeWidth: 2, radius: 18 }),
    makeTextLayer("driver-heading", "Cost driver heading", 770, 398, 370, 32,
      "WHAT BUILDS THE BILL", 16, "#AEBAC8", 7, 700),
    makeShapeLayer("equipment-bar", "Equipment cost bar", 770, 462, 300, 18, 8,
      { kind: "rect", fill: "#E8A24A", radius: 8 }),
    makeShapeLayer("labor-bar", "Labor cost bar", 770, 500, 135, 18, 9,
      { kind: "rect", fill: "#78A8D8", radius: 8 }),
    makeShapeLayer("other-bar", "Ductwork and permit cost bar", 770, 538, 88, 18, 10,
      { kind: "rect", fill: "#88B6A1", radius: 8 }),
    makeTextLayer("demo-note", "Illustrative data note", 80, 592, 700, 36,
      "EXAMPLE ONLY  ·  LOCAL QUOTES VARY", 16, "#AEBAC8", 11, 600),
  ],
  guides: [
    { id: "safe-left", axis: "x", position: 76 },
    { id: "safe-right", axis: "x", position: 1204 },
    { id: "headline-baseline", axis: "y", position: 322 },
  ],
  grid: { visible: true, size: 80, subdivisions: 4 },
  metadata: {
    title: "House Math — HVAC installed cost",
    authoringTool: "ContentGen Motion & Media Lab",
    locale: "en-US",
    notes: ["Synthetic illustrative values only; verify costs with local quotes."],
  },
});

function makeCameraDirection(width: number, height: number): MotionDirection {
  const portrait = height > width;
  const center = { x: width / 2, y: height / 2 };
  const focus = {
    x: width * (portrait ? 0.5 : 0.61),
    y: height * (portrait ? 0.45 : 0.38),
  };
  const track = (
    id: string,
    targetId: string,
    property: string,
    valueType: "vec2" | "number" | "opacity",
    values: Array<{ frame: number; value: { x: number; y: number } | number }>,
  ) => ({
    kind: "animation" as const,
    id,
    track: { id: id + "-track", targetId, property, valueType, keyframes: values },
  });
  return {
    schemaVersion: 1,
    id: "house-math-motion-" + width + "x" + height,
    title: "HVAC cost reveal",
    fps: FPS,
    durationFrames: DURATION_FRAMES,
    targets: ["camera", "signal"],
    profile: { personality: "gentle" },
    children: [
      track("camera-center", "camera", "center", "vec2", [
        { frame: 0, value: center },
        { frame: 42, value: focus },
        { frame: 110, value: center },
        { frame: 179, value: center },
      ]),
      track("camera-zoom", "camera", "zoom", "number", [
        { frame: 0, value: 1 },
        { frame: 42, value: 1.1 },
        { frame: 110, value: 1 },
        { frame: 179, value: 1 },
      ]),
      track("signal-reveal", "signal", "opacity", "opacity", [
        { frame: 0, value: 0.15 },
        { frame: 20, value: 1 },
        { frame: 179, value: 1 },
      ]),
    ],
  };
}

function HouseMathScene({ width, height, signalOpacity }: { width: number; height: number; signalOpacity: number }) {
  const portrait = height > width;
  const margin = width * 0.08;
  const titleSize = width * (portrait ? 0.078 : 0.044);
  const card = portrait
    ? { x: margin, y: height * 0.43, width: width * 0.84, height: height * 0.22 }
    : { x: width * 0.64, y: height * 0.22, width: width * 0.29, height: height * 0.48 };
  const inset = card.width * 0.075;
  const labelSize = Math.max(15, width * (portrait ? 0.019 : 0.013));
  const amountSize = width * (portrait ? 0.068 : 0.046);
  const barStart = card.y + card.height * 0.57;
  const barGap = card.height * 0.105;
  const barHeight = Math.max(8, card.height * 0.035);
  const availableBarWidth = card.width - inset * 2;
  const rows = [
    { label: "Equipment", amount: "$7.1K", ratio: 0.57, color: "#E8A24A" },
    { label: "Labor", amount: "$3.2K", ratio: 0.26, color: "#78A8D8" },
    { label: "Ductwork + permits", amount: "$2.1K", ratio: 0.17, color: "#88B6A1" },
  ];
  const titleY = portrait ? [height * 0.22, height * 0.275, height * 0.33] : [height * 0.30, height * 0.40];

  return (
    <>
      <rect width={width} height={height} fill="#0B1421" />
      <circle cx={width * 0.83} cy={height * 0.15} r={Math.min(width, height) * 0.18} fill="#E8A24A" opacity="0.10" />
      <circle cx={width * 0.83} cy={height * 0.15} r={Math.min(width, height) * 0.12} fill="none" stroke="#E8A24A" strokeWidth={Math.max(1, width * 0.001)} opacity={signalOpacity} />
      <path d={"M " + width * 0.08 + " " + height * 0.18 + " L " + width * 0.2 + " " + height * 0.18} stroke="#E8A24A" strokeWidth={Math.max(2, width * 0.002)} opacity={signalOpacity} />
      <text x={margin} y={height * 0.13} fill="#E8A24A" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize} fontWeight={700} letterSpacing={Math.max(1, width * 0.0016)}>HOUSE MATH  /  FIELD NOTES</text>
      {portrait ? (
        <>
          <text x={margin} y={titleY[0]} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={titleSize} fontWeight={700}>THE REAL</text>
          <text x={margin} y={titleY[1]} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={titleSize} fontWeight={700}>COST OF</text>
          <text x={margin} y={titleY[2]} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={titleSize} fontWeight={700}>NEW HVAC</text>
          <text x={margin} y={height * 0.385} fill="#AEBAC8" fontFamily="Geist, Arial, sans-serif" fontSize={width * 0.022}>Equipment is only one part of the bill.</text>
        </>
      ) : (
        <>
          <text x={margin} y={titleY[0]} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={titleSize} fontWeight={700}>THE REAL COST</text>
          <text x={margin} y={titleY[1]} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={titleSize} fontWeight={700}>OF A NEW HVAC SYSTEM</text>
          <text x={margin} y={height * 0.51} fill="#AEBAC8" fontFamily="Geist, Arial, sans-serif" fontSize={width * 0.017}>Equipment is only one part of the bill.</text>
        </>
      )}
      <rect x={card.x} y={card.y} width={card.width} height={card.height} rx={Math.min(26, card.width * 0.035)} fill="#142438" stroke="#31475C" strokeWidth={Math.max(1.5, width * 0.001)} />
      <text x={card.x + inset} y={card.y + card.height * 0.19} fill="#AEBAC8" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize} fontWeight={600} letterSpacing="1.3">ILLUSTRATIVE INSTALLED COST</text>
      <text x={card.x + inset} y={card.y + card.height * 0.39} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={amountSize} fontWeight={700} letterSpacing="-2">$12,400</text>
      {rows.map((row, index) => {
        const y = barStart + index * barGap;
        return (
          <g key={row.label}>
            <text x={card.x + inset} y={y - barHeight * 0.55} fill="#C7D0DA" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize * 0.82}>{row.label}</text>
            <text x={card.x + card.width - inset} y={y - barHeight * 0.55} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize * 0.82} textAnchor="end">{row.amount}</text>
            <rect x={card.x + inset} y={y} width={availableBarWidth * row.ratio} height={barHeight} rx={barHeight / 2} fill={row.color} />
          </g>
        );
      })}
      {portrait ? (
        <text x={margin} y={height * 0.72} fill="#AEBAC8" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize * 0.9}>Example only · local quotes vary</text>
      ) : (
        <>
          <text x={margin} y={height * 0.72} fill="#AEBAC8" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize}>COST DRIVERS</text>
          <text x={margin} y={height * 0.78} fill="#F5F0E6" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize * 0.95}>Equipment  $7.1K     Labor  $3.2K     Other  $2.1K</text>
          <text x={margin} y={height * 0.88} fill="#AEBAC8" fontFamily="Geist, Arial, sans-serif" fontSize={labelSize * 0.82}>Synthetic values for demonstration · verify with local quotes</text>
        </>
      )}
      <line x1={margin} y1={height * 0.93} x2={width * 0.92} y2={height * 0.93} stroke="#31475C" strokeWidth={Math.max(1, width * 0.001)} />
    </>
  );
}

export function MotionMediaShowcase({ locale, className }: Pick<FeatureSlotProps, "locale" | "className">) {
  const isJa = locale === "ja";
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeTab, setActiveTab] = useState(0);
  const [selectedLayer, setSelectedLayer] = useState<string | null>("hero-title");
  const [frame, setFrame] = useState(0);
  const [presetId, setPresetId] = useState<VideoPlatformPresetId>("youtube");
  const [captureStatus, setCaptureStatus] = useState("");
  const [capturePending, setCapturePending] = useState(false);
  const captureViewportRef = useRef<HTMLDivElement | null>(null);
  const [captureScale, setCaptureScale] = useState(1);
  const effectiveFrame = prefersReducedMotion ? DURATION_FRAMES - 1 : frame;
  const manifest = useMemo(
    () => createVideoPresetManifest(presetId, {
      id: "house-math-hvac-showcase", durationFrames: DURATION_FRAMES, fps: FPS,
    }),
    [presetId],
  );
  const direction = useMemo(() => makeCameraDirection(manifest.width, manifest.height), [manifest.width, manifest.height]);
  const compilation = useMemo(() => compileMotionDirector(direction), [direction]);
  const director = compilation.ok ? compilation.director : null;
  const evaluation = useMemo(
    () => director ? evaluateMotionDirector(director, effectiveFrame).evaluation : undefined,
    [director, effectiveFrame],
  );
  const signalSample = evaluation?.samples["signal.opacity"]?.value;
  const signalOpacity = typeof signalSample === "number" ? signalSample : 1;
  const chart = useMemo(
    () => renderCostWaterfall(HVAC_COST_SPEC, {
      width: 1280, height: 720, style: "minimal-technical", language: locale, frame: effectiveFrame,
    }),
    [effectiveFrame, locale],
  );
  const captureViewportStyle = {
    aspectRatio: String(manifest.width) + " / " + String(manifest.height),
    "--mg-capture-scale": captureScale,
  } as CSSProperties & { "--mg-capture-scale": number };

  useEffect(() => {
    const viewport = captureViewportRef.current;
    if (!viewport) return;
    const update = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setCaptureScale(Math.min(rect.width / manifest.width, rect.height / manifest.height));
    };
    if (typeof ResizeObserver === "undefined") {
      const request = requestAnimationFrame(update);
      return () => cancelAnimationFrame(request);
    }
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [manifest.width, manifest.height]);

  async function checkCaptureReadiness() {
    setCapturePending(true);
    setCaptureStatus(isJa ? "キャプチャ準備を確認中…" : "Checking capture readiness…");
    try {
      const api = window.__kmVideoExport;
      if (!api) throw new Error(isJa ? "キャプチャステージがまだ準備できていません。" : "The capture stage is not mounted yet.");
      await api.seek(effectiveFrame);
      setCaptureStatus(isJa
        ? "フレーム " + effectiveFrame + " はブラウザーキャプチャの準備ができました。"
        : "Frame " + effectiveFrame + " is ready for browser capture.");
    } catch (error) {
      setCaptureStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCapturePending(false);
    }
  }

  return (
    <div className={"mg-showcase min-h-full w-full min-w-0 " + (className ?? "")}>
      <header className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-caption text-muted-foreground">
            <Film aria-hidden="true" className="size-3.5" />
            {isJa ? "統合デモ" : "INTEGRATION DEMO"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-caption text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            {isJa ? "決定論的フレーム" : "DETERMINISTIC FRAMES"}
          </span>
        </div>
        <div>
          <h2 className="font-serif text-heading-sm text-foreground">{isJa ? "モーションとメディアのラボ" : "Motion & media lab"}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {isJa
              ? "ブランド付きの一つのストーリーを、モーション・図解・書き出しまで通して確認します。"
              : "Follow one branded story through camera motion, an infographic, still-export checks, and a capture-ready video frame."}
          </p>
        </div>
      </header>

      <Tabs activeIndex={activeTab} onChange={(next) => { if (next !== null) setActiveTab(next); }} label={isJa ? "統合デモのビュー" : "Integration showcase views"} className="mt-4 flex min-w-0 flex-col gap-3">
        <Tabs.List className="grid grid-cols-4">
          <Tabs.Tab value={0} className="min-w-0 px-1 text-xs">{isJa ? "モーション" : "Motion"}</Tabs.Tab>
          <Tabs.Tab value={1} className="min-w-0 px-1 text-xs">{isJa ? "レイヤー" : "Media"}</Tabs.Tab>
          <Tabs.Tab value={2} className="min-w-0 px-1 text-xs">{isJa ? "図解" : "Infographic"}</Tabs.Tab>
          <Tabs.Tab value={3} className="min-w-0 px-1 text-xs">{isJa ? "静止画書き出し" : "Still export"}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={0} className="flex min-w-0 flex-col gap-3">
          {director ? (
            <>
              <div className="mg-capture-viewport w-full overflow-hidden rounded-surface border border-border bg-surface-inset" ref={captureViewportRef} style={captureViewportStyle}>
                <VideoExportStage manifest={manifest} frame={effectiveFrame} onSeek={setFrame} className="mg-capture-stage">
                  <CameraStage timeline={director.timeline} frame={effectiveFrame} width={manifest.width} height={manifest.height} evaluation={evaluation} reducedMotion={prefersReducedMotion} ariaLabel={isJa ? "アニメーションする HVAC コストシーン" : "Animated HVAC cost scene"}>
                    <HouseMathScene width={manifest.width} height={manifest.height} signalOpacity={signalOpacity} />
                  </CameraStage>
                </VideoExportStage>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-w-0 flex-col gap-1 text-body-sm text-muted-foreground">
                  {isJa ? "出力プロファイル" : "Output profile"}
                  <select aria-label={isJa ? "出力プロファイル" : "Output profile"} className="h-9 rounded-control border border-input bg-surface px-3 text-foreground" value={presetId} onChange={(event) => { setPresetId(event.target.value as VideoPlatformPresetId); setCaptureStatus(""); }}>
                    {PRESET_IDS.map((id) => <option key={id} value={id}>{videoPlatformPreset(id).label}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-2 text-caption tabular-nums text-muted-foreground">
                  <span>{manifest.width} × {manifest.height}</span><span aria-hidden="true">·</span><span>{DURATION_FRAMES / FPS.num}s / {FPS.num} fps</span>
                </div>
              </div>
              <div className="rounded-surface border border-border bg-surface px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-body-sm font-medium text-foreground">{isJa ? "アニメーションフレーム" : "Animation frame"}</label>
                  <span className="text-caption tabular-nums text-muted-foreground">{effectiveFrame} / {DURATION_FRAMES - 1}</span>
                </div>
                <Slider className="mt-3" aria-label={isJa ? "アニメーションフレーム" : "Animation frame"} label={isJa ? "アニメーションフレーム" : "Animation frame"} min={0} max={DURATION_FRAMES - 1} step={1} value={frame} disabled={prefersReducedMotion}
                  onValueChange={(next) => { setFrame(typeof next === "number" ? next : next[0] ?? 0); setCaptureStatus(""); }}
                  formatValue={(value) => String(Math.round(value)) + " / " + String(DURATION_FRAMES - 1)} />
                {prefersReducedMotion ? <p className="mt-2 text-caption text-muted-foreground">{isJa ? "OS の視差効果を減らす設定に合わせ、最終フレームを表示しています。" : "Reduced motion is enabled; the final frame is shown and scrubbing is disabled."}</p> : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="primary" icon={<CheckCircle2 aria-hidden="true" className="size-4" />} onClick={checkCaptureReadiness} disabled={capturePending}>
                  {capturePending ? (isJa ? "確認中…" : "Checking…") : (isJa ? "キャプチャ準備を確認" : "Check capture readiness")}
                </Button>
                <span className="text-caption text-muted-foreground" aria-live="polite">{captureStatus || (isJa ? "未確認" : "Not checked")}</span>
              </div>
              <p className="text-caption text-muted-foreground">{isJa ? "このステージはフレーム準備とブラウザーキャプチャの境界です。動画エンコードや公開は行いません。" : "This stage verifies frame readiness for browser capture. Encoding and publishing are separate pipeline steps."}</p>
            </>
          ) : (
            <div role="alert" className="rounded-surface border border-status-danger bg-surface px-3 py-3 text-body-sm text-danger" data-testid="motion-director-status" data-status="error">
              {compilation.diagnostics.map((diagnostic) => diagnostic.message).join(" ")}
            </div>
          )}
          {director ? <span className="sr-only" data-testid="motion-director-status" data-status="ready">MotionDirector compiled successfully.</span> : null}
        </Tabs.Panel>

        <Tabs.Panel value={1} className="flex min-w-0 flex-col gap-3">
          <div className="aspect-video w-full overflow-hidden rounded-surface border border-border bg-surface-inset">
            <Artboard artboard={STILL_DOCUMENT.artboard} fit="contain" guides={STILL_DOCUMENT.guides} grid={STILL_DOCUMENT.grid} selectedIds={selectedLayer ? [selectedLayer] : []} onSelect={setSelectedLayer} className="h-full w-full">
              <LayerStack layers={STILL_DOCUMENT.layers} fonts={STILL_DOCUMENT.fonts} assets={STILL_DOCUMENT.assets} selectedIds={selectedLayer ? [selectedLayer] : []} onSelect={setSelectedLayer} headingSemantics="neutral" />
              <AlignmentGuides showGuides showGrid showSafeRegion showCenterAxes guides={STILL_DOCUMENT.guides} grid={STILL_DOCUMENT.grid} />
            </Artboard>
          </div>
          <p className="text-caption text-muted-foreground">{isJa ? "レイヤーを選択してアートボードを確認します。ガイドとグリッドは書き出し画像には含まれません。" : "Select a layer to inspect the composition. Guides and the grid are authoring overlays; they are not part of the exported artwork."}</p>
          <LayerList aria-label={isJa ? "アートボードのレイヤー" : "Artboard layers"} layers={STILL_DOCUMENT.layers} selectedIds={selectedLayer ? [selectedLayer] : []} onSelect={setSelectedLayer} interactive={false} className="rounded-surface border border-border bg-surface p-2" />
        </Tabs.Panel>

        <Tabs.Panel value={2} className="flex min-w-0 flex-col gap-3">
          <div className="rounded-surface border border-border bg-surface p-3">
            <div className="mb-3 flex items-start gap-2">
              <Scan aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <h3 className="text-body-sm font-medium text-foreground">{isJa ? "コストの内訳" : "Where the cost comes from"}</h3>
                <p className="mt-1 text-caption text-muted-foreground">{isJa ? "同じフレーム番号で順番に表示される図解です。" : "The chart reveal uses the same deterministic frame as the camera scene."}</p>
              </div>
            </div>
            <EconomicChartView chart={chart} className="overflow-hidden rounded-control" />
          </div>
          <p className="text-caption text-muted-foreground">{isJa ? "合計 $12,400 は説明用の合成データです。実際の相場や見積もりを表すものではありません。" : "The $12,400 total uses synthetic demonstration values. It is not a market estimate or contractor quote."}</p>
        </Tabs.Panel>

        <Tabs.Panel value={3} className="flex min-w-0 flex-col gap-3">
          <ExportPreview document={STILL_DOCUMENT} availableFontFamilies={["Geist"]} titleAs="h3" className="min-w-0" />
        </Tabs.Panel>
      </Tabs>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
        {[
          { icon: <Layers3 aria-hidden="true" className="size-4" />, title: isJa ? "メディア" : "Media", detail: isJa ? "レイヤーとガイド" : "Layers + guides" },
          { icon: <Film aria-hidden="true" className="size-4" />, title: isJa ? "モーション" : "Motion", detail: "MotionDirector + CameraStage" },
          { icon: <Scan aria-hidden="true" className="size-4" />, title: isJa ? "図解" : "Infographic", detail: "EconomicChartView" },
          { icon: <ShieldCheck aria-hidden="true" className="size-4" />, title: isJa ? "QA" : "Export QA", detail: isJa ? "静止画 + 動画フレーム" : "Still + video frame" },
        ].map((item) => (
          <Surface key={item.title} variant="outline" className="flex min-w-0 items-start gap-2 p-3">
            <span className="mt-0.5 text-muted-foreground">{item.icon}</span>
            <span className="min-w-0">
              <span className="block text-body-sm font-medium text-foreground">{item.title}</span>
              <span className="mt-0.5 block break-words text-caption text-muted-foreground">{item.detail}</span>
            </span>
          </Surface>
        ))}
      </div>
    </div>
  );
}

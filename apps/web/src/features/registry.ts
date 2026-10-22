/**
 * Feature integration contract.
 *
 * Five independent feature agents build on this foundation. Each agent owns one
 * folder under `src/features/<id>/` and replaces the body of its exported slot
 * component. Nothing else in the shell needs to change: the shell reads
 * `FEATURE_SLOTS` in `src/features/slots.tsx`, which maps each id to its slot.
 *
 * Rules for slot authors
 * - Accept `FeatureSlotProps`; do not read global state directly.
 * - Render inside the provided editor region: fill height, own your scroll.
 * - Use Kumiki components and `--km-*` semantic tokens (Tailwind utilities that
 *   bridge them). Do not introduce a second theme system, raw hex palettes or
 *   global CSS resets.
 * - Keep creative output (brand kits, thumbnails, storyboards, motion, platform
 *   variants) inside a preview/artboard scope, never restyled as editor chrome.
 * - Every async state must be honest: loading, empty, error, cancel. No fake
 *   percentages and no invented results.
 */
import type { ComponentType } from "react";

export const FEATURE_IDS = [
  "brand-appearance",
  "thumbnail-composer",
  "storyboard-planner",
  "motion-gallery",
  "platform-composer",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export interface FeatureSlotProps {
  /** Stable project identifier. The foundation has no persistence yet; the shell
   *  passes a placeholder id so slots can be wired to real data later. */
  projectId: string;
  locale: Locale;
  /** Optional CSS class applied to the slot root by the shell. */
  className?: string;
}

export type Locale = "en" | "ja";

export interface FeatureMetadata {
  id: FeatureId;
  /** English label used in navigation. */
  title: string;
  /** Japanese label, shown when the shell locale is `ja`. */
  titleJa: string;
  /** One sentence describing the user outcome, not the implementation. */
  outcome: string;
  outcomeJa: string;
  /** What this slot consumes from the foundation. */
  consumes: readonly string[];
  /** What this slot is expected to produce for downstream features. */
  produces: readonly string[];
}

export const FEATURE_METADATA: Record<FeatureId, FeatureMetadata> = {
  "brand-appearance": {
    id: "brand-appearance",
    title: "Brand & appearance",
    titleJa: "ブランドと外観",
    outcome: "Define a versioned BrandKit: palette roles, type roles, motion cadence and delivery defaults.",
    outcomeJa: "バージョン管理されたBrandKit（配色・書体・モーション・配信設定）を定義します。",
    consumes: ["Kumiki --km-* tokens", "Appearance and density axis", "Preview canvas scope"],
    produces: ["BrandKit revision", "DTCG token document", "Preview composition"],
  },
  "thumbnail-composer": {
    id: "thumbnail-composer",
    title: "Thumbnail composer",
    titleJa: "サムネイル作成",
    outcome: "Compose distinct, factual thumbnail variants at export size and mobile card size.",
    outcomeJa: "書き出しサイズとモバイル表示サイズで、根拠のあるサムネイル案を比較します。",
    consumes: ["BrandKit palette and type roles", "Preview canvas scope", "Platform card sizes"],
    produces: ["Thumbnail variants", "Packaging hypothesis", "Export manifest entry"],
  },
  "storyboard-planner": {
    id: "storyboard-planner",
    title: "Storyboard planner",
    titleJa: "ストーリーボード",
    outcome: "Sequence scenes, narration beats and shot intent before any render is requested.",
    outcomeJa: "レンダリング前に、シーン・ナレーション・ショット意図を構成します。",
    consumes: ["BrandKit motion cadence", "Scene recipes", "Audio timing contract"],
    produces: ["Storyboard document", "Scene list", "Render job request"],
  },
  "motion-gallery": {
    id: "motion-gallery",
    title: "Motion & media lab",
    titleJa: "モーション・メディア",
    outcome: "Preview deterministic camera motion, data-led infographics, still exports and capture-ready video frames in one place.",
    outcomeJa: "カメラモーション、インフォグラフィック、静止画書き出し、動画キャプチャ準備を一か所で確認します。",
    consumes: ["BrandKit palette and type roles", "MotionDirector + CameraStage", "Platform preset manifests", "Illustrative cost data"],
    produces: ["Frame-addressed motion sample", "Validated still export", "Capture-ready video frame", "QA diagnostics"],
  },
  "platform-composer": {
    id: "platform-composer",
    title: "Platform delivery",
    titleJa: "プラットフォーム配信",
    outcome: "Recompose one approved concept for each destination instead of cropping it.",
    outcomeJa: "1つの承認済みコンセプトを切り抜かず、配信先ごとに再構成します。",
    consumes: ["Versioned platform profiles", "Safe-area and caption policy", "Storyboard document"],
    produces: ["Delivery variants", "Platform QA report", "Publication manifest"],
  },
};

/** Component contract every feature slot implements. */
export type FeatureSlot = ComponentType<FeatureSlotProps>;

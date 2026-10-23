/**
 * Feature integration contract.
 *
 * Each tool owns one folder under src/features/<id>/ and plugs into the shared
 * workspace. Keep the contract user-facing: every tool explains its outcome,
 * steps and outputs, and clearly distinguishes a live editor from a planned one.
 */
import type { ComponentType, ReactNode } from "react";

export const FEATURE_IDS = [
  "brand-appearance",
  "thumbnail-composer",
  "storyboard-planner",
  "motion-gallery",
  "platform-composer",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];
export type Locale = "en" | "ja";
export type ToolAvailability = "live" | "demo" | "planned";

export interface FeatureSlotProps {
  projectId: string;
  locale: Locale;
  className?: string;
  /** Optional live preview content rendered in the shared preview pane. */
  onPreviewChange?: (preview: ReactNode | null) => void;
}

/** React component contract used by the shared feature-slot registry. */
export type FeatureSlot = ComponentType<FeatureSlotProps>;

export interface FeatureMetadata {
  id: FeatureId;
  title: string;
  titleJa: string;
  outcome: string;
  outcomeJa: string;
  availability: ToolAvailability;
  steps: Record<Locale, readonly string[]>;
  outputs: Record<Locale, readonly string[]>;
  /** Internal integration metadata retained for future data-flow wiring. */
  consumes: readonly string[];
  produces: readonly string[];
}

export const FEATURE_METADATA: Record<FeatureId, FeatureMetadata> = {
  "brand-appearance": {
    id: "brand-appearance",
    title: "Brand & appearance",
    titleJa: "ブランドと外観",
    outcome: "Choose a visual style, tune brand colors and typography, and see the result in video and thumbnail previews.",
    outcomeJa: "ビジュアルスタイルを選び、ブランドカラーと書体を調整し、動画やサムネイルのプレビューで確認します。",
    availability: "live",
    steps: {
      en: [
        "Choose an art direction preset.",
        "Adjust the palette and typography.",
        "Review the video, metric, and thumbnail previews.",
        "Export the appearance settings when you're happy.",
      ],
      ja: [
        "アートディレクションのプリセットを選びます。",
        "配色と書体を調整します。",
        "動画・数値表示・サムネイルのプレビューを確認します。",
        "完成したら外観設定を書き出します。",
      ],
    },
    outputs: {
      en: ["Reusable brand style settings", "Video-opening and metric previews", "YouTube thumbnail preview", "Exportable appearance JSON"],
      ja: ["再利用できるブランドスタイル設定", "動画オープニングと数値表示のプレビュー", "YouTube サムネイルのプレビュー", "書き出し可能な外観 JSON"],
    },
    consumes: ["Brand colors and typography", "Selected art direction", "Optional BrandKit JSON"],
    produces: ["Reusable brand style settings", "Video-opening preview", "Metric and thumbnail previews"],
  },
  "thumbnail-composer": {
    id: "thumbnail-composer",
    title: "Thumbnail composer",
    titleJa: "サムネイル作成",
    outcome: "Create and compare YouTube thumbnail concepts that stay readable at full size and on mobile.",
    outcomeJa: "通常サイズでもスマートフォンでも読みやすい YouTube サムネイル案を作成・比較します。",
    availability: "live",
    steps: {
      en: [
        "Add the video topic and one key takeaway.",
        "Compare thumbnail layouts and headline treatments.",
        "Check readability at mobile-card size.",
        "Choose a concept for export.",
      ],
      ja: [
        "動画のテーマと伝えたい要点を入力します。",
        "レイアウトと見出しの表現を比較します。",
        "スマートフォンのカードサイズで読みやすさを確認します。",
        "書き出す案を選びます。",
      ],
    },
    outputs: {
      en: ["Thumbnail concepts", "Mobile readability comparison", "Export-ready image"],
      ja: ["サムネイル案", "モバイルでの読みやすさ比較", "書き出し用画像"],
    },
    consumes: ["Video topic and key takeaway", "Brand colors and typography", "Platform image sizes"],
    produces: ["Thumbnail concepts", "Mobile readability comparison", "Export-ready image"],
  },
  "storyboard-planner": {
    id: "storyboard-planner",
    title: "Storyboard planner",
    titleJa: "ストーリーボード",
    outcome: "Plan the scenes, narration, and camera intent before rendering a video.",
    outcomeJa: "動画をレンダリングする前に、シーン・ナレーション・カメラの意図を組み立てます。",
    availability: "live",
    steps: {
      en: [
        "Break the idea into scenes.",
        "Add narration beats and on-screen text.",
        "Choose the intent for each shot.",
        "Review pacing and scene order.",
      ],
      ja: [
        "アイデアをシーンに分けます。",
        "ナレーションと画面上のテキストを追加します。",
        "各ショットの意図を決めます。",
        "テンポとシーンの順序を確認します。",
      ],
    },
    outputs: {
      en: ["Scene sequence", "Narration beats", "Shot list and pacing plan"],
      ja: ["シーンの順序", "ナレーションの区切り", "ショットリストとテンポ設計"],
    },
    consumes: ["Video idea and script", "Brand motion style", "Scene recipes"],
    produces: ["Scene sequence", "Narration beats", "Shot list"],
  },
  "motion-gallery": {
    id: "motion-gallery",
    title: "Motion & media lab",
    titleJa: "モーション・メディア",
    outcome: "Explore animated scenes, infographic reveals, layer-based artwork, and capture-ready video frames.",
    outcomeJa: "アニメーション、図解の表示、レイヤー作品、キャプチャ可能な動画フレームを確認します。",
    availability: "demo",
    steps: {
      en: [
        "Scrub the animation timeline.",
        "Inspect the artwork layers or infographic view.",
        "Compare landscape and vertical output profiles.",
        "Check whether a frame is ready for browser capture.",
      ],
      ja: [
        "アニメーションのタイムラインを操作します。",
        "レイヤー作品や図解の表示を確認します。",
        "横長と縦長の出力プロファイルを比較します。",
        "ブラウザーでキャプチャできるフレームか確認します。",
      ],
    },
    outputs: {
      en: ["Animated example frame", "Layer and infographic previews", "Capture-readiness result"],
      ja: ["アニメーションのサンプルフレーム", "レイヤーと図解のプレビュー", "キャプチャ準備の確認結果"],
    },
    consumes: ["Brand palette and typography", "Motion and camera controls", "Platform profiles"],
    produces: ["Animated example frame", "Infographic preview", "Capture-readiness result"],
  },
  "platform-composer": {
    id: "platform-composer",
    title: "Platform layouts",
    titleJa: "プラットフォーム配信",
    outcome: "Plan per-platform layouts, check approximate reserved UI regions, and export a local JSON plan. No video is rendered or posted.",
    outcomeJa: "配信先ごとのレイアウトとセーフエリアを計画し、JSON として保存します。動画生成や投稿は行いません。",
    availability: "live",
    steps: {
      en: [
        "Choose the destination platform and format.",
        "Adapt the layout to safe areas and captions.",
        "Compare landscape and vertical variants.",
        "Review the delivery checklist before export.",
      ],
      ja: [
        "配信先のプラットフォームと形式を選びます。",
        "セーフエリアと字幕に合わせてレイアウトを調整します。",
        "横長と縦長のバリエーションを比較します。",
        "書き出し前に配信チェックリストを確認します。",
      ],
    },
    outputs: {
      en: ["Platform-specific plan", "Reserved-area checks", "Local JSON export"],
      ja: ["プラットフォーム別レイアウト", "セーフエリアの確認", "ローカル JSON 出力"],
    },
    consumes: ["Approved concept", "Platform dimensions and safe areas", "Caption policy"],
    produces: ["Platform-specific layouts", "Safe-area report", "Delivery variants"],
  },
};

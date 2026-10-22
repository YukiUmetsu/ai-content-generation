import type {
  ConceptId,
  Locale,
  PaletteId,
  ThumbnailIssueCode,
  ThumbnailIssueCopy,
} from "./model/types";

export interface ComposerCopy {
  title: string;
  subtitle: string;
  topicLabel: string;
  topicHint: string;
  promiseLabel: string;
  promiseHint: string;
  conceptHeading: string;
  conceptHint: string;
  conceptGroupLabel: string;
  copyHeading: string;
  copyHint: string;
  headlineLabel: string;
  headlineHint: string;
  valueLabel: string;
  valueHint: string;
  secondaryLabel: string;
  secondaryHint: string;
  compareLabel: string;
  compareHint: string;
  compareRequired: string;
  paletteHeading: string;
  paletteHint: string;
  paletteGroupLabel: string;
  paletteNames: Record<PaletteId, string>;
  previewHeading: string;
  previewHint: string;
  readabilityHeading: string;
  readabilityHint: string;
  sizeAt: (width: number) => string;
  scaledAt: (percent: number) => string;
  checksHeading: string;
  checksPass: string;
  checksPassShort: string;
  checksWarnings: (count: number) => string;
  checksBlocked: (count: number) => string;
  checksEmpty: string;
  exportHeading: string;
  exportHint: string;
  exportSvg: string;
  exportPng: string;
  exporting: string;
  exportSize: (width: number, height: number) => string;
  exportSuccessSvg: string;
  exportSuccessPng: string;
  exportErrorTitle: string;
  exportErrorHint: string;
  provenanceHeading: string;
  provenanceSynthetic: string;
  provenanceNote: string;
  provenanceSources: string;
  brandLabel: string;
  revisionLabel: (revision: number) => string;
  safeInsetLabel: (percent: number) => string;
  detailsSummary: string;
  resetAction: string;
  resetHint: string;
  localOnlyNote: string;
  charCount: (count: number, max: number) => string;
  stageLabel: (conceptName: string) => string;
  conceptNames: Record<ConceptId, string>;
  conceptDescriptions: Record<ConceptId, string>;
  conceptQuestions: Record<ConceptId, string>;
  compositionNames: Record<ConceptId, string>;
  kickers: Record<ConceptId, string>;
  footnotes: Record<ConceptId, string>;
  partLabels: [string, string, string, string];
  panelLeftLabel: string;
  panelRightLabel: string;
  comparisonWord: string;
  issueCopy: Record<ThumbnailIssueCode, ThumbnailIssueCopy>;
  severityWarning: string;
  severityError: string;
}

export const COMPOSER_COPY: Record<Locale, ComposerCopy> = {
  en: {
    title: "Thumbnail composer",
    subtitle:
      "Turn the viewer promise into one readable proposition: a subject, a figure and no more than a few words.",
    topicLabel: "Video topic",
    topicHint: "The working title this thumbnail must support.",
    promiseLabel: "Viewer promise",
    promiseHint: "What the viewer should understand after two seconds.",
    conceptHeading: "Concept",
    conceptHint:
      "Three different information structures, not three colour variations. Each keeps its own edits.",
    conceptGroupLabel: "Thumbnail concept",
    copyHeading: "Copy and figure",
    copyHint: "Short, concrete and complementary to the title. Figures are synthetic demo values.",
    headlineLabel: "Headline",
    headlineHint: "One short line. The title already carries the context.",
    valueLabel: "Key figure",
    valueHint: "A single legible number, ideally under eight characters.",
    secondaryLabel: "Secondary line",
    secondaryHint: "Optional context. Keep it under one short sentence.",
    compareLabel: "Comparison figure",
    compareHint: "The advertised or equipment-only price shown on the left.",
    compareRequired: "This concept needs a comparison figure before export.",
    paletteHeading: "Palette",
    paletteHint: "A bounded set of semantic roles. The accent is reserved for one idea.",
    paletteGroupLabel: "Colour palette",
    paletteNames: { blueprint: "Blueprint", ledger: "Ledger", signal: "Signal" },
    previewHeading: "Your concept",
    previewHint: "The shared preview panel shows this same artwork while you edit.",
    readabilityHeading: "Readability check",
    readabilityHint:
      "Rendered at the two sizes YouTube actually shows. Text that survives here survives the feed.",
    sizeAt: (width) => `${width}×${Math.round((width * 9) / 16)}`,
    scaledAt: (percent) => `shown at ${percent}% to fit`,
    checksHeading: "Checks",
    checksPass: "No geometry or copy issues at this revision.",
    checksPassShort: "Checks pass",
    checksWarnings: (count) => `${count} advisory ${count === 1 ? "warning" : "warnings"}`,
    checksBlocked: (count) => `${count} ${count === 1 ? "issue needs" : "issues need"} attention`,
    checksEmpty: "No diagnostics.",
    exportHeading: "Export",
    exportHint: "The SVG is the editable deliverable; the PNG is the upload-ready still.",
    exportSvg: "Download SVG",
    exportPng: "Download PNG",
    exporting: "Rendering…",
    exportSize: (width, height) => `${width} × ${height} px`,
    exportSuccessSvg: "SVG downloaded at 1280 × 720.",
    exportSuccessPng: "PNG downloaded at 1280 × 720.",
    exportErrorTitle: "PNG rendering is unavailable",
    exportErrorHint:
      "This environment cannot rasterise the artwork. The SVG export is unaffected and can be converted locally.",
    provenanceHeading: "Provenance",
    provenanceSynthetic: "Synthetic demonstration values",
    provenanceNote: "The HVAC figures are invented for the fixture. They are not a quote, an average or a claim.",
    provenanceSources: "References",
    brandLabel: "Brand style",
    revisionLabel: (revision) => `Revision ${revision}`,
    safeInsetLabel: (percent) => `${percent}% safe margin`,
    detailsSummary: "Element map and document details",
    resetAction: "Restore example copy",
    resetHint: "Restores this concept's fixture text in both languages.",
    localOnlyNote: "Runs locally. No backend, no AI service and no upload.",
    charCount: (count, max) => `${count}/${max}`,
    stageLabel: (conceptName) => `Thumbnail preview: ${conceptName}`,
    conceptNames: {
      "price-shock": "Price shock",
      "hidden-cost": "Hidden complexity",
      "quote-gap": "Price vs. quote",
    },
    conceptDescriptions: {
      "price-shock": "One dominant unit beside one large unresolved figure.",
      "hidden-cost": "The equipment pulled apart into the layers a quote bundles.",
      "quote-gap": "The advertised equipment price next to the installed total.",
    },
    conceptQuestions: {
      "price-shock": "Why does it cost that much?",
      "hidden-cost": "What am I paying for?",
      "quote-gap": "What is not in the price?",
    },
    compositionNames: {
      "price-shock": "Number reversal",
      "hidden-cost": "Exploded cutaway",
      "quote-gap": "A vs. B comparison",
    },
    kickers: {
      "price-shock": "HVAC REPLACEMENT",
      "hidden-cost": "WHERE THE MONEY GOES",
      "quote-gap": "EQUIPMENT VS. INSTALLED",
    },
    footnotes: {
      "price-shock": "Illustrative values. Not a real quote.",
      "hidden-cost": "Illustrative breakdown. Not a real quote.",
      "quote-gap": "Illustrative values. Not a real quote.",
    },
    partLabels: ["Equipment", "Labour", "Ductwork", "Permits"],
    panelLeftLabel: "Advertised equipment",
    panelRightLabel: "Typical installed",
    comparisonWord: "vs.",
    severityWarning: "Warning",
    severityError: "Error",
    issueCopy: {
      "headline-too-long": {
        title: "Headline wraps past three lines",
        hint: "Cut words rather than shrinking the type further.",
      },
      "value-too-long": {
        title: "Key figure is too long to stay salient",
        hint: "Use one number, under eight characters where possible.",
      },
      "secondary-too-long": {
        title: "Secondary line is dense",
        hint: "Move the detail into the video title or the first frame.",
      },
      "headline-empty": {
        title: "Headline is empty",
        hint: "Add one short line, or restore the example copy.",
      },
      "value-empty": {
        title: "Key figure is empty",
        hint: "The composition needs one dominant figure.",
      },
      "compare-empty": {
        title: "Comparison figure is empty",
        hint: "Add the advertised or equipment-only price so both halves of the comparison stay honest.",
      },
      "safe-margin": {
        title: "Content crosses the safe margin",
        hint: "Pull the layer inside the 5% inset so platform UI cannot crop it.",
      },
      "small-size-legibility": {
        title: "Type is small at feed size",
        hint: "Raise the size or shorten the line until it reads at 160 px wide.",
      },
      "low-contrast": {
        title: "Contrast is below the readable threshold",
        hint: "Change palette or move the text onto the surface role.",
      },
      "text-overlap": {
        title: "Text boxes collide",
        hint: "Shorten one line; the composition never overlaps essential text.",
      },
      "composition-failed": {
        title: "This composition could not be rendered",
        hint: "Restore the example copy or re-import the document. Export stays blocked until it renders.",
      },
    },
  },
  ja: {
    title: "サムネイル作成",
    subtitle:
      "視聴者への約束を、ひとつの読み取れる提案にします。被写体、数字、そして短い言葉だけ。",
    topicLabel: "動画のトピック",
    topicHint: "このサムネイルが支える作業タイトル。",
    promiseLabel: "視聴者への約束",
    promiseHint: "2秒見たあとに理解してほしいこと。",
    conceptHeading: "コンセプト",
    conceptHint: "色違いではなく、情報構造が異なる3案です。編集内容は案ごとに保持されます。",
    conceptGroupLabel: "サムネイルのコンセプト",
    copyHeading: "コピーと数字",
    copyHint: "短く具体的に。タイトルを補い、繰り返さない。数字はデモ用の概算値です。",
    headlineLabel: "見出し",
    headlineHint: "短い1行。文脈はタイトルが担います。",
    valueLabel: "主要な数字",
    valueHint: "読み取れる数字をひとつ。8文字以内が目安です。",
    secondaryLabel: "補足の1行",
    secondaryHint: "任意の補足。短い一文までに。",
    compareLabel: "比較用の数字",
    compareHint: "左側に置く、広告上の機器価格。",
    compareRequired: "このコンセプトでは、書き出し前に比較用の数字が必要です。",
    paletteHeading: "配色",
    paletteHint: "意味を持つ役割だけに絞った配色。アクセントはひとつの主張に使います。",
    paletteGroupLabel: "カラーパレット",
    paletteNames: { blueprint: "ブループリント", ledger: "レジャー", signal: "シグナル" },
    previewHeading: "コンセプト",
    previewHint: "編集中も、共有プレビューには同じ作品が表示されます。",
    readabilityHeading: "可読性チェック",
    readabilityHint: "YouTube が実際に表示する2つのサイズで確認します。ここで読めればフィードでも読めます。",
    sizeAt: (width) => `${width}×${Math.round((width * 9) / 16)}`,
    scaledAt: (percent) => `収まるよう ${percent}% で表示`,
    checksHeading: "チェック",
    checksPass: "このリビジョンに、形状・文面の指摘はありません。",
    checksPassShort: "チェック済み",
    checksWarnings: (count) => `注意 ${count} 件`,
    checksBlocked: (count) => `対応が必要な項目 ${count} 件`,
    checksEmpty: "診断はありません。",
    exportHeading: "書き出し",
    exportHint: "SVG は編集可能な成果物、PNG はそのままアップロードできる静止画です。",
    exportSvg: "SVG をダウンロード",
    exportPng: "PNG をダウンロード",
    exporting: "書き出し中…",
    exportSize: (width, height) => `${width} × ${height} px`,
    exportSuccessSvg: "SVG を 1280 × 720 で書き出しました。",
    exportSuccessPng: "PNG を 1280 × 720 で書き出しました。",
    exportErrorTitle: "PNG を書き出せません",
    exportErrorHint:
      "この環境では画像のラスタライズができません。SVG の書き出しは可能なので、ローカルで変換してください。",
    provenanceHeading: "出典と前提",
    provenanceSynthetic: "デモ用の概算値",
    provenanceNote: "空調の金額はフィクスチャ用に作成した架空の値です。実際の見積もり・平均・主張ではありません。",
    provenanceSources: "参照",
    brandLabel: "ブランドスタイル",
    revisionLabel: (revision) => `リビジョン ${revision}`,
    safeInsetLabel: (percent) => `安全余白 ${percent}%`,
    detailsSummary: "要素マップとドキュメント詳細",
    resetAction: "サンプル文面に戻す",
    resetHint: "このコンセプトの文面を両言語で初期値に戻します。",
    localOnlyNote: "ローカルで動作します。バックエンドも AI サービスもアップロードもありません。",
    charCount: (count, max) => `${count}/${max}`,
    stageLabel: (conceptName) => `サムネイルのプレビュー: ${conceptName}`,
    conceptNames: {
      "price-shock": "価格のギャップ",
      "hidden-cost": "見えない内訳",
      "quote-gap": "本体価格と設置費用",
    },
    conceptDescriptions: {
      "price-shock": "室外機を大きくひとつ、そして未解決の金額をひとつ。",
      "hidden-cost": "室外機を分解し、見積もりが束ねている層を見せる。",
      "quote-gap": "広告価格と設置費用を並べる。",
    },
    conceptQuestions: {
      "price-shock": "なぜ交換にそれだけかかるのか？",
      "hidden-cost": "何にいくら払っているのか？",
      "quote-gap": "広告価格に含まれないものは？",
    },
    compositionNames: {
      "price-shock": "数字の反転",
      "hidden-cost": "分解図",
      "quote-gap": "A 対 B",
    },
    kickers: {
      "price-shock": "空調の入れ替え",
      "hidden-cost": "内訳を見る",
      "quote-gap": "機器価格と設置費用",
    },
    footnotes: {
      "price-shock": "掲載値はすべて架空の例です。",
      "hidden-cost": "内訳は架空の例です。",
      "quote-gap": "掲載値はすべて架空の例です。",
    },
    partLabels: ["機器", "人件費", "ダクト工事", "許認可"],
    panelLeftLabel: "広告上の機器価格",
    panelRightLabel: "設置込みの費用",
    comparisonWord: "対",
    severityWarning: "警告",
    severityError: "エラー",
    issueCopy: {
      "headline-too-long": {
        title: "見出しが3行を超えます",
        hint: "文字を削るか、短い言い回しに置き換えてください。",
      },
      "value-too-long": {
        title: "主要な数字が長すぎます",
        hint: "数字をひとつ、8文字以内に収めてください。",
      },
      "secondary-too-long": {
        title: "補足の1行が詰まりすぎています",
        hint: "詳細はタイトルか冒頭のカットに移してください。",
      },
      "headline-empty": {
        title: "見出しが空です",
        hint: "短い1行を入れるか、サンプル文面に戻してください。",
      },
      "value-empty": {
        title: "主要な数字が空です",
        hint: "構図には主役となる数字がひとつ必要です。",
      },
      "compare-empty": {
        title: "比較用の数字が空です",
        hint: "広告上の機器価格を入れてください。比較の両側が正確になります。",
      },
      "safe-margin": {
        title: "安全余白を越えています",
        hint: "5% の内側に戻してください。プラットフォームの UI で切れます。",
      },
      "small-size-legibility": {
        title: "フィードサイズで文字が小さい",
        hint: "文字を大きくするか、行を短くしてください。",
      },
      "low-contrast": {
        title: "コントラストが不足しています",
        hint: "配色を変えるか、 surface の上に文字を置いてください。",
      },
      "text-overlap": {
        title: "テキスト同士が重なっています",
        hint: "どちらかを短くしてください。必須テキストは重ねません。",
      },
      "composition-failed": {
        title: "この構図を描画できませんでした",
        hint: "サンプル文面に戻すか、ドキュメントを再読み込みしてください。描画できるまで書き出しは止まります。",
      },
    },
  },
};

export function copyFor(locale: Locale): ComposerCopy {
  return COMPOSER_COPY[locale] ?? COMPOSER_COPY.en;
}

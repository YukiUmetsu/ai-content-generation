import type {
  ClaimStatus,
  Locale,
  NarrativeRole,
  SemanticStoryboard,
  VisualIntent,
} from "./model/types";
import type { ImportIssue } from "./model/serialize";
import type { StoryboardDiagnostic } from "./model/validate";

const en = {
  plannerEyebrow: "Storyboard planner",
  exampleNotice: "Synthetic HVAC explainer · illustrative figures",
  runtime: "Runtime",
  beats: "Beats",
  checks: "Checks",
  fps: (fps: string) => `${fps} fps`,
  addBeat: "Add beat",
  resetExample: "Reset example",
  resetConfirm: "Confirm reset",
  importButton: "Import",
  exportButton: "Export",
  beatListLabel: "Storyboard beats",
  beatsHeading: "Narrative beats",
  sceneHeading: "Scene editor",
  checksHeading: "Checks",
  planningPreview: "Planning preview",
  previewNotFinal: "Planning preview — not a rendered animation",
  previewAlt: (title: string) => `Planning preview for ${title}`,
  illustrativeNote: "Illustrative figures, not market data.",
  noBeats: "No beats yet. Add a beat to start planning.",
  emptyPreview: "Select a beat to preview its visual intent.",
  narrativeSection: "Narrative",
  roleLabel: "Narrative role",
  objectiveLabel: "Learning objective",
  narrationLabel: "Narration",
  narrationHint: "Advisory estimate only — not audio alignment.",
  rateWords: "~150 words/min",
  rateChars: "~330 characters/min",
  narrationFits: (units: string, rate: string, estimated: string, allotted: string) =>
    `${units} at ${rate} → about ${estimated}; ${allotted} allotted.`,
  narrationTight: (units: string, rate: string, estimated: string, allotted: string) =>
    `${units} at ${rate} → about ${estimated}; tight against ${allotted}.`,
  narrationOver: (units: string, rate: string, estimated: string, allotted: string) =>
    `${units} at ${rate} → about ${estimated}; ${allotted} allotted. Shorten or extend the beat.`,
  visualSection: "Visual plan",
  visualIntentLabel: "Visual intent",
  visualObjectiveLabel: "Visual objective",
  teachingStateLabel: "Visible teaching change",
  teachingStateHint:
    "Review each label against your captured sources. These are editorial directions, not verified facts.",
  teachingStateBefore: "Before (initial state)",
  teachingStateAction: "Action (visible operation)",
  teachingStateAfter: "After (learned result)",
  mechanicLabel: "Semantic animation (2D)",
  mechanicHint: "A source-linked operation, not a final render. Edit actor nouns and roles; unsupported combinations block export. Operand order matters for transfer and reveal.",
  mechanicOperator: "Visual operation",
  mechanicActor: "Visible actor",
  mechanicRole: "Actor role",
  mechanicClaims: "Source claims for this actor",
  mechanicOperands: "Participating actors (ordered by selection)",
  mechanicOutcome: "Outcome actor",
  diagMechanicInvalid: (index:number,code:string)=>`Beat ${index} semantic animation is not renderable (${code}). Verify subject, source claims, actor roles and operand order.`,
  diagMechanicDiverged: (index:number)=>`Beat ${index} uses a different operation or actor set from another phase of the same teaching sequence.`,
  objectsLabel: "Semantic objects",
  objectsHint: "Stable IDs let a later scene preserve identity across cuts.",
  focusLabel: "Focus target",
  noneOption: "None",
  cameraLabel: "Camera / focus intent",
  cameraHint: "Optional. Only kept in the authoring document; Kumiki storyboard shots have no camera field.",
  eventsLabel: "Semantic events",
  copySection: "Copy and evidence",
  onScreenTextLabel: "On-screen text",
  characters: (count: number, max: number) => `${count} / ${max} characters`,
  claimsLabel: "Claim references",
  cueLabel: "Narration cue ID",
  cueHint: "Optional. The compiled projection anchors this cue at the beat start.",
  structureSection: "Structure and timing",
  opensLabel: "Opens question",
  answersLabel: "Answers question",
  durationLabel: "Duration (frames)",
  durationHint: "Integer frames at this storyboard's rational FPS. Starts update automatically.",
  frames: (frames: number) => `${frames} frames`,
  invalidDurationShort: "Enter a positive integer frame count.",
  staticFallbackLabel: "Static fallback",
  staticFallbackHint: "What a reduced-motion or still viewer should see.",
  deleteBeat: (index: number) => `Delete beat ${index}`,
  moveUp: (index: number) => `Move beat ${index} earlier`,
  moveDown: (index: number) => `Move beat ${index} later`,
  selectBeat: (index: number, label: string) => `Select beat ${index}: ${label}`,
  relatedIssues: "Issues in this beat",
  errorsCount: (count: number) => `${count} blocking ${count === 1 ? "issue" : "issues"}`,
  warningsCount: (count: number) => `${count} advisory ${count === 1 ? "warning" : "warnings"}`,
  noIssues: "No structural or narrative issues found.",
  advisoryNote: "Warnings are deterministic checks, not a quality score.",
  errorSeverity: "Error",
  warningSeverity: "Warning",
  dialogTitle: "Export / import storyboard",
  exportTab: "Export",
  importTab: "Import",
  formatSemantic: "Semantic storyboard JSON",
  formatKumiki: "Kumiki storyboard projection",
  projectionNote:
    "The projection uses Kumiki's implemented storyboard contract. Camera intent, claims and events remain authoring metadata.",
  projectionIssues: (count: number) => `${count} projection diagnostics`,
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  download: "Download",
  importPlaceholder: "Paste a contentgen-semantic-storyboard JSON document…",
  importFileLabel: "Choose file",
  importAction: "Import storyboard",
  close: "Close",
  importErrors: "Import failed. Nothing was changed.",
  roles: {
    hook: "Hook",
    setup: "Setup",
    explanation: "Explanation",
    evidence: "Evidence",
    reveal: "Reveal",
    takeaway: "Takeaway",
  } satisfies Record<NarrativeRole, string>,
  intents: {
    question: "Question",
    "cost-accumulation": "Cost accumulation",
    comparison: "Comparison",
    explanation: "Explanation",
    evidence: "Evidence reveal",
    takeaway: "Takeaway",
  } satisfies Record<VisualIntent, string>,
  statuses: {
    illustrative: "Illustrative",
    sourced: "Sourced",
    assumption: "Assumption",
    unverified: "Unverified",
  } satisfies Record<ClaimStatus, string>,
  diagNoBeats: "Add at least one beat; an empty storyboard cannot be planned.",
  diagInvalidFps: "The frame rate must be a positive rational number.",
  diagDuplicate: (id: string) => `Beat ID "${id}" is duplicated. IDs must be unique.`,
  diagBeatIdMissing: (index: number) => `Beat ${index} needs a stable ID.`,
  diagInvalidDuration: (index: number, value: string) =>
    `Beat ${index} has an invalid duration (${value}); use a positive integer frame count.`,
  diagNoHook: "The storyboard does not open with a hook beat.",
  diagNarrationMissing: (index: number) => `Beat ${index} has no narration.`,
  diagObjectiveMissing: (index: number) => `Beat ${index} has no learning objective.`,
  diagVisualObjectiveMissing: (index: number) => `Beat ${index} has no visual objective.`,
  diagOnScreenMissing: (index: number) => `Beat ${index} has no on-screen text.`,
  diagOnScreenLong: (index: number, count: number, max: number) =>
    `Beat ${index} on-screen text is ${count} characters; keep it under ${max}.`,
  diagFocusMissing: (index: number) =>
    `Beat ${index} has no focus target; the viewer has nothing specific to follow.`,
  diagCameraWithoutFocus: (index: number) =>
    `Beat ${index} describes camera movement but no focus target.`,
  diagFallbackMissing: (index: number) => `Beat ${index} has no static fallback description.`,
  diagObjectUnknown: (index: number, objectId: string) =>
    `Beat ${index} references unknown semantic object "${objectId}".`,
  diagClaimUnknown: (index: number, claimId: string) =>
    `Beat ${index} references unknown claim "${claimId}".`,
  diagClaimUnresolved: (index: number, claimId: string, status: string) =>
    `Beat ${index} claim "${claimId}" is ${status} without a resolved source.`,
  diagEventWithoutObject: (index: number, eventId: string, objectId?: string) =>
    objectId
      ? `Beat ${index} event "${eventId}" changes "${objectId}", which the beat does not reference.`
      : `Beat ${index} references unknown semantic event "${eventId}".`,
  diagOpensUnknown: (index: number, questionId: string) =>
    `Beat ${index} opens unknown question "${questionId}".`,
  diagAnswersUnknown: (index: number, questionId: string) =>
    `Beat ${index} answers unknown question "${questionId}".`,
  diagQuestionUnanswered: (text: string) => `The opening question is never answered: “${text}”`,
  diagNarrationOver: (index: number, estimate: string, allotted: string) =>
    `Beat ${index} narration is estimated at ${estimate}, longer than the ${allotted} allotted.`,
  diagIllustrativeUnlabeled:
    "Illustrative claims are present but the storyboard is not marked as illustrative data.",
  diagTeachingStateInvalid: (index: number) =>
    `Beat ${index} has an incomplete teaching change or references a subject missing from its semantic objects. Fill in Before, Action and After, and select the correct subject.`,
  diagTeachingStateDiverged: (index: number) =>
    `Beat ${index} disagrees with another beat in the same teaching sequence. Review and synchronize the Before, Action and After labels.`,
  importInvalidJson: "The text is not valid JSON.",
  importInvalidRoot: "The document root must be an object.",
  importSchemaVersion: "Unsupported schemaVersion; expected 1.",
  importKind: "Unsupported document kind; expected contentgen-semantic-storyboard.",
  importMissing: (path: string) => `Missing or invalid field: ${path}.`,
  importInvalidField: (path: string) => `Invalid value: ${path}.`,
  importBeatsEmpty: "A storyboard must contain at least one beat.",
  importDuplicate: (path: string) => `Duplicate beat ID at ${path}.`,
} as const;

const ja = {
  plannerEyebrow: "ストーリーボード",
  exampleNotice: "合成 HVAC 解説 · 数値は例示用",
  runtime: "再生時間",
  beats: "ビート",
  checks: "チェック",
  fps: (fps: string) => `${fps} fps`,
  addBeat: "ビートを追加",
  resetExample: "例をリセット",
  resetConfirm: "リセットを確定",
  importButton: "読み込み",
  exportButton: "書き出し",
  beatListLabel: "ストーリーボードのビート",
  beatsHeading: "ナラティブ・ビート",
  sceneHeading: "シーン編集",
  checksHeading: "チェック",
  planningPreview: "制作プレビュー",
  previewNotFinal: "制作プレビュー — 完成アニメーションではありません",
  previewAlt: (title: string) => `${title} の制作プレビュー`,
  illustrativeNote: "数値は例示用で、市場データではありません。",
  noBeats: "ビートがありません。追加して計画を始めてください。",
  emptyPreview: "ビートを選ぶと、その視覚意図をプレビューできます。",
  narrativeSection: "ナラティブ",
  roleLabel: "ナラティブの役割",
  objectiveLabel: "学習目標",
  narrationLabel: "ナレーション",
  narrationHint: "目安の推定です。音声同期の結果ではありません。",
  rateWords: "約150語/分",
  rateChars: "約330文字/分",
  narrationFits: (units: string, rate: string, estimated: string, allotted: string) =>
    `${units}・${rate}で約${estimated}。割当は${allotted}です。`,
  narrationTight: (units: string, rate: string, estimated: string, allotted: string) =>
    `${units}・${rate}で約${estimated}。割当${allotted}には余裕がありません。`,
  narrationOver: (units: string, rate: string, estimated: string, allotted: string) =>
    `${units}・${rate}で約${estimated}。割当は${allotted}です。短縮するかビートを延ばしてください。`,
  visualSection: "視覚プラン",
  visualIntentLabel: "視覚意図",
  visualObjectiveLabel: "視覚目標",
  teachingStateLabel: "視覚的に説明する変化",
  teachingStateHint: "各ラベルを収集した資料と照合してください。編集上の指示であり、検証済みの事実ではありません。",
  teachingStateBefore: "変化前（初期状態）",
  teachingStateAction: "変化（画面上の操作）",
  teachingStateAfter: "変化後（学習した結果）",
  mechanicLabel: "意味のある2Dアニメーション",
  mechanicHint: "出典に関連づく編集用の演出指示です。完成映像ではありません。役割と対象を正しく指定してください。不整合があると書き出せません。移動と開示は選択順も重要です。",
  mechanicOperator: "視覚的な操作",
  mechanicActor: "表示オブジェクト",
  mechanicRole: "オブジェクトの役割",
  mechanicClaims: "オブジェクトの根拠となる主張",
  mechanicOperands: "操作するオブジェクト（選択順）",
  mechanicOutcome: "結果のオブジェクト",
  diagMechanicInvalid: (index:number,code:string)=>`ビート${index} のアニメーションは無効です（${code}）。対象、出典、役割、対象の順序を確認してください。`,
  diagMechanicDiverged: (index:number)=>`ビート${index} は同じ説明シーケンスの他の場面と操作やオブジェクトが一致しません。`,
  objectsLabel: "セマンティック・オブジェクト",
  objectsHint: "安定した ID により、後のシーンでもカットをまたいで同一性を保てます。",
  focusLabel: "フォーカス対象",
  noneOption: "なし",
  cameraLabel: "カメラ / フォーカス意図",
  cameraHint: "任意。制作ドキュメントにのみ保持されます。Kumiki のショットにはカメラ欄がありません。",
  eventsLabel: "セマンティック・イベント",
  copySection: "コピーと根拠",
  onScreenTextLabel: "画面テキスト",
  characters: (count: number, max: number) => `${count} / ${max} 文字`,
  claimsLabel: "クレーム参照",
  cueLabel: "ナレーション・キュー ID",
  cueHint: "任意。コンパイル時にビート先頭へアンカーされます。",
  structureSection: "構成とタイミング",
  opensLabel: "提示する問い",
  answersLabel: "答える問い",
  durationLabel: "長さ（フレーム）",
  durationHint: "この FPS における整数フレームです。開始位置は自動で更新されます。",
  frames: (frames: number) => `${frames} フレーム`,
  invalidDurationShort: "正の整数フレームを入力してください。",
  staticFallbackLabel: "静的フォールバック",
  staticFallbackHint: "動きを減らした場合や静止画で見せる内容です。",
  deleteBeat: (index: number) => `ビート ${index} を削除`,
  moveUp: (index: number) => `ビート ${index} を前へ移動`,
  moveDown: (index: number) => `ビート ${index} を後ろへ移動`,
  selectBeat: (index: number, label: string) => `ビート ${index} を選択: ${label}`,
  relatedIssues: "このビートの問題",
  errorsCount: (count: number) => `${count} 件の構造エラー`,
  warningsCount: (count: number) => `${count} 件の助言`,
  noIssues: "構造上・物語上の問題は見つかりません。",
  advisoryNote: "警告は決定的なチェック結果であり、品質スコアではありません。",
  errorSeverity: "エラー",
  warningSeverity: "警告",
  dialogTitle: "ストーリーボードの書き出し / 読み込み",
  exportTab: "書き出し",
  importTab: "読み込み",
  formatSemantic: "セマンティック・ストーリーボード JSON",
  formatKumiki: "Kumiki ストーリーボード投影",
  projectionNote:
    "投影は Kumiki の実装済みストーリーボード契約を使います。カメラ意図・クレーム・イベントは制作メタデータとして残ります。",
  projectionIssues: (count: number) => `投影の診断 ${count} 件`,
  copy: "コピー",
  copied: "コピーしました",
  copyFailed: "コピーできませんでした",
  download: "ダウンロード",
  importPlaceholder: "contentgen-semantic-storyboard の JSON を貼り付けてください…",
  importFileLabel: "ファイルを選択",
  importAction: "ストーリーボードを読み込む",
  close: "閉じる",
  importErrors: "読み込みに失敗しました。変更は適用されていません。",
  roles: {
    hook: "フック",
    setup: "セットアップ",
    explanation: "説明",
    evidence: "根拠",
    reveal: "開示",
    takeaway: "要点",
  } satisfies Record<NarrativeRole, string>,
  intents: {
    question: "問い",
    "cost-accumulation": "コストの積み上げ",
    comparison: "比較",
    explanation: "説明",
    evidence: "根拠の提示",
    takeaway: "要点",
  } satisfies Record<VisualIntent, string>,
  statuses: {
    illustrative: "例示用",
    sourced: "出典あり",
    assumption: "前提",
    unverified: "未検証",
  } satisfies Record<ClaimStatus, string>,
  diagNoBeats: "ビートを1つ以上追加してください。空のストーリーボードは計画できません。",
  diagInvalidFps: "フレームレートは正の有理数である必要があります。",
  diagDuplicate: (id: string) => `ビート ID「${id}」が重複しています。ID は一意である必要があります。`,
  diagBeatIdMissing: (index: number) => `ビート ${index} に安定した ID がありません。`,
  diagInvalidDuration: (index: number, value: string) =>
    `ビート ${index} の長さ（${value}）が不正です。正の整数フレームを指定してください。`,
  diagNoHook: "ストーリーボードがフックのビートから始まっていません。",
  diagNarrationMissing: (index: number) => `ビート ${index} にナレーションがありません。`,
  diagObjectiveMissing: (index: number) => `ビート ${index} に学習目標がありません。`,
  diagVisualObjectiveMissing: (index: number) => `ビート ${index} に視覚目標がありません。`,
  diagOnScreenMissing: (index: number) => `ビート ${index} に画面テキストがありません。`,
  diagOnScreenLong: (index: number, count: number, max: number) =>
    `ビート ${index} の画面テキストは ${count} 文字です。${max} 文字以内にしてください。`,
  diagFocusMissing: (index: number) =>
    `ビート ${index} にフォーカス対象がありません。視聴者が追う対象を決めてください。`,
  diagCameraWithoutFocus: (index: number) =>
    `ビート ${index} はカメラ移動を説明していますが、フォーカス対象がありません。`,
  diagFallbackMissing: (index: number) => `ビート ${index} に静的フォールバックの説明がありません。`,
  diagObjectUnknown: (index: number, objectId: string) =>
    `ビート ${index} が未知のセマンティック・オブジェクト「${objectId}」を参照しています。`,
  diagClaimUnknown: (index: number, claimId: string) =>
    `ビート ${index} が未知のクレーム「${claimId}」を参照しています。`,
  diagClaimUnresolved: (index: number, claimId: string, status: string) =>
    `ビート ${index} のクレーム「${claimId}」は「${status}」ですが、根拠が解決されていません。`,
  diagEventWithoutObject: (index: number, eventId: string, objectId?: string) =>
    objectId
      ? `ビート ${index} のイベント「${eventId}」は「${objectId}」を変化させますが、そのオブジェクトを参照していません。`
      : `ビート ${index} が未知のセマンティック・イベント「${eventId}」を参照しています。`,
  diagOpensUnknown: (index: number, questionId: string) =>
    `ビート ${index} が未知の問い「${questionId}」を提示しています。`,
  diagAnswersUnknown: (index: number, questionId: string) =>
    `ビート ${index} が未知の問い「${questionId}」に答えています。`,
  diagQuestionUnanswered: (text: string) => `提示した問いが回収されていません:「${text}」`,
  diagNarrationOver: (index: number, estimate: string, allotted: string) =>
    `ビート ${index} のナレーションは約${estimate}と推定され、割当${allotted}を超えています。`,
  diagIllustrativeUnlabeled:
    "例示用のクレームがありますが、ストーリーボードが例示データとして明示されていません。",
  diagTeachingStateInvalid: (index: number) =>
    `ビート ${index} の説明する変化が不完全か、対象がセマンティック・オブジェクトに含まれていません。変化前・変化・変化後と対象を確認してください。`,
  diagTeachingStateDiverged: (index: number) =>
    `ビート ${index} の説明内容が同じシーケンス内の別のビートと一致しません。変化前・変化・変化後のラベルを揃えてください。`,
  importInvalidJson: "有効な JSON ではありません。",
  importInvalidRoot: "ドキュメントのルートはオブジェクトである必要があります。",
  importSchemaVersion: "未対応の schemaVersion です。1 を想定しています。",
  importKind: "未対応のドキュメント種別です。contentgen-semantic-storyboard を想定しています。",
  importMissing: (path: string) => `必須フィールドがないか不正です: ${path}。`,
  importInvalidField: (path: string) => `値が不正です: ${path}。`,
  importBeatsEmpty: "ストーリーボードには1つ以上のビートが必要です。",
  importDuplicate: (path: string) => `${path} のビート ID が重複しています。`,
} as const;

export const UI_COPY = { en, ja };

export function copy(locale: Locale) {
  return UI_COPY[locale];
}

function beatIndex(board: SemanticStoryboard, beatId: string | undefined): number {
  if (!beatId) return 0;
  return board.beats.findIndex((beat) => beat.id === beatId) + 1;
}

export function describeDiagnostic(
  diagnostic: StoryboardDiagnostic,
  locale: Locale,
  board: SemanticStoryboard
): string {
  const t = copy(locale);
  const index = beatIndex(board, diagnostic.beatId);
  const params = diagnostic.params ?? {};
  const value = (key: string) => String(params[key] ?? "");
  switch (diagnostic.code) {
    case "storyboard-no-beats":
      return t.diagNoBeats;
    case "storyboard-invalid-fps":
      return t.diagInvalidFps;
    case "storyboard-duplicate-beat-id":
      return t.diagDuplicate(value("id"));
    case "storyboard-beat-id-missing":
      return t.diagBeatIdMissing(index);
    case "storyboard-invalid-duration":
      return t.diagInvalidDuration(index, value("value"));
    case "storyboard-no-opening-hook":
      return t.diagNoHook;
    case "storyboard-narration-missing":
      return t.diagNarrationMissing(index);
    case "storyboard-objective-missing":
      return t.diagObjectiveMissing(index);
    case "storyboard-visual-objective-missing":
      return t.diagVisualObjectiveMissing(index);
    case "storyboard-on-screen-text-missing":
      return t.diagOnScreenMissing(index);
    case "storyboard-on-screen-text-long":
      return t.diagOnScreenLong(index, Number(params.count ?? 0), Number(params.max ?? 0));
    case "storyboard-focus-missing":
      return t.diagFocusMissing(index);
    case "storyboard-camera-without-focus":
      return t.diagCameraWithoutFocus(index);
    case "storyboard-static-fallback-missing":
      return t.diagFallbackMissing(index);
    case "storyboard-object-unknown":
      return t.diagObjectUnknown(index, value("objectId"));
    case "storyboard-claim-unknown":
      return t.diagClaimUnknown(index, value("claimId"));
    case "storyboard-claim-unresolved":
      return t.diagClaimUnresolved(index, value("claimId"), value("status"));
    case "storyboard-event-without-object":
      return t.diagEventWithoutObject(index, value("eventId"), value("objectId") || undefined);
    case "storyboard-opens-question-unknown":
      return t.diagOpensUnknown(index, value("questionId"));
    case "storyboard-question-unknown":
      return t.diagAnswersUnknown(index, value("questionId"));
    case "storyboard-question-unanswered":
      return t.diagQuestionUnanswered(value("text"));
    case "storyboard-narration-over-budget":
      return t.diagNarrationOver(index, value("estimate"), value("allotted"));
    case "storyboard-illustrative-unlabeled":
      return t.diagIllustrativeUnlabeled;
    case "storyboard-teaching-state-invalid":
      return t.diagTeachingStateInvalid(index);
    case "storyboard-teaching-state-diverged":
      return t.diagTeachingStateDiverged(index);
    case "storyboard-mechanic-diverged":
      return t.diagMechanicDiverged(index);
    default:
      return diagnostic.code.startsWith("storyboard-mechanic-")
        ?t.diagMechanicInvalid(index,diagnostic.code.replace("storyboard-",""))
        :diagnostic.code;
  }
}

export function describeImportIssue(issue: ImportIssue, locale: Locale): string {
  const t = copy(locale);
  switch (issue.code) {
    case "invalid-json":
      return t.importInvalidJson;
    case "invalid-root":
      return t.importInvalidRoot;
    case "schema-version":
      return t.importSchemaVersion;
    case "kind":
      return t.importKind;
    case "missing-field":
      return t.importMissing(issue.path);
    case "invalid-field":
      return t.importInvalidField(issue.path);
    case "beats-empty":
      return t.importBeatsEmpty;
    case "duplicate-beat-id":
      return t.importDuplicate(issue.path);
  }
}

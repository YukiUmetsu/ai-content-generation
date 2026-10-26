import { useState } from "react";
import { Download, Layers3, RotateCcw, SlidersHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { CharacterPoseCorrectionTracks } from "@/components/character/definition";
import type { CharacterPackDefinition } from "./character-pack";
import { calibrateRigDefinition, initialRigPlacements } from "./rig-calibration";
import type { RigPlacementInput, RigPlacementInputs } from "./rig-calibration";
import type { Locale } from "@/features/registry";
import { CharacterRigCanvas } from "./CharacterRigCanvas";

const fields = [
  { field: "x", en: "X offset", ja: "X 位置", step: "1" },
  { field: "y", en: "Y offset", ja: "Y 位置", step: "1" },
  { field: "rotation", en: "Rotation (°)", ja: "回転 (°)", step: "1" },
  { field: "scaleX", en: "X scale", ja: "横倍率", step: "0.05" },
  { field: "scaleY", en: "Y scale", ja: "縦倍率", step: "0.05" },
  { field: "pivotX", en: "Pivot X", ja: "支点 X", step: "1" },
  { field: "pivotY", en: "Pivot Y", ja: "支点 Y", step: "1" },
] as const satisfies ReadonlyArray<{ field: keyof RigPlacementInput; en: string; ja: string; step: string }>;

const fieldGroups = [
  { title: "Position", titleJa: "位置", hint: "Relative to parent · px", hintJa: "親パーツからの位置 · px", names: ["x", "y"] },
  { title: "Rotation & size", titleJa: "回転とサイズ", hint: "Clockwise · relative scale", hintJa: "時計回り · 倍率", names: ["rotation", "scaleX", "scaleY"] },
  { title: "Joint anchor", titleJa: "関節の支点", hint: "Source artwork · px", hintJa: "元画像内の座標 · px", names: ["pivotX", "pivotY"] },
] as const;

const checkerStyle = {
  backgroundImage: "linear-gradient(45deg,#8882 25%,transparent 25%,transparent 75%,#8882 75%),linear-gradient(45deg,#8882 25%,transparent 25%,transparent 75%,#8882 75%)",
  backgroundSize: "18px 18px", backgroundPosition: "0 0,9px 9px",
};

/** Consumer authoring controls; the vendored Kumiki presenter/evaluator owns posing and rendering. */
export function RigCalibrationEditor({ definition, locale, spriteUrls }: {
  definition: CharacterPackDefinition; locale: Locale; spriteUrls?: ReadonlyMap<string, string>;
}) {
  const ja = locale === "ja";
  const [selectedId, setSelectedId] = useState(definition.parts[0]?.id ?? "");
  const [placements, setPlacements] = useState(() => initialRigPlacements(definition));
  const [revision, setRevision] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [corrections, setCorrections] = useState<CharacterPoseCorrectionTracks>({});
  const [undo, setUndo] = useState<Array<{ placements: RigPlacementInputs; corrections: CharacterPoseCorrectionTracks; revision: string }>>([]);
  const selectedPart = definition.parts.find(part => part.id === selectedId);
  const selectedAsset = selectedPart && definition.assets[selectedPart.asset];
  const selectedImage = selectedAsset ? spriteUrls?.get(selectedAsset.uri) : undefined;
  const placement = placements[selectedId];
  const initial = initialRigPlacements(definition);
  const adjustedIds = new Set(definition.parts.filter(part => fields.some(({ field }) => {
    const next = placements[part.id]?.[field] ?? "";
    const original = initial[part.id]?.[field] ?? "";
    return next !== original && (!next.trim() || !Number.isFinite(Number(next)) || Number(next) !== Number(original));
  })).map(part => part.id));
  const correctedCount = Object.values(corrections).filter(keys => keys.length).length;

  let candidate: CharacterPackDefinition | null = null;
  let reason = "";
  try { candidate = calibrateRigDefinition(definition, placements, revision); }
  catch (error) { reason = error instanceof Error ? error.message : "Invalid placement settings."; }

  const remember = () => setUndo(current => [...current.slice(-19), {
    placements: structuredClone(placements), corrections: structuredClone(corrections), revision,
  }]);
  const updateParts = (id: string, changes: Partial<RigPlacementInput>) => {
    setDownloadError("");
    setPlacements(current => ({ ...current, [id]: { ...current[id], ...changes } }));
  };
  const edit = (field: keyof RigPlacementInput, value: string) => {
    remember();
    setDownloadError("");
    setPlacements(current => ({ ...current, [selectedId]: { ...current[selectedId], [field]: value } }));
  };
  const reset = () => {
    remember();
    setPlacements(initialRigPlacements(definition));
    setCorrections({});
    setRevision("");
    setDownloadError("");
  };
  const undoLast = () => {
    const previous = undo.at(-1);
    if (!previous) return;
    setPlacements(previous.placements);
    setCorrections(previous.corrections);
    setRevision(previous.revision);
    setUndo(current => current.slice(0, -1));
    setDownloadError("");
  };
  const downloadJson = (name: string, payload: unknown) => {
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.download = name;
      link.href = url;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadError("");
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      setDownloadError(error instanceof Error ? error.message : "JSON download failed.");
    }
  };
  const downloadManifest = () => {
    if (!candidate) return;
    downloadJson("character.json", candidate);
  };

  return <Surface variant="outline" aria-label="Rig placement calibration">
    <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.15em] text-primary">{ja ? "ステップ 2 · 配置を調整" : "STEP 2 · CALIBRATE"}</p>
        <h3 className="flex items-center gap-2 font-serif text-xl font-semibold text-foreground"><SlidersHorizontal aria-hidden className="size-5 text-primary" />{ja ? "リグと動きの調整" : "Rig & motion editor"}</h3>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{ja
          ? "パーツを選び、動物の体格に合わせて位置や関節を調整します。人型の骨格は前提としません。"
          : "Drag any body part or joint—even an animal shoulder or tail root. Pause and correct an animation frame with smoothed transitions."}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs font-medium tabular-nums text-muted-foreground" role="status">
          {ja ? `${adjustedIds.size} 配置変更 · ${correctedCount} 動作補正` : `${adjustedIds.size} placed · ${correctedCount} corrected`}
        </span>
        <Button size="sm" variant="outline" icon={<Undo2 className="size-4" />} onClick={undoLast} disabled={!undo.length}>{ja ? "元に戻す" : "Undo"}</Button>
      </div>
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(12rem,14.5rem)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-xl border border-border bg-surface-subtle/60 p-2">
        <p className="px-2 pb-2 pt-1 text-xs font-semibold text-muted-foreground">{ja ? `パーツ一覧 · ${definition.parts.length}` : `PARTS · ${definition.parts.length}`}</p>
        <div className="max-h-[22rem] space-y-1 overflow-y-auto" aria-label={ja ? "リグパーツ一覧" : "Rig part list"}>
          {[...definition.parts].sort((a, b) => a.z - b.z).map(part => {
            const asset = definition.assets[part.asset];
            const image = asset ? spriteUrls?.get(asset.uri) : undefined;
            const adjusted = adjustedIds.has(part.id);
            return <button key={part.id} type="button" aria-pressed={part.id === selectedId}
              onClick={() => setSelectedId(part.id)}
              className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${part.id === selectedId ? "border-primary/40 bg-surface shadow-sm" : "border-transparent hover:border-border hover:bg-surface/80"}`}>
              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border/60 bg-surface" style={checkerStyle}>
                {image ? <img src={image} alt="" className="max-h-full max-w-full object-contain" /> : <Layers3 aria-hidden className="size-4 text-muted-foreground" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground" title={part.id}>{part.id}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{part.parent ? `↳ ${part.parent}` : (ja ? "基点" : "Root")} · z {part.z}</span>
              </span>
              {adjusted && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label={ja ? "変更あり" : "adjusted"} />}
            </button>;
          })}
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <CharacterRigCanvas definition={definition} locale={locale} selectedId={selectedId} onSelectPart={setSelectedId}
          placements={placements} spriteUrls={spriteUrls} corrections={corrections} onCorrections={setCorrections}
          onPlace={updateParts} onGestureStart={remember} />
        <div className="flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-border bg-surface-subtle/50 p-3">
          <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-border/60 bg-surface sm:size-32" style={checkerStyle}>
            {selectedImage && selectedPart ? <img src={selectedImage} alt={`${selectedPart.id} artwork (not composited)`} className="max-h-full max-w-full object-contain" /> : <Layers3 aria-hidden className="size-8 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{ja ? "選択中のパーツ" : "SELECTED PART"}</p>
            <p className="mt-1 break-words font-semibold text-foreground">{selectedPart?.id}</p>
            <p className="mt-1 text-xs text-muted-foreground">{selectedPart?.parent ? (ja ? `親: ${selectedPart.parent}` : `Parent: ${selectedPart.parent}`) : (ja ? "親: キャンバス" : "Parent: canvas")}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{selectedPart?.asset}{selectedAsset ? ` · ${selectedAsset.width} × ${selectedAsset.height} px` : ""}</p>
            <p className="mt-2 text-xs font-medium text-muted-foreground">{ja ? "単一画像の確認 · 合成プレビューではありません" : "Source artwork only · not a composed rig preview"}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {fieldGroups.map(group => <fieldset key={group.title} className="min-w-0 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-foreground">{ja ? group.titleJa : group.title}</legend>
            <p className="mb-3 text-[11px] text-muted-foreground">{ja ? group.hintJa : group.hint}</p>
            <div className="grid grid-cols-2 gap-2">
              {fields.filter(({ field }) => (group.names as readonly string[]).includes(field)).map(({ field, en, ja: jp, step }) => <label key={field} className="block min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-foreground">{ja ? jp : en}</span>
                <input type="number" aria-label={ja ? jp : en} step={step} value={placement?.[field] ?? ""}
                  onChange={event => edit(field, event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm tabular-nums text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
              </label>)}
            </div>
          </fieldset>)}
        </div>
      </div>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">{ja
      ? "X は右、Y は下へ移動。オリジナルZIPは変更されません。アニメーションの補正はプレビュー用で、動画書き出しにはまだ反映されません。"
      : "X moves right; Y moves down. Original ZIP stays intact. Pose corrections preview here but are not yet connected to final video rendering."}</p>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-subtle/40 p-4">
      <div className="w-full sm:flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-primary">{ja ? "ステップ 3 · 書き出し" : "STEP 3 · EXPORT"}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{ja ? "新しいリビジョンとして保存" : "Save as a new revision"}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ja ? "元のZIPは変わりません。新しいJSONと同じ画像を再ZIP化してください。" : "Your ZIP stays unchanged. Repackage the downloaded JSON with the same layers/."}</p>
      </div>
      <label className="min-w-36 flex-1 sm:max-w-52">
        <span className="mb-1.5 block text-xs font-medium text-foreground">{ja ? "新しいリビジョン" : "New revision"}</span>
        <input type="text" aria-label={ja ? "新しいリビジョン" : "New revision"} value={revision} maxLength={64}
          onChange={event => { setRevision(event.target.value); setDownloadError(""); }} placeholder={`${definition.revision}-2`}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
      </label>
      <Button size="sm" icon={<Download className="size-4" />} onClick={downloadManifest} disabled={!candidate}>
        {ja ? "更新した character.json を保存" : "Download revised character.json"}
      </Button>
      <Button size="sm" variant="outline" icon={<Download className="size-4" />} disabled={!correctedCount}
        onClick={() => downloadJson("character.pose-corrections.json", {
          schemaVersion: 1, kind: "character-pose-corrections", characterId: definition.characterId,
          sourceRevision: definition.revision, calibratedRevision: candidate?.revision ?? null, frameRate: 30, tracks: corrections,
        })}>{ja ? "ポーズ補正を保存" : "Download pose corrections"}</Button>
      <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} onClick={reset} disabled={adjustedIds.size === 0 && !revision && !correctedCount}>
        {ja ? "配置をリセット" : "Reset placement edits"}
      </Button>
    </div>
    {(downloadError || ((revision || adjustedIds.size > 0) && reason)) &&
      <p className="text-xs text-muted-foreground" role="status">{downloadError || reason}</p>}
    </div>
  </Surface>;
}

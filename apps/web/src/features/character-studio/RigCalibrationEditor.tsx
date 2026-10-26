import { useState } from "react";
import { Download, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { CharacterPackDefinition } from "./character-pack";
import { calibrateRigDefinition, initialRigPlacements } from "./rig-calibration";
import type { RigPlacementInput } from "./rig-calibration";
import type { Locale } from "@/features/registry";

const fields = [
  { field: "x", en: "X offset", ja: "X 位置", step: "1" },
  { field: "y", en: "Y offset", ja: "Y 位置", step: "1" },
  { field: "rotation", en: "Rotation (°)", ja: "回転 (°)", step: "1" },
  { field: "scaleX", en: "X scale", ja: "横倍率", step: "0.05" },
  { field: "scaleY", en: "Y scale", ja: "縦倍率", step: "0.05" },
  { field: "pivotX", en: "Pivot X", ja: "支点 X", step: "1" },
  { field: "pivotY", en: "Pivot Y", ja: "支点 Y", step: "1" },
] as const satisfies ReadonlyArray<{ field: keyof RigPlacementInput; en: string; ja: string; step: string }>;

/** Static manifest calibration only. Playback stays with the pinned Kumiki renderer. */
export function RigCalibrationEditor({ definition, locale }: { definition: CharacterPackDefinition; locale: Locale }) {
  const ja = locale === "ja";
  const [selectedId, setSelectedId] = useState(definition.parts[0]?.id ?? "");
  const [placements, setPlacements] = useState(() => initialRigPlacements(definition));
  const [revision, setRevision] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const selectedPart = definition.parts.find(part => part.id === selectedId);
  const selectedAsset = selectedPart && definition.assets[selectedPart.asset];
  const placement = placements[selectedId];

  let candidate: CharacterPackDefinition | null = null;
  let reason = "";
  try { candidate = calibrateRigDefinition(definition, placements, revision); }
  catch (error) { reason = error instanceof Error ? error.message : "Invalid placement settings."; }

  const edit = (field: keyof RigPlacementInput, value: string) => {
    setDownloadError("");
    setPlacements(current => ({ ...current, [selectedId]: { ...current[selectedId], [field]: value } }));
  };
  const reset = () => {
    setPlacements(initialRigPlacements(definition));
    setRevision("");
    setDownloadError("");
  };
  const downloadManifest = () => {
    if (!candidate) return;
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(candidate, null, 2) + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.download = "character.json";
      link.href = url;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadError("");
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      setDownloadError(error instanceof Error ? error.message : "Manifest download failed.");
    }
  };

  return <Surface variant="outline" className="gap-4 p-5" aria-label="Rig placement calibration">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-foreground"><SlidersHorizontal aria-hidden className="size-4 text-primary" />{ja ? "体格と関節の配置" : "Anatomy & joint placement"}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{ja
          ? "人型の骨格を前提としません。顔の位置、短い足、胴体に近い前足、尾の付け根などを各パーツで調整できます。"
          : "No human skeleton assumptions. Adjust a low muzzle, shorter legs, paws close to the torso, or a tail joint—part by part."}</p>
      </div>
      <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{ja ? "配置データのみ" : "Placement data only"}</span>
    </div>
    <div className="grid gap-4 md:grid-cols-[minmax(10rem,15rem)_minmax(0,1fr)]">
      <div>
        <label htmlFor="rig-part-select" className="mb-1.5 block text-xs font-medium text-foreground">{ja ? "パーツ" : "Part"}</label>
        <select id="rig-part-select" aria-label={ja ? "パーツ" : "Part"} value={selectedId} onChange={event => setSelectedId(event.target.value)}
          className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {definition.parts.map(part => <option key={part.id} value={part.id}>{part.id}</option>)}
        </select>
        {selectedPart && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selectedPart.parent
          ? (ja ? `${selectedPart.parent} を基準に配置` : `Relative to ${selectedPart.parent}`)
          : (ja ? "シーン原点を基準に配置" : "Relative to the character canvas")}</p>}
        {selectedPart && <p className="mt-1 text-xs text-muted-foreground">{ja ? "画像" : "Asset"}: {selectedPart.asset}{selectedAsset ? ` · ${selectedAsset.width} × ${selectedAsset.height} px` : ""}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {fields.map(({ field, en, ja: jp, step }) => <label key={field} className="block min-w-0">
          <span className="mb-1.5 block text-xs font-medium text-foreground">{ja ? jp : en}</span>
          <input type="number" aria-label={ja ? jp : en} step={step} value={placement?.[field] ?? ""}
            onChange={event => edit(field, event.target.value)}
            className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
        </label>)}
      </div>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">{ja
      ? "Xは右、Yは下、回転は時計回り。Pivotは画像内の座標です。編集内容は自動保存されず、動作検証もできません。"
      : "X moves right, Y moves down, rotation is clockwise. Pivot uses source-image pixels. Edits are not autosaved and there is no live animation preview yet."}</p>
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <label className="min-w-36 flex-1 sm:max-w-52">
        <span className="mb-1.5 block text-xs font-medium text-foreground">{ja ? "新しいリビジョン" : "New revision"}</span>
        <input type="text" aria-label={ja ? "新しいリビジョン" : "New revision"} value={revision} maxLength={64}
          onChange={event => { setRevision(event.target.value); setDownloadError(""); }} placeholder={`${definition.revision}-2`}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
      </label>
      <Button size="sm" icon={<Download className="size-4" />} onClick={downloadManifest} disabled={!candidate}>
        {ja ? "更新した character.json を保存" : "Download revised character.json"}
      </Button>
      <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} onClick={reset}>
        {ja ? "配置をリセット" : "Reset placement edits"}
      </Button>
    </div>
    {(reason || downloadError) && <p className="text-xs text-muted-foreground" role="status">{downloadError || reason}</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">{ja
      ? "保存するのは修正済みマニフェストのみです。元のZIPは変更されません。layers/画像と一緒に再ZIP化して新しいリビジョンを読み込んでください。"
      : "This downloads only the edited manifest. The original ZIP stays immutable. Replace character.json alongside the same layers/, re-ZIP, and import the new revision."}</p>
  </Surface>;
}

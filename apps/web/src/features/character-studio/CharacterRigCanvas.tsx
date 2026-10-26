import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { CharacterPresenter } from "@/components/character/character-presenter-react";
import { evaluateCharacter } from "@/components/character/evaluate";
import { insertPoseCorrection, moveCharacterJoint, worldDragToParentDelta, samplePoseCorrection } from "@/components/character/authoring";
import type { CharacterCue, CharacterPoseCorrectionTracks, CharacterVec2 } from "@/components/character/definition";
import { applyMatrixToPoint, IDENTITY } from "@/components/motion/matrix";
import { characterPartWorldMatrices, prepareCharacterPreview, restCharacterDefinition, screenDragToDesign } from "./character-editor-model";
import type { CharacterPackDefinition } from "./character-pack";
import type { RigPlacementInput, RigPlacementInputs } from "./rig-calibration";
import type { Locale } from "@/features/registry";

type EditMode = "rig" | "animate";
type HandleKind = "part" | "joint" | "pose";
interface DragStart {
  partId: string;
  kind: HandleKind;
  client: CharacterVec2;
  part: ReturnType<typeof prepareCharacterPreview>["definition"]["parts"][number];
  rest: RigPlacementInput;
  parentMatrix: ReturnType<typeof characterPartWorldMatrices> extends Map<string, infer M> ? M : never;
  partMatrix: ReturnType<typeof characterPartWorldMatrices> extends Map<string, infer M> ? M : never;
  corrections: CharacterPoseCorrectionTracks;
  frame: number;
}

export function CharacterRigCanvas({ definition, placements, spriteUrls, selectedId, onSelectPart, onPlace,
  corrections, onCorrections, onGestureStart, locale }: {
    definition: CharacterPackDefinition;
    placements: RigPlacementInputs;
    spriteUrls?: ReadonlyMap<string, string>;
    selectedId: string;
    onSelectPart: (id: string) => void;
    onPlace: (id: string, changed: Partial<RigPlacementInput>) => void;
    corrections: CharacterPoseCorrectionTracks;
    onCorrections: (tracks: CharacterPoseCorrectionTracks) => void;
    onGestureStart: () => void;
    locale: Locale;
  }) {
  const ja = locale === "ja";
  const [mode, setMode] = useState<EditMode>("rig");
  const [frame, setFrame] = useState(0);
  const [action, setAction] = useState("");
  const [playing, setPlaying] = useState(false);
  const [radius, setRadius] = useState(12);
  const [dragError, setDragError] = useState("");
  const drag = useRef<DragStart | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const preview = useMemo(() => prepareCharacterPreview(definition, placements), [definition, placements]);
  const stageDefinition = useMemo(() => mode === "rig" ? restCharacterDefinition(preview.definition) : preview.definition, [mode, preview]);
  // Rig calibration always displays the rest pose; a previously selected
  // action must not silently rotate a joint while its rest pivot is edited.
  const chosenAction = mode === "animate" && action && preview.definition.actions[action] ? action : "";
  const duration = chosenAction ? preview.definition.actions[chosenAction].phases.reduce((sum, phase) => sum + phase.frames, 0) : 0;
  const maxFrame = Math.max(60, duration + 12, ...Object.values(corrections).flatMap(keys => keys.map(key => key.frame)));
  const currentFrame = mode === "rig" ? 0 : Math.min(frame, maxFrame);
  const cues: CharacterCue[] = chosenAction ? [{ id: "editor-action", instanceId: "character-editor", kind: "action", name: chosenAction, startFrame: 0 }] : [];
  const performer = { instanceId: "character-editor", characterId: definition.characterId, revision: definition.revision,
    seed: 0x4a17, corrections: mode === "rig" ? undefined : corrections, reducedMotion: mode === "rig" };
  const state = evaluateCharacter(stageDefinition, performer, cues, currentFrame);
  const transforms = characterPartWorldMatrices(stageDefinition, state);
  const selected = stageDefinition.parts.find(part => part.id === selectedId);
  const selectedMatrix = selected ? transforms.get(selected.id) : undefined;
  const poseRotation = selected ? (samplePoseCorrection(corrections, selected.id, currentFrame).rotation ?? 0) : 0;
  const asset = selected ? preview.definition.assets[selected.asset] : undefined;
  const imageCenter = selected && selectedMatrix && asset
    ? applyMatrixToPoint(selectedMatrix, { x: asset.width / 2, y: asset.height / 2 }) : null;
  const joint = selected && selectedMatrix ? applyMatrixToPoint(selectedMatrix, selected.pivot) : null;

  useEffect(() => {
    if (!playing) return;
    const handle = window.setInterval(() => setFrame(old => old >= Math.max(1, duration || maxFrame) ? 0 : old + 1), 1000 / 30);
    return () => window.clearInterval(handle);
  }, [playing, duration, maxFrame]);

  const beginDrag = (event: PointerEvent<SVGCircleElement>, partId: string, kind: HandleKind) => {
    if (event.button !== 0 || playing) return;
    const part = stageDefinition.parts.find(item => item.id === partId);
    const rest = placements[partId];
    if (!part || !rest) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectPart(partId);
    setDragError("");
    onGestureStart();
    drag.current = {
      partId, kind, part, rest: { ...rest }, corrections, frame: currentFrame,
      client: { x: event.clientX, y: event.clientY },
      parentMatrix: part.parent ? transforms.get(part.parent) ?? IDENTITY : IDENTITY,
      partMatrix: transforms.get(part.id) ?? IDENTITY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || !stage.current) return;
    try {
      const rect = stage.current.getBoundingClientRect();
      const motion = screenDragToDesign(
        { x: event.clientX - start.client.x, y: event.clientY - start.client.y },
        { width: rect.width || definition.design.width, height: rect.height || definition.design.height }, definition.design,
      );
      if (start.kind === "joint") {
        const local = worldDragToParentDelta(motion, start.partMatrix);
        const edited = moveCharacterJoint(start.part, { x: start.part.pivot.x + local.x, y: start.part.pivot.y + local.y });
        onPlace(start.partId, {
          pivotX: String(Number(edited.pivot.x.toFixed(3))), pivotY: String(Number(edited.pivot.y.toFixed(3))),
          x: String(Number((edited.rest?.x ?? 0).toFixed(3))), y: String(Number((edited.rest?.y ?? 0).toFixed(3))),
        });
      } else {
        const local = worldDragToParentDelta(motion, start.parentMatrix);
        if (start.kind === "part") {
          onPlace(start.partId, {
            x: String(Number((Number(start.rest.x) + local.x).toFixed(3))),
            y: String(Number((Number(start.rest.y) + local.y).toFixed(3))),
          });
        } else {
          const old = samplePoseCorrection(start.corrections, start.partId, start.frame);
          onCorrections(insertPoseCorrection(start.corrections, start.partId, start.frame,
            { ...old, x: (old.x ?? 0) + local.x, y: (old.y ?? 0) + local.y }, radius));
        }
      }
    } catch (error) { setDragError(error instanceof Error ? error.message : "Could not move this joint."); }
  };

  const stopDrag = () => { drag.current = null; };
  const rotatePose = (amount: number) => {
    if (!selected || playing) return;
    try {
      const previous = samplePoseCorrection(corrections, selected.id, currentFrame);
      const rotation = Math.round((previous.rotation ?? 0) + amount);
      onGestureStart();
      onCorrections(insertPoseCorrection(corrections, selected.id, currentFrame, { ...previous, rotation }, radius));
      setDragError("");
    } catch (error) { setDragError(error instanceof Error ? error.message : "Could not rotate the selected part."); }
  };
  const handleLabel = (kind: HandleKind) => {
    if (ja) return `${selectedId} の${kind === "joint" ? "関節" : kind === "pose" ? "ポーズ" : "位置"}を移動`;
    return `Move ${selectedId} ${kind === "joint" ? "joint" : kind === "pose" ? "pose" : "part"}`;
  };
  const keyboardMove = (event: KeyboardEvent<SVGCircleElement>, kind: HandleKind) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    try {
      onGestureStart();
      if (kind === "pose") {
        const previous = samplePoseCorrection(corrections, selectedId, currentFrame);
        onCorrections(insertPoseCorrection(corrections, selectedId, currentFrame,
          { ...previous, x: (previous.x ?? 0) + dx, y: (previous.y ?? 0) + dy }, radius));
      } else if (kind === "joint" && selected) {
        const moved = moveCharacterJoint(selected, { x: selected.pivot.x + dx, y: selected.pivot.y + dy });
        onPlace(selectedId, { pivotX: String(moved.pivot.x), pivotY: String(moved.pivot.y),
          x: String(moved.rest?.x ?? 0), y: String(moved.rest?.y ?? 0) });
      } else {
        onPlace(selectedId, { x: String((selected?.rest?.x ?? 0) + dx), y: String((selected?.rest?.y ?? 0) + dy) });
      }
    } catch (error) { setDragError(error instanceof Error ? error.message : "Invalid edit."); }
  };

  return <section aria-label={ja ? "キャラクター編集キャンバス" : "Character rig and animation canvas"}
    className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-subtle/60 px-4 py-3">
      <div className="inline-flex rounded-lg border border-border bg-surface p-1" aria-label={ja ? "編集モード" : "Editing mode"}>
        {(["rig", "animate"] as const).map(value => <button type="button" key={value} aria-pressed={mode === value}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring ${mode === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => { setMode(value); setPlaying(false); stopDrag(); }}>
          {value === "rig" ? (ja ? "リグ" : "Rig") : (ja ? "アニメート" : "Animate")}
        </button>)}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{definition.design.width} × {definition.design.height}</span>
    </div>
    <div className="p-3 sm:p-4">
      <div ref={stage} className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border/60"
        style={{ aspectRatio: `${definition.design.width}/${definition.design.height}`,
          backgroundColor: "#f0eee9", backgroundImage: "linear-gradient(45deg,#b9b7b233 25%,transparent 25%,transparent 75%,#b9b7b233 75%),linear-gradient(45deg,#b9b7b233 25%,transparent 25%,transparent 75%,#b9b7b233 75%)",
          backgroundSize: "22px 22px", backgroundPosition: "0 0,11px 11px" }}>
        <CharacterPresenter definition={stageDefinition} instance={performer} cues={cues} frame={currentFrame}
          assetUrls={Object.fromEntries(spriteUrls ?? [])} label={`${definition.characterId} animation preview`} reducedMotion="auto"
          onClick={event => {
            const node = (event.target as Element).closest?.("[data-part]");
            const id = node?.getAttribute("data-part");
            if (id) onSelectPart(id);
          }} />
        <svg viewBox={`0 0 ${definition.design.width} ${definition.design.height}`} aria-label={ja ? "移動ハンドル" : "Rig drag handles"}
          className="absolute inset-0 size-full" style={{ pointerEvents: "none", overflow: "visible" }} onPointerMove={pointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          {stageDefinition.parts.map(part => {
            const matrix = transforms.get(part.id);
            if (!matrix || part.id === selectedId) return null;
            const point = applyMatrixToPoint(matrix, part.pivot);
            return <circle key={part.id} cx={point.x} cy={point.y} r={5} fill="#64748b" stroke="#fff" strokeWidth={2}
              style={{ pointerEvents: "auto", cursor: "pointer" }} role="button" tabIndex={0} aria-label={`Select ${part.id}`}
              onClick={() => onSelectPart(part.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectPart(part.id); } }} />;
          })}
          {selected && joint && imageCenter && <>
            <circle cx={joint.x} cy={joint.y} r={20} fill="none" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="4 5" opacity="0.85" />
            {(mode === "rig" ? [
              { kind: "part" as const, point: imageCenter, color: "#475569" },
              { kind: "joint" as const, point: joint, color: "#0891b2" },
            ] : [{ kind: "pose" as const, point: imageCenter, color: "#7c3aed" }]).map(handle =>
              <circle key={handle.kind} cx={handle.point.x} cy={handle.point.y} r={handle.kind === "joint" ? 17 : 20}
                role="button" tabIndex={0} aria-label={handleLabel(handle.kind)}
                stroke={handle.color} strokeWidth={2} fill={handle.color} fillOpacity={0.24}
                style={{ pointerEvents: "auto", cursor: "grab", touchAction: "none" }}
                onPointerDown={event => beginDrag(event, selectedId, handle.kind)}
                onPointerUp={stopDrag} onPointerCancel={stopDrag}
                onKeyDown={event => keyboardMove(event, handle.kind)} />)}
          </>}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {mode === "rig" ? <>
          <span><span aria-hidden className="mr-1.5 text-slate-500">●</span>{ja ? "パーツを移動" : "Move part"}</span>
          <span><span aria-hidden className="mr-1.5 text-cyan-600">●</span>{ja ? "関節の開始点を移動" : "Move joint origin"}</span>
          <span>{ja ? "パーツ一覧と数値でも調整可能" : "Or use the part list and numeric controls"}</span>
        </> : <span>{ja ? "停止したフレームで紫のハンドルをドラッグ" : "Pause at a frame, then drag the purple pose handle. Surrounding frames ease into your edit."}</span>}
      </div>
      {mode === "animate" && <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface-subtle/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPlaying(value => !value)} aria-label={playing ? "Pause animation" : "Play animation"}
            className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {ja ? "アクション" : "Action"}
            <select className="min-w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground"
              value={chosenAction} onChange={event => { setAction(event.target.value); setFrame(0); setPlaying(false); }}>
              <option value="">{ja ? "ニュートラル" : "Neutral"}</option>
              {preview.actions.map(name => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{currentFrame}f · {(currentFrame / 30).toFixed(2)}s</span>
        </div>
        <input type="range" aria-label="Animation frame" min={0} max={maxFrame} step={1} value={currentFrame}
          className="w-full accent-primary" onChange={event => { setPlaying(false); setFrame(Number(event.target.value)); }} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {ja ? "滑らかに調整する範囲" : "Smooth over"}
            <select aria-label="Correction influence" value={radius} onChange={event => setRadius(Number(event.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground">
              <option value={6}>6 frames</option><option value={12}>12 frames</option><option value={24}>24 frames</option>
            </select>
          </label>
          {selected && <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">{poseRotation > 0 ? "+" : ""}{Math.round(poseRotation)}° correction</span>
            <button type="button" disabled={playing} aria-label="Rotate counterclockwise 5°" onClick={() => rotatePose(-5)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50">−5°</button>
            <button type="button" disabled={playing} aria-label="Rotate clockwise 5°" onClick={() => rotatePose(5)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50">+5°</button>
          </div>}
          <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => { setPlaying(false); setFrame(0); }}><RotateCcw className="size-3.5" />{ja ? "先頭へ" : "Go to start"}</button>
        </div>
        {preview.limited && <p className="text-xs text-muted-foreground" role="status">
          {ja ? "このZIPのアクションは未検証です。安全なニュートラルポーズで編集しています。" : "Imported actions are incomplete or unverified; corrections are previewed over a safe neutral pose."}
        </p>}
      </div>}
      {dragError && <p role="alert" className="mt-2 text-xs text-danger">{dragError}</p>}
    </div>
  </section>;
}

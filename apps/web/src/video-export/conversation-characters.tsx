import { useMemo } from "react";
import { CharacterPresenter } from "@/components/character/character-presenter-react";
import type { CharacterCue, CharacterDefinition, CharacterInstance } from "@/components/character/definition";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { PIP_RIG, QUILL_RIG } from "./pip-quill-rigs";

type Chapter = GeneralVisualPlan["chapters"][number];
type CastId = "pip" | "quill";
export type ExportRigMap = Partial<Record<CastId, {
  draftId: string; archiveSha256: string; definition: CharacterDefinition; assetUrls: Record<string, string>;
}>>;
const cast: Record<CastId, { definition: CharacterDefinition; name: string; color: string; tint: string }> = {
  pip: { definition: PIP_RIG, name: "Pip", color: "#83E5CB", tint: "#203F45" },
  quill: { definition: QUILL_RIG, name: "Quill", color: "#C5BFFF", tint: "#353750" },
};
const castId = (id: string): id is CastId => id === "pip" || id === "quill";

/** This is approximate mouth animation timed to *measured* voice ranges, not claimed phoneme alignment. */
function conversationCues(chapter: Chapter, id: CastId, definition: CharacterDefinition): CharacterCue[] {
  const result: CharacterCue[] = [];
  const turns = chapter.dialogue?.turns ?? [];
  for (const turn of turns) {
    if (turn.role !== "character" || turn.speakerId !== id ||
        !Number.isSafeInteger(turn.startFrame) || !Number.isSafeInteger(turn.endFrame) ||
        turn.startFrame === undefined || turn.endFrame === undefined || turn.endFrame <= turn.startFrame) continue;
    result.push({ id: `voice-${chapter.id}-${turn.id}`, kind: "speech", instanceId: id,
      startFrame: turn.startFrame, endFrame: turn.endFrame, precision: "approximate" });
    // Explicit dialogue action names come from the selected saved ZIP revision.
    // A misspelled or removed walk/gesture must never silently become the
    // bundled explain animation when a customized revision is pinned.
    if (turn.animationAction && !definition.actions[turn.animationAction])
      throw Error(`Character action "${turn.animationAction}" is not declared by the selected ${id} rig revision.`);
    const action = turn.animationAction || (definition.actions?.[`${id}-explain`] ? `${id}-explain` :
      definition.actions?.explain ? "explain" : null);
    if (action && (turn.animationAction || turn.endFrame - turn.startFrame >= 18)) result.push({ id: `gesture-${chapter.id}-${turn.id}`,
      kind: "action", instanceId: id, name: action, startFrame: turn.startFrame + 3 });
  }
  return result;
}

/** Layout is isolated to an editorial scene: other video families and unvoiced scenes stay unchanged. */
export function ConversationCharacters({ chapter, frame, portrait = false, compact = false, rigs }: {
  chapter: Chapter; frame: number; portrait?: boolean; compact?: boolean; rigs?: ExportRigMap;
}) {
  const people = useMemo(() => [...new Set((chapter.dialogue?.turns ?? [])
    .filter(turn => turn.role === "character" && castId(turn.speakerId))
    .map(turn => turn.speakerId as CastId))], [chapter.dialogue]);
  if (!people.length) return null;
  const active = chapter.dialogue?.turns.find(turn => turn.startFrame !== undefined && turn.endFrame !== undefined &&
    frame >= turn.startFrame && frame < turn.endFrame);
  const speaker = active?.role === "character" && castId(active.speakerId) ? active.speakerId : null;
  const title = active?.role === "narrator" ? "NARRATOR" : speaker ? `${cast[speaker].name.toUpperCase()} SPEAKING` : "THE CONVERSATION";
  const wrapper = portrait
    ? { left: 108, top: 868, width: 788, height: 622 }
    : compact ? { left: 1040, top: 616, width: 760, height: 327 }
      : { left: 1040, top: 256, width: 760, height: 685 };
  return <div data-conversation-characters="" data-dialogue-active={speaker ?? (active ? "narrator" : "quiet")}
    data-dialogue-timing={active ? "measured" : "rest"}
    style={{ position: "absolute", ...wrapper, boxSizing: "border-box", zIndex: 4,
      borderRadius: portrait ? 28 : 32, border: "2px solid #496676",
      background: "linear-gradient(144deg, #172E3AEF, #172631F7)",
      boxShadow: "0 28px 80px #07131DA8", padding: compact ? 15 : 23,
      fontFamily: "Geist Variable, Geist, Arial, sans-serif", overflow: "hidden", color: "#F6F2E9" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <span style={{ fontSize: compact ? 17 : 21, fontWeight: 800, letterSpacing: 2.1, color: "#E9C08C" }}>{title}</span>
      <span style={{ fontSize: compact ? 13 : 16, color: "#BBD0D7" }}>PIP · QUILL · NARRATION</span>
    </div>
    <div style={{ display: "flex", justifyContent: "center", gap: compact ? 22 : 26,
      height: compact ? 245 : portrait ? 470 : 482, alignItems: "stretch", marginTop: 13 }}>
      {people.map(id => {
        const custom = rigs?.[id];
        const definition = custom?.definition ?? cast[id].definition;
        const performer: CharacterInstance = { instanceId: id, characterId: id,
          revision: definition.revision, seed: id === "pip" ? 117 : 283 };
        const speaking = speaker === id;
        return <div key={id} data-conversation-performer={id} data-speaking={speaking ? "true" : "false"}
          data-rig-source={custom ? "character-studio" : "bundled"} data-rig-revision={definition.revision}
          data-rig-draft-id={custom?.draftId} data-rig-archive-sha256={custom?.archiveSha256}
          data-rig-mouth-part={custom?.definition.speech?.mouthPart}
          data-rig-rest-asset={custom ? (() => {
            const mouth = custom.definition.parts.find(part => part.id === custom.definition.speech?.mouthPart);
            return mouth ? (mouth.variants?.[custom.definition.speech!.rest] ?? mouth.asset) : undefined;
          })() : undefined}
          style={{ flex: 1, maxWidth: people.length === 1 ? 355 : 345, minWidth: 0,
            borderRadius: compact ? 19 : 24, border: `2px solid ${speaking ? cast[id].color : "#4E6673"}`,
            background: speaking ? cast[id].tint : "#203643", boxSizing: "border-box",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between",
            padding: compact ? "8px 12px" : "15px 19px", overflow: "hidden" }}>
          <CharacterPresenter definition={definition} instance={performer} assetUrls={custom?.assetUrls}
            cues={conversationCues(chapter, id, definition)} frame={frame} label={`${cast[id].name} animated character`}
            reducedMotion={false}
            style={{ width: compact ? "72%" : "100%", maxHeight: compact ? 192 : portrait ? 365 : 392,
              flex: "1 1 auto", objectFit: "contain" }} />
          <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: compact ? 19 : 25, fontWeight: 800, color: cast[id].color }}>{cast[id].name}</span>
            <span style={{ fontSize: compact ? 12 : 14, letterSpacing: 1.2, color: "#CFDCE0" }}>
              {speaking ? "● SPEAKING" : "LISTENING"}
            </span>
          </div>
        </div>;
      })}
    </div>
    {!compact && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 13 }}>
      {chapter.visual.items.slice(0, 5).map((item, index) =>
        <span key={`${index}-${item}`} style={{ fontSize: portrait ? 17 : 15, color: "#DCE8E9", padding: "6px 11px",
          background: "#294652", border: "1px solid #496674", borderRadius: 999,
          maxWidth: 690, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>)}
    </div>}
  </div>;
}

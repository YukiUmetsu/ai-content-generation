import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "../i18n";
import { formatRuntime, type BeatTiming, type Timeline } from "../model/timeline";
import type { Locale, SemanticStoryboard } from "../model/types";
import type { StoryboardDiagnostic } from "../model/validate";
import { diagnosticsForBeat } from "../model/validate";

interface BeatListProps {
  board: SemanticStoryboard;
  timeline: Timeline;
  diagnostics: StoryboardDiagnostic[];
  selectedBeatId: string;
  onSelect: (beatId: string) => void;
  onMove: (beatId: string, direction: -1 | 1) => void;
  onDelete: (beatId: string) => void;
  onPreviewStart: (beatId: string) => void;
  locale: Locale;
}

function timingFor(timeline: Timeline, beatId: string): BeatTiming | undefined {
  return timeline.entries.find((entry) => entry.beatId === beatId);
}

export function BeatList({
  board,
  timeline,
  diagnostics,
  selectedBeatId,
  onSelect,
  onMove,
  onDelete,
  onPreviewStart,
  locale,
}: BeatListProps) {
  const t = copy(locale);

  return (
    <section className="sp-panel sp-beat-panel" aria-label={t.beatListLabel}>
      <div className="sp-panel-heading">
        <h2>{t.beatsHeading}</h2>
        <span className="sp-count">{board.beats.length}</span>
      </div>
      <ol className="sp-beats">
        {board.beats.map((beat, index) => {
          const timing = timingFor(timeline, beat.id);
          const beatDiagnostics = diagnosticsForBeat(diagnostics, beat.id);
          const errors = beatDiagnostics.filter((item) => item.severity === "error").length;
          const warnings = beatDiagnostics.length - errors;
          const width = timing && timeline.totalFrames > 0 ? (timing.durationFrames / timeline.totalFrames) * 100 : 0;
          const label = beat.onScreenText.trim() || beat.objective.trim() || beat.id;
          const selected = beat.id === selectedBeatId;
          return (
            <li key={beat.id} className={selected ? "sp-beat is-selected" : "sp-beat"}>
              <button
                type="button"
                className="sp-beat-select"
                aria-current={selected ? "step" : undefined}
                aria-label={t.selectBeat(index + 1, label)}
                onClick={() => onSelect(beat.id)}
                onDoubleClick={() => onPreviewStart(beat.id)}
              >
                <span className="sp-beat-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="sp-beat-main">
                  <span className="sp-beat-role">{t.roles[beat.role]}</span>
                  <span className="sp-beat-copy">{label}</span>
                  <span className="sp-beat-meta">
                    <span>
                      {timing
                        ? formatRuntime(timing.durationFrames, board.fps, locale)
                        : t.frames(beat.durationFrames)}
                    </span>
                    {beat.narrationCueId && <span className="sp-beat-cue">{beat.narrationCueId}</span>}
                  </span>
                  <span className="sp-beat-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, width)}%` }} />
                  </span>
                </span>
                {(errors > 0 || warnings > 0) && (
                  <span
                    className={errors > 0 ? "sp-beat-issues is-error" : "sp-beat-issues"}
                    aria-label={`${errors} ${t.errorSeverity}, ${warnings} ${t.warningSeverity}`}
                  >
                    {errors + warnings}
                  </span>
                )}
              </button>
              {selected && (
                <div className="sp-beat-actions">
                  <Button
                    variant="subtle"
                    size="icon"
                    icon={<ArrowUp aria-hidden="true" />}
                    aria-label={t.moveUp(index + 1)}
                    disabled={index === 0}
                    onClick={() => onMove(beat.id, -1)}
                  />
                  <Button
                    variant="subtle"
                    size="icon"
                    icon={<ArrowDown aria-hidden="true" />}
                    aria-label={t.moveDown(index + 1)}
                    disabled={index === board.beats.length - 1}
                    onClick={() => onMove(beat.id, 1)}
                  />
                  <Button
                    variant="subtle"
                    size="icon"
                    icon={<Trash2 aria-hidden="true" />}
                    aria-label={t.deleteBeat(index + 1)}
                    onClick={() => onDelete(beat.id)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

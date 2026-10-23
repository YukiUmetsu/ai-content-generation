import { useEffect, useMemo, useState } from "react";
import { Download, Plus, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FeatureSlotProps } from "@/features/registry";
import { BeatList } from "./components/BeatList";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { SceneEditor } from "./components/SceneEditor";
import { ScenePreview } from "./components/ScenePreview";
import { StoryboardJsonDialog } from "./components/StoryboardJsonDialog";
import { copy } from "./i18n";
import {
  createBeat,
  deleteBeat,
  insertBeat,
  moveBeat,
  updateBeat,
} from "./model/edit";
import { HVAC_EXAMPLE } from "./model/hvac-example";
import {
  clearProjectStoryboard,
  loadProjectStoryboard,
  saveProjectStoryboard,
} from "./model/project-storage";
import { parseStoryboard, type ImportIssue } from "./model/serialize";
import { computeTimeline, formatRuntime } from "./model/timeline";
import {
  cloneStoryboard,
  type Locale,
  type SemanticStoryboard,
  type StoryboardBeat,
} from "./model/types";
import { validateStoryboard } from "./model/validate";
import "./storyboard-planner.css";

export interface StoryboardPlannerProps {
  locale: Locale;
  className?: string;
  onPreviewChange?: FeatureSlotProps["onPreviewChange"];
  /** Browser-local project whose draft is restored and saved on edits. */
  projectId?: string;
  /** Test / integration hook; defaults to the preloaded HVAC example. */
  initialBoard?: SemanticStoryboard;
}

export function StoryboardPlanner({
  locale,
  className,
  onPreviewChange,
  initialBoard,
  projectId,
}: StoryboardPlannerProps) {
  const t = copy(locale);
  const [restoredDraft] = useState(() =>
    projectId ? loadProjectStoryboard(projectId) : { board: null, warning: null }
  );
  const [board, setBoard] = useState<SemanticStoryboard>(() =>
    cloneStoryboard(initialBoard ?? restoredDraft.board ?? HVAC_EXAMPLE)
  );
  const [selectedBeatId, setSelectedBeatId] = useState(() =>
    (initialBoard ?? restoredDraft.board ?? HVAC_EXAMPLE).beats[0]?.id ?? ""
  );
  const [loadWarning, setLoadWarning] = useState(restoredDraft.warning);
  const [storageError, setStorageError] = useState<string | null>(restoredDraft.warning);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"export" | "import">("export");
  const [importErrors, setImportErrors] = useState<ImportIssue[]>([]);
  const [resetArmed, setResetArmed] = useState(false);

  const timeline = useMemo(() => computeTimeline(board.beats, board.fps), [board.beats, board.fps]);
  const diagnostics = useMemo(() => validateStoryboard(board), [board]);

  const selectedBeat = useMemo(
    () => board.beats.find((beat) => beat.id === selectedBeatId) ?? board.beats[0],
    [board.beats, selectedBeatId]
  );
  const selectedTiming = useMemo(
    () => timeline.entries.find((entry) => entry.beatId === selectedBeat?.id),
    [timeline.entries, selectedBeat?.id]
  );

  const preview = useMemo(() => {
    if (!selectedBeat) return null;
    return (
      <ScenePreview
        board={board}
        beat={selectedBeat}
        timing={selectedTiming}
        locale={locale}
      />
    );
  }, [board, selectedBeat, selectedTiming, locale]);

  useEffect(() => {
    if (!onPreviewChange) return;
    onPreviewChange(preview);
  }, [onPreviewChange, preview]);

  useEffect(() => {
    if (!onPreviewChange) return;
    return () => onPreviewChange(null);
  }, [onPreviewChange]);

  function updateBoard(next: SemanticStoryboard) {
    setBoard(next);
    if (!projectId || loadWarning) return;
    try {
      saveProjectStoryboard(projectId, next);
      setStorageError(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Storage unavailable.";
      setStorageError(`Storyboard could not be saved: ${detail} Export the JSON before leaving.`);
    }
  }

  function updateSelected(patch: Partial<StoryboardBeat>) {
    if (!selectedBeat) return;
    updateBoard(updateBeat(board, selectedBeat.id, patch));
  }

  function handleAddBeat() {
    const beat = createBeat(board);
    updateBoard(insertBeat(board, beat));
    setSelectedBeatId(beat.id);
  }

  function handleDeleteBeat(beatId: string) {
    const index = board.beats.findIndex((beat) => beat.id === beatId);
    if (index < 0) return;
    const remaining = deleteBeat(board, beatId);
    const next = remaining.beats[Math.min(index, remaining.beats.length - 1)];
    updateBoard(remaining);
    setSelectedBeatId(next?.id ?? "");
  }

  function handleMoveBeat(beatId: string, direction: -1 | 1) {
    updateBoard(moveBeat(board, beatId, direction));
  }

  function handleReset() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    if (projectId) {
      try {
        clearProjectStoryboard(projectId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Storage unavailable.";
        setStorageError(`Local draft could not be reset: ${detail}`);
        return;
      }
    }
    const fresh = cloneStoryboard(initialBoard ?? HVAC_EXAMPLE);
    setBoard(fresh);
    setSelectedBeatId(fresh.beats[0]?.id ?? "");
    setImportErrors([]);
    setLoadWarning(null);
    setStorageError(null);
    setResetArmed(false);
  }

  function handleImport(text: string) {
    const result = parseStoryboard(text);
    if (!result.ok) {
      setImportErrors(result.errors);
      return;
    }
    updateBoard(result.board);
    setSelectedBeatId(result.board.beats[0]?.id ?? "");
    setImportErrors([]);
    setDialogOpen(false);
  }

  return (
    <div className={`sp-root ${className ?? ""}`.trim()}>
      <header className="sp-header">
        <div className="sp-header-titles">
          <p className="sp-eyebrow">{t.plannerEyebrow}</p>
          <h1 className="sp-title">{board.title}</h1>
          <p className="sp-meta">
            <span>{t.runtime}: {formatRuntime(timeline.totalFrames, board.fps, locale)}</span>
            <span aria-hidden="true">·</span>
            <span>{board.beats.length} {t.beats}</span>
            <span aria-hidden="true">·</span>
            <span>{t.checks}: {diagnostics.length}</span>
            <span aria-hidden="true">·</span>
            <span>{t.fps(String(board.fps.num / board.fps.den))}</span>
            <span className="sp-example-notice">{t.exampleNotice}</span>
            {projectId && !storageError && (
              <span className="sp-example-notice">
                {locale === "ja" ? "編集内容はこのプロジェクトのローカル下書きに保存されます" : "Project edits save as a local browser draft"}
              </span>
            )}
          </p>
          {storageError && (
            <p className="sp-draft-warning" role="alert">
              {storageError}
              {loadWarning && " This draft will not be overwritten. Export any new edits as JSON or reset the local draft."}
            </p>
          )}
        </div>
        <div className="sp-header-actions">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus aria-hidden="true" />}
            onClick={handleAddBeat}
          >
            {t.addBeat}
          </Button>
          <Button
            variant={resetArmed ? "destructive" : "subtle"}
            size="sm"
            icon={<RotateCcw aria-hidden="true" />}
            onClick={handleReset}
          >
            {resetArmed ? t.resetConfirm : t.resetExample}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            icon={<Upload aria-hidden="true" />}
            onClick={() => {
              setImportErrors([]);
              setDialogMode("import");
              setDialogOpen(true);
            }}
          >
            {t.importButton}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Download aria-hidden="true" />}
            onClick={() => {
              setDialogMode("export");
              setDialogOpen(true);
            }}
          >
            {t.exportButton}
          </Button>
        </div>
      </header>

      <div className={`sp-workspace ${onPreviewChange ? "" : "has-local-preview"}`.trim()}>
        <aside className="sp-side">
          <BeatList
            board={board}
            timeline={timeline}
            diagnostics={diagnostics}
            selectedBeatId={selectedBeat?.id ?? ""}
            onSelect={setSelectedBeatId}
            onMove={handleMoveBeat}
            onDelete={handleDeleteBeat}
            onPreviewStart={setSelectedBeatId}
            locale={locale}
          />
          <DiagnosticsPanel
            board={board}
            diagnostics={diagnostics}
            onSelectBeat={setSelectedBeatId}
            locale={locale}
          />
        </aside>

        <div className="sp-main">
          {selectedBeat ? (
            <>
              <SceneEditor
                board={board}
                beat={selectedBeat}
                timing={selectedTiming}
                diagnostics={diagnostics}
                onChange={updateSelected}
                locale={locale}
              />
              {!onPreviewChange && (
                <div className="sp-local-preview">{preview}</div>
              )}
            </>
          ) : (
            <p className="sp-empty-editor">{t.noBeats}</p>
          )}
        </div>
      </div>

      <StoryboardJsonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        onModeChange={setDialogMode}
        board={board}
        locale={locale}
        importErrors={importErrors}
        onImport={handleImport}
      />
    </div>
  );
}

export default StoryboardPlanner;

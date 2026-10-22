import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { copy, describeImportIssue } from "../i18n";
import { compileToKumiki, serializeKumikiProjection } from "../model/kumiki";
import { serializeStoryboard, type ImportIssue } from "../model/serialize";
import type { Locale, SemanticStoryboard } from "../model/types";

interface StoryboardJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "export" | "import";
  onModeChange: (mode: "export" | "import") => void;
  board: SemanticStoryboard;
  locale: Locale;
  importErrors: ImportIssue[];
  onImport: (text: string) => void;
}

export function StoryboardJsonDialog({
  open,
  onOpenChange,
  mode,
  onModeChange,
  board,
  locale,
  importErrors,
  onImport,
}: StoryboardJsonDialogProps) {
  const t = copy(locale);
  const [format, setFormat] = useState<"semantic" | "kumiki">("semantic");
  const [importText, setImportText] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  const semanticText = useMemo(() => serializeStoryboard(board), [board]);
  const projection = useMemo(() => compileToKumiki(board), [board]);
  const projectionText = useMemo(() => serializeKumikiProjection(board), [board]);
  const exportText = format === "semantic" ? semanticText : projectionText;

  async function handleCopy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(exportText);
      } else {
        const area = document.createElement("textarea");
        area.value = exportText;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (!ok) throw new Error("copy failed");
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function handleDownload() {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      format === "semantic" ? "contentgen-storyboard.json" : "kumiki-storyboard-projection.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result ?? ""));
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.dialogTitle} size="lg" closeLabel={t.close}>
      <div className="sp-json-dialog">
        <div className="sp-json-switches">
          <div className="sp-segmented" role="group" aria-label={t.dialogTitle}>
            <Button
              variant={mode === "export" ? "secondary" : "subtle"}
              size="sm"
              aria-pressed={mode === "export"}
              onClick={() => onModeChange("export")}
            >
              {t.exportTab}
            </Button>
            <Button
              variant={mode === "import" ? "secondary" : "subtle"}
              size="sm"
              aria-pressed={mode === "import"}
              onClick={() => onModeChange("import")}
            >
              {t.importTab}
            </Button>
          </div>
          {mode === "export" && (
            <div className="sp-segmented" role="group" aria-label={t.exportTab}>
              <Button
                variant={format === "semantic" ? "secondary" : "subtle"}
                size="sm"
                aria-pressed={format === "semantic"}
                onClick={() => setFormat("semantic")}
              >
                {t.formatSemantic}
              </Button>
              <Button
                variant={format === "kumiki" ? "secondary" : "subtle"}
                size="sm"
                aria-pressed={format === "kumiki"}
                onClick={() => setFormat("kumiki")}
              >
                {t.formatKumiki}
              </Button>
            </div>
          )}
        </div>

        {mode === "export" ? (
          <div className="sp-json-export">
            <textarea
              readOnly
              value={exportText}
              className="sp-json-textarea"
              aria-label={format === "semantic" ? t.formatSemantic : t.formatKumiki}
            />
            {format === "kumiki" && (
              <div className="sp-projection-note">
                <p>{t.projectionNote}</p>
                <p>
                  {t.projectionIssues(
                    projection.diagnostics.length + projection.notes.length
                  )}
                </p>
              </div>
            )}
            <div className="sp-json-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
              >
                {copyStatus === "copied" ? t.copied : copyStatus === "failed" ? t.copyFailed : t.copy}
              </Button>
              <Button size="sm" onClick={handleDownload}>
                {t.download}
              </Button>
            </div>
          </div>
        ) : (
          <div className="sp-json-import">
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              className="sp-json-textarea"
              placeholder={t.importPlaceholder}
              aria-label={t.importTab}
            />
            <label className="sp-file-label">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileChange}
              />
              {t.importFileLabel}
            </label>
            {importErrors.length > 0 && (
              <div className="sp-import-errors" role="alert">
                <p>{t.importErrors}</p>
                <ul>
                  {importErrors.map((issue, index) => (
                    <li key={`${issue.code}-${issue.path}-${index}`}>
                      <code>{issue.path}</code>: {describeImportIssue(issue, locale)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="sp-json-actions">
              <Button size="sm" onClick={() => onImport(importText)}>
                {t.importAction}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

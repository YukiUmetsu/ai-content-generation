import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ImportError, Locale } from "../model/types";
import { copy } from "../i18n";

interface JsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exportText: string;
  exportDisabled: boolean;
  onImport: (text: string) => void;
  importErrors: ImportError[];
  locale: Locale;
}

export function JsonDialog({
  open,
  onOpenChange,
  exportText,
  exportDisabled,
  onImport,
  importErrors,
  locale,
}: JsonDialogProps) {
  const t = copy(locale);
  const [mode, setMode] = useState<"export" | "import">("export");
  const [importText, setImportText] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

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
        if (!ok) throw new Error("execCommand copy failed");
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function handleDownload() {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "brand-kit-appearance.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleImport() {
    onImport(importText);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.exportDialogTitle} size="lg">
      <div className="ba-json-dialog">
        <div className="ba-json-mode-switch" role="group">
          <Button
            variant={mode === "export" ? "secondary" : "subtle"}
            size="sm"
            aria-pressed={mode === "export"}
            onClick={() => setMode("export")}
          >
            {t.exportTab}
          </Button>
          <Button
            variant={mode === "import" ? "secondary" : "subtle"}
            size="sm"
            aria-pressed={mode === "import"}
            onClick={() => setMode("import")}
          >
            {t.importTab}
          </Button>
        </div>

        {mode === "export" ? (
          <div className="ba-json-export">
            <textarea readOnly value={exportText} className="ba-json-textarea" aria-label={t.exportTab} />
            {exportDisabled && (
              <p className="ba-json-disabled-note" role="alert">{t.invalidHex}</p>
            )}
            <div className="ba-json-actions">
              <Button onClick={handleCopy} disabled={exportDisabled} size="sm" variant="secondary">
                {copyStatus === "copied" ? t.copied : copyStatus === "failed" ? t.copyFailed : t.copy}
              </Button>
              <Button onClick={handleDownload} disabled={exportDisabled} size="sm">
                {t.download}
              </Button>
            </div>
          </div>
        ) : (
          <div className="ba-json-import">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="ba-json-textarea"
              placeholder={t.importPlaceholder}
              aria-label={t.importTab}
            />
            <label className="ba-json-file-label">
              <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFileChange} />
              {t.importFileLabel}
            </label>
            {importErrors.length > 0 && (
              <ul className="ba-json-errors" role="alert">
                {importErrors.map((err, index) => (
                  <li key={index}>
                    <code>{err.path}</code>: {err.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="ba-json-actions">
              <Button onClick={handleImport} size="sm">{t.importAction}</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

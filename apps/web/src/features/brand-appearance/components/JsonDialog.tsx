import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import type { BrandState, Locale } from "../model/types";
import { exportBrandKitAppearance, importBrandKitAppearance } from "../model/json";
import { hasInvalidPaletteValues } from "../model/palette";
import { copy } from "../i18n";

interface JsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: BrandState;
  locale: Locale;
  onImport: (brand: BrandState) => void;
}

export function JsonDialog({
  open,
  onOpenChange,
  brand,
  locale,
  onImport,
}: JsonDialogProps) {
  const t = copy(locale);
  const exportText = useMemo(
    () => JSON.stringify(exportBrandKitAppearance(brand), null, 2),
    [brand]
  );
  const canExport = !hasInvalidPaletteValues(brand.paletteInput);

  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<{ path: string; message: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setImportErrors([{ path: "", message: t.copyFailed }]);
    }
  }

  function handleDownload() {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "brand-kit-appearance.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ""));
      setImportErrors([]);
    };
    reader.onerror = () => {
      setImportErrors([{ path: "", message: "Could not read file." }]);
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function handleImport() {
    const result = importBrandKitAppearance(importText, brand);
    if ("errors" in result) {
      setImportErrors(result.errors);
    } else {
      setImportErrors([]);
      onImport(result.brand);
      onOpenChange(false);
      setImportText("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.exportDialogTitle} size="lg">
      <div className="ba-json-dialog">
        <Tabs defaultActiveIndex={0}>
          <Tabs.List aria-label={t.exportDialogTitle}>
            <Tabs.Tab value={0}>{t.exportTab}</Tabs.Tab>
            <Tabs.Tab value={1}>{t.importTab}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value={0}>
            <div className="ba-json-export">
              <textarea
                className="ba-json-textarea"
                value={exportText}
                readOnly
                aria-label={t.exportTab}
                rows={12}
              />
              {!canExport && (
                <p className="ba-json-disabled-note">Fix palette errors before exporting.</p>
              )}
              <div className="ba-json-actions">
                <Button variant="secondary" onClick={handleCopy} disabled={!canExport}>
                  {copied ? t.copied : t.copy}
                </Button>
                <Button variant="primary" onClick={handleDownload} disabled={!canExport}>
                  {t.download}
                </Button>
              </div>
            </div>
          </Tabs.Panel>
          <Tabs.Panel value={1}>
            <div className="ba-json-import">
              <textarea
                className="ba-json-textarea"
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportErrors([]);
                }}
                placeholder={t.importPlaceholder}
                aria-label={t.importTab}
                rows={10}
              />
              <div className="ba-json-actions">
                <label className="ba-json-file-label">
                  {t.importFileLabel}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileChange}
                  />
                </label>
                <Button variant="primary" onClick={handleImport}>
                  {t.importAction}
                </Button>
              </div>
              {importErrors.length > 0 && (
                <ul className="ba-json-errors">
                  {importErrors.map((err, index) => (
                    <li key={`${err.path}-${index}`}>
                      {err.path ? (
                        <>
                          <code>{err.path}</code>: {err.message}
                        </>
                      ) : (
                        err.message
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>
    </Dialog>
  );
}

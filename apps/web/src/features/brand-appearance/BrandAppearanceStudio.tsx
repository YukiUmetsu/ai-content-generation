import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import type {
  BrandState,
  FontFamily,
  ImportError,
  Locale,
  PaletteRole,
  TypeRole,
} from "./model/types";
import { DEFAULT_BRANDS, applyPresetToBrand } from "./model/brands";
import { safeHex, hasInvalidPaletteValues } from "./model/palette";
import { exportBrandKitAppearance, importBrandKitAppearance } from "./model/json";
import { copy } from "./i18n";
import { BrandSwitcher } from "./components/BrandSwitcher";
import { PresetSelector } from "./components/PresetSelector";
import { ColorEditor } from "./components/ColorEditor";
import { TypographyEditor } from "./components/TypographyEditor";
import { ContrastStatus } from "./components/ContrastStatus";
import { PreviewStage } from "./components/PreviewStage";
import { JsonDialog } from "./components/JsonDialog";
import "./studio.css";

export interface BrandAppearanceStudioProps {
  locale: Locale;
  className?: string;
  initialBrands?: BrandState[];
  initialActiveBrandId?: string;
}

function brandRecord(brands: BrandState[]): Record<string, BrandState> {
  return Object.fromEntries(brands.map((b) => [b.id, b]));
}

export function BrandAppearanceStudio({
  locale,
  className,
  initialBrands,
  initialActiveBrandId,
}: BrandAppearanceStudioProps) {
  const t = copy(locale);
  const [brandsMap, setBrandsMap] = useState<Record<string, BrandState>>(() =>
    brandRecord(initialBrands ?? DEFAULT_BRANDS)
  );
  const [activeBrandId, setActiveBrandId] = useState(
    initialActiveBrandId ??
      (initialBrands?.[0] ?? DEFAULT_BRANDS[0]).id
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);

  const brands = useMemo(() => Object.values(brandsMap), [brandsMap]);
  const brand = brandsMap[activeBrandId] ?? brands[0];

  const previewPalette = useMemo(
    () => ({
      canvas: safeHex(brand.paletteInput.canvas),
      surface: safeHex(brand.paletteInput.surface),
      textPrimary: safeHex(brand.paletteInput.textPrimary),
      textSecondary: safeHex(brand.paletteInput.textSecondary),
      accent: safeHex(brand.paletteInput.accent),
      positive: safeHex(brand.paletteInput.positive),
      negative: safeHex(brand.paletteInput.negative),
    }),
    [brand.paletteInput]
  );

  const exportText = useMemo(
    () => JSON.stringify(exportBrandKitAppearance(brand), null, 2),
    [brand]
  );

  const exportDisabled = hasInvalidPaletteValues(brand.paletteInput);

  function updateBrand(next: BrandState) {
    setBrandsMap((prev) => ({ ...prev, [next.id]: next }));
  }

  function handlePresetChange(presetId: BrandState["appearance"]["presetId"]) {
    updateBrand(applyPresetToBrand(brand, presetId));
  }

  function handleColorChange(role: PaletteRole, value: string) {
    const validHex = safeHex(value);
    const next: BrandState = {
      ...brand,
      paletteInput: { ...brand.paletteInput, [role]: value },
      appearance: {
        ...brand.appearance,
        palette: {
          ...brand.appearance.palette,
          [role]: validHex,
        },
        customized: true,
      },
    };
    updateBrand(next);
  }

  function handleTypeChange(
    role: keyof BrandState["appearance"]["typography"],
    key: keyof TypeRole,
    value: FontFamily | number
  ) {
    updateBrand({
      ...brand,
      appearance: {
        ...brand.appearance,
        typography: {
          ...brand.appearance.typography,
          [role]: {
            ...brand.appearance.typography[role],
            [key]: value,
          },
        },
        customized: true,
      },
    });
  }

  function handleImport(text: string) {
    const result = importBrandKitAppearance(text, brand);
    if ("errors" in result) {
      setImportErrors(result.errors);
    } else {
      setImportErrors([]);
      updateBrand(result.brand);
      setDialogOpen(false);
    }
  }

  return (
    <div className={`ba-studio ${className ?? ""}`.trim()}>
      <header className="ba-header">
        <div className="ba-header-main">
          <div className="ba-header-titles">
            <h1 className="ba-header-title">{brand.name}</h1>
            <p className="ba-header-meta">
              <span className="ba-header-draft">{t.draft}</span>
              <span aria-hidden="true">·</span>
              <span>
                {t.revision} {brand.revision}
              </span>
              {brand.appearance.customized && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="ba-header-customized">{t.customized}</span>
                </>
              )}
              {brand.importSourceName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="ba-header-import-source">
                    {t.importedFrom(brand.importSourceName)}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="ba-header-actions">
            <BrandSwitcher
              brands={brands}
              activeBrandId={activeBrandId}
              onChange={setActiveBrandId}
              locale={locale}
            />
            <Button
              variant="subtle"
              size="sm"
              icon={<Download aria-hidden="true" className="ba-header-icon" />}
              onClick={() => setDialogOpen(true)}
              aria-label={t.export}
            >
              {t.export}
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Upload aria-hidden="true" className="ba-header-icon" />}
              onClick={() => setDialogOpen(true)}
              aria-label={t.import}
            >
              {t.import}
            </Button>
          </div>
        </div>
      </header>

      <main className="ba-grid">
        <section className="ba-editor" aria-label={t.headerTitle}>
          <PresetSelector
            activePresetId={brand.appearance.presetId}
            onChange={handlePresetChange}
            locale={locale}
          />
          <ColorEditor
            input={brand.paletteInput}
            onChange={handleColorChange}
            locale={locale}
          />
          <TypographyEditor
            typography={brand.appearance.typography}
            onChange={handleTypeChange}
            locale={locale}
          />
          <ContrastStatus palette={previewPalette} locale={locale} />
        </section>

        <PreviewStage brand={brand} palette={previewPalette} locale={locale} />
      </main>

      <JsonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        exportText={exportText}
        exportDisabled={exportDisabled}
        onImport={handleImport}
        importErrors={importErrors}
        locale={locale}
      />
    </div>
  );
}

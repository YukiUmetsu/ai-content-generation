import { useMemo, useState } from "react";
import type { FeatureSlotProps } from "@/features/registry";
import { Button } from "@/components/ui/button";
import { BrandSwitcher } from "./components/BrandSwitcher";
import { ColorEditor } from "./components/ColorEditor";
import { ContrastStatus } from "./components/ContrastStatus";
import { JsonDialog } from "./components/JsonDialog";
import { MetricRevealPreview } from "./components/MetricRevealPreview";
import { PresetSelector } from "./components/PresetSelector";
import { ThumbnailPreview } from "./components/ThumbnailPreview";
import { TypographyEditor } from "./components/TypographyEditor";
import { VideoOpeningPreview } from "./components/VideoOpeningPreview";
import { DEFAULT_BRANDS } from "./model/brands";
import type {
  BrandAppearance,
  BrandState,
  FontFamily,
  Locale,
  PaletteRole,
  PresetId,
  TypeRole,
} from "./model/types";
import { applyPresetToBrand } from "./model/brands";
import { hasInvalidPaletteValues, safeHex } from "./model/palette";
import { copy } from "./i18n";
import "./studio.css";

export interface BrandAppearanceStudioProps {
  locale: Locale;
  className?: string;
  initialBrands?: BrandState[];
  initialActiveBrandId?: string;
}

export function BrandAppearanceStudio({
  locale,
  className,
  initialBrands,
  initialActiveBrandId,
}: BrandAppearanceStudioProps) {
  const t = copy(locale);
  const [brands, setBrands] = useState<BrandState[]>(
    initialBrands ?? DEFAULT_BRANDS
  );
  const [activeBrandId, setActiveBrandId] = useState<string>(
    initialActiveBrandId ?? brands[0]?.id ?? ""
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeBrandId) ?? brands[0],
    [brands, activeBrandId]
  );

  function updateActiveBrand(patch: Partial<BrandState>) {
    setBrands((prev) =>
      prev.map((b) => (b.id === activeBrand.id ? { ...b, ...patch } : b))
    );
  }

  function updateActiveAppearance(patch: Partial<BrandAppearance>) {
    setBrands((prev) =>
      prev.map((b) =>
        b.id === activeBrand.id
          ? { ...b, appearance: { ...b.appearance, ...patch } }
          : b
      )
    );
  }

  function handlePresetChange(presetId: PresetId) {
    updateActiveBrand(applyPresetToBrand(activeBrand, presetId));
  }

  function handleColorChange(role: PaletteRole, value: string) {
    const nextInput = { ...activeBrand.paletteInput, [role]: value };
    const nextPalette = {
      ...activeBrand.appearance.palette,
      [role]: safeHex(value),
    };
    updateActiveBrand({
      paletteInput: nextInput,
      appearance: {
        ...activeBrand.appearance,
        palette: nextPalette,
        customized: true,
      },
    });
  }

  function handleTypographyChange(
    role: keyof BrandState["appearance"]["typography"],
    key: keyof TypeRole,
    value: FontFamily | number
  ) {
    const nextRole = { ...activeBrand.appearance.typography[role], [key]: value } as TypeRole;
    updateActiveAppearance({
      typography: {
        ...activeBrand.appearance.typography,
        [role]: nextRole,
      },
      customized: true,
    });
  }

  function handleImport(imported: BrandState) {
    updateActiveBrand({
      appearance: imported.appearance,
      paletteInput: imported.paletteInput,
    });
  }

  const exportDisabled = hasInvalidPaletteValues(activeBrand.paletteInput);

  return (
    <div className={`ba-studio ${className ?? ""}`.trim()}>
      <header className="ba-header">
        <div className="ba-header-main">
          <div className="ba-header-titles">
            <h1 className="ba-header-title">{activeBrand.name}</h1>
            <p className="ba-header-meta">
              <span className="ba-header-draft">{t.headerTitle}</span>
              <span aria-hidden="true">·</span>
              <span>
                {t.revision} {activeBrand.revision}
              </span>
              {activeBrand.appearance.customized && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="ba-header-customized">{t.customized}</span>
                </>
              )}
            </p>
          </div>
          <div className="ba-header-actions">
            <BrandSwitcher
              brands={brands}
              activeBrandId={activeBrand.id}
              onChange={setActiveBrandId}
              locale={locale}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              {t.import}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDialogOpen(true)}
              disabled={exportDisabled}
            >
              {t.export}
            </Button>
          </div>
        </div>
      </header>

      <main className="ba-grid">
        <section className="ba-editor" aria-label={t.headerTitle}>
          <PresetSelector
            activePresetId={activeBrand.appearance.presetId}
            onChange={handlePresetChange}
            locale={locale}
          />
          <ColorEditor
            input={activeBrand.paletteInput}
            onChange={handleColorChange}
            locale={locale}
          />
          <ContrastStatus
            palette={activeBrand.appearance.palette}
            locale={locale}
          />
          <TypographyEditor
            typography={activeBrand.appearance.typography}
            onChange={handleTypographyChange}
            locale={locale}
          />
        </section>

        <section className="ba-preview-stage-section" aria-label={t.previewLabel}>
          <VideoOpeningPreview
            appearance={activeBrand.appearance}
            copy={activeBrand.copy.video}
            locale={locale}
          />
          <MetricRevealPreview
            appearance={activeBrand.appearance}
            copy={activeBrand.copy.metric}
            locale={locale}
          />
          <ThumbnailPreview
            appearance={activeBrand.appearance}
            copy={activeBrand.copy.thumbnail}
            locale={locale}
          />
        </section>
      </main>

      <JsonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        brand={activeBrand}
        locale={locale}
        onImport={handleImport}
      />
    </div>
  );
}

export default function BrandAppearanceSlot(props: FeatureSlotProps) {
  return (
    <BrandAppearanceStudio
      locale={props.locale}
      className={props.className}
    />
  );
}

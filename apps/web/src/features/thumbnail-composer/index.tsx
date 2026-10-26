import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field-input";
import { Surface } from "@/components/ui/surface-card";
import type { FeatureSlotProps } from "@/features/registry";
import { copyFor } from "./i18n";
import { ConceptPicker } from "./components/ConceptPicker";
import { PalettePicker } from "./components/PalettePicker";
import { ReadabilityPanel } from "./components/ReadabilityPanel";
import { ThumbnailPreviewCard } from "./components/ThumbnailPreviewCard";
import { composeThumbnail } from "./model/compose";
import {
  localizeExampleDefaults,
  recordExport,
  resetVariantCopy,
  selectConcept,
  setPalette,
  setPromise,
  setTopic,
  updateCopy,
} from "./model/edit";
import { downloadBlob, downloadSvg, thumbnailFileName, thumbnailPng, thumbnailSvg } from "./model/export";
import { createThumbnailDocument, HVAC_EXAMPLE_JA, VARIANT_ID_BY_CONCEPT } from "./model/fixtures";
import { issuesFor } from "./model/qa";
import type { ConceptId, Locale, ThumbnailCopy } from "./model/types";
import "./composer.css";

const FIELD_LIMITS = {
  topic: 140,
  promise: 220,
  headline: 120,
  value: 24,
  secondary: 180,
  compareValue: 24,
} as const;

type ExportState =
  | { kind: "idle" }
  | { kind: "busy"; revision: number }
  | { kind: "svg"; revision: number }
  | { kind: "png"; revision: number }
  | { kind: "error"; revision: number };

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Thumbnail Composer (Create → Thumbnail composer).
 *
 * Local-only: a deterministic fixture document, a typed authoring model and the
 * vendored Kumiki media pipeline. No backend, model call or upload is involved.
 */
export function ThumbnailComposer({ projectId, locale, className, onPreviewChange }: FeatureSlotProps) {
  const copy = copyFor(locale);
  const [document, setDocument] = useState(() =>
    createThumbnailDocument({
      projectId,
      ...(locale === "ja" ? HVAC_EXAMPLE_JA : {}),
    })
  );
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const mounted = useRef(true);
  const previousLocale = useRef<Locale>(locale);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Follow the interface language for untouched example copy only. Anything the
  // person typed is preserved across a language switch.
  useEffect(() => {
    const from = previousLocale.current;
    previousLocale.current = locale;
    if (from === locale) return;
    setDocument((current) => localizeExampleDefaults(current, from, locale));
  }, [locale]);

  const variant =
    document.variants.find((candidate) => candidate.id === document.activeVariantId) ??
    document.variants[0];
  const artwork = variant.copy[locale];
  const issues = useMemo(
    () => (variant ? issuesFor(document, variant.id, locale) : []),
    [document, variant, locale]
  );
  const blocked = issues.some((issue) => issue.severity === "error");

  const composed = useMemo(() => composeThumbnail(document, { locale }), [document, locale]);
  const media = composed.media;

  // The export action serializes the SVG. Rendering needs only cheap, stable metadata.
  const exportSize = { width: document.output.width, height: document.output.height };
  const exported = { size: exportSize, filename: thumbnailFileName(document, { locale }, "svg", exportSize) };

  const previewNode = useMemo(
    () =>
      onPreviewChange && variant
        ? (
            <ThumbnailPreviewCard
              media={media}
              concept={variant.concept}
              artwork={artwork}
              issues={issues}
              copy={copy}
              topic={document.topic}
            />
          )
        : null,
    [onPreviewChange, media, variant, artwork, issues, copy, document.topic]
  );

  useEffect(() => {
    if (!onPreviewChange) return;
    onPreviewChange(previewNode);
    return () => onPreviewChange(null);
  }, [onPreviewChange, previewNode]);

  const updateArtwork = useCallback(
    (patch: Partial<ThumbnailCopy>) => {
      setDocument((current) => updateCopy(current, locale, patch));
    },
    [locale]
  );

  const onSelectConcept = useCallback((concept: ConceptId) => {
    setDocument((current) => selectConcept(current, VARIANT_ID_BY_CONCEPT[concept]));
  }, []);

  const handleSvg = useCallback(() => {
    const revision = document.revision;
    try {
      const result = thumbnailSvg(document, { locale });
      downloadSvg(result);
      setDocument((current) =>
        recordExport(current, {
          format: "svg",
          width: result.size.width,
          height: result.size.height,
          fileName: result.filename,
          revision,
        })
      );
      setExportState({ kind: "svg", revision });
    } catch {
      setExportState({ kind: "error", revision });
    }
  }, [document, locale]);

  const handlePng = useCallback(async () => {
    const revision = document.revision;
    setExportState({ kind: "busy", revision });
    try {
      const result = await thumbnailPng(document, { locale });
      if (!mounted.current) return;
      downloadBlob(result.blob, result.filename);
      setDocument((current) =>
        recordExport(current, {
          format: "png",
          width: result.size.width,
          height: result.size.height,
          fileName: result.filename,
          revision,
        })
      );
      setExportState({ kind: "png", revision });
    } catch {
      if (mounted.current) setExportState({ kind: "error", revision });
    }
  }, [document, locale]);

  if (!variant) {
    return null;
  }

  return (
    <div className={joinClasses("tc-root", className)} data-locale={locale} data-testid="thumbnail-composer">
      <header className="tc-header">
        <div className="tc-header__text">
          <h2 className="tc-header__title">{copy.title}</h2>
          <p className="tc-header__subtitle">{copy.subtitle}</p>
        </div>
        <p className="tc-header__note">{copy.localOnlyNote}</p>
      </header>

      <Surface variant="outline" className="tc-brief">
        <div className="tc-fields">
          <Field
            label={copy.topicLabel}
            hint={copy.topicHint}
            value={document.topic}
            maxLength={FIELD_LIMITS.topic}
            onChange={(event) => setDocument((current) => setTopic(current, event.target.value))}
          />
          <Field
            label={copy.promiseLabel}
            hint={copy.promiseHint}
            value={document.promise}
            maxLength={FIELD_LIMITS.promise}
            onChange={(event) => setDocument((current) => setPromise(current, event.target.value))}
          />
        </div>
      </Surface>

      <section className="tc-section" aria-labelledby="tc-concept-heading">
        <div className="tc-section__header">
          <h3 className="tc-section__title" id="tc-concept-heading">
            {copy.conceptHeading}
          </h3>
          <p className="tc-section__hint">{copy.conceptHint}</p>
        </div>
        <ConceptPicker activeConcept={variant.concept} copy={copy} onSelect={onSelectConcept} />
      </section>

      <section className="tc-section" aria-labelledby="tc-copy-heading">
        <div className="tc-section__header">
          <h3 className="tc-section__title" id="tc-copy-heading">
            {copy.copyHeading}
          </h3>
          <p className="tc-section__hint">{copy.copyHint}</p>
        </div>
        <div className="tc-fields">
          <div className="tc-field">
            <Field
              label={copy.headlineLabel}
              hint={copy.headlineHint}
              value={artwork.headline}
              maxLength={FIELD_LIMITS.headline}
              onChange={(event) => updateArtwork({ headline: event.target.value })}
            />
            <span className="tc-field__count">
              {copy.charCount([...artwork.headline].length, FIELD_LIMITS.headline)}
            </span>
          </div>
          <div className="tc-field">
            <Field
              label={copy.valueLabel}
              hint={copy.valueHint}
              value={artwork.value}
              maxLength={FIELD_LIMITS.value}
              onChange={(event) => updateArtwork({ value: event.target.value })}
            />
            <span className="tc-field__count">
              {copy.charCount([...artwork.value].length, FIELD_LIMITS.value)}
            </span>
          </div>
          {variant.concept === "quote-gap" ? (
            <div className="tc-field">
              <Field
                label={copy.compareLabel}
                hint={copy.compareHint}
                error={artwork.compareValue?.trim() ? undefined : copy.compareRequired}
                value={artwork.compareValue ?? ""}
                maxLength={FIELD_LIMITS.compareValue}
                onChange={(event) => updateArtwork({ compareValue: event.target.value })}
              />
              <span className="tc-field__count">
                {copy.charCount([...(artwork.compareValue ?? "")].length, FIELD_LIMITS.compareValue)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="tc-copy__secondary">
          <Field
            label={copy.secondaryLabel}
            hint={copy.secondaryHint}
            value={artwork.secondary}
            maxLength={FIELD_LIMITS.secondary}
            onChange={(event) => updateArtwork({ secondary: event.target.value })}
          />
          <span className="tc-field__count">
            {copy.charCount([...artwork.secondary].length, FIELD_LIMITS.secondary)}
          </span>
        </div>
        <div className="tc-copy__actions">
          <Button variant="subtle" size="sm" onClick={() => setDocument((current) => resetVariantCopy(current))}>
            {copy.resetAction}
          </Button>
          <p className="tc-copy__hint">{copy.resetHint}</p>
        </div>
      </section>

      <section className="tc-section" aria-labelledby="tc-palette-heading">
        <div className="tc-section__header">
          <h3 className="tc-section__title" id="tc-palette-heading">
            {copy.paletteHeading}
          </h3>
          <p className="tc-section__hint">{copy.paletteHint}</p>
        </div>
        <PalettePicker
          paletteId={document.paletteId}
          copy={copy}
          onSelect={(paletteId) => {
            setDocument((current) => setPalette(current, paletteId));
          }}
        />
      </section>

      {!onPreviewChange ? (
        <section className="tc-section" aria-labelledby="tc-inline-preview-heading">
          <div className="tc-section__header">
            <h3 className="tc-section__title" id="tc-inline-preview-heading">
              {copy.previewHeading}
            </h3>
            <p className="tc-section__hint">{copy.previewHint}</p>
          </div>
          <ThumbnailPreviewCard
            media={media}
            concept={variant.concept}
            artwork={artwork}
            issues={issues}
            copy={copy}
            topic={document.topic}
            testId="thumbnail-inline-preview"
          />
        </section>
      ) : null}

      <ReadabilityPanel
        media={media}
        issues={issues}
        copy={copy}
        label={`${copy.conceptNames[variant.concept]}: ${artwork.headline}`}
      />

      <section className="tc-section" aria-labelledby="tc-export-heading">
        <div className="tc-section__header">
          <h3 className="tc-section__title" id="tc-export-heading">
            {copy.exportHeading}
          </h3>
          <p className="tc-section__hint">{copy.exportHint}</p>
        </div>
        <div className="tc-export">
          <div className="tc-export__actions">
            <Button variant="primary" onClick={handleSvg} disabled={blocked}>
              {copy.exportSvg}
            </Button>
            <Button
              variant="outline"
              onClick={handlePng}
              isLoading={exportState.kind === "busy"}
              loadingLabel={copy.exporting}
              disabled={blocked || exportState.kind === "busy"}
            >
              {copy.exportPng}
            </Button>
          </div>
          <p className="tc-export__size">
            {copy.exportSize(exported.size.width, exported.size.height)}
            {exported.filename ? <span className="tc-export__file">{exported.filename}</span> : null}
          </p>
          {exportState.kind === "svg" && exportState.revision === document.revision ? (
            <p className="tc-export__status" role="status">
              {copy.exportSuccessSvg}
            </p>
          ) : null}
          {exportState.kind === "png" && exportState.revision === document.revision ? (
            <p className="tc-export__status" role="status">
              {copy.exportSuccessPng}
            </p>
          ) : null}
          {exportState.kind === "error" && exportState.revision === document.revision ? (
            <div className="tc-export__error" role="alert">
              <p className="tc-export__error-title">{copy.exportErrorTitle}</p>
              <p className="tc-export__error-hint">{copy.exportErrorHint}</p>
            </div>
          ) : null}
          {blocked ? <p className="tc-export__blocked">{copy.checksBlocked(issues.filter((issue) => issue.severity === "error").length)}</p> : null}
        </div>
      </section>

      <details className="tc-details">
        <summary className="tc-details__summary">{copy.detailsSummary}</summary>
        <div className="tc-details__body">
          <dl className="tc-details__facts">
            <div>
              <dt>{copy.brandLabel}</dt>
              <dd>
                {document.brand.brandName} · rev {document.brand.revision}
              </dd>
            </div>
            <div>
              <dt>{copy.provenanceSynthetic}</dt>
              <dd>{copy.safeInsetLabel(Math.round(document.output.safeInset * 100))}</dd>
            </div>
            <div>
              <dt>{copy.revisionLabel(document.revision)}</dt>
              <dd>{copy.exportSize(document.output.width, document.output.height)}</dd>
            </div>
          </dl>
          <h4 className="tc-subheading">{copy.provenanceHeading}</h4>
          <p className="tc-details__note">{copy.provenanceNote}</p>
          <ul className="tc-details__sources">
            {document.provenance.sources.map((source) => (
              <li key={source.id}>
                <span className="tc-details__source-label">{source.label}</span>
                {source.note ? <span className="tc-details__source-note">{source.note}</span> : null}
              </li>
            ))}
          </ul>
          <h4 className="tc-subheading">{copy.provenanceSources}</h4>
          <ul className="tc-details__elements">
            {variant.elements.map((element) => (
              <li key={element.id}>
                <code>{element.id}</code>
                <span>{element.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <footer className="tc-footer">
        <span className="tc-footer__badge">{copy.provenanceSynthetic}</span>
        <span>{document.brand.brandName}</span>
        <span>{copy.revisionLabel(document.revision)}</span>
      </footer>
    </div>
  );
}

export default ThumbnailComposer;

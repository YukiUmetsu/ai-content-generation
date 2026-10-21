import { Input } from "@/components/ui/input";
import type { Locale, PaletteRole } from "../model/types";
import { PALETTE_ROLES } from "../model/types";
import { isValidHex, normalizeHex } from "../model/palette";
import { ROLE_HINTS, ROLE_LABELS, copy } from "../i18n";

interface ColorEditorProps {
  input: Record<PaletteRole, string>;
  onChange: (role: PaletteRole, value: string) => void;
  locale: Locale;
}

export function ColorEditor({ input, onChange, locale }: ColorEditorProps) {
  const t = copy(locale);
  return (
    <fieldset className="ba-color-fieldset">
      <legend className="ba-section-title">{t.colorsLabel}</legend>
      <div className="ba-color-list">
        {PALETTE_ROLES.map((role) => {
          const value = input[role];
          const invalid = !isValidHex(value);
          const swatchValue = normalizeHex(value) ?? "#808080";
          return (
            <div key={role} className="ba-color-row">
              <label
                className="ba-color-swatch-label"
                htmlFor={`ba-color-${role}`}
              >
                <input
                  id={`ba-color-${role}`}
                  type="color"
                  value={swatchValue}
                  onChange={(e) => onChange(role, e.target.value)}
                  className="ba-color-swatch"
                  aria-label={`${ROLE_LABELS[locale][role]} color`}
                />
              </label>
              <div className="ba-color-fields">
                <div className="ba-color-meta">
                  <span className="ba-color-role">
                    {ROLE_LABELS[locale][role]}
                  </span>
                  <span className="ba-color-hint">
                    {ROLE_HINTS[locale][role]}
                  </span>
                </div>
                <Input
                  value={value}
                  onChange={(e) => onChange(role, e.target.value)}
                  aria-invalid={invalid || undefined}
                  aria-label={`${ROLE_LABELS[locale][role]} hex`}
                  className="ba-color-hex"
                  spellCheck={false}
                  autoComplete="off"
                />
                {invalid && (
                  <span className="ba-color-error" role="alert">
                    {t.invalidHex}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

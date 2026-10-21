import type { BrandTypography, FontFamily, Locale, TypeRole } from "../model/types";
import { APPROVED_FAMILIES, APPROVED_WEIGHTS } from "../model/types";
import { FONT_STACKS } from "../model/fonts";
import { copy } from "../i18n";

interface TypographyEditorProps {
  typography: BrandTypography;
  onChange: (
    role: keyof BrandTypography,
    key: keyof TypeRole,
    value: FontFamily | number
  ) => void;
  locale: Locale;
}

const ROLE_KEYS = ["display", "body", "numbers"] as const;

const SPECIMENS = {
  display: "Ag",
  body: "The quick brown fox jumps over the lazy dog.",
  numbers: "123,456.78",
};

export function TypographyEditor({
  typography,
  onChange,
  locale,
}: TypographyEditorProps) {
  const t = copy(locale);
  const roleLabels: Record<(typeof ROLE_KEYS)[number], string> = {
    display: t.displayRole,
    body: t.bodyRole,
    numbers: t.numbersRole,
  };

  return (
    <fieldset className="ba-type-fieldset">
      <legend className="ba-section-title">{t.typographyLabel}</legend>
      <div className="ba-type-list">
        {ROLE_KEYS.map((role) => {
          const setting = typography[role];
          return (
            <div key={role} className="ba-type-row">
              <div className="ba-type-controls">
                <label className="ba-type-role-label">{roleLabels[role]}</label>
                <div className="ba-type-selects">
                  <select
                    value={setting.family}
                    onChange={(e) =>
                      onChange(role, "family", e.target.value as FontFamily)
                    }
                    aria-label={`${roleLabels[role]} ${t.familyLabel}`}
                    className="ba-type-select"
                  >
                    {APPROVED_FAMILIES.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    ))}
                  </select>
                  <select
                    value={setting.weight}
                    onChange={(e) =>
                      onChange(role, "weight", Number(e.target.value))
                    }
                    aria-label={`${roleLabels[role]} ${t.weightLabel}`}
                    className="ba-type-select"
                  >
                    {APPROVED_WEIGHTS.map((weight) => (
                      <option key={weight} value={weight}>
                        {weight}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div
                className="ba-type-specimen"
                style={{
                  fontFamily: FONT_STACKS[setting.family],
                  fontWeight: setting.weight,
                }}
              >
                {SPECIMENS[role]}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

import type { BrandPalette, Locale } from "../model/types";
import { findContrastIssues } from "../model/palette";
import { ROLE_LABELS, copy } from "../i18n";

interface ContrastStatusProps {
  palette: BrandPalette;
  locale: Locale;
}

export function ContrastStatus({ palette, locale }: ContrastStatusProps) {
  const t = copy(locale);
  const issues = findContrastIssues(palette);

  return (
    <div role="status" aria-live="polite" className="ba-contrast-status">
      {issues.length === 0 ? (
        <span className="ba-contrast-ok">{t.contrastStatusOk}</span>
      ) : (
        <div className="ba-contrast-issues">
          <strong className="ba-contrast-heading">
            {t.contrastIssues(issues.length)}
          </strong>
          <ul className="ba-contrast-list">
            {issues.map((issue, index) => (
              <li key={`${issue.foreground}-${issue.background}-${index}`}>
                {ROLE_LABELS[locale][issue.foreground]} vs{" "}
                {ROLE_LABELS[locale][issue.background]} —{" "}
                {t.contrastRatio(issue.ratio)} ({t.required(issue.required)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

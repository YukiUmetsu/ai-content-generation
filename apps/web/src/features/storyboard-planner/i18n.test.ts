import { describe, expect, it } from "vitest";
import { copy, describeDiagnostic } from "./i18n";
import { HVAC_EXAMPLE } from "./model/hvac-example";

describe("teaching sequence editor language", () => {
  it("shows actionable localized diagnostics instead of raw internal codes", () => {
    for (const code of ["storyboard-teaching-state-invalid", "storyboard-teaching-state-diverged"]) {
      for (const locale of ["en", "ja"] as const) {
        const message = describeDiagnostic(
          { code, severity: "error", beatId: HVAC_EXAMPLE.beats[0].id, path: "beats[0].teachingState" },
          locale,
          HVAC_EXAMPLE
        );
        expect(message).not.toBe(code);
        expect(message).toMatch(locale === "en" ? /Beat 1/ : /ビート 1/);
      }
    }
  });

  it("localizes the editable before, action and after labels", () => {
    expect(copy("en").teachingStateBefore).toMatch(/Before/);
    expect(copy("ja").teachingStateBefore).toMatch(/変化前/);
    expect(copy("ja").teachingStateAction).toMatch(/変化/);
    expect(copy("ja").teachingStateAfter).toMatch(/変化後/);
  });
});

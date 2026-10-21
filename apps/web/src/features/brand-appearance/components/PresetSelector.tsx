import { Check } from "lucide-react";
import { Surface } from "@/components/ui/surface-card";
import type { Locale, PresetId } from "../model/types";
import { PRESETS, PRESET_ORDER } from "../model/presets";
import { copy } from "../i18n";

interface PresetSelectorProps {
  activePresetId: PresetId;
  onChange: (presetId: PresetId) => void;
  locale: Locale;
}

export function PresetSelector({
  activePresetId,
  onChange,
  locale,
}: PresetSelectorProps) {
  const t = copy(locale);
  return (
    <fieldset className="ba-preset-fieldset">
      <legend className="ba-section-title">{t.presetsLabel}</legend>
      <div className="ba-preset-grid" role="group">
        {PRESET_ORDER.map((presetId) => {
          const preset = PRESETS[presetId];
          const selected = presetId === activePresetId;
          return (
            <Surface
              key={presetId}
              interactive
              variant={selected ? "outline" : "ghost"}
              aria-pressed={selected}
              onClick={() => onChange(presetId)}
              className={`ba-preset-card ${
                selected ? "ba-preset-card-selected" : ""
              }`}
            >
              <div className="ba-preset-card-header">
                <span className="ba-preset-name">{preset.name}</span>
                {selected && (
                  <span className="ba-preset-check" aria-hidden="true">
                    <Check className="ba-preset-check-icon" />
                  </span>
                )}
              </div>
              <p className="ba-preset-description">
                {preset.description[locale]}
              </p>
              <div className="ba-preset-traits">
                {preset.traits.map((trait) => (
                  <span key={trait} className="ba-preset-trait">
                    {trait}
                  </span>
                ))}
              </div>
            </Surface>
          );
        })}
      </div>
    </fieldset>
  );
}

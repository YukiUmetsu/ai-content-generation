import { useId } from "react";
import type { ComposerCopy } from "../i18n";
import { paletteFor } from "../model/palettes";
import { PALETTE_IDS } from "../model/palettes";
import type { PaletteId } from "../model/types";

export interface PalettePickerProps {
  paletteId: PaletteId;
  copy: ComposerCopy;
  onSelect: (paletteId: PaletteId) => void;
}

/** Palette choice as a native radio group with visible swatches. */
export function PalettePicker({ paletteId, copy, onSelect }: PalettePickerProps) {
  const name = useId();
  return (
    <div className="tc-palettes" role="radiogroup" aria-label={copy.paletteGroupLabel}>
      {PALETTE_IDS.map((id) => {
        const palette = paletteFor(id);
        const checked = id === paletteId;
        const inputId = `${name}-${id}`;
        return (
          <label
            key={id}
            className="tc-palette"
            data-active={checked ? "true" : "false"}
            htmlFor={inputId}
          >
            <input
              id={inputId}
              className="tc-palette__input"
              type="radio"
              name={name}
              value={id}
              checked={checked}
              onChange={() => onSelect(id)}
            />
            <span className="tc-palette__swatches" aria-hidden="true">
              {(
                [
                  palette.roles.background,
                  palette.roles.surface,
                  palette.roles.text,
                  palette.roles.accent,
                ] as const
              ).map((color) => (
                <span key={color} className="tc-palette__swatch" style={{ background: color }} />
              ))}
            </span>
            <span className="tc-palette__name">{copy.paletteNames[id]}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Stable title + explanation layout within one bounded explainer-video card.
 * The two blocks share a height budget. Never clip or truncate authored text.
 * Glyph boxes stay inside the export guard in video-export/main.tsx:
 * 12px from the top of the card and 10px from the bottom.
 */
import { fitSvgText } from "./text-layout.mjs";

const SAFE_TOP = 12;
const SAFE_BOTTOM = 10;
/** Geist's measured glyph box is taller than a 1.22em line. */
const ASCENT = 1.08;
const DESCENT = 0.5;
const fits = (value, width, size) => {
  try { return fitSvgText(value, { maxWidthPx: width, preferredSize: size, minSize: size, maxLines: 3 }); }
  catch { return null; }
};
function block(fitted, size) {
  const lineBox = size * (ASCENT + DESCENT);
  return { ...fitted, leading: Math.ceil(lineBox), height: fitted.lines.length * lineBox,
    baselines: fitted.lines.map((_, index) => size * ASCENT + index * lineBox) };
}

export function layoutTeachingCard({ label, note, width, height }) {
  if (typeof label !== "string" || !label.trim() || typeof note !== "string" || !note.trim() ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 90 || height <= 50) {
    throw new Error("Teaching card needs text and positive usable geometry.");
  }
  // The label is centered 5px right of the card midpoint, so the right inset needs the extra shift.
  const maxWidth = width - 48;
  const gap = height < 115 ? 6 : 8;
  const titlePreferred = height < 115 ? 22 : height < 145 ? 27 : 30;
  const detailPreferred = height < 115 ? 16 : height < 145 ? 19 : 21;
  const available = height - SAFE_TOP - SAFE_BOTTOM;
  for (let shrink = 0; shrink <= 18; shrink++) {
    const titleSize = Math.max(16, titlePreferred - shrink);
    const detailSize = Math.max(14, detailPreferred - Math.ceil(shrink * .65));
    const title = block(fits(label, maxWidth, titleSize) ?? { lines: [] }, titleSize);
    const detail = block(fits(note, maxWidth, detailSize) ?? { lines: [] }, detailSize);
    if (!title.lines.length || !detail.lines.length) continue;
    const occupied = title.height + gap + detail.height;
    if (occupied > available) continue;
    const top = SAFE_TOP + Math.round((available - occupied) / 2);
    const titleBaselines = title.baselines.map(baseline => Math.round(top + baseline));
    const detailTop = top + title.height + gap;
    const detailBaselines = detail.baselines.map(baseline => Math.round(detailTop + baseline));
    const glyphTop = titleBaselines[0] - titleSize * ASCENT;
    const glyphBottom = detailBaselines.at(-1) + detailSize * DESCENT;
    if (glyphTop < SAFE_TOP - 0.5 || glyphBottom > height - SAFE_BOTTOM + 0.5) continue;
    return { title: { lines: title.lines, fontSize: title.fontSize, baselines: titleBaselines, leading: title.leading },
      detail: { lines: detail.lines, fontSize: detail.fontSize, baselines: detailBaselines, leading: detail.leading },
      maxWidth, titleBottom: top + title.height, detailTop, contentBottom: glyphBottom };
  }
  throw new Error(`Teaching card copy cannot fit ${width}x${height} without overlapping. Shorten the title or explanation.`);
}

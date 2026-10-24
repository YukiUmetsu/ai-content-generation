/** Stable title + explanation layout within one bounded explainer-video card.
 * The two blocks share a height budget. Never clip or truncate authored text.
 */
import { fitSvgText } from "./text-layout.mjs";

const LINE_HEIGHT = 1.22;
const fits = (value, width, size) => {
  try { return fitSvgText(value, { maxWidthPx: width, preferredSize: size, minSize: size, maxLines: 3 }); }
  catch { return null; }
};

export function layoutTeachingCard({ label, note, width, height }) {
  if (typeof label !== "string" || !label.trim() || typeof note !== "string" || !note.trim() ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 90 || height <= 50) {
    throw new Error("Teaching card needs text and positive usable geometry.");
  }
  const maxWidth = width - 60; // keep copy off both frame and left decoration
  const inset = height < 115 ? 8 : 12;
  const gap = height < 115 ? 5 : 8;
  const titlePreferred = height < 115 ? 25 : height < 145 ? 27 : 30;
  const detailPreferred = height < 115 ? 18 : height < 145 ? 19 : 21;
  for (let shrink = 0; shrink <= 18; shrink++) {
    const titleSize = Math.max(16, titlePreferred - shrink);
    const detailSize = Math.max(14, detailPreferred - Math.ceil(shrink * .65));
    const title = fits(label, maxWidth, titleSize);
    const detail = fits(note, maxWidth, detailSize);
    if (!title || !detail) continue;
    const titleLeading = Math.ceil(titleSize * LINE_HEIGHT);
    const detailLeading = Math.ceil(detailSize * LINE_HEIGHT);
    const titleHeight = title.lines.length * titleLeading;
    const detailHeight = detail.lines.length * detailLeading;
    const occupied = titleHeight + gap + detailHeight;
    if (occupied + 2 * inset > height) continue;
    const top = Math.round((height - occupied) / 2);
    const titleBaselines = title.lines.map((_, i) => top + Math.round(titleSize * .95) + i * titleLeading);
    const detailBaselines = detail.lines.map((_, i) => top + titleHeight + gap + Math.round(detailSize * .95) + i * detailLeading);
    return { title: { ...title, baselines: titleBaselines, leading: titleLeading },
      detail: { ...detail, baselines: detailBaselines, leading: detailLeading }, maxWidth,
      // Conservative line-box boundaries; the browser still checks exact getBBox.
      titleBottom: top + titleHeight, detailTop: top + titleHeight + gap,
      contentBottom: top + occupied };
  }
  throw new Error(`Teaching card copy cannot fit ${width}x${height} without overlapping. Shorten the title or explanation.`);
}

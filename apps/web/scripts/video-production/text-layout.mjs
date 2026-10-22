/** Deterministic, conservative SVG title layout for Latin, CJK and emoji copy. */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const glyphs = (s) => Array.from(graphemes.segment(s), ({ segment }) => segment);

/** Upper-bound width heuristic in pixels; browser bounds are a separate acceptance gate. */
export function estimateSvgLineWidth(line, fontSize) {
  return glyphs(line).reduce((width, glyph) => {
    if (/^\s+$/u.test(glyph)) return width + 0.36 * fontSize;
    if (/^[A-Z]$/u.test(glyph)) return width + 0.76 * fontSize;
    if (/^[a-z\d]$/u.test(glyph)) return width + 0.66 * fontSize;
    if (/^[\u0021-\u007e]$/u.test(glyph)) return width + 0.55 * fontSize;
    return width + 1.08 * fontSize;
  }, 0);
}

function wrapAtSize(content, width, fontSize) {
  const lines = [];
  let current = "";
  const flush = () => { if (current) { lines.push(current); current = ""; } };
  for (const word of content.trim().split(/\s+/u)) {
    if (!word) continue;
    const spaced = current ? `${current} ${word}` : word;
    if (estimateSvgLineWidth(spaced, fontSize) <= width) { current = spaced; continue; }
    flush();
    if (estimateSvgLineWidth(word, fontSize) <= width) { current = word; continue; }
    for (const glyph of glyphs(word)) {
      const next = current + glyph;
      if (estimateSvgLineWidth(next, fontSize) > width) flush();
      if (estimateSvgLineWidth(glyph, fontSize) > width) throw new Error("SVG glyph itself cannot fit the available width");
      current += glyph;
    }
  }
  flush();
  return lines;
}

/** Full text is retained; impossible copy fails rather than disappearing off-canvas. */
export function fitSvgText(content, { maxWidthPx, preferredSize, minSize, maxLines }) {
  if (typeof content !== "string" || !content.trim() ||
      ![maxWidthPx, preferredSize, minSize, maxLines].every((n) => Number.isFinite(n) && n > 0) ||
      !Number.isInteger(preferredSize) || !Number.isInteger(minSize) || !Number.isInteger(maxLines) ||
      minSize > preferredSize || maxLines > 6) throw new Error("Invalid SVG text fit request");
  for (let fontSize = preferredSize; fontSize >= minSize; fontSize -= 1) {
    const lines = wrapAtSize(content, maxWidthPx, fontSize);
    if (lines.length <= maxLines) return { lines, fontSize };
  }
  throw new Error("SVG copy cannot fit within its allowed width and line count without truncation");
}

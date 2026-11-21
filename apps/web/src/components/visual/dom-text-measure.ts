/** Browser boundary: measure with the same DOM font, shaping and letter spacing
 * as the visible paragraph. No canvas heuristics or screenshot recognition. */
export function measureDOMTypography(element: HTMLElement) {
  const computed = getComputedStyle(element);
  const fontSizePx = Number.parseFloat(computed.fontSize);
  const font = computed.font || `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
  const original = element.textContent;
  // Layout pixels, not screen pixels: a scaled ancestor (a preview fitted to its column, a zoomed stage) shrinks
  // getBoundingClientRect but not the layout the text is placed in. A long sample gives the ratio to sub-pixel precision.
  element.textContent = "M".repeat(64);
  const screen = element.getBoundingClientRect().width, layout = element.offsetWidth;
  element.textContent = original;
  const scale = screen > 0 && layout > 0 ? screen / layout : 1;
  const measure = (_font: string, text: string) => {
    element.textContent = text;
    const width = element.getBoundingClientRect().width / scale;
    element.textContent = original;
    return width;
  };
  let lineHeightPx = Number.parseFloat(computed.lineHeight);
  if (!Number.isFinite(lineHeightPx)) {
    element.textContent = "M\nM";
    lineHeightPx = element.getBoundingClientRect().height / 2 / scale;
    element.textContent = original;
  }
  return { font, fontSizePx, lineHeightPx, measure };
}

/** Browser boundary: measure with the same DOM font, shaping and letter spacing
 * as the visible paragraph. No canvas heuristics or screenshot recognition. */
export function measureDOMTypography(element: HTMLElement) {
  const computed = getComputedStyle(element);
  const fontSizePx = Number.parseFloat(computed.fontSize);
  const font = computed.font || `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
  const original = element.textContent;
  const measure = (_font: string, text: string) => {
    element.textContent = text;
    const width = element.getBoundingClientRect().width;
    element.textContent = original;
    return width;
  };
  let lineHeightPx = Number.parseFloat(computed.lineHeight);
  if (!Number.isFinite(lineHeightPx)) {
    element.textContent = "M\nM";
    lineHeightPx = element.getBoundingClientRect().height / 2;
    element.textContent = original;
  }
  return { font, fontSizePx, lineHeightPx, measure };
}

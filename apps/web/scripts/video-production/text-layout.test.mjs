import assert from "node:assert/strict";
import test from "node:test";
import { fitSvgText, estimateSvgLineWidth } from "./text-layout.mjs";

test("very long Japanese headline wraps to safe width without dropping a character", () => {
  const heading = "住宅ローンと固定資産税と保険料と修繕費を三十年間ずっと支払うと総額はいくらになるのでしょうか";
  const result = fitSvgText(heading, { maxWidthPx: 800, preferredSize: 73, minSize: 32, maxLines: 3 });
  assert.ok(result.lines.length > 1 && result.lines.length <= 3);
  assert.equal(result.lines.join(""), heading);
  assert.ok(result.lines.every((line) => estimateSvgLineWidth(line, result.fontSize) <= 800));
});

test("long unbroken Latin copy wraps instead of silently overflowing one SVG line", () => {
  const heading = "THEHIDDENLIFETIMECOSTOFMORTGAGEINTERESTINSURANCEANDMAINTENANCE";
  const result = fitSvgText(heading, { maxWidthPx: 800, preferredSize: 73, minSize: 32, maxLines: 3 });
  assert.equal(result.lines.join(""), heading);
  assert.ok(result.lines.length > 1);
  assert.ok(result.lines.every((line) => estimateSvgLineWidth(line, result.fontSize) <= 800));
});

test("English words wrap at whitespace and unsupported copy fails rather than truncating", () => {
  const result = fitSvgText("WHY THE LISTING PRICE IS NOT THE LIFETIME COST", { maxWidthPx: 800, preferredSize: 73, minSize: 32, maxLines: 3 });
  assert.equal(result.lines.join(" ").replace(/\s+/g, " ").trim(), "WHY THE LISTING PRICE IS NOT THE LIFETIME COST");
  assert.throws(() => fitSvgText("家".repeat(300), { maxWidthPx: 800, preferredSize: 73, minSize: 32, maxLines: 3 }), /fit|overflow/i);
});

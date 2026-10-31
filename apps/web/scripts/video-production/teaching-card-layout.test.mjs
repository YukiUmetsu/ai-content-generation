import assert from "node:assert/strict";
import test from "node:test";
import { layoutTeachingCard } from "./teaching-card-layout.mjs";
import { estimateSvgLineWidth } from "./text-layout.mjs";

const examples = [
  { label: "Mortgage interest", note: "Borrowing adds interest over time", width: 680, height: 94 },
  { label: "Property tax", note: "An annual local ownership charge", width: 555, height: 110 },
  { label: "Repairs and maintenance", note: "Recurring upkeep and unexpected repairs", width: 345, height: 124 },
  { label: "A data packet", note: "Same packet travels across a network", width: 220, height: 165 },
  { label: "Costs", note: "Additional payments beyond the listing price", width: 625, height: 100 },
  { label: "住宅ローン", note: "支払う利息が長年にわたって増えていきます", width: 345, height: 124 },
  { label: "File automation", note: "Supporting files stay attached to invoices", width: 650, height: 84 },
];
test("title and explanatory note fit as one nonoverlapping block at actual scene dimensions", () => {
  for (const example of examples) {
    const first = layoutTeachingCard(example);
    assert.deepEqual(first, layoutTeachingCard(example), "absolute-frame rendering stays deterministic");
    const compact = (v) => v.replace(/\s+/gu, "");
    assert.equal(compact(first.title.lines.join("")), compact(example.label));
    assert.equal(compact(first.detail.lines.join("")), compact(example.note));
    assert.ok(first.titleBottom < first.detailTop, "title and explanation must never collide");
    assert.ok(first.contentBottom <= example.height - 10, "glyph box must stay 10px inside the card bottom");
    const glyphTop = first.title.baselines[0] - first.title.fontSize * 1.08;
    assert.ok(glyphTop >= 11.5, "glyph box must stay 12px inside the card top");
    assert.ok(first.title.baselines.every(Number.isFinite));
    for (const block of [first.title, first.detail]) {
      for (const line of block.lines) {
        assert.ok(estimateSvgLineWidth(line, block.fontSize) <= first.maxWidth);
      }
    }
  }
});
test("impossible compact copy fails closed instead of clipping or eliding", () => {
  assert.throws(() => layoutTeachingCard({
    label: "X".repeat(44), note: "Y".repeat(44), width: 110, height: 60,
  }), /Shorten|fit/);
});

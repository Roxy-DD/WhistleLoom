const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const source = fs.readFileSync("js/score-layout.js", "utf8");
vm.runInNewContext(source, { window });

test("normalizes paper, direction, margins and row counts to supported values", () => {
  const settings = window.ScoreLayout.normalize({ paperSize: "bad", orientation: "landscape", marginMm: 99, measuresPerRow: 4.8 });
  assert.equal(settings.paperSize, "A4");
  assert.equal(settings.orientation, "landscape");
  assert.equal(settings.marginMm, 30);
  assert.equal(settings.measuresPerRow, 5);
  assert.ok(settings.widthMm > settings.heightMm);
});

test("paginates complete measure rows and landscape fits fewer rows", () => {
  const bars = Array.from({ length: 30 }, (_, i) => i);
  const portrait = window.ScoreLayout.layout(bars, { measuresPerRow: 2 }, 100, 160);
  const landscape = window.ScoreLayout.layout(bars, { measuresPerRow: 2, orientation: "landscape" }, 100, 160);
  assert.equal(portrait.pages.flat().length, 15);
  assert.equal(landscape.pages.flat().length, 15);
  assert.ok(landscape.pages.length > portrait.pages.length);
  for (const page of portrait.pages) assert.ok(page.length > 0);
});

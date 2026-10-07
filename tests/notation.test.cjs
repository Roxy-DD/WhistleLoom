const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
// notation.js 的 aria-label 现在走 tr()（见 vm-i18n.cjs）。
const i18n = require("./vm-i18n.cjs");

const notation = fs.readFileSync(
  path.join(__dirname, "..", "js", "notation.js"),
  "utf8",
);
const context = vm.createContext({
  selected: -1,
  playingIndex: -1,
  spellScoreMidi: () => ({ letter: "B", acc: "" }),
  keySignature: () => ({ map: {}, count: 0, order: [], flat: false }),
  noteY: (pitch) => pitch,
  solfege: () => "1",
  escapeHtml: (value) => String(value),
  holeSvg: () => "",
  staffLayoutForSystem: () => ({ topOffset: 0, height: 76 }),
  $: () => ({ value: "4/4" }),
});
vm.runInContext(
  `${i18n}\n${notation}
globalThis.noteSvg = noteSvg;
globalThis.beamGroups = beamGroups;
globalThis.rhythmGroups = rhythmGroups;
globalThis.underlineCount = underlineCount;
globalThis.renderMeasure = renderMeasure;
globalThis.systemRows = systemRows;
globalThis.scoreSystemsMarkup = scoreSystemsMarkup;
globalThis.measureWidth = measureWidth;
globalThis.rowWidth = rowWidth;
globalThis.stretchedCell = stretchedCell;
globalThis.staffHeaderWidth = staffHeaderWidth;`,
  context,
);
// 造一批等长小节：count 个音符、时值 duration 拍。
function barsOf(count, barCount, duration = 1) {
  return Array.from({ length: barCount }, (_, bar) =>
    Array.from({ length: count }, (_, i) => ({
      e: { pitch: 60, duration },
      i: bar * count + i,
    })),
  );
}

test("treble staff stem flips down only above the middle line", () => {
  const onMiddleLine = context.noteSvg({ e: { pitch: 40, duration: 1 }, i: 0 });
  const aboveMiddle = context.noteSvg({ e: { pitch: 30, duration: 1 }, i: 0 });
  assert.match(onMiddleLine, /v-27/);
  assert.match(aboveMiddle, /v27/);
});

test("short note values render the expected flags", () => {
  const sixteenth = context.noteSvg({ e: { pitch: 30, duration: 0.25 }, i: 0 });
  const thirtySecond = context.noteSvg({
    e: { pitch: 30, duration: 0.125 },
    i: 0,
  });
  assert.equal((sixteenth.match(/class="flag"/g) || []).length, 2);
  assert.equal((thirtySecond.match(/class="flag"/g) || []).length, 3);
});

test("eighth-note beams follow quarter-note beats in simple meter", () => {
  const entries = Array.from({ length: 4 }, (_, i) => ({
    i,
    e: { pitch: 60, duration: 0.5 },
  }));
  const groups = context.beamGroups(entries, "4/4");
  assert.deepEqual(
    Array.from(groups, (group) => Array.from(group, ({ entry }) => entry.i)),
    [[0, 1], [2, 3]],
  );
});

test("eighth-note beams follow dotted-quarter beats in compound meter", () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    i,
    e: { pitch: 60, duration: 0.5 },
  }));
  const groups = context.beamGroups(entries, "6/8");
  assert.deepEqual(
    Array.from(groups, (group) => Array.from(group, ({ entry }) => entry.i)),
    [[0, 1, 2], [3, 4, 5]],
  );
});

test("五线谱符杠仍然不跨休止符，与简谱减时线的规则互不干扰", () => {
  const entries = [
    { i: 0, e: { pitch: 60, duration: 0.5 } },
    { i: 1, e: { pitch: null, duration: 0.5 } },
    { i: 2, e: { pitch: 62, duration: 0.5 } },
    { i: 3, e: { pitch: 64, duration: 0.5 } },
  ];
  assert.deepEqual(
    Array.from(
      context.beamGroups(entries, "4/4"),
      (group) => Array.from(group, ({ entry }) => entry.i),
    ),
    [[2, 3]],
  );
});

test("减时线层数由书面时值决定，附点不增加线数", () => {
  assert.equal(context.underlineCount(0.5), 1);
  assert.equal(context.underlineCount(0.75), 1);
  assert.equal(context.underlineCount(0.375), 2);
  assert.equal(context.underlineCount(0.25), 2);
  assert.equal(context.underlineCount(0.125), 3);
  assert.equal(context.underlineCount(1), 0);
  assert.equal(context.underlineCount(2), 0);
});

test("简谱减时线按拍连写，第一条横跨整组", () => {
  const entries = Array.from({ length: 4 }, (_, i) => ({
    i,
    e: { pitch: 60, duration: 0.5 },
  }));
  const html = context.renderMeasure(entries, 1, false);
  assert.equal((html.match(/duration-mark line-1/g) || []).length, 2);
  assert.equal((html.match(/width:68px/g) || []).length, 2);
});

test("更短的音符多出一条只覆盖自己的减时线", () => {
  const entries = [
    { i: 0, e: { pitch: 60, duration: 0.75 } },
    { i: 1, e: { pitch: 62, duration: 0.25 } },
    { i: 2, e: { pitch: 64, duration: 1 } },
  ];
  const html = context.renderMeasure(entries, 1, false);
  assert.match(html, /class="duration-mark line-1" style="left:18px;width:68px"/);
  assert.match(html, /class="duration-mark line-2" style="left:18px;width:16px"/);
});

test("休止符记作 0，并与同拍内的音符共用减时线", () => {
  const entries = [
    { i: 0, e: { pitch: null, duration: 0.5 } },
    { i: 1, e: { pitch: 60, duration: 0.25 } },
  ];
  const html = context.renderMeasure(entries, 1, false);
  assert.match(html, /<span class="number-value">0<\/span>/);
  // 第一层减时线从休止符起横跨整拍；第二层只覆盖更短的十六分音符。
  assert.match(html, /class="duration-mark line-1" style="left:18px;width:68px"/);
  assert.equal((html.match(/duration-mark line-1/g) || []).length, 1);
  assert.match(html, /class="duration-mark line-2" style="left:18px;width:16px"/);
  assert.equal((html.match(/duration-mark line-2/g) || []).length, 1);
});

test("第一条减时线把休止符包住，更长的休止符只断开第二层", () => {
  const entries = [
    { i: 0, e: { pitch: 60, duration: 0.25 } },
    { i: 1, e: { pitch: null, duration: 0.5 } },
    { i: 2, e: { pitch: 60, duration: 0.25 } },
  ];
  const html = context.renderMeasure(entries, 1, false);
  // 三个时值加起来正好一拍，第一条线横跨三个（休止符被包在其中）。
  assert.equal(
    (html.match(/class="duration-mark line-1" style="left:18px;width:120px"/g) || [])
      .length,
    1,
  );
  // 八分休止符只有一条线，第二层在它处断开，左右两个十六分音符各一条。
  assert.equal((html.match(/duration-mark line-1/g) || []).length, 1);
  assert.equal((html.match(/duration-mark line-2/g) || []).length, 2);
});

test("时值相同的多个十六分休止符共用两条减时线", () => {
  const entries = [
    { i: 0, e: { pitch: 60, duration: 0.25 } },
    { i: 1, e: { pitch: null, duration: 0.25 } },
    { i: 2, e: { pitch: null, duration: 0.25 } },
    { i: 3, e: { pitch: 60, duration: 0.25 } },
  ];
  const html = context.renderMeasure(entries, 1, false);
  for (const level of [1, 2])
    assert.equal(
      (
        html.match(
          new RegExp(
            `class="duration-mark line-${level}" style="left:18px;width:172px"`,
            "g",
          ),
        ) || []
      ).length,
      1,
    );
});

test("跨拍的附点音符也不会丢掉自己的减时线", () => {
  const entries = [
    { i: 0, e: { pitch: 60, duration: 0.75 } },
    { i: 1, e: { pitch: 62, duration: 0.75 } },
  ];
  const html = context.renderMeasure(entries, 1, false);
  assert.equal((html.match(/duration-mark line-1/g) || []).length, 2);
});

test("折行按内容宽度打包，首小节预留谱头宽度", () => {
  // 每小节 4 个音符：45 + 4×52 = 253px，行间距 16px。
  const rows = context.systemRows(barsOf(4, 4), 560);
  // 560px 放得下两个小节（253+16+253 = 522），放不下三个（791）。
  // 用 Array.from 转换一次：vm 里造出来的数组和宿主的 Array 不是同一个 realm。
  assert.deepEqual(
    Array.from(rows, (row) => row.items.length),
    [2, 2],
  );
  // 首小节多出来的那一段正是谱头宽度。
  assert.equal(
    context.measureWidth(4, 52, true) - context.measureWidth(4, 52, false),
    context.staffHeaderWidth(),
  );
});

test("撑满让每行正好铺满内容宽度，且不超过 1.5 倍上限", () => {
  // 音符够多，撑得开：步长按比例放大到刚好铺满。
  const cell = context.stretchedCell([4, 4], 560, true);
  assert.ok(cell > 52 && cell < 78);
  assert.equal(Math.round(context.rowWidth([4, 4], cell, true)), 560);
  // 音符太少时会被上限卡住，宁可留白也不把间距扯散。
  assert.equal(context.stretchedCell([2], 1004, true), 78);
});

test("撑不满的行不两端对齐：单行居中，多行时末行左对齐", () => {
  const short = /class="score-system (centered|ragged)"/;
  // 整曲只有一行且撑不满 → 居中。
  assert.match(context.scoreSystemsMarkup(barsOf(2, 1), 1004, { stretch: true }), short);
  // 前面几行撑满、末行撑不满 → 末行左对齐，前面的行不左对齐。
  const html = context.scoreSystemsMarkup(
    [...barsOf(4, 2), ...barsOf(2, 1)],
    560,
    { stretch: true },
  );
  const classes = [...html.matchAll(/class="(score-system[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(classes, ["score-system", "score-system ragged"]);
});

test("四层谱面共用同一个起始横坐标，并把步长同步给 CSS", () => {
  const entries = Array.from({ length: 4 }, (_, i) => ({
    i,
    e: { pitch: 60, duration: 1 },
  }));
  // 首小节带谱头，非首小节不带，两者都要把首音推到同一列。
  const head = context.renderMeasure(entries, 1, true);
  const body = context.renderMeasure(entries, 2, false);
  const insetOf = (html) => html.match(/margin-left:(-?\d+)px/)[1];
  assert.equal(head.match(/margin-left:-?\d+px/g).length, 3);
  assert.equal(body.match(/margin-left:-?\d+px/g).length, 3);
  assert.notEqual(insetOf(head), insetOf(body));
  // 步长以自定义属性下发，简谱 / 歌词 / 指法三层的 .event-cell 才能跟着五线谱走。
  assert.match(head, /class="measure" style="--note-cell:52px"/);
});

test("步长撑开后减时线跟着变宽，仍覆盖整组", () => {
  const entries = [
    { i: 0, e: { pitch: 60, duration: 0.5 } },
    { i: 1, e: { pitch: 62, duration: 0.5 } },
  ];
  // 步长 70 时单元格中心在 35，减时线从中心往左 8px 起笔（left:27），
  // 一条横跨两音的线宽 = 1×70 + 16 = 86px。
  const html = context.renderMeasure(entries, 1, false, null, 70);
  assert.match(html, /class="duration-mark line-1" style="left:27px;width:86px"/);
  assert.match(html, /--note-cell:70px/);
});

test("步长撑大后四层的左起点仍把首音压在同一列", () => {
  const entries = Array.from({ length: 3 }, (_, i) => ({
    i,
    e: { pitch: 60, duration: 1 },
  }));
  const html = context.renderMeasure(entries, 1, false, null, 70);
  // 非首小节 noteStartX = 29：起点 = 29 − 70/2 = −6，首格中心落在 29。
  // 负数只能走 margin（负 padding 会被浏览器整条丢弃）。
  assert.match(html, /margin-left:-6px/);
  assert.doesNotMatch(html, /padding-left:-/);
});

test("撑满后行宽正好等于内容宽度，末行不会溢出到版心外面", () => {
  // 取一个能被整除的组合，验证 rowWidth 与 contentWidth 严格相等，
  // 这是「谱面右缘和谱头署名右缘对齐」的几何前提。
  const cell = context.stretchedCell([4, 4], 560, true);
  assert.equal(context.rowWidth([4, 4], cell, true), 560);
});

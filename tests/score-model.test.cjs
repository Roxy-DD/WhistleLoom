const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
// tr() 住在 js/i18n.js 里（浏览器由 index.html 先加载）。命令行没有 index.html，
// 所以把同一份源码拼进来 —— 见 vm-i18n.cjs 里为什么不写桩。
const i18n = require("./vm-i18n.cjs");

const modelSource = fs.readFileSync(
  path.join(__dirname, "..", "js", "score-model.js"),
  "utf8",
);
const musicSource = fs.readFileSync(
  path.join(__dirname, "..", "js", "music.js"),
  "utf8",
);
const context = vm.createContext({});
vm.runInContext(
  `${i18n}\n${musicSource}\n${modelSource}\nglobalThis.normalizeScoreData = normalizeScoreData;
   globalThis.scoreFilename = scoreFilename;
   globalThis.SCORE_MODES = SCORE_MODES;
   globalThis.MODE_LABELS = MODE_LABELS;
   globalThis.modeLabel = modeLabel;`,
  context,
);
const normalizeScoreData = context.normalizeScoreData;

// 调式中文名过去在界面上有三份副本（HTML 下拉、ABC 导入提示、导出谱头），
// 导出那份抄漏了混合利底亚，导致 D 混合利底亚的曲子谱头印着「自然大调」。
// 这条测试盯住「支持哪些调式」和「这些调式叫什么」两份名单不再分叉。
test("每个支持的调式都有中文名，且名字里点明了是哪种调式", () => {
  for (const mode of context.SCORE_MODES) {
    const label = context.MODE_LABELS[mode];
    assert.ok(label, `调式 ${mode} 没有中文名`);
    assert.equal(context.modeLabel(mode), label);
  }
  // 混合利底亚和大调必须各叫各的名字 —— 这正是当初被当成同一个的那一对。
  assert.notEqual(context.modeLabel("mixolydian"), context.modeLabel("major"));
  // 不认识的调式退回大调，不返回 undefined 让界面印出空白。
  assert.equal(context.modeLabel("whole-tone"), context.MODE_LABELS.major);
});

test("normalizes a legacy score into the current versioned format", () => {
  const result = normalizeScoreData({
    title: "Tune",
    tempo: 104,
    events: [{ pitch: 62, duration: 1 }],
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.originalTempo, 104);
  assert.equal(result.tonic, "C");
  assert.equal(result.events[0].lyric, "");
});

test("rejects invalid pitch and duration with a user-facing event index", () => {
  assert.throws(
    () => normalizeScoreData({ events: [{ pitch: NaN, duration: 1 }] }),
    /第 1 个音符音高/,
  );
  assert.throws(
    () => normalizeScoreData({ events: [{ pitch: 62, duration: 0.7 }] }),
    /第 1 个音符时值/,
  );
});

test("rejects unsupported future versions and excessive event counts", () => {
  assert.throws(
    () => normalizeScoreData({ schemaVersion: 2, events: [] }),
    /版本暂不支持/,
  );
  assert.throws(
    () =>
      normalizeScoreData({
        events: Array(10001).fill({ pitch: 60, duration: 1 }),
      }),
    /超过 10,000/,
  );
});

test("rejects malformed metadata and event flags instead of silently changing them", () => {
  assert.throws(
    () => normalizeScoreData({ schemaVersion: 0, events: [] }),
    /版本暂不支持/,
  );
  // 拍号按结构校验：分母必须是二的幂，7/3 这种不属于任何记谱法。
  assert.throws(() => normalizeScoreData({ meter: "7/3", events: [] }), /拍号/);
  assert.throws(() => normalizeScoreData({ meter: "4/0", events: [] }), /拍号/);
  assert.throws(() => normalizeScoreData({ meter: "33/4", events: [] }), /拍号/);
  assert.throws(
    () =>
      normalizeScoreData({
        events: [{ pitch: 62, duration: 1, barAfter: "false" }],
      }),
    /小节线标记/,
  );
});

test("accepts the meters ABC files actually use, not just the six presets", () => {
  // 旧实现用固定白名单，导入 2/2（cut time）、5/4、3/8 会直接报「拍号暂不支持」。
  for (const meter of ["2/2", "5/4", "3/8", "7/8", "5/8", "2/8", "4/2", "12/8"])
    assert.equal(normalizeScoreData({ meter, events: [] }).meter, meter);
  assert.equal(normalizeScoreData({ meter: "", events: [] }).meter, "4/4");
  assert.equal(normalizeScoreData({ events: [] }).meter, "4/4");
});

test("accepts mixolydian, which is everywhere in Irish and old-time tunes", () => {
  assert.equal(
    normalizeScoreData({ mode: "mixolydian", events: [] }).mode,
    "mixolydian",
  );
  assert.throws(() => normalizeScoreData({ mode: "whole-tone", events: [] }), /调式/);
});

test("does not mutate the supplied object while normalizing it", () => {
  const input = { title: "Tune", events: [{ pitch: 62, duration: 1 }] };
  const before = JSON.stringify(input);
  normalizeScoreData(input);
  assert.equal(JSON.stringify(input), before);
});

test("manual save filename follows the score title and is filesystem-safe", () => {
  assert.equal(context.scoreFilename("山风小曲"), "山风小曲.json");
  assert.equal(context.scoreFilename("  A/B: C.  "), "A_B_ C.json");
  assert.equal(context.scoreFilename("..."), "未命名曲谱.json");
});

test("preserves valid ties and slurs, and rejects a tie to a different pitch", () => {
  const normalized = normalizeScoreData({
    events: [
      { pitch: 62, duration: 1, tieToNext: true },
      { pitch: 62, duration: 1, slurToNext: true },
      { pitch: 64, duration: 1 },
    ],
  });
  assert.equal(normalized.events[0].tieToNext, true);
  assert.equal(normalized.events[1].slurToNext, true);
  assert.throws(
    () => normalizeScoreData({ events: [{ pitch: 62, tieToNext: true }, { pitch: 64 }] }),
    /延音线必须连接到下一颗同音高音符/,
  );
});

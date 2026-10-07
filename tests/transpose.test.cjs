const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  test = require("node:test"),
  assert = require("node:assert/strict");
// tr() 住在 js/i18n.js 里（浏览器由 index.html 先加载）。见 vm-i18n.cjs。
const i18n = require("./vm-i18n.cjs");

const music = fs.readFileSync(
  path.join(__dirname, "..", "js", "music.js"),
  "utf8",
);

// music.js 里的调性换算依赖这些常量（正式运行时由 app.js 顶部定义）。
const keyMidi = {
  C: 60,
  "C#": 61,
  Db: 61,
  D: 62,
  "D#": 63,
  Eb: 63,
  E: 64,
  F: 65,
  "F#": 66,
  Gb: 66,
  G: 67,
  "G#": 68,
  Ab: 68,
  A: 69,
  "A#": 70,
  Bb: 70,
  B: 71,
};
const pcSharp = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const pcFlat = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const whistleMidi = { D: 62, C: 60, Bb: 58, G: 55, F: 53, Eb: 51, A: 57 };
const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const scaleSteps = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// 用可变对象承载下拉框的值，测试里改它就等于用户改了控件。
const fields = { tonic: "C", mode: "major", whistleKey: "D" };
const context = vm.createContext({
  keyMidi,
  pcSharp,
  pcFlat,
  whistleMidi,
  letterIndex,
  scaleSteps,
  $: (id) => ({ value: fields[id] ?? "" }),
});
vm.runInContext(
  `${i18n}\n${music}\nglobalThis.api={transposeShift,solfege,fingering,keySignature};`,
  context,
);
const api = context.api;
const TONICS = Object.keys(keyMidi);

test("C 调移到 D 调是 +2 个半音；C 调移到 B 调走 −1 而不是 +11", () => {
  assert.equal(api.transposeShift(keyMidi.C, keyMidi.D), 2);
  assert.equal(api.transposeShift(keyMidi.C, keyMidi.B), -1);
  assert.equal(api.transposeShift(keyMidi.D, keyMidi.C), -2);
  assert.equal(api.transposeShift(keyMidi.B, keyMidi.C), 1);
  assert.equal(api.transposeShift(keyMidi.D, keyMidi.D), 0);
});

test("任意两个调之间都走最短路径：距离不超过 6 个半音，且落点音名正确", () => {
  for (const from of TONICS)
    for (const to of TONICS) {
      const n = api.transposeShift(keyMidi[from], keyMidi[to]);
      assert.ok(Math.abs(n) <= 6, `${from} → ${to} 走了 ${n} 个半音，绕远了`);
      const landed = ((((keyMidi[from] + n) % 12) + 12) % 12);
      const target = (((keyMidi[to] % 12) + 12) % 12);
      assert.equal(landed, target, `${from} → ${to} 的落点音名不对`);
    }
});

test("移调后简谱数字一个都不变——变的只有实际音高和调名", () => {
  const melody = [60, 62, 64, 65, 67, 69, 71, 72];
  fields.tonic = "C";
  const before = melody.map((pitch) => api.solfege(pitch));
  assert.match(before[0], /solfege-core">1</);
  // 主音跟着一起移，这是「整曲移调」与「只换记谱」的分水岭。
  const n = api.transposeShift(keyMidi.C, keyMidi.D);
  fields.tonic = "D";
  const after = melody.map((pitch) => api.solfege(pitch + n));
  assert.deepEqual(
    after.map((html) => html.replace(/<[^>]+>/g, "")),
    before.map((html) => html.replace(/<[^>]+>/g, "")),
  );
});

test("反过来，只改主音不动音高会把简谱数字全打乱（所以不能拿它当移调）", () => {
  const melody = [60, 62, 64, 65, 67, 69, 71, 72];
  fields.tonic = "C";
  const before = melody.map((pitch) => api.solfege(pitch));
  fields.tonic = "D"; // 音高原地不动，只换主音
  const after = melody.map((pitch) => api.solfege(pitch));
  assert.notDeepEqual(
    after.map((html) => html.replace(/<[^>]+>/g, "")),
    before.map((html) => html.replace(/<[^>]+>/g, "")),
  );
});

test("移调让指法变顺：C 调旋律在 D 哨笛上有吹不出的音，整曲移到 D 调后全部可吹", () => {
  fields.whistleKey = "D";
  const melody = [60, 62, 64, 65, 67, 69, 71, 72];
  const usable = (pitch) => api.fingering(pitch).valid;
  assert.ok(
    melody.some((pitch) => !usable(pitch)),
    "前提：C 调音阶在 D 调哨笛上本来该有吹不出的音（F 需要半孔）",
  );
  const n = api.transposeShift(keyMidi.C, keyMidi.D);
  assert.ok(
    melody.every((pitch) => usable(pitch + n)),
    "移到 D 调后每个音都该有可靠指法",
  );
});

test("移调后调号跟着走：C 调无升降号，D 调两个升号", () => {
  fields.tonic = "C";
  assert.equal(api.keySignature().count, 0);
  fields.tonic = "D";
  assert.equal(api.keySignature().count, 2);
});

/* 哨笛音域与「吹不出来」的判定。
 *
 * 这组测试护的是一条**静默出错**的路径：谱面上画出来的指法图看着完全正常，
 * 但那个音这支笛子根本发不出来。没有任何报错、没有任何异常、测试也曾经是绿的 ——
 * 只有真正拿起来吹的人才会发现是哑的。这跟漏译是同一类问题：**不查就等于没有**。
 */
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

// music.js 里的换算依赖这些常量（正式运行时由 app.js 顶部定义）。
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
  `${i18n}\n${music}\nglobalThis.api={fingering,holeSvg,setRenderKeys};`,
  context,
);
const api = context.api;

test("音域检查必须排在指法查表前面：C4 在 D 调哨笛上被判「太低」，而不是蒙对成叉口指法", () => {
  fields.whistleKey = "D";
  // 回归测试。旧版把 C4 算成 valid + cross —— 它离全按音 D4 差 −2 个半音，取模后
  // pc = 10，正好撞上 C 自然音的叉口指法分支，于是谱面上画出一张看着完全正常、
  // 一吹却是哑的指法图。**这比不显示更糟**：不显示会让人来问，画对了会让人以为自己按错了。
  const f = api.fingering(60);
  assert.equal(f.valid, false, "C4 在 D 调哨笛上吹不出来");
  assert.equal(f.issue, "low");
});

test("全按音就是这支笛子的最低音，低一个半音已经算越界", () => {
  fields.whistleKey = "D";
  assert.equal(api.fingering(62).issue, null, "D4 是全按，正好在音域里");
  assert.equal(api.fingering(61).issue, "low");
  for (let midi = 36; midi < 62; midi++)
    assert.equal(api.fingering(midi).issue, "low", `midi ${midi} 该被判太低`);
});

test("音域上限是两个八度：D6 还能吹，再高一个半音就算越界", () => {
  fields.whistleKey = "D";
  // 编辑器允许录到 86（D6），对全按是 62（D4）的 D 调哨笛来说正好 +24 ——
  // 那正是这支笛子能吹的最高音，不该被当成越界。
  assert.equal(api.fingering(86).issue, null, "D6 是这支笛子能吹到的最高音");
  assert.equal(api.fingering(87).issue, "high");
  for (let midi = 87; midi <= 108; midi++)
    assert.equal(api.fingering(midi).issue, "high", `midi ${midi} 该被判太高`);
});

test("音高在音域里、但六孔拼不出来的音另算一类：F 自然音", () => {
  fields.whistleKey = "D";
  const f = api.fingering(65); // F4，比全按 D4 高 3 个半音，落在 D 大调音阶的空档上
  assert.equal(f.valid, false);
  assert.equal(f.issue, "noFingering");
  // C 自然音（+10）是例外：六孔拼得出叉口指法，算能吹。它和 F 的差别不在音域，在指法。
  const c = api.fingering(72);
  assert.equal(c.valid, true);
  assert.equal(c.cross, true);
  assert.equal(c.issue, null);
});

test("valid 与 issue 永远一致：issue 有值就是吹不出来，没有就是吹得出来", () => {
  for (const whistle of Object.keys(whistleMidi)) {
    fields.whistleKey = whistle;
    for (let midi = 24; midi <= 108; midi++) {
      const f = api.fingering(midi);
      assert.equal(
        Boolean(f.issue),
        !f.valid,
        `${whistle} 调哨笛上的 midi ${midi}：issue=${f.issue} 但 valid=${f.valid}`,
      );
      assert.ok(
        [null, "low", "high", "noFingering"].includes(f.issue),
        `${whistle} 调哨笛上的 midi ${midi} 冒出了没有约定的 issue：${f.issue}`,
      );
    }
  }
});

test("换一支哨笛，同一个音的高低判定跟着走", () => {
  fields.whistleKey = "G"; // 全按 = 55（G3），比 D 调哨笛低 7 个半音
  assert.equal(api.fingering(55).issue, null);
  assert.equal(api.fingering(54).issue, "low");
  assert.equal(api.fingering(79).issue, null, "G3 + 24 是它的最高音");
  assert.equal(api.fingering(80).issue, "high");
});

test("谱面上：三种成因各画各的记号，不再一律一个问号", () => {
  fields.whistleKey = "D";
  const low = api.holeSvg(60);
  assert.match(low, /class="fingering-issue"/);
  assert.match(low, />低</);
  assert.match(low, /aria-label="太低/);

  const high = api.holeSvg(90);
  assert.match(high, />高</);
  assert.match(high, /aria-label="太高/);

  const chromatic = api.holeSvg(65);
  assert.match(chromatic, />\?</);
  assert.match(chromatic, /aria-label="此音需要半孔/);

  // 能吹的音还是照常给孔位图，没有被上面的分支吃掉。
  assert.match(api.holeSvg(62), /hole-closed/);
});

test("休止符没有音高，不该被算成吹不出来", () => {
  fields.whistleKey = "D";
  const f = api.fingering(null);
  assert.equal(f.rest, true);
  assert.equal(f.valid, true);
  assert.equal(f.issue, null);
  assert.equal(api.holeSvg(null), '<span class="rest-hole">—</span>');
});

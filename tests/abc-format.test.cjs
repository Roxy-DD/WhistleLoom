const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
// tr() 住在 js/i18n.js 里（浏览器由 index.html 先加载）。见 vm-i18n.cjs。
const i18n = require("./vm-i18n.cjs");

const model = fs.readFileSync(
  path.join(__dirname, "..", "js", "score-model.js"),
  "utf8",
);
// abc.js 现在共用 music.js 的 keySignatureFor 算调号（两处各写一套算法正是当初
// K:AMix 被算成小调的原因），所以测试要把 music.js 一起载进来，测的是真家伙。
const music = fs.readFileSync(path.join(__dirname, "..", "js", "music.js"), "utf8");
// score-import.js 是三条导入路径共用的边境层（时值吸附 / 延音线降级 / 音域适配），
// abc.js 现在调它。lastImportWarnings 也声明在那一份里，所以测试不再自己声明。
const scoreImport = fs.readFileSync(
  path.join(__dirname, "..", "js", "score-import.js"),
  "utf8",
);
const abc = fs.readFileSync(path.join(__dirname, "..", "js", "abc.js"), "utf8");
// 表单字段的值由测试自己控制，才能用不同拍号驱动 generateAbc。
const fields = { meter: "4/4", tonic: "D", mode: "major", tempo: "96", whistleKey: "D" };
const context = vm.createContext({
  // 同一个对象既注入到 vm 里（setField 改它），又给宿主的 $ 读取。
  fields,
  $: (id) => ({ value: fields[id] === undefined ? "D" : fields[id] }),
});
// app.js 里那批音名/音高常量照抄一份（music.js 只在调用时读它们）。
const prelude = `
const pcSharp = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const pcFlat = ["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const letterIndex = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
const naturalPc = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
const keyMidi = { C:60,"C#":61,Db:61,D:62,"D#":63,Eb:63,E:64,F:65,"F#":66,Gb:66,G:67,"G#":68,Ab:68,A:69,"A#":70,Bb:70,B:71 };
const whistleMidi = { D:62, C:60, Bb:58, G:55, F:53, Eb:51, A:57 };
const scaleSteps = {
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
  dorian:[0,2,3,5,7,9,10], mixolydian:[0,2,4,5,7,9,10],
};
let score = { title: "", events: [] };
`;
vm.runInContext(
  `${i18n}\n${prelude}\n${model}\n${scoreImport}\n${music}\n${abc}\nglobalThis.api={parseAbc,durationSuffix,generateAbc,
    setField:(key,value)=>{fields[key]=value},
    setScore:(value)=>{score=value},
    keySignatureFor,
    get score(){return score},get warnings(){return lastImportWarnings}};`,
  context,
);

test("ABC duration suffixes stay rational and round-trip supported values", () => {
  const expected = new Map([
    [0.125, "1/4"],
    [0.25, "/"],
    [0.375, "3/4"],
    [0.5, ""],
    [0.75, "3/2"],
    [1, "2"],
    [1.5, "3"],
    [2, "4"],
  ]);
  for (const [duration, suffix] of expected) {
    assert.equal(context.api.durationSuffix(duration), suffix);
  }
});

test("ABC import reads pitch, key, tempo, meter, rests and lyrics", () => {
  const parsed = context.api.parseAbc(
    "T:Test\nM:3/4\nL:1/8\nQ:1/4=108\nK:D\nD2 F A z2 |\nw: hi there * rest",
  );
  assert.equal(parsed.title, "Test");
  assert.equal(parsed.tonic, "D");
  assert.equal(parsed.meter, "3/4");
  assert.equal(parsed.tempo, 108);
  assert.deepEqual(
    Array.from(parsed.events, (event) => event.pitch),
    [62, 66, 69, null],
  );
  assert.equal(parsed.events[0].lyric, "hi");
});

test("ABC importer fails safely on multi-voice files and reports lossy notation", () => {
  assert.throws(
    () => context.api.parseAbc("T:Voices\nV:one\nV:two\nK:D\nD E F"),
    /暂不支持/,
  );
  context.api.parseAbc('T:Chord\nK:D\n"Am" D2 E2 |: F2 G2 :|');
  assert.ok(context.api.warnings.some((warning) => warning.includes("和弦")));
  assert.ok(
    context.api.warnings.some((warning) => warning.includes("播放不会循环")),
  );
});

test("ABC ties and slurs become explicit note connections", () => {
  const parsed = context.api.parseAbc("T:Connections\nM:4/4\nL:1/8\nK:C\n(C D E) G-G");
  assert.deepEqual(Array.from(parsed.events, (event) => event.slurToNext), [true, true, false, false, false]);
  assert.equal(parsed.events[3].tieToNext, true);
  assert.equal(parsed.events[4].pitch, parsed.events[3].pitch);
});

test("跨音高的 '-' 按连奏线导入，而不是让整份曲谱导入失败", () => {
  // thesession.org 上手抄的谱子常把 `-` 当连奏符写在不同音高之间（例如三连音里的
  // `(3d-e-f`、乐句里的 `E-F`）。规范里延音线只能连同音高，过去这种写法会让
  // normalizeScoreData 直接抛错、整份曲谱载不进来。现在降级为连奏线（弧和原谱一致），
  // 并明确提示改了什么。
  const parsed = context.api.parseAbc("T:x\nM:4/4\nL:1/8\nK:D\n(3d-e-f E2 |");
  assert.equal(parsed.events.length, 4);
  assert.deepEqual(
    Array.from(parsed.events, (event) => event.tieToNext),
    [false, false, false, false],
  );
  assert.deepEqual(
    Array.from(parsed.events, (event) => event.slurToNext),
    [true, true, false, false],
  );
  assert.ok(context.api.warnings.some((w) => w.includes("连奏线")));
  // 同音高的 `-` 仍然是延音线，不该被降级。
  const tied = context.api.parseAbc("T:x\nM:4/4\nL:1/8\nK:D\nG2-G2");
  assert.equal(tied.events[0].tieToNext, true);
  assert.equal(tied.events[0].slurToNext, false);
  assert.ok(!context.api.warnings.some((w) => w.includes("连奏线")));
  // 后面没有音符、或连到休止符上：丢弃并提示，不抛错。
  const trailing = context.api.parseAbc("T:x\nM:4/4\nL:1/8\nK:D\nG2-");
  assert.equal(trailing.events[0].tieToNext, false);
  assert.ok(context.api.warnings.some((w) => w.includes("没有可连的音符")));
  const toRest = context.api.parseAbc("T:x\nM:4/4\nL:1/8\nK:D\nG2-z2");
  assert.equal(toRest.events[0].tieToNext, false);
});

test("ABC 导出的小节线跟着拍号走，而不是写死每 8 个音符一条", () => {
  const eighths = (n) =>
    Array.from({ length: n }, () => ({ pitch: 62, duration: 0.5 }));
  const exportWith = (meter, events) => {
    context.api.setField("meter", meter);
    context.api.setScore({ title: "节奏校验", events, events0: undefined });
    return context.api.generateAbc();
  };
  const bars = (text) => (text.match(/\|/g) || []).length;
  // 4/4：8 个八分音符刚好一小节，只出一条线（旧实现靠 (i+1)%8 凑巧也对）。
  assert.equal(bars(exportWith("4/4", eighths(8))), 1);
  // 3/4：6 个八分音符一小节；末尾只剩 2 个音符，不该补线（旧实现会出 1 条位置错的线）。
  assert.equal(bars(exportWith("3/4", eighths(8))), 1);
  // 6/8：每小节 6 个八分音符，12 个音符出 2 条线。
  assert.equal(bars(exportWith("6/8", eighths(12))), 2);
  // 混入四分音符：4/4 里 4 个四分音符 = 1 小节（旧实现每 8 个音符才划线，会整首无线）。
  assert.equal(
    bars(
      exportWith("4/4", [
        { pitch: 62, duration: 1 },
        { pitch: 62, duration: 1 },
        { pitch: 62, duration: 1 },
        { pitch: 62, duration: 1 },
      ]),
    ),
    1,
  );
  // 编辑器里手动加的小节线优先，即使这一小节还没满。
  assert.equal(
    bars(
      exportWith("4/4", [
        { pitch: 62, duration: 1, barAfter: true },
        { pitch: 62, duration: 1 },
      ]),
    ),
    1,
  );
});

test("K: 的调式按 ABC 规范解析：混合利底亚不再被当成小调", () => {
  const pitchOf = (key, note = "F") =>
    context.api.parseAbc(`T:x\nM:4/4\nL:1/8\nK:${key}\n${note}`).events[0].pitch;
  // D 混合利底亚与 G 大调共用一套升降号（一个升号），F 该是 F♯。
  // 旧实现里 /^(m|min|minor)/ 会把 "Mix" 当成小调 → 调号变成两个降号，F 就成了 F 本位。
  assert.equal(pitchOf("DMix"), 66);
  assert.equal(pitchOf("D mixolydian"), 66);
  // A 混合利底亚 = D 大调的两个升号。
  assert.equal(pitchOf("AMix"), 66);
  // A 多利亚 = G 大调的一个升号。
  assert.equal(pitchOf("Ador"), 66);
  // A 小调没有升降号 → F 本位 65；过去的实现「凑巧」也对，但不能靠凑巧。
  assert.equal(pitchOf("Am"), 65);
  assert.equal(pitchOf("A minor"), 65);
  // G 大调一个升号；F 大调一个降号（B♭=70）。
  assert.equal(pitchOf("G"), 66);
  assert.equal(pitchOf("F", "B"), 70);
  assert.equal(pitchOf("F"), 65);
});

test("ABC 拍号的别名与复合拍号都能导入", () => {
  const meterOf = (line) =>
    context.api.parseAbc(`T:x\n${line}\nL:1/8\nK:D\nD`).meter;
  assert.equal(meterOf("M:C"), "4/4");
  assert.equal(meterOf("M:C|"), "2/2");
  assert.equal(meterOf("M:2/2"), "2/2");
  assert.equal(meterOf("M:5/4"), "5/4");
  assert.equal(meterOf("M:3/8"), "3/8");
  assert.equal(meterOf("M:(2+3+2)/8"), "7/8");
  // 没有 M: 或写成 M:none：按 4/4 收，并且必须提示过。
  assert.equal(context.api.parseAbc("T:x\nK:D\nD").meter, "4/4");
  assert.ok(context.api.warnings.some((w) => w.includes("拍号")));
  assert.equal(meterOf("M:none"), "4/4");
});

test("ABC 双减时线 // 按四分之一单位长度导入", () => {
  const durations = (body) =>
    Array.from(
      context.api.parseAbc(`T:x\nM:4/4\nL:1/8\nK:D\n${body}`).events,
      (event) => event.duration,
    );
  // L:1/8 的单位长度是 0.5 拍。旧实现认不出 `//`，静默返回 1，音符被拉长到四倍。
  assert.deepEqual(durations("A//"), [0.125]);
  assert.deepEqual(durations("A/"), [0.25]);
  assert.deepEqual(durations("A3/2"), [0.75]);
  assert.deepEqual(durations("A/2"), [0.25]);
  assert.deepEqual(durations("A3"), [1.5]);
  assert.deepEqual(durations("A"), [0.5]);
  // 三减时线比时值表的下限还短，就近吸附到三十二分音符并明确提示，而不是整份导入失败。
  assert.deepEqual(durations("A///"), [0.125]);
  assert.ok(context.api.warnings.some((w) => w.includes("时值")));
});

test("缺 L: 时按 ABC 规范由拍号推出单位音符长度", () => {
  const first = (meter) =>
    context.api.parseAbc(`T:x\n${meter}\nK:D\nA`).events[0].duration;
  // 拍号化小数 ≥ 0.75 → 单位长度 1/8（0.5 拍）。
  assert.equal(first("M:4/4"), 0.5);
  assert.equal(first("M:3/4"), 0.5);
  assert.equal(first("M:6/8"), 0.5);
  // 拍号化小数 < 0.75 → 单位长度 1/16（0.25 拍）。
  assert.equal(first("M:2/4"), 0.25);
  assert.equal(first("M:3/8"), 0.25);
  assert.ok(context.api.warnings.some((w) => w.includes("L:")));
});

test("装饰音不会混进谱子，三连音等损失会明确提示", () => {
  const parsed = context.api.parseAbc(
    "T:x\nM:4/4\nL:1/8\nK:D\n{g}A2 B (3cde |",
  );
  // {g} 里的 g 是装饰音，过去会被当成真音符收进来（G4 = 67）。
  assert.ok(!parsed.events.some((event) => event.pitch === 67));
  assert.equal(parsed.events.length, 5);
  assert.equal(parsed.events[0].pitch, 69);
  assert.ok(context.api.warnings.some((w) => w.includes("装饰音")));
  assert.ok(context.api.warnings.some((w) => w.includes("三连音")));
});

test("单独一个 ! 是换行（thesession.org 的写法），不该被误报成装饰记号", () => {
  const parsed = context.api.parseAbc(
    "T:x\nM:4/4\nL:1/8\nK:D\nD2 E2 |! F2 G2 |",
  );
  assert.equal(parsed.events.length, 4);
  assert.ok(!context.api.warnings.some((w) => w.includes("装饰记号")));
  // 成对的 !trill! 才是装饰记号，要提示，且内容不能被当成音符。
  const trill = context.api.parseAbc("T:x\nM:4/4\nL:1/8\nK:D\n!trill!D2 E2 |");
  assert.equal(trill.events.length, 2);
  assert.ok(context.api.warnings.some((w) => w.includes("装饰记号")));
});

test("三连音按比例近似，而不是原样拖长", () => {
  const durations = (body) =>
    Array.from(
      context.api.parseAbc(`T:x\nM:4/4\nL:1/8\nK:D\n${body}`).events,
      (event) => event.duration,
    );
  // (3cde = 三个八分音符塞进两个八分音符的时间（每个 1/3 拍）。时值表里最接近的是
  // 附点十六分音符 0.375 拍；关键是必须短于 0.5 —— 旧实现整个忽略 `3`，三个音各按
  // 0.5 拍收进来，一小节会白白多出半拍。
  const triplet = durations("(3cde f2");
  assert.equal(triplet.length, 4);
  assert.deepEqual(triplet.slice(0, 3), [0.375, 0.375, 0.375]);
  // 连音只作用在它自己的那几个音上，后面的音符不受影响。
  assert.equal(triplet[3], 1);
  // (2 是二连音：两个音占三个音的时间，每个变长。
  assert.deepEqual(durations("(2cd"), [0.75, 0.75]);
  // 连音跨不过小节线。
  assert.deepEqual(durations("(3cde|f2"), [0.375, 0.375, 0.375, 1]);
});

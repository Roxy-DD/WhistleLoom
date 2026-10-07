/* MusicXML / MIDI 两条编解码路径的回归测试。
 *
 * 这两条路的意义是「把任意来源的谱子带进本工具」，而它们各自都有损失性取舍：
 * MusicXML 丢和弦与装饰音，MIDI 丢连音线并且必须量化。取舍本身可以接受，
 * 但**结果必须能被本工具完整读回来** —— 导出一个文件、再导入回来却变了样，
 * 那比不支持这个格式更糟。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
// tr() 住在 js/i18n.js 里（浏览器由 index.html 先加载）。见 vm-i18n.cjs。
const i18n = require("./vm-i18n.cjs");

const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
const context = vm.createContext({
  $: () => ({ value: "D" }),
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Blob,
  Response,
  DecompressionStream,
  console,
});
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
  `${i18n}\n${prelude}\n${read("score-model.js")}\n${read("score-import.js")}\n${read(
    "music.js",
  )}\n${read("musicxml.js")}\n${read("midi.js")}
globalThis.api = {
  normalizeScoreData, keyFromFifths, keySignatureFor, modeFromName,
  generateMusicXml, musicXmlToScore, musicXmlFromBytes,
  generateMidi, parseMidiFile,
  get warnings(){ return lastImportWarnings; },
  setWarnings(value){ lastImportWarnings = value; },
};`,
  context,
);
const api = context.api;
const pitchesOf = (score) => Array.from(score.events, (event) => event.pitch);
const durationsOf = (score) => Array.from(score.events, (event) => event.duration);

// ── MusicXML ───────────────────────────────────────────────────────────────
test("MusicXML 往返：音高、时值、调号、拍号、速度都不走样", () => {
  const source = api.normalizeScoreData({
    title: "往返测试",
    subtitle: "旋律",
    composer: "某人",
    tonic: "D",
    mode: "dorian",
    meter: "6/8",
    tempo: 132,
    events: [
      { pitch: 62, duration: 1 },
      { pitch: 64, duration: 0.5 },
      { pitch: 66, duration: 0.5 },
      { pitch: null, duration: 1 },
      { pitch: 69, duration: 1.5, tieToNext: true },
      { pitch: 69, duration: 0.5 },
      { pitch: 71, duration: 2, slurToNext: true },
      { pitch: 72, duration: 1, barAfter: true },
    ],
  });
  const back = api.musicXmlToScore(api.generateMusicXml(source));
  assert.equal(back.title, "往返测试");
  assert.equal(back.composer, "某人");
  assert.equal(back.tonic, "D");
  assert.equal(back.mode, "dorian");
  assert.equal(back.meter, "6/8");
  assert.equal(back.tempo, 132);
  assert.deepEqual(pitchesOf(back), pitchesOf(source));
  assert.deepEqual(durationsOf(back), durationsOf(source));
  // 延音线必须原样活下来 —— 它改变的是时值的含义，丢了就把两拍变成一拍。
  assert.equal(back.events[4].tieToNext, true);
  assert.equal(back.events[5].tieToNext, false);
  assert.equal(back.events[6].slurToNext, true);
  assert.equal(api.warnings.length, 0, "标准往返不该产生任何提示");
});

const handWritten = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 注释应当被忽略 -->
<score-partwise version="3.1">
  <work><work-title>手写样本</work-title></work>
  <identification><creator type="composer">测试作者</creator></identification>
  <part-list><score-part id="P1"><part-name>钢琴</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>2</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction placement="above"><direction-type><words>♩ = 120</words></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><chord/><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><grace/><pitch><step>E</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><lyric number="1"><text>你</text></lyric></note>
      <backup><duration>8</duration></backup>
      <note><rest/><duration>4</duration><voice>2</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

test("MusicXML：和弦取最高音、装饰音略去、声部线取音符最多的那条", () => {
  const parsed = api.musicXmlToScore(handWritten);
  assert.equal(parsed.title, "手写样本");
  assert.equal(parsed.composer, "测试作者");
  assert.equal(parsed.tonic, "D");
  assert.equal(parsed.mode, "major");
  assert.equal(parsed.meter, "3/4");
  assert.equal(parsed.tempo, 120);
  // D4 + A4 + F♯5 是同时发声的和弦，只留最高的 F♯5；装饰音 E5 不占时值，略去。
  assert.deepEqual(pitchesOf(parsed), [78, 76]);
  assert.deepEqual(durationsOf(parsed), [1, 1]);
  assert.equal(parsed.events[1].lyric, "你");
  assert.equal(parsed.events[1].barAfter, true);
  const joined = api.warnings.join(" ");
  assert.match(joined, /2 个音是与其他音同时发声的和弦音/);
  assert.match(joined, /1 个装饰音/);
});

test("MusicXML：<key><fifths> 能反推出主音，包括小调和多利亚", () => {
  // vm 里的对象和测试进程的对象不是同一个「域」，原型对不上，deepStrictEqual 会误报。
  // 这里只比字段，不比对象身份。
  const key = (fifths, mode) => {
    const result = api.keyFromFifths(fifths, mode);
    return `${result.tonic} ${result.mode}`;
  };
  assert.equal(key(0, "major"), "C major");
  assert.equal(key(1, "major"), "G major");
  assert.equal(key(-1, "major"), "F major");
  assert.equal(key(2, "major"), "D major");
  assert.equal(key(2, "minor"), "B minor");
  assert.equal(key(-3, "minor"), "C minor");
  // 三个降号配多利亚 → F 多利亚。F 多利亚是 F G A♭ B♭ C D E♭，正好三个降号。
  assert.equal(key(-3, "dorian"), "F dorian");
  // 没有升降号配多利亚 → D 多利亚（全在白键上）。
  assert.equal(key(0, "dorian"), "D dorian");
  // 七个降号对应 C♭ 大调，超出界面的调名表，要换成等音名。
  assert.equal(key(-7, "major"), "B major");
});

test("MusicXML：.mxl 压缩包能读出来（走真正的 zip 解压）", async () => {
  const file = path.join(__dirname, "fixtures", "sample.mxl");
  const bytes = new Uint8Array(fs.readFileSync(file));
  const parsed = await api.musicXmlFromBytes(bytes);
  assert.equal(parsed.title, "压缩包样本");
  assert.equal(parsed.tonic, "G");
  assert.equal(parsed.mode, "major");
  assert.equal(parsed.meter, "4/4");
  assert.deepEqual(pitchesOf(parsed), [67, 69, 71, 72]);
});

test("MusicXML：调号对不上的调式会明确提示，而不是悄悄换掉", () => {
  const locrian = handWritten.replace(
    "<mode>major</mode>",
    "<mode>locrian</mode>",
  );
  const parsed = api.musicXmlToScore(locrian);
  assert.equal(parsed.mode, "minor");
  assert.match(api.warnings.join(" "), /洛克里亚调式暂不支持/);
});

test("MusicXML：不是 MusicXML 的文件要给出看得懂的错误", () => {
  assert.throws(() => api.musicXmlToScore("<html><body>hi</body></html>"), /不是 MusicXML/);
});

// ── MIDI ───────────────────────────────────────────────────────────────────
test("MIDI 往返：音高、时值、拍号、调号、速度都不走样", () => {
  const source = api.normalizeScoreData({
    title: "MIDI 往返",
    tonic: "G",
    mode: "major",
    meter: "3/4",
    tempo: 144,
    events: [
      { pitch: 67, duration: 1 },
      { pitch: null, duration: 0.5 },
      { pitch: 69, duration: 0.25 },
      { pitch: 71, duration: 0.125 },
      { pitch: 72, duration: 2 },
      { pitch: 64, duration: 0.75 },
    ],
  });
  const back = api.parseMidiFile(api.generateMidi(source));
  assert.equal(back.title, "MIDI 往返");
  assert.equal(back.tonic, "G");
  assert.equal(back.mode, "major");
  assert.equal(back.meter, "3/4");
  assert.equal(back.tempo, 144);
  assert.deepEqual(pitchesOf(back), pitchesOf(source));
  assert.deepEqual(durationsOf(back), durationsOf(source));
});

test("MIDI 往返：休止符由空隙重建，长休止拆成能表示的最大面额", () => {
  const source = api.normalizeScoreData({
    title: "休止",
    tonic: "C",
    mode: "major",
    meter: "4/4",
    tempo: 96,
    events: [
      { pitch: 60, duration: 1 },
      { pitch: 62, duration: 1, barAfter: true },
    ],
  });
  const back = api.parseMidiFile(api.generateMidi(source));
  // 最后一个音之后不该凭空多出休止符。
  assert.deepEqual(pitchesOf(back), [60, 62]);

  const spaced = api.normalizeScoreData({
    title: "带空隙",
    tonic: "C",
    mode: "major",
    meter: "4/4",
    tempo: 96,
    events: [
      { pitch: 60, duration: 1 },
      { pitch: null, duration: 2 },
      { pitch: 62, duration: 1 },
    ],
  });
  const rebuilt = api.parseMidiFile(api.generateMidi(spaced));
  assert.deepEqual(pitchesOf(rebuilt), [60, null, 62]);
  assert.deepEqual(durationsOf(rebuilt), [1, 2, 1]);
});

test("MIDI：running status、变长时值、歌词 meta 都能读", () => {
  // 手写一条音轨。要点是第二颗音不带状态字节 —— 沿用上一颗音的 0x90，这就是
  // running status（几乎所有真实 MIDI 都这么压体积）。150(0x96) 表示「时值 480 tick」：
  // 0x83 有最高位所以「后面还有」，0x83 & 0x7f = 3，再左移 7 位加上 0x60 = 480。
  // 注意 meta 事件之后必须重新给出状态字节，所以 meta 放在最前面。
  const track = [
    0x00, 0xff, 0x05, 0x03, 0xe4, 0xbd, 0xa0, // 歌词「你」，落在 tick 0
    0x00, 0x90, 60, 100, // tick 0：音高 60 按下
    0x83, 0x60, 60, 0, // tick 480：running status + 力度 0 = 抬起
    0x00, 62, 100, // tick 480：仍是 running status，音高 62 按下
    0x83, 0x60, 62, 0, // tick 960：抬起
    0x00, 0xff, 0x2f, 0x00, // 结束
  ];
  const chunk = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff,
    (track.length >>> 8) & 0xff, track.length & 0xff,
    ...track,
  ];
  const bytes = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    ...chunk,
  ]);
  const parsed = api.parseMidiFile(bytes);
  assert.deepEqual(pitchesOf(parsed), [60, 62]);
  assert.deepEqual(durationsOf(parsed), [1, 1]);
  assert.equal(parsed.events[0].lyric, "你");
  assert.equal(parsed.tempo, 120);
});

test("MIDI：只有打击乐轨的文件要说清楚，而不是给出一堆噪声", () => {
  const track = [
    0x00, 0x99, 38, 100,
    0x83, 0x60, 0x89, 38, 40,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const chunk = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff,
    (track.length >>> 8) & 0xff, track.length & 0xff,
    ...track,
  ];
  const bytes = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    ...chunk,
  ]);
  assert.throws(() => api.parseMidiFile(bytes), /只有打击乐轨道/);
});

test("MIDI：不是 MIDI 的文件要给出看得懂的错误", () => {
  assert.throws(
    () => api.parseMidiFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])),
    /不是标准 MIDI 文件/,
  );
});

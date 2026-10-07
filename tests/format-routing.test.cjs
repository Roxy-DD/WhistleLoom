/* 格式登记表与导入分流的回归测试。
 *
 * 这一层要防的是「静悄悄地给错数据」：文件后缀经常是错的（MusicXML 另存成 .txt、
 * .mxl 改名成 .xml、从网页存下来没有后缀）。只要分流判错，宽容的解析器就会把整份
 * 文件嚼出几百个垃圾音符，谱面上看着「像那么回事」，用户却拿到一份废谱。
 * 所以这里每一件事都从「喂进来的字节」出发，而不是从「我以为的后缀」出发。
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
  File,
  console,
  window: {},
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
  )}\n${read("abc.js")}\n${read("musicxml.js")}\n${read("midi.js")}\n${read(
    "score-export.js",
  )}\n${read("formats.js")}
globalThis.api = {
  SCORE_FORMATS, formatById, formatForFile, formatForBytes, formatForContent, formatForExtension, importAcceptAttribute,
  importScoreFromFile, decodeTextBytes, extensionOf, unknownFormatMessage,
  generateMusicXml, musicXmlToScore, parseAbc, generateMidi,
};`,
  context,
);
const api = context.api;

const fileOf = (bytes, name, type) => new File([bytes], name, { type });
const utf8 = (text) => new TextEncoder().encode(text);

// ── 登记表本身 ─────────────────────────────────────────────────────────────
test("登记表里每条格式都齐备：人能看懂的标签、说明、后缀数组", () => {
  for (const format of api.SCORE_FORMATS) {
    assert.ok(format.id, "缺 id");
    assert.ok(format.label, `${format.id} 缺 label`);
    assert.ok(format.hint, `${format.id} 缺 hint（导出卡片要显示这行说明）`);
    assert.ok(Array.isArray(format.extensions), `${format.id} 的 extensions 不是数组`);
    assert.ok(format.export, `${format.id} 没有 export`);
  }
});

test("能导入的格式必须声明怎么读文件，否则分流时会读成 undefined", () => {
  for (const format of api.SCORE_FORMATS.filter((item) => item.import))
    assert.ok(
      ["text", "bytes", "file"].includes(format.read),
      `${format.id} 声明了 import，read 却是 ${format.read}`,
    );
});

test("导出卡片上的说明与「无损可还原」的标注只出现一次，且只在真正无损的格式上", () => {
  const reversible = api.SCORE_FORMATS.filter((item) => item.reversible).map((item) => item.id);
  // 跨 realm 的数组不能用 deepStrictEqual 比（原型不同），拼成字符串再比。
  assert.equal(reversible.join(","), "json,pdf,png");
});

test("文件选择框的 accept 由登记表生成，且没有重复后缀", () => {
  const accept = api.importAcceptAttribute();
  const list = accept.split(",");
  assert.equal(new Set(list).size, list.length, "accept 里有重复后缀");
  for (const extension of [".abc", ".musicxml", ".mxl", ".mid", ".json", ".pdf", ".png"])
    assert.ok(list.includes(extension), `accept 里少了 ${extension}`);
});

// ── 字节解码 ───────────────────────────────────────────────────────────────
// 外来文件的编码没有保证。记事本「另存为 Unicode」给的是带 BOM 的 UTF-16LE，
// 有些老工具给的是带 BOM 的 UTF-16BE，而 UTF-8 的 BOM 会变成正文第一个字符。
// 这三种都必须读对，否则用户看到的第一个字符就是 \uFEFF，卡掉后面所有行首正则。
const encodeUtf16 = (text, little) => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2 + (little ? 0 : 1)] = code & 0xff;
    out[i * 2 + (little ? 1 : 0)] = code >> 8;
  }
  return out;
};
test("字节转文本：UTF-8 与带 BOM 的 UTF-8，BOM 要剥掉", () => {
  const plain = "X:1\nK:D\nD2 E F2 G|";
  assert.equal(api.decodeTextBytes(utf8(plain)), plain);
  assert.equal(api.decodeTextBytes(utf8("\uFEFF" + plain)), plain, "UTF-8 BOM 没剥掉");
});
test("字节转文本：带 BOM 的 UTF-16 大端小端都要读对", () => {
  const plain = "X:1\nK:D\nD2 E F2 G|";
  assert.equal(
    api.decodeTextBytes(new Uint8Array([0xff, 0xfe, ...encodeUtf16(plain, true)])),
    plain,
    "带 BOM 的 UTF-16LE 没读对",
  );
  assert.equal(
    api.decodeTextBytes(new Uint8Array([0xfe, 0xff, ...encodeUtf16(plain, false)])),
    plain,
    "带 BOM 的 UTF-16BE 没读对",
  );
});
test("字节转文本：没有 BOM 的 UTF-16LE 会被 UTF-8 解成满屏空字符，要退回去再试一次", () => {
  const plain = "X:1\nK:D\nD2 E F2 G|";
  const decoded = api.decodeTextBytes(encodeUtf16(plain, true));
  assert.equal(decoded, plain);
  // 没有 BOM 的 UTF-16BE 在原理上就和小端分不开（字节序列都合法），这里只保证不崩。
  assert.equal(typeof api.decodeTextBytes(encodeUtf16(plain, false)), "string");
});

// ── 内容分流 ───────────────────────────────────────────────────────────────
test("后缀写错也不怕：MusicXML 的内容存成 .abc，必须按 MusicXML 走而不是被 ABC 嚼成垃圾", async () => {
  const xml = api.generateMusicXml({
    title: "分流测试", tonic: "D", mode: "dorian", meter: "6/8", tempo: 120,
    whistleKey: "D",
    events: [
      { pitch: 62, duration: 1 }, { pitch: 64, duration: 0.5 },
      { pitch: null, duration: 0.5 }, { pitch: 69, duration: 2 },
    ],
  });
  const parsed = await api.importScoreFromFile(fileOf(utf8(xml), "弄错了.abc"));
  assert.equal(parsed.events.length, 4, "被 ABC 解析器嚼成了别的音数");
  assert.deepEqual(Array.from(parsed.events, (e) => e.pitch), [62, 64, null, 69]);
  assert.equal(parsed.tonic, "D");
  assert.equal(parsed.meter, "6/8");
});

test("后缀写错也不怕：ABC 的内容存成 .json，要按 ABC 走", async () => {
  const abc = "X:1\nT:存错了\nM:4/4\nL:1/8\nQ:1/4=100\nK:G\nG2 A B2 c|";
  const parsed = await api.importScoreFromFile(fileOf(utf8(abc), "记错.json"));
  assert.equal(parsed.tonic, "G");
  assert.deepEqual(Array.from(parsed.events, (e) => e.pitch), [67, 69, 71, 72]);
});

test(".mxl（zip 包着的 MusicXML）改名成 .abc 也要按魔数认出来", async () => {
  const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "sample.mxl"));
  const format = api.formatForBytes(new Uint8Array(fixture));
  assert.equal(format.id, "musicxml");
  const parsed = await api.importScoreFromFile(
    fileOf(fixture, "乱改的名字.abc"),
  );
  assert.ok(parsed.events.length > 0, "zip 里的 MusicXML 没解出来");
});

test("MIDI 的 MThd 头按魔数认出来，不看后缀", () => {
  const bytes = api.generateMidi({
    title: "魔数", tonic: "D", mode: "major", meter: "4/4", tempo: 100,
    events: [{ pitch: 74, duration: 1 }],
  });
  assert.equal(api.formatForBytes(bytes).id, "midi");
});

test("认不出的文件给出人话提示，并且把支持的后缀一并列出来", async () => {
  await assert.rejects(
    api.importScoreFromFile(fileOf(utf8("就是一段散文，既不是谱也不是数据"), "随手记.txt")),
    (error) => {
      assert.match(error.message, /认不出/);
      assert.match(error.message, /\.musicxml/);
      return true;
    },
  );
});

test("没有后缀的文件靠内容也能分流", () => {
  assert.equal(api.formatForFile("", "X:1\nK:D\nD2 E F2 G|").id, "abc");
  assert.equal(
    api.formatForFile("", '<?xml version="1.0"?><score-partwise></score-partwise>').id,
    "musicxml",
  );
  assert.equal(api.formatForFile("", '{"events":[]}').id, "json");
  assert.equal(api.formatForFile("", "既不是谱也不是数据"), null);
});

// ── 文本面板的粘贴通道 ─────────────────────────────────────────────────────
// 文本格式面板（「给 AI 或其他记谱软件用」那个折叠区）手里只有一段字符串。像 MusicXML
// 这种「文件导入要字节、可能要解 .mxl」的格式，粘贴时只能给文本 —— 两条路必须是两个函数，
// 否则「生成 MusicXML → 粘回去 → 载入」这条最常用的路会直接崩。
test("文本格式面板：显示在下拉里的格式，都要能只靠一段字符串读回来", async () => {
  const source = {
    title: "粘贴测试", tonic: "D", mode: "dorian", meter: "6/8", tempo: 120,
    whistleKey: "D",
    events: [
      { pitch: 62, duration: 1 }, { pitch: 64, duration: 0.5 },
      { pitch: null, duration: 0.5 }, { pitch: 69, duration: 2 },
    ],
  };
  const textFormats = api.SCORE_FORMATS.filter((item) => item.text);
  assert.ok(textFormats.length >= 2, "文本格式至少要有 ABC 与 MusicXML");
  for (const format of textFormats) {
    const generated = format.export(source);
    assert.equal(typeof generated.data, "string", `${format.id} 的导出不是文本`);
    const reader = format.importText || format.import;
    assert.equal(typeof reader, "function", `${format.id} 没有可用的文本导入通道`);
    const back = await reader({ file: null, name: `${format.id} 文本`, text: generated.data });
    assert.ok(back && Array.isArray(back.events) && back.events.length, `${format.id} 往返后没有音符`);
    assert.equal(back.tonic, "D", `${format.id} 往返后主音变了`);
    assert.equal(back.meter, "6/8", `${format.id} 往返后拍号变了`);
  }
});

test("文本格式面板：没有 importText 的格式回落到同一份 import", () => {
  const abc = api.formatById("abc");
  assert.equal(abc.importText, undefined);
  assert.equal(typeof abc.import, "function");
  const parsed = abc.import({ text: "X:1\nT:t\nM:4/4\nL:1/8\nK:G\nG2 A B2 c|" });
  assert.equal(parsed.tonic, "G");
});

test("parseAbc 碰到没有信息字段的文本要明确拒绝，而不是嚼出几百个垃圾音符", () => {
  const xml = api.generateMusicXml({
    title: "别嚼我", tonic: "C", mode: "major", meter: "4/4", tempo: 96,
    events: [{ pitch: 60, duration: 1 }],
  });
  assert.throws(() => api.parseAbc(xml), /找不到 ABC 的信息字段/);
  assert.throws(() => api.parseAbc("随便写点什么，连一个字母冒号都没有。"), /找不到 ABC 的信息字段/);
});

test("只要有一个信息字段就算 ABC，不误伤简短的谱例", () => {
  const parsed = api.parseAbc("K:D\nD2 E F2 G|");
  assert.equal(parsed.tonic, "D");
  assert.equal(parsed.events.length, 4, "缺 L: 时应当按拍号推单位长度，而不是不解析");
});

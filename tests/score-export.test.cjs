const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
// tr() 住在 js/i18n.js 里（浏览器由 index.html 先加载）。见 vm-i18n.cjs。
const i18n = require("./vm-i18n.cjs");

const source = fs.readFileSync(path.join(__dirname, "../js/score-export.js"), "utf8");
// abc.js 依赖导入边境层（时值吸附 / 延音线降级），vm 里要按这个顺序载入。
const scoreImport = fs.readFileSync(
  path.join(__dirname, "../js/score-import.js"),
  "utf8",
);
const window = {};
vm.runInNewContext(source, {
  window,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  DataView,
  Blob,
  URL,
  setTimeout,
});

test("Sí Bheag Sí Mhór example imports to the same pitches as its project score", () => {
  const model = fs.readFileSync(path.join(__dirname, "../js/score-model.js"), "utf8");
  const music = fs.readFileSync(path.join(__dirname, "../js/music.js"), "utf8");
  const abc = fs.readFileSync(path.join(__dirname, "../js/abc.js"), "utf8");
  const examples = fs.readFileSync(path.join(__dirname, "../js/examples.js"), "utf8");
  const context = vm.createContext({
    $: () => ({ value: "D" }),
    keyMidi: { C: 60, "C#": 61, D: 62, Eb: 63, E: 64, F: 65, "F#": 66, G: 67, Ab: 68, A: 69, Bb: 70, B: 71 },
    pcSharp: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"],
    pcFlat: ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"],
    naturalPc: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 },
  });
  vm.runInContext(`${i18n}\n${model}\n${scoreImport}\n${music}\n${abc}\n${examples}\nglobalThis.api={parseAbc,sampleAbc};`, context);
  const parsed = context.api.parseAbc(context.api.sampleAbc.sheebeg);
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, "../scores/Si-Bheag-Si-Mhor_D调哨笛.json"), "utf8"));
  assert.equal(parsed.title, file.title);
  assert.equal(parsed.composer, file.composer);
  assert.equal(parsed.lyricist, file.lyricist);
  assert.equal(parsed.arranger, file.arranger);
  assert.equal(parsed.sourceTonic, file.sourceTonic);
  assert.equal(file.sourceTonic, "");
  assert.equal(file.tonic, "D");
  assert.equal(file.meter, "3/4");
  assert.equal(file.tempo, 132);
  assert.equal(parsed.events.length, file.events.length);
  assert.deepEqual(Array.from(parsed.events, (event) => event.pitch), file.events.map((event) => event.pitch));
  assert.deepEqual(Array.from(parsed.events, (event) => event.duration), file.events.map((event) => event.duration));
  assert.deepEqual(Array.from(parsed.events, (event) => event.barAfter), file.events.map((event) => event.barAfter));
  let beatCount = 0;
  let barIndex = 0;
  for (const event of file.events) {
    beatCount += event.duration;
    if (event.barAfter) {
      if (barIndex === 0) {
        assert.equal(beatCount, 1, "首小节是弱起：只有一拍");
      } else {
        assert.equal(beatCount, 3, `第 ${barIndex + 1} 小节应合计三拍`);
      }
      barIndex += 1;
      beatCount = 0;
    }
  }
  assert.equal(beatCount, 0, "曲谱应在小节线结束");
  assert.equal(barIndex, 34, "整曲共 34 个小节");
});

test("The Sally Gardens example stays aligned with its editable project score", () => {
  const model = fs.readFileSync(path.join(__dirname, "../js/score-model.js"), "utf8");
  const music = fs.readFileSync(path.join(__dirname, "../js/music.js"), "utf8");
  const abc = fs.readFileSync(path.join(__dirname, "../js/abc.js"), "utf8");
  const examples = fs.readFileSync(path.join(__dirname, "../js/examples.js"), "utf8");
  const context = vm.createContext({
    $: () => ({ value: "D" }),
    keyMidi: { C: 60, "C#": 61, D: 62, Eb: 63, E: 64, F: 65, "F#": 66, G: 67, Ab: 68, A: 69, Bb: 70, B: 71 },
    pcSharp: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"],
    pcFlat: ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"],
    naturalPc: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 },
  });
  vm.runInContext(`${i18n}\n${model}\n${scoreImport}\n${music}\n${abc}\n${examples}\nglobalThis.parse=parseAbc; globalThis.example=sampleAbc.sallygardens;`, context);
  const parsed = context.parse(context.example);
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "../scores/The-Sally-Gardens_D调哨笛.json"), "utf8"));
  assert.equal(parsed.title, "The Sally Gardens");
  assert.equal(parsed.tonic, "G");
  assert.equal(parsed.whistleKey, "D");
  assert.equal(parsed.events.length, saved.events.length);
  assert.deepEqual(Array.from(parsed.events, (event) => event.pitch), saved.events.map((event) => event.pitch));
  assert.deepEqual(Array.from(parsed.events, (event) => event.duration), saved.events.map((event) => event.duration));
  assert.equal(parsed.events.filter((event) => event.lyric).length, 0, "器乐曲不应带歌词");
  assert.equal(saved.events.filter((event) => event.barAfter).length, 16);
  let beatCount = 0;
  for (const event of saved.events) {
    beatCount += event.duration;
    if (event.barAfter) {
      assert.equal(beatCount, 4, "每个 4/4 小节都应合计四拍");
      beatCount = 0;
    }
  }
  assert.equal(beatCount, 0, "曲谱应在小节线结束");
});

test("PNG embedded score metadata round-trips as valid iTXt payload", async () => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(12);
  header.set([0, 0, 0, 0], 0);
  header.set(new TextEncoder().encode("IHDR"), 4);
  const score = {
    schemaVersion: 1,
    title: "示例曲谱",
    tonic: "D",
    mode: "major",
    meter: "4/4",
    whistleKey: "D",
    tempo: 96,
    originalTempo: 96,
    events: [{ pitch: 71, duration: 1, lyric: "人", barAfter: false }],
  };
  const png = await window.ScoreExport.embedScoreInPng(new Blob([signature, header], { type: "image/png" }), score);
  const restored = await window.ScoreExport.scoreFromPng(png);
  assert.equal(JSON.stringify(restored), JSON.stringify(score));

  const encoded = Buffer.from(await png.arrayBuffer());
  const chunkStart = encoded.indexOf(Buffer.from("iTXt")) - 4;
  const chunkLength = encoded.readUInt32BE(chunkStart);
  const dataStart = chunkStart + 8;
  const dataEnd = dataStart + chunkLength;
  const legacyData = Buffer.concat([
    encoded.subarray(dataStart, dataStart + 15),
    encoded.subarray(dataStart + 16, dataEnd),
  ]);
  const legacyHeader = Buffer.alloc(8);
  legacyHeader.writeUInt32BE(legacyData.length, 0);
  legacyHeader.write("iTXt", 4, "ascii");
  const legacyPng = Buffer.concat([
    encoded.subarray(0, chunkStart),
    legacyHeader,
    legacyData,
    Buffer.alloc(4),
    encoded.subarray(dataEnd + 4),
  ]);
  const recoveredLegacy = await window.ScoreExport.scoreFromPng(new Blob([legacyPng]));
  assert.equal(JSON.stringify(recoveredLegacy), JSON.stringify(score));
});

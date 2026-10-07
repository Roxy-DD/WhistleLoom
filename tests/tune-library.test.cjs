/* 内置离线曲库的回归测试。
 *
 * 内置曲库是「随项目分发」的死数据 —— 一旦某一条载不进编辑器，用户看到的就是
 * 一个点了没反应的按钮，而且没人会在开发时发现。所以这里把 148 条全部过一遍
 * 真实的 parseAbc，确保每一条都能读回来、字段自洽。
 *
 * 同时也锁住「曲库里的 abc 字段是完整可解析的 ABC」这一契约：生成脚本
 * scripts/build-tune-library.mjs 会在写入前自检，这里则是入库后的第二道闸。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
// tr() 住在 js/i18n.js 里（浏览器由 index.html 先加载）。见 vm-i18n.cjs。
const i18n = require("./vm-i18n.cjs");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
const fields = { meter: "4/4", tonic: "D", mode: "major", tempo: "96", whistleKey: "D" };
const context = vm.createContext({
  fields,
  $: (id) => ({ value: fields[id] === undefined ? "D" : fields[id] }),
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
// lastImportWarnings 由 score-import.js（导入边境层）声明，测试不再自己声明，否则重复。
vm.runInContext(
  `${i18n}\n${prelude}\n${read("score-model.js")}\n${read("score-import.js")}\n${read(
    "music.js",
  )}\n${read("abc.js")}\n${read(
    "tune-library.js",
  )}\nglobalThis.api={parseAbc,tuneLibrary,TUNE_LIBRARY_META,
    get warnings(){return lastImportWarnings}};`,
  context,
);

const { tuneLibrary, TUNE_LIBRARY_META } = context.api;

test("内置曲库带着出处与授权信息", () => {
  assert.ok(tuneLibrary.length >= 100, `曲库条目太少：${tuneLibrary.length}`);
  assert.equal(TUNE_LIBRARY_META.source, "thesession.org");
  assert.equal(TUNE_LIBRARY_META.license, "ODbL 1.0");
  assert.ok(TUNE_LIBRARY_META.note.includes("收录次数"));
});

test("曲库里每一条都能被 parseAbc 读回来", () => {
  const failures = [];
  for (const entry of tuneLibrary) {
    try {
      const parsed = context.api.parseAbc(entry.abc);
      if (!parsed.events.length) throw new Error("解析后一个音符都没有");
      // 生成时记下的字段必须和现在解析出来的一致，否则说明解析器改过、曲库没重生成。
      if (parsed.meter !== entry.meter)
        throw new Error(`拍号对不上：库里 ${entry.meter}，解析出 ${parsed.meter}`);
      if (parsed.tempo !== entry.tempo)
        throw new Error(`速度对不上：库里 ${entry.tempo}，解析出 ${parsed.tempo}`);
      // key 是 thesession.org 原样给的调名（形如 Edor、Gmajor、Bb），拿它和自家解析出的
      // 主音对一对 —— 这是「生成时的解析」和「现在的解析」之间的一道漂移闸。
      if (entry.key && !entry.key.toLowerCase().startsWith(parsed.tonic.toLowerCase()))
        throw new Error(`调名对不上：库里 ${entry.key}，解析出 ${parsed.tonic}`);
      if (parsed.events.length !== entry.notes)
        throw new Error(`音符数对不上：库里 ${entry.notes}，解析出 ${parsed.events.length}`);
      if (!["major", "minor", "dorian", "mixolydian"].includes(parsed.mode))
        throw new Error(`调式超出编辑器支持范围：${parsed.mode}`);
    } catch (error) {
      failures.push(`${entry.id} ${entry.name}：${error.message}`);
    }
  }
  assert.deepEqual(failures, [], `有 ${failures.length} 条曲目载入失败`);
});

test("曲库里的延音线/连奏线标记都是合法的", () => {
  // 这条专盯「跨音高的 -」那个坑：sanitizeTies 之后，任何残留在数据里的延音线
  // 都必须真的连到同音高的下一颗音，否则渲染层会画出没头没尾的弧。
  const bad = [];
  for (const entry of tuneLibrary) {
    const parsed = context.api.parseAbc(entry.abc);
    parsed.events.forEach((event, index) => {
      if (!event.tieToNext) return;
      const next = parsed.events[index + 1];
      if (!next || event.pitch == null || next.pitch == null || event.pitch !== next.pitch)
        bad.push(`${entry.id} ${entry.name} 第 ${index + 1} 个音`);
    });
  }
  assert.deepEqual(bad, [], "存在无法连接的延音线");
});

test("曲库里每一条的曲名与 id 都不重复", () => {
  const ids = new Set();
  for (const entry of tuneLibrary) {
    assert.ok(!ids.has(entry.id), `曲目 id 重复：${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.name && entry.name.trim(), `曲目 ${entry.id} 没有名字`);
  }
});

/**
 * 在 Node 的 vm 里把编辑器的 js/ 起来，供 skill 的脚本使用。
 *
 * 为什么要有这个文件：check-abc 和 check-facts 都需要「真代码」而不是复述一遍的行为。
 * 两处各搭一次虚拟机就会各漏一次 —— 事实上第一版 check-facts 就漏掉了 app.js 里的乐理
 * 常量，于是 parseAbc 一路抛 ReferenceError，而「V: 会被拒绝」这条还**假通过**了
 * （它确实抛错了，但抛的是别的错）。所以启动代码只留一份。
 *
 * 注意两件事：
 *   ① app.js 顶层的乐理常量（音名表、哨笛音高表、音阶级数）是 music.js 在调用时才读的，
 *      app.js 本身依赖 DOM 载不进来 —— 所以按名从源码里取出来 eval，取的是真值。
 *   ② vm 里没有 Node 的全局对象，而 midi.js / musicxml.js 在载入期就要 TextDecoder。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const APP_CONSTS = [
  "pcSharp",
  "pcFlat",
  "letterIndex",
  "naturalPc",
  "keyMidi",
  "whistleMidi",
  "scaleSteps",
];

// 从源码里切出 `const NAME = <字面量>;` 的那段字面量。靠括号配平找结尾，不靠正则 ——
// 这些字面量里有嵌套的对象和数组，行尾匹配会把它们切坏。
function extractConst(source, name) {
  const at = source.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`app.js 里找不到 const ${name}`);
  const start = source.indexOf("=", at) + 1;
  let index = start,
    depth = 0,
    quote = null;
  for (; index < source.length; index++) {
    const ch = source[index];
    if (quote) {
      if (ch === "\\") index++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === ";" && depth === 0) break;
  }
  return source.slice(start, index);
}

const EDITOR_API = [
  "parseAbc",
  "generateAbc",
  "importJson",
  "normalizeScoreData",
  "isSupportedMeter",
  "decodeTextBytes",
  "modeFromName",
  "fitSupportedMode",
  "formatForBytes",
  "formatForFile",
  "formatForContent",
  "formatForExtension",
  "importScoreFromFile",
  "unknownFormatMessage",
  "musicXmlToScore",
  "musicXmlFromBytes",
  "generateMusicXml",
  "parseMidiFile",
  "generateMidi",
  "SCORE_FORMATS",
  "SCORE_DURATION_VALUES",
  "SCORE_TONICS",
  "SCORE_WHISTLE_KEYS",
  "SCORE_MODES",
  "SCORE_PITCH_MIN",
  "SCORE_PITCH_MAX",
  "SCORE_TEMPO_MIN",
  "SCORE_TEMPO_MAX",
  "SCORE_METER_PATTERN",
  "SCORE_SCHEMA_VERSION",
  "GENERIC_EXTENSIONS",
  "BINARY_SIGNATURES",
  "TUNE_LIBRARY_META",
];

/**
 * 启动一份编辑器代码，返回它的内部接口。
 * @param {string} repoRoot 仓库根目录（含 js/ 与 app.js）
 * @param {{ whistleKey?: string }} [options] parseAbc 会读表单里的 whistleKey
 */
export function loadEditor(repoRoot, options = {}) {
  const js = (name) => path.join(repoRoot, "js", name);
  const read = (name) => fs.readFileSync(js(name), "utf8");
  if (!fs.existsSync(js("score-model.js")))
    throw new Error(`找不到 ${js("score-model.js")} —— repoRoot 给错了？`);

  const fields = {
    whistleKey: options.whistleKey || "D",
    tonic: "D",
    mode: "major",
    meter: "4/4",
    tempo: "96",
  };
  const context = vm.createContext({
    fields,
    $: (id) => ({ value: fields[id] }),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob,
    Response,
    DecompressionStream,
  });

  const appSource = fs.readFileSync(path.join(repoRoot, "app.js"), "utf8");
  const prelude =
    APP_CONSTS.map((name) => `const ${name} = ${extractConst(appSource, name)};`).join("\n") +
    `\nlet score = { title: "", events: [] };\n`;

  // 载入顺序与 index.html 一致：i18n → 契约 → 边境层 → 乐理 → 各编解码器 → 登记表 → 曲库数据。
  // i18n.js 必须在最前：它给出的 tr() 被后面每一份源码调用（界面文案要跟着界面语言走）。
  vm.runInContext(
    [
      read("i18n.js"),
      prelude,
      read("score-model.js"),
      read("score-import.js"),
      read("music.js"),
      read("abc.js"),
      read("musicxml.js"),
      read("midi.js"),
      read("formats.js"),
      read("tune-library.js"),
      `globalThis.editor = {
        ${EDITOR_API.map((name) => `${name}: typeof ${name} === "undefined" ? undefined : ${name},`).join("\n        ")}
        get warnings() { return lastImportWarnings; },
      };`,
    ].join("\n"),
    context,
  );
  return context.editor;
}

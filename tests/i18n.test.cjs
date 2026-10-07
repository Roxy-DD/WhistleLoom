/**
 * 国际化层的回归测试。
 *
 * 为什么必须进测试套件：**漏译不会报错**。`tr("没收录的一句")` 在中英两边的行为都「正常」——
 * 英文界面里它就原样显示中文。没有异常、没有警告，用英文界面的人却看见半页中文。
 * 这跟当初那条「文档写了规则却不执行就变成罪证」是同一类问题：不查就等于没有。
 *
 * 这里分两层查：
 *   ① 静态：语言表 ↔ 代码/页面里的实际文案，两边对一遍（断言逻辑在 scripts/check-i18n.mjs，
 *      由 `npm test` 和手动跑命令行共用同一份，不会各说各话）。
 *   ② 运行时：在 vm 里真的用英文环境载入 js/i18n.js，跑几句真话，确认它查得到、退得回、
 *      来回切不套娃 —— 光看静态表全不全，证明不了 tr() 本身是对的。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "check-i18n.mjs");

test("界面文案没有漏译，语言表里也没有归一化撞车", async () => {
  const { runChecks, formatReport, hasFatal } = await import(pathToFileURL(CHECKER).href);
  const report = runChecks(ROOT);
  assert.equal(hasFatal(report), false, `\n${formatReport(report)}\n`);

  // 只断言「没有漏译」还不够：整个 i18n 层要是被人拔掉，missing 照样是空的
  // （没有 tr() 调用，自然也就没有查不到的键）。所以再确认它确实在干活。
  assert.ok(report.keys > 300, `语言表条目太少：${report.keys}`);
  assert.ok(report.wired > 300, `真正接上线的键太少：${report.wired}`);
  assert.deepEqual(report.unwrapped, [], `\n${formatReport(report)}\n`);
});

/** 在 vm 里载入真的 js/i18n.js（不是桩），可以指定浏览器环境里那几个全局对象。 */
function loadI18n(globals = {}) {
  const source = fs.readFileSync(path.join(ROOT, "js", "i18n.js"), "utf8");
  const context = vm.createContext({ console, ...globals });
  vm.runInContext(
    `${source}
globalThis.api = { tr, i18nSetLang, i18nLang, i18nNorm, I18N_LANGS, I18N_SOURCE_LANG };`,
    context,
  );
  return context.api;
}

/** 造一个够用的 localStorage：i18n 只用到 getItem / setItem。 */
function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

test("英文环境下 tr() 真的返回英文，未收录的键原样退回中文", () => {
  const api = loadI18n({ navigator: { language: "en-US" } });
  assert.equal(api.i18nLang(), "en");
  assert.equal(api.tr("撤销"), "Undo");
  assert.equal(api.tr("停止"), "Stop");
  // 带占位符的句子：值随句子一起填进去，而不是先拼好再查表。
  assert.equal(api.tr("已导入《{title}》。", { title: "X" }), "Imported “X”.");
  assert.equal(
    api.tr("第 {index} 个音符音高超出可处理范围。", { index: 3 }),
    "Note 3 has a pitch outside the supported range.",
  );
  // 没有值的占位符原样留着 —— 让 {title} 印在界面上，比印一片空白更容易被发现。
  assert.equal(api.tr("已导入《{title}》。"), "Imported “{title}”.");
  // 没收录的句子退回中文原文，绝不会印出 "ui.toolbar.undo" 这种符号键。
  assert.equal(api.tr("这句还没收录"), "这句还没收录");
});

test("中文环境（含命令行）一律是中文原文 —— 既有单测断言的正是中文", () => {
  const api = loadI18n({ navigator: { language: "zh-CN" } });
  assert.equal(api.i18nLang(), "zh");
  assert.equal(api.tr("撤销"), "撤销");
  assert.equal(api.tr("第 {index} 个音符音高超出可处理范围。", { index: 3 }), "第 3 个音符音高超出可处理范围。");

  // 没有 navigator 时（Node 单测、命令行校验脚本就是这个环境）必须落到中文。
  const bare = loadI18n();
  assert.equal(bare.i18nLang(), "zh");
  assert.equal(bare.tr("撤销"), "撤销");
});

test("来回切语言不会层层套娃：每次都是从中文原文重查", () => {
  const storage = fakeStorage();
  const api = loadI18n({ navigator: { language: "zh-CN" }, localStorage: storage });
  api.i18nSetLang("en");
  assert.equal(api.tr("撤销"), "Undo");
  assert.equal(storage.getItem("whistleloom.lang"), "en");
  api.i18nSetLang("zh");
  // 若实现是把「当前显示的文字」当键再查一次，这里会卡在英文上 —— 那正是要防的。
  assert.equal(api.tr("撤销"), "撤销");
  api.i18nSetLang("en");
  assert.equal(api.tr("撤销"), "Undo");
  // 不认识的语言代码要退回源语言，不能把界面卡成空白。
  api.i18nSetLang("klingon");
  assert.equal(api.i18nLang(), api.I18N_SOURCE_LANG);
  assert.equal(api.tr("撤销"), "撤销");
});

test("归一化：HTML 里为排版换的行不该把键弄脏", () => {
  const { i18nNorm } = loadI18n();
  // 中文句子中间被 HTML 换行切开 —— 压空白后留下的那个空格要去掉。
  assert.equal(i18nNorm("\n  曲库数据来自 thesession.org，载入时会把谱例换成编辑器能\n  表达的记法。\n"),
    "曲库数据来自 thesession.org，载入时会把谱例换成编辑器能表达的记法。");
  // 句末标点后面被换行切开同理（后边常常跟着 PDF / PNG / AI 这类拉丁词）。
  assert.equal(i18nNorm("署名。\n          PDF 与 PNG"), "署名。PDF 与 PNG");
  // 但汉字与拉丁词之间的空格是**真空格**，必须留着。
  assert.equal(i18nNorm("适合贴给\n              AI；"), "适合贴给 AI；");
  assert.equal(i18nNorm("1 个音符"), "1 个音符");
});

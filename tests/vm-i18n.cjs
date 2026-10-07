/* 给命令行里的 vm 补上 i18n 层。
 *
 * 被测源码现在会调用 tr()（界面文案要跟着界面语言走），而 tr() 住在 js/i18n.js 里。
 * 浏览器里 index.html 会在所有模块之前先加载它，命令行里没有 index.html ——
 * 所以这里把**同一份** js/i18n.js 读出来，拼在被测源码前面。
 *
 * 刻意不在这里写一个 `tr = (s) => s` 的桩：那样命令行测的和浏览器跑的就成了两套实现，
 * 单测全绿也只证明了「桩是对的」。读真源码还顺带保证 i18n.js 语法错误会当场暴露。
 *
 * 命令行环境里没有 location / localStorage / navigator，i18nLang() 会走兜底分支
 * 返回中文 —— 这正是既有测试要的：它们断言的就是中文提示语。
 */
const fs = require("node:fs");
const path = require("node:path");

module.exports = fs.readFileSync(path.join(__dirname, "..", "js", "i18n.js"), "utf8");

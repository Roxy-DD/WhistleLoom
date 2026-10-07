#!/usr/bin/env node
/* 国际化自检：语言表 ↔ 代码里的实际文案，两边对一遍。
 *
 * 为什么要机器来查：漏译不会报错。`tr("没收录的一句")` 在中英两边的行为都「正常」——
 * 英文界面里它就原样显示中文。没有报错、没有异常、测试还是绿的，只有用英文界面的
 * 人看得见。这跟当初那条「文档写了规则却不执行就变成罪证」是同一类问题：
 * **不查就等于没有**。
 *
 * 查四件事：
 *   ① 代码里 `tr(...)` 用到的键，语言表里必须有        —— 少了就是漏译（致命）
 *   ② index.html 里标了 data-i18n* 的文案，表里必须有  —— 同上（致命）
 *   ③ 语言表里有、但代码和页面里都找不到的键           —— 死条目（提示）
 *   ④ 代码里带汉字、却没被 tr() 包起来的字符串字面量   —— 可能漏接 i18n（提示）
 *
 * 扫描方式：**一趟车走完**。游标每走一步先判当前状态（代码 / 行注释 / 块注释 /
 * 字符串 / 模板 / 正则字面量），在同一个游标下顺手把「字面量」和「它前面是不是
 * tr(」一起记下来。
 *
 * 为什么不能拆成两趟（先剥注释、再扫字面量）：那样第二趟的位置全靠第一趟的输出
 * 对齐，第一趟哪怕只错判一个字符（比如把 `/^.../` 里的 `/` 当成注释开头），
 * 剥掉的就不只是注释而是半份代码，后面所有字面量跟着错位——**错一处，脏一片**，
 * 而且报出来的是「长度 462 的字面量」这种看不出病因的假报。
 * 单趟走没有这个问题：判错一处，最多就是那一处的状态走歪，不会连锁。
 *
 * 用法：
 *   node scripts/check-i18n.mjs            # 人读的报告
 *   node scripts/check-i18n.mjs --json     # 给测试脚本读
 * 退出码：有致命问题（漏译）时为 1。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_LANG = "zh";

// 只有界面源码要查。examples.js / tune-library.js 里的中文是**曲谱数据**（曲名、歌词、
// ABC 正文），不是给人读的界面文案，翻译它们等于篡改数据。
const JS_FILES = [
  "app.js",
  "js/music.js",
  "js/score-model.js",
  "js/score-import.js",
  "js/notation.js",
  "js/abc.js",
  "js/musicxml.js",
  "js/midi.js",
  "js/score-export.js",
  "js/formats.js",
  "js/tune-source.js",
];

/* 什么样的字面量「需要翻译」。刻意**只要汉字和全角 ASCII**：
 *   · 「、」「《》」「“”」「—」「·」是**标点**，中英两边长得一样，不该进语言表，
 *     也不该被 ④ 报出来当噪声——它们留在代码里是对的。
 *   · 只有汉字（\u4e00-\u9fff）和全角 ASCII（\uff01-\uff5e，如「，」「：」「（）」）
 *     才是「必须换掉、否则英文界面里是中文」的东西。
 */
const NEEDS_TRANSLATION = /[\u4e00-\u9fff\uff01-\uff5e]/;

/**
 * 一趟扫完。返回：
 *   literals: [{ text, at, line, tr }]  —— text 是字面量正文（转义原样保留），
 *                                          tr 表示「这个字面量是 tr(...) 的第一个实参」
 *
 * 状态判据里唯一需要启发式的是「`/` 是除号还是正则开头」：
 * 看它前面最后一个**有意义的代码字符**能不能结束一个表达式（标识符、数字、右括号、
 * 引号、模板尾）。能 → 除号；不能 → 正则开头。判错只会让那一个正则被当除法、
 * 里面的字面量多扫几条，**不会连锁**。
 */
function scan(source) {
  const literals = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  // 最近若干个「代码」字符（不含空白、注释、字符串正文），只留尾巴，用来判 `tr(`。
  let recent = "";
  const note = (ch) => {
    recent = (recent + ch).slice(-16);
  };
  const isTrOpen = () => /(^|[^\w$.])tr\($/.test(recent);

  /** 反引号模板的正文（开头的反引号已被吃掉）。返回收集到的正文。 */
  function readTemplateBody() {
    let text = "";
    while (i < n) {
      const c = source[i];
      if (c === "\\") {
        text += c + (source[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        break;
      }
      if (c === "$" && source[i + 1] === "{") {
        text += "${";
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const d = source[i];
          if (d === "\n") {
            line++;
            text += d;
            i++;
            continue;
          }
          if (d === "{") {
            depth++;
            text += d;
            i++;
            continue;
          }
          if (d === "}") {
            depth--;
            text += d;
            i++;
            continue;
          }
          if (d === '"' || d === "'" || d === "`") {
            const q = d;
            i++;
            text += q;
            if (q === "`") {
              text += readTemplateBody() + "`";
            } else {
              while (i < n) {
                if (source[i] === "\n") line++;
                if (source[i] === "\\") {
                  text += source[i] + (source[i + 1] ?? "");
                  i += 2;
                  continue;
                }
                text += source[i];
                if (source[i] === q) {
                  i++;
                  break;
                }
                i++;
              }
            }
            continue;
          }
          text += d;
          i++;
        }
        continue;
      }
      if (c === "\n") line++;
      text += c;
      i++;
    }
    return text;
  }

  /** 读一个字符串或模板，登记；调用时 source[i] 是引号。 */
  function readQuoted() {
    const quote = source[i];
    const at = i;
    const line0 = line;
    let text = "";
    i++;
    if (quote === "`") {
      text = readTemplateBody();
    } else {
      while (i < n) {
        if (source[i] === "\n") line++;
        if (source[i] === "\\") {
          text += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        text += source[i];
        i++;
      }
    }
    literals.push({ text, at, line: line0, tr: isTrOpen() });
    note("0"); // 一个字面量整体算一个「能结束表达式」的操作数
  }

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      readQuoted();
      continue;
    }
    if (c === "/") {
      const canEndValue = /[A-Za-z0-9_$)\]}"'`]/.test(recent.at(-1) ?? "");
      if (canEndValue) {
        note(c);
        i++;
        continue;
      }
      // 正则字面量：整段跳过，免得里面的 `/` 被当注释开头。字符类里的 `/` 不算结束。
      i++;
      let inClass = false;
      while (i < n) {
        const d = source[i];
        if (d === "\\") {
          i += 2;
          continue;
        }
        if (d === "\n") break;
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          i++;
          break;
        }
        i++;
      }
      note("0");
      continue;
    }
    if (!/\s/.test(c)) note(c);
    i++;
  }

  return { literals };
}

/** 数到第 offset 个字符为止有几行。 */
function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** 载入 js/i18n.js，取出语言表与归一化函数。 */
function loadDictionary(root) {
  const source = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8");
  const context = vm.createContext({ console });
  vm.runInContext(
    `${source}\nglobalThis.__api = { I18N_EN, I18N_LANGS, i18nNorm, I18N_SOURCE_LANG };`,
    context,
  );
  return context.__api;
}

/**
 * 扫 index.html 里带标记的元素。写法刻意保持「被标记的元素内容里不能再嵌标签」，
 * 这样不必引入 HTML 解析器也能把键取准。三种标记各自的键：
 *   data-i18n               → 元素的整段文字
 *   data-i18n-lead          → 元素开头的裸文本节点
 *   data-i18n-attrs="a b"   → 列出的属性的当前值
 */
function htmlKeys(html) {
  const keys = [];
  const tagPattern = /<([a-zA-Z][^>]*)>/g;
  let match;
  while ((match = tagPattern.exec(html))) {
    const tag = match[1];
    const line = lineOf(html, match.index);
    const after = html.slice(tagPattern.lastIndex);
    const content = (after.match(/^([^<]*)/) || ["", ""])[1];
    if (/\sdata-i18n(?=[\s/>]|$)/.test(` ${tag}`)) {
      if (content.trim()) keys.push({ key: content, line });
      else if (!/\sdata-i18n-lead(?=[\s/>]|$)/.test(` ${tag}`))
        keys.push({ key: `(空文本) ${tag.slice(0, 60)}`, line });
    }
    if (/\sdata-i18n-lead(?=[\s/>]|$)/.test(` ${tag}`)) {
      if (!content.trim()) keys.push({ key: `(空开头文本) ${tag.slice(0, 60)}`, line });
      else keys.push({ key: content, line });
    }
    const attrs = tag.match(/\sdata-i18n-attrs\s*=\s*"([^"]*)"/);
    if (attrs) {
      for (const name of attrs[1].split(/\s+/).filter(Boolean)) {
        const value = tag.match(new RegExp(`\\s${name.replace(/[-]/g, "\\-")}\\s*=\\s*"([^"]*)"`));
        if (value) keys.push({ key: value[1], line });
        else keys.push({ key: `(缺少属性 ${name})`, line });
      }
    }
  }
  return keys;
}

/**
 * 扫一遍仓库，返回四类问题。
 * 导出成函数是为了让 `node --test` 直接调它（见 tests/i18n.test.cjs）——
 * 「手动跑一遍」和「测试跑一遍」必须是同一份逻辑，不能各写一套然后慢慢分叉。
 * @param {string} root 仓库根目录
 */
export function runChecks(root) {
  const { I18N_EN, i18nNorm } = loadDictionary(root);
  const known = new Set(Object.keys(I18N_EN).map((key) => i18nNorm(key)));

  // ⓪ 归一化撞车。i18nNorm 会压空白、吃掉排版留下的空格，于是两条本来不同的键有可能
  // 归一化到同一个字符串上 —— 索引是普通对象，后一条会**静默覆盖**前一条：查表查得到，
  // 但拿到的是另一句的翻译，且没有任何报错。这种错必须在表这一层就拦下。
  const collisions = [];
  const seenKeys = new Map();
  for (const key of Object.keys(I18N_EN)) {
    const normalized = i18nNorm(key);
    if (seenKeys.has(normalized) && seenKeys.get(normalized) !== key)
      collisions.push({ a: seenKeys.get(normalized), b: key, normalized });
    else seenKeys.set(normalized, key);
  }

  const missing = [];
  const used = new Set();

  // 先扫一遍所有源码，把结果留下来给 ①③④ 共用——扫一次就够，别扫三遍。
  const scanned = new Map();
  for (const file of JS_FILES) {
    scanned.set(file, scan(fs.readFileSync(path.join(root, file), "utf8")).literals);
  }

  // ① 代码里的 tr(...)
  for (const [file, literals] of scanned) {
    for (const lit of literals) {
      if (!lit.tr) continue;
      const key = i18nNorm(lit.text);
      if (!key) continue;
      used.add(key);
      if (!known.has(key)) missing.push({ where: file, line: lit.line, key: lit.text });
    }
  }

  // ② index.html 里的标记
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const item of htmlKeys(html)) {
    const normalized = i18nNorm(item.key);
    if (normalized.startsWith("(空") || normalized.startsWith("(缺少")) {
      missing.push({ where: "index.html", line: item.line, key: item.key });
      continue;
    }
    used.add(normalized);
    if (!known.has(normalized))
      missing.push({ where: "index.html", line: item.line, key: item.key });
  }

  // ③ 死条目：语言表里有，但代码（含未接线的字面量）和页面里都没有
  const seenAnywhere = new Set(used);
  for (const literals of scanned.values()) {
    for (const lit of literals) seenAnywhere.add(i18nNorm(lit.text));
  }
  const dead = [];
  for (const key of Object.keys(I18N_EN)) {
    if (!seenAnywhere.has(i18nNorm(key))) dead.push(key);
  }

  // ④ 带汉字、却没包进 tr() 的字面量
  const unwrapped = [];
  for (const [file, literals] of scanned) {
    for (const lit of literals) {
      if (lit.tr) continue;
      if (!NEEDS_TRANSLATION.test(lit.text)) continue;
      if (known.has(i18nNorm(lit.text))) continue;
      unwrapped.push({ where: file, line: lit.line, text: lit.text });
    }
  }

  return { collisions, missing, dead, unwrapped, keys: Object.keys(I18N_EN).length, wired: used.size };
}

/** 把报告打成给人读的样子。 */
export function formatReport(report) {
  const shown = (text) => (text.length > 90 ? `${text.slice(0, 90)}…` : text).replace(/\n/g, "⏎");
  const lines = [`语言表条目：${report.keys} / 已接线的键：${report.wired}`];
  if (report.collisions.length) {
    lines.push(`\n★ 归一化撞车 ${report.collisions.length} 组（后一条会静默覆盖前一条）：`);
    for (const item of report.collisions)
      lines.push(`   ${shown(item.a)}  ⇄  ${shown(item.b)}   →  ${shown(item.normalized)}`);
  }
  if (report.missing.length) {
    lines.push(`\n★ 漏译 ${report.missing.length} 条（英文界面下会原样显示中文）：`);
    for (const item of report.missing)
      lines.push(`   [${item.where}:${item.line}] ${shown(item.key)}`);
  } else {
    lines.push("\n漏译：无");
  }
  if (report.dead.length) {
    lines.push(`\n未被引用 ${report.dead.length} 条（可能是死条目，也可能只是间接引用）：`);
    for (const key of report.dead) lines.push(`   ${shown(key)}`);
  }
  if (report.unwrapped.length) {
    lines.push(`\n带汉字但没走 tr() 的字面量 ${report.unwrapped.length} 条：`);
    for (const item of report.unwrapped)
      lines.push(`   [${item.where}:${item.line}] ${shown(item.text)}`);
  }
  return lines.join("\n");
}

/** 有没有致命问题。漏译和撞车是硬伤；死条目与未接线只是提示。 */
export function hasFatal(report) {
  return report.missing.length > 0 || report.collisions.length > 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const report = runChecks(root);
  console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(hasFatal(report) ? 1 : 0);
}


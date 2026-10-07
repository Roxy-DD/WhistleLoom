#!/usr/bin/env node
/* 生成浏览器探针用的临时页 __browser-probe.html。
 *
 * 为什么要复制一份 index.html：脚本加载期的 SyntaxError（比如两个文件各声明了一次同名
 * 顶层 let）只会让整页白屏，控制台里一闪而过，抓不到就什么线索都没有。临时页在 <body>
 * 开头插一段 window.onerror 收集器，把所有加载期错误留下来，交给探针第一步检查。
 *
 * 这个临时页是构建产物，不要手工编辑、也不要提交；用完删掉即可。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMP_PAGE = path.join(root, "__browser-probe.html");

const CATCHER = `<script>
window.__errs = [];
addEventListener("error", (e) => window.__errs.push(String(e.message || e.error)));
addEventListener("unhandledrejection", (e) => window.__errs.push("unhandled: " + ((e.reason && e.reason.message) || e.reason)));
</script>`;

export function buildTempPage() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const spliced = html.replace(/(<body[^>]*>\s*\n?)/, (whole) => whole + CATCHER + "\n");
  if (spliced === html) throw new Error("index.html 里找不到 <body>，捕获脚本插不进去");
  fs.writeFileSync(TEMP_PAGE, spliced);
  return TEMP_PAGE;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(buildTempPage());

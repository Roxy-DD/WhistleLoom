#!/usr/bin/env bash
# 真浏览器回归：起一个本地静态服务器，用 agent-browser 在真 Chromium 里跑
# tests/browser-probe.js，把通过 / 失败逐条打出来，最后把临时页和服务器收拾干净。
#
# 为什么是一段 shell 而不是 node 脚本：node 的 child_process 在某些受限环境里起不了
# 子进程（spawnSync 直接 EBUSY），而 shell 里的 `cmd &` 没有这个问题。
#
# 用法：
#   bash scripts/browser-probe.sh
# 可选环境变量：
#   PROBE_PORT    本地服务器端口（默认 8123）
#   PROBE_PYTHON  起服务器用的 python（默认按下面的候选顺序找）
#   PROBE_NODE    node 可执行文件（默认按候选顺序找）
# 前置条件：agent-browser 在 PATH 里，且已经 `agent-browser install` 装好 Chromium。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
PORT="${PROBE_PORT:-8123}"
PAGE="__browser-probe.html"

pick_bin() {
  for candidate in "$@"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { printf '%s' "$candidate"; return 0; }
    command -v "$candidate" >/dev/null 2>&1 && { command -v "$candidate"; return 0; }
  done
  return 1
}

NODE="$(pick_bin "${PROBE_NODE:-}" node)" || {
  echo "找不到 node，可用 PROBE_NODE 指定。" >&2; exit 1; }
PYTHON="$(pick_bin "${PROBE_PYTHON:-}" python3 python)" || {
  echo "找不到 python，可用 PROBE_PYTHON 指定。" >&2; exit 1; }

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$ROOT/$PAGE"
  agent-browser close >/dev/null 2>&1
}
trap cleanup EXIT

"$NODE" scripts/make-probe-page.mjs >/dev/null || exit 1
"$PYTHON" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

URL="http://127.0.0.1:$PORT/$PAGE"
ready=""
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "$URL"; then ready=1; break; fi
  sleep 0.25
done
if [ -z "$ready" ]; then echo "本地服务器起不来：$URL" >&2; exit 1; fi

agent-browser open "$URL" >/dev/null 2>&1
sleep 3
agent-browser eval --stdin < tests/browser-probe.js > "$ROOT/.probe-output.json" 2>&1

"$NODE" -e '
const fs = require("fs");
const raw = fs.readFileSync(".probe-output.json", "utf8").trim();
fs.rmSync(".probe-output.json", { force: true });
let report = null;
try { report = JSON.parse(JSON.parse(raw)); } catch (_) {}
if (!report) {
  console.error("探针没有返回预期的报告，原始输出：\n" + raw);
  process.exit(1);
}
for (const line of report.ok) console.log("  \u2713 " + line);
for (const line of report.fail) console.log("  \u2717 " + line);
console.log("\n浏览器探针：" + report.ok.length + " 项通过，" + report.fail.length + " 项失败");
process.exit(report.fail.length ? 1 : 0);
'

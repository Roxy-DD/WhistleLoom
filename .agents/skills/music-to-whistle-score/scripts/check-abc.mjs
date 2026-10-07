#!/usr/bin/env node
/**
 * 用**编辑器自己的导入代码**校验一份 ABC（或看清一个文件会被哪条通道接走）。
 *
 * 为什么不是另写一个校验器：另写一个就等于把「ABC 怎么解析」实现两遍，两份迟早会分叉，
 * 而分叉的方向永远是「校验器说没问题、编辑器却报错」。这里直接把 js/*.js 载进一个 vm
 * 跑 —— 报出来的警告就是用户点「导入」时真正会看到的那几句。
 *
 * 用法：
 *   node scripts/check-abc.mjs tune.abc            校验一份 ABC
 *   node scripts/check-abc.mjs --json tune.abc     输出 JSON（给上游程序读）
 *   node scripts/check-abc.mjs --routing some.file 只看这个文件会被分流给哪条通道
 *   cat tune.abc | node scripts/check-abc.mjs -    从标准输入读
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEditor } from "./editor-vm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

let editor;
try {
  editor = loadEditor(REPO_ROOT);
} catch (error) {
  console.error(
    `${error.message}\n` +
      `这个脚本假定自己仍在 WhistleLoom 项目的 .agents/skills/music-to-whistle-score/scripts/ 下。`,
  );
  process.exit(2);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const round = (value) => Math.round(value * 1000) / 1000;

function beatsPerBar(meter) {
  const [top, bottom] = String(meter).split("/").map(Number);
  return top && bottom ? (top * 4) / bottom : 4;
}

// 按 barAfter 和「攒够一小节」两种方式切小节，再把每小节的总时值和拍号对一遍。
// 这是人肉校对里最容易漏的一步，正好交给机器。
function auditMeasures(score) {
  const expected = beatsPerBar(score.meter);
  const measures = [];
  let total = 0,
    notes = 0;
  for (const event of score.events) {
    total += Number(event.duration || 0);
    notes++;
    if (event.barAfter || total >= expected - 1e-6) {
      measures.push({ beats: round(total), expected, notes, complete: Math.abs(total - expected) < 1e-6 });
      total = 0;
      notes = 0;
    }
  }
  if (total > 1e-6)
    measures.push({ beats: round(total), expected, notes, complete: false, open: true });
  return measures;
}

function summarise(score, warnings) {
  const pitches = score.events.filter((e) => e.pitch != null).map((e) => e.pitch);
  const low = pitches.length ? Math.min(...pitches) : null;
  const high = pitches.length ? Math.max(...pitches) : null;
  const measures = auditMeasures(score);
  return {
    title: score.title,
    key: `${score.tonic} ${score.mode}`,
    tonic: score.tonic,
    mode: score.mode,
    meter: score.meter,
    tempo: score.tempo,
    whistleKey: score.whistleKey,
    notes: pitches.length,
    rests: score.events.length - pitches.length,
    lyrics: score.events.filter((e) => e.lyric).length,
    ties: score.events.filter((e) => e.tieToNext).length,
    slurs: score.events.filter((e) => e.slurToNext).length,
    range: low == null ? null : { low, high, lowName: noteName(low), highName: noteName(high) },
    measures,
    warnings,
  };
}

// ── --routing ───────────────────────────────────────────────────────────────
async function routing(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const byBytes = editor.formatForBytes(bytes);
  const byContent = editor.formatForContent(bytes);
  const byExtension = editor.formatForExtension(file);
  const picked = byContent || byExtension;
  return {
    file,
    bytes: bytes.length,
    byMagicBytes: byBytes ? byBytes.id : null,
    byContent: byContent ? byContent.id : null,
    byExtension: byExtension ? byExtension.id : null,
    picked: picked ? picked.id : null,
    readable: Boolean(picked && picked.import),
  };
}

// ── 校验 ABC ───────────────────────────────────────────────────────────────
function checkAbc(source, label) {
  try {
    const score = editor.parseAbc(source);
    return { ok: true, label, ...summarise(score, [...editor.warnings]) };
  } catch (error) {
    return { ok: false, label, error: String(error && error.message) };
  }
}

function renderRouting(r) {
  const line = (name, id) => `  ${name.padEnd(22)}${id || "—"}`;
  return [
    `WhistleLoom · 文件分流`,
    ``,
    `文件  ${r.file}  (${r.bytes} 字节)`,
    ``,
    line("按魔数 / 内容", r.byContent),
    line("按后缀", r.byExtension),
    line("实际采用", r.picked),
    ``,
    r.readable ? `→ 交给「${editor.SCORE_FORMATS.find((f) => f.id === r.picked).label}」导入` : `→ 认不出，编辑器会提示支持的格式`,
    ``,
  ].join("\n");
}

function render(r) {
  if (!r.ok) {
    return [`WhistleLoom · ABC 校验`, ``, `文件  ${r.label}`, ``, `✗ 编辑器会直接拒绝：`, `  ${r.error}`, ``].join("\n");
  }
  const out = [`WhistleLoom · ABC 校验（用编辑器自己的解析器跑的）`, ``, `文件  ${r.label}`];
  out.push(`曲名  ${r.title}`);
  out.push(`调号  ${r.key}   1 = ${r.tonic}`);
  out.push(`拍号  ${r.meter}`);
  out.push(`速度  ♩=${r.tempo} BPM`);
  out.push(`哨笛  ${r.whistleKey} 调`);
  out.push(
    `音符  ${r.notes} 个（休止 ${r.rests} 个，带歌词 ${r.lyrics} 个，延音线 ${r.ties} 处，连奏线 ${r.slurs} 处）`,
  );
  out.push(
    r.range
      ? `音域  MIDI ${r.range.low}–${r.range.high}（${r.range.lowName}–${r.range.highName}）`
      : `音域  —（全是休止）`,
  );
  out.push("");
  out.push(r.warnings.length ? `编辑器会提示（共 ${r.warnings.length} 条）` : `编辑器不会提示任何转换损失`);
  for (const warning of r.warnings) out.push(`  · ${warning}`);
  out.push("");
  out.push(`小节核对（每小节应 ${r.measures[0] ? r.measures[0].expected : beatsPerBar(r.meter)} 拍）`);
  const off = r.measures.filter((m) => !m.complete);
  r.measures.forEach((m, index) => {
    const tag = m.complete ? "✓" : m.open ? "… 未收尾" : "✗ 对不上";
    out.push(`  第 ${String(index + 1).padStart(2)} 小节  ${String(m.beats).padStart(5)} 拍  ${m.notes} 个音  ${tag}`);
  });
  out.push("");
  out.push(
    off.length
      ? `✗ ${off.length} 个小节和拍号对不上 —— 先查这几处，别急着导。`
      : `✓ 全部小节与拍号对齐。可以导入。`,
  );
  out.push("");
  return out.join("\n");
}

// ── 入口 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const routingAt = argv.indexOf("--routing");
// 只有真的出现了 --routing 才把紧跟其后的那个参数当成它的取值；
// 否则 routingAt + 1 会等于 0，把第一个位置参数（也就是要校验的文件）吃掉。
const routingValueAt = routingAt >= 0 ? routingAt + 1 : -1;
const positional = argv.filter((a, i) => !a.startsWith("--") && i !== routingValueAt);

if (routingAt >= 0) {
  const file = argv[routingAt + 1];
  if (!file) {
    console.error("--routing 需要跟一个文件路径");
    process.exit(2);
  }
  const result = await routing(file);
  console.log(asJson ? JSON.stringify(result, null, 2) : renderRouting(result));
  process.exit(0);
}

const target = positional[0];
if (!target) {
  console.error(
    [
      "用法：",
      "  node scripts/check-abc.mjs tune.abc          校验一份 ABC",
      "  node scripts/check-abc.mjs --json tune.abc   输出 JSON",
      "  node scripts/check-abc.mjs --routing file    看文件会被分流给哪条通道",
      "  cat tune.abc | node scripts/check-abc.mjs -  从标准输入读",
    ].join("\n"),
  );
  process.exit(2);
}

const source = target === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(target, "utf8");
const result = checkAbc(source, target === "-" ? "(标准输入)" : target);
console.log(asJson ? JSON.stringify(result, null, 2) : render(result));
process.exit(result.ok && result.measures.every((m) => m.complete) ? 0 : 1);

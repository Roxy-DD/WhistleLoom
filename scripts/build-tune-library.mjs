/* 生成内置离线曲库 js/tune-library.js。
 *
 * 为什么要有离线曲库：在线检索依赖 thesession.org 可达。用户可能在没网、被代理拦、
 * 或对方站点临时抽风的时候打开这个工具 —— 那时候「曲库」整个不能用就太可惜了。
 * 所以把该站最热门的一批曲调预先转好、随项目一起分发。
 *
 * 用法：node scripts/build-tune-library.mjs [页数]
 * 每页 10 首；默认抓 15 页 = 150 首。
 *
 * 转换逻辑不在这里重写一遍，而是把 js/ 下的真实模块载进 vm 里用 —— 内置曲库和在线
 * 检索走的是同一段代码，不会出现「线上能导入、内置的却不行」这种分叉。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PAGES = Number(process.argv[2]) || 15;
const CONCURRENCY = 5;

const read = (file) => fs.readFileSync(path.join(root, "js", file), "utf8");
const fields = { meter: "4/4", tonic: "D", mode: "major", tempo: "96", whistleKey: "D" };

function loadModules() {
  const context = vm.createContext({
    fields,
    $: (id) => ({ value: fields[id] === undefined ? "D" : fields[id] }),
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    URLSearchParams,
  });
  vm.runInContext(
    `
const pcSharp = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const pcFlat = ["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const letterIndex = { C:0,D:1,E:2,F:3,G:4,A:5,B:6 };
const naturalPc = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 };
const keyMidi = { C:60,"C#":61,Db:61,D:62,"D#":63,Eb:63,E:64,F:65,"F#":66,Gb:66,G:67,"G#":68,Ab:68,A:69,"A#":70,Bb:70,B:71 };
const whistleMidi = { D:62,C:60,Bb:58,G:55,F:53,Eb:51,A:57 };
const scaleSteps = { major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],dorian:[0,2,3,5,7,9,10],mixolydian:[0,2,4,5,7,9,10] };
let score = { title:"", events:[] };
`,
    context,
  );
  vm.runInContext(
    ["score-model.js", "score-import.js", "music.js", "abc.js", "tune-source.js"]
      .map(read)
      .join("\n") +
      "\nglobalThis.api = { parseAbc, sessionTuneToAbc, searchSessionTunes, fetchSessionTune, get warnings(){ return lastImportWarnings; } };",
    context,
  );
  return context.api;
}

// 限流并发，免得一口气打几百个请求把对方站点惹毛。
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: String(error?.message || error) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// 一次网络抖动就能让一首曲子整个丢掉（实测出现过 149/150，失败原因只有四个字
// “fetch failed”）。构建脚本会被反复重跑，每次都靠人工发现少了一首太蠢了 ——
// 隔一会儿重试两轮，比重新抓 150 首便宜得多。
async function withRetry(work, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

const api = loadModules();
const list = [];
for (let page = 1; page <= PAGES; page++) {
  const result = await api.searchSessionTunes("", { page });
  list.push(...result.tunes);
  process.stderr.write(`\r列出热门曲目 ${list.length} 首…`);
}
process.stderr.write("\n");

const wanted = list.slice(0, PAGES * 10);
const entries = await mapLimit(wanted, CONCURRENCY, async (item, index) => {
  const { tune, abc } = await withRetry(async () => {
    const fetched = await api.fetchSessionTune(item.id);
    return { tune: fetched, abc: api.sessionTuneToAbc(fetched) };
  });
  process.stderr.write(`\r转换 ${index + 1}/${wanted.length}  ${item.name}\u001b[K`);
  // 转好的 ABC 必须能被自家解析器完整读回来，否则内置库就是一颗随时会炸的哑弹。
  const parsed = api.parseAbc(abc);
  const warnings = api.warnings.filter(
    (text) => !text.includes("反复记号") && !text.includes("三连音") && !text.includes("时值"),
  );
  return {
    entry: {
      id: item.id,
      name: item.name,
      type: item.type || "",
      key: (tune?.settings?.[0]?.key) || "",
      meter: parsed.meter,
      tempo: parsed.tempo,
      notes: parsed.events.length,
      warnings,
      abc,
    },
  };
});
process.stderr.write("\n");

const ok = entries.filter((r) => r?.entry && !r.error).map((r) => r.entry);
const failed = entries.filter((r) => r?.error);
console.log(`转换成功 ${ok.length} 首，失败 ${failed.length} 首。`);
for (const f of failed.slice(0, 5)) console.log("  失败:", f.error);
const noisy = ok.filter((e) => e.warnings.length);
console.log(`其中有额外提示的 ${noisy.length} 首：`);
for (const e of noisy.slice(0, 8)) console.log(`  ${e.name}: ${e.warnings.join("；")}`);

const stamp = new Date().toISOString().slice(0, 10);
const lines = [
  "/* 本文件由 scripts/build-tune-library.mjs 自动生成，请勿手工编辑。",
  " *",
  " * 数据来自 thesession.org —— 爱尔兰传统曲调档案库，以 ODbL 1.0 授权发布",
  " * （数据转储见 github.com/adactio/TheSession-data）。ODbL 要求署名；若要把这批数据",
  " * 整理成新数据库再发布，需以同样的许可发布。本文件按该站「被收进曲集次数」从多到少",
  " * 排列，也就是站上的热门曲目顺序。",
  " *",
  ` * 抓取日期：${stamp}    曲目数：${ok.length}`,
  " * abc 字段已经是补齐了 X/T/M/L/Q/K 头的完整 ABC 文本，可直接交给 parseAbc。",
  " */",
  "const tuneLibrary = [",
];
for (const e of ok) {
  lines.push(
    "  { id: " +
      e.id +
      ", name: " +
      JSON.stringify(e.name) +
      ", type: " +
      JSON.stringify(e.type) +
      ", key: " +
      JSON.stringify(e.key) +
      ", meter: " +
      JSON.stringify(e.meter) +
      ", tempo: " +
      e.tempo +
      ", notes: " +
      e.notes +
      ", abc: " +
      JSON.stringify(e.abc) +
      " },",
  );
}
lines.push("];");
lines.push(
  "const TUNE_LIBRARY_META = " +
    JSON.stringify({
      source: "thesession.org",
      license: "ODbL 1.0",
      fetched: stamp,
      count: ok.length,
      note: "按 thesession.org 的曲集收录次数排序",
    }) +
    ";",
);
lines.push("");
fs.writeFileSync(path.join(root, "js", "tune-library.js"), lines.join("\n"), "utf8");
const size = fs.statSync(path.join(root, "js", "tune-library.js")).size;
console.log(`已写入 js/tune-library.js（${(size / 1024).toFixed(0)} KB）`);

#!/usr/bin/env node
/**
 * 校对：这个 skill 的文档里写下的具体数字和行为，和 js/ 里的代码是否还一致。
 *
 * 为什么需要它：参考文档的价值全在「具体」。写了「时值表是这 12 个值」「哨笛调是这 7 个」
 * 「曲速 20–400」，这些数字一旦和代码分叉，文档就从帮助变成了陷阱 —— 而它正是最容易被
 * 读、最少被复查的那类文本（本项目的参考文档里就出现过「K:Dd 也能识别」这种想当然的
 * 说法，实际是静默按大调处理）。所以不靠人记得，改完代码跑一遍。
 *
 * 四件事：
 *   ① 从 js/ 里取出真值（常量表、行为），不是再抄一遍
 *   ② 断言文档文本里确实写着这些值
 *   ③ 断言关键行为（拒绝 / 警告 / 字段读取 / 调式识别），因为文档描述的是行为不是数字
 *   ④ 挡住几类具体的文档腐坏（本项目真出过的、或者极易出现的）
 *
 * 用法：
 *   node scripts/check-facts.mjs           人类可读报告
 *   node scripts/check-facts.mjs --json    机器可读
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEditor } from "./editor-vm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, "..");
const DEFAULT_ROOT = path.resolve(HERE, "../../../..");

export function runChecks(repoRoot = DEFAULT_ROOT) {
  const failures = [];
  const checked = [];
  const fail = (what, detail) => failures.push(`${what}：${detail}`);
  const pass = (what) => checked.push(what);
  const ok = (what, condition, detail) => (condition ? pass(what) : fail(what, detail));

  // 文档里用来对齐的空白和 markdown 反引号都不该影响比对。
  const flat = (text) =>
    String(text)
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const doc = (name) => flat(fs.readFileSync(path.join(SKILL_DIR, name), "utf8"));

  function mustMention(text, what, values) {
    const list = [...values];
    const forms = [list.join(" "), list.join(", "), list.join("、"), list.join(" / ")];
    if (forms.some((form) => text.includes(flat(form)))) return pass(what);
    fail(what, `文档里找不到「${forms[0]}」`);
  }
  function mustContain(text, what, needle) {
    if (text.includes(flat(needle))) return pass(what);
    else fail(what, `文档里找不到「${needle}」`);
  }

  const api = loadEditor(repoRoot);
  const raw = (name) => fs.readFileSync(path.join(repoRoot, name), "utf8");
  const contract = doc("references/editor-contract.md");
  const paths = doc("references/import-paths.md");
  const abcDoc = doc("references/abc-notation.md");
  const numberedDoc = doc("references/numbered-notation.md");
  const skill = doc("SKILL.md");
  const indexHtml = flat(raw("index.html"));
  const appSource = raw("app.js");

  // ── ① 契约：枚举与范围 ───────────────────────────────────────────────────
  mustMention(contract, "契约 · 时值表 12 个值", api.SCORE_DURATION_VALUES);
  mustMention(numberedDoc, "简谱参考 · 时值表 12 个值", api.SCORE_DURATION_VALUES);
  mustMention(contract, "契约 · 主音清单", [...api.SCORE_TONICS]);
  mustMention(contract, "契约 · 哨笛调清单", [...api.SCORE_WHISTLE_KEYS]);
  mustMention(contract, "契约 · 调式清单", [...api.SCORE_MODES]);
  mustContain(contract, "契约 · 音高范围", `${api.SCORE_PITCH_MIN}–${api.SCORE_PITCH_MAX}`);
  mustContain(contract, "契约 · 曲速范围", `${api.SCORE_TEMPO_MIN}–${api.SCORE_TEMPO_MAX}`);
  mustContain(contract, "契约 · 事件上限", "≤ 10 000");
  ok(
    "契约 · 时值表确实是 12 个值",
    api.SCORE_DURATION_VALUES.length === 12,
    `实际 ${api.SCORE_DURATION_VALUES.length} 个（文档写的是 12 个）`,
  );
  ok(
    "契约 · 主音确实是 17 个",
    api.SCORE_TONICS.size === 17,
    `实际 ${api.SCORE_TONICS.size} 个（文档写的是 17 个）`,
  );
  ok(
    "契约 · 哨笛调确实是 7 个",
    api.SCORE_WHISTLE_KEYS.size === 7,
    `实际 ${api.SCORE_WHISTLE_KEYS.size} 个（文档写的是 7 个）`,
  );

  // 曲速范围曾经出过一个会丢数据的 bug（界面放到 400、契约还卡在 320：用户在框里输 400，
  // 自动存档写下 400，下次打开校验失败、整份曲谱被判成损坏存档清掉）。两边都钉住。
  mustContain(
    indexHtml,
    "index.html · 数字框的上下限与契约一致",
    `id="tempoNumber" type="number" min="${api.SCORE_TEMPO_MIN}" max="${api.SCORE_TEMPO_MAX}"`,
  );
  ok(
    "app.js · 曲速范围读自契约层（没有各写一遍）",
    appSource.includes("const TEMPO_MIN = SCORE_TEMPO_MIN") &&
      appSource.includes("const TEMPO_MAX = SCORE_TEMPO_MAX"),
    "TEMPO_MIN/TEMPO_MAX 应当读 SCORE_TEMPO_MIN/MAX",
  );

  // ── ② 契约：校验行为 ─────────────────────────────────────────────────────
  const accepts = (input) => {
    try {
      api.normalizeScoreData(input);
      return true;
    } catch (_) {
      return false;
    }
  };
  const behaviour = [
    ["曲速上界可接受", accepts({ tempo: api.SCORE_TEMPO_MAX, events: [] }), true],
    ["曲速上界 +1 被拒", accepts({ tempo: api.SCORE_TEMPO_MAX + 1, events: [] }), false],
    ["曲速下界可接受", accepts({ tempo: api.SCORE_TEMPO_MIN, events: [] }), true],
    ["音高上界可接受", accepts({ events: [{ pitch: api.SCORE_PITCH_MAX }] }), true],
    ["音高上界 +1 被拒", accepts({ events: [{ pitch: api.SCORE_PITCH_MAX + 1 }] }), false],
    ["音高下界可接受", accepts({ events: [{ pitch: api.SCORE_PITCH_MIN }] }), true],
    ["音高下界 −1 被拒", accepts({ events: [{ pitch: api.SCORE_PITCH_MIN - 1 }] }), false],
    ["网格外的时值被拒", accepts({ events: [{ pitch: 60, duration: 0.6666 }] }), false],
    ["休止符（pitch 为 null）可接受", accepts({ events: [{ pitch: null, duration: 1 }] }), true],
    ["悬空的延音线被拒", accepts({ events: [{ pitch: 60, duration: 1, tieToNext: true }] }), false],
    [
      "延音线连到同音高可接受",
      accepts({
        events: [
          { pitch: 60, duration: 1, tieToNext: true },
          { pitch: 60, duration: 1 },
        ],
      }),
      true,
    ],
    [
      "延音线连到不同音高被拒",
      accepts({
        events: [
          { pitch: 60, duration: 1, tieToNext: true },
          { pitch: 62, duration: 1 },
        ],
      }),
      false,
    ],
    ["四种调式以外的调式被拒", accepts({ mode: "phrygian", events: [] }), false],
    ["超过 10000 个音符被拒", accepts({ events: new Array(10001).fill({ pitch: 60, duration: 1 }) }), false],
  ];
  const wrong = behaviour.filter(([, got, want]) => got !== want);
  ok(
    "契约 · 校验行为（曲速/音高边界、时值网格、延音线、调式、音符数上限）",
    wrong.length === 0,
    `与文档不符：${wrong.map(([name]) => name).join("、")}`,
  );

  const meterCases = [
    ["4/4", true],
    ["6/8", true],
    ["32/32", true],
    ["1/1", true],
    ["33/4", false],
    ["3/5", false],
    ["3/64", false],
    ["0/4", false],
  ];
  const meterBad = meterCases.filter(([value, want]) => api.isSupportedMeter(value) !== want);
  ok(
    "契约 · 拍号规则（分子 1–32，分母为 2 的幂且 ≤32）",
    meterBad.length === 0,
    `不符：${meterBad.map(([v]) => v).join("、")}`,
  );

  // ── ③ 调式识别 ───────────────────────────────────────────────────────────
  const prefixes = [
    ["maj", "major"],
    ["ion", "major"],
    ["min", "minor"],
    ["aeo", "minor"],
    ["m", "minor"],
    ["dor", "dorian"],
    ["mix", "mixolydian"],
    ["phr", "phrygian"],
    ["lyd", "lydian"],
    ["loc", "locrian"],
    ["d", null],
    ["xyz", null],
  ];
  const prefixBad = prefixes.filter(([text, want]) => api.modeFromName(text) !== want);
  ok(
    "契约 · 调式前缀表与代码一致",
    prefixBad.length === 0,
    `不符：${prefixBad.map(([t]) => t).join("、")}`,
  );
  mustContain(contract, "契约 · 写出了调式前缀表", "dor | dorian");
  mustContain(contract, "契约 · 写出了四种可编辑调式之外会回落", "弗里吉亚调式暂不支持");

  // 认不出的调式缩写是**静默**变成大调 —— 文档专门警告了这一条，这里把它钉住。
  const silentMajor = (() => {
    try {
      const score = api.parseAbc("X:1\nT:t\nM:4/4\nK:Dd\nD2 E2 |");
      return { mode: score.mode, warned: [...api.warnings].some((w) => w.includes("调式")) };
    } catch (error) {
      return { error: String(error.message) };
    }
  })();
  ok(
    "ABC · 认不出的调式缩写静默按大调（文档已警告）",
    silentMajor.mode === "major" && silentMajor.warned === false,
    `实际：${JSON.stringify(silentMajor)}`,
  );

  // ── ④ 格式登记表 ─────────────────────────────────────────────────────────
  for (const id of api.SCORE_FORMATS.map((format) => format.id))
    ok(`导入路径 · 登记了 ${id}`, paths.includes(id), "格式表格里没有这一行");

  const missingExtensions = api.SCORE_FORMATS.filter((format) => format.extensions?.length).flatMap(
    (format) => format.extensions.filter((ext) => !paths.includes(ext)),
  );
  ok(
    "导入路径 · 后缀清单与登记表一致",
    missingExtensions.length === 0,
    `未列出：${missingExtensions.join(" ")}`,
  );

  const reversible = api.SCORE_FORMATS.filter((f) => f.reversible).map((f) => f.id).join(", ");
  ok(
    "导入路径 · 可无损还原的只有 json / pdf / png",
    reversible === "json, pdf, png",
    `实际是 ${reversible || "（无）"}`,
  );

  const generic = [...api.GENERIC_EXTENSIONS].join(", ");
  ok(
    "导入路径 · 通用后缀不参与分流（.txt / .xml）",
    generic === ".txt, .xml",
    `实际是 ${generic}`,
  );
  for (const ext of api.GENERIC_EXTENSIONS)
    mustContain(paths, `导入路径 · 提到了 ${ext} 不参与分流`, ext);
  ok(
    "导入路径 · 4 条魔数",
    api.BINARY_SIGNATURES.length === 4,
    `实际 ${api.BINARY_SIGNATURES.length} 条（文档写的是 4 条）`,
  );
  // 四类魔数各自出现即可，不必连成一句（文档是散文式列出的）。
  for (const magic of ["%PDF", "PNG", "PK", "MThd"])
    mustContain(paths, `导入路径 · 列出了魔数 ${magic}`, magic);

  // ── ⑤ 公共曲库 ───────────────────────────────────────────────────────────
  const meta = api.TUNE_LIBRARY_META;
  ok("曲库 · 来源是 thesession.org", meta.source === "thesession.org", `实际是 ${meta.source}`);
  mustContain(skill, "曲库 · 授权标注 ODbL 1.0", meta.license);
  mustContain(skill, "曲库 · 离线曲目数与快照一致", `${meta.count} tunes bundled offline`);

  // ── ⑥ ABC 解析器的行为 ───────────────────────────────────────────────────
  const parse = (source) => {
    try {
      return { score: api.parseAbc(source), warnings: [...api.warnings] };
    } catch (error) {
      return { error: String(error.message) };
    }
  };

  const metaProbe = parse(
    "X:1\nT:t\nK:D\n% Lyricist:词\n% Arranger:编\n% SourceTonic:C\n% Subtitle:副\n% Source:https://example.org\nD2 E2 |",
  );
  ok(
    "ABC · 只读这四个注释字段，% Source: 不参与",
    metaProbe.score &&
      metaProbe.score.lyricist === "词" &&
      metaProbe.score.arranger === "编" &&
      metaProbe.score.sourceTonic === "C" &&
      metaProbe.score.subtitle === "副" &&
      !JSON.stringify(metaProbe.score).includes("example.org"),
    `实际：${JSON.stringify(metaProbe)}`,
  );

  ok(
    "ABC · V: 多声部被直接拒绝",
    Boolean(parse("X:1\nT:t\nM:4/4\nK:D\nV:1\nD2 E2 |\nV:2\nA,2 B,2 |").error),
    "带 V: 的文件竟然被接受了",
  );
  ok(
    "ABC · 没有信息字段被直接拒绝",
    Boolean(parse("这段文字不是 ABC。\n").error),
    "没有 X:/T:/M:/L:/Q:/K:/w: 的文本竟然被接受了",
  );
  ok(
    "ABC · 和弦标记会给出警告",
    Boolean(parse('X:1\nT:t\nM:4/4\nK:D\n"Am" D2 E2 F2 G2 |\n').warnings?.some((w) => w.includes("和弦"))),
    "和弦被丢掉了却没有提示",
  );
  ok(
    "ABC · 音高超出范围会被直接拒绝（不像 MusicXML/MIDI 会移八度）",
    Boolean(parse("X:1\nT:t\nM:4/4\nK:D\nC,,,, D2 E2 F2 |").error),
    "超界的 ABC 竟然被接受了 —— 文档说这条会拒绝",
  );

  // ── ⑦ skill 自身结构 ─────────────────────────────────────────────────────
  const skillRaw = raw(".agents/skills/music-to-whistle-score/SKILL.md");
  for (const field of ["name:", "description:", "short-description:"])
    ok(`SKILL.md · frontmatter 有 ${field}`, skillRaw.includes(field), `缺少 ${field}`);

  for (const file of [
    "references/editor-contract.md",
    "references/import-paths.md",
    "references/abc-notation.md",
    "references/numbered-notation.md",
    "scripts/check-abc.mjs",
    "scripts/check-facts.mjs",
    "scripts/editor-vm.mjs",
  ])
    ok(
      `skill 文件存在 · ${file}`,
      fs.existsSync(path.join(SKILL_DIR, file)),
      "文件不见了",
    );

  // 旧版本把上游项目名（whistle-tab）当成了本项目，而且泄漏进了参考文档。
  for (const [name, text] of [
    ["SKILL.md", skill],
    ["abc-notation.md", abcDoc],
  ])
    ok(
      `${name} 没有把本项目误称为 whistle-tab project`,
      !/whistle-tab project/.test(text),
      "文档里还在叫 whistle-tab project",
    );

  // 文档里不该留着「想当然」的痕迹：曾经写过 K:Dd 也能识别，实际是静默大调。
  ok(
    "editor-contract.md 不再声称调式缩写可以随便写",
    !contract.includes("and K:Dd all work"),
    "旧的错误说法又回来了",
  );

  // 文档里的示例也要能跑。示例是 AI 最可能照抄的那一段，抄错的代价最大 ——
  // 所以不放任它漂着：解析一遍，音节数和小节数都对上才算数。
  //
  // 用 \r?\n 而不是 \n：文档在 Windows 上被编辑器改过一存就可能变成 CRLF，
  // 那时如果这里咬死 \n，报出来的是「找不到代码块」——一个完全误导人的错。
  const example = /```abc\r?\n([\s\S]*?)```/.exec(
    raw(".agents/skills/music-to-whistle-score/SKILL.md"),
  );
  if (!example) {
    fail("SKILL.md · 示例", "找不到 ```abc 代码块");
  } else {
    const probe = parse(example[1]);
    const pitches = probe.score?.events.filter((e) => e.pitch != null) || [];
    const sung = pitches.filter((e) => e.lyric).length;
    const beats = (() => {
      const [top, bottom] = String(probe.score?.meter || "4/4").split("/").map(Number);
      return (top * 4) / bottom;
    })();
    let acc = 0;
    const broken = [];
    probe.score?.events.forEach((event, index) => {
      acc += event.duration;
      if (event.barAfter || acc >= beats - 1e-6) {
        if (Math.abs(acc - beats) > 1e-6) broken.push(index + 1);
        acc = 0;
      }
    });
    if (acc > 1e-6) broken.push("末尾未收尾");
    ok(
      "SKILL.md · 示例能被解析，且每个音都有歌词、每小节都对齐",
      pitches.length > 0 && sung === pitches.length && broken.length === 0,
      `音 ${pitches.length} 个、带歌词 ${sung} 个、对不上的小节 ${broken.join("、") || "无"}` +
        (probe.error ? `（解析报错：${probe.error}）` : ""),
    );
  }

  // 文档里引用的文件必须真的在。断链的参考文档比没有参考文档更糟 ——
  // 读者会去找那条路径，然后什么也找不到，也不知道该不该信其余部分。
  const links = [...raw(".agents/skills/music-to-whistle-score/SKILL.md").matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^[a-z]+:/i.test(target));
  const brokenLinks = links.filter(
    (target) => !fs.existsSync(path.resolve(SKILL_DIR, target)),
  );
  ok(
    "SKILL.md · 引用的文件都在",
    brokenLinks.length === 0,
    `断链：${brokenLinks.join("、")}`,
  );
  ok(
    "SKILL.md · 说明了校验脚本的存在",
    skill.includes("check-abc.mjs") && skill.includes("check-facts.mjs"),
    "参考清单里没提校验脚本",
  );

  return failures;
}

// 直接运行时打印报告并给退出码；被测试 import 时只导出函数。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--root");
  const problems = runChecks(at >= 0 ? process.argv[at + 1] : DEFAULT_ROOT);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ failures: problems }, null, 2));
    process.exit(problems.length ? 1 : 0);
  }
  console.log(`WhistleLoom · skill 文档自检（对照 js/ 里的真实代码）\n`);
  if (problems.length) {
    console.log(`✗ ${problems.length} 项对不上：`);
    for (const problem of problems) console.log(`  · ${problem}`);
  } else {
    console.log(`✓ 文档里写的数字和行为都和代码一致。`);
  }
  process.exit(problems.length ? 1 : 0);
}

function abcPitch(midi) {
  let s = spellMidi(midi);
  let name = s.letter,
    acc = s.acc === "♯" ? "^" : s.acc === "♭" ? "_" : "";
  let octave = s.oct;
  if (octave < 4) {
    name = name.toUpperCase() + ",".repeat(4 - octave);
  } else if (octave > 4) {
    name = name.toLowerCase() + "'".repeat(octave - 5);
  } else name = name.toUpperCase();
  return acc + name;
}
function durationSuffix(d, base = 0.5) {
  const f = d / base;
  if (Math.abs(f - 1) < 0.001) return "";
  for (let den = 1; den <= 16; den++) {
    const num = Math.round(f * den);
    if (num > 0 && Math.abs(f - num / den) < 0.001) {
      if (num === 1 && den === 2) return "/";
      return den === 1 ? String(num) : num + "/" + den;
    }
  }
  throw new Error(tr("当前时值无法用 ABC 格式准确表达。"));
}
// 调式 → ABC 的 K: 后缀。ABC 只解析调式名的前三个字母，所以这里给出规范缩写。
const ABC_MODE_SUFFIX = {
  major: "",
  minor: "m",
  dorian: "dor",
  mixolydian: "mix",
  phrygian: "phr",
  lydian: "lyd",
  locrian: "loc",
};
function generateAbc(target = score) {
  // 优先读曲谱本身，其次是表单 —— 曲谱才是唯一真相，表单只是它的一个视图。
  const tonic = target.tonic || $("tonic").value || "C",
    mode = target.mode || $("mode").value || "major",
    meter = target.meter || $("meter").value || "4/4",
    tempo = target.tempo || Number($("tempo").value) || 96;
  let kval = tonic + (ABC_MODE_SUFFIX[mode] || "");
  // 标题为空时回落成「未命名曲谱」。翻译在这里做，不塞进 `T:` 那个模板串里：
  // 一是 T: 前缀本身不翻译，二是模板串里的 tr() 自检脚本扫不到。
  const title = target.title || tr("未命名曲谱");
  let lines = [
      `X:1`,
      `T:${title}`,
      ...(target.composer ? [`C:${target.composer}`] : []),
      ...(target.lyricist ? [`% Lyricist:${target.lyricist}`] : []),
      ...(target.arranger ? [`% Arranger:${target.arranger}`] : []),
      ...(target.sourceTonic ? [`% SourceTonic:${target.sourceTonic}`] : []),
      ...(target.subtitle ? [`% Subtitle:${target.subtitle}`] : []),
      `M:${meter}`,
      `L:1/8`,
      `Q:1/4=${tempo}`,
      `K:${kval}`,
    ],
    body = "";
  // 小节线按拍号累积时值来判断，不能写死「每 8 个音符画一条」。
  // 原本的 (i + 1) % 8 === 0 只在「全部是八分音符的 4/4 曲」上凑巧正确：
  // 换成 3/4、6/8 或混入四分音符后，线上的小节和谱面上的小节就对不上了。
  const [meterTop, meterBottom] = meter.split("/").map(Number),
    beatsPerBar = (meterTop * 4) / meterBottom;
  let barBeats = 0;
  target.events.forEach((e, i) => {
    const token =
      (e.pitch == null ? "z" : abcPitch(e.pitch)) +
      durationSuffix(e.duration, 0.5);
    body += (e.slurToNext ? "(" : "") + token + (e.tieToNext ? "-" : "") + (i > 0 && target.events[i - 1].slurToNext ? ")" : "") + " ";
    barBeats += Number(e.duration || 1);
    // e.barAfter 是用户在编辑器里手动加的小节线；没有它时按拍号补足一整小节。
    if (e.barAfter || barBeats >= beatsPerBar - 1e-6) {
      body += "| ";
      barBeats = 0;
    }
  });
  lines.push(body.trim());
  let lyric = target.events
    .map((e) => (e.pitch == null ? "*" : e.lyric || "*"))
    .join(" ");
  if (target.events.some((e) => e.lyric)) lines.push("w: " + lyric);
  return lines.join("\n");
}
// ABC 的调式写法比中文教材里那三种多得多：K:Ami、K:A minor、K:Ador、K:AMix、K:Gmaj…
// 识别规则的本体在 music.js 的 modeFromName —— MusicXML 的 <mode> 是同一件事的另一种
// 写法，共用一份表，免得两处慢慢分叉。这里只补上 ABC 的默认值：K: 没写调式就是大调。
function abcModeOf(text) {
  return modeFromName(text) || "major";
}
// 调式中文名只有一份，在 music.js 的 MODE_LABELS 里。这里留个别名，读代码的人不必
// 去猜「ABC_MODE_LABELS 和 MODE_LABELS 是不是两码事」——它们是同一个对象。
const ABC_MODE_LABELS = MODE_LABELS;
// 解析 K: 这一行，返回主音名、调式、以及「哪些音名带升降」的映射。
// 调号的计算统一交给 music.js 的 keySignatureFor，避免这里再写一套慢慢和渲染层分叉。
function parseKeySig(keyLine) {
  const text = String(keyLine || "").trim(),
    rootMatch = text.match(/^[A-Ga-g](?:[#b♯♭])?/),
    root = normalizeKeyName(rootMatch ? rootMatch[0] : "C"),
    mode = abcModeOf(text.slice(rootMatch ? rootMatch[0].length : 0));
  return { root, mode, map: keySignatureFor(root, mode).map };
}
// ABC 的时值后缀。空 = 一个单位长度；`/` = 一半；`//` = 四分之一；`///` = 八分之一；
// `3` = 三倍；`3/2` = 一倍半；`/2` = 一半（显式写法）。
// 过去只认 «整数» 和 «整数/整数» 两种，遇到 `A//`（双减时线，四分之一的单位长度）
// 会静默返回 1 —— 音符被拉长到四倍，节奏全错。
function fracSuffix(s) {
  const text = String(s ?? "").trim();
  if (!text) return 1;
  const m = text.match(/^(\d*)(\/*)(\d*)$/);
  if (!m) return 1;
  const top = m[1] ? Number(m[1]) : 1;
  if (m[2].length >= 2) return top / Math.pow(2, m[2].length);
  if (m[3]) return top / Number(m[3]);
  if (m[2].length === 1) return top / 2;
  return top;
}
// ABC 的拍号除了 4/4、6/8 这种，还有几个别名和复合拍号：
//   M:C  = 4/4（common time）、M:C| = 2/2（cut time）、M:none = 自由拍
//   M:(2+3+2)/8 = 7/8 —— 分子相加
// 返回 "" 表示「没有可用拍号」，由调用方回落到 4/4。
function parseAbcMeter(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "c") return "4/4";
  if (lower === "c|") return "2/2";
  if (lower === "none") return "";
  const slash = text.lastIndexOf("/");
  if (slash < 0) return "";
  const denominator = Number(text.slice(slash + 1)),
    numerator = (text.slice(0, slash).match(/\d+/g) || []).reduce(
      (sum, n) => sum + Number(n),
      0,
    );
  if (!Number.isInteger(denominator) || !numerator) return "";
  return `${numerator}/${denominator}`;
}
// 没有 L: 时，单位音符长度由拍号推导（ABC 2.1 §3.1.7）：把拍号化成小数，小于 0.75
// 取十六分音符，否则八分音符。例：2/4 = 0.5 → 1/16；3/4 = 0.75、4/4 = 1 → 1/8。
function defaultUnitLength(meter) {
  const [top, bottom] = String(meter || "").split("/").map(Number);
  if (!top || !bottom) return 8;
  return top / bottom < 0.75 ? 16 : 8;
}
// 时值表只到三十二分音符（0.125 拍）和倍全音符（8 拍）。ABC 里更短或更长的记法
// （例如 L:1/16 再配 `//`）在本项目里没有对应值。因为一个音符就把整份曲谱拒掉太粗暴，
// 所以就近吸附到最近的可用时值，并把改动过的地方明确报出来。
const abcSnappedDurations = new Map();
function snapDuration(value) {
  const best = nearestScoreDuration(value);
  if (Math.abs(best - value) > 1e-6)
    abcSnappedDurations.set(`${value}→${best}`, true);
  return best;
}
// 连音记号 `(p` 或 `(p:q:r`：p 个音要塞进 q 个音的时间里，作用在接下来 r 个音上。
// 省略 q 时按规范取默认：p 是三的倍数取 2，否则取 3（这正是 (3 = 三连音、
// (2 = 二连音、(4 = 四连音的通行含义）。r 省略时等于 p。
// 本项目的时值表里没有 1/3 拍，所以连音只能按比例近似 —— 但「按 2/3 缩一缩再吸附
// 到最近的可用时值」比「完全不管，三个音按原时值各拖长一半」要接近得多。
function parseTupletSpec(text) {
  const m = String(text || "").match(/^(\d+)(?::(\d+))?(?::(\d+))?/);
  if (!m) return null;
  const count = Number(m[1]);
  if (!count) return null;
  const normal = m[2] ? Number(m[2]) : count % 3 === 0 ? 2 : 3;
  const span = m[3] ? Number(m[3]) : count;
  return { ratio: normal / count, remaining: span };
}
function parseAbc(src) {
  const raw = String(src ?? "");
  // 先确认这确实是 ABC。ABC 的每个信息字段都写成「一个大写字母 + 冒号」的行首开头
  // （X: 曲号、T: 曲名、M: 拍号、L: 单位长度、Q: 速度、K: 调号、w: 歌词）。
  // 一个都没有，就说明这多半是别的格式或者随手粘的一段文字。
  //
  // 为什么必须明说：这个解析器极其宽容 —— 它会把任意文本当成音符去嚼。曾经把一整份
  // MusicXML 解出 255 个垃圾音，谱面上看着「像那么回事」，用户却拿到一份废谱。
  // 报错比静悄悄地毁掉数据好。
  if (!/^\s*(?:X|T|M|L|Q|K|w):/m.test(raw))
    throw new Error(
      tr("这段文本里找不到 ABC 的信息字段（X: T: M: L: Q: K: w: 其中之一），不像 ABC 记谱。若确实是 ABC 片段，请在开头补一行 K: 调号。"),
    );
  let title = (raw.match(/^T:\s*(.+)$/m) || [])[1] || tr("导入曲谱");
  const meterLine = (raw.match(/^M:\s*([^\s%]+)/m) || [])[1] || "";
  let meter = parseAbcMeter(meterLine);
  let tempo = Number((raw.match(/^Q:[^\n]*?=\s*(\d+)/m) || [])[1]);
  const keyLine = (raw.match(/^K:\s*(.+)$/m) || [])[1] || "C";
  const fieldText = (field) => (raw.match(new RegExp(`^${field}:\\s*(.+)$`, "m")) || [])[1] || "";
  const commentText = (field) => (raw.match(new RegExp(`^%\\s*${field}:\\s*(.+)$`, "im")) || [])[1] || "";
  const ks = parseKeySig(keyLine);
  let mode = ks.mode;
  lastImportWarnings = [];
  abcSnappedDurations.clear();
  if (/^V:/m.test(raw))
    throw new Error(tr("暂不支持带 V: 声部标记的 ABC，请先导出为单旋律版本。"));
  // 单位音符长度：有 L: 就用 L:，没有就按拍号推。缺 L: 时按规范推出来的值未必和
  // 抄谱人心里想的一样，所以明确提示一句，让用户核对。
  const unitLine = (raw.match(/^L:\s*1\/(\d+)/m) || [])[1];
  const unitBeats = 4 / (unitLine ? Number(unitLine) : defaultUnitLength(meter));
  if (!unitLine)
    lastImportWarnings.push(
      tr("此处未标 L:，已按 ABC 规范由拍号推出单位音符长度为 1/{n}，请核对节奏", {
        n: defaultUnitLength(meter),
      }),
    );
  if (!meter) {
    lastImportWarnings.push(tr("此处没有可用拍号，已按 4/4 导入"));
    meter = "4/4";
  } else if (!isSupportedMeter(meter)) {
    lastImportWarnings.push(tr("拍号 {meter} 暂不支持，已按 4/4 导入", { meter }));
    meter = "4/4";
  }
  const fittedMode = fitSupportedMode(mode);
  if (fittedMode.warning) lastImportWarnings.push(fittedMode.warning);
  mode = fittedMode.mode;
  // Q: 的另一种写法是 `Q:120`，含义是「每分钟 120 个单位音符」，要乘上单位长度换算成
  // 四分音符的 BPM。规范已不推荐这种写法，但仍能碰到。
  if (!Number.isFinite(tempo)) {
    const bare = (raw.match(/^Q:\s*(\d+)\s*$/m) || [])[1];
    tempo = bare ? Math.round(Number(bare) * unitBeats) : 96;
  }
  const rawMusic = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[A-Z]:|w:|%)/.test(line))
    .map((line) => line.split("%")[0])
    .join(" ");
  if (/"[^"]*"/.test(rawMusic)) lastImportWarnings.push(tr("和弦/文字标记不会导入"));
  // 三连音（(3abc）在本项目的时值表里没有对应值（三连音八分 = 1/3 拍），只能按原时值
  // 导入，所以这里必须说清楚，不能让用户以为节奏是对的。
  if (/\(\d/.test(rawMusic))
    lastImportWarnings.push(
      tr("三连音等连音记号已按比例近似（时值表里没有 1/3 拍），请核对节奏"),
    );
  if (/[<>]/.test(rawMusic))
    lastImportWarnings.push(tr("切分节奏记号（>、<）不会导入，请核对节奏"));
  if (/[{}]/.test(rawMusic))
    lastImportWarnings.push(tr("装饰音（倚音等）不会导入"));
  if (/\|:|:\|/.test(rawMusic))
    lastImportWarnings.push(tr("反复记号会保留为小节线，但播放不会循环反复段"));
  if (/\[[12][^\]]*\]/.test(rawMusic))
    lastImportWarnings.push(tr("第一/第二房（[1、[2）的标记不会单独保留"));
  // `!` 在 ABC 里有两种身份：单独一个 `!` 是换行（thesession.org 的曲谱就是这么存的），
  // `!trill!` 这种成对的才是装饰记号。先删掉成对的装饰记号，剩下的 `!` 当换行忽略。
  const decorated = /![A-Za-z][A-Za-z.]*!/.test(rawMusic);
  if (decorated) lastImportWarnings.push(tr("装饰记号（如 !trill!）不会导入"));
  let music = rawMusic
    .replace(/![A-Za-z][A-Za-z.]*!/g, "")
    .replace(/"[^"]*"/g, "")
    // 装饰音 {a}、{gB} 要整段删掉，否则花括号里的字母会被当成真音符收进谱子里。
    .replace(/\{[^}]*\}/g, "")
    .replace(/\[(?![12])[^\]]*\]/g, "");
  let events = [],
    accs = {},
    m;
  const re =
    /([()-])|(\|:|:\||\|\]|\|)|([=_^]{1,2})?([A-Ga-gz])([,']*)(\d*(?:\/{1,3}\d*)?)/g;
  const slurStarts = [];
  let tuplet = null;
  const takeTupletRatio = () => {
    if (!tuplet) return 1;
    const ratio = tuplet.ratio;
    if (--tuplet.remaining <= 0) tuplet = null;
    return ratio;
  };
  while ((m = re.exec(music))) {
    if (m[1]) {
      // `(` 后面紧跟数字是连音记号，否则是连奏线的起点。
      const tupletText = music.slice(re.lastIndex).match(/^\d+(?::\d+){0,2}/);
      if (m[1] === "(" && tupletText) {
        tuplet = parseTupletSpec(tupletText[0]);
        re.lastIndex += tupletText[0].length;
      } else if (m[1] === "(" && !/\d/.test(music.slice(re.lastIndex, re.lastIndex + 1)))
        slurStarts.push(events.length);
      else if (m[1] === ")" && slurStarts.length) {
        const start = slurStarts.pop();
        for (let i = start; i < events.length - 1; i++) events[i].slurToNext = true;
      } else if (m[1] === "-" && events.length) events[events.length - 1].tieToNext = true;
      continue;
    }
    if (m[2]) {
      if (events.length) events[events.length - 1].barAfter = true;
      accs = {};
      tuplet = null;
      continue;
    }
    let acc = m[3] || "",
      ch = m[4],
      octmark = m[5],
      dur = m[6] || "";
    if (ch.toLowerCase() === "z") {
      events.push({
        pitch: null,
        duration: snapDuration(unitBeats * fracSuffix(dur) * takeTupletRatio()),
      });
      continue;
    }
    let upper = ch.toUpperCase(),
      oct = ch === ch.toLowerCase() ? 5 : 4;
    for (const c of octmark) {
      if (c === ",") oct--;
      else if (c === "'") oct++;
    }
    let alter =
      acc === "^"
        ? 1
        : acc === "^^"
          ? 2
          : acc === "_"
            ? -1
            : acc === "__"
              ? -2
              : acc === "="
                ? 0
                : (accs[upper] ?? ks.map[upper] ?? 0);
    if (acc) accs[upper] = acc === "=" ? 0 : alter;
    let pitch = (oct + 1) * 12 + naturalPc[upper] + alter,
      duration = snapDuration(unitBeats * fracSuffix(dur) * takeTupletRatio());
    events.push({ pitch, duration });
  }
  if (abcSnappedDurations.size)
    lastImportWarnings.push(
      tr("部分时值超出可表示范围，已就近调整：{list}", {
        list: [...abcSnappedDurations.keys()].slice(0, 4).join("、"),
      }),
    );
  // 解析完先收尾延音线，再交给契约层校验 —— 契约层只负责「数据本身是否自洽」，
  // 外来 ABC 里不合规的 `-` 属于「怎么把它翻译成本项目能表达的东西」，在这一层解决。
  sanitizeTies(events, lastImportWarnings);
  let lyricLine = (raw.match(/^w:\s*(.*)$/m) || [])[1];
  if (lyricLine) {
    let words = lyricLine.trim().split(/\s+/),
      j = 0;
    events.forEach((e) => {
      if (e.pitch == null) return;
      let w = words[j++];
      if (w && w !== "*" && w !== "_") e.lyric = w.replace(/-$/, "");
    });
  }
  score = normalizeScoreData({
    schemaVersion: 1,
    title,
    composer: fieldText("C"),
    lyricist: commentText("Lyricist"),
    arranger: commentText("Arranger"),
    sourceTonic: commentText("SourceTonic"),
    subtitle: commentText("Subtitle"),
    tonic: ks.root,
    mode,
    meter,
    whistleKey: $("whistleKey").value,
    tempo: Number(tempo),
    originalTempo: Number(tempo),
    events,
  });
  return score;
}
function importJson(obj) {
  score = normalizeScoreData(obj);
  return score;
}
function download(name, text, type) {
  const a = document.createElement("a"),
    u = URL.createObjectURL(new Blob([text], { type }));
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

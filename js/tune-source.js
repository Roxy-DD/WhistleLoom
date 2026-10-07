/* 公共曲库接入：thesession.org（爱尔兰传统曲调，五万多首，全部是 ABC 文本）。
 *
 * 为什么选它：本项目已经有完整的 ABC 解析器（js/abc.js），而 thesession.org 的开放
 * 接口返回的正好就是 ABC 谱例正文。接口允许跨站请求（Access-Control-Allow-Origin: *），
 * 所以静态页面可以直接在浏览器里查，不需要任何后端。
 *
 * 授权：曲库数据以 ODbL 1.0 发布（见 github.com/adactio/TheSession-data）。ODbL 要求
 * 署名，并且如果把这些数据整理成新的数据库再发布，需要以同样的许可发布。本项目只在
 * 用户主动检索时取单首曲子、并在曲谱署名里标明来源，属于「使用」而不是「再发布数据库」。
 * 如需大规模转载，请先阅读 ODbL 原文。
 */
const SESSION_API_BASE = "https://thesession.org";
const SESSION_TIMEOUT_MS = 12000;
const SESSION_SOURCE_LABEL = "thesession.org 曲库";

// 曲种 → 该曲种惯用的拍号与速度（速度按「每分钟多少个四分音符」算，和编辑器的口径一致）。
// 6/8、9/8、12/8 这些复合拍子把一小节感受成两到四个附点四分音符，所以四分音符速度看上去
// 有 180 那么多 —— 换算成附点四分音符正好 120 左右，也就是吉格舞曲常见的中速。
const TUNE_TYPE_PRESETS = {
  reel: { meter: "4/4", tempo: 90 },
  hornpipe: { meter: "4/4", tempo: 80 },
  barndance: { meter: "4/4", tempo: 88 },
  strathspey: { meter: "4/4", tempo: 80 },
  march: { meter: "4/4", tempo: 84 },
  jig: { meter: "6/8", tempo: 180 },
  "slip jig": { meter: "9/8", tempo: 180 },
  slide: { meter: "12/8", tempo: 180 },
  waltz: { meter: "3/4", tempo: 132 },
  mazurka: { meter: "3/4", tempo: 132 },
  polka: { meter: "2/4", tempo: 132 },
  "three-two": { meter: "3/2", tempo: 80 },
  air: { meter: "4/4", tempo: 66 },
  default: { meter: "4/4", tempo: 90 },
};
function tuneTypePreset(type) {
  return TUNE_TYPE_PRESETS[String(type || "").toLowerCase()] || TUNE_TYPE_PRESETS.default;
}
// 曲种的英文原词和中文名。爱尔兰传统音乐里这些词是行话（reel / jig / hornpipe），
// 直接翻译成中文会丢失它们指代的具体舞步和节奏型，所以两个都给。
// 这一份清单同时供「筛选下拉框」和「副标题」使用 —— 界面上的选项不必再手抄一遍。
const TUNE_TYPE_LABELS = {
  reel: "里尔舞曲",
  jig: "吉格舞曲",
  hornpipe: "号管舞曲",
  polka: "波尔卡",
  "slip jig": "滑步吉格",
  slide: "滑步舞曲",
  waltz: "华尔兹",
  mazurka: "玛祖卡",
  march: "进行曲",
  air: "抒情曲",
  strathspey: "斯特拉斯佩舞曲",
  barndance: "谷仓舞曲",
  "three-two": "三拍二舞曲",
  "set dance": "组舞曲",
};
// 筛选下拉用的清单。只收在 thesession.org 上确实成规模的曲种（接口的 type 参数取值）。
const TUNE_TYPE_FILTERS = [
  "reel",
  "jig",
  "hornpipe",
  "polka",
  "slip jig",
  "slide",
  "waltz",
  "march",
  "air",
  "strathspey",
  "barndance",
  "mazurka",
  "three-two",
  "set dance",
].map((value) => ({ value, label: `${TUNE_TYPE_LABELS[value]} ${value}` }));
function tuneTypeLabel(type) {
  const text = String(type || "").trim();
  if (!text) return tr("传统曲调");
  const zh = TUNE_TYPE_LABELS[text.toLowerCase()];
  if (!zh) return text;
  const localized = tr(zh);
  // 中文界面里两个都给（「里尔舞曲 reel」）；英文界面里 tr 已经把中文名换成了英文原词，
  // 再拼一次就成了「reel reel」，所以两者相同的时候只留一个。
  return localized.toLowerCase() === text.toLowerCase() ? text : `${localized} ${text}`;
}
// 拍号 → 一小节有几拍（以四分音符为单位）。6/8 就是 6 × 4/8 = 3 个四分音符。
function meterBeats(meter) {
  const [top, bottom] = String(meter || "4/4").split("/").map(Number);
  return top && bottom ? (top * 4) / bottom : 4;
}
// 复合拍子（6/8、9/8、12/8）的分子是三的倍数且大于 3；3/8 不是复合拍子。
function isCompoundMeter(meter) {
  const [top, bottom] = String(meter || "").split("/").map(Number);
  return bottom === 8 && top % 3 === 0 && top > 3;
}
// 从谱例正文反推拍号。thesession.org 的谱例不带 M: 头，只有音符和 `|`；所以先按小节线
// 把正文切开、量出各小节的拍数，取中位数（这样弱起的第一小节不会把结果带偏），再挑最
// 接近的拍号。拍号选错的后果不是「显示得不好看」，而是折行时会把完整的小节切碎，
// 所以这一步值得做准。
function sessionMeterFromBody(body, fallback = "4/4") {
  const text = String(body || "").replace(/![A-Za-z][A-Za-z.]*!/g, "");
  const measures = text
    .split(/\|:?|:\||\|\]|\|\||\|/)
    .map((part) => part.trim())
    .filter(Boolean);
  const lengths = [];
  for (const measure of measures) {
    const cleaned = measure
      .replace(/"[^"]*"/g, "")
      .replace(/\{[^}]*\}/g, "")
      .replace(/![^!]*!/g, "");
    const re = /([()-])|([=_^]{1,2})?([A-Ga-gz])([,']*)(\d*(?:\/{1,3}\d*)?)/g;
    let beats = 0,
      sawNote = false,
      tuplet = null,
      m;
    const takeRatio = () => {
      if (!tuplet) return 1;
      const ratio = tuplet.ratio;
      if (--tuplet.remaining <= 0) tuplet = null;
      return ratio;
    };
    while ((m = re.exec(cleaned))) {
      if (m[1]) {
        const spec = cleaned.slice(re.lastIndex).match(/^\d+(?::\d+){0,2}/);
        if (m[1] === "(" && spec) {
          tuplet = parseTupletSpec(spec[0]);
          re.lastIndex += spec[0].length;
        }
        continue;
      }
      // L:1/8 是 thesession.org 一贯的单位长度，也就是每个字母 = 0.5 个四分音符。
      beats += 0.5 * fracSuffix(m[5]) * takeRatio();
      sawNote = true;
    }
    if (sawNote && beats > 0) lengths.push(beats);
  }
  if (!lengths.length) return fallback;
  lengths.sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  // 在「同一种拍感」的候选里挑最接近的：复合拍子（6/8、9/8、12/8）和单拍子（4/4、3/4…）
  // 即使总拍数相同，听起来也完全不是一回事，所以不能混在一起比。
  const compound = isCompoundMeter(fallback);
  const candidates = ["4/4", "3/4", "2/4", "2/2", "5/4", "3/8", "5/8", "7/8", "6/8", "9/8", "12/8"].filter(
    (meter) => (meter.endsWith("/8") && Number(meter.split("/")[0]) % 3 === 0) === compound,
  );
  let best = fallback,
    bestGap = Infinity;
  for (const meter of candidates) {
    const gap = Math.abs(meterBeats(meter) - median);
    if (gap < bestGap - 1e-9) {
      best = meter;
      bestGap = gap;
    }
  }
  // 中位数和一整小节差得太远，说明谱例本身就不规整（散板、自由节奏），这时相信曲种判断。
  return bestGap <= 0.5 ? best : fallback;
}
// 把一首曲调（thesession.org 的 JSON）转成可以直接喂给 parseAbc 的完整 ABC 文本。
// R: 用英文原词（ABC 是交换格式，别的软件读得懂 reel）；副标题用中文 + 出处。
// 副标题会印在谱面上，ODbL 要求的署名就落在这里。
function sessionTuneToAbc(tune, settingIndex = 0) {
  const setting = (tune?.settings || [])[settingIndex];
  if (!setting?.abc) throw new Error(tr("这首曲子在曲库里没有可用的谱例。"));
  const type = String(tune.type || "").toLowerCase();
  const preset = tuneTypePreset(type);
  const keyMatch = String(setting.key || "G").trim().match(/^([A-Ga-g](?:[#b])?)(.*)$/);
  const root = normalizeKeyName(keyMatch ? keyMatch[1] : "G");
  const mode = abcModeOf(keyMatch ? keyMatch[2] : "");
  const meter = sessionMeterFromBody(setting.abc, preset.meter);
  // 标题与出处署名都带中文，先在这里翻好再拼进模板串：模板串 `…${…}` 里的 tr() 自检
  // 脚本扫不到，而且空标题回落成什么本来就该在这一层算清。ODbL 要求的署名就落在出处这句。
  const title = tune.name || tr("未命名曲谱");
  const credit = tr("曲目来自 {source}（ODbL 1.0）", {
    source: tr(SESSION_SOURCE_LABEL),
  });
  return [
    "X:1",
    `T:${title}`,
    ...(tune.type ? [`R:${tune.type}`] : []),
    `M:${meter}`,
    "L:1/8",
    `Q:1/4=${preset.tempo}`,
    `K:${root}${ABC_MODE_SUFFIX[mode] || ""}`,
    `% Source:${SESSION_API_BASE}/tunes/${tune.id} ${credit}`,
    `% Subtitle:${tuneTypeLabel(tune.type)} · ${credit}`,
    String(setting.abc).trim(),
  ].join("\n");
}
function sessionNetworkMessage(error) {
  if (error?.name === "AbortError") return tr("曲库请求超时。请检查网络，或改用内置曲库。");
  if (error instanceof TypeError) return tr("连不上 thesession.org。请检查网络或代理，或改用内置曲库。");
  return error?.message || tr("曲库请求失败。");
}
async function sessionFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(SESSION_API_BASE + path, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(tr("曲库返回了 {status}，请稍后重试。", { status: response.status }));
    return await response.json();
  } catch (error) {
    throw new Error(sessionNetworkMessage(error));
  } finally {
    clearTimeout(timer);
  }
}
// 在线检索。q 留空时 thesession.org 按「被收进曲集次数」从多到少返回，正好就是热度排序，
// 拿来当「热门曲目」看很合适。
async function searchSessionTunes(query, options = {}) {
  const params = new URLSearchParams({ format: "json", page: String(options.page || 1) });
  if (query) params.set("q", query);
  if (options.type) params.set("type", options.type);
  const data = await sessionFetch(`/tunes/search?${params.toString()}`);
  return {
    total: Number(data.total) || 0,
    pages: Number(data.pages) || 1,
    page: Number(data.page) || 1,
    tunes: (data.tunes || []).map((entry) => ({
      id: entry.id,
      name: entry.name || tr("未命名曲调"),
      alias: entry.alias || "",
      type: entry.type || "",
      url: `${SESSION_API_BASE}/tunes/${entry.id}`,
    })),
  };
}
async function fetchSessionTune(id) {
  return sessionFetch(`/tunes/${encodeURIComponent(id)}?format=json`);
}
// ── 离线兜底 ────────────────────────────────────────────────────────────────
// js/tune-library.js 是打包时生成的热门曲目快照。没网、被代理拦、或对方站点抽风的时候，
// 曲库不该整个变成一个点了没反应的按钮。
function libraryTunes() {
  // tune-library.js 理论上一定在，但少一个数据文件就让整个面板报 ReferenceError 太脆了。
  return typeof tuneLibrary === "undefined" ? [] : tuneLibrary;
}
// 离线曲库的本地筛选。检索口径和线上保持一致：搜曲名和调名。
function searchLibraryTunes(query, options = {}) {
  const needle = String(query || "").trim().toLowerCase();
  const type = String(options.type || "").toLowerCase();
  return libraryTunes().filter((entry) => {
    if (type && String(entry.type || "").toLowerCase() !== type) return false;
    if (!needle) return true;
    return (
      String(entry.name || "").toLowerCase().includes(needle) ||
      String(entry.key || "").toLowerCase().includes(needle)
    );
  });
}
const TUNE_LIBRARY_PAGE_SIZE = 30;
// 把本地匹配结果整理成和线上检索一样的形状，界面就只需要认一种数据结构。
function librarySearchResult(query, type, page) {
  const matches = searchLibraryTunes(query, { type });
  const pages = Math.max(1, Math.ceil(matches.length / TUNE_LIBRARY_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    source: "offline",
    total: matches.length,
    page: current,
    pages,
    tunes: matches
      .slice((current - 1) * TUNE_LIBRARY_PAGE_SIZE, current * TUNE_LIBRARY_PAGE_SIZE)
      .map((entry) => ({ ...entry, kind: "offline" })),
  };
}
// 曲库检索入口：先走 thesession.org，连不上就退回内置离线曲库，并把「为什么退回」带回去，
// 好让界面如实告诉用户，而不是默默给一份看起来一样的结果。
// options.offline 为真时直接走离线（首次展开面板用，不发任何请求）。
// 返回形状统一为 { source, total, page, pages, tunes[] }；tunes[] 每项带 kind 说明来源。
async function searchTunes(options = {}) {
  const query = String(options.query || "").trim();
  const type = options.type || "";
  const page = Math.max(1, Number(options.page) || 1);
  if (options.offline) return librarySearchResult(query, type, page);
  try {
    const online = await searchSessionTunes(query, { page, type });
    return {
      source: "online",
      total: online.total,
      page: online.page,
      pages: online.pages,
      tunes: online.tunes.map((tune) => ({ ...tune, kind: "online" })),
    };
  } catch (error) {
    return {
      ...librarySearchResult(query, type, page),
      reason: error?.message || tr("连不上曲库"),
    };
  }
}
// 载入一首曲调，返回可以直接交给 parseAbc 的完整 ABC 文本。
// 在线结果要去取单曲 JSON，离线结果自带 ABC —— 两条路最后都汇到同一段 ABC 上。
async function loadTune(tune) {
  if (tune?.abc) return tune.abc;
  return sessionTuneToAbc(await fetchSessionTune(tune.id));
}

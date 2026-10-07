/* MusicXML 编解码：把记谱软件（MuseScore、Sibelius、Finale、Dorico…）导出的乐谱
 * 读进本工具，也能把本工具的曲谱导出成它们能打开的文件。
 *
 * 为什么要这个格式：现代流行歌曲没有免费开放的曲库可接（版权），但**转换格式是开放的**。
 * MusicXML 是 W3C 社区规范、完全公开、270 多个记谱软件支持它。用户拿免费的 MuseScore
 * 打开任意一首歌（或自己扒谱、买谱），导出 MusicXML，拖进本工具就能变成简谱 + 指法图。
 * 这条路不碰版权红线，而且一次做好，之后任何来源的谱子都能进。
 *
 * 为什么自己写 XML 解析：浏览器有 DOMParser，Node（测试环境）没有。为了让「浏览器里跑的
 * 那份代码」和「测试里跑的那份」是同一份，这里实现一个够用的小解析器 —— MusicXML 是
 * 规规矩矩的 XML，只需要元素、属性、文本、自闭合标签和五个预定义实体。
 *
 * 为什么自己写 zip 读取：.mxl 就是个 zip。用 DecompressionStream('deflate-raw') 解压
 * 是浏览器和 Node 都有的标准能力，不必引入任何依赖。
 */

// ── 极简 XML 解析 ───────────────────────────────────────────────────────────
const XML_ENTITY_RE = /&(?:#([0-9]+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
function decodeXmlEntities(text) {
  return String(text).replace(XML_ENTITY_RE, (whole, dec, hex, named) => {
    if (dec || hex) {
      const code = parseInt(dec || hex, dec ? 10 : 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named] || whole;
  });
}
const XML_ATTR_RE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const XML_TAG_RE =
  /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
// 解析成 { name, attrs, children } 的树。文本节点用 name: "#text"。
function parseXml(text) {
  const src = String(text)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  let cursor = 0,
    m;
  XML_TAG_RE.lastIndex = 0;
  while ((m = XML_TAG_RE.exec(src))) {
    const between = src.slice(cursor, m.index);
    if (between.trim())
      stack[stack.length - 1].children.push({
        name: "#text",
        text: decodeXmlEntities(between),
      });
    cursor = XML_TAG_RE.lastIndex;
    if (m[1] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { name: m[2], attrs: {}, children: [] };
    XML_ATTR_RE.lastIndex = 0;
    let a;
    while ((a = XML_ATTR_RE.exec(m[3] || "")))
      node.attrs[a[1]] = decodeXmlEntities(a[2] ?? a[3] ?? "");
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
function xmlChildren(node, name) {
  return node ? node.children.filter((child) => child.name === name) : [];
}
function xmlChild(node, name) {
  return node ? node.children.find((child) => child.name === name) : undefined;
}
function xmlText(node) {
  return node
    ? node.children
        .filter((child) => child.name === "#text")
        .map((child) => child.text)
        .join("")
        .trim()
    : "";
}
function xmlNumber(node) {
  const text = xmlText(node);
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
function xmlFindAll(node, name, out = []) {
  if (!node || !node.children) return out;
  for (const child of node.children) {
    if (child.name === name) out.push(child);
    // 文本节点没有 children，不能往里递归。
    if (child.children) xmlFindAll(child, name, out);
  }
  return out;
}

// ── .mxl（zip）读取 ─────────────────────────────────────────────────────────
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
function zipU16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}
function zipU32(bytes, at) {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}
// 压缩包末尾的「中央目录结束记录」。从后往前找，因为后面可能跟着注释。
function findZipEnd(bytes) {
  const limit = Math.max(0, bytes.length - 66000);
  for (let at = bytes.length - 22; at >= limit; at--)
    if (zipU32(bytes, at) === ZIP_EOCD) return at;
  return -1;
}
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function")
    throw new Error(
      tr("当前浏览器不支持解压 .mxl 文件，请在记谱软件里改存为未压缩的 .musicxml。"),
    );
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// 走中央目录而不是本地文件头：本地头里的压缩长度可能是 0（写流式 zip 时的惯例），
// 长度只可靠地记在中央目录里。
async function unzip(bytes) {
  const end = findZipEnd(bytes);
  if (end < 0) throw new Error(tr("这个 .mxl 文件不是有效的压缩包。"));
  const count = zipU16(bytes, end + 10);
  const decoder = new TextDecoder("utf-8");
  const entries = new Map();
  let at = zipU32(bytes, end + 16);
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || zipU32(bytes, at) !== ZIP_CENTRAL) break;
    const method = zipU16(bytes, at + 10);
    const compressedSize = zipU32(bytes, at + 20);
    const nameLength = zipU16(bytes, at + 28);
    const extraLength = zipU16(bytes, at + 30);
    const commentLength = zipU16(bytes, at + 32);
    const localAt = zipU32(bytes, at + 42);
    const name = decoder.decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    const dataAt =
      localAt + 30 + zipU16(bytes, localAt + 26) + zipU16(bytes, localAt + 28);
    entries.set(name, {
      method,
      raw: bytes.subarray(dataAt, dataAt + compressedSize),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    read: async (name) => {
      const entry = entries.get(name);
      if (!entry) return null;
      return entry.method === 0 ? entry.raw : await inflateRaw(entry.raw);
    },
  };
}
// .mxl 里必有 META-INF/container.xml，它指出真正的谱文件在哪。没有就退回「第一个 xml」。
async function extractMxl(bytes) {
  const zip = await unzip(bytes),
    decoder = new TextDecoder("utf-8");
  const containerName = zip.names.find(
    (name) => name.toLowerCase() === "meta-inf/container.xml",
  );
  if (containerName) {
    const container = decoder.decode(await zip.read(containerName));
    const rootfile = xmlFindAll(parseXml(container), "rootfile")[0];
    const fullPath = rootfile?.attrs["full-path"];
    if (fullPath && zip.names.includes(fullPath)) {
      const data = await zip.read(fullPath);
      if (data) return { name: fullPath, bytes: data };
    }
  }
  const fallback = zip.names.find((name) => /\.xml$/i.test(name));
  if (!fallback)
    throw new Error(tr("这个 .mxl 压缩包里没有找到 MusicXML 文件。"));
  return { name: fallback, bytes: await zip.read(fallback) };
}
// 文本解码：MusicXML 多数是 UTF-8，也可能是带 BOM 的 UTF-16（老软件爱这么存）。
function looksLikeMusicXml(text) {
  return /<score-(?:partwise|timewise)[\s>]/.test(String(text || "").slice(0, 4000));
}

// ── MusicXML → 曲谱 ─────────────────────────────────────────────────────────
// 装饰音（倚音）在 MusicXML 里是 <grace/>，它不占时值。本项目的时值表里没有「零拍音」，
// 只能略去，但要告诉用户少了几个音。
function collectPartNotes(partNode) {
  const notes = [];
  let divisions = 1,
    meter = "",
    fifths = null,
    modeName = "",
    graceCount = 0;
  xmlChildren(partNode, "measure").forEach((measure, measureIndex) => {
    let cursor = 0,
      lastStart = 0;
    for (const node of measure.children) {
      if (node.name === "attributes") {
        const value = xmlNumber(xmlChild(node, "divisions"));
        if (value) divisions = value;
        const time = xmlChild(node, "time");
        if (time) {
          const beats = xmlNumber(xmlChild(time, "beats"));
          const beatType = xmlNumber(xmlChild(time, "beat-type"));
          if (beats && beatType) meter = `${beats}/${beatType}`;
        }
        const key = xmlChild(node, "key");
        if (key) {
          const value2 = xmlNumber(xmlChild(key, "fifths"));
          if (value2 != null) fifths = value2;
          const mode = xmlText(xmlChild(key, "mode"));
          if (mode) modeName = mode;
        }
        continue;
      }
      if (node.name === "backup") {
        cursor -= (xmlNumber(xmlChild(node, "duration")) || 0) / divisions;
        continue;
      }
      if (node.name === "forward") {
        cursor += (xmlNumber(xmlChild(node, "duration")) || 0) / divisions;
        continue;
      }
      if (node.name !== "note") continue;

      const isChord = Boolean(xmlChild(node, "chord"));
      const isGrace = Boolean(xmlChild(node, "grace"));
      const durationDivisions = xmlNumber(xmlChild(node, "duration"));
      const beats = durationDivisions == null ? 0 : durationDivisions / divisions;
      const start = isChord ? lastStart : cursor;
      // 和弦音（<chord/>）与前一音同时发声，不推进光标。
      if (!isChord) {
        lastStart = cursor;
        cursor += beats;
      }
      if (isGrace) {
        graceCount++;
        continue;
      }

      const rest = Boolean(xmlChild(node, "rest"));
      const pitchNode = xmlChild(node, "pitch");
      let pitch = null;
      if (pitchNode && !rest) {
        const step = xmlText(xmlChild(pitchNode, "step"));
        const octave = xmlNumber(xmlChild(pitchNode, "octave"));
        if (naturalPc[step] == null || octave == null) continue;
        const alter = xmlNumber(xmlChild(pitchNode, "alter")) || 0;
        pitch = (octave + 1) * 12 + naturalPc[step] + alter;
      } else if (!rest) {
        continue;
      }

      const notations = xmlChild(node, "notations");
      const tieTypes = [
        ...xmlChildren(node, "tie"),
        ...xmlChildren(notations, "tied"),
      ].map((tie) => tie.attrs.type);
      const firstLyric = xmlChildren(node, "lyric")[0];
      notes.push({
        voice: xmlText(xmlChild(node, "voice")) || "1",
        start,
        beats,
        pitch,
        measureIndex,
        tieStart: tieTypes.includes("start"),
        slurStart: xmlChildren(notations, "slur").some(
          (slur) => slur.attrs.type === "start",
        ),
        lyric: firstLyric ? xmlText(xmlChild(firstLyric, "text")) : "",
      });
    }
  });
  return { notes, meter, fifths, modeName, graceCount };
}
// 把一段 MusicXML 读成曲谱。传字符串或字节都行。
function musicXmlToScore(source) {
  const text = typeof source === "string" ? source : decodeTextBytes(source);
  const root = parseXml(text);
  const node =
    xmlFindAll(root, "score-partwise")[0] ||
    xmlFindAll(root, "score-timewise")[0];
  if (!node)
    throw new Error(
      tr("这看起来不是 MusicXML 文件：没有找到 <score-partwise> 根元素。"),
    );
  if (node.name === "score-timewise")
    throw new Error(
      tr("暂不支持 <score-timewise> 结构的 MusicXML（很少见），请在记谱软件里改存 partwise 版本。"),
    );

  const warnings = [];
  const parts = xmlChildren(node, "part");
  if (!parts.length) throw new Error(tr("这份 MusicXML 里没有声部数据。"));
  const partNames = new Map();
  for (const scorePart of xmlFindAll(
    xmlChild(node, "part-list"),
    "score-part",
  ))
    partNames.set(scorePart.attrs.id, xmlText(xmlChild(scorePart, "part-name")));
  if (parts.length > 1) {
    const name = partNames.get(parts[0].attrs.id);
    warnings.push(
      tr("文件里有 {parts} 个声部，已导入第 1 个{name}", {
        parts: parts.length,
        name: name ? tr("（{name}）", { name }) : "",
      }),
    );
  }

  const collected = collectPartNotes(parts[0]);
  if (collected.graceCount)
    warnings.push(
      tr("已略去 {n} 个装饰音（倚音不占时值，本编辑器无法表示）", {
        n: collected.graceCount,
      }),
    );

  // 一个声部里可能有几条声部线（<voice>），常见于钢琴谱：右手一条、左手一条。
  // 本工具画的是单旋律，取音符最多的那条 —— 旋律线总是音符最密的。
  const byVoice = new Map();
  for (const note of collected.notes) {
    if (!byVoice.has(note.voice)) byVoice.set(note.voice, []);
    byVoice.get(note.voice).push(note);
  }
  const ranked = [...byVoice.entries()]
    .map(([voice, list]) => ({
      voice,
      list,
      pitched: list.filter((note) => note.pitch != null).length,
    }))
    .sort((a, b) => b.pitched - a.pitched || a.voice.localeCompare(b.voice));
  if (!ranked.length || !ranked[0].pitched)
    throw new Error(tr("这份 MusicXML 里没有找到音符。"));
  if (ranked.length > 1)
    warnings.push(
      tr("这个声部里有 {n} 条声部线，已取音符最多的第 {voice} 条", {
        n: ranked.length,
        voice: ranked[0].voice,
      }),
    );

  const chosen = ranked[0].list
    .slice()
    // 排序的主键必须先是「第几小节」，然后才是小节内的位置。因为每一小节的光标都从 0
    // 重新数起，只按 start 排会把不同小节的音混到一起 —— 第二小节第一拍会和第一小节
    // 第一拍并列，接着被当成和弦丢掉。
    .sort(
      (a, b) =>
        a.measureIndex - b.measureIndex ||
        a.start - b.start ||
        (b.pitch ?? -1) - (a.pitch ?? -1),
    );
  // 同一时刻发多个音 = 和弦。本工具画的是单旋律，取最高的那个 —— 旋律通常在最上面。
  // 上面按「音高降序」排过，所以每个时刻上第一个就是最高的。
  const melody = [];
  let chordDropped = 0;
  for (const note of chosen) {
    const last = melody[melody.length - 1];
    if (
      last &&
      last.measureIndex === note.measureIndex &&
      Math.abs(last.start - note.start) < 1e-6
    ) {
      chordDropped++;
      continue;
    }
    melody.push(note);
  }
  if (chordDropped)
    warnings.push(
      tr("有 {n} 个音是与其他音同时发声的和弦音，已按「同时发声时取最高音」处理成单旋律", {
        n: chordDropped,
      }),
    );

  const events = melody.map((note, index) => {
    const next = melody[index + 1];
    const event = { pitch: note.pitch, duration: note.beats || 1 };
    if (note.lyric) event.lyric = note.lyric;
    if (note.tieStart) event.tieToNext = true;
    if (note.slurStart) event.slurToNext = true;
    // 小节线：MusicXML 的小节是真的，直接用它的边界，不用按拍号猜。
    if (!next || next.measureIndex !== note.measureIndex) event.barAfter = true;
    return event;
  });

  const key = collected.fifths != null
    ? keyFromFifths(collected.fifths, collected.modeName)
    : { tonic: "C", mode: "major" };
  if (collected.fifths == null)
    warnings.push(tr("文件里没有调号，已按 C 大调导入"));

  let meter = collected.meter;
  if (!meter || !isSupportedMeter(meter)) {
    if (meter) warnings.push(tr("拍号 {meter} 暂不支持，已按 4/4 导入", { meter }));
    else warnings.push(tr("文件里没有拍号，已按 4/4 导入"));
    meter = "4/4";
  }
  const fittedMode = fitSupportedMode(key.mode);
  if (fittedMode.warning) warnings.push(fittedMode.warning);

  // 速度：<sound tempo="120"/> 是 MusicXML 记速度的标准位置。
  const sound = xmlFindAll(root, "sound").find((item) => item.attrs.tempo);
  const tempo = Math.max(
    SCORE_TEMPO_MIN,
    Math.min(SCORE_TEMPO_MAX, Math.round(Number(sound?.attrs.tempo) || 96)),
  );

  const fitted = fitMelodyOctaves(events, warnings);
  const snapped = snapEventDurations(fitted, warnings);
  sanitizeTies(snapped, warnings, { mark: tr("延音线") });

  const title =
    xmlText(xmlFindAll(root, "work-title")[0]) ||
    xmlText(xmlFindAll(root, "movement-title")[0]) ||
    "导入曲谱";
  const creator = xmlFindAll(root, "creator").find(
    (item) => item.attrs.type === "composer",
  );
  const lyricist = xmlFindAll(root, "creator").find(
    (item) => item.attrs.type === "lyricist" || item.attrs.type === "poet",
  );

  const draft = {
    schemaVersion: 1,
    title,
    composer: creator ? xmlText(creator) : "",
    lyricist: lyricist ? xmlText(lyricist) : "",
    tonic: key.tonic,
    mode: fittedMode.mode,
    meter,
    tempo,
    originalTempo: tempo,
    events: snapped,
  };
  const parsed = normalizeScoreData(draft);
  lastImportWarnings = warnings;
  return parsed;
}
// 从字节读：.mxl 是压缩包（zip），.musicxml 是纯文本，扩展名未必可信，所以按魔数判断。
// zip 的每个本地文件头都以 PK\x03\x04 开头。
async function musicXmlFromBytes(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const isZip =
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  if (!isZip) return musicXmlToScore(bytes);
  const inner = await extractMxl(bytes);
  return musicXmlToScore(inner.bytes);
}

// ── 曲谱 → MusicXML ─────────────────────────────────────────────────────────
function escapeXml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );
}
// 每四分音符分 8 格。这样时值表里最小的三十二分音符正好是 1 格，全部时值都是整数 ——
// 用 4 格的话三十二分音符会变成 0.5，MusicXML 的 <duration> 不接受小数。
const MUSICXML_DIVISIONS = 8;
const MUSICXML_TYPES = {
  0.125: ["32nd", 0],
  0.25: ["16th", 0],
  0.375: ["16th", 1],
  0.5: ["eighth", 0],
  0.75: ["eighth", 1],
  1: ["quarter", 0],
  1.5: ["quarter", 1],
  2: ["half", 0],
  3: ["half", 1],
  4: ["whole", 0],
  6: ["whole", 1],
  8: ["breve", 0],
};
// 按拍号把小节切开。用户手动加的小节线（barAfter）优先。
function splitIntoMeasures(events, meter) {
  const [top, bottom] = String(meter || "4/4").split("/").map(Number);
  const beatsPerBar = (top * 4) / (bottom || 4);
  const measures = [];
  let current = [],
    beats = 0;
  for (const event of events) {
    if (beats > 0 && beats + event.duration > beatsPerBar + 1e-6) {
      measures.push(current);
      current = [];
      beats = 0;
    }
    current.push(event);
    beats += event.duration;
    if (event.barAfter || beats >= beatsPerBar - 1e-6) {
      measures.push(current);
      current = [];
      beats = 0;
    }
  }
  if (current.length) measures.push(current);
  return measures.length ? measures : [[]];
}
function noteToMusicXml(event, next, useFlats, options = {}) {
  const [type, dots] = MUSICXML_TYPES[event.duration] || ["quarter", 0];
  const parts = [];
  const tied =
    Boolean(event.tieToNext) &&
    next != null &&
    event.pitch != null &&
    next.pitch === event.pitch;
  if (event.pitch == null) {
    parts.push("<rest/>");
  } else {
    const spelled = spellMidi(event.pitch, useFlats);
    const alter = spelled.acc === "♯" ? 1 : spelled.acc === "♭" ? -1 : 0;
    parts.push(
      `<pitch><step>${spelled.letter}</step>` +
        (alter ? `<alter>${alter}</alter>` : "") +
        `<octave>${spelled.oct}</octave></pitch>`,
    );
  }
  parts.push(
    `<duration>${Math.round(event.duration * MUSICXML_DIVISIONS)}</duration>`,
  );
  if (tied) parts.push('<tie type="start"/>');
  else if (options.tieStop) parts.push('<tie type="stop"/>');
  parts.push(`<voice>1</voice><type>${type}</type>`);
  for (let i = 0; i < dots; i++) parts.push("<dot/>");
  // <notations> 里的 tied / slur 是「画出来的弧」，<tie> 是「语义上的连接」，两者都要写，
  // 记谱软件才既画得出线、又明白这是一颗延音的音。
  const notations = [];
  if (tied) notations.push('<tied type="start"/>');
  else if (options.tieStop) notations.push('<tied type="stop"/>');
  if (event.slurToNext && next && next.pitch != null)
    notations.push('<slur type="start" number="1"/>');
  else if (options.slurStop) notations.push('<slur type="stop" number="1"/>');
  if (notations.length) parts.push(`<notations>${notations.join("")}</notations>`);
  if (event.lyric)
    parts.push(
      `<lyric number="1"><syllabic>single</syllabic><text>${escapeXml(event.lyric)}</text></lyric>`,
    );
  return `      <note>${parts.join("")}</note>`;
}
// 把曲谱写成 MusicXML。传入曲谱对象，不传就取当前编辑中的那份。
function generateMusicXml(target) {
  const source = target || (typeof score !== "undefined" ? score : null);
  if (!source || !Array.isArray(source.events))
    throw new Error(tr("没有可导出的曲谱。"));
  // 标题 / 声部名 / 产品标识都带中文，先在这里翻好再拼进模板串：模板串 `…${…}`
  // 里的 tr() 自检脚本扫不到，而且「空值回落成什么」本来就该在这一层算清楚。
  const title = source.title || tr("未命名曲谱");
  const partName = source.subtitle || tr("旋律");
  const software = tr("WhistleLoom · 谱间");
  const meter = isSupportedMeter(source.meter) ? source.meter : "4/4";
  const [top, bottom] = meter.split("/").map(Number);
  const key = keySignatureFor(source.tonic || "C", source.mode || "major");
  const modeName =
    { major: "major", minor: "minor", dorian: "dorian", mixolydian: "mixolydian" }[
      source.mode
    ] || "major";
  const measures = splitIntoMeasures(source.events, meter);

  // 连线是否要写「结束」标记，取决于上一颗音有没有开始一条线。这两个标记跨小节，
  // 所以必须在遍历小节的过程中带着走。
  let pendingTie = false,
    pendingSlur = false,
    cursor = 0;
  const measureXml = measures.map((measureEvents, index) => {
    const nodes = measureEvents.map((event) => {
      const next = source.events[cursor + 1];
      const node = noteToMusicXml(event, next, key.flat, {
        tieStop: pendingTie,
        slurStop: pendingSlur,
      });
      pendingTie =
        Boolean(event.tieToNext) &&
        next != null &&
        event.pitch != null &&
        next.pitch === event.pitch;
      pendingSlur = Boolean(event.slurToNext) && next?.pitch != null;
      cursor++;
      return node;
    });
    // 拍号 / 调号 / 速度只写第一小节。速度用 <sound tempo> —— 那是 MusicXML 记速度的
    // 标准位置，<words> 只是给人看的文字。
    const attributes =
      index === 0
        ? [
            "      <attributes>",
            `        <divisions>${MUSICXML_DIVISIONS}</divisions>`,
            `        <key><fifths>${key.count}</fifths><mode>${modeName}</mode></key>`,
            `        <time><beats>${top}</beats><beat-type>${bottom}</beat-type></time>`,
            "        <clef><sign>G</sign><line>2</line></clef>",
            "      </attributes>",
            `      <direction placement="above"><direction-type><words>♩ = ${source.tempo || 96}</words></direction-type><sound tempo="${source.tempo || 96}"/></direction>`,
          ].join("\n") + "\n"
        : "";
    return `    <measure number="${index + 1}">\n${attributes}${nodes.join("\n")}\n    </measure>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${escapeXml(title)}</work-title></work>`,
    "  <identification>",
    `    <creator type="composer">${escapeXml(source.composer || "")}</creator>`,
    `    <creator type="lyricist">${escapeXml(source.lyricist || "")}</creator>`,
    "    <encoding><software>" + software + "</software></encoding>",
    "  </identification>",
    "  <part-list>",
    `    <score-part id="P1"><part-name>${escapeXml(partName)}</part-name></score-part>`,
    "  </part-list>",
    '  <part id="P1">',
    ...measureXml,
    "  </part>",
    "</score-partwise>",
    "",
  ].join("\n");
}

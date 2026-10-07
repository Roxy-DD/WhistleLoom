/* 导入边境层：把外来文件翻译成本项目契约能接受的数据。
 *
 * 为什么不直接放进 score-model.js —— 那一层定义的是「本工具写出来的曲谱长什么样」，
 * 校验必须保持严格：本工具自己产出的 JSON 必须自洽，否则撤销栈、自动保存、可逆导出
 * 全都会带进脏数据。而外来文件（ABC / MusicXML / MIDI）里总有本项目的时值表、调式表、
 * 音高范围装不下的东西。
 *
 * 那些属于「翻译时的取舍」，必须在边境解决，而且每一次取舍都要留下一条给用户看的提示。
 * 三条导入路径（abc.js / musicxml.js / midi.js）共用这里的三件事：
 *
 *   nearestScoreDuration —— 时值吸附到最近的可用值
 *   sanitizeTies         —— 不合法的延音线降级为连奏线，或丢弃
 *   fitMelodyOctaves     —— 整段旋律移八度，落回可处理的音高范围
 *
 * 「改了哪里」的提示文案由各导入器自己组装，因为只有它们知道原始文件里写的是什么。
 */

// 最近一次导入留下的提示。三条导入路径（ABC / MusicXML / MIDI）都往这里写，
// 界面读它、在谱面上方那条提示栏里如实列出来。过去它叫 lastAbcWarnings，而且是在
// 赋值时被悄悄创建出来的隐式全局 —— 既然现在不止 ABC 一条路，就给它一个正经的声明。
let lastImportWarnings = [];

// ── 字节 → 文本 ─────────────────────────────────────────────────────────────
// 外来文件的编码没有任何保证。三种情况必须都兜住，否则用户看到的是乱码或者一屏问号：
//   有 BOM 的 UTF-16（Windows 记事本「另存为 Unicode」就是这个）
//   没有 BOM 的 UTF-16（会被 UTF-8 解成满屏 \u0000）
//   带 BOM 的 UTF-8（BOM 会变成正文第一个字符，卡掉后面的正则）
function decodeTextBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length >= 2) {
    if (data[0] === 0xff && data[1] === 0xfe)
      return new TextDecoder("utf-16le").decode(data.subarray(2));
    if (data[0] === 0xfe && data[1] === 0xff)
      return new TextDecoder("utf-16be").decode(data.subarray(2));
  }
  const text = new TextDecoder("utf-8").decode(data);
  // 没有 BOM 的 UTF-16 会被解成满屏空字符，这里退回去按小端再试一次。
  if (text.slice(0, 400).includes("\u0000"))
    return new TextDecoder("utf-16le").decode(data);
  return text.replace(/^\uFEFF/, "");
}

// 时值表只到三十二分音符（0.125 拍）和倍全音符（8 拍）。任何外来格式都可能给出落在这
// 两点之间的时值 —— MIDI 尤其如此，它的时间是按毫秒精度记的，从没量化过。
// 因为一个音符就把整份文件拒掉太粗暴，就近吸附是这几条导入路径共同的做法。
function nearestScoreDuration(value) {
  let best = SCORE_DURATION_VALUES[0];
  for (const candidate of SCORE_DURATION_VALUES)
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  return best;
}

// 把一串事件的时值就地吸附，并汇总成一条提示。返回新数组，不改原对象。
function snapEventDurations(events, warnings) {
  const changed = new Map();
  const snapped = events.map((event) => {
    const raw = Number(event.duration ?? 1);
    const best = nearestScoreDuration(raw);
    if (Math.abs(best - raw) > 1e-6)
      changed.set(`${Number(raw.toFixed(3))}→${best}`, true);
    return { ...event, duration: best };
  });
  if (changed.size)
    warnings.push(
      // 原来的写法是「固定前缀 + 拼一段列表」。列表是运行时才知道的，所以前缀进语言表、
      // 用 {list} 占位；分隔符「、」是标点，中英一样，留在代码里。
      tr("部分时值超出可表示范围，已就近调整：{list}", {
        list: [...changed.keys()].slice(0, 4).join("、"),
      }),
    );
  return snapped;
}

// ── 延音线收尾 ──────────────────────────────────────────────────────────────
// 延音线（tie）只能连到「同一音高的下一颗音」，因为它的含义是「两颗音其实是一颗，
// 时值要并起来唱」。可外面的谱子经常把它当「连奏符」用在不同音高之间 —— ABC 里大量
// 手工誊抄的 `-` 是这样（`(3d-e-f`、`E-F`、`D2- E2`），MusicXML 里也能见到。
// 这在记谱规则里不合法，但作者想表达「这两个音连着吹」是清楚的，原谱面也在两音之间
// 画了一条弧。而 tie 和 slur 在本项目里画出来是同一种弧（CSS 同一条规则）。
//
// 处理办法：
//   同音高   → 照旧当延音线。
//   不同音高 → 降级为连奏线。连奏线本来就不要求同音高，弧画出来和原谱一致，既保住了
//              「连起来」的意思，又不会像延音线那样去改变时值的含义。
//   后面没有音符、或落在休止符上 → 丢弃（没有可连接的对象）。
// 三种情况都记一条提示 —— 外来文件里动了什么，必须说出来，不能悄悄改掉。
//
// 这跟 app.js 的 repairTies() 不是一回事：那边是「你在编辑器里改了音高、把本来合法的
// 延音线弄断了」，用户就在跟前看着谱面，直接丢掉即可；这边是外面进来的文件，得留住
// 原意并且明确告知。mark 让 ABC 说「-」、MusicXML 说「延音线」，提示读起来才对得上。
function sanitizeTies(events, warnings, options = {}) {
  const mark = options.mark || "“-”";
  let retied = 0,
    dropped = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event.tieToNext) continue;
    const next = events[index + 1];
    if (!next || event.pitch == null || next.pitch == null) {
      event.tieToNext = false;
      dropped++;
    } else if (event.pitch !== next.pitch) {
      event.tieToNext = false;
      event.slurToNext = true;
      retied++;
    }
  }
  if (retied)
    warnings.push(
      tr("有 {n} 处{mark}连的是不同音高，已按连奏线导入（谱面上画为连音弧）", {
        n: retied,
        mark,
      }),
    );
  if (dropped)
    warnings.push(
      tr("有 {n} 处{mark}后面没有可连的音符，已忽略", { n: dropped, mark }),
    );
}

// ── 音域适配 ────────────────────────────────────────────────────────────────
// 本项目的音高范围是 24–108（契约层写死的）。外来文件里的旋律可能整段落在范围外 ——
// 例如给低音谱号写的声部，或者极高的花腔声部。
//
// 整体移八度、而不是逐个音裁剪：音程关系（旋律的「形状」）比它的绝对高度重要得多，
// 逐音裁剪会把旋律毁掉。移了几个八度必须说清楚，因为那会让整首曲子听起来不对。
function fitMelodyOctaves(events, warnings) {
  const voiced = events.filter((event) => event.pitch != null);
  if (!voiced.length) return events;
  const pitches = voiced.map((event) => event.pitch);
  const low = Math.min(...pitches),
    high = Math.max(...pitches);
  if (low >= SCORE_PITCH_MIN && high <= SCORE_PITCH_MAX) return events;

  let shift = 0;
  if (high - low <= SCORE_PITCH_MAX - SCORE_PITCH_MIN) {
    while (low + shift < SCORE_PITCH_MIN) shift += 12;
    while (high + shift > SCORE_PITCH_MAX) shift -= 12;
  } else {
    // 音域宽过七个八度，怎么移都装不下。以中位数对准哨笛的中音区，两端各自略去。
    const sorted = pitches.slice().sort((a, b) => a - b);
    shift = Math.round((66 - sorted[Math.floor(sorted.length / 2)]) / 12) * 12;
  }
  const kept = events.filter(
    (event) =>
      event.pitch == null ||
      (event.pitch + shift >= SCORE_PITCH_MIN &&
        event.pitch + shift <= SCORE_PITCH_MAX),
  );
  const dropped = events.length - kept.length;
  warnings.push(
    // 「升高/降低」是插进句子里的词，单独进语言表再让整句的 {shift} 去取；
    // 后半句「，并略去…」只有真的丢了音才出现，所以是另一条独立的键。
    tr("旋律音域超出可处理范围，已整段{shift} {octaves} 个八度", {
      shift: tr(shift > 0 ? "升高" : "降低"),
      octaves: Math.abs(shift) / 12,
    }) +
      (dropped
        ? tr("，并略去 {n} 个仍然超界的音", { n: dropped })
        : ""),
  );
  return kept.map((event) =>
    event.pitch == null ? event : { ...event, pitch: event.pitch + shift },
  );
}

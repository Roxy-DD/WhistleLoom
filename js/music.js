function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function spellMidi(midi, useFlats = false) {
  const pc = ((midi % 12) + 12) % 12,
    oct = Math.floor(midi / 12) - 1;
  return {
    name: (useFlats ? pcFlat : pcSharp)[pc],
    oct,
    letter: (useFlats ? pcFlat : pcSharp)[pc][0],
    acc: (useFlats ? pcFlat : pcSharp)[pc].slice(1),
  };
}
function pitchText(midi) {
  const s = spellScoreMidi(midi);
  return `${s.name}${s.oct}`;
}

// ── 渲染上下文 ──────────────────────────────────────────────────────────────
// 「调号、简谱唱名、指法」这三样过去都直接去读界面上那几个下拉框的值。可是渲染层
// 的职责是「为某一份曲谱产出谱面」——导出、打印、以后可能还有预览，它们渲染的曲谱
// 未必就是当前正在编辑的那一份。一旦两者不同，谱面就会被画成另一份曲谱的调号。
// 所以渲染前先把这份曲谱的调性放进来；取不到时才回落到下拉框。
const DEFAULT_RENDER_KEYS = { tonic: "C", mode: "major", whistleKey: "D" };
let renderKeys = null;
function setRenderKeys(keys) {
  renderKeys = keys && typeof keys === "object" ? keys : null;
}
function resolveKey(name) {
  const fromScore = renderKeys?.[name];
  if (fromScore != null && fromScore !== "") return fromScore;
  let fromDom;
  try {
    fromDom = $(name)?.value;
  } catch (_) {
    fromDom = undefined;
  }
  return fromDom || DEFAULT_RENDER_KEYS[name];
}

// 调式 → 「它和哪个大调共用同一套升降号」。大调本身是 0；小调（爱奥利亚）比同主音
// 大调低 3 个半音，所以看「主音 +3」那个大调的升降号；多利亚 +10、混合利底亚 +5、
// 弗里吉亚 +8、利底亚 +7、洛克里亚 +1。爱尔兰哨笛曲里前四种就够用了。
const MODE_MAJOR_OFFSET = {
  major: 0,
  minor: 3,
  dorian: 10,
  mixolydian: 5,
  phrygian: 8,
  lydian: 7,
  locrian: 1,
};
// 调式的中文名。这份表放在 music.js（最底层、不碰 DOM）是刻意的：
// 界面下拉框、导出谱头的调式说明、ABC 导入提示语，过去各抄了一份，而 score-export.js
// 那份抄漏了混合利底亚 —— 于是一首 D 混合利底亚的曲子导出后，谱头上印着「自然大调」，
// 可它的 C 明明是 C 本位（大调该是 C♯）。三处各写一遍，迟早还要再漏一次。
const MODE_LABELS = {
  major: "自然大调",
  minor: "自然小调",
  dorian: "多利亚调式",
  mixolydian: "混合利底亚调式",
  phrygian: "弗里吉亚调式",
  lydian: "利底亚调式",
  locrian: "洛克里亚调式",
};
function modeLabel(mode) {
  // 翻译放在这里、不放在上面的常量表：语言可以在运行时切换，表若在模块顶层就翻，
  // 切过一次语言之后那份名字会一直冻在初始语言上。
  return tr(MODE_LABELS[mode] || MODE_LABELS.major);
}
// 调式名的识别。三种来源写法各不相同：ABC 的 K: 只写前三个字母（K:Ador），MusicXML 的
// <mode> 写全名（dorian），MIDI 的调号 meta 干脆只给「大调还是小调」。识别规则沿用 ABC
// 规范 —— 只看字母、只看前三个、大小写不敏感，所以 "mixolydian"、"Mix"、"MIX" 等价。
// 认不出来返回 null，由调用方决定怎么回落。
const MODE_PATTERNS = [
  [/^(?:maj|ion)/i, "major"],
  [/^(?:min|aeo)/i, "minor"],
  [/^(?:dor)/i, "dorian"],
  [/^(?:mix)/i, "mixolydian"],
  [/^(?:phr)/i, "phrygian"],
  [/^(?:lyd)/i, "lydian"],
  [/^(?:loc)/i, "locrian"],
  [/^m$/i, "minor"],
];
function modeFromName(text) {
  const letters = String(text || "").replace(/[^A-Za-z]/g, "");
  if (!letters) return null;
  for (const [pattern, mode] of MODE_PATTERNS)
    if (pattern.test(letters)) return mode;
  return null;
}
// 编辑器只支持 SCORE_MODES 这四种调式。更冷门的调式按最接近的一种导入 —— 但必须提示，
// 因为悄悄换掉一套调号会让整首曲子的音都错掉。「K:AMix 被当成 A 小调」当初就是这么来的。
const MODE_FALLBACK = {
  ionian: "major",
  aeolian: "minor",
  phrygian: "minor",
  lydian: "major",
  locrian: "minor",
};
function fitSupportedMode(mode) {
  if (SCORE_MODES.has(mode)) return { mode, warning: null };
  const fallback = MODE_FALLBACK[mode] || "major";
  return {
    mode: fallback,
    // 两个调式名的翻译由 modeLabel() 各自带上，这里只把整句骨架交给 tr()。
    warning: tr("{mode}暂不支持，已按{fallback}导入，请核对调号", {
      mode: modeLabel(mode),
      fallback: modeLabel(fallback),
    }),
  };
}
// 给定主音与调式，算出调号。map 记「哪个音名要升降、升还是降」（+1 升、−1 降），
// count 是数量（正数是升号数，负数是降号数）。这是一份纯函数：谱面渲染和 ABC 导入
// 都调它，避免两处各写一套算法然后慢慢分叉。
function keySignatureFor(tonic, mode) {
  const raw = tonic || "C",
    root = keyMidi[raw] ?? 60,
    majorPc = (((root + (MODE_MAJOR_OFFSET[mode] ?? 0)) % 12) + 12) % 12,
    sharpPcs = [7, 2, 9, 4, 11, 6, 1],
    flatPcs = [5, 10, 3, 8, 1, 6, 11],
    preferFlat =
      raw.includes("b") ||
      (flatPcs.includes(majorPc) && !sharpPcs.includes(majorPc)),
    order = preferFlat
      ? ["B", "E", "A", "D", "G", "C", "F"]
      : ["F", "C", "G", "D", "A", "E", "B"],
    count = (preferFlat ? flatPcs : sharpPcs).indexOf(majorPc) + 1,
    map = {};
  if (count > 0)
    order
      .slice(0, count)
      .forEach((letter) => (map[letter] = preferFlat ? -1 : 1));
  return { map, count: count * (preferFlat ? -1 : 1), flat: preferFlat, order };
}
// ── 调号的反向换算 ──────────────────────────────────────────────────────────
// MusicXML 的 <key><fifths> 和 MIDI 的调号 meta（sf）都不直接说主音是谁，只说「调号里有
// 几个升号或降号」。主音是能反推出来的：调号决定的是「和哪个大调共用同一套升降号」，
// 而调式又决定主音比那个大调的主音偏多少（见上面的 MODE_MAJOR_OFFSET）。两张表就是
// 「升降号个数 → 那个大调的名字」。
// 小调单独列一张表，是因为按偏移量算会得到等音异名：E♭ 小调会被算成 D♯ 小调。
// 这类拼写没法从数学里推出来，只能按惯例写死。
const KEY_MAJOR_SHARP = ["C", "G", "D", "A", "E", "B", "F#", "C#"];
const KEY_MAJOR_FLAT = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const KEY_MINOR_SHARP = ["A", "E", "B", "F#", "C#", "G#", "D#", "A#"];
const KEY_MINOR_FLAT = ["A", "D", "G", "C", "F", "Bb", "Eb", "Ab"];
const KEY_PC_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_PC_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
// Cb、B#、E# 这类调名超出了界面的调名表。返回它所在的「十二个音级」编号，
// 之后可以换成同音高的等音名（Cb→B、B#→C）。
function keyPitchClass(name) {
  const m = String(name || "C").match(/^([A-G])([#b♯♭]?)$/);
  if (!m) return 0;
  const acc =
    m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return ((naturalPc[m[1]] + acc) % 12 + 12) % 12;
}
// 界面里的调名只有 17 个（7 个本位音 + 各一个升/降名）。超出这个范围的调名换成等音名。
const KEY_SHARP_NAMES = KEY_PC_SHARP;
function normalizeKeyName(name) {
  const m = String(name || "").match(/^([A-Ga-g])([#b♯♭]?)/);
  if (!m) return "C";
  const candidate =
    m[1].toUpperCase() +
    (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2] || "");
  if (keyMidi[candidate] != null) return candidate;
  return KEY_SHARP_NAMES[keyPitchClass(candidate)];
}
// 由调号里的升降号个数 + 调式，反推出主音与调式。
function keyFromFifths(fifths, modeText) {
  const n = Math.max(-7, Math.min(7, Math.round(Number(fifths) || 0)));
  const mode = modeFromName(modeText) || "major";
  const flat = n < 0;
  const majorName = (flat ? KEY_MAJOR_FLAT : KEY_MAJOR_SHARP)[Math.abs(n)];
  const offset = MODE_MAJOR_OFFSET[mode] ?? 0;
  if (!offset) return { tonic: normalizeKeyName(majorName), mode };
  if (offset === 3)
    return {
      tonic: normalizeKeyName(
        (flat ? KEY_MINOR_FLAT : KEY_MINOR_SHARP)[Math.abs(n)],
      ),
      mode,
    };
  const pc = ((keyPitchClass(majorName) - offset) % 12 + 12) % 12;
  return { tonic: (flat ? KEY_PC_FLAT : KEY_PC_SHARP)[pc], mode };
}
function keySignature() {
  return keySignatureFor(resolveKey("tonic"), resolveKey("mode"));
}
function tonicMidi() {
  return keyMidi[resolveKey("tonic")] ?? 62;
}
// 两个调之间最短的移调距离，结果落在 −6…+6 个半音之内。
// 例：C 移到 B，往下 1 个半音就够，不必往上 11 个 —— 那样会把整首曲子拽出音域。
function transposeShift(fromMidi, toMidi) {
  let n = toMidi - fromMidi;
  while (n > 6) n -= 12;
  while (n < -6) n += 12;
  return n;
}
function spellScoreMidi(midi) {
  return spellMidi(midi, keySignature().flat);
}
function solfege(midi) {
  if (midi == null) return "0";
  const steps = scaleSteps[resolveKey("mode")] || scaleSteps.major,
    delta = midi - tonicMidi();
  let best = null;
  for (let oct = -3; oct <= 3; oct++)
    steps.forEach((n, i) => {
      const candidate = oct * 12 + n,
        distance = Math.abs(delta - candidate);
      if (!best || distance < best.distance)
        best = { oct, i, candidate, distance };
    });
  const alteration = delta - best.candidate,
    mark = alteration < -0.01 ? "♭" : alteration > 0.01 ? "♯" : "",
    count = Math.min(Math.abs(best.oct), 2),
    dots = count
      ? '<span class="octave-dots ' +
        (best.oct > 0 ? "high" : "low") +
        '">' +
        "•".repeat(count) +
        "</span>"
      : "";
  return '<span class="solfege-core">' + mark + (best.i + 1) + "</span>" + dots;
}
function diatonicPosition(midi) {
  const s = spellScoreMidi(midi),
    oct = s.oct;
  return oct * 7 + letterIndex[s.letter];
}
// 这支六孔哨笛的可用音域上限，相对全按音算，单位是半音：两个八度。
//
// 为什么写死 24 而不是「octave > 1」：编辑器允许录到 86（D6），而 D 调哨笛的全按音
// 是 62（D4），86 − 62 正好 24 —— 那正是这支笛子能吹的最高音，不该被判成越界。
// 再往上要靠第三个八度超吹，本版本不认。
const WHISTLE_MAX_SEMITONES = 24;
// 指法表。第四项 issue 只在「这个音这支笛子出不来」时才有值：
//   low          低于全按音。笛子就那么大，没有更低的孔可以放，物理上就是吹不出来。
//   high         超出两个八度。
//   noFingering  音高在音域里，但六孔全开全闭这套指法拼不出它（F 自然、G♯、B♭…），
//                实际演奏要靠半孔或叉口指法，本版本没有收录。
// 三者都让 valid 为 false；valid 为 true 时 issue 一定是 null。
function fingering(midi) {
  if (midi == null)
    return { closed: null, octave: 0, valid: true, rest: true, issue: null };
  const root = whistleMidi[resolveKey("whistleKey")] || 62;
  const semis = [0, 2, 4, 5, 7, 9, 11];
  const diff = midi - root;
  const octave = Math.floor(diff / 12);
  const pc = ((diff % 12) + 12) % 12;
  // 音域检查必须先于指法查表，否则「比全按还低」的音会被 pc 蒙对：C4 在 D 调哨笛上
  // diff = −2、pc = 10，正好撞上下面 C 自然音的叉口指法分支，于是一张看着完全正常、
  // 实际一吹就是哑的指法图被画了出来 —— 这比不显示更糟。
  if (diff < 0) return { valid: false, issue: "low", octave, closed: null };
  if (diff > WHISTLE_MAX_SEMITONES)
    return { valid: false, issue: "high", octave, closed: null };
  let degree = semis.indexOf(pc);
  if (degree < 0) {
    if (pc === 10)
      return {
        valid: true,
        issue: null,
        octave,
        closed: [false, false, false, true, true, true],
        cross: true,
      };
    return { valid: false, issue: "noFingering", octave, closed: null };
  }
  let mask = [6, 5, 4, 3, 2, 1, 0][degree];
  return {
    valid: true,
    issue: null,
    octave,
    closed: Array.from({ length: 6 }, (_, i) => i < mask),
  };
}
function holeSvg(midi) {
  const f = fingering(midi);
  if (f.rest) return '<span class="rest-hole">—</span>';
  // 吹不出来的音：三种成因各给一个记号。整句说明挂在 title 与 aria-label 上 ——
  // 一格只有几个字宽，塞不下「低于这支哨笛的最低音」这样的整句话。
  // 记号用汉字而不是箭头：谱面是给吹笛子的人看的，看到「低」字比看到「↓」更快明白
  // 是音高的问题，而不是「往下滑」之类的演奏指示。
  if (f.issue) {
    const why =
      f.issue === "low"
        ? tr("太低，低于这支哨笛的最低音")
        : f.issue === "high"
          ? tr("太高，超出这支哨笛的音域")
          : tr("此音需要半孔或本版本尚无可靠指法");
    const mark = f.issue === "noFingering" ? "?" : f.issue === "low" ? tr("低") : tr("高");
    return (
      '<span class="fingering-issue" role="img" aria-label="' +
      escapeHtml(why) +
      '" title="' +
      escapeHtml(why) +
      '">' +
      escapeHtml(mark) +
      "</span>"
    );
  }
  let c = "";
  for (let i = 0; i < 6; i++) {
    const closed = f.closed[i];
    c += `<circle class="${closed ? "hole-closed" : "hole-open"}" cx="10" cy="${8 + i * 8}" r="2.55"/>`;
  }
  // 指法的无障碍描述整句一起翻：中英文里「C#4 指法」的语序不同，拆成「音高 + 指法」
  // 两半去拼会把语序写死在代码里。
  const label = f.cross
    ? tr("{pitch} 指法，交叉指法", { pitch: pitchText(midi) })
    : tr("{pitch} 指法", { pitch: pitchText(midi) });
  return `<svg class="hole-svg" viewBox="0 0 20 80" role="img" aria-label="${escapeHtml(label)}"><path d="M6 2h8v4l2 2v43l-2 3H6l-2-3V8l2-2z" fill="#fffefa" stroke="#7d857c" stroke-width="1.2"/><path d="M7 2h6v5H7z" fill="#d8ded5" stroke="#7d857c" stroke-width=".8"/>${c}${f.octave > 0 ? '<text class="octave-mark" x="10" y="77" text-anchor="middle">+</text>' : ""}</svg>`;
}
function noteY(midi) {
  return 60 - (diatonicPosition(midi) - (4 * 7 + letterIndex.E)) * 5;
}

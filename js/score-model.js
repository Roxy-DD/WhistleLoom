/* Versioned score-file contract and validation shared by imports and autosave. */
const SCORE_SCHEMA_VERSION = 1;
const SCORE_DURATION_VALUES = [
  0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8,
];
// 拍号不再用固定白名单。白名单会误伤真实存在的曲谱：ABC 里的 2/2（cut time）、
// 5/4、3/8、7/8 都很常见，导入时会被直接拒掉。改成按结构校验——分子 1–32 的整数，
// 分母限定为二的幂（1/2/4/8/16/32），这已经覆盖西方记谱法里的全部拍号。
// 编辑器上方的下拉框只列常用拍号；导入到不常见的拍号时由界面动态补一个选项。
const SCORE_METER_PATTERN = /^(?:[1-9]|[12]\d|3[0-2])\/(?:1|2|4|8|16|32)$/;
const SCORE_METER_PRESETS = [
  "4/4",
  "3/4",
  "2/4",
  "6/8",
  "9/8",
  "12/8",
  "2/2",
  "3/8",
  "5/4",
  "5/8",
  "7/8",
];
function isSupportedMeter(value) {
  return typeof value === "string" && SCORE_METER_PATTERN.test(value);
}
const SCORE_TONICS = new Set([
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
  "A",
  "A#",
  "Bb",
  "B",
]);
const SCORE_WHISTLE_KEYS = new Set(["C", "D", "Eb", "F", "G", "A", "Bb"]);
// 可处理的音高范围。定义在这里、由校验和导入边境层共用 —— 一份数字只有一个出处，
// 才不会出现「校验说 24–108、导入器却按 21–109 裁」这种对不上的情况。
const SCORE_PITCH_MIN = 24;
const SCORE_PITCH_MAX = 108;
// 速度范围同理。这里曾经出过一个会丢数据的 bug：界面把数字框的上限放到 400（数字框本来
// 就是用来跳过滑杆刻度直接给数的），契约层却还卡在 320。用户在框里输 400 → 自动存档写下
// 400 → 下次打开时校验抛错 → 整份曲谱被判成「存档损坏」清空。**同一个量在两处各写一遍，
// 迟早会分叉**，所以范围定义在这里，界面和编解码器都来读这两个数。
const SCORE_TEMPO_MIN = 20;
const SCORE_TEMPO_MAX = 400;
// 编辑器支持的调式。爱尔兰/苏格兰传统曲目里实际会遇到的调式几乎只有这四种：
// 大调、小调（爱奥利亚）、多利亚、混合利底亚。像 K:AMix 这种在美国乡村和爱尔兰
// 里非常常见的写法，过去因为不在名单里而被当成大调，调号会整整差两个升号。
const SCORE_MODES = new Set(["major", "minor", "dorian", "mixolydian"]);

// 导出文件名的主体：去掉文件系统不接受的字符，并去掉结尾的空格和点。
// 单独抽出来是因为现在不止 JSON 一种导出格式了 —— 各种格式只是扩展名不同，
// 「名字怎么取」这件事只该有一处定义。
function scoreBaseName(title) {
  const safe = String(title || tr("未命名曲谱"))
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return safe || tr("未命名曲谱");
}
function scoreFilename(title) {
  return `${scoreBaseName(title)}.json`;
}

function normalizeScoreData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(tr("曲谱文件格式无效：需要一个曲谱对象。"));
  }
  const version = Number(input.schemaVersion ?? 1);
  if (
    !Number.isInteger(version) ||
    version > SCORE_SCHEMA_VERSION ||
    version < 1
  ) {
    throw new Error(tr("此曲谱文件版本暂不支持，请使用较新版本的谱间打开。"));
  }
  if (!Array.isArray(input.events) || input.events.length > 10000) {
    throw new Error(tr("曲谱音符数据无效或超过 10,000 个音符。"));
  }

  const enumValue = (value, allowed, fallback, label) => {
    if (value == null || value === "") return fallback;
    if (!allowed.has(value))
      throw new Error(
        // label 本身也是界面词（「主音」「调式」…），一并翻，英文界面里才不会中英混排。
        tr("曲谱{label}“{value}”暂不支持。", { label: tr(label), value }),
      );
    return value;
  };
  if (input.title != null && typeof input.title !== "string") {
    throw new Error(tr("曲谱标题格式无效。"));
  }
  const cleanText = (value, label) => {
    if (value != null && typeof value !== "string") {
      throw new Error(tr("曲谱{label}格式无效。", { label: tr(label) }));
    }
    return String(value || "").trim().slice(0, 200);
  };
  const title =
    String(input.title || tr("未命名曲谱"))
      .trim()
      .slice(0, 200) || tr("未命名曲谱");
  const tonic = enumValue(input.tonic, SCORE_TONICS, "C", "主音");
  const mode = enumValue(input.mode, SCORE_MODES, "major", "调式");
  const meter = (() => {
    if (input.meter == null || input.meter === "") return "4/4";
    if (!isSupportedMeter(input.meter))
      throw new Error(
        tr("曲谱拍号“{meter}”暂不支持。", { meter: input.meter }),
      );
    return input.meter;
  })();
  const whistleKey = enumValue(
    input.whistleKey,
    SCORE_WHISTLE_KEYS,
    "D",
    "哨笛调",
  );
  const sourceTonic = input.sourceTonic
    ? enumValue(input.sourceTonic, SCORE_TONICS, "", "原调")
    : "";
  const tempo = Number(input.tempo ?? 96);
  const originalTempo = Number(input.originalTempo ?? input.tempo ?? 96);
  if (
    !Number.isFinite(tempo) ||
    tempo < SCORE_TEMPO_MIN ||
    tempo > SCORE_TEMPO_MAX ||
    !Number.isFinite(originalTempo) ||
    originalTempo < SCORE_TEMPO_MIN ||
    originalTempo > SCORE_TEMPO_MAX
  ) {
    throw new Error(
      tr("曲谱速度须在 {min}–{max} BPM 之间。", {
        min: SCORE_TEMPO_MIN,
        max: SCORE_TEMPO_MAX,
      }),
    );
  }

  const events = input.events.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(
        tr("第 {index} 个音符数据无效。", { index: index + 1 }),
      );
    }
    const pitch = event.pitch == null ? null : Number(event.pitch);
    const duration = Number(event.duration ?? 1);
    if (
      pitch !== null &&
      (!Number.isInteger(pitch) ||
        pitch < SCORE_PITCH_MIN ||
        pitch > SCORE_PITCH_MAX)
    ) {
      throw new Error(
        tr("第 {index} 个音符音高超出可处理范围。", { index: index + 1 }),
      );
    }
    if (
      !Number.isFinite(duration) ||
      !SCORE_DURATION_VALUES.some(
        (value) => Math.abs(value - duration) < 0.0001,
      )
    ) {
      throw new Error(
        tr("第 {index} 个音符时值暂不支持。", { index: index + 1 }),
      );
    }
    if (event.lyric != null && typeof event.lyric !== "string") {
      throw new Error(
        tr("第 {index} 个音符歌词格式无效。", { index: index + 1 }),
      );
    }
    if (event.barAfter != null && typeof event.barAfter !== "boolean") {
      throw new Error(
        tr("第 {index} 个音符小节线标记无效。", { index: index + 1 }),
      );
    }
    for (const mark of ["tieToNext", "slurToNext"]) {
      if (event[mark] != null && typeof event[mark] !== "boolean") {
        throw new Error(
          tr("第 {index} 个音符的{mark}标记无效。", {
            index: index + 1,
            mark: tr(mark === "tieToNext" ? "延音线" : "连奏线"),
          }),
        );
      }
    }
    return {
      pitch,
      duration,
      lyric: String(event.lyric || "").slice(0, 200),
      barAfter: Boolean(event.barAfter),
      tieToNext: Boolean(event.tieToNext),
      slurToNext: Boolean(event.slurToNext),
    };
  });
  events.forEach((event, index) => {
    if (!event.tieToNext) return;
    const next = events[index + 1];
    if (!next || event.pitch == null || next.pitch == null || event.pitch !== next.pitch) {
      throw new Error(
        tr("第 {index} 个音符的延音线必须连接到下一颗同音高音符。", {
          index: index + 1,
        }),
      );
    }
  });

  return {
    schemaVersion: SCORE_SCHEMA_VERSION,
    title,
    subtitle: cleanText(input.subtitle, "副标题"),
    composer: cleanText(input.composer, "作曲者"),
    lyricist: cleanText(input.lyricist, "作词者"),
    arranger: cleanText(input.arranger, "编配者"),
    sourceTonic,
    tonic,
    mode,
    meter,
    whistleKey,
    tempo,
    originalTempo,
    events,
  };
}

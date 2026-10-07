/* MIDI 编解码：读标准 MIDI 文件（.mid/.midi/SMF），也能把曲谱导成 MIDI。
 *
 * 为什么 MIDI 和 MusicXML 都要有 —— 它们覆盖的是两种不同的来路：
 *   MusicXML 是「记谱软件之间交换的乐谱」，音符有名字、有连音线、有歌词，最接近本项目的模型。
 *   MIDI 是「声音的时间表」，只有音高和起止时刻，没有调号的名字、没有连音线，但它是
 *   扒谱工具、DAW、素材站、游戏提取物最通用的出口。用户手上是哪种，往往由不得他挑。
 *
 * 两者的取舍方向也不同：MusicXML 读进来几乎无损；MIDI 读进来必须量化（它的时间是按
 * 毫秒精度记的，从来没量化过），所以 MIDI 那条路的提示会明显多一些。
 */

const MIDI_DIVISION = 480;
const MIDI_META_TEXT = new TextDecoder("utf-8");

function midiU16(bytes, at) {
  return (bytes[at] << 8) | bytes[at + 1];
}
function midiU32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at+1] << 16) | (bytes[at+2] << 8) | bytes[at+3]) >>> 0;
}
// MIDI 的「变长数量」：每个字节低 7 位是数据，最高位表示「后面还有」。
function midiReadVar(bytes, at) {
  let value = 0,
    cursor = at;
  while (cursor < bytes.length) {
    const byte = bytes[cursor++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return { value, next: cursor };
}
function midiWriteVar(value) {
  const out = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
}
function midiDecodeText(data) {
  return MIDI_META_TEXT.decode(data).replace(/\u0000+$/, "").trim();
}

// 一条音轨里，按时间顺序读事件。只关心音符（0x9n/0x8n）和几类 meta，
// 其余（控制器、弯音、系统专用消息）按长度跳过 —— 要的是旋律，不是音色。
function parseMidiTrack(bytes, at, end) {
  const notes = [],
    lyrics = [];
  const active = new Map();
  let tick = 0,
    status = 0,
    name = "",
    tempo = null,
    timeSignature = null,
    keySignature = null;
  while (at < end) {
    const delta = midiReadVar(bytes, at);
    tick += delta.value;
    at = delta.next;
    if (at >= end) break;
    let byte = bytes[at];
    if (byte & 0x80) {
      status = byte;
      at++;
    } else if (!status) {
      break;
    }
    const high = status & 0xf0;
    if (status === 0xff) {
      const type = bytes[at++];
      const length = midiReadVar(bytes, at);
      at = length.next;
      const data = bytes.subarray(at, at + length.value);
      at += length.value;
      // meta 事件之后不能沿用 running status。
      status = 0;
      if (type === 0x03) name = midiDecodeText(data);
      else if (type === 0x51 && data.length >= 3)
        tempo = 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]);
      else if (type === 0x58 && data.length >= 2)
        timeSignature = { beats: data[0] || 4, denominator: 1 << data[1] };
      else if (type === 0x59 && data.length >= 2)
        keySignature = {
          sf: (data[0] << 24) >> 24,
          minor: data[1] === 1,
        };
      else if (type === 0x05) {
        const text = midiDecodeText(data);
        if (text) lyrics.push({ tick, text });
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = midiReadVar(bytes, at);
      at = length.next + length.value;
      status = 0;
      continue;
    }
    if (high === 0x80 || high === 0x90) {
      const pitch = bytes[at++],
        velocity = bytes[at++];
      if (high === 0x90 && velocity > 0) {
        active.set(pitch, tick);
      } else {
        const start = active.get(pitch);
        if (start != null) {
          active.delete(pitch);
          notes.push({ start, end: tick, pitch, channel: status & 0x0f });
        }
      }
      continue;
    }
    // 其余通道消息：0xC0/0xD0 带 1 个参数，别的带 2 个。
    at += high === 0xc0 || high === 0xd0 ? 1 : 2;
  }
  return { notes, lyrics, name, tempo, timeSignature, keySignature };
}
// 复调降级：从一堆同时发声的音里挑出主旋律。
// 这是扒谱里的经典做法 —— 旋律通常是同时发声的音里最高的那个。钢琴谱左右手分轨时，
// 左右手本来就在不同音轨，所以这条规则主要用来对付和弦：和弦取最高音。
function melodyLine(notes) {
  const sorted = notes
    .slice()
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const line = [];
  let lastEnd = -1,
    dropped = 0;
  for (const note of sorted) {
    if (note.end <= note.start) continue;
    if (note.start < lastEnd || (line.length && note.start === line[line.length - 1].start)) {
      dropped++;
      continue;
    }
    line.push(note);
    lastEnd = note.end;
  }
  return { line, dropped };
}
// 空隙补休止符。用最大面额的时值去凑，凑不出的零头（不足三十二分音符）丢掉并计数。
function pushRests(events, beats) {
  let left = beats;
  for (let i = SCORE_DURATION_VALUES.length - 1; i >= 0 && left > 1e-6; i--) {
    const value = SCORE_DURATION_VALUES[i];
    while (left >= value - 1e-6) {
      events.push({ pitch: null, duration: value });
      left -= value;
    }
  }
  return left;
}

function parseMidiFile(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < 14 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "MThd")
    throw new Error(tr("这看起来不是标准 MIDI 文件（开头没有 MThd 标记）。"));
  const headerLength = midiU32(bytes, 4);
  const declaredTracks = midiU16(bytes, 10);
  const division = midiU16(bytes, 12);
  if (division & 0x8000)
    throw new Error(
      tr("这是按时间码记时的 MIDI（SMPTE 时基），本工具按「每分钟拍数」处理，请改用常规导出。"),
    );

  const tracks = [];
  let at = 8 + headerLength;
  while (at + 8 <= bytes.length && tracks.length < Math.max(declaredTracks, 1)) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const length = midiU32(bytes, at + 4);
    if (id !== "MTrk") break;
    tracks.push(parseMidiTrack(bytes, at + 8, Math.min(at + 8 + length, bytes.length)));
    at += 8 + length;
  }
  if (!tracks.length) throw new Error(tr("这个 MIDI 文件里没有找到任何音轨。"));

  const warnings = [];
  // 打击乐在 MIDI 里固定走第 10 通道（编号 9）。它的「音高」其实是鼓的种类，
  // 当成旋律收进来会得到一串毫无意义的噪声。
  const ranked = tracks
    .map((track, index) => ({
      track,
      index,
      notes: track.notes.filter((note) => note.channel !== 9),
    }))
    .filter((item) => item.notes.length)
    .sort((a, b) => b.notes.length - a.notes.length);
  if (!ranked.length)
    throw new Error(
      tr("这个 MIDI 文件里只有打击乐轨道，没有可以记成旋律的音符。"),
    );
  if (ranked.length > 1) {
    const name = ranked[0].track.name;
    warnings.push(
      tr("文件里有 {n} 条含音符的音轨，已导入音符最多的那条{name}", {
        n: ranked.length,
        name: name ? tr("（{name}）", { name }) : "",
      }),
    );
  }

  const chosen = ranked[0];
  const reduced = melodyLine(chosen.notes);
  if (reduced.dropped)
    warnings.push(
      tr("这条音轨上有 {n} 个音与其他音同时发声（和弦/伴奏），已按「同时发声时取最高音」处理成单旋律", {
        n: reduced.dropped,
      }),
    );

  const lyricsByTick = new Map();
  for (const lyric of chosen.track.lyrics)
    if (!lyricsByTick.has(lyric.tick)) lyricsByTick.set(lyric.tick, lyric.text);

  const events = [];
  let cursor = 0,
    lostBeats = 0;
  for (const note of reduced.line) {
    const start = note.start / division;
    if (start > cursor + 1e-6) lostBeats += pushRests(events, start - cursor);
    events.push({
      pitch: note.pitch,
      duration: (note.end - note.start) / division,
      lyric: lyricsByTick.get(note.start) || "",
    });
    cursor = Math.max(cursor, note.end / division);
  }
  if (!events.length) throw new Error(tr("这个 MIDI 文件里没有可用的音符。"));
  if (events.at(-1)) events.at(-1).barAfter = true;
  if (lostBeats > 1e-6)
    warnings.push(tr("有几处空隙短于三十二分音符，已略去不计"));

  // 拍号 / 调号 / 速度通常记在第一条音轨上（多数软件把它当「指挥轨」）。
  const metaSource = tracks.find((track) => track.timeSignature) || tracks[0];
  const keySig = tracks.find((track) => track.keySignature)?.keySignature;
  const tempoBeats = tracks.find((track) => track.tempo)?.tempo;

  let meter = metaSource?.timeSignature
    ? `${metaSource.timeSignature.beats}/${metaSource.timeSignature.denominator}`
    : "";
  if (!meter || !isSupportedMeter(meter)) {
    if (meter) warnings.push(tr("拍号 {meter} 暂不支持，已按 4/4 导入", { meter }));
    else warnings.push(tr("文件里没有拍号，已按 4/4 导入"));
    meter = "4/4";
  }
  const key = keySig
    ? keyFromFifths(keySig.sf, keySig.minor ? "minor" : "major")
    : { tonic: "C", mode: "major" };
  if (!keySig) warnings.push(tr("文件里没有调号，已按 C 大调导入"));
  const fittedMode = fitSupportedMode(key.mode);
  if (fittedMode.warning) warnings.push(fittedMode.warning);

  const tempo = Math.max(
    SCORE_TEMPO_MIN,
    Math.min(SCORE_TEMPO_MAX, Math.round(tempoBeats || 120)),
  );

  const fitted = fitMelodyOctaves(events, warnings);
  const snapped = snapEventDurations(fitted, warnings);
  sanitizeTies(snapped, warnings, { mark: tr("延音线") });

  const parsed = normalizeScoreData({
    schemaVersion: 1,
    title: chosen.track.name || tracks[0]?.name || tr("导入曲谱"),
    tonic: key.tonic,
    mode: fittedMode.mode,
    meter,
    tempo,
    originalTempo: tempo,
    events: snapped,
  });
  lastImportWarnings = warnings;
  return parsed;
}

// ── 曲谱 → MIDI ─────────────────────────────────────────────────────────────
// 写成格式 0（全部事件放在一条音轨里）。本工具画的就是单旋律，格式 0 正好够用，
// 而且所有播放器都能读。
function generateMidi(target) {
  const source = target || (typeof score !== "undefined" ? score : null);
  if (!source || !Array.isArray(source.events))
    throw new Error(tr("没有可导出的曲谱。"));
  const key = keySignatureFor(source.tonic || "C", source.mode || "major");
  const [meterTop, meterBottom] = String(
    isSupportedMeter(source.meter) ? source.meter : "4/4",
  )
    .split("/")
    .map(Number);
  const tempo = Math.max(
    SCORE_TEMPO_MIN,
    Math.min(SCORE_TEMPO_MAX, Math.round(source.tempo || 96)),
  );
  const microseconds = Math.round(60000000 / tempo);

  // stream 是最终要写出的字节流；source.events 才是曲谱里的音符，两者别混。
  const stream = [];
  const push = (parts) => parts.forEach((part) => stream.push(part));
  const meta = (type, data) => [0xff, type, ...midiWriteVar(data.length), ...data];
  push([0, ...meta(0x03, [...new TextEncoder().encode(source.title || tr("未命名曲谱"))])]);
  push([0, ...meta(0x51, [(microseconds >> 16) & 0xff, (microseconds >> 8) & 0xff, microseconds & 0xff])]);
  push([0, ...meta(0x58, [meterTop, Math.round(Math.log2(meterBottom)), 24, 8])]);
  push([0, ...meta(0x59, [key.count < 0 ? 256 + key.count : key.count, source.mode === "minor" ? 1 : 0])]);

  // 把音符展开成「开」「关」两件事，再按时间排序 —— MIDI 是事件流，不是音符表。
  const timeline = [];
  let tick = 0;
  source.events.forEach((event, index) => {
    const start = tick;
    const length = Math.max(1, Math.round(event.duration * MIDI_DIVISION));
    if (event.pitch != null) {
      timeline.push({ tick: start, order: 1, data: [0x90, event.pitch, 90], index });
      timeline.push({ tick: start + length, order: 0, data: [0x80, event.pitch, 40], index });
    }
    tick += length;
  });
  timeline.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let previous = 0;
  for (const item of timeline) {
    push([...midiWriteVar(item.tick - previous), ...item.data]);
    previous = item.tick;
  }
  push([0, ...meta(0x2f, [])]);

  const track = [0x4d, 0x54, 0x72, 0x6b]; // MTrk
  const length = stream.length;
  track.push((length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0, // 格式 0
    0, 1, // 一条音轨
    (MIDI_DIVISION >> 8) & 0xff, MIDI_DIVISION & 0xff,
  ];
  return new Uint8Array([...header, ...track, ...stream]);
}

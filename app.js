/* WhistleLoom — a small, local-first graphical score editor. */
const $ = (id) => document.getElementById(id);
const pcSharp = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
const pcFlat = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "G♭",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const naturalPc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 每个调式里「第几级比主音高几个半音」。混合利底亚就是把大调的第七级降下来
// （爱尔兰曲里最常见的一处变化：C 音在 D 混合利底亚里是 C 本位而不是 C♯）。
const scaleSteps = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const keyMidi = {
  C: 60,
  "C#": 61,
  Db: 61,
  D: 62,
  "D#": 63,
  Eb: 63,
  E: 64,
  F: 65,
  "F#": 66,
  Gb: 66,
  G: 67,
  "G#": 68,
  Ab: 68,
  A: 69,
  "A#": 70,
  Bb: 70,
  B: 71,
};
const whistleMidi = { D: 62, C: 60, Bb: 58, G: 55, F: 53, Eb: 51, A: 57 };
const defaults = {
  schemaVersion: 1,
  title: "爱尔兰小调",
  subtitle: "",
  composer: "",
  lyricist: "",
  arranger: "",
  sourceTonic: "",
  tonic: "D",
  mode: "major",
  meter: "4/4",
  whistleKey: "D",
  tempo: 96,
  originalTempo: 96,
  events: [
    { pitch: 62, duration: 1 },
    { pitch: 66, duration: 0.5 },
    { pitch: 67, duration: 0.5 },
    { pitch: 69, duration: 1 },
    { pitch: 71, duration: 1 },
    { pitch: 74, duration: 2 },
    { pitch: 74, duration: 1 },
    { pitch: 73, duration: 0.5 },
    { pitch: 71, duration: 0.5 },
    { pitch: 69, duration: 1 },
    { pitch: 67, duration: 1 },
    { pitch: 66, duration: 2 },
    { pitch: 69, duration: 1 },
    { pitch: 67, duration: 0.5 },
    { pitch: 66, duration: 0.5 },
    { pitch: 64, duration: 1 },
    { pitch: 62, duration: 1 },
    { pitch: 62, duration: 2 },
  ],
};
// 默认曲名（defaults.title）是数据默认值，但它会直接印在标题栏和谱面上，所以新起
// 一份默认曲谱时按当前语言取一次。曲名本身是用户数据，之后不随界面语言切换而变。
let score = structuredClone({ ...defaults, title: tr(defaults.title) }),
  selected = -1,
  audioCtx = null,
  activeOscillator = null,
  activeGain = null,
  masterGain = null,
  playbackMuted = false,
  playTimer = null,
  playing = false,
  spacePlaybackArmed = false,
  playToken = 0,
  scoreZoom = 1.2,
  playIndex = 0,
  playingIndex = -1,
  lastPlaybackSystem = null;
// lastImportWarnings 由 js/score-import.js 声明（导入边境层需要它，加载得比这里早）。
// 顶层 let 在浏览器里跨脚本共用同一片词法作用域，这里再声明一次会直接 SyntaxError、整页白屏。
const history = [JSON.stringify(score)];
let historyCursor = 0,
  storageRecoveryBlocked = false,
  storageRecoveryNoted = false;
function meterLength(meter = $("meter").value) {
  const [n, d] = (meter || "4/4").split("/").map(Number);
  return (n * 4) / d;
}
function regroup(events = score.events, meter = $("meter").value) {
  const max = meterLength(meter),
    bars = [],
    bar = [];
  let sum = 0;
  events.forEach((e, i) => {
    bar.push({ e, i });
    sum += e.duration || 1;
    if (e.barAfter || sum >= max - 0.001) {
      bars.push(bar.splice(0));
      sum = 0;
    }
  });
  if (bar.length) bars.push(bar);
  return bars;
}
// 打印 / 导出用的内容宽度：A4 横向 297mm − 左右各 10mm 页边距 − 谱面左右内边距，
// 换算成 CSS 像素约 1000px，比编辑器被侧栏挤窄的栏宽（约 620px）宽得多。
const PRINT_CONTENT_WIDTH = 1004;
// 谱面四层分别由侧栏哪个开关管，一处声明、渲染与导出共用。
const LAYER_TOGGLES = [
  ["showStaff", ".staff-layer", "五线谱"],
  ["showNumbers", ".numbers-layer", "简谱"],
  ["showLyrics", ".lyrics-layer", "歌词"],
  ["showHoles", ".holes-layer", "指法图"],
];
// 「试试示例」下拉里的五首示例曲。这里只存 key，label 是中文原文（也就是语言表里的键）——
// 「翻译」要等到选项真正进 DOM 那一刻，语言切了才刷得动。wire 与 applyLanguage 共用这一份。
const SAMPLE_OPTIONS = [
  ["aughrim", "After The Battle Of Aughrim · 传统进行曲"],
  ["wind", "山风小曲 · 歌词示例"],
  ["scale", "D 调音阶练习"],
  ["sheebeg", "Sí Bheag Sí Mhór · 奥卡罗兰慢曲（D 调哨笛）"],
  ["sallygardens", "The Sally Gardens · 爱尔兰传统曲（D 调哨笛）"],
];
// 拍号的显示名。只有 2/2 有别名（cut time），其余就用拍号本身。抽成函数是为了让
// wire 与 applyLanguage 走同一条路 —— 语言切换后 2/2 那条也得跟着变。
function meterOptionLabel(meter) {
  return meter === "2/2" ? tr("2/2（cut time）") : meter;
}
// 曲种下拉的标签是「中文名 + 英文原词」（里尔舞曲 reel）。英文界面里中文名本身就被
// 翻成同一个英文词，再拼一次会变成「reel reel」，所以只在两者不同的时候才拼后缀。
function tuneTypeOptionText(value) {
  const name = tr(TUNE_TYPE_LABELS[value]);
  return name === value ? name : `${name} ${value}`;
}
// 导入格式表与导出卡片都由 js/formats.js 的登记表生成 —— 界面里手抄一份格式列表，
// 迟早会出现「按钮上有、代码里没接」或者反过来。它们是一次性铺进 DOM 的，
// 所以抽成函数：wire 建一次，切语言时 applyLanguage 再按当前语言重建一次。
function renderImportFormatList() {
  const list = $("importFormatList");
  if (!list) return;
  list.innerHTML = "";
  for (const format of SCORE_FORMATS.filter((item) => item.import)) {
    const row = document.createElement("tr");
    row.innerHTML =
      `<th>${escapeHtml(tr(format.label))}</th>` +
      `<td><code>${format.extensions.join(" ")}</code></td>` +
      `<td>${escapeHtml(tr(format.hint))}</td>`;
    list.append(row);
  }
}
function renderExportCards() {
  const box = $("exportOptions");
  if (!box) return;
  box.innerHTML = "";
  for (const format of SCORE_FORMATS.filter((item) => item.export)) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "export-card" + (format.print ? " is-plain" : "");
    card.dataset.format = format.id;
    card.innerHTML =
      `<b>${escapeHtml(tr(format.label))}</b><small>${escapeHtml(tr(format.hint))}</small>`;
    box.append(card);
  }
}
// 「文本格式」下拉的选项也一样来自登记表：重建时保留当前选中的格式，别让切语言
// 把用户选的 ABC 悄悄换回第一项。
function renderTextFormatOptions() {
  const sel = $("textFormat");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = "";
  for (const format of SCORE_FORMATS.filter((item) => item.text)) {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = tr(format.label);
    sel.append(option);
  }
  if (current) sel.value = current;
}
// 按侧栏的图层开关给谱面四层加 / 去 .hidden。渲染与导出共用，避免两处判断不一致。
function applyLayerVisibility(view) {
  for (const [toggle, selector] of LAYER_TOGGLES)
    view
      .querySelectorAll(selector)
      .forEach((el) => el.classList.toggle("hidden", !$(toggle).checked));
}
// 导出面板下方那行小字：这次导出会带上哪几层。开关在右侧栏，用户不一定记得自己关了
// 哪一层；导出一张缺了简谱的 PDF 却不知道原因，是最容易踩的坑。
function updateExportLayersMessage() {
  const el = $("exportLayersMessage");
  if (!el) return;
  const on = LAYER_TOGGLES.filter(([toggle]) => $(toggle).checked).map(
    ([, , label]) => tr(label),
  );
  el.textContent = on.length
    ? tr("这次导出会带上：{layers}。", { layers: on.join("、") })
    : tr("四层图层现在都是关着的，导出的谱面会是空白 —— 想留下内容，请先在右侧打开至少一层。");
}
// 按指定的内容宽度把曲谱重新折行渲染。导出 / 打印都要用宽页面重新折行，
// 直接搬运编辑器窄栏的 DOM 会让每一行只装得下一个小节。
function layoutScoreInto(view, contentWidth, source = score, options = {}) {
  view.style.zoom = "1";
  // 渲染期间把「这份曲谱的调性」交给渲染层，谱面的调号 / 唱名 / 指法才会跟着
  // source 走，而不是跟着界面上正在编辑的那一份走。
  setRenderKeys(source);
  try {
    view.innerHTML = scoreSystemsMarkup(
      regroup(source.events, source.meter),
      contentWidth,
      options,
    );
  } finally {
    setRenderKeys(null);
  }
  applyLayerVisibility(view);
}
// 打印用的内容宽度。打印时纸张宽度与屏幕无关，必须显式指定，不能量 view.clientWidth。
function scoreLayoutWidth(view) {
  if (window.matchMedia?.("print").matches) return PRINT_CONTENT_WIDTH;
  return Math.max(280, (view.clientWidth || 900) / scoreZoom);
}
// 谱头那一行元信息：原调、主音与调式、拍号、速度、哨笛的调。
// 单独抽出来是因为速度会被滑杆和数字框直接改动 —— 为了改一个数字就把整份谱面
// 重排一遍（render 里还有折行、分组、四层对齐）代价太大，也没必要。
function updatePaperMeta() {
  const modeName = modeLabel($("mode").value);
  const sourceKey =
    score.sourceTonic && score.sourceTonic !== score.tonic
      ? tr("原调 {key} → ", { key: score.sourceTonic })
      : "";
  const tempo = Number(score.tempo) || 96;
  const originalTempo = Number(score.originalTempo) || tempo;
  // 带中文的两段各自是完整句子，先取出来再拼进这行模板 —— 模板本身不含中文，
  // 免得整行被当成一句「要翻译的文案」（它其实是好几样东西拼起来的标题栏）。
  const whistleKey = tr("爱尔兰哨笛 {key} 调", { key: $("whistleKey").value });
  const original = originalTempo !== tempo ? tr("（原速 {tempo} BPM）", { tempo: originalTempo }) : "";
  $("paperMeta").textContent =
    `${sourceKey}1 = ${$("tonic").value} ${modeName}   ·   ${$("meter").value}   ·   ♩=${tempo} BPM   ·   ${whistleKey}${original}`;
}
function render() {
  score.title = $("title").value || tr("未命名曲谱");
  $("paperTitle").textContent = score.title;
  updatePaperMeta();
  $("paperSubtitle").textContent = score.subtitle || "";
  const credits = [
    score.lyricist && tr("词：{name}", { name: score.lyricist }),
    score.composer && tr("曲：{name}", { name: score.composer }),
    score.arranger && tr("编配：{name}", { name: score.arranger }),
  ].filter(Boolean);
  $("paperCredits").textContent = credits.join("　·　");
  $("paperCredits").hidden = credits.length === 0;
  $("zoomReadout").textContent = `${Math.round(scoreZoom * 100)}%`;
  let bars = regroup();
  $("emptyState").hidden = score.events.length > 0;
  const view = $("scoreView");
  view.style.zoom = `${scoreZoom * 100}%`;
  if (!score.events.length) {
    view.innerHTML = "";
  } else {
    // 打印时纸张比编辑器栏宽得多，折行宽度必须按纸张算，否则整谱会挤在左边、
    // 每行只放一个小节，白白多出好几页。打印还要把音符步长撑开让各行左右齐平。
    const printing = Boolean(window.matchMedia?.("print").matches);
    setRenderKeys(score);
    try {
      view.innerHTML = scoreSystemsMarkup(bars, scoreLayoutWidth(view), {
        stretch: printing,
      });
    } finally {
      setRenderKeys(null);
    }
  }
  applyLayerVisibility(view);
  updateExportLayersMessage();
  renderConnections(view);
  updatePlayabilityNotice();
  const accessList = $("accessibleScoreList");
  accessList.innerHTML = score.events
    .map((event, index) => {
      const pitchLabel =
        event.pitch == null ? tr("休止符") : pitchText(event.pitch);
      const lyricLabel = event.lyric ? tr("，歌词 ") + event.lyric : "";
      const selectedLabel = index === selected ? tr("，已选中") : "";
      const tabStop =
        index === selected || (selected < 0 && index === 0) ? 0 : -1;
      // 两个标签各是一句完整文案（带 {index} {pitch} {duration} 占位符），
      // 歌词与「已选中」是拼在句尾的附加片段 —— 整句先取好，再 escape 一次，
      // 免得把占位符挪进字符串拼接里、拆散成认不出的碎片。
      const ariaLabel =
        tr("第 {index} 个音符，{pitch}，时值 {duration} 拍", {
          index: index + 1,
          pitch: pitchLabel,
          duration: event.duration,
        }) + lyricLabel + selectedLabel;
      const buttonLabel = tr("第 {index} 个音符 · {pitch} · {duration} 拍", {
        index: index + 1,
        pitch: pitchLabel,
        duration: event.duration,
      });
      return (
        '<button type="button" class="note-navigation-item" data-index="' +
        index +
        '" tabindex="' +
        tabStop +
        '" aria-pressed="' +
        (index === selected) +
        '" aria-label="' +
        escapeHtml(ariaLabel) +
        '">' +
        escapeHtml(buttonLabel) +
        "</button>"
      );
    })
    .join("");
  accessList.querySelectorAll(".note-navigation-item").forEach((button) => {
    button.addEventListener("click", () =>
      selectNote(Number(button.dataset.index), true),
    );
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = Math.max(
        0,
        Math.min(
          score.events.length - 1,
          Number(button.dataset.index) + (event.key === "ArrowRight" ? 1 : -1),
        ),
      );
      selectNote(next, true);
    });
  });
  syncInspector();
  let snapshot = JSON.stringify(score);
  if (history[historyCursor] !== snapshot) {
    history.splice(historyCursor + 1);
    history.push(snapshot);
    if (history.length > 60) history.shift();
    historyCursor = history.length - 1;
  }
  saveLocal();
}
// 把下拉设成给定值。如果这个值不在界面的预置列表里（例如导入了 7/8 拍号、或某个不在
// 列表里的哨笛调），先动态补一个 <option> —— 否则 <select> 找不到匹配项会静默退回第一个
// 选项：拍号会从 7/8 变成 4/4，哨笛调会从 Bb 变成 D，而用户毫无察觉。
function setSelectValue(id, value, fallback) {
  const select = $(id),
    wanted = value || fallback;
  if (!wanted) return;
  if (![...select.options].some((option) => option.value === wanted)) {
    const option = document.createElement("option");
    option.value = wanted;
    option.textContent = wanted;
    select.append(option);
  }
  select.value = wanted;
}
function setMeterField(value) {
  setSelectValue("meter", value, "4/4");
}
function syncScoreInfoFields() {
  for (const id of ["subtitle", "composer", "lyricist", "arranger", "sourceTonic"])
    $(id).value = score[id] || "";
  // 「整体移调」下拉平时显示当前调；用户把它改到想去的调，再按「转换」。
  if ($("transposeTarget")) $("transposeTarget").value = score.tonic;
}
// 把 score 同步到界面上的那一圈控件，并为这次载入重置撤销栈。
//
// 「载入示例 / 导入 ABC / 打开文件 / 从曲库载入」四条路要做的是同一串事。过去每处各抄
// 一遍，只要漏掉一句（比如忘了回填拍号下拉），界面控件就会和谱面各说各话 —— 用户看到
// 谱面是 6/8、下拉框却写着 4/4，之后再改任何一项都会把拍号真的改错。
// 所以这里收成一个函数，四条路都走它。
function applyScoreToForm() {
  if (playing) stopPlay();
  selected = -1;
  $("title").value = score.title;
  setSelectValue("tonic", score.tonic, "C");
  setSelectValue("mode", score.mode, "major");
  setMeterField(score.meter);
  setSelectValue("whistleKey", score.whistleKey, "D");
  syncTempoControls();
  syncScoreInfoFields();
  history.splice(0, history.length, JSON.stringify(score));
  historyCursor = 0;
  render();
}
function revealSelectionEditor() {
  const panel = $("sideColumn"),
    target = $("selectionEditor");
  if (
    !panel ||
    !target ||
    target.hidden ||
    panel.scrollHeight <= panel.clientHeight + 2
  )
    return;
  const p = panel.getBoundingClientRect(),
    t = target.getBoundingClientRect();
  if (t.bottom > p.bottom)
    panel.scrollBy({ top: t.bottom - p.bottom + 16, behavior: "smooth" });
  else if (t.top < p.top)
    panel.scrollBy({ top: t.top - p.top - 16, behavior: "smooth" });
}
function focusAccessibleNote(i) {
  requestAnimationFrame(() => {
    const candidates = [
      ...$("scoreView").querySelectorAll(`[data-index="${i}"]`),
      ...$("accessibleScoreList").querySelectorAll(`[data-index="${i}"]`),
    ];
    const visible = candidates.find((node) => node.getClientRects().length);
    (visible || candidates.at(-1))?.focus({ preventScroll: true });
  });
}
function selectNote(i, shouldFocus = false) {
  selected = i;
  render();
  if (shouldFocus) focusAccessibleNote(i);
  requestAnimationFrame(revealSelectionEditor);
}
function repairTies() {
  score.events.forEach((event, index) => {
    const next = score.events[index + 1];
    if (event.tieToNext && (!next || event.pitch == null || next.pitch == null || event.pitch !== next.pitch)) {
      event.tieToNext = false;
    }
  });
}
// 「新增」那块永远往选中音后面插。用户很难从界面上看出「后面」是哪儿，
// 所以这句话必须一直跟着选中状态走 —— 上面那块和下面那块改的是不同的音，
// 这里写清楚落点，是防止两块看串最直接的一句提示。
// 单独抽成一个函数：切语言时也要重刷，而那时 syncInspector 未必会走到（没选中音就直接 return）。
function updateAddTargetHint() {
  const target = $("addTargetHint");
  if (!target) return;
  const e = score.events[selected];
  target.textContent = e
    ? tr("选择音高和时值，插入到第 {index} 个音之后。", { index: selected + 1 })
    : score.events.length
      ? tr("还没有选中音符 —— 新音会加到曲末。点一下谱面上的音可以改它的位置。")
      : tr("曲谱还是空的，新音会从头排起。");
}
function syncInspector() {
  const panel = $("selectionEditor"),
    e = score.events[selected];
  panel.hidden = !e;
  updateAddTargetHint();
  if (!e) return;
  $("selectedIndex").textContent = tr("第 {index} 个音", { index: selected + 1 });
  $("editPitch").value = e.pitch ?? 62;
  $("editPitch").disabled = e.pitch == null;
  $("editDuration").value = String(e.duration);
  $("editLyric").value = e.lyric || "";
  $("editTie").checked = Boolean(e.tieToNext);
  $("editSlur").checked = Boolean(e.slurToNext);
  const next = score.events[selected + 1];
  $("editTie").disabled = !next || e.pitch == null || next.pitch == null || e.pitch !== next.pitch;
  if ($( "editTie").disabled) $("editTie").checked = false;
  $("editSlur").disabled = !next;
}
function checkpoint() {
  if (playing) stopPlay();
  history.splice(historyCursor + 1);
}
function commitHistory() {
  const snapshot = JSON.stringify(score);
  if (history[historyCursor] !== snapshot) {
    history.splice(historyCursor + 1);
    history.push(snapshot);
    if (history.length > 60) history.shift();
    historyCursor = history.length - 1;
  }
}
function stopActiveTone() {
  if (!activeOscillator) return;
  try {
    activeGain?.gain.cancelScheduledValues(audioCtx.currentTime);
    activeGain?.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.012);
    activeOscillator.stop(audioCtx.currentTime + 0.06);
  } catch (_) {}
  activeOscillator = null;
  activeGain = null;
}
function restoreHistory(dir) {
  if (playing) stopPlay();
  let next = historyCursor + dir;
  if (next < 0 || next >= history.length) return;
  historyCursor = next;
  score = JSON.parse(history[historyCursor]);
  selected = -1;
  $("title").value = score.title;
  $("tonic").value = score.tonic;
  $("mode").value = score.mode;
  setMeterField(score.meter);
  $("whistleKey").value = score.whistleKey;
  syncTempoControls();
  syncScoreInfoFields();
  render();
}
function addEvent(e) {
  checkpoint();
  const at = selected >= 0 ? selected + 1 : score.events.length;
  if (at > 0 && score.events[at - 1].tieToNext) score.events[at - 1].tieToNext = false;
  score.events.splice(at, 0, e);
  selected = at;
  render();
  requestAnimationFrame(revealSelectionEditor);
}
function deleteSelected() {
  if (selected < 0) return;
  checkpoint();
  if (selected > 0) score.events[selected - 1].tieToNext = false;
  score.events.splice(selected, 1);
  selected = score.events.length
    ? Math.min(selected, score.events.length - 1)
    : -1;
  render();
}
// 时值快捷键：W 加倍、Q 减半，与 MuseScore 的默认约定一致。
function stepDuration(direction) {
  const event = score.events[selected];
  if (!event) return;
  const target = Number(event.duration || 1) * (direction > 0 ? 2 : 0.5);
  if (!SCORE_DURATION_VALUES.some((value) => Math.abs(value - target) < 1e-6)) {
    setMessage(direction > 0 ? tr("已是支持的最长时值") : tr("已是支持的最短时值"));
    return;
  }
  checkpoint();
  event.duration = target;
  render();
  focusAccessibleNote(selected);
}
// 整首曲子移调：把每个音的音高平移 semitones 个半音，并让「简谱主音」同步平移
// 同样的距离。
//
// 为什么主音必须跟着走：简谱数字 = 音高 − 主音。两边同步平移，差值不变，所以数字
// （1 2 3…）、八度点、附点、延音、连线、歌词全都原样不动，变的只有实际音高和调名
// —— 这才是「把 C 调的曲子换成 D 调」。
//
// 反过来，只改「简谱主音」而不动音高，等于给同一批音重贴唱名标签：C 调的音会被标
// 成 D 调的唱名（冒出 ♯6、♯2 这种），谱子和实际音高就对不上了。
function transposeTo(targetTonic) {
  const from = keyMidi[score.tonic],
    to = keyMidi[targetTonic];
  if (from == null || to == null) return { ok: false, reason: "unknown" };
  // 就近走：C → B 往下降 1 个半音，而不是往上升 11 个，免得整首曲子被拽出音域。
  const semitones = transposeShift(from, to);
  const notes = score.events.filter((e) => e.pitch != null);
  if (!semitones || !notes.length) return { ok: true, semitones: 0, count: 0 };
  // 音高必须留在曲谱格式允许的 24–108 之间。越界就整体拒绝，不做改一半的修改。
  if (notes.some((e) => e.pitch + semitones < 24 || e.pitch + semitones > 108))
    return { ok: false, reason: "range" };
  checkpoint();
  for (const e of notes) e.pitch += semitones;
  // 记下原调，谱头就会显示「原调 C → 1 = D」。这正是曲谱文件里 sourceTonic 的用途。
  if (!score.sourceTonic) score.sourceTonic = score.tonic;
  score.tonic = targetTonic;
  $("tonic").value = targetTonic;
  syncScoreInfoFields();
  commitHistory();
  render();
  saveLocal();
  return { ok: true, semitones, count: notes.length };
}
function updateMeta() {
  score.tonic = $("tonic").value;
  score.mode = $("mode").value;
  score.meter = $("meter").value;
  score.whistleKey = $("whistleKey").value;
  // 曲速不在这里读：它由 applyTempo 独家负责，滑杆和数字框都从那儿过。
  // 这里再抄一遍等于给同一个字段开了第二个写入口，两边一打架就很难查。
  $("transposeTarget").value = score.tonic;
  render();
}
// 导出 / 生成文本时用的「界面上这一刻的曲谱」。大部分字段在 input 时就已经并回 score
// 了，这里只补一次标题 —— 输入法组合期间某些浏览器会延迟触发 input，不补就会把刚才
// 敲的标题漏掉，导出个旧名字的文件。
function currentScore() {
  score.title = $("title").value || tr("未命名曲谱");
  return score;
}
// 曲速数字框能输入的范围。滑杆的行程默认是 30–240，但会被原曲速度撑开；
// 数字框的范围要比滑杆宽一截 —— 否则「我要写 300」会被滑杆的刻度挡住，
// 而数字框本来就是用来跳过刻度直接给数的。
// 上下限不在这里写死：契约层的 SCORE_TEMPO_MIN/MAX 才是唯一出处。两处各写一遍曾经
// 分叉成「界面允许 400、契约只收 320」，用户在框里输 400 就会让自动存档在下次打开时
// 校验失败、被判成损坏存档整份清掉。
const TEMPO_MIN = SCORE_TEMPO_MIN;
const TEMPO_MAX = SCORE_TEMPO_MAX;
function clampTempo(value) {
  return Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, value)));
}
// 把 score.tempo 同步到滑杆和数字框上。这两个控件写的是同一个值，必须一起改。
// 滑杆的行程要同时罩住「原曲速度」和「当前速度」：导入的曲子可能记着 280 BPM，
// 数字框也可能被手输成 300。范围不撑开的话，滑块会顶在刻度的尽头装作那是 300 ——
// 显示的和实际生效的对不上，比不显示还糟。
function syncTempoControls() {
  const tempo = Number(score.tempo) || 96;
  const original = Number(score.originalTempo) || tempo;
  const slider = $("tempo");
  slider.min = String(Math.min(30, original, tempo));
  slider.max = String(Math.max(240, original, tempo));
  slider.value = String(tempo);
  $("tempoNumber").value = String(tempo);
}
// 改曲速的唯一入口：滑杆拖动、数字框输入、「原曲」按钮全走这里。
// 三个入口各改各的，就是同步 bug 的温床 —— 改一处漏两处，滑杆和数字框立刻互相矛盾。
function applyTempo(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  score.tempo = clampTempo(number);
  syncTempoControls();
  updatePaperMeta();
  saveLocal();
}
function saveLocal() {
  if (storageRecoveryBlocked) return;
  try {
    localStorage.setItem(
      "pujian-score-autosave-v2",
      JSON.stringify({ ...score, schemaVersion: SCORE_SCHEMA_VERSION }),
    );
    $("saveStatus").textContent = storageRecoveryNoted
      ? tr("已保存；损坏存档副本已保留")
      : tr("已自动保存");
    $("saveStatus").classList.remove("save-error");
  } catch (_) {
    $("saveStatus").textContent = tr("自动保存失败，请使用“保存到本机”备份");
    $("saveStatus").classList.add("save-error");
  }
}
function setMessage(msg) {
  $("formatMessage").textContent = msg;
  setTimeout(() => {
    if ($("formatMessage").textContent === msg)
      $("formatMessage").textContent = "";
  }, 2800);
}
// 谱面上方的提示条。导入 ABC / 曲谱文件 / 曲库曲目之后，「哪些地方被改过」写在这里。
// 和 setMessage 的区别：setMessage 是 ABC 面板自己的回执，面板收起时就看不到，而且
// 两秒多就消失；这条提示是用户必须看见的东西，所以不自动消失，要手动关。
function showNotice(text) {
  if (!text) return hideNotice();
  $("scoreNoticeText").textContent = text;
  $("scoreNotice").hidden = false;
}
function hideNotice() {
  $("scoreNotice").hidden = true;
  $("scoreNoticeText").textContent = "";
}
// 把导入时攒下的提示整理成一句人话，摆到谱面上方。任何一条导入路径（ABC 文本、
// 打开文件、拖放、曲库载入）载入后都走这里。
//   label  —— 「哪份曲谱、从哪来」的开头，例如「已导入《X》。」；
//   always —— 即使这次没有转换损失也要显示（曲库载入用：那是个慢动作，需要一句确认）；
// 一条提示都没有、且没要求 always 时，必须把提示条收起来 —— 否则上一次导入的提示
// 会一直挂着，用户会以为那是这一次的。
function showImportNotice(label, { always = false } = {}) {
  const detail = lastImportWarnings.length
    ? tr("这份曲谱有几处记法本编辑器表达不了，已按最接近的方式转换：{list}。", {
        list: lastImportWarnings.join(tr("；")),
      })
    : "";
  if (!detail && !always) return hideNotice();
  showNotice(detail ? `${label}${detail}` : label);
}
// 谱面上方的第二条提示：这支哨笛吹不出来的音有几个、都是什么原因。
//
// 为什么不和导入提示共用一条：两者性质不同。导入提示说的是「这次导入把哪些记法改掉了」，
// 是**一次动作的回执**，关掉就不再需要；这一条是谱面**当前状态**的写照 —— 只要谱子里
// 还有吹不出来的音，它就该一直挂着，直到换哨笛调、移调或改掉那些音才消失。
// 两种东西塞进同一条会互相顶掉，用户就分不清自己看的是哪一件事。
//
// 每次 render 都重算：它必须跟着哨笛调、跟着每一个音的增删改走。做成「事件驱动」的
// 增量维护会漏掉路径（改哨笛调、撤销、导入、音高编辑各走各的入口），迟早有一处忘记刷新。
function updatePlayabilityNotice() {
  const panel = $("playabilityNotice");
  const text = $("playabilityNoticeText");
  if (!panel || !text) return;
  const counts = { low: 0, high: 0, noFingering: 0 };
  // 判定要用**这份曲谱的**哨笛调，不能靠界面上那个下拉框 —— 导出、打印渲染的可能
  // 不是当前正在编辑的那一份。渲染上下文是 render() 的通用约定，这里跟着用。
  setRenderKeys(score);
  try {
    for (const event of score.events) {
      if (event.pitch == null) continue;
      const issue = fingering(event.pitch).issue;
      if (issue) counts[issue] += 1;
    }
  } finally {
    setRenderKeys(null);
  }
  const total = counts.low + counts.high + counts.noFingering;
  if (!total) {
    panel.hidden = true;
    text.textContent = "";
    return;
  }
  // 分类计数按原因拼成「低音 2 个、无指法 1 个」。顿号也走 tr()：中英标点不同，
  // 写死中文顿号在英文界面里会很扎眼。
  const parts = [];
  if (counts.low) parts.push(tr("低音 {n} 个", { n: counts.low }));
  if (counts.high) parts.push(tr("高音 {n} 个", { n: counts.high }));
  if (counts.noFingering) parts.push(tr("无指法 {n} 个", { n: counts.noFingering }));
  // 整句交给 tr()，包括那对括号：英文里括号前后要留空格，拼在 JS 里就调不动了。
  text.textContent = tr(
    "这支哨笛吹不出 {count} 个音（{list}），已在谱面上标红。试试换一支哨笛，或用「整体移调」把这个调换掉。",
    { count: total, list: parts.join(tr("、")) },
  );
  panel.hidden = false;
}
function loadSample(key) {
  let src = sampleAbc[key];
  if (!src) return;
  parseAbc(src);
  // 示例曲一律按 D 调哨笛给：这批曲子本来就是按 D 调哨笛编的，沿用界面上
  // 上一次选的哨笛调会让指法图和示例对不上。
  score.whistleKey = "D";
  applyScoreToForm();
  hideNotice();
  setMessage(tr("示例曲已载入，点击音符试试编辑"));
}
function fillPitchSelect(sel) {
  sel.innerHTML = "";
  for (let m = 48; m <= 86; m++) {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = pitchText(m);
    sel.appendChild(o);
  }
}
const DURATION_LABELS = {
  0.125: "三十二分音符",
  0.25: "十六分音符",
  0.375: "附点十六分音符",
  0.5: "八分音符",
  0.75: "附点八分音符",
  1: "四分音符",
  1.5: "附点四分音符",
  2: "二分音符",
  3: "附点二分音符",
  4: "全音符",
  6: "附点全音符",
  8: "倍全音符",
};
// 时值下拉直接由曲谱契约的时值表生成，这样快捷键改出的时值在选项里一定存在，
// 侧栏不会出现「空白时值」。
function fillDurationSelect(sel, selectedValue = 1) {
  sel.innerHTML = SCORE_DURATION_VALUES.map(
    (value) =>
      '<option value="' +
      value +
      '"' +
      (Math.abs(value - selectedValue) < 1e-6 ? " selected" : "") +
      ">" +
      // 时值清单在 score-model.js，中文名在这张表里。万一以后加了新的时值而忘了
      // 补名字，退成「x 拍」也还能看，总比在界面上印一个 undefined 强。
      // tr 写在「进界面」这一刻（不是在 DURATION_LABELS 定义处）—— 语言可以运行时切换。
      tr(DURATION_LABELS[value] || tr("{value} 拍", { value })) +
      "</option>",
  ).join("");
}

function wire() {
  fillPitchSelect($("newPitch"));
  fillPitchSelect($("editPitch"));
  fillDurationSelect($("newDuration"), 1);
  fillDurationSelect($("editDuration"), 1);
  // 「简谱主音」和「整体移调」共用同一份调名清单，保证两边的调名永远对得上。
  for (const n of [
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
  ])
    for (const sel of [$("tonic"), $("transposeTarget")]) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      sel.append(o);
    }
  // 调式下拉只列编辑器真正支持的四种（名单在 score-model.js 的 SCORE_MODES），
  // 中文名统一取自 music.js 的 MODE_LABELS —— 界面里不再手抄第三份。
  for (const mode of SCORE_MODES) {
    const o = document.createElement("option");
    o.value = mode;
    o.textContent = modeLabel(mode);
    $("mode").append(o);
  }
  // 拍号下拉同样来自 score-model.js 的 SCORE_METER_PRESETS。那份清单过去没人读，
  // 是死代码，而界面里另抄了一份 —— 改一处漏一处的经典结构。
  // 必须在下面的 setMeterField() 之前填好：否则 setMeterField 会先把当前拍号
  // 临时补成一个选项，接下来的循环又补一遍，下拉里就出现两个「4/4」。
  for (const meter of SCORE_METER_PRESETS) {
    const option = document.createElement("option");
    option.value = meter;
    option.textContent = meterOptionLabel(meter);
    $("meter").append(option);
  }
  // 曲库的曲种筛选下拉由 tune-source.js 的清单生成，界面里不再手抄一份。
  // 第一项「全部曲种」（value 为空）写在 HTML 里 —— 它代表「不筛选」，必须在，
  // 否则默认值会落在第一项上，检索结果被悄悄限制成某一种曲种。
  for (const { value } of TUNE_TYPE_FILTERS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = tuneTypeOptionText(value);
    $("tuneType").append(option);
  }
  for (const [id, label] of SAMPLE_OPTIONS) {
    let o = document.createElement("option");
    o.value = id;
    o.textContent = tr(label);
    $("sampleSelect").append(o);
  }
  $("title").value = score.title;
  $("tonic").value = score.tonic;
  $("mode").value = score.mode;
  setMeterField(score.meter);
  $("whistleKey").value = score.whistleKey;
  syncTempoControls();
  syncScoreInfoFields();
  $("newPitch").value = "62";
  let titleBefore = score.title;
  $("title").addEventListener("focus", () => {
    titleBefore = $("title").value;
  });
  $("title").addEventListener("input", () => {
    score.title = $("title").value || tr("未命名曲谱");
    $("paperTitle").textContent = score.title;
    saveLocal();
  });
  $("title").addEventListener("change", () => {
    if (titleBefore !== score.title) {
      checkpoint();
      render();
    }
  });
  for (const id of ["subtitle", "composer", "lyricist", "arranger", "sourceTonic"]) {
    const field = $(id);
    field.addEventListener("focus", checkpoint);
    field.addEventListener("input", () => {
      score[id] = field.value;
      render();
      saveLocal();
    });
    field.addEventListener("change", commitHistory);
  }
  ["tonic", "mode", "meter", "whistleKey"].forEach((id) =>
    $(id).addEventListener("change", () => {
      checkpoint();
      updateMeta();
    }),
  );
  $("applyTranspose").addEventListener("click", () => {
    const target = $("transposeTarget").value,
      result = transposeTo(target);
    if (!result.ok)
      return setMessage(
        result.reason === "range"
          ? tr("移到 {target} 会把音高推出可用音域（C1–C8），请先调整音区或换个方向。", { target })
          : tr("无法移到 {target}。", { target }),
      );
    setMessage(
      result.semitones
        ? tr("已整曲移调 {shift} 个半音，共 {count} 个音；现在 1 = {target}。", {
            shift: (result.semitones > 0 ? "+" : "") + result.semitones,
            count: result.count,
            target,
          })
        : tr("已经在目标调上，没有需要改动的音。"),
    );
  });
  $("tempo").addEventListener("input", () => applyTempo($("tempo").value));
  // 数字框只在「输入的东西已经是个合法值」时才落地。
  // 输入过程中会短暂出现 ""、"1"、"10" 这类半截内容，这时候若按 clamp 强行收成
  // 下限，用户想敲 108，"1" 一进框就被改写成 20，光标位置也跟着乱跳 —— 完全没法用。
  $("tempoNumber").addEventListener("input", () => {
    const raw = $("tempoNumber").value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < TEMPO_MIN) return;
    applyTempo(value);
  });
  // 离开输入框（或按回车）时做一次规整：空值、超上限、小数全都收回来并写回框里。
  // 走完这一步，框里显示的一定就是真正生效的那个数，不会出现「框里 500、实际 400」。
  $("tempoNumber").addEventListener("change", () => {
    const raw = $("tempoNumber").value.trim();
    if (!raw) return applyTempo(score.tempo);
    const value = Number(raw);
    applyTempo(Number.isFinite(value) ? value : score.tempo);
  });
  $("originalTempo").addEventListener("click", () => {
    applyTempo(Number(score.originalTempo) || 96);
    // 原曲速度和「原速 xx BPM」是同一个数的两种说法，点完它就该自洽：
    // 谱头那行会自己把「（原速 …）」收掉。
  });
  ["showStaff", "showNumbers", "showLyrics", "showHoles"].forEach((id) =>
    $(id).addEventListener("change", render),
  );
  const addFromForm = () =>
    addEvent({
      pitch: Number($("newPitch").value),
      duration: Number($("newDuration").value),
    });
  $("addNote").addEventListener("click", addFromForm);
  $("toolbarAdd").addEventListener("click", () =>
    addEvent({
      pitch: Number($("newPitch").value),
      duration: Number($("toolbarDuration").value),
    }),
  );
  $("toolbarRest").addEventListener("click", () =>
    addEvent({ pitch: null, duration: Number($("toolbarDuration").value) }),
  );
  $("addRest").addEventListener("click", () =>
    addEvent({ pitch: null, duration: Number($("newDuration").value) }),
  );
  $("deleteNote").addEventListener("click", deleteSelected);
  $("editPitch").addEventListener("change", (e) => {
    if (score.events[selected]) {
      checkpoint();
      score.events[selected].pitch = Number(e.target.value);
      repairTies();
    }
    render();
  });
  $("editDuration").addEventListener("change", (e) => {
    if (score.events[selected]) {
      checkpoint();
      score.events[selected].duration = Number(e.target.value);
    }
    render();
  });
  for (const [id, property] of [["editTie", "tieToNext"], ["editSlur", "slurToNext"]]) {
    $(id).addEventListener("change", (event) => {
      const current = score.events[selected];
      if (!current) return;
      checkpoint();
      current[property] = event.target.checked;
      try {
        score = normalizeScoreData(score);
        commitHistory();
        render();
      } catch (error) {
        current[property] = false;
        setMessage(error.message);
        syncInspector();
      }
    });
  }
  let lyricBefore = "";
  $("editLyric").addEventListener("focus", () => {
    lyricBefore = $("editLyric").value;
  });
  $("editLyric").addEventListener("input", (e) => {
    const ev = score.events[selected];
    if (!ev) return;
    ev.lyric = e.target.value;
    document.querySelectorAll(".lyrics-layer .event-cell").forEach((cell) => {
      if (Number(cell.dataset.index) === selected) {
        const label = cell.querySelector(".lyric-value");
        if (label) label.textContent = e.target.value;
      }
    });
    saveLocal();
  });
  $("editLyric").addEventListener("change", (e) => {
    if (score.events[selected] && lyricBefore !== e.target.value) {
      checkpoint();
      commitHistory();
    }
  });
  document.querySelectorAll(".degree-pad button").forEach((b) =>
    b.addEventListener("click", () => {
      let octaveDelta =
          Math.floor(Number($("newPitch").value) / 12) -
          Math.floor(tonicMidi() / 12),
        steps = scaleSteps[$("mode").value] || scaleSteps.major,
        pitch =
          tonicMidi() + steps[Number(b.dataset.degree) - 1] + 12 * octaveDelta;
      $("newPitch").value = String(Math.max(48, Math.min(86, pitch)));
      addFromForm();
    }),
  );
  $("undoButton").addEventListener("click", () => restoreHistory(-1));
  $("redoButton").addEventListener("click", () => restoreHistory(1));
  $("zoomOut").addEventListener("click", () => {
    scoreZoom = Math.max(0.8, scoreZoom - 0.1);
    render();
  });
  $("zoomIn").addEventListener("click", () => {
    scoreZoom = Math.min(1.8, scoreZoom + 0.1);
    render();
  });
  $("loadSample").addEventListener("click", () => {
    let k = $("sampleSelect").value;
    if (k) loadSample(k);
  });
  $("newScore").addEventListener("click", () => {
    checkpoint();
    score = { ...structuredClone(defaults), title: tr("未命名曲谱"), events: [] };
    applyScoreToForm();
    hideNotice();
  });
  $("saveScore").addEventListener("click", async () => {
    try {
      setMessage((await exportScoreWith("json", currentScore())) || tr("已保存曲谱文件"));
    } catch (error) {
      setMessage(error.message || tr("保存失败"));
    }
  });

  // ── 导入 / 导出面板 ────────────────────────────────────────────────────────
  // 面板上的格式清单全部由 js/formats.js 的登记表生成。界面里手抄一份格式列表，
  // 迟早会出现「按钮上有、代码里没接」或者反过来。
  function showIoTab(tab) {
    const importing = tab !== "export";
    $("ioTabImport").setAttribute("aria-selected", String(importing));
    $("ioTabExport").setAttribute("aria-selected", String(!importing));
    $("ioPaneImport").hidden = !importing;
    $("ioPaneExport").hidden = importing;
  }
  $("ioTabImport").addEventListener("click", () => showIoTab("import"));
  $("ioTabExport").addEventListener("click", () => showIoTab("export"));
  $("openImport").addEventListener("click", () => {
    showIoTab("import");
    $("ioDialog").showModal();
  });
  $("openExport").addEventListener("click", () => {
    showIoTab("export");
    updateExportLayersMessage();
    $("ioDialog").showModal();
  });
  // 文件选择框能选哪些后缀，同样来自登记表。
  $("openFile").accept = importAcceptAttribute();
  // 导入格式表与导出卡片都由登记表生成（重建函数在模块层，切语言时 applyLanguage 也走它）。
  renderImportFormatList();
  renderExportCards();
  $("exportOptions").addEventListener("click", async (event) => {
    const card = event.target.closest(".export-card");
    if (!card) return;
    const id = card.dataset.format,
      status = $("exportStatus");
    card.disabled = true;
    status.textContent = id === "print" ? tr("正在准备打印…") : tr("正在排版并生成文件…");
    try {
      const message = await exportScoreWith(id, structuredClone(score), {
        paper: document.querySelector(".score-paper"),
        print: () => {
          $("ioDialog").close();
          printScore();
        },
      });
      status.textContent = message
        ? message +
          (formatById(id)?.reversible
            ? tr("。之后可以通过导入还原并继续编辑。")
            : "")
        : "";
    } catch (error) {
      status.textContent = error.message || tr("导出失败。");
    } finally {
      card.disabled = false;
    }
  });

  // 打开一个文件：交给格式登记表分流（扩展名优先、内容兜底）。
  async function openScoreFile(file) {
    if (!file) return;
    try {
      const parsed = await importScoreFromFile(file);
      if (parsed) score = parsed;
      applyScoreToForm();
      showImportNotice(tr("已导入《{title}》。", { title: score.title }));
      setMessage(tr("已导入 {name}", { name: file.name }));
      if ($("ioDialog").open) $("ioDialog").close();
    } catch (error) {
      const reason = error.message || tr("文件格式不正确");
      setMessage(tr("无法打开 {name}：{reason}", { name: file.name, reason }));
      showNotice(tr("打不开「{name}」：{reason}", { name: file.name, reason }));
    }
  }
  $("openFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await openScoreFile(file);
  });
  // 拖放到页面任意位置就能导入。这是最省事的一条路：不必先打开面板、再找按钮。
  // dragenter/dragleave 会随子元素反复触发，所以用一个计数器挡住抖动。
  let dragDepth = 0;
  const carriesFiles = (event) =>
    [...(event.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    document.body.classList.add("is-dropping");
  });
  document.addEventListener("dragover", (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove("is-dropping");
  });
  document.addEventListener("drop", async (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("is-dropping");
    await openScoreFile(event.dataTransfer.files?.[0]);
  });

  // ── 文本格式面板（ABC · MusicXML）─────────────────────────────────────────
  const TEXT_FORMATS = SCORE_FORMATS.filter((format) => format.text);
  renderTextFormatOptions();
  const currentTextFormat = () =>
    formatById($("textFormat").value) || TEXT_FORMATS[0];
  $("refreshText").addEventListener("click", () => {
    const format = currentTextFormat();
    $("scoreText").value = format.export(currentScore()).data;
    setMessage(tr("已生成当前曲谱的 {format}", { format: tr(format.label) }));
  });
  $("copyText").addEventListener("click", async () => {
    const format = currentTextFormat();
    if (!$("scoreText").value.trim())
      $("scoreText").value = format.export(currentScore()).data;
    try {
      await navigator.clipboard.writeText($("scoreText").value);
      setMessage(tr("已复制到剪贴板"));
    } catch (_) {
      $("scoreText").select();
      setMessage(tr("已选中文本，按 Ctrl+C 复制"));
    }
  });
  $("loadText").addEventListener("click", () => {
    const format = currentTextFormat();
    try {
      // 面板手里只有一段字符串：像 MusicXML 这种「文件导入要字节」的格式，走它自己的
      // importText 通道；没写这条通道的（ABC、JSON）用同一份 import 就行。
      const reader = format.importText || format.import;
      score = reader({
        file: null,
        name: tr("{format} 文本", { format: tr(format.label) }),
        text: $("scoreText").value,
      });
      applyScoreToForm();
      showImportNotice(tr("{format} 已载入。", { format: tr(format.label) }));
      setMessage(tr("{format} 已载入，可以继续图形化编辑", { format: tr(format.label) }));
    } catch (error) {
      setMessage(error.message || tr("无法读取这段文本"));
    }
  });
  $("textFormat").addEventListener("change", () => {
    $("scoreText").value = "";
    setMessage("");
  });
  $("fitScore").addEventListener("click", () => {
    scoreZoom = 1;
    $("scoreView").scrollTo({ left: 0, behavior: "smooth" });
    render();
    document
      .querySelector(".score-paper")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("playButton").addEventListener("click", () =>
    playing ? pausePlay() : startPlay(),
  );
  $("muteButton").addEventListener("click", togglePlaybackMute);
  $("stopButton").addEventListener("click", stopPlay);
  $("scoreView").addEventListener("click", (event) => {
    const note = event.target.closest(".score-note, .event-cell");
    if (note) selectNote(Number(note.dataset.index), true);
  });
  $("scoreView").addEventListener("keydown", (event) => {
    const note = event.target.closest(".score-note, .event-cell");
    if (note && event.key === "Enter") {
      event.preventDefault();
      selectNote(Number(note.dataset.index), true);
    }
  });
  window.addEventListener("resize", () => {
    clearTimeout(window._scoreResize);
    window._scoreResize = setTimeout(render, 100);
  });
  // 「普通打印」走浏览器自己的打印流程。两件事必须在打印前处理：
  // ① 浏览器用 document.title 作为「打印成 PDF」的建议文件名，所以要临时换成曲名；
  // ② 按纸张宽度重新折行（编辑器被侧栏挤到约 620px，纸张有约 1000px），否则整谱会
  //    挤在左边、每行只放一个小节，白白多出好几页。
  // 点击时就同步改好，不赌 beforeprint 的触发时机；事件里再兜一层（Ctrl+P 走那条路）。
  let printLayoutActive = false,
    titleBeforePrint = "";
  function enterPrintLayout() {
    if (printLayoutActive) return;
    printLayoutActive = true;
    titleBeforePrint = document.title;
    document.title =
      String(score.title || tr("未命名曲谱")).trim() || tr("未命名曲谱");
    layoutScoreInto($("scoreView"), PRINT_CONTENT_WIDTH, score, {
      stretch: true,
    });
  }
  function leavePrintLayout() {
    if (!printLayoutActive) return;
    printLayoutActive = false;
    if (titleBeforePrint) document.title = titleBeforePrint;
    titleBeforePrint = "";
    render();
  }
  function printScore() {
    enterPrintLayout();
    window.print();
  }
  window.addEventListener("beforeprint", enterPrintLayout);
  window.addEventListener("afterprint", leavePrintLayout);
  window
    .matchMedia("print")
    .addEventListener?.("change", (event) =>
      event.matches ? enterPrintLayout() : leavePrintLayout(),
    );
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.("#scoreView, #accessibleScoreList"))
      spacePlaybackArmed = false;
  });
  document.addEventListener("focusin", (event) => {
    if (!event.target.closest?.("#scoreView, #accessibleScoreList"))
      spacePlaybackArmed = false;
  });
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement,
      typing = active.matches?.("input, textarea, select, [contenteditable='true']"),
      scoreFocus = Boolean(active.closest?.("#scoreView, #accessibleScoreList")),
      mod = e.ctrlKey || e.metaKey;
    if (typing) return;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      $("saveScore").click();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      restoreHistory(e.shiftKey ? 1 : -1);
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      restoreHistory(1);
      return;
    }
    if (mod && ["+", "=", "Add"].includes(e.key)) {
      e.preventDefault();
      scoreZoom = Math.min(1.8, scoreZoom + 0.1);
      render();
      return;
    }
    if (mod && ["-", "_", "Subtract"].includes(e.key)) {
      e.preventDefault();
      scoreZoom = Math.max(0.8, scoreZoom - 0.1);
      render();
      return;
    }
    const isSpace = e.code === "Space" || e.key === " ";
    if (isSpace && (scoreFocus || spacePlaybackArmed)) {
      e.preventDefault();
      if (playing) pausePlay();
      else {
        startPlay();
        spacePlaybackArmed = playing;
      }
      return;
    }
    if (selected < 0 && active.matches?.(".note-navigation-item, .score-note, .event-cell"))
      selected = Number(active.dataset.index);
    if (selected < 0) return;
    if (!mod && (e.key === "w" || e.key === "W" || e.key === "q" || e.key === "Q")) {
      e.preventDefault();
      stepDuration(e.key === "w" || e.key === "W" ? 1 : -1);
      return;
    }
    if (scoreFocus && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      selectNote(Math.max(0, Math.min(score.events.length - 1, selected + (e.key === "ArrowRight" ? 1 : -1))), true);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!scoreFocus) return;
      e.preventDefault();
      let n = score.events[selected];
      if (n.pitch != null) {
        checkpoint();
        n.pitch = Math.max(
          24,
          Math.min(108, n.pitch + (e.key === "ArrowUp" ? 1 : -1)),
        );
        repairTies();
        render();
        focusAccessibleNote(selected);
      }
    }
    if (scoreFocus && (e.key === "Delete" || e.key === "Backspace")) deleteSelected();
  });
  render();
}
try {
  const current = localStorage.getItem("pujian-score-autosave-v2");
  const legacy = current ? null : localStorage.getItem("pujian-score-v1");
  const saved = current || legacy;
  if (saved) {
    score = importJson(JSON.parse(saved));
    history[0] = JSON.stringify(score);
    if (legacy) saveLocal();
  }
} catch (error) {
  try {
    const raw =
      localStorage.getItem("pujian-score-autosave-v2") ||
      localStorage.getItem("pujian-score-v1");
    if (raw) localStorage.setItem("pujian-score-recovery-v1", raw);
    storageRecoveryNoted = Boolean(raw);
    $("saveStatus").textContent = tr("自动存档损坏，原始数据已备份");
  } catch (_) {
    storageRecoveryBlocked = true;
    $("saveStatus").textContent = tr("自动保存不可用，请使用“保存到本机”备份");
  }
}
/* ── 公共曲库 ────────────────────────────────────────────────────────────────
   数据访问全在 js/tune-source.js 里（在线接口、离线兜底、ABC 拼装），这里只管：
   把结果画成列表、把用户点中的那首交给 parseAbc + applyScoreToForm。
   面板默认收起，第一次展开时先摆一份离线曲目 —— 不发请求、秒开，也顺带说明
   「不联网也有东西可用」这件事。 */
let tuneState = { page: 1, pages: 1, loaded: false, busy: false };
function setTuneStatus(text) {
  $("tuneStatus").textContent = text || "";
}
// 列表里每一条的副标题。在线结果只有曲种，离线结果还带着调名和拍号。
function tuneMetaText(tune) {
  return [
    tune.type ? tuneTypeLabel(tune.type) : "",
    tune.key || "",
    tune.meter || "",
    tune.tempo ? `♩=${tune.tempo}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function renderTuneList(result) {
  const list = $("tuneList");
  list.innerHTML = "";
  if (!result.tunes.length) {
    const li = document.createElement("li");
    li.className = "tune-empty";
    li.textContent =
      result.source === "offline"
        ? tr("内置曲库里没有匹配的曲目。联网后搜索可以查到 thesession.org 全部两万多首。")
        : tr("没有找到匹配的曲目，换个关键词或曲种再试。");
    list.append(li);
    return;
  }
  for (const tune of result.tunes) {
    const item = document.createElement("li"),
      button = document.createElement("button");
    button.type = "button";
    button.className = "tune-item";
    const name = document.createElement("b");
    name.textContent = tune.name;
    const meta = document.createElement("small");
    meta.textContent = tuneMetaText(tune);
    button.append(name, meta);
    // 曲调对象（含离线曲目的 abc 正文）留在闭包里，不必往 dataset 上塞字符串。
    button.addEventListener("click", () => loadTuneIntoEditor(tune, button));
    item.append(button);
    list.append(item);
  }
}
function renderTuneResult(result, statusText) {
  tuneState.page = result.page;
  tuneState.pages = result.pages;
  tuneState.loaded = true;
  renderTuneList(result);
  setTuneStatus(statusText);
  $("tunePageBtn").disabled = result.page >= result.pages;
}
async function runTuneSearch(page = 1) {
  if (tuneState.busy) return;
  tuneState.busy = true;
  $("tuneSearchBtn").disabled = true;
  $("tunePageBtn").disabled = true;
  setTuneStatus(tr("正在检索"));
  try {
    const result = await searchTunes({
      query: $("tuneQuery").value.trim(),
      type: $("tuneType").value,
      page,
    });
    renderTuneResult(
      result,
      result.source === "online"
        ? tr("在线命中 {total} 首 · 第 {page}/{pages} 页", {
            total: result.total,
            page: result.page,
            pages: result.pages,
          })
        : tr("离线曲库 {total} 首（{reason}）", {
            total: result.total,
            reason: result.reason,
          }),
    );
  } catch (error) {
    setTuneStatus(error.message || tr("检索失败。"));
  } finally {
    tuneState.busy = false;
    $("tuneSearchBtn").disabled = false;
  }
}
async function showOfflineLibrary() {
  const result = await searchTunes({ offline: true, page: 1 });
  renderTuneResult(
    result,
    tr("离线曲库 {total} 首 · 点「搜索」联网查全部", { total: result.total }),
  );
}
async function loadTuneIntoEditor(tune, button) {
  // 取谱例要等一个来回，这段时间把整列按钮锁住 —— 连点两首会让两份曲谱的解析
  // 交错写进同一个 score，最后留下谁的就不一定了。
  const buttons = [...$("tuneList").querySelectorAll(".tune-item")];
  buttons.forEach((node) => (node.disabled = true));
  button.classList.add("is-loading");
  setTuneStatus(tr("正在取《{name}》…", { name: tune.name }));
  try {
    const abc = await loadTune(tune);
    if (!abc) throw new Error(tr("这首曲子在曲库里没有可用的谱例。"));
    parseAbc(abc);
    applyScoreToForm();
    // 曲库里的谱例是别人手抄的，转成本编辑器的记法时难免有取舍，必须让用户看见。
    // 载入是个慢动作，所以没有取舍时也留一句确认（always），让用户知道点中了哪首。
    showImportNotice(tr("已载入《{name}》。", { name: tune.name }), { always: true });
    setTuneStatus(tr("已载入《{name}》", { name: tune.name }));
  } catch (error) {
    setTuneStatus(error.message || tr("载入失败，请重试。"));
  } finally {
    buttons.forEach((node) => (node.disabled = false));
    button.classList.remove("is-loading");
  }
}
function wireTuneLibrary() {
  $("tuneCard").addEventListener("toggle", () => {
    if ($("tuneCard").open && !tuneState.loaded) showOfflineLibrary();
  });
  $("tuneSearchBtn").addEventListener("click", () => runTuneSearch(1));
  $("tunePageBtn").addEventListener("click", () => {
    if (!tuneState.loaded || tuneState.page >= tuneState.pages) return;
    runTuneSearch(tuneState.page + 1);
  });
  $("tuneQuery").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runTuneSearch(1);
    }
  });
  $("tunePageBtn").disabled = true;
  $("scoreNoticeClose").addEventListener("click", hideNotice);
}
// 语言切换器：语言名用它自己的语言写（中文 / English），所以选项文字不翻译。
function wireLanguage() {
  const sel = $("langSelect");
  if (!sel) return;
  for (const { code, label } of I18N_LANGS) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    sel.append(option);
  }
  sel.value = i18nLang();
  sel.addEventListener("change", () => {
    i18nSetLang(sel.value);
    applyLanguage();
  });
}
// 把「脚本生成、不会自己跟着语言变」的文案按当前语言重刷一遍。
// 打了静态标记（data-i18n*）的部分由 i18nSetLang → i18nApply 负责；这里只管
// 下拉选项、导出卡片、状态行这些由 JS 拼出来的东西 —— 它们没有标记，切了语言也不会动。
function applyLanguage() {
  // 时值下拉：选项文字来自 score-model.js 的时值表，重建时保留当前选中值。
  fillDurationSelect($("newDuration"), Number($("newDuration").value));
  fillDurationSelect($("editDuration"), Number($("editDuration").value));
  // 拍号下拉：只有 2/2 带 cut time 别名，其余就是拍号本身。
  for (const option of $("meter").options)
    option.textContent = meterOptionLabel(option.value);
  // 示例下拉：保留各 option 的 value，只改文字；第一项「选择一首示例曲」由静态标记负责。
  for (const option of $("sampleSelect").options) {
    const found = SAMPLE_OPTIONS.find(([id]) => id === option.value);
    if (found) option.textContent = tr(found[1]);
  }
  // 曲种筛选：第一项「全部曲种」（value 为空）是 HTML 里的，跳过。
  for (const option of $("tuneType").options)
    if (option.value) option.textContent = tuneTypeOptionText(option.value);
  renderTextFormatOptions();
  renderImportFormatList();
  renderExportCards();
  updateAddTargetHint();
  updatePaperMeta();
  syncInspector();
  updateExportLayersMessage();
  // 播放区：按钮文字、提示与状态行都是脚本写的，按当前播放 / 静音状态重写。
  const mute = $("muteButton");
  mute.textContent = playbackMuted ? tr("♪ 静音") : tr("♪ 有声");
  mute.setAttribute(
    "aria-label",
    playbackMuted ? tr("切换为有声播放") : tr("切换为静音播放"),
  );
  mute.title = playbackMuted
    ? tr("当前为静音播放；播放进度与谱面跟随仍正常")
    : tr("当前为有声播放");
  $("playStatus").textContent = playing
    ? playbackMuted
      ? tr("静音播放中")
      : tr("正在播放")
    : tr("准备演奏");
  if (playing)
    $("position").textContent = tr("音符 {index} / {total}", {
      index: playingIndex + 1,
      total: score.events.length,
    });
  // 保存状态：只在它还停在「自动保存就绪」这句**占位**文案时才重写。已经有别的状态
  // （已自动保存 / 保存失败…）就别覆盖 —— 那是真实的当前状态，下次保存会自己带上新语言。
  // 判据要同时认中文和当前语言两种写法：切到英文后这句已经变成英文，只认中文的话
  // 再切回中文时就会卡在英文上（i18nApply 不管它，因为它在 HTML 里就没打标记）。
  const ready = new Set(["自动保存就绪", tr("自动保存就绪")]);
  if (ready.has($("saveStatus").textContent.trim()))
    $("saveStatus").textContent = tr("自动保存就绪");
}
i18nPrepare(); // 先把静态文案的原文登记下来（必须在任何脚本改动 DOM 之前）
i18nApply(); // 按当前语言先写一遍，免得英文用户先看到中文
wireLanguage();
wireTuneLibrary();
wire();
applyLanguage(); // 再刷一遍脚本生成的那部分

/* Playback has its own playhead; editing selection remains independent. */
function startPlay() {
  if (!score.events.length) return;
  if (playIndex >= score.events.length) playIndex = 0;
  playing = true;
  playToken++;
  const token = playToken;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume().catch(() => {});
    if (!masterGain) {
      masterGain = audioCtx.createGain();
      masterGain.gain.value = playbackMuted ? 0 : 1;
      masterGain.connect(audioCtx.destination);
    }
  } catch (_) {
    $("playStatus").textContent = tr("此浏览器不支持播放");
    playing = false;
    return;
  }
  $("playButton").textContent = "Ⅱ";
  $("playButton").setAttribute("aria-label", tr("暂停"));
  $("playStatus").textContent = playbackMuted ? tr("静音播放中") : tr("正在播放");
  const playNext = () => {
    if (!playing || token !== playToken) return;
    if (playIndex >= score.events.length) {
      stopPlay();
      return;
    }
    const i = playIndex,
      ev = score.events[i],
      secs = Math.max(
        0.05,
        ((ev.duration || 1) * 60) / (Number(score.tempo) || 96),
      ),
      tiedFromPrevious = Boolean(
        i > 0 && score.events[i - 1].tieToNext &&
        score.events[i - 1].pitch != null && score.events[i - 1].pitch === ev.pitch &&
        activeOscillator,
      );
    playingIndex = i;
    render();
    $("position").textContent = tr("音符 {index} / {total}", {
      index: i + 1,
      total: score.events.length,
    });
    requestAnimationFrame(() => {
      const target = $("scoreView").querySelector(".event-cell.playing");
      const system = target?.closest(".score-system"),
        row = system
          ? [...$("scoreView").querySelectorAll(".score-system")].indexOf(
              system,
            )
          : -1;
      if (system && row !== lastPlaybackSystem) {
        system.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
        lastPlaybackSystem = row;
      }
    });
    if (ev.pitch != null && !tiedFromPrevious) {
      activeOscillator = audioCtx.createOscillator();
      activeGain = audioCtx.createGain();
      activeOscillator.type = "sine";
      activeOscillator.frequency.value =
        440 * Math.pow(2, (ev.pitch - 69) / 12);
      activeGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      activeGain.gain.exponentialRampToValueAtTime(
        0.12,
        audioCtx.currentTime + 0.025,
      );
      activeGain.gain.setTargetAtTime(
        0.0001,
        audioCtx.currentTime + Math.max(0.04, secs - 0.04),
        0.035,
      );
      activeOscillator.connect(activeGain).connect(masterGain);
      const oscillator = activeOscillator;
      oscillator.onended = () => {
        if (activeOscillator === oscillator) {
          activeOscillator = null;
          activeGain = null;
        }
      };
      activeOscillator.start();
      let tiedDuration = ev.duration || 1;
      for (let next = i; score.events[next]?.tieToNext; next++) {
        const following = score.events[next + 1];
        if (!following || following.pitch !== ev.pitch) break;
        tiedDuration += following.duration || 1;
      }
      activeOscillator.stop(
        audioCtx.currentTime + Math.max(secs, (tiedDuration * 60) / (Number(score.tempo) || 96)) + 0.04,
      );
    }
    playTimer = setTimeout(() => {
      if (token !== playToken) return;
      playIndex = i + 1;
      playNext();
    }, secs * 1000);
  };
  playNext();
}
function togglePlaybackMute() {
  playbackMuted = !playbackMuted;
  const button = $("muteButton");
  button.textContent = playbackMuted ? tr("♪ 静音") : tr("♪ 有声");
  button.setAttribute("aria-pressed", String(playbackMuted));
  button.setAttribute("aria-label", playbackMuted ? tr("切换为有声播放") : tr("切换为静音播放"));
  button.title = playbackMuted ? tr("当前为静音播放；播放进度与谱面跟随仍正常") : tr("当前为有声播放");
  button.classList.toggle("is-muted", playbackMuted);
  if (masterGain && audioCtx && audioCtx.state !== "closed") {
    const now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(playbackMuted ? 0 : 1, now + 0.015);
  }
  if (playing) $("playStatus").textContent = playbackMuted ? tr("静音播放中") : tr("正在播放");
}
function pausePlay() {
  playing = false;
  playToken++;
  clearTimeout(playTimer);
  stopActiveTone();
  $("playButton").textContent = "▶";
  $("playButton").setAttribute("aria-label", tr("继续播放"));
  $("playStatus").textContent = tr("已暂停");
}
function stopPlay() {
  playing = false;
  spacePlaybackArmed = false;
  playToken++;
  clearTimeout(playTimer);
  stopActiveTone();
  playIndex = 0;
  playingIndex = -1;
  lastPlaybackSystem = null;
  $("playButton").textContent = "▶";
  $("playButton").setAttribute("aria-label", tr("播放"));
  $("playStatus").textContent = tr("准备演奏");
  $("position").textContent = "—";
  render();
}

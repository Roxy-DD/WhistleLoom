// 一个音符在谱面上占的横向步长。编辑器用基础值即可；导出会用同一批音符
// 把这个步长整体撑大，让每行的左右边缘都顶到纸面宽度（制谱上的「横向撑满」）。
const NOTE_CELL = 52;
// 撑开的幅度上限。撑得太多音符之间会空旷到读不出节奏分组，制谱惯例大约到 1.5 倍为止。
const MAX_CELL_STRETCH = 1.5;
function notationPitchLabel(midi) {
  const note = spellScoreMidi(midi);
  return `${note.name || note.letter + note.acc}${note.oct ?? ""}`;
}
function noteSvg(
  entry,
  slot,
  noteStartX = 29,
  accState = {},
  beamed = false,
  cell = NOTE_CELL,
) {
  const { e } = entry,
    // slot 是**格号**而不是音符序号：长音自己就占好几格，后面那个音的起点得
    // 让开它占的地方，五线谱的符头才会落在简谱数字正上方那一列。
    x = noteStartX + slot * cell,
    y = e.pitch == null ? 41 : noteY(e.pitch),
    label = tr("第 {index} 个音符，{pitch}，时值 {duration} 拍", {
      index: entry.i + 1,
      // 「休止符」也是要翻的界面词，和音符名一样进语言表。
      pitch: e.pitch == null ? tr("休止符") : notationPitchLabel(e.pitch),
      duration: e.duration,
    }),
    access = `tabindex="${entry.i === selected || (selected < 0 && entry.i === 0) ? 0 : -1}" role="button" aria-label="${escapeHtml(label)}" aria-pressed="${entry.i === selected}"`;
  if (e.pitch == null) {
    const rest =
      e.duration >= 4
        ? "𝄻"
        : e.duration >= 2
          ? "𝄼"
          : e.duration <= 0.125
            ? "𝅀"
            : e.duration <= 0.25
              ? "𝄿"
              : e.duration <= 0.5
                ? "𝄾"
                : "𝄽";
    return (
      '<g class="score-note ' +
      ((entry.i === selected ? "selected " : "") +
        (entry.i === playingIndex ? "playing" : "")) +
      '" data-index="' +
      entry.i +
      '" ' +
      access +
      '"><text class="rest-mark" x="' +
      (x - 6) +
      '" y="' +
      (y + 6) +
      '">' +
      rest +
      "</text>" +
      ([0.375, 0.75, 1.5, 3, 6].some((d) => Math.abs(e.duration - d) < 0.001)
        ? `<circle cx="${x + 6}" cy="${y + 1}" r="1.7" fill="#303930"/>`
        : "") +
      "</g>"
    );
  }
  const s = spellScoreMidi(e.pitch),
    filled = e.duration < 2,
    stemDown = typeof beamed === "object" ? beamed.stemDown : y < 40,
    stemX = stemDown ? x - 6 : x + 6,
    stemEnd = y + (stemDown ? 27 : -27);
  let bits = "";
  if (e.duration < 4) {
    bits +=
      '<path class="stem" d="M' +
      stemX +
      " " +
      y +
      "v" +
      (stemDown ? 27 : -27) +
      '"/>';
    if (e.duration < 1 && !beamed) {
      bits +=
        '<path class="flag" d="M' +
        stemX +
        " " +
        stemEnd +
        "q" +
        (stemDown ? -12 : 12) +
        " " +
        (stemDown ? 6 : -6) +
        " " +
        (stemDown ? -3 : 3) +
        " " +
        (stemDown ? -14 : 14) +
        '"/>';
      if (e.duration <= 0.25)
        bits +=
          '<path class="flag" d="M' +
          stemX +
          " " +
          (stemEnd + (stemDown ? 7 : -7)) +
          "q" +
          (stemDown ? -10 : 10) +
          " " +
          (stemDown ? 5 : -5) +
          " " +
          (stemDown ? -3 : 3) +
          " " +
          (stemDown ? -12 : 12) +
          '"/>';
      if (e.duration <= 0.125)
        bits +=
          '<path class="flag" d="M' +
          stemX +
          " " +
          (stemEnd + (stemDown ? 14 : -14)) +
          "q" +
          (stemDown ? -9 : 9) +
          " " +
          (stemDown ? 5 : -5) +
          " " +
          (stemDown ? -3 : 3) +
          " " +
          (stemDown ? -11 : 11) +
          '"/>';
    }
  }
  let ledger = "";
  if (y >= 70)
    for (let ly = 70; ly <= y; ly += 10)
      ledger +=
        '<line class="ledger-line" x1="' +
        (x - 9) +
        '" y1="' +
        ly +
        '" x2="' +
        (x + 9) +
        '" y2="' +
        ly +
        '"/>';
  if (y <= 10)
    for (let ly = 10; ly >= y; ly -= 10)
      ledger +=
        '<line class="ledger-line" x1="' +
        (x - 9) +
        '" y1="' +
        ly +
        '" x2="' +
        (x + 9) +
        '" y2="' +
        ly +
        '"/>';
  const alteration = s.acc === "♯" ? 1 : s.acc === "♭" ? -1 : 0,
    expected = accState[s.letter] ?? keySignature().map[s.letter] ?? 0;
  let sign =
    alteration === expected
      ? ""
      : alteration === 0
        ? "♮"
        : alteration > 0
          ? "♯"
          : "♭";
  accState[s.letter] = alteration;
  const accidental = sign
    ? '<text class="accidental" x="' +
      (x - 18) +
      '" y="' +
      (y + 5) +
      '">' +
      sign +
      "</text>"
    : "";
  return (
    '<g class="score-note ' +
    (entry.i === selected ? "selected" : "") +
    '" data-index="' +
    entry.i +
    '" ' +
    access +
    '">' +
    ledger +
    accidental +
    '<ellipse class="notehead ' +
    (filled ? "" : "open") +
    '" cx="' +
    x +
    '" cy="' +
    y +
    '" rx="6.1" ry="4.4" transform="rotate(-18 ' +
    x +
    " " +
    y +
    ')"/>' +
    bits +
    ([0.375, 0.75, 1.5, 3, 6].some((d) => Math.abs(e.duration - d) < 0.001)
      ? '<circle cx="' + (x + 10) + '" cy="' + y + '" r="1.7" fill="#303930"/>'
      : "") +
    "</g>"
  );
}
// Short notes are grouped inside the beat they occupy. In compound meters the
// dotted quarter is the beat; in simple meters the denominator defines it.
// Beams and 减时线 share this grouping so the two layers never disagree.
//
// 「音值组合法」对休止符的要求与五线谱相反：五线谱的符杠不跨休止符，而简谱的
// 减时线要把休止符连进去（休止符被两端的符尾「包在其中」）。所以这里用
// includeRests 把两个视图的差异隔离出来，五线谱视图保持默认值。
function rhythmGroups(entries, meter = $("meter").value, options = {}) {
  const includeRests = options.includeRests === true;
  const [numerator, denominator] = meter.split("/").map(Number);
  const compound = denominator === 8 && numerator >= 6 && numerator % 3 === 0;
  const beat = compound ? 1.5 : 4 / denominator;
  const groups = [];
  let current = null,
    onset = 0;
  entries.forEach(({ e }, localIndex) => {
    const duration = Number(e.duration || 1);
    const rest = e.pitch == null;
    const beatStart = Math.floor((onset + 1e-6) / beat);
    const beatEnd = Math.floor((onset + duration - 1e-6) / beat);
    const withinOneBeat =
      (includeRests || !rest) && duration < 1 && beatStart === beatEnd;
    if (!withinOneBeat) current = null;
    else {
      if (!current || current.beat !== beatStart) {
        current = { beat: beatStart, items: [] };
        groups.push(current);
      }
      current.items.push({ localIndex, duration });
    }
    onset += duration;
  });
  return groups;
}
function beamGroups(entries, meter = $("meter").value) {
  return rhythmGroups(entries, meter)
    .filter((group) => group.items.length > 1)
    .map((group) =>
      group.items.map((item) => ({
        entry: entries[item.localIndex],
        localIndex: item.localIndex,
        duration: item.duration,
      })),
    );
}
// 简谱减时线层数：八分音符 1 条，十六分音符 2 条，三十二分音符 3 条。
// 附点只延长时值，不增加线数（附点八分音符仍是一条线）。
function underlineCount(duration) {
  return duration < 1
    ? Math.max(1, Math.ceil(Math.log2(1 / duration) - 0.000001))
    : 0;
}
// 一个音符与它的增时线。简谱的长音写成「数字 + 若干条横线」，每条横线延长一拍。
// 增时线不是画在数字旁边的小尾巴 —— 它在谱面上占**独立一格**，和数字同宽，
// 所以这里的 marks 要同时供两处使用：
//   ① 决定这个音符在横向网格里占几格（durationSlots）；
//   ② 决定简谱要吐出几条横线。
// 两边各算一遍就会各错一遍（八拍写了七条线、网格却只让一格），所以只留这一个源头。
function durationExtension(e) {
  const duration = Number(e.duration || 1),
    dotted = [0.375, 0.75, 1.5, 3, 6].some(
      (d) => Math.abs(duration - d) < 0.001,
    ),
    // 附点全音符记作「全音符 + 附点」，不再继续叠加增时线。
    beats = dotted ? duration / 1.5 : duration;
  return {
    dotted,
    marks: beats >= 4 ? Math.floor(beats) - 1 : beats >= 2 ? 1 : 0,
  };
}
// 这个音符在横向网格里占几格：数字自己一格，增时线每条一格。
// 二分音符 2 格、全音符 4 格、倍全音符 8 格；附点不额外占格（附点是贴在数字
// 右下的小点，通行简谱里它从不单独占位）。
function durationSlots(e) {
  return 1 + durationExtension(e).marks;
}
function beamSvg(groups, noteStartX, cell = NOTE_CELL, slotOf = null) {
  return groups.map((group) => {
    const ys = group.map(({ entry }) => noteY(entry.e.pitch));
    const stemDown = ys.reduce((sum, y) => sum + y, 0) / ys.length < 40;
    const points = group.map(({ localIndex }, index) => {
      // 符杠的起止要落在音符**占的格子**上，不是音符序号上 —— 两者只有在
      // 全是单格音符时才相等。同组里的音符时值都 < 1，本来就各占一格，
      // 但 slotOf 让这条规则不依赖那个巧合。
      const slot = slotOf ? slotOf[localIndex] : localIndex,
        x = noteStartX + slot * cell + (stemDown ? -6 : 6);
      const y = noteY(group[index].entry.e.pitch) + (stemDown ? 27 : -27);
      return { x, y };
    });
    const first = points[0], last = points.at(-1);
    const pathAt = (x) => first.y + (last.y - first.y) * ((x - first.x) / (last.x - first.x || 1));
    const polygon = (a, b, gap, thickness) => {
      const y1 = pathAt(a.x) + gap, y2 = pathAt(b.x) + gap;
      return `<path class="beam" d="M${a.x} ${y1}L${b.x} ${y2}L${b.x} ${y2 + thickness}L${a.x} ${y1 + thickness}Z"/>`;
    };
    let markup = polygon(first, last, 0, stemDown ? -4 : 4);
    // Secondary and tertiary beams are grouped when possible; isolated short
    // values receive the conventional inward hook instead of a dangling flag.
    for (const [, threshold, gap] of [[2, 0.25, 6], [3, 0.125, 11]]) {
      let run = [];
      const paintRun = () => {
        if (!run.length) return;
        let a, b;
        if (run.length > 1) {
          a = points[run[0]];
          b = points[run.at(-1)];
        } else {
          const index = run[0], point = points[index];
          const right = index === 0 || (index < group.length - 1 && index < (group.length - 1) / 2);
          const end = { x: point.x + (right ? 11 : -11), y: pathAt(point.x + (right ? 11 : -11)) };
          a = right ? point : end;
          b = right ? end : point;
        }
        markup += polygon(a, b, stemDown ? -gap : gap, stemDown ? -3 : 3);
        run = [];
      };
      group.forEach((note, index) => {
        if (note.duration <= threshold) run.push(index);
        else paintRun();
      });
      paintRun();
    }
    return markup;
  }).join("");
}
function eventCellAccess(e, i) {
  // 音符描述与「，歌词 …」是两条独立的键：不是每个音符都带歌词，带着的那截单独拼。
  const label =
    tr("第 {index} 个音符，{pitch}，时值 {duration} 拍", {
      index: i + 1,
      pitch: e.pitch == null ? tr("休止符") : notationPitchLabel(e.pitch),
      duration: e.duration,
    }) + (e.lyric ? tr("，歌词 ") + e.lyric : "");
  return `tabindex="${i === selected || (selected < 0 && i === 0) ? 0 : -1}" role="button" aria-label="${escapeHtml(label)}" aria-pressed="${i === selected}"`;
}
// 把延音线 / 连奏线画成覆盖层。
//
// 它必须知道**是哪份曲谱**，不能去读 app.js 的那个全局 score —— 导出与打印渲染的
// 未必是当前正在编辑的那一份（导出走 cleanClone，传进来的就是待导出的那份）。
// 早先写死 score.events，等于把「渲染层」和「编辑器当前状态」又绑回一起。
//
// 返回画出的曲线条数。调用方（导出）要靠它判断这一步到底有没有生效 ——
// 元素还没进文档时 getBoundingClientRect 全是 0，早先的写法会静默 continue、
// 一条线都不画也不报错，于是导出的图里「延音线凭空消失」而没有任何提示。
function renderConnections(view, events = score.events) {
  const scale = view.clientWidth ? view.getBoundingClientRect().width / view.clientWidth : 1;
  const systems = [...view.querySelectorAll(".score-system")];
  const systemByEvent = new Map();
  systems.forEach((system, systemIndex) => {
    for (const cell of system.querySelectorAll(".numbers-layer .event-cell"))
      systemByEvent.set(cell.dataset.index, systemIndex);
  });
  let drawn = 0;
  for (const [systemIndex, system] of systems.entries()) {
    // 先清掉上一轮画的线：render() 会被反复调用（改歌词、切图层、缩放），
    // 不清就会一层叠一层，旧线的位置还停在旧的折行结果上。
    system.querySelectorAll(":scope > .connection-overlay").forEach((n) => n.remove());
    const systemRect = system.getBoundingClientRect();
    const width = Math.ceil(system.scrollWidth), height = Math.ceil(system.scrollHeight);
    if (!width || !height) continue;
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("class", "connection-overlay");
    overlay.setAttribute("width", width);
    overlay.setAttribute("height", height);
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const noteHeads = new Map([...system.querySelectorAll(".staff-layer .score-note .notehead")].map((head) => [head.closest(".score-note").dataset.index, head]));
    const numberNotes = new Map([...system.querySelectorAll(".numbers-layer .event-cell .number-value")].map((label) => [label.closest(".event-cell").dataset.index, label]));
    for (let index = 0; index + 1 < events.length; index++) {
      const event = events[index], next = events[index + 1];
      const type = event.tieToNext && event.pitch === next.pitch
        ? "tie"
        : event.slurToNext ? "slur" : "";
      if (!type) continue;
      const addArc = (startNode, endNode, cssClass, above, edge = "") => {
        if (!startNode && !endNode) return;
        const start = startNode?.getBoundingClientRect();
        const end = endNode?.getBoundingClientRect();
        const anchor = start || end;
        const startX = start
          ? (start.left + start.width / 2 - systemRect.left) / scale
          : Math.max(4, (end.left + end.width / 2 - systemRect.left) / scale - 18);
        const endX = end
          ? (end.left + end.width / 2 - systemRect.left) / scale
          : width - 5;
        const x1 = startX, x2 = endX;
        let y1 = ((above ? anchor.top : anchor.top + anchor.height / 2) - systemRect.top) / scale;
        let y2 = y1;
        if (start && end) {
          y2 = ((above ? end.top : end.top + end.height / 2) - systemRect.top) / scale;
        } else if (edge === "right") {
          y2 += 3;
        } else {
          y1 += 3;
        }
        const peak = Math.min(y1, y2) - (above ? 13 : 10);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", cssClass);
        path.setAttribute("d", `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${((x1 + x2) / 2).toFixed(1)} ${peak.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
        overlay.append(path);
        drawn += 1;
      };
      const startKey = String(index), endKey = String(index + 1);
      const startSystem = systemByEvent.get(startKey), endSystem = systemByEvent.get(endKey);
      if (startSystem === systemIndex && endSystem === systemIndex) {
        addArc(noteHeads.get(startKey), noteHeads.get(endKey), `${type}-curve`, true);
        addArc(numberNotes.get(startKey), numberNotes.get(endKey), `${type}-curve`, true);
      } else if (startSystem === systemIndex && endSystem === systemIndex + 1) {
        addArc(noteHeads.get(startKey), null, `${type}-curve`, true, "right");
        addArc(numberNotes.get(startKey), null, `${type}-curve`, true, "right");
      } else if (endSystem === systemIndex && startSystem === systemIndex - 1) {
        addArc(null, noteHeads.get(endKey), `${type}-curve`, true, "left");
        addArc(null, numberNotes.get(endKey), `${type}-curve`, true, "left");
      }
    }
    if (overlay.childNodes.length) system.append(overlay);
  }
  return drawn;
}
function staffLayoutForSystem(system) {
  const needsArc = system.some(({ bar }) => bar.some(({ e }) => e.tieToNext || e.slurToNext));
  const ys = system.flatMap(({ bar }) =>
      bar.filter(({ e }) => e.pitch != null).map(({ e }) => noteY(e.pitch)),
    ),
    minY = ys.length ? Math.min(...ys) : 20,
    maxY = ys.length ? Math.max(...ys) + 8 : 76,
    topOffset = Math.max(0, (needsArc ? 28 : 10) - minY);
  return { topOffset, height: Math.max(76, maxY + topOffset) };
}
// 谱头（谱号 + 调号 + 拍号）占用的宽度。升降号字形约 15px 宽，相邻调号间要留
// 15px 才不会叠在一起；分行时用同一个值，首小节才不会被谱头挤出可视宽度。
function staffHeaderWidth() {
  return 28 + Math.abs(keySignature().count) * 15;
}
// 一个小节在给定步长下占的宽度。折行预算、撑满计算、实际渲染三处必须用同一个
// 公式，否则算出来的行宽和画出来的行宽会对不上。
function measureWidth(entryCount, cell = NOTE_CELL, systemStart = false) {
  return Math.max(
    145,
    45 + entryCount * cell + (systemStart ? staffHeaderWidth() : 0),
  );
}
function rowWidth(entryCounts, cell, systemStart) {
  return (
    entryCounts.reduce(
      (sum, count, index) =>
        sum + measureWidth(count, cell, systemStart && index === 0),
      0,
    ) +
    Math.max(0, entryCounts.length - 1) * 16
  );
}
// 一个小节占几格。折行预算、撑满计算、实际渲染三处都得用格数而不是音符个数，
// 否则「四个音的全音符小节」会被按四个音算宽、实际却要八个格才画得下增时线。
function barSlots(bar) {
  return bar.reduce((sum, entry) => sum + durationSlots(entry.e), 0);
}
// 把一行的音符步长撑开，让行宽正好铺满内容宽度（制谱的「横向撑满」）。
// 撑开幅度限制在 MAX_CELL_STRETCH 以内：撑太狠会把节奏分组读乱。
function stretchedCell(entryCounts, contentWidth, systemStart) {
  const notes = entryCounts.reduce((sum, count) => sum + count, 0),
    gaps = Math.max(0, entryCounts.length - 1) * 16,
    fixed = 45 * entryCounts.length + gaps,
    header = systemStart ? staffHeaderWidth() : 0,
    wanted = (contentWidth - fixed - header) / Math.max(1, notes);
  let cell = Math.min(Math.max(wanted, NOTE_CELL), NOTE_CELL * MAX_CELL_STRETCH);
  // 音符很少的小节会被 145px 的最小宽度顶住，按公式算的行宽可能反而超出内容宽度，
  // 这时逐步往回收，保证不溢出。
  while (
    cell > NOTE_CELL &&
    rowWidth(entryCounts, cell, systemStart) > contentWidth
  )
    cell = Math.max(NOTE_CELL, cell - 1);
  return cell;
}
// 把小节按目标内容宽度折行成谱行。
// 关键约束：谱号 / 调号 / 拍号只画在每行的第一个小节上，所以「一行放几个小节」
// 必须在渲染阶段决定 —— 不能先按编辑器的窄栏渲染完，再把 DOM 挪到宽页面上，
// 那样每行都只有一个带谱头的小节，导出会既浪费纸张又整片挤在左边。
function systemRows(bars, contentWidth, options = {}) {
  const stretch = options.stretch === true,
    rows = [];
  let row = [],
    used = 0;
  const flush = () => {
    if (!row.length) return;
    const counts = row.map(({ bar }) => barSlots(bar)),
      cell = stretch ? stretchedCell(counts, contentWidth, true) : NOTE_CELL;
    rows.push({ items: row, cell, width: rowWidth(counts, cell, true) });
    row = [];
    used = 0;
  };
  bars.forEach((bar, index) => {
    const baseW = measureWidth(barSlots(bar), NOTE_CELL, row.length === 0);
    if (row.length && used + 16 + baseW > contentWidth) flush();
    // 每行的第一个小节额外容纳谱头，否则首小节会被谱头挤出可视宽度。
    const placed = measureWidth(barSlots(bar), NOTE_CELL, row.length === 0);
    row.push({ bar, index });
    used += (row.length > 1 ? 16 : 0) + placed;
  });
  flush();
  return rows;
}
function scoreSystemsMarkup(bars, contentWidth, options = {}) {
  const rows = systemRows(bars, contentWidth, options);
  return rows
    .map((row) => {
      // 同一行的所有小节共用一份纵向布局，谱线高度才对得齐。
      const staffLayout = staffLayoutForSystem(row.items);
      // 撑满成功后行宽就等于内容宽度，此时两端对齐只是把误差抹平；只有被
      // MAX_CELL_STRETCH 卡住、确实撑不满的行才需要区别对待 —— 强行两端对齐
      // 会把寥寥几个小节扯得中间全是缝。
      const short = row.width < contentWidth * 0.92;
      const alone = rows.length === 1;
      // 整曲只有一行时居中（左右都没有可对齐的对象）；多行时末行左对齐，
      // 让左边缘和上面几行对齐 —— 通行制谱法就是这么处理末行的。
      const align = short ? (alone ? " centered" : " ragged") : "";
      return (
        '<div class="score-system' +
        align +
        '">' +
        row.items
          .map(({ bar, index }, position) =>
            renderMeasure(
              bar,
              index + 1,
              position === 0,
              staffLayout,
              row.cell,
            ),
          )
          .join("") +
        "</div>"
      );
    })
    .join("");
}
function renderMeasure(
  entries,
  measureNo,
  systemStart = false,
  staffLayout = null,
  cell = NOTE_CELL,
) {
  // 先把每个音符落在第几格算出来。长音自己占好几格（数字 1 格 + 增时线每条 1 格），
  // 后面的音符必须让开这一段 —— 否则二分音符之后的那个音会跑到「数字正下方」，
  // 而它的增时线正压在那里。总格数同时决定小节宽度。
  const slotOf = [];
  let totalSlots = 0;
  for (const entry of entries) {
    slotOf.push(totalSlots);
    totalSlots += durationSlots(entry.e);
  }
  const sig = keySignature(),
    keyCount = Math.abs(sig.count),
    // 谱头排布依制谱惯例：谱号 → 调号 → 拍号 依次紧排，谱头与第一个音符之间
    // 留一段适度空隙（MuseScore 的 Clef/key signature to first note ≈ 1.3 个行距）。
    noteStartX = systemStart ? 29 + staffHeaderWidth() : 29,
    accState = {},
    width = measureWidth(totalSlots, cell, systemStart),
    beams = beamGroups(entries),
    beamedNotes = new Map(beams.flatMap((group) => {
      const stemDown = group.reduce((sum, item) => sum + noteY(item.entry.e.pitch), 0) / group.length < 40;
      return group.map((item) => [item.localIndex, { stemDown }]);
    })),
    noteMarkup = entries
      .map((entry, i) =>
        noteSvg(entry, slotOf[i], noteStartX, accState, beamedNotes.get(i) || false, cell),
      )
      .join("") + beamSvg(beams, noteStartX, cell, slotOf),
    layout = staffLayout || staffLayoutForSystem([{ bar: entries }]),
    topOffset = layout.topOffset,
    height = layout.height;
  let staff = "";
  for (let y = 20; y <= 60; y += 10)
    staff +=
      '<line class="staff-line" x1="6" y1="' +
      (y + topOffset) +
      '" x2="' +
      (width - 6) +
      '" y2="' +
      (y + topOffset) +
      '"/>';
  let header = "";
  if (systemStart) {
    header += '<text class="clef" x="4" y="' + (54 + topOffset) + '">𝄞</text>';
    const sharpY = { F: 20, C: 35, G: 15, D: 30, A: 45, E: 25, B: 40 },
      flatY = { B: 40, E: 25, A: 45, D: 30, G: 50, C: 35, F: 55 },
      glyph = sig.count < 0 ? "♭" : "♯",
      positions = sig.count < 0 ? flatY : sharpY,
      letters = sig.order.slice(0, keyCount);
    header += letters
      .map(
        (letter, i) =>
          '<text class="key-text" x="' +
          (28 + i * 15) +
          '" y="' +
          (positions[letter] + topOffset) +
          '">' +
          glyph +
          "</text>",
      )
      .join("");
    const timeX = 32 + letters.length * 15;
    header +=
      '<text class="meter-text" x="' +
      timeX +
      '" y="' +
      (34 + topOffset) +
      '">' +
      $("meter").value.split("/")[0] +
      '</text><text class="meter-text" x="' +
      timeX +
      '" y="' +
      (48 + topOffset) +
      '">' +
      $("meter").value.split("/")[1] +
      "</text>";
  }
  const svg =
    '<svg class="measure-svg staff-layer" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    " " +
    height +
    '" aria-label="' +
    escapeHtml(tr("第 {index} 小节五线谱", { index: measureNo })) +
    '">' +
    staff +
    "<g>" +
    header +
    '</g><g transform="translate(0 ' +
    topOffset +
    ')">' +
    noteMarkup +
    "</g></svg>";
  // 简谱减时线按「音值组合法」绘制：同一拍内的短音符与休止符共用减时线。第一条
  // 线横跨整组（休止符被「包在其中」），第二、三条线只覆盖组内时值足够短的片段，
  // 遇到更长的音符或休止符就断开 —— 与五线谱的主符杠、次级符杠规则一一对应。
  // 每条线绘制在它所属片段的第一个单元格内，从数字左缘开始按单元格宽度向右延伸。
  // 减时线画在它所属片段的第一个单元格里。单元格宽度现在是可变的（撑满时会从
  // 52px 涨到 78px），所以下笔的位置也得跟着走：从「单元格中心往左 8px」起笔，
  // 一条覆盖 span+1 个音符的线宽 = span*cell + 16，正好从本音中心 -8 画到末音中心 +8。
  const UNDERLINE_INSET = cell / 2 - 8;
  const underlineRuns = new Map();
  const covered = new Set();
  const addRun = (from, span, level) => {
    if (!underlineRuns.has(from)) underlineRuns.set(from, []);
    underlineRuns.get(from).push({ level, width: span * cell + 16 });
  };
  rhythmGroups(entries, undefined, { includeRests: true }).forEach((group) => {
    for (let level = 1; level <= 3; level++) {
      let run = [];
      const flushRun = () => {
        if (!run.length) return;
        // 用小节内的位置换算成谱面用的全局索引，单元格渲染时才查得到。
        const from = entries[run[0].localIndex].i;
        const span = entries[run[run.length - 1].localIndex].i - from;
        addRun(from, span, level);
        run.forEach((item) =>
          covered.add(entries[item.localIndex].i + ":" + level),
        );
        run = [];
      };
      group.items.forEach((item) => {
        if (underlineCount(item.duration) >= level) run.push(item);
        else flushRun();
      });
      flushRun();
    }
  });
  // 兜底：没被任何连写片段覆盖的短时值（跨拍的附点音符、孤立的长短混合休止符等）
  // 各自画自己的线，保证任何 duration < 1 的音符或休止符都至少有一条减时线。
  entries.forEach(({ e, i }) => {
    if (Number(e.duration || 1) >= 1) return;
    for (let level = 1; level <= underlineCount(e.duration); level++)
      if (!covered.has(i + ":" + level)) addRun(i, 0, level);
  });
  // 四层共用同一串**等宽格子**：一个音符占几格就吐几个 .event-cell。
  // 第 1 格是数字 / 歌词 / 指法本身，后面 (格数 − 1) 格是增时线的位置。
  //
  // 为什么不是「一个超宽容器里摆一条数字 + 几条横线」：那样每层都得自己算
  // 横线的落点，四层迟早对不齐；拆成等宽格子之后，对齐是布局的自然结果。
  // 延长格仍带 data-index（点它也能选中那个音），但 aria-hidden —— 屏幕阅读器
  // 已从数字格知道时值，不必把同一条信息念八遍，也不该多占 7 个 Tab 位。
  const cellClass = (i) =>
    "event-cell " +
    (i === selected ? "active " : "") +
    (i === playingIndex ? "playing" : "");
  const extensionCells = (count, i) =>
    Array.from(
      { length: count },
      () =>
        '<span class="' +
        cellClass(i) +
        ' event-extension" data-index="' +
        i +
        '" aria-hidden="true"></span>',
    ).join("");
  let cells = entries
    .map(({ e, i }) => {
      // 简谱的休止符记作「0」（通行记谱法），不用中文「休」。
      const n = e.pitch == null ? "0" : solfege(e.pitch),
        { dotted, marks: longMarks } = durationExtension(e),
        // 减时线仍然画在数字那一格里 —— 短音符从不带增时线，两者不会同时出现。
        marks = (underlineRuns.get(i) || [])
          .map(
            (run) =>
              '<i class="duration-mark line-' +
              run.level +
              '" style="left:' +
              UNDERLINE_INSET +
              "px;width:" +
              run.width +
              'px"></i>',
          )
          .join("");
      return (
        '<span class="' +
        cellClass(i) +
        '" data-index="' +
        i +
        '" ' +
        eventCellAccess(e, i) +
        '>' +
        '<span class="number-value">' +
        n +
        (dotted ? '<i class="duration-dot"></i>' : "") +
        "</span>" +
        marks +
        "</span>" +
        // 增时线：每条横线各占一格，和数字一样宽。
        Array.from(
          { length: longMarks },
          () =>
            '<span class="' +
            cellClass(i) +
            ' event-extension" data-index="' +
            i +
            '" aria-hidden="true"><span class="duration-extension">—</span></span>',
        ).join("")
      );
    })
    .join("");
  let lyrics = entries
    .map(({ e, i }) => {
      const span = durationSlots(e) - 1;
      return (
        '<span class="' +
        cellClass(i) +
        '" data-index="' +
        i +
        '" ' +
        eventCellAccess(e, i) +
        '>' +
        '<span class="lyric-value">' +
        escapeHtml(e.lyric || "") +
        "</span></span>" +
        extensionCells(span, i)
      );
    })
    .join("");
  let holes = entries
    .map(({ e, i }) => {
      const span = durationSlots(e) - 1;
      return (
        '<span class="' +
        cellClass(i) +
        '" data-index="' +
        i +
        '" ' +
        eventCellAccess(e, i) +
        '>' +
        holeSvg(e.pitch) +
        "</span>" +
        extensionCells(span, i)
      );
    })
    .join("");
  // 五线谱、简谱、歌词、指法四层必须落在同一横坐标上。五线谱的第一个音符
  // 中心固定在 noteStartX，单元格宽度为 cell、内容居中于 cell/2，所以各层的
  // 起点要挪到 noteStartX - cell/2，首音才会落在同一列。
  //
  // 这里用的是 margin-left 而不是 padding-left：步长撑到 70px 以上时
  // noteStartX - cell/2 会变成负数（首格要先往左探出一点，数字才压得住符头），
  // 而 padding 不接受负值，负 padding 会被浏览器整条忽略、四层当场错位。
  // cell 同时以 --note-cell 传给 CSS 的 .event-cell，四层共用同一根尺子，撑满
  // 纸面时才不会越往后偏得越多。
  const layerInset = noteStartX - cell / 2;
  return (
    '<section class="measure" style="--note-cell:' +
    cell +
    'px"><div class="measure-label">' +
    String(measureNo).padStart(2, "0") +
    "</div>" +
    svg +
    '<div class="numbers-layer" style="margin-left:' +
    layerInset +
    'px">' +
    cells +
    '</div><div class="lyrics-layer" style="margin-left:' +
    layerInset +
    'px">' +
    lyrics +
    '</div><div class="holes-layer" style="margin-left:' +
    layerInset +
    'px">' +
    holes +
    "</div></section>"
  );
}

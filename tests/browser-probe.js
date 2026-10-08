/* 真浏览器探针：在页面上下文里跑一遍导入 / 导出的双向通路，把结果拼成一段 JSON 文本。
 * 用 agent-browser 的 eval --stdin 执行。只读不改（只会往编辑器里载入示例曲谱）。
 * 每一步失败都记下来继续往下走，最后一次性列出。 */
(async () => {
  const r = { ok: [], fail: [], info: {} };
  const step = async (name, fn) => {
    try {
      const v = await fn();
      r.ok.push(`${name}: ${v === undefined ? "ok" : v}`);
    } catch (e) {
      r.fail.push(`${name}: ${e && e.message ? e.message : String(e)}`);
    }
  };
  const has = (n) => new Function(`return typeof ${n}`)();

  await step("load-errors", () => {
    const e = window.__errs || [];
    if (e.length) throw new Error(e.join(" | "));
    return "无加载期错误";
  });

  // 语言选择会写进 localStorage，而探针反复跑时跑的是同一个浏览器配置 ——
  // 上一次要是停在英文，这一轮开头所有断言中文的正则都会莫名其妙地失败。
  // 所以先复位成中文，后面的断言才是在「源语言」上跑的。
  await step("language-baseline", () => {
    const leftover = localStorage.getItem("whistleloom.lang");
    const sel = document.getElementById("langSelect");
    if (!sel) throw new Error("顶栏没有语言切换器");
    if (i18nLang() !== "zh") {
      sel.value = "zh";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return leftover ? `上次留下的语言标记「${leftover}」，已复位为中文` : "默认中文";
  });

  await step("globals", () => {
    const names = [
      "SCORE_FORMATS", "formatById", "importAcceptAttribute", "exportScoreWith",
      "importScoreFromFile", "formatForFile", "formatForContent", "formatForExtension",
      "formatForBytes", "decodeTextBytes", "generateMusicXml", "musicXmlFromBytes",
      "generateMidi", "parseMidiFile", "generateAbc", "parseAbc", "ScoreExport",
      "lastImportWarnings", "currentScore", "updateExportLayersMessage", "showImportNotice",
      "LAYER_TOGGLES", "sanitizeTies", "fitMelodyOctaves", "nearestScoreDuration",
      "updatePlayabilityNotice", "startPlay", "layoutScoreInto",
    ];
    const missing = names.filter((n) => has(n) === "undefined");
    if (missing.length) throw new Error("缺 " + missing.join(","));
    return `${names.length} 个全局都在`;
  });

  await step("table-shape", () => {
    const bad = SCORE_FORMATS.filter((f) => !f.label || !f.hint || !Array.isArray(f.extensions)).map((f) => f.id);
    if (bad.length) throw new Error("缺 label/hint/extensions: " + bad.join(","));
    const noRead = SCORE_FORMATS.filter((f) => f.import && !f.read).map((f) => f.id);
    if (noRead.length) throw new Error("有 import 却没 read: " + noRead.join(","));
    return `${SCORE_FORMATS.length} 条格式，可导入 ${SCORE_FORMATS.filter((f) => f.import).length}，可导出 ${SCORE_FORMATS.filter((f) => f.export).length}`;
  });

  await step("ui-import-list", () => document.querySelectorAll("#importFormatList tr").length + " 行格式说明");
  await step("ui-export-cards", () => document.querySelectorAll("#exportOptions .export-card").length + " 张导出卡");
  await step("ui-accept", () => document.getElementById("openFile").accept);
  await step("ui-text-formats", () => [...document.getElementById("textFormat").options].map((o) => o.value).join(","));

  await step("dialog-tabs", () => {
    document.getElementById("openImport").click();
    const opened = document.getElementById("ioDialog").open;
    const importShown = !document.getElementById("ioPaneImport").hidden;
    document.getElementById("ioTabExport").click();
    const exportShown = !document.getElementById("ioPaneExport").hidden;
    const msg = document.getElementById("exportLayersMessage").textContent;
    document.getElementById("ioDialog").close();
    if (!opened || !importShown || !exportShown) throw new Error(`opened=${opened} import=${importShown} export=${exportShown}`);
    return "页签切换正常；图层提示：「" + msg + "」";
  });

  const abc = "X:1\nT:探针小调\nC:测试\nM:6/8\nL:1/8\nQ:1/4=120\nK:Ddor\n|: D2 E F2 G | A2 ^c d3 | c2 A F2 E | D6 :|";

  await step("import-abc", () => {
    const s = parseAbc(abc);
    if (!s.events.length) throw new Error("没解析出音符");
    score = s;
    applyScoreToForm();
    lastImportWarnings = [];
    return `${s.events.length} 音，调 ${s.tonic} ${s.mode}，拍 ${s.meter}，速度 ${s.tempo}`;
  });

  await step("abc-roundtrip", () => {
    const out = formatById("abc").export(currentScore());
    if (!out.name.endsWith(".abc")) throw new Error("文件名后缀不对: " + out.name);
    const before = currentScore().events.length;
    const back = parseAbc(out.data);
    if (back.events.length !== before) throw new Error(`往返音数 ${before} → ${back.events.length}`);
    score = back;
    applyScoreToForm();
    return `${out.name}（${out.data.length} 字符），往返音数一致`;
  });

  await step("musicxml-roundtrip", async () => {
    const source = currentScore();
    const xml = generateMusicXml(source);
    if (!/^<\?xml/.test(xml) || !/<score-partwise/.test(xml)) throw new Error("生成的 MusicXML 头不对");
    const back = await musicXmlFromBytes(new TextEncoder().encode(xml));
    const a = source.events.map((e) => `${e.pitch == null ? "r" : e.pitch}/${e.duration}`).join(" ");
    const b = back.events.map((e) => `${e.pitch == null ? "r" : e.pitch}/${e.duration}`).join(" ");
    if (a !== b) throw new Error(`事件串不一致\n  A ${a}\n  B ${b}`);
    if (back.tonic !== source.tonic || back.meter !== source.meter)
      throw new Error(`调 / 拍号没还原: ${back.tonic} ${back.mode} ${back.meter}`);
    score = back;
    applyScoreToForm();
    return `往返 ${back.events.length} 音一致，调 ${back.tonic} ${back.mode}，拍 ${back.meter}`;
  });

  await step("musicxml-name", () => {
    const out = formatById("musicxml").export(currentScore());
    return `${out.name}（${out.data.length} 字符）`;
  });

  await step("midi-roundtrip", () => {
    const source = currentScore();
    const bytes = generateMidi(source);
    if (bytes[0] !== 0x4d || bytes[1] !== 0x54) throw new Error("没有 MThd 头");
    const back = parseMidiFile(bytes);
    const a = source.events.filter((e) => e.pitch != null).map((e) => e.pitch).join(",");
    const b = back.events.filter((e) => e.pitch != null).map((e) => e.pitch).join(",");
    if (a !== b) throw new Error(`音高串不一致\n  A ${a}\n  B ${b}`);
    score = back;
    applyScoreToForm();
    return `往返 ${back.events.length} 音（含休止），音高一致`;
  });

  await step("midi-name", () => {
    const out = formatById("midi").export(currentScore());
    return `${out.name}（${out.data.length} 字节）`;
  });

  await step("json-name", () => {
    const out = formatById("json").export(currentScore());
    if (!out.name.endsWith(".json")) throw new Error("文件名后缀不对: " + out.name);
    const parsed = JSON.parse(out.data);
    if (!Array.isArray(parsed.events)) throw new Error("JSON 里没有 events");
    return `${out.name}，可还原 ${parsed.events.length} 音`;
  });

  await step("file-sniff", () => {
    const cases = [
      ["曲子.txt", abc, "abc"],
      ["曲子.xml", '<?xml version="1.0"?><score-partwise></score-partwise>', "musicxml"],
      ["曲子.json", '{"events":[]}', "json"],
      ["无后缀", abc, "abc"],
      ["怪东西.bin", "这不是任何一种谱", null],
    ];
    const wrong = [];
    for (const [name, text, want] of cases) {
      const got = formatForFile(name, text);
      const id = got ? got.id : null;
      if (id !== want) wrong.push(`${name}→${id}（期望 ${want}）`);
    }
    if (wrong.length) throw new Error(wrong.join("；"));
    return "5 个嗅探用例全对";
  });

  await step("extension-mismatch", async () => {
    const wanted = [{ pitch: 74, duration: 1 }, { pitch: 76, duration: 0.5 }, { pitch: null, duration: 0.5 }, { pitch: 81, duration: 2 }];
    const xml = generateMusicXml(Object.assign(currentScore(), { events: wanted }));
    const f = new File([xml], "弄错了.abc", { type: "text/plain" });
    const s = await importScoreFromFile(f);
    const got = s.events.map((e) => `${e.pitch == null ? "r" : e.pitch}/${e.duration}`).join(" ");
    const want = wanted.map((e) => `${e.pitch == null ? "r" : e.pitch}/${e.duration}`).join(" ");
    if (got !== want) throw new Error(`后缀写错后没走内容分流：得到 ${got}，应为 ${want}`);
    score = s;
    applyScoreToForm();
    return `后缀写成 .abc，仍按 MusicXML 走了内容分流：${s.events.length} 音`;
  });

  await step("wrong-file-message", async () => {
    const cases = [
      ["随便.bin", "乱七八糟的二进制内容 \u0000\u0001\u0002", /认不出/],
      ["随手记.txt", "今天心情不错，出门买了杯咖啡，回来继续写代码。", /认不出/],
      ["半截谱.abc", "随便写点什么，一个信息字段都没有", /找不到 ABC 的信息字段/],
    ];
    const wrong = [];
    for (const [name, body, want] of cases) {
      try {
        await importScoreFromFile(new File([body], name, { type: "text/plain" }));
        wrong.push(`${name} 本该报错却成功了`);
      } catch (e) {
        if (!want.test(e.message)) wrong.push(`${name} 报的是「${e.message.slice(0, 40)}…」`);
      }
    }
    if (wrong.length) throw new Error(wrong.join("；"));
    return "三个认不出的文件都给了对症的提示";
  });

  await step("png-export", async () => {
    const before = performance.now();
    await ScoreExport.exportPng(document.querySelector(".score-paper"), currentScore());
    return `PNG 长图生成完成（${Math.round(performance.now() - before)}ms）`;
  });

  await step("pdf-export", async () => {
    const before = performance.now();
    await ScoreExport.exportPdf(document.querySelector(".score-paper"), currentScore());
    return `PDF 生成完成（${Math.round(performance.now() - before)}ms）`;
  });

  await step("file-input-path", async () => {
    document.getElementById("openImport").click();
    const input = document.getElementById("openFile");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["X:1\nT:走输入框\nC:测试\nM:4/4\nL:1/8\nK:G\nG2 A B2 c|"], "走输入框.abc", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // ★ 等「条件成立」而不是猜一个毫秒数。文件读进来是异步的（FileReader），
    // 慢机器上 400ms 未必够，定长等待会让这一步偶发失败，而它一旦失败，
    // 后面依赖「当前曲谱是那一份」的几步会跟着一起红 —— 一个根因、三处报错，
    // 查起来像是三个 bug。轮询到标题真变了再往下走，快机器上也不会白等。
    const deadline = Date.now() + 5000;
    while (
      document.getElementById("title").value !== "走输入框" &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 50));
    const title = document.getElementById("title").value;
    if (title !== "走输入框") throw new Error("文件选择框这条路的标题没载入：" + title);
    if (document.getElementById("ioDialog").open) throw new Error("导入完成后「导入 / 导出」面板没有自动关掉");
    if (!document.querySelector("#scoreView .staff-layer")) throw new Error("导入后谱面没渲染出来");
    return `文件选择框 → 载入 → 面板自动关闭 → 谱面重绘，标题「${title}」`;
  });

  await step("text-panel", () => {
    const text = document.getElementById("scoreText");
    const pick = document.getElementById("textFormat");

    pick.value = "abc";
    text.value = "";
    document.getElementById("refreshText").click();
    const abcOut = text.value;
    if (!/^X:1/.test(abcOut)) throw new Error("生成的 ABC 头不对：" + abcOut.slice(0, 24));

    pick.value = "musicxml";
    text.value = "";
    document.getElementById("refreshText").click();
    const xmlOut = text.value;
    if (!/<score-partwise/.test(xmlOut)) throw new Error("没生成出 MusicXML");

    // 关键的一条：把刚生成的 MusicXML 粘回去，点「载入」。这条最常用的路过去会直接崩，
    // 因为 MusicXML 的文件导入要字节，而面板手里只有一段字符串。
    document.getElementById("loadText").click();
    const title = document.getElementById("title").value;
    const status = document.getElementById("formatMessage").textContent;
    if (title !== "走输入框") throw new Error("从文本载入 MusicXML 后标题变了：" + title);
    if (/无法读取|不是|失败/.test(status)) throw new Error("文本载入报了错：" + status);
    const events = document.querySelectorAll("#scoreView .measure").length;
    if (!events) throw new Error("文本载入后谱面上没有小节");

    pick.value = "abc";
    text.value = "";
    return `ABC（${abcOut.length} 字符）与 MusicXML（${xmlOut.length} 字符）都能生成；MusicXML 粘回去能重新载入（${events} 个小节）`;
  });

  await step("notice-bar", () => {
    lastImportWarnings = ["测试提示一条"];
    showImportNotice("已导入《试》");
    const text = document.getElementById("scoreNoticeText").textContent;
    const shown = !document.getElementById("scoreNotice").hidden;
    lastImportWarnings = [];
    showImportNotice("无损失");
    const hiddenAfter = document.getElementById("scoreNotice").hidden;
    if (!shown || !/测试提示一条/.test(text) || !hiddenAfter)
      throw new Error(`shown=${shown} hiddenAfter=${hiddenAfter} text=${text}`);
    return "有损失时显示、无损失时自动收起";
  });

  await step("dom-alignment", () => {
    applyScoreToForm();
    const v = document.getElementById("scoreView");
    const sys = v.querySelectorAll(".score-system");
    const staff = v.querySelectorAll(".staff-layer").length;
    const nums = v.querySelectorAll(".numbers-layer").length;
    const holes = v.querySelectorAll(".holes-layer").length;
    if (!sys.length) throw new Error("没有排出任何谱行");
    if (staff !== nums || nums !== holes) throw new Error(`图层数量不齐：五线谱 ${staff} / 简谱 ${nums} / 指法 ${holes}`);
    return `${sys.length} 个谱行，每行四层各 ${staff} 块对齐`;
  });

  await step("layer-toggle", () => {
    const nums = document.getElementById("showNumbers");
    nums.checked = false;
    render();
    const v = document.getElementById("scoreView");
    const numbersHidden = [...v.querySelectorAll(".numbers-layer")].every((el) => el.classList.contains("hidden"));
    const staffVisible = [...v.querySelectorAll(".staff-layer")].every((el) => !el.classList.contains("hidden"));
    updateExportLayersMessage();
    const off = document.getElementById("exportLayersMessage").textContent;
    nums.checked = true;
    render();
    updateExportLayersMessage();
    const on = document.getElementById("exportLayersMessage").textContent;
    if (!numbersHidden || !staffVisible)
      throw new Error(`关掉简谱后 numbersHidden=${numbersHidden} staffVisible=${staffVisible}`);
    if (/简谱/.test(off)) throw new Error("关掉简谱后导出提示里还写着简谱：" + off);
    if (!/简谱/.test(on)) throw new Error("重新打开后提示没跟着回来：" + on);
    return `关掉简谱时提示「${off}」，恢复后提示「${on}」`;
  });

  await step("add-vs-edit-affordance", () => {
    // 「添加音符」和「编辑选中的音」是同一张卡里的两个区域：一块往谱面里加新的，
    // 一块改已经写进去的。误操作的后果完全不同，之前两者只隔一条 1px 浅灰线，
    // 等于没分。这条盯住四件事，任何一件丢了都说明又看串回去了：
    //   ① 两块各有自己的模式标签，且一个字不同；
    //   ② 选中音符的编辑面板在视觉上真的是另一块（底色不同 + 左侧有色条）；
    //   ③ 编辑面板有自己的标题和「第几个音」的定位徽标；
    //   ④ 「新增」那句提示一直报出落点，用户不用猜新音会插到哪儿。
    const card = document.querySelector(".note-card");
    // 前面几步换过曲谱，这里先放一份长度确定的，免得选中下标越界（越界时面板是收起的，
    // 会被误报成「选中音符后编辑面板没出现」）。
    score = parseAbc("X:1\nT:探针\nM:4/4\nL:1/4\nQ:1/4=96\nK:D\nd e f g a b a g\n");
    applyScoreToForm();
    const panel = document.getElementById("selectionEditor");
    const addTag = card.querySelector(".mode-tag.add");
    const editTag = panel.querySelector(".mode-tag.edit");
    const title = panel.querySelector(".selection-head h3");
    const chip = document.getElementById("selectedIndex");
    const hint = document.getElementById("addTargetHint");
    const miss = ["addTag", "editTag", "title", "chip", "hint"].filter(
      (key) => !{ addTag, editTag, title, chip, hint }[key],
    );
    if (miss.length) throw new Error("缺元素：" + miss.join("/"));
    if (!addTag.textContent.trim() || addTag.textContent.trim() === editTag.textContent.trim())
      throw new Error(`模式标签没区分开：「${addTag.textContent}」/「${editTag.textContent}」`);

    selectNote(-1, false);
    if (!panel.hidden) throw new Error("没选中音符时编辑面板却露着");
    const noSelection = hint.textContent;
    if (!/曲末|没有选中/.test(noSelection))
      throw new Error("没选中时没说明新音会插到哪儿：" + noSelection);

    selectNote(4, false);
    if (panel.hidden) throw new Error("选中音符后编辑面板没出现");
    if (!/第 5 个音/.test(chip.textContent)) throw new Error("定位徽标没跟上：" + chip.textContent);
    if (!/第 5 个音之后/.test(hint.textContent))
      throw new Error("新增提示没报出落点：" + hint.textContent);
    if (hint.textContent === noSelection) throw new Error("新增提示不随选中状态变化");

    const ps = getComputedStyle(panel);
    const cs = getComputedStyle(card);
    if (ps.backgroundColor === cs.backgroundColor)
      throw new Error(`编辑面板和卡片同底色（都是 ${ps.backgroundColor}），分不出来`);
    const left = parseFloat(ps.borderLeftWidth);
    const top = parseFloat(ps.borderTopWidth);
    if (!(left > top)) throw new Error(`左侧色条没比上边框粗：左 ${left} 上 ${top}`);
    return `「${addTag.textContent.trim()}」/「${editTag.textContent.trim()}」两种模式各有标签；编辑面板底色 ${ps.backgroundColor} 与卡片 ${cs.backgroundColor} 不同、左侧色条 ${left}px；提示随选中改成「${hint.textContent}」`;
  });

  await step("tempo-number", () => {
    // 曲速有两个入口：滑杆（一边听一边拧）和数字框（我就要 108 这个数）。
    // 两者写的是同一个字段，所以这条盯的是「三处永远说同一个数」：滑杆、数字框、
    // 谱头那句 ♩=…。任何一处掉队，用户看到的和实际生效的就不是一回事。
    const slider = document.getElementById("tempo");
    const field = document.getElementById("tempoNumber");
    if (!field) throw new Error("没有曲速数字框（只有滑杆）");
    if (field.type !== "number") throw new Error("曲速框不是 number 类型：" + field.type);
    const head = () => document.getElementById("paperMeta").textContent;
    const type = (v) => {
      field.value = v;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const slide = (v) => {
      slider.value = v;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const leave = () => field.dispatchEvent(new Event("change", { bubbles: true }));

    // ① 数字框 → 滑杆 + 谱头
    type("108");
    if (score.tempo !== 108) throw new Error("数字框没写进曲谱：" + score.tempo);
    if (Number(slider.value) !== 108) throw new Error("滑杆没跟上数字框：" + slider.value);
    if (!/♩=108 BPM/.test(head())) throw new Error("谱头没跟上：" + head());

    // ② 滑杆 → 数字框
    slide("132");
    if (Number(field.value) !== 132) throw new Error("滑杆动了数字框没跟上：" + field.value);
    if (score.tempo !== 132) throw new Error("滑杆没写进曲谱：" + score.tempo);

    // ③ 逐字输入的中途值不能被下限夹走。想敲 108 的人会先产生 "1"、"10"，
    //    这两个数都在下限以下 —— 如果按 clamp 写回，光标会被顶到末尾，根本没法敲完。
    const typed = [];
    for (const v of ["", "1", "10"]) {
      type(v);
      typed.push(`"${v}"→"${field.value}"`);
    }
    if (field.value !== "10")
      throw new Error("半截输入被改写了：" + typed.join("，"));

    // ④ 离开输入框时收进合法区间，并把生效值写回框里（不能出现「框里 900、实际 400」）
    type("900");
    leave();
    if (field.value !== "400" || score.tempo !== 400)
      throw new Error(`超上限没收回：框里 ${field.value}，曲谱 ${score.tempo}`);
    if (Number(slider.max) < 400)
      throw new Error(`滑杆行程没跟着撑开，max=${slider.max}`);
    if (Number(slider.value) !== 400) throw new Error("撑开行程后滑杆没跟上：" + slider.value);
    type("");
    leave();
    if (field.value !== "400") throw new Error("清空后没退回上一个有效值：" + field.value);
    type("3");
    leave();
    if (field.value !== "20" || score.tempo !== 20)
      throw new Error(`低于下限没收回：框里 ${field.value}，曲谱 ${score.tempo}`);

    // ⑤ 走完一圈，滑杆行程必须仍然罩得住当前值 —— 滑块顶在刻度尽头装作是另一个数，
    //    比不显示这个数还糟。
    if (score.tempo < Number(slider.min) || score.tempo > Number(slider.max))
      throw new Error(`当前 ${score.tempo} 掉出滑杆行程 ${slider.min}–${slider.max}`);

    // ⑥ 「原曲」框的设置能力：录谱时要能亲手写下原曲速度（旧版只能靠导入带进来，
    //    手录的新谱永远是 96）。写完谱头要标「（原速 …）」，↺ 按钮要能一秒跳回去。
    const originalField = document.getElementById("originalTempoNumber");
    if (!originalField) throw new Error("没有「原曲速度」输入框");
    if (originalField.type !== "number")
      throw new Error("原曲速度框不是 number 类型：" + originalField.type);
    const setOriginal = (v) => {
      originalField.value = v;
      originalField.dispatchEvent(new Event("input", { bubbles: true }));
      originalField.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setOriginal("132");
    if (score.originalTempo !== 132)
      throw new Error("原曲速度没写进曲谱：" + score.originalTempo);
    // 框里逐字输入的中途值不能被吞掉（和「当前速度」框同一条规矩）
    originalField.value = "1";
    originalField.dispatchEvent(new Event("input", { bubbles: true }));
    if (originalField.value !== "1")
      throw new Error("原曲框的半截输入被改写了：" + originalField.value);

    slide("150");
    if (!/原速 132 BPM/.test(head())) throw new Error("谱头没标出新的原速：" + head());
    document.getElementById("originalTempo").click();
    if (score.tempo !== 132 || Number(field.value) !== 132 || Number(slider.value) !== 132)
      throw new Error(
        `↺ 按钮没跳回原速：曲谱 ${score.tempo}，框 ${field.value}，滑杆 ${slider.value}`,
      );
    if (/原速/.test(head())) throw new Error("已回到原速，谱头还写着「原速」：" + head());

    // ⑦ 超上限的原曲速度也要被收回，否则存档校验会把它判成损坏
    setOriginal("900");
    if (score.originalTempo !== 400)
      throw new Error("原曲速度超上限没收回：" + score.originalTempo);

    // ⑧ 自动存档必须能被自己读回来。这里曾经有一条会丢整份曲谱的路径：数字框允许 400，
    //    契约层却只收到 320 —— 用户敲 400，自动存档写下 400，下次打开时校验抛错，整份
    //    曲谱被判成「存档损坏」清掉。所以这条走的就是那条路：存下去，再按打开时的读法读回来。
    //    （两端现在读同一组常量，这一条是为了防止它们再次分叉。）
    setOriginal("96");
    type("400");
    leave();
    if (score.tempo !== 400) throw new Error("没能把曲速设成 400：" + score.tempo);
    saveLocal();
    const saved = localStorage.getItem("pujian-score-autosave-v2");
    if (!saved) throw new Error("没有写入自动存档");
    if (!/"tempo":400/.test(saved))
      throw new Error("自动存档里没记下 400：" + saved.slice(0, 120));
    try {
      const restored = importJson(JSON.parse(saved));
      if (restored.tempo !== 400)
        throw new Error("读回来的曲速不对：" + restored.tempo);
    } catch (error) {
      throw new Error(
        "自动存档读不回来（用户会看到「存档损坏」并丢掉整份曲谱）：" + error.message,
      );
    }
    type("96");
    leave();

    return `数字↔滑杆↔谱头三方同步；半截输入不被改写；900→400、3→20；行程 ${slider.min}–${slider.max}；400 BPM 的自动存档能读回来`;
  });

  await step("language-switch", () => {
    const sel = document.getElementById("langSelect");
    const codes = [...sel.options].map((o) => o.value);
    if (codes.join(",") !== "zh,en")
      throw new Error("语言选项不对：" + codes.join(","));

    const text = (id) => document.getElementById(id).textContent.trim();
    const pick = (code) => {
      sel.value = code;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    };

    try {
      // ── 切到英文：静态标记的、脚本生成的，两类都得跟着走 ──────────────────
      pick("en");
      if (document.documentElement.lang !== "en")
        throw new Error("<html lang> 没跟着变：" + document.documentElement.lang);
      if (!/^WhistleLoom — /.test(document.title))
        throw new Error("<title> 没翻：" + document.title);
      const undo = document.querySelector("#undoButton span").textContent;
      if (undo !== "Undo" || text("stopButton") !== "Stop" || !/Add note/.test(text("addNote")))
        throw new Error(`带标记的静态文案没翻：撤销=${undo} 停止=${text("stopButton")} 添加=${text("addNote")}`);
      const durEn = document.querySelector('#newDuration option[value="1"]').textContent;
      if (durEn !== "quarter note")
        throw new Error("时值下拉（脚本生成）没翻：" + durEn);
      const meterEn = [...document.getElementById("meter").options]
        .map((o) => o.textContent)
        .join("|");
      if (!/2\/2 \(cut time\)/.test(meterEn))
        throw new Error("拍号下拉（脚本生成）没翻：" + meterEn);
      const layersEn = text("exportLayersMessage");
      if (!/This export will include/.test(layersEn))
        throw new Error("图层提示（脚本生成）没翻：" + layersEn);
      if (!/score.system|score-system/.test(document.getElementById("scoreView").innerHTML))
        throw new Error("切语言把谱面弄没了");

      // ── 切回中文：必须逐字回到原文，不能留下英文残渣 ──────────────────────
      pick("zh");
      if (document.documentElement.lang !== "zh-CN")
        throw new Error("<html lang> 没回到中文：" + document.documentElement.lang);
      const undoZh = document.querySelector("#undoButton span").textContent;
      if (undoZh !== "撤销" || text("stopButton") !== "停止")
        throw new Error(`切回中文没还原：撤销=${undoZh} 停止=${text("stopButton")}`);
      const durZh = document.querySelector('#newDuration option[value="1"]').textContent;
      if (durZh !== "四分音符") throw new Error("时值下拉没还原：" + durZh);
      if (text("exportLayersMessage") !== "这次导出会带上：五线谱、简谱、歌词、指法图。")
        throw new Error("图层提示没还原：" + text("exportLayersMessage"));

      return "中英来回切换：静态标记、脚本生成的下拉与提示、<html lang>、<title> 都跟着走，谱面不受影响";
    } finally {
      // 切回中文并清掉语言标记：这是唯一会写 localStorage 的交互，跑完要收拾干净，
      // 否则下一次跑探针会从英文界面开局。
      if (i18nLang() !== "zh") pick("zh");
      localStorage.removeItem("whistleloom.lang");
    }
  });

  await step("playability-notice", () => {
    // 「这支哨笛吹不出哪些音」这条提示必须跟得上谱面的当前状态：换哨笛调、移调、
    // 改音符都要重算。做成一次性提示或增量维护都会在某一类入口上漏掉刷新。
    const panel = document.getElementById("playabilityNotice");
    const noticeText = () => document.getElementById("playabilityNoticeText").textContent;
    const marks = () => document.querySelectorAll("#scoreView .fingering-issue").length;

    // ① 默认曲谱是 D 调曲子配 D 调哨笛，一个音都不该报。
    if (!panel.hidden) throw new Error("默认曲谱不该报吹不出来，但提示条是开着的：" + noticeText());

    // ② 换成 C 调音阶配 D 调哨笛：低音 1（C）低于全按音，4（F）六孔拼不出来。
    const backup = { tonic: score.tonic, events: score.events };
    score.tonic = "C";
    score.events = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch) => ({ pitch, duration: 1 }));
    render();
    if (panel.hidden) throw new Error("C 调谱配 D 调哨笛，却一个音都没报");
    if (!/吹不出 2 个音/.test(noticeText()))
      throw new Error("提示条的计数不对：" + noticeText());
    if (!/低音 1 个/.test(noticeText()) || !/无指法 1 个/.test(noticeText()))
      throw new Error("提示条没有按原因分类：" + noticeText());
    if (marks() !== 2) throw new Error(`谱面上该有 2 个红记号，实际 ${marks()} 个`);

    // ③ 整曲移到 D 调：全部可吹，提示条和红记号都必须自己收起来。
    transposeTo("D");
    if (!panel.hidden) throw new Error("移到 D 调后提示条还挂着：" + noticeText());
    if (marks()) throw new Error(`移到 D 调后谱面上还有 ${marks()} 个红记号`);

    // ④ 还原现场，别把后面几步的谱面留在改动过的状态上。
    score.tonic = backup.tonic;
    score.events = backup.events;
    applyScoreToForm();
    if (!panel.hidden) throw new Error("还原后提示条还挂着：" + noticeText());
    return "默认不误报；C 调谱抓出 2 个音并标红；移到 D 调后自动收起";
  });

  await step("plain-print-removed", () => {
    // 「普通打印」这条导出路径已删除（用户 2026-10-08 决定：可逆 PDF 已覆盖这个需求）。
    // 删掉的不只是一个按钮 —— 为了它曾经散布着：登记表里的 print 条目、导出点击回调里的
    // print()、状态文案里的 id === "print" 分支、app.js 里一整段 beforeprint / afterprint
    // 重排逻辑、以及整整一个 css/print.css。半途而废的「删除」最容易留下死代码：
    // 按钮没了、监听还在，或者样式表还挂在 index.html 上，谁也说不清它还在不在生效。
    //
    // 这条把「删干净」钉住，四样都要查：登记表、界面卡片、样式表引用、打印事件监听。
    if (SCORE_FORMATS.some((f) => f.id === "print"))
      throw new Error("SCORE_FORMATS 里还有 print 条目 —— 登记表没删干净");
    if (document.querySelector('#exportOptions [data-format="print"]'))
      throw new Error("导出面板上还挂着「普通打印」卡片");
    if ([...document.styleSheets].some((s) => (s.href || "").includes("print.css")))
      throw new Error("index.html 还引用着 css/print.css —— 样式表没解绑");
    // 打印前重排那段逻辑删干净的话，beforeprint 派发出去应当什么都不发生：
    // 谱面 DOM 不该被重建（用同一个节点还连在文档里来判断）。
    const view = document.getElementById("scoreView");
    const before = view.querySelector(".score-system")?.firstElementChild;
    window.dispatchEvent(new Event("beforeprint"));
    const after = view.querySelector(".score-system")?.firstElementChild;
    if (before && after && before !== after)
      throw new Error("beforeprint 竟然重排了谱面 —— 打印重排逻辑没删干净");
    window.dispatchEvent(new Event("afterprint"));
    return `${SCORE_FORMATS.length} 条格式里没有 print；无导出卡片、无 print.css 引用、无打印重排`;
  });

  await step("export-connections", () => {
    // 「PNG / PDF 导出没有延音线」的根因**不是**打印那条路，而是导出这条：
    //   导出走 cleanClone() → staging() 两步。连线是 renderConnections() 用
    //   getBoundingClientRect() 量出符头/唱名的真实像素位置后画的绝对定位 <svg>；
    //   而 cloneNode 出来的节点游离在文档之外，量的每一行都是「宽 0 高 0」，
    //   renderConnections 内部 `if (!width || !height) continue` ——
    //   **一条线都不画，还一声不吭**。
    //
    // 所以这条断言不能只看「有没有覆盖层」，必须真的把导出前两步跑一遍，
    // 并且和编辑态的条数**对齐**：只要条数对不上，就说明这条路径又断了一环。
    if (!window.ScoreExport?.cleanClone || !window.ScoreExport?.staging)
      throw new Error("ScoreExport 上没有导出 cleanClone / staging，无法验证导出路径");

    const view = document.getElementById("scoreView");
    const curveCountIn = (root) =>
      root.querySelectorAll(
        "svg.connection-overlay .tie-curve, svg.connection-overlay .slur-curve",
      ).length;

    const backup = { events: score.events, tonic: score.tonic };
    // 造两处必须画出连线的记号：延音线（同音高相连）与连奏线（不同音高相连）。
    score.events = [
      { pitch: 62, duration: 1, tieToNext: true },
      { pitch: 62, duration: 1 },
      { pitch: 64, duration: 1, slurToNext: true },
      { pitch: 65, duration: 1 },
    ];
    applyScoreToForm();
    render();
    const liveCurves = curveCountIn(view);
    if (liveCurves < 2)
      throw new Error(`编辑态下该有 2 条连线，实际 ${liveCurves} 条 —— 前置条件就不成立`);

    // 真实导出前两步。cleanClone 的第二个参数是「要导出的那份曲谱」。
    const paper = document.querySelector(".score-paper");
    if (!paper) throw new Error("找不到 .score-paper，导出无从下手");
    const clone = window.ScoreExport.cleanClone(paper, score, 1004);
    if (clone.isConnected)
      throw new Error("cleanClone 出来的应该是游离节点，这里却已经连上文档了");
    const host = window.ScoreExport.staging(clone, score);
    try {
      const staged = clone.querySelector("#scoreView");
      if (!staged) throw new Error("暂存后的克隆体里没有 #scoreView");
      // 尺寸必须先正常，否则「没有线」可能只是布局本身没跑。
      if (!staged.getBoundingClientRect().width)
        throw new Error("暂存后的克隆体量出来宽度是 0，布局没生效");
      const stagedCurves = curveCountIn(staged);
      if (stagedCurves === 0)
        throw new Error(
          "导出路径一条连线都没有（这正是「PNG 导出丢延音线」的病症）：" +
            "连线覆盖层必须在 clone 进了文档之后再画，画在游离节点上量不到尺寸，会静默跳过",
        );
      // ★ 与编辑态逐条对齐：数量不同说明多画或漏画，不能只看「非零」。
      if (stagedCurves !== liveCurves)
        throw new Error(
          `导出路径画出 ${stagedCurves} 条连线，编辑态是 ${liveCurves} 条 —— 两者必须一致`,
        );
      for (const overlay of staged.querySelectorAll("svg.connection-overlay"))
        if (!overlay.closest(".score-system"))
          throw new Error("导出路径的覆盖层没挂在任何谱行上（坐标会整体飘掉）");

      // ★ 光「条数对」还不够 —— 还得「画在对的位置上」。
      //
      // 连线是 renderConnections() 量完符头/唱名的像素位置后把 d 写死的覆盖层。
      // 一旦有个环节把谱行重新排版、却没重画连线，弧就会与音符错开 ——
      // 条数照样对，图却错了。（这种情况真发生过：print.css 里一条
      // `justify-content: space-between` 把定宽的小节推开，弧留在原地，
      // 打印出来就是「延音线位置不对」。打印这条路后来整个删掉了，
      // 但同类的「排版动了、弧没跟着动」在导出路径上同样要挡住。）
      //
      // 判据：每条弧的两个**端点**，必须落在它该连的那颗符头／唱名的水平范围内，
      // 或落在谱行右缘（跨行延音线故意画到 width-5 的断口）。
      //
      // ★ 取端点不能只抓前两个数字：二次贝塞尔的 d 是 `M x1 y1 Q cx cy x2 y2`，
      // 中间那对 (cx, cy) 是控制点 —— 它就是弧的峰顶，天生落在两颗音**中间**，
      // 拿它当端点比对必然「不在任何符头上」。端点只有第 1 对（M）与第 3 对（Q 终点）。
      const misaligned = (() => {
        const sys = staged.querySelector(".score-system");
        if (!sys) return "暂存的谱面里找不到谱行";
        const sr = sys.getBoundingClientRect();
        const endpointsOf = (path) => {
          const d = path.getAttribute("d") || "";
          const nums = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
          return nums.length >= 5 ? [nums[0], nums[4]] : nums.length ? [nums[0]] : [];
        };
        const spans = (sel) =>
          [...sys.querySelectorAll(sel)].map((n) => {
            const r = n.getBoundingClientRect();
            return { left: r.left - sr.left, right: r.right - sr.left };
          });
        const heads = spans(".staff-layer .score-note .notehead");
        const numbers = spans(".numbers-layer .event-cell .number-value");
        const all = [...heads, ...numbers];
        const sysWidth = sys.scrollWidth;
        const tol = 6;
        for (const path of sys.querySelectorAll(".connection-overlay path")) {
          for (const x of endpointsOf(path)) {
            const onNote = all.some((n) => x >= n.left - tol && x <= n.right + tol);
            const dangling = Math.abs(x - (sysWidth - 5)) <= tol;
            if (!onNote && !dangling)
              return `弧端点 x=${x.toFixed(1)} 既不落在任何符头／唱名上，也不在谱行右缘（谱行宽 ${sysWidth}）` +
                `\n  d=${path.getAttribute("d")}` +
                `\n  符头=${heads.map((n) => n.left.toFixed(0) + "-" + n.right.toFixed(0)).join(" ")}` +
                `\n  唱名=${numbers.map((n) => n.left.toFixed(0) + "-" + n.right.toFixed(0)).join(" ")}`;
          }
        }
        return null;
      })();
      if (misaligned) throw new Error(misaligned + " —— 导出图里的弧与音符错开了");
    } finally {
      host.remove();
      score.events = backup.events;
      score.tonic = backup.tonic;
      applyScoreToForm();
      render();
    }
    return `编辑态与导出路径都是 ${liveCurves} 条连线，且覆盖层各自挂在所属谱行上`;
  });

  await step("tie-playback-envelope", () => {
    // 延音线的写法是「前一颗短音 + 后一颗长音」，发声的是前一颗 —— 所以它得替整条链
    // 响满全程。旧代码把音量衰减排在 `secs`（自己那一格）之后，例如「八分音符(0.5拍)
    // 连到全音符(4拍)」的前一颗只响 0.27 秒就衰减到听不见，后面四拍全哑 ——
    // 用户听到的就是「演奏时没有延长声」，而单颗长音恰好正常（它的 secs 本来就是全长）。
    //
    // 这里不真放声音，而是拦下 AudioContext 记录调度参数：起音时刻、衰减起始时刻、
    // 停止时刻。三者对齐到「整条链的时长」才算过。
    const backup = { events: score.events, tempo: score.tempo };
    const RealCtx = window.AudioContext || window.webkitAudioContext;
    if (!RealCtx) throw new Error("环境里没有 AudioContext，测不了");
    if (typeof startPlay !== "function") throw new Error("找不到播放入口 startPlay");
    const calls = [];
    const fakeParam = () => ({
      value: 0,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
      setTargetAtTime: (v, t) => calls.push(["decay", t]),
      cancelScheduledValues: () => {},
      linearRampToValueAtTime: () => {},
    });
    const fakeCtx = {
      currentTime: 100,
      state: "running",
      resume: () => Promise.resolve(),
      destination: {},
      createGain: () => ({ gain: fakeParam(), connect: (x) => x }),
      createOscillator: () => ({
        frequency: { value: 0 },
        type: "sine",
        connect: (x) => x,
        start: () => {},
        stop: (t) => calls.push(["stop", t]),
        onended: null,
      }),
    };
    window.AudioContext = function () {
      return fakeCtx;
    };
    window.webkitAudioContext = window.AudioContext;
    try {
      score.tempo = 60; // 一拍一秒，算起来直观
      score.events = [
        { pitch: 62, duration: 0.5, tieToNext: true },
        { pitch: 62, duration: 4 },
      ];
      applyScoreToForm();
      render();
      calls.length = 0;
      startPlay();
      // 立刻停止，别真播下去（stopPlay 会清掉定时器和活动振荡器）。
      stopPlay();
      const decay = calls.find(([k]) => k === "decay");
      const stop = calls.find(([k]) => k === "stop");
      if (!decay) throw new Error("没有排布音量衰减（包络完全没调度）");
      if (!stop) throw new Error("没有排布振荡器停止");
      // 链长 = 0.5 + 4 = 4.5 拍；tempo=60 → 4.5 秒。停止时刻还要留 0.04 秒的余量，
      // 免得包络还没走完就被掐断（听感上是一个爆音）。
      const wantStop = 100 + 4.5 + 0.04;
      const wantDecay = 100 + 4.5 - 0.04;
      if (Math.abs(stop[1] - wantStop) > 0.02)
        throw new Error(
          `振荡器停止时刻不对：应为 ${wantStop}s，实际 ${stop[1]}s —— 链长没算进去`,
        );
      if (decay[1] < 100 + 1)
        throw new Error(
          `音量衰减排得太早：${decay[1]}s（起音在 100s），长音会在自己那一格结束时就哑掉`,
        );
      if (Math.abs(decay[1] - wantDecay) > 0.02)
        throw new Error(`衰减起点应为 ${wantDecay}s，实际 ${decay[1]}s`);
    } finally {
      stopPlay();
      window.AudioContext = RealCtx;
      window.webkitAudioContext = RealCtx;
      score.tempo = backup.tempo;
      score.events = backup.events;
      applyScoreToForm();
      render();
    }
    return `tempo=60 时「0.5 拍 + 延音线 + 4 拍」的链：衰减与停止都排在 4.5 秒处`;
  });

  await step("lyric-enter-advance", async () => {
    try {
      // 填歌词是线性动作，回车该顺着谱面往下走。这条要真验的是**焦点真的落到了输入框**——
      // 光看 selected 变了没意义：render() 会把无障碍音符列表整块重建，同步调的 focus()
      // 落在一个已离线的节点上，selected 照样前进，用户却打不进第二个字。
      const field = () => document.getElementById("editLyric");
      // ★ 等一个真实的短定时器，**不要**用 requestAnimationFrame：Chrome headless 配
      // --virtual-time-budget 时，页面一旦「静默」（没有可见动画）rAF 可能再也不触发，
      // await 它等于把整条探针挂死在半路 —— 症状是「结果区根本没出现」而不是某一用例
      // 失败，极难定位（这次就这么卡了两轮）。也不要用 0ms：setTimeout(0) 只让出一个
      // 宏任务，headless 下 selectNote 里那个 rAF(focus) 未必来得及跑完。
      const frame = () => new Promise((r) => setTimeout(r, 60));
      const key = (name) =>
        field().dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        );

      loadSample("scale");
      // 音符在谱面上是 SVG 的 <g>，没有 HTMLElement.click()，得派发真的鼠标事件。
      document
        .querySelector('#scoreView [data-index="0"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await frame();
      if (field().value !== "") throw new Error("示例曲第一个音不该有歌词");
      // 鼠标点音符**不该**抢焦点到输入框：那是「无障碍导航模式」，焦点要留在音符上
      // 好让人接着用方向键一个个走。只有回车/上下键跳转才需要焦点进输入框。
      // 这两条不能混：混了以后点一下音符就被拽进输入框，键盘导航直接废掉。
      if (field() === document.activeElement)
        throw new Error("鼠标点音符不该把焦点抢进歌词框");

      const total = score.events.length;
      field().focus();
      field().value = "甲";
      field().dispatchEvent(new Event("input", { bubbles: true }));
      key("Enter");
      await frame();
      if (selected !== 1) throw new Error(`回车后停在第 ${selected + 1} 个音，该是第 2 个`);
      if (score.events[0].lyric !== "甲") throw new Error("回车把刚填的词弄丢了");
      if (field() !== document.activeElement)
        throw new Error("回车后焦点没跟着走——用户还得再点一次输入框");
      if (field().value !== "") throw new Error("下一个音本来是空的，框里却有内容");

      // 上方向键回头改：填错一个词不该让人去摸鼠标。
      key("ArrowUp");
      await frame();
      if (selected !== 0) throw new Error("上方向键没回到上一个音");
      if (field().value !== "甲")
        throw new Error("回到上一个音后框里不是它的歌词：" + field().value);
      if (field() !== document.activeElement) throw new Error("上方向键后焦点没落在输入框");

      // 组合输入期间的回车是「确认候选词」，绝不能当成「去下一个」——
      // 否则中文用户刚敲完拼音按回车，焦点跑掉、词也丢在半路。
      field().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
      await frame();
      if (selected !== 0) throw new Error("输入法组字期间的回车被当成跳转了");

      // 走到最后一个音再按回车：不该越界，也不该静默回到第一个。
      selected = total - 1;
      render();
      await frame();
      key("Enter");
      await frame();
      if (selected !== total - 1)
        throw new Error(`在最后一个音按回车跑到了第 ${selected + 1} 个`);

      applyScoreToForm();
      return `回车 / ↓ 前进、↑ 回头，焦点始终在框里；组字期间与曲末都放行（共 ${total} 个音）`;
    } finally {
      // 无论成败都把曲谱放回一份确定的默认值：这一步动过选中态和歌词，
      // 留着会让后面每一步看到不一样的起点（而且失败时更看不出是哪一步弄脏的）。
      score = parseAbc("X:1\nT:探针\nM:4/4\nL:1/4\nQ:1/4=96\nK:D\nd e f g a b a g\n");
      applyScoreToForm();
    }
  });

  await step("message-cleanup", () => {
    // 导出面板右下角那格是常驻的状态位，导出完成后不该留着上一次的「正在…」。
    // （文本面板的 #formatMessage 是 2.8 秒自动消失的回执，那是有意的，不算残留。）
    const el = document.querySelector("#exportStatus");
    const text = el ? el.textContent.trim() : "";
    if (/正在/.test(text)) throw new Error(`导出状态位还停在「${text}」`);
    return text ? `导出状态位停在「${text}」` : "导出状态位干净";
  });

  return JSON.stringify(r, null, 2);
})();

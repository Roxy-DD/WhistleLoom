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
    await new Promise((done) => setTimeout(done, 400));
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

    // ⑥ 「原曲」按钮把三处一起复位，谱头那句「（原速 …）」也该自己消失
    score.originalTempo = 96;
    slide("150");
    if (!/原速 96 BPM/.test(head())) throw new Error("改了曲速后谱头没标出原速：" + head());
    document.getElementById("originalTempo").click();
    if (score.tempo !== 96 || Number(field.value) !== 96 || Number(slider.value) !== 96)
      throw new Error(
        `原曲按钮没复位三处：曲谱 ${score.tempo}，框 ${field.value}，滑杆 ${slider.value}`,
      );
    if (/原速/.test(head())) throw new Error("已回到原速，谱头还写着「原速」：" + head());

    // ⑦ 自动存档必须能被自己读回来。这里曾经有一条会丢整份曲谱的路径：数字框允许 400，
    //    契约层却只收到 320 —— 用户敲 400，自动存档写下 400，下次打开时校验抛错，整份
    //    曲谱被判成「存档损坏」清掉。所以这条走的就是那条路：存下去，再按打开时的读法读回来。
    //    （两端现在读同一组常量，这一条是为了防止它们再次分叉。）
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

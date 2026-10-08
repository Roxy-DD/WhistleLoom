/* 国际化层：一张语言表 + 一个替换器 + 一次「把标记过的 DOM 换一遍」。
 *
 * ── 为什么键就是中文原文 ────────────────────────────────────────────────────
 * 用的是 gettext 那一派的做法：**拿源语言的字面文本当键**，而不是另造一套
 * "ui.toolbar.undo" 这样的符号键。三个具体好处：
 *   ① 漏翻时退回中文原文，不会在界面上印出一串 "ui.toolbar.undo"；
 *   ② 改中文文案时不必同时改键，不会出现「文案改了、键没改、翻译失联」；
 *   ③ 读代码时 `tr("撤销")` 比 `tr("ui.toolbar.undo")` 一眼就知道这句是什么。
 * 代价是同一句话出现两次要译两次，实际很少，接受。
 *
 * ── 默认语言 ────────────────────────────────────────────────────────────────
 * 按这个顺序定：`?lang=` 查询参数 → localStorage 里上次的选择 → navigator.language
 * （zh 开头取中文，其余一律英文）→ 兜底中文。
 * **在没有浏览器的环境（Node 测试、命令行校验脚本）里一律是中文** —— 这是刻意的：
 * 那些环境里没有用户，而既有的测试断言的正是中文提示语。默认中文让它们继续有效，
 * 也让 `node --check` 之类的离线校验拿到的是「源语言原文」而不是半截翻译。
 *
 * ── 占位符 ──────────────────────────────────────────────────────────────────
 * 带变量的句子写成 `tr("已导入《{title}》。", { title })`，而不是事先拼好字符串再查表 ——
 * 拼好的句子每次都不一样，查不到表。`{...}` 里的名字随句子一起写进语言表。
 *
 * ── DOM 那一半 ──────────────────────────────────────────────────────────────
 * 页面上的静态文案打两种标记：
 *   data-i18n              → 换掉整个 textContent，键就是它原来的文字
 *   data-i18n-lead         → 只换掉**开头那个裸文本节点**（键是它的文字）
 *   data-i18n-attrs="a b"  → 换掉列出的属性，键是属性当前的值
 * `data-i18n-lead` 是为 `<label>乐器<select>…</select></label>` 这类结构准备的：
 * 标签文字和控件在同一个元素里，换 textContent 会把控件一起删掉，只换开头那段文字才行。
 *
 * 登记发生在 boot 时（i18nPrepare），记下**原文**；之后每次切换语言都从原文重渲染一次。
 * 这样来回切中英不会层层套娃（英语再翻回中文时查的是原始中文，不是英文）。
 */
const I18N_SOURCE_LANG = "zh";
const I18N_LANG_ZH = "zh";
const I18N_LANG_EN = "en";
const I18N_STORAGE_KEY = "whistleloom.lang";
// 语言自己的名字用它自己的语言写（中文叫「中文」，英文叫「English」），不翻译。
const I18N_LANGS = [
  { code: I18N_LANG_ZH, htmlLang: "zh-CN", label: "中文" },
  { code: I18N_LANG_EN, htmlLang: "en", label: "English" },
];

const I18N_EN = {
  // ── 产品与顶栏 ────────────────────────────────────────────────────────────
  "WhistleLoom 谱间 主页": "WhistleLoom home",
  "WhistleLoom（谱间）· 交互曲谱工作台：浏览器里直接编辑单旋律曲谱，同时看五线谱、简谱、歌词和爱尔兰哨笛洞洞谱；可从 thesession.org 公共曲库载入传统曲调，导出可逆 PDF / PNG。":
    "WhistleLoom — a browser score studio for single-line melodies: staff notation, numbered notation, lyrics and Irish whistle tablature in one view. Load traditional tunes from thesession.org and export reversible PDF / PNG.",
  "WhistleLoom · 谱间 —— 哨笛曲谱工作台": "WhistleLoom — whistle score studio",
  // 品牌副标题。英文那边刻意只留 SCORE STUDIO：翻译成「Score Room · SCORE STUDIO」
  // 既啰嗦，又会让顶栏品牌块撑高换行，把播放器挤走。
  "谱间 · SCORE STUDIO": "SCORE STUDIO",
  播放: "Play",
  继续播放: "Resume",
  暂停: "Pause",
  停止: "Stop",
  新建: "New",
  导入: "Import",
  导出: "Export",
  "保存到本机": "Save to disk",
  "♪ 有声": "♪ Sound on",
  "♪ 静音": "♪ Muted",
  "切换为有声播放": "Switch to sound on",
  "切换为静音播放": "Switch to muted playback",
  "当前为有声播放": "Sound is on",
  "当前为静音播放；播放进度与谱面跟随仍正常": "Playback is muted; the playhead and score following still work",
  "此浏览器不支持播放": "This browser cannot play audio",
  "静音播放中": "Playing (muted)",
  "正在播放": "Playing",
  "已暂停": "Paused",
  准备演奏: "Ready to play",
  "音符 {index} / {total}": "Note {index} / {total}",
  速度: "Tempo",
  原曲: "Original",
  "把当前速度调回下面「原曲」框里记的原曲速度": "Set the tempo back to the original tempo in the field below",
  "回到原曲速度": "Reset to original tempo",
  "录谱时查到的原曲速度写这里；谱头会记下它，点左边的 ↺ 就能一秒跳回来": "Write down the original song's tempo here while transcribing; the score header records it, and the ↺ button jumps back to it",
  "原曲速度，每分钟四分音符数": "Original tempo in quarter notes per minute",
  "曲速滑杆": "Tempo slider",
  "也可以直接输入数字，或用上下方向键微调": "You can also type a number, or nudge it with the arrow keys",
  "曲速，每分钟四分音符数": "Tempo in quarter notes per minute",

  // ── 标题区与示例 ──────────────────────────────────────────────────────────
  我的曲谱: "My score",
  编辑中: "editing",
  爱尔兰小调: "Irish Tune",
  "点击音符即可编辑。改动会即时反映在谱面、简谱和指法图中。":
    "Click a note to edit it. Changes show up immediately in the staff, the numbered notation and the fingering chart.",
  试试示例: "Try a sample",
  "载入示例曲谱": "Load a sample score",
  选择一首示例曲: "Pick a sample tune",
  载入: "Load",
  "After The Battle Of Aughrim · 传统进行曲": "After The Battle Of Aughrim · traditional march",
  "山风小曲 · 歌词示例": "Mountain Wind · lyric sample",
  "D 调音阶练习": "D major scale exercise",
  "Sí Bheag Sí Mhór · 奥卡罗兰慢曲（D 调哨笛）": "Sí Bheag Sí Mhór · O'Carolan air (D whistle)",
  "The Sally Gardens · 爱尔兰传统曲（D 调哨笛）": "The Sally Gardens · Irish traditional (D whistle)",
  "示例曲已载入，点击音符试试编辑": "Sample loaded — click a note to try editing",

  // ── 谱面工具条 ────────────────────────────────────────────────────────────
  "关闭提示": "Close notice",
  "曲谱编辑区": "Score editor",
  "适合窗口": "Fit to window",
  "曲谱编辑工具": "Score editing tools",
  撤销: "Undo",
  重做: "Redo",
  "撤销 (Ctrl+Z)": "Undo (Ctrl+Z)",
  "重做 (Ctrl+Y)": "Redo (Ctrl+Y)",
  "缩小谱面": "Zoom out",
  "放大谱面": "Zoom in",
  音符时值: "Note value",
  "＋ 插入音符": "＋ Insert note",
  休止符: "Rest",
  "查看键盘快捷键": "Show keyboard shortcuts",
  "⌨ 快捷键": "⌨ Shortcuts",
  键盘快捷键: "Keyboard shortcuts",
  "选择前一个 / 后一个音符": "Select previous / next note",
  "升高 / 降低半音": "Raise / lower by a semitone",
  "时值加倍 / 减半": "Double / halve the note value",
  "删除选中音符": "Delete the selected note",
  "导出可编辑备份": "Export an editable backup",
  缩放曲谱: "Zoom the score",
  "播放 / 暂停（选中曲谱音符时）": "Play / pause (while the score has focus)",
  "歌词框内：跳到上一个 / 下一个音的歌词": "In the lyric field: jump to the previous / next note's lyric",
  "快捷键在输入框内会让位给文字编辑。": "Shortcuts step aside for text editing while you are typing in a field.",
  "音符导航": "Note navigation",
  "从第一个音符开始": "Start with the first note",
  "点右侧的音符按钮，或导入 ABC 曲谱。": "Use the note buttons on the right, or import an ABC score.",

  // ── 文本格式面板 ──────────────────────────────────────────────────────────
  "文本格式导入 / 导出（ABC · MusicXML，给 AI 或其他记谱软件用）":
    "Text import / export (ABC · MusicXML, for AI tools and notation software)",
  "平时直接编辑曲谱即可。文本格式是可选的交换方式：ABC 短小、适合贴给 AI；MusicXML 完整、适合交给记谱软件接着排版。":
    "You normally just edit the score directly. Text formats are an optional exchange route: ABC is short and handy for pasting into an AI; MusicXML is complete and ready for notation software to lay out further.",
  格式: "Format",
  "选择文本格式": "Choose a text format",
  "由当前曲谱生成": "Generate from the current score",
  复制: "Copy",
  "曲谱文本": "Score text",
  "以这段文本更新曲谱": "Update the score from this text",
  "已复制到剪贴板": "Copied to clipboard",
  "已选中文本，按 Ctrl+C 复制": "Text selected — press Ctrl+C to copy",
  "无法读取这段文本": "Could not read that text",
  "已生成当前曲谱的 {format}": "Generated {format} for the current score",
  "{format} 文本": "{format} text",
  "{format} 已载入。": "{format} loaded.",
  "{format} 已载入，可以继续图形化编辑": "{format} loaded — you can keep editing it graphically",

  // ── 公共曲库 ──────────────────────────────────────────────────────────────
  "曲谱与音符编辑面板": "Score and note editing panel",
  曲目来源: "Tune source",
  公共曲库: "Public tune library",
  爱尔兰传统曲调: "Irish traditional tunes",
  "从 thesession.org 的两万多首传统曲调里挑一首，直接载入编辑器继续改。":
    "Pick one of the 20,000+ traditional tunes on thesession.org and load it straight into the editor.",
  "搜曲名，留空看最热门的": "Search a tune name, or leave blank for the most popular",
  "搜索公共曲库": "Search the public tune library",
  搜索: "Search",
  下一页: "Next page",
  全部曲种: "All types",
  "按曲种筛选": "Filter by tune type",
  "曲库曲目列表": "Tune list",
  "曲库数据来自 thesession.org，以 ODbL 1.0 授权发布。载入时会把谱例换成编辑器能表达的记法，改动了什么都会列出来。":
    "Tune data comes from thesession.org under ODbL 1.0. Loading a tune rewrites the setting into the notation this editor can express, and every change is listed.",
  正在检索: "Searching…",
  "在线命中 {total} 首 · 第 {page}/{pages} 页": "{total} online matches · page {page}/{pages}",
  "离线曲库 {total} 首（{reason}）": "{total} tunes in the built-in library ({reason})",
  "检索失败。": "Search failed.",
  "离线曲库 {total} 首 · 点「搜索」联网查全部": "{total} tunes in the built-in library · press Search to reach the full online set",
  "内置曲库里没有匹配的曲目。联网后搜索可以查到 thesession.org 全部两万多首。":
    "No match in the built-in library. Search online to reach all 20,000+ tunes on thesession.org.",
  "没有找到匹配的曲目，换个关键词或曲种再试。": "No matching tunes — try another keyword or type.",
  "正在取《{name}》…": "Loading “{name}”…",
  "已载入《{name}》。": "Loaded “{name}”.",
  "已载入《{name}》": "Loaded “{name}”",
  "载入失败，请重试。": "Load failed, please try again.",
  "这首曲子在曲库里没有可用的谱例。": "This tune has no usable setting in the library.",
  传统曲调: "traditional tune",

  // ── 演奏设置 ──────────────────────────────────────────────────────────────
  演奏设置: "Playback settings",
  乐器与调性: "Instrument & key",
  乐器: "Instrument",
  爱尔兰哨笛: "Irish whistle",
  "竖笛（后续支持）": "Recorder (planned)",
  "长笛（后续支持）": "Flute (planned)",
  哨笛调: "Whistle key",
  "D 调": "D",
  "C 调": "C",
  "B♭ 调": "B♭",
  "G 调": "G",
  "F 调": "F",
  "E♭ 调": "E♭",
  "A 调": "A",
  简谱主音: "Numbered-notation tonic",
  调式: "Mode",
  拍号: "Meter",
  "2/2（cut time）": "2/2 (cut time)",
  整体移调: "Transpose whole score",
  "整首曲子移到哪个调": "Move the whole score to which key",
  转换: "Convert",
  "主音决定简谱“1”；哨笛调决定实际音高与指法。「简谱主音」只管记谱：改它不会让音变高变低，只是换个音当“1”。要把整首曲子挪到别的调（比如 C 调曲改成 D 调），用上面的「整体移调」。":
    "The tonic decides which pitch is “1” in numbered notation; the whistle key decides the sounding pitch and the fingering. “Numbered-notation tonic” only affects the notation: changing it does not make anything higher or lower, it just picks a different pitch to call “1”. To move the whole tune to another key (say a C tune into D), use “Transpose whole score” above.",
  "曲谱署名与原调": "Credits & source key",
  原调: "Source key",
  未注明: "Not stated",
  作曲: "Composer",
  作词: "Lyricist",
  编配: "Arranger",
  副标题: "Subtitle",
  作曲者: "composer",
  作词者: "lyricist",
  编配者: "arranger",
  "例如：歌曲 / 练习曲": "e.g. song / study",

  // ── 图层 ──────────────────────────────────────────────────────────────────
  谱面图层: "Score layers",
  显示内容: "What to show",
  五线谱: "Staff",
  简谱数字: "Numbered notation",
  歌词对照: "Lyrics",
  哨笛洞洞谱: "Whistle tablature",

  // ── 编辑卡 ────────────────────────────────────────────────────────────────
  新增: "Add",
  修改: "Edit",
  乐谱编辑: "Score editing",
  添加音符: "Add notes",
  "选择音高和时值，插入到第 {index} 个音之后。": "Pick a pitch and a note value to insert after note {index}.",
  "还没有选中音符 —— 新音会加到曲末。点一下谱面上的音可以改它的位置。":
    "No note selected — new notes go to the end. Click a note in the score to change where they land.",
  "曲谱还是空的，新音会从头排起。": "The score is empty — new notes start from the beginning.",
  "简谱音级快捷输入": "Numbered-notation degree shortcuts",
  音高: "Pitch",
  时值: "Note value",
  "＋ 添加音符": "＋ Add note",
  "＋ 添加休止符": "＋ Add rest",
  编辑这个音: "Edit this note",
  "第 {index} 个音": "Note {index}",
  "上面那块是": "The block above ",
  "音符；这里改的是": " notes. Here you are editing the note ",
  "已经写进谱面": "already written into the score",
  "的那个音。改错了按": " — if you change it by mistake, press ",
  "撤销。": " to undo.",
  歌词音节: "Lyric syllable",
  "例如：月 / 亮（回车填下一个）": "e.g. moon / light (Enter for the next one)",
  "延音线：同音相连，延长时值": "Tie: joins two notes of the same pitch into one longer value",
  "连奏线：将相邻音连贯吹奏": "Slur: play the neighbouring notes smoothly together",
  删除选中音符: "Delete selected note",
  "已是支持的最长时值": "Already the longest note value supported",
  "已是支持的最短时值": "Already the shortest note value supported",
  "想让 AI 帮你转谱？": "Want an AI to transcribe for you?",
  "用“曲谱转哨笛洞洞谱”skill 识别图片，再把生成的曲谱导入这里继续编辑。":
    "Use the “score to whistle tablature” skill to read a picture, then import the generated score here and keep editing.",

  // ── 移调结果 ──────────────────────────────────────────────────────────────
  "移到 {target} 会把音高推出可用音域（C1–C8），请先调整音区或换个方向。":
    "Moving to {target} would push the pitches outside the usable range (C1–C8); adjust the register first or go the other way.",
  "无法移到 {target}。": "Cannot move to {target}.",
  "已整曲移调 {shift} 个半音，共 {count} 个音；现在 1 = {target}。":
    "Transposed the whole score by {shift} semitones across {count} notes; 1 = {target} now.",
  "已经在目标调上，没有需要改动的音。": "Already in the target key — nothing to change.",

  // ── 导入回执 ──────────────────────────────────────────────────────────────
  "已导入《{title}》。": "Imported “{title}”.",
  "已导入 {name}": "Imported {name}",
  "无法打开 {name}：{reason}": "Could not open {name}: {reason}",
  "打不开「{name}」：{reason}": "Could not open “{name}”: {reason}",
  "文件格式不正确": "Unrecognised file format",
  "这份曲谱有几处记法本编辑器表达不了，已按最接近的方式转换：{list}。":
    "This score uses a few notations this editor cannot express; they were converted to the closest equivalent: {list}.",
  "；": "; ",

  // ── 保存与导出回执 ────────────────────────────────────────────────────────
  "已自动保存": "Auto-saved",
  "自动保存就绪": "Auto-save ready",
  "已保存；损坏存档副本已保留": "Saved; a copy of the damaged autosave was kept",
  "自动保存失败，请使用“保存到本机”备份": "Auto-save failed — use “Save to disk” to keep a backup",
  "自动存档损坏，原始数据已备份": "The autosave was damaged; the original data has been backed up",
  "自动保存不可用，请使用“保存到本机”备份": "Auto-save unavailable — use “Save to disk” to keep a backup",
  "已保存曲谱文件": "Score file saved",
  保存失败: "Save failed",
  "正在排版并生成文件…": "Laying out and generating the file…",
  "。之后可以通过导入还原并继续编辑。": ". You can import it back later to restore and keep editing.",
  "导出失败。": "Export failed.",
  "未命名曲谱": "Untitled score",

  // ── 编解码器：MusicXML / MIDI / ABC ───────────────────────────────────────
  "没有可导出的曲谱。": "There is no score to export.",
  旋律: "Melody",
  导入曲谱: "Imported score",
  "当前时值无法用 ABC 格式准确表达。": "This note value cannot be expressed exactly in ABC.",
  "这段文本里找不到 ABC 的信息字段（X: T: M: L: Q: K: w: 其中之一），不像 ABC 记谱。若确实是 ABC 片段，请在开头补一行 K: 调号。":
    "No ABC information field (one of X: T: M: L: Q: K: w:) was found in this text, so it does not look like ABC notation. If it really is an ABC fragment, add a K: key line at the start.",
  "暂不支持带 V: 声部标记的 ABC，请先导出为单旋律版本。": "ABC with V: voice markers is not supported; export a single-voice version first.",
  "此处未标 L:，已按 ABC 规范由拍号推出单位音符长度为 1/{n}，请核对节奏":
    "No L: field here, so the unit note length was derived from the meter per the ABC standard (1/{n}); check the rhythm.",
  "此处没有可用拍号，已按 4/4 导入": "No usable meter here; imported as 4/4",
  "拍号 {meter} 暂不支持，已按 4/4 导入": "Meter {meter} is not supported; imported as 4/4",
  "和弦/文字标记不会导入": "Chord and text annotations are not imported",
  "三连音等连音记号已按比例近似（时值表里没有 1/3 拍），请核对节奏":
    "Tuplets are approximated proportionally (the note-value table has no 1/3 beat); check the rhythm.",
  "切分节奏记号（>、<）不会导入，请核对节奏": "Snap marks (>, <) are not imported; check the rhythm.",
  "装饰音（倚音等）不会导入": "Ornaments (grace notes and such) are not imported",
  "反复记号会保留为小节线，但播放不会循环反复段": "Repeat marks are kept as barlines, but playback does not loop the repeated section",
  "第一/第二房（[1、[2）的标记不会单独保留": "First/second endings ([1, [2) are not kept separately",
  "装饰记号（如 !trill!）不会导入": "Decoration marks (such as !trill!) are not imported",

  "当前浏览器不支持解压 .mxl 文件，请在记谱软件里改存为未压缩的 .musicxml。":
    "This browser cannot unzip .mxl files; save as uncompressed .musicxml in your notation software instead.",
  "这个 .mxl 文件不是有效的压缩包。": "This .mxl file is not a valid archive.",
  "这个 .mxl 压缩包里没有找到 MusicXML 文件。": "No MusicXML file was found inside this .mxl archive.",
  "这看起来不是 MusicXML 文件：没有找到 <score-partwise> 根元素。":
    "This does not look like a MusicXML file: no <score-partwise> root element found.",
  "暂不支持 <score-timewise> 结构的 MusicXML（很少见），请在记谱软件里改存 partwise 版本。":
    "MusicXML in <score-timewise> form (rare) is not supported; save a partwise version in your notation software.",
  "这份 MusicXML 里没有声部数据。": "This MusicXML has no part data.",
  "文件里有 {parts} 个声部，已导入第 1 个{name}": "The file has {parts} parts; part 1 was imported{name}",
  "（{name}）": " ({name})",
  "已略去 {n} 个装饰音（倚音不占时值，本编辑器无法表示）":
    "Skipped {n} grace notes (they take no time, which this editor cannot represent)",
  "这个声部里有 {n} 条声部线，已取音符最多的第 {voice} 条": "This part has {n} voices; voice {voice} (the densest) was used",
  "这份 MusicXML 里没有找到音符。": "No notes were found in this MusicXML.",
  "有 {n} 个音是与其他音同时发声的和弦音，已按「同时发声时取最高音」处理成单旋律":
    "{n} notes sounded together with others as chords; they were reduced to a single melody by taking the highest note",
  "文件里没有调号，已按 C 大调导入": "The file has no key signature; imported as C major",
  "文件里没有拍号，已按 4/4 导入": "The file has no meter; imported as 4/4",

  "这看起来不是标准 MIDI 文件（开头没有 MThd 标记）。": "This does not look like a standard MIDI file (no MThd marker at the start).",
  "这是按时间码记时的 MIDI（SMPTE 时基），本工具按「每分钟拍数」处理，请改用常规导出。":
    "This MIDI uses timecode (SMPTE) timing; this tool works in beats per minute, so please export with regular timing.",
  "这个 MIDI 文件里没有找到任何音轨。": "No tracks were found in this MIDI file.",
  "这个 MIDI 文件里只有打击乐轨道，没有可以记成旋律的音符。":
    "This MIDI file only has percussion tracks, with no notes that can be written as a melody.",
  "文件里有 {n} 条含音符的音轨，已导入音符最多的那条{name}":
    "The file has {n} tracks with notes; the one with the most notes was imported{name}",
  "这条音轨上有 {n} 个音与其他音同时发声（和弦/伴奏），已按「同时发声时取最高音」处理成单旋律":
    "{n} notes on this track sound together with others (chords/accompaniment); they were reduced to a single melody by taking the highest note",
  "这个 MIDI 文件里没有可用的音符。": "This MIDI file has no usable notes.",
  "有几处空隙短于三十二分音符，已略去不计": "A few gaps were shorter than a thirty-second note and were dropped",

  // ── 导入边境层 ────────────────────────────────────────────────────────────
  "部分时值超出可表示范围，已就近调整：{list}": "Some note values were outside the representable range and were nudged to the nearest: {list}",
  "有 {n} 处{mark}连的是不同音高，已按连奏线导入（谱面上画为连音弧）":
    "{n} places had a {mark} joining different pitches; imported as slurs (drawn as arcs)",
  "有 {n} 处{mark}后面没有可连的音符，已忽略": "{n} places had a {mark} with nothing to join onto; ignored",
  "旋律音域超出可处理范围，已整段{shift} {octaves} 个八度": "The melody was outside the supported range and was shifted {shift} {octaves} octave(s)",
  升高: "up",
  降低: "down",
  "，并略去 {n} 个仍然超界的音": ", dropping {n} notes that stayed out of range",
  延音线: "tie",
  连奏线: "slur",

  // ── 契约层的校验信息 ──────────────────────────────────────────────────────
  "曲谱文件格式无效：需要一个曲谱对象。": "Invalid score file: a score object is required.",
  "此曲谱文件版本暂不支持，请使用较新版本的谱间打开。": "This score file version is not supported; open it with a newer version of WhistleLoom.",
  "曲谱音符数据无效或超过 10,000 个音符。": "The note data is invalid, or there are more than 10,000 notes.",
  "曲谱标题格式无效。": "The score title is malformed.",
  "曲谱{label}“{value}”暂不支持。": "The score {label} “{value}” is not supported.",
  "曲谱{label}格式无效。": "The score {label} is malformed.",
  "曲谱拍号“{meter}”暂不支持。": "The score meter “{meter}” is not supported.",
  "曲谱速度须在 {min}–{max} BPM 之间。": "The score tempo must be between {min} and {max} BPM.",
  "第 {index} 个音符数据无效。": "Note {index} has invalid data.",
  "第 {index} 个音符音高超出可处理范围。": "Note {index} has a pitch outside the supported range.",
  "第 {index} 个音符时值暂不支持。": "Note {index} has an unsupported note value.",
  "第 {index} 个音符歌词格式无效。": "Note {index} has a malformed lyric.",
  "第 {index} 个音符小节线标记无效。": "Note {index} has a malformed barline flag.",
  "第 {index} 个音符的{mark}标记无效。": "Note {index} has a malformed {mark} flag.",
  "第 {index} 个音符的延音线必须连接到下一颗同音高音符。": "Note {index} has a tie that must connect to the next note of the same pitch.",
  主音: "tonic",

  // ── 调式名 ────────────────────────────────────────────────────────────────
  自然大调: "major",
  自然小调: "natural minor",
  多利亚调式: "Dorian",
  混合利底亚调式: "Mixolydian",
  弗里吉亚调式: "Phrygian",
  利底亚调式: "Lydian",
  洛克里亚调式: "Locrian",
  "{mode}暂不支持，已按{fallback}导入，请核对调号": "{mode} is not supported; imported as {fallback} — check the key signature.",

  // ── 时值名 ────────────────────────────────────────────────────────────────
  三十二分音符: "thirty-second note",
  十六分音符: "sixteenth note",
  附点十六分音符: "dotted sixteenth note",
  八分音符: "eighth note",
  附点八分音符: "dotted eighth note",
  四分音符: "quarter note",
  附点四分音符: "dotted quarter note",
  二分音符: "half note",
  附点二分音符: "dotted half note",
  全音符: "whole note",
  附点全音符: "dotted whole note",
  倍全音符: "double whole note",
  "{value} 拍": "{value} beats",

  // ── 格式登记表 ────────────────────────────────────────────────────────────
  "ABC 记谱": "ABC notation",
  "纯文本，传统曲谱社区最通用的交换格式；再导入时少数记法会有损失":
    "Plain text, the most common exchange format in traditional-music circles; a few notations lose detail when imported back",
  "记谱软件互通的标准格式，MuseScore / Sibelius / Finale / Dorico 都能直接打开":
    "The standard notation-software interchange format; MuseScore / Sibelius / Finale / Dorico open it directly",
  "声音的时间表，扒谱工具、DAW、素材站都收；只留音高与节奏，歌词会丢":
    "A timetable of sound, accepted by transcription tools, DAWs and sample sites; keeps pitch and rhythm only, lyrics are lost",
  谱间工程文件: "WhistleLoom project file",
  "无损保存本工具的曲谱数据，用来备份或换台电脑继续编辑":
    "Losslessly stores this tool's score data — for backups, or to keep editing on another machine",
  "可逆 PDF": "Reversible PDF",
  "整曲排成一页长谱面，并把曲谱数据嵌进文件里；导入即可还原继续编辑":
    "The whole tune on one long page, with the score data embedded in the file; import it to restore and keep editing",
  "可逆 PNG": "Reversible PNG",
  "整曲长图，同样把曲谱数据嵌进文件里；导入即可还原继续编辑":
    "A long image of the whole tune, with the score data embedded; import it to restore and keep editing",
  "认不出「{name}」是什么格式。支持的格式有：": "Cannot tell what format “{name}” is. Supported formats are: ",
  "这个格式不支持导出。": "This format does not support export.",
  "已导出 {name}": "Exported {name}",

  // ── 可逆导出 / PNG / PDF ──────────────────────────────────────────────────
  "PNG 编码失败": "PNG encoding failed",
  "不是有效的 PNG 文件": "Not a valid PNG file",
  "PNG 曲谱元数据格式无效": "The PNG score metadata is malformed",
  "不支持压缩的曲谱元数据": "Compressed score metadata is not supported",
  "曲谱数据版本不受支持": "This score data version is not supported",
  "这张 PNG 没有找到谱间内嵌曲谱数据": "No embedded WhistleLoom score data was found in this PNG",
  "不是有效的 PDF 文件": "Not a valid PDF file",
  "这个 PDF 没有找到谱间内嵌曲谱数据": "No embedded WhistleLoom score data was found in this PDF",
  "原调 {key} → 简谱主音 1={tonic}": "from {key} → numbered tonic 1={tonic}",
  "简谱主音 1={tonic}": "numbered tonic 1={tonic}",
  "{key} · {mode} · {meter} 拍 · ♩={tempo} BPM · 爱尔兰哨笛 {whistle} 调":
    "{key} · {mode} · {meter} · ♩={tempo} BPM · Irish whistle in {whistle}",
  " · 原速 ♩={original} BPM": " · original ♩={original} BPM",
  "原调 {key} → ": "from {key} → ",
  "（原速 {tempo} BPM）": " (original ♩={tempo} BPM)",
  "爱尔兰哨笛 {key} 调": "Irish whistle in {key}",
  "词：{name}": "Lyrics: {name}",
  "曲：{name}": "Music: {name}",
  "编配：{name}": "Arranged: {name}",
  歌词: "Lyrics",
  简谱: "Numbered",
  哨笛指法: "Whistle tab",
  指法: "Fingering",
  "谱面图层：{layers}": "Score layers: {layers}",
  "请先在右侧开启至少一个谱面图层，再导出。": "Turn on at least one score layer on the right before exporting.",
  "这次导出会带上：{layers}。": "This export will include: {layers}.",
  "四层图层现在都是关着的，导出的谱面会是空白 —— 想留下内容，请先在右侧打开至少一层。":
    "All four layers are off, so the exported score would be blank — switch on at least one layer on the right to keep anything.",
  "曲谱太长，超出浏览器单张画布的安全尺寸；请改用可逆 PDF 导出。":
    "The score is too long for a single browser canvas; export a reversible PDF instead.",
  "浏览器无法创建导出画布，导出失败。": "The browser could not create the export canvas, so the export failed.",
  "生成图像失败": "Image generation failed",
  曲谱: "Score",
  "曲谱太长，超出 PDF 单页尺寸上限；请改用 PNG 导出。":
    "The score is too long for a single PDF page; export PNG instead.",
  "曲谱还没有音符，无法导出。": "The score has no notes yet, so there is nothing to export.",

  // ── 唱名外的零碎 ──────────────────────────────────────────────────────────
  "{pitch} 指法": "{pitch} fingering",
  "{pitch} 指法，交叉指法": "{pitch} fingering, cross fingering",
  "此音需要半孔或本版本尚无可靠指法": "This note needs a half hole, or has no reliable fingering in this version",
  // ── 吹不出来的音 ──────────────────────────────────────────────────────────
  // 谱面上的记号只有一个字宽，中英各选自己最短的说法：中文用「低」「高」，
  // 英文那两个词塞不进直径 18px 的圆，改用最直观的箭头。
  低: "↓",
  高: "↑",
  "太低，低于这支哨笛的最低音": "Too low — below this whistle's lowest note",
  "太高，超出这支哨笛的音域": "Too high — above this whistle's range",
  "这支哨笛吹不出 {count} 个音（{list}），已在谱面上标红。试试换一支哨笛，或用「整体移调」把这个调换掉。":
    "{count} notes cannot be played on this whistle ({list}); they are marked in red on the score. Try another whistle key, or transpose the whole score.",
  "低音 {n} 个": "{n} below range",
  "高音 {n} 个": "{n} above range",
  "无指法 {n} 个": "{n} without fingering",
  "、": ", ",
  "第 {index} 小节五线谱": "Staff for measure {index}",
  "第 {index} 个音符，{pitch}，时值 {duration} 拍": "Note {index}, {pitch}, {duration} beats",
  "，歌词 ": ", lyric ",
  "，已选中": ", selected",
  "第 {index} 个音符 · {pitch} · {duration} 拍": "Note {index} · {pitch} · {duration} beats",
  // 写进导出文件里的产品标识（MusicXML 的 <software>、PDF 的 /Creator）。
  "WhistleLoom · 谱间": "WhistleLoom · Score Room",

  // ── 曲种名（thesession.org 的行话，英文原词才是通用写法） ─────────────────
  里尔舞曲: "reel",
  吉格舞曲: "jig",
  号管舞曲: "hornpipe",
  波尔卡: "polka",
  滑步吉格: "slip jig",
  滑步舞曲: "slide",
  华尔兹: "waltz",
  玛祖卡: "mazurka",
  进行曲: "march",
  抒情曲: "air",
  斯特拉斯佩舞曲: "strathspey",
  谷仓舞曲: "barndance",
  三拍二舞曲: "three-two",
  组舞曲: "set dance",

  // ── 曲库接入层 ────────────────────────────────────────────────────────────
  "thesession.org 曲库": "thesession.org tune library",
  "曲目来自 {source}（ODbL 1.0）": "tune from {source} (ODbL 1.0)",
  未命名曲调: "Untitled tune",
  "曲库返回了 {status}，请稍后重试。": "The tune library returned {status}; please try again later.",
  "曲库请求超时。请检查网络，或改用内置曲库。": "The tune library request timed out. Check your connection, or use the built-in library.",
  "连不上 thesession.org。请检查网络或代理，或改用内置曲库。":
    "Cannot reach thesession.org. Check your connection or proxy, or use the built-in library.",
  "曲库请求失败。": "The tune library request failed.",
  连不上曲库: "cannot reach the tune library",

  // ── 页脚 ──────────────────────────────────────────────────────────────────
  "指法以标准六孔哨笛为基础；半孔与特殊替代指法请结合实际乐器校对。":
    "Fingerings are for a standard six-hole whistle; check half-holes and alternative fingerings against your own instrument.",
  界面语言: "Interface language",
  "切换界面语言": "Switch interface language",

  // ── 导入 / 导出面板 ───────────────────────────────────────────────────────
  关闭: "Close",
  曲谱标题: "Score title",
  "导入 / 导出": "Import / Export",
  "把曲谱带进来，或者带出去": "Bring a score in, or take one out",
  "导入或导出": "Import or export",
  "把文件拖到这里": "Drop a file here",
  "也可以直接拖到页面任意位置，或": "You can also drop it anywhere on the page, or",
  "选择文件…": "Choose a file…",
  支持的格式: "Supported formats",
  "导入会把文件里的音符读成本编辑器的曲谱，读不成的地方一律在谱面上方写明，不会悄悄改掉。":
    "Importing reads the notes in the file into this editor's score. Anything that could not be read is written above the score — nothing is changed behind your back.",
  "导出会按右侧当前开启的图层排版，并显示标题、调式、拍号、速度和曲谱署名。PDF 与 PNG 按同一张「完整长页」输出：整首曲子排在一页里，谱行左右两端顶到版心边缘，不会在小节中间断开。标着「可逆」的格式会把曲谱数据嵌进文件，之后可以通过导入还原并继续编辑。":
    "Export lays the score out using whichever layers are switched on at the right, and prints the title, mode, meter, tempo and credits. PDF and PNG share one “complete long page”: the whole tune on a single page, with each staff line reaching the margins and no break in the middle of a measure. Formats marked “reversible” embed the score data in the file, so you can import it back later to restore and keep editing.",
  "指法图": "Fingering",
};

// 语言表 + 归一化索引。归一化就是「把连续的空白压成一个空格再掐头去尾」：HTML 里
// 一段文字常常因为缩进而带换行和多余空格，写进语言表时不可能逐个对齐，所以两边都过一遍。
const I18N_TABLES = { [I18N_LANG_EN]: I18N_EN };
const i18nIndex = {};
const i18nMarks = [];
let i18nActive = "";

function i18nNorm(text) {
  return String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    // 中文正文在 HTML 里为了排版换的行，压完空白会留下一个空格；可中文本来就不在字
    // 之间打空格，这个空格是排版留下的脏字符 —— 不去掉的话「…编辑器能↵表达的记法…」
    // 归一化后是「能 表达」，而语言表里是「能表达」，查不到，英文界面下会印出中文。
    // 只吃「夹在两个汉字/全角字之间」的那一个空格：汉字与拉丁字母之间的空格是真空格
    // （「ABC 片段」「1 个音符」），必须留着。
    .replace(/([\u4e00-\u9fff\uff01-\uff5e]) +(?=[\u4e00-\u9fff\uff01-\uff5e])/g, "$1")
    // 句末标点后面的空格同理：「。PDF」被 HTML 换行拆成「。↵PDF」，压出来是「。 PDF」。
    // 中文排版在句末标点后面不打空格，所以这类空格也是排版产物。这一条**只看标点**，
    // 不看两边是不是汉字，因为后边常常跟着拉丁词（PDF、PNG、AI）。
    .replace(/([\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]) +/g, "$1");
}
for (const [code, table] of Object.entries(I18N_TABLES)) {
  const normalized = {};
  for (const [key, value] of Object.entries(table)) normalized[i18nNorm(key)] = value;
  i18nIndex[code] = normalized;
}

// 当前语言。判定顺序：?lang= → localStorage → navigator.language → zh。
// 任何一步抛错（Node 里没有 location / localStorage / navigator）都直接跳过，
// 所以这个函数在命令行环境下稳落地返回中文。
function i18nDetect() {
  if (typeof location !== "undefined" && location.search) {
    try {
      const asked = new URLSearchParams(location.search).get("lang");
      if (asked && i18nHasLang(asked)) return asked;
    } catch (_) {}
  }
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(I18N_STORAGE_KEY) : null;
    if (stored && i18nHasLang(stored)) return stored;
  } catch (_) {}
  try {
    const tag = String(navigator.language || navigator.userLanguage || "");
    if (tag) return /^zh/i.test(tag) ? I18N_LANG_ZH : I18N_LANG_EN;
  } catch (_) {}
  return I18N_SOURCE_LANG;
}
function i18nHasLang(code) {
  return code === I18N_SOURCE_LANG || Boolean(i18nIndex[code]);
}
function i18nLang() {
  if (!i18nActive) i18nActive = i18nDetect();
  return i18nActive;
}
function i18nMeta(code = i18nLang()) {
  return I18N_LANGS.find((item) => item.code === code) || I18N_LANGS[0];
}

// 把一个或多个 {名字} 换成值。没给的值原样留着 —— 让 {name} 印在界面上比印空白更容易发现。
function i18nFill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
/**
 * 取一段文案的当前语言版本。
 * @param {string} text 中文原文（也就是语言表里的键）
 * @param {object} [vars] `{名字}` 占位符的值
 */
function tr(text, vars) {
  const raw = String(text == null ? "" : text);
  const code = i18nLang();
  if (code !== I18N_SOURCE_LANG) {
    const hit = i18nIndex[code]?.[i18nNorm(raw)];
    if (hit !== undefined) return i18nFill(hit, vars);
  }
  return i18nFill(raw, vars);
}
// 把 current 换成「格式化后的文案」，便于调用点写成一行。
function trf(text, vars) {
  return tr(text, vars);
}

/**
 * 登记页面上的静态文案。**只登记一次**，记的是原文 ——
 * 之后来回切换语言都从原文重渲染，不会「英文再翻成中文」层层套娃。
 */
function i18nPrepare(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope || i18nMarks.length) return;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    i18nMarks.push({ el, kind: "text", raw: el.textContent });
  });
  // 只替换开头那个裸文本节点：`<label>乐器<select>…</select></label>` 这种结构里，
  // 整个 textContent 是「文字 + 控件」，一把换掉会把控件删掉。
  scope.querySelectorAll("[data-i18n-lead]").forEach((el) => {
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;
      if (!i18nNorm(node.nodeValue)) continue;
      i18nMarks.push({ el, kind: "node", node, raw: node.nodeValue });
      break;
    }
  });
  scope.querySelectorAll("[data-i18n-attrs]").forEach((el) => {
    for (const name of String(el.getAttribute("data-i18n-attrs")).split(/\s+/)) {
      if (!name || !el.hasAttribute(name)) continue;
      i18nMarks.push({ el, kind: "attr", name, raw: el.getAttribute(name) });
    }
  });
}

/** 按当前语言把登记过的文案全部重写一遍。幂等。 */
function i18nApply() {
  for (const mark of i18nMarks) {
    const value = tr(mark.raw);
    if (mark.kind === "text") mark.el.textContent = value;
    else if (mark.kind === "node") mark.node.nodeValue = value;
    else mark.el.setAttribute(mark.name, value);
  }
  // <html lang> 不在 marks 里（它不是文案，是语言标记），单独跟着语言一起改。
  // 屏幕阅读器和浏览器的「翻译此页」提示都读它，漏了它等于半个没适配。
  if (typeof document !== "undefined") document.documentElement.lang = i18nMeta().htmlLang;
}
/**
 * 切到另一种语言：记住选择、重写静态文案、更新 <html lang>。
 * 页面上那些**由脚本生成**的部分（下拉选项、导出卡片、状态行……）不在这里重建 ——
 * app.js 里有个 applyLanguage() 负责把那些一并刷新，因为只有它知道它们的出处。
 */
function i18nSetLang(code) {
  const wanted = i18nHasLang(code) ? code : I18N_SOURCE_LANG;
  i18nActive = wanted;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(I18N_STORAGE_KEY, wanted);
  } catch (_) {}
  i18nApply();
  return wanted;
}

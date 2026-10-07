/* 格式登记表：本工具支持的全部导入/导出格式，只在这里写一遍。
 *
 * 为什么要有一张表：格式清单会同时被四个地方用到 ——
 *   ① 文件选择框的 accept 属性（能选哪些后缀）
 *   ② 拖放时的分流（这个文件该给谁处理）
 *   ③ 导出面板上的按钮列表（有哪些格式可导出）
 *   ④ 导入面板上的格式说明（支持什么、会有什么损失）
 * 过去这些是各写各的，于是「界面里写着支持、代码里其实没接」这类问题迟早出现。
 * 现在加一个格式只需要在这一张表里加一条，四个地方一起生效。
 *
 * 每条格式声明「怎么读文件」（read）、「怎么变成曲谱」（import）、「怎么变出去」（export）。
 * 三件 tool 的约定：
 *   read:      "text"  读成字符串      "bytes" 读成字节      "file" 直接拿 File 对象
 *   import:    收到 { file, name, text?, bytes? }，返回曲谱对象（可以是 async）
 *   importText: 只给「文本格式」面板用 —— 面板手里只有一段字符串，没有文件也没有字节。
 *               像 MusicXML 这种文件导入要字节（可能要解 .mxl）、粘贴却只能给文本的格式，
 *               两条路就是两个函数。没写 importText 时，面板沿用 import。
 *   export:    收到 (曲谱, { paper, print })，返回 { name, data, mime } —— data 是字符串或字节；
 *              返回空值表示「这个格式自己完成了保存动作」（PDF / 打印就是这种）
 *   text:      true 表示这种格式本身是纯文本，会出现在「文本格式」面板的下拉里
 *   reversible: true 表示导出的文件里原样嵌了曲谱数据，再导入可以一字不差地还原
 */
const SCORE_FORMATS = [
  {
    id: "abc",
    label: "ABC 记谱",
    hint: "纯文本，传统曲谱社区最通用的交换格式；再导入时少数记法会有损失",
    extensions: [".abc", ".txt"],
    read: "text",
    text: true,
    mime: "text/plain;charset=utf-8",
    import: ({ text }) => parseAbc(text),
    export: (source) => ({
      name: `${scoreBaseName(source.title)}.abc`,
      data: generateAbc(source),
      mime: "text/plain;charset=utf-8",
    }),
  },
  {
    id: "musicxml",
    label: "MusicXML",
    hint: "记谱软件互通的标准格式，MuseScore / Sibelius / Finale / Dorico 都能直接打开",
    extensions: [".musicxml", ".xml", ".mxl"],
    read: "bytes",
    text: true,
    mime: "application/vnd.recordare.musicxml",
    import: ({ bytes }) => musicXmlFromBytes(bytes),
    importText: ({ text }) => musicXmlToScore(text),
    export: (source) => ({
      name: `${scoreBaseName(source.title)}.musicxml`,
      data: generateMusicXml(source),
      mime: "application/vnd.recordare.musicxml",
    }),
  },
  {
    id: "midi",
    label: "MIDI",
    hint: "声音的时间表，扒谱工具、DAW、素材站都收；只留音高与节奏，歌词会丢",
    extensions: [".mid", ".midi"],
    read: "bytes",
    mime: "audio/midi",
    import: ({ bytes }) => parseMidiFile(bytes),
    export: (source) => ({
      name: `${scoreBaseName(source.title)}.mid`,
      data: generateMidi(source),
      mime: "audio/midi",
    }),
  },
  {
    id: "json",
    label: "谱间工程文件",
    hint: "无损保存本工具的曲谱数据，用来备份或换台电脑继续编辑",
    extensions: [".json"],
    read: "text",
    reversible: true,
    mime: "application/json",
    import: ({ text }) => importJson(JSON.parse(text)),
    export: (source) => ({
      name: scoreFilename(source.title),
      data: JSON.stringify(source, null, 2),
      mime: "application/json",
    }),
  },
  {
    id: "pdf",
    label: "可逆 PDF",
    hint: "整曲排成一页长谱面，并把曲谱数据嵌进文件里；导入即可还原继续编辑",
    extensions: [".pdf"],
    read: "file",
    reversible: true,
    import: ({ file }) => ScoreExport.scoreFromPdf(file),
    export: async (source, { paper }) => {
      await ScoreExport.exportPdf(paper, source);
    },
  },
  {
    id: "png",
    label: "可逆 PNG",
    hint: "整曲长图，同样把曲谱数据嵌进文件里；导入即可还原继续编辑",
    extensions: [".png"],
    read: "file",
    reversible: true,
    import: ({ file }) => ScoreExport.scoreFromPng(file),
    export: async (source, { paper }) => {
      await ScoreExport.exportPng(paper, source);
    },
  },
  {
    id: "print",
    label: "普通打印",
    hint: "走浏览器自己的分页流程，适合直接出纸质谱",
    extensions: [],
    read: null,
    print: true,
    export: (source, { print }) => print(),
  },
];

function formatById(id) {
  return SCORE_FORMATS.find((format) => format.id === id);
}
// 文件选择框的 accept：从登记表生成，界面里不再手抄一份后缀列表。
function importAcceptAttribute() {
  const extensions = SCORE_FORMATS.filter((format) => format.import).flatMap(
    (format) => format.extensions,
  );
  return [...new Set(extensions)].join(",");
}
function extensionOf(name) {
  const at = String(name || "").lastIndexOf(".");
  return at < 0 ? "" : String(name).slice(at).toLowerCase();
}
// 这两个后缀什么格式都可能是，算不上「格式声明」：.txt 是纯文本的统称，.xml 是整个
// XML 家族的通用后缀。它们仍然要留在 accept 列表里（用户手里就有这样的文件），
// 但不能拿它们当分流依据 —— 否则一个叫「随手记.txt」的散文文件会被丢给 ABC 解析器，
// 报出来的是「这不像 ABC」，而用户真正的问题是「这压根不是谱」。
const GENERIC_EXTENSIONS = [".txt", ".xml"];
function formatForExtension(name) {
  const extension = extensionOf(name);
  if (!extension || GENERIC_EXTENSIONS.includes(extension)) return null;
  return (
    SCORE_FORMATS.find(
      (format) => format.import && format.extensions.includes(extension),
    ) || null
  );
}
// 二进制格式没法当文本看，只能认开头的魔数。
// .mxl 就是 zip，所以它和 MusicXML 共用一条 —— musicXmlFromBytes 自己会判断要不要解压。
const BINARY_SIGNATURES = [
  { magic: [0x25, 0x50, 0x44, 0x46], id: "pdf" }, // %PDF
  { magic: [0x89, 0x50, 0x4e, 0x47], id: "png" }, // \x89PNG
  { magic: [0x50, 0x4b, 0x03, 0x04], id: "musicxml" }, // PK\x03\x04 → 打包成 zip 的 .mxl
  { magic: [0x4d, 0x54, 0x68, 0x64], id: "midi" }, // MThd
];
function formatForBytes(bytes) {
  const hit = BINARY_SIGNATURES.find(({ magic }) =>
    magic.every((byte, index) => bytes[index] === byte),
  );
  return hit ? formatById(hit.id) : null;
}
// 按内容认格式：先认二进制魔数，不是的话当文本嗅探。
// 嗅探是必须的：很多人会把 MusicXML 存成 .txt，把 ABC 存成 .txt，或者干脆没有后缀。
function formatForContent(bytes) {
  return formatForBytes(bytes) || formatForFile("", decodeTextBytes(bytes));
}
function formatForFile(name, text) {
  const byExtension = formatForExtension(name);
  if (byExtension) return byExtension;
  if (text != null) {
    if (looksLikeMusicXml(text)) return formatById("musicxml");
    if (/^\s*(?:X:|T:|K:)/m.test(text)) return formatById("abc");
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.events))
        return formatById("json");
    } catch (_) {
      // 不是 JSON，继续往下试。
    }
  }
  return null;
}
// 打开一个文件，返回曲谱。
//
// 分流顺序是「内容优先、后缀兜底」，不是反过来。原因是后缀经常是错的：用户把 MusicXML
// 另存成 .txt、把 .mxl 改名成 .xml、或者从网页上存下来的文件压根没有后缀。只认后缀
// 会把一整份 XML 丢给 ABC 解析器 —— ABC 解析器非常宽容，它不会报错，而是把 XML 标签
// 当音符嚼出几百个垃圾音，用户拿到一份「看起来像谱子」的废数据。所以：先读字节、先认
// 魔数、先嗅内容；内容认不出来时，才退回后缀对应的解析器（这时它该报错就报错）。
async function importScoreFromFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format =
    formatForContent(bytes) || formatForExtension(file.name);
  if (!format) throw new Error(unknownFormatMessage(file.name));
  const payload = { file, name: file.name, bytes };
  if (format.read === "text") payload.text = decodeTextBytes(bytes);
  return await format.import(payload);
}
function unknownFormatMessage(name) {
  // label 在登记表里是中文原文（也就是语言表的键），翻译要发生在它「进入界面」的这里；
  // 每条后面的「（后缀）」借用语言表里现成的括号键来拼，免得把全角括号写死在代码里。
  return (
    tr("认不出「{name}」是什么格式。支持的格式有：", { name }) +
    SCORE_FORMATS.filter((item) => item.import)
      .map((item) =>
        tr(item.label) + tr("（{name}）", { name: item.extensions.join(" ") }),
      )
      .join("、")
  );
}
function downloadBlob(name, data, mime) {
  const target = document.createElement("a");
  const url = URL.createObjectURL(new Blob([data], { type: mime || "application/octet-stream" }));
  target.href = url;
  target.download = name;
  target.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// 用指定格式导出。返回一段给人看的说明文字（也可能什么都不返回）。
async function exportScoreWith(id, source, context = {}) {
  const format = formatById(id);
  if (!format?.export) throw new Error(tr("这个格式不支持导出。"));
  const result = await format.export(source, context);
  if (!result) return ""; // 格式自己完成了保存（PDF / 打印）
  downloadBlob(result.name, result.data, result.mime);
  return tr("已导出 {name}", { name: result.name });
}

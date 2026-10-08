/* Reversible exports: PNG iTXt metadata and PDF EmbeddedFile attachment. */
(() => {
  const MARKER = "score-studio/1";
  // 导出页面：一张「虚拟纸张」，内容宽度固定，PDF 再按纸张比例整体缩放贴上去。
  const EXPORT_CONTENT_WIDTH = 1004;
  const EXPORT_PADDING_X = 58;
  const EXPORT_PAGE_WIDTH = EXPORT_CONTENT_WIDTH + EXPORT_PADDING_X * 2;
  // 位图按 2 倍像素生成，贴进 PDF 时再折半，等于 2 倍超采样。
  const EXPORT_PIXEL_RATIO = 2;
  // PDF 写成「完整长页」：整首曲子只占一页，页宽固定成 A4 横向的 842pt（打印时
  // 一律缩放这一页，得到的就是一张连续的长谱，不会在小节中间断开），页高按长宽比
  // 等比放大。PDF 规范里单页最长 14400 单位（200 英寸），超过就退回 PNG 导出。
  const PDF_LONG_PAGE_WIDTH = 842;
  const PDF_MAX_PAGE_HEIGHT = 14400;
  const encoder = new TextEncoder();
  const bytes = (s) => encoder.encode(s);
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  function crc32(data) {
    let crc = -1;
    for (const b of data) {
      crc ^= b;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
  }
  function pngChunk(type, data) {
    const t = bytes(type), body = concat(t, data);
    return concat(u32(data.length), body, u32(crc32(body)));
  }
  function pngWithScore(blob, score) {
    return blob.arrayBuffer().then((buffer) => {
      const png = new Uint8Array(buffer), sig = png.subarray(0, 8);
      if (String.fromCharCode(...sig) !== "\x89PNG\r\n\x1a\n") throw new Error(tr("PNG 编码失败"));
      const payload = bytes(JSON.stringify({ app: MARKER, score }));
      // iTXt: keyword terminator, compression flag/method, language terminator,
      // translated-keyword terminator. Five NUL bytes precede the payload.
      const keyword = bytes("ScoreStudio\0\0\0\0\0");
      const data = concat(keyword, payload);
      const ihdrLength = new DataView(buffer).getUint32(8);
      const afterIhdr = 8 + 12 + ihdrLength;
      return new Blob([png.subarray(0, afterIhdr), pngChunk("iTXt", data), png.subarray(afterIhdr)], { type: "image/png" });
    });
  }
  async function scoreFromPng(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...data.subarray(0, 8)) !== "\x89PNG\r\n\x1a\n") throw new Error(tr("不是有效的 PNG 文件"));
    const decoder = new TextDecoder();
    for (let p = 8; p + 12 <= data.length;) {
      const len = new DataView(data.buffer, data.byteOffset + p, 4).getUint32(0);
      if (p + 12 + len > data.length) break;
      const type = decoder.decode(data.subarray(p + 4, p + 8));
      if (type === "iTXt") {
        const chunk = data.subarray(p + 8, p + 8 + len), zero = chunk.indexOf(0);
        if (decoder.decode(chunk.subarray(0, zero)) === "ScoreStudio") {
          let q = zero + 1;
          const compressed = chunk[q++]; q++; // compression flag and method
          const langEnd = chunk.indexOf(0, q);
          if (langEnd < 0) throw new Error(tr("PNG 曲谱元数据格式无效"));
          const translatedEnd = chunk.indexOf(0, langEnd + 1);
          q = translatedEnd < 0 ? langEnd + 1 : translatedEnd + 1;
          if (compressed) throw new Error(tr("不支持压缩的曲谱元数据"));
          const payload = decoder.decode(chunk.subarray(q));
          let envelope;
          try { envelope = JSON.parse(payload); }
          catch (error) {
            // Earlier 谱间 builds omitted the translated-keyword terminator,
            // shifting the JSON payload one byte left. Continue to recover those files.
            if (!payload.startsWith('"app"')) throw error;
            envelope = JSON.parse(`{${payload}`);
          }
          if (envelope.app !== MARKER) throw new Error(tr("曲谱数据版本不受支持"));
          return envelope.score;
        }
      }
      p += 12 + len;
    }
    throw new Error(tr("这张 PNG 没有找到谱间内嵌曲谱数据"));
  }
  async function scoreFromPdf(file) {
    const data = new Uint8Array(await file.arrayBuffer()), decoder = new TextDecoder("latin1");
    const text = decoder.decode(data);
    if (!text.startsWith("%PDF-")) throw new Error(tr("不是有效的 PDF 文件"));
    const marker = "/Type /EmbeddedFile";
    let pos = text.indexOf(marker);
    while (pos >= 0) {
      const streamAt = text.indexOf("stream", pos);
      const dict = text.slice(pos, streamAt);
      const length = Number(dict.match(/\/Length\s+(\d+)/)?.[1]);
      if (Number.isInteger(length)) {
        let start = streamAt + 6;
        if (text[start] === "\r" && text[start + 1] === "\n") start += 2;
        else if (text[start] === "\n" || text[start] === "\r") start++;
        try {
          const envelope = JSON.parse(new TextDecoder().decode(data.subarray(start, start + length)));
          if (envelope.app === MARKER) return envelope.score;
        } catch (_) { /* Try another embedded file, if present. */ }
      }
      pos = text.indexOf(marker, pos + marker.length);
    }
    throw new Error(tr("这个 PDF 没有找到谱间内嵌曲谱数据"));
  }
  function cleanClone(paper, score, contentWidth = EXPORT_CONTENT_WIDTH) {
    const clone = paper.cloneNode(true);
    clone.querySelectorAll(".score-toolbar, #fitScore").forEach((n) => n.remove());
    clone.querySelectorAll(".selected, .playing, .active").forEach((n) => n.classList.remove("selected", "playing", "active"));
    // ★ 这里**不做布局**。布局要重新折行，而连线覆盖层是按符头/唱名的真实像素
    // 位置量出来的 —— cloneNode 刚出来的节点还游离在文档外，量什么都是 0，
    // renderConnections 会一条线都不画（见下面 staging 的说明）。
    // 所以布局连同画线一起挪到 staging 里：插进文档 → 布局 → 画线，三步原子完成。
    clone.dataset.contentWidth = String(contentWidth);
    const heading = clone.querySelector(".paper-heading");
    if (heading && score) {
      const doc = heading.ownerDocument;
      const centered = doc.createElement("header");
      centered.className = "paper-heading export-heading";
      const title = doc.createElement("h1");
      title.className = "export-heading-title";
      title.textContent = score.title || tr("未命名曲谱");
      centered.append(title);
      if (score.subtitle) {
        const subtitle = doc.createElement("div");
        subtitle.className = "export-heading-subtitle";
        subtitle.textContent = score.subtitle;
        centered.append(subtitle);
      }
      // 调式名从 music.js 的 MODE_LABELS 取。这里过去自己写了一份
      // { major, minor, dorian } 的小表，漏了混合利底亚 —— 一首 D 混合利底亚的曲子
      // 导出后谱头上印的是「自然大调」，而它那个 C 本位会立刻打脸。
      const modeName = modeLabel(score.mode);
      const keyDescription = score.sourceTonic && score.sourceTonic !== score.tonic
        ? tr("原调 {key} → 简谱主音 1={tonic}", {
            key: score.sourceTonic,
            tonic: score.tonic,
          })
        : tr("简谱主音 1={tonic}", { tonic: score.tonic });
      const meta = doc.createElement("div");
      meta.className = "export-heading-meta";
      meta.textContent =
        tr("{key} · {mode} · {meter} 拍 · ♩={tempo} BPM · 爱尔兰哨笛 {whistle} 调", {
          key: keyDescription,
          mode: modeName,
          meter: score.meter,
          tempo: score.tempo,
          whistle: score.whistleKey,
        }) +
        (score.originalTempo && Number(score.originalTempo) !== Number(score.tempo)
          ? tr(" · 原速 ♩={original} BPM", { original: score.originalTempo })
          : "");
      const credits = [
        score.lyricist && tr("词：{name}", { name: score.lyricist }),
        score.composer && tr("曲：{name}", { name: score.composer }),
        score.arranger && tr("编配：{name}", { name: score.arranger }),
      ].filter(Boolean);
      if (credits.length) {
        const creditLine = doc.createElement("div");
        creditLine.className = "export-heading-credits";
        creditLine.textContent = credits.join("　·　");
        // 调式信息与署名同一行两端对齐，外缘和谱面行的左右边缘在一条竖线上。
        const row = doc.createElement("div");
        row.className = "export-heading-row";
        row.append(meta, creditLine);
        centered.append(row);
      } else {
        centered.append(meta);
      }
      const layerNames = [
        [".staff-layer", "五线谱"],
        [".numbers-layer", "简谱"],
        [".lyrics-layer", "歌词"],
        [".holes-layer", "哨笛指法"],
      ].filter(([selector]) => clone.querySelector(selector) && !clone.querySelector(selector).classList.contains("hidden"))
        .map(([, label]) => tr(label));
      if (layerNames.length) {
        const layers = doc.createElement("div");
        layers.className = "export-heading-layers";
        layers.textContent = tr("谱面图层：{layers}", { layers: layerNames.join(" · ") });
        centered.append(layers);
      }
      heading.replaceWith(centered);
    }
    clone.classList.add("export-paper");
    clone.style.cssText = `box-sizing:border-box;width:${contentWidth + EXPORT_PADDING_X * 2}px;min-height:0;margin:0 auto;padding:28px ${EXPORT_PADDING_X}px;background:#fffefa;border:0;border-radius:0;box-shadow:none;overflow:visible;color:#212820`;
    clone.querySelector("#scoreView")?.style.setProperty("zoom", "1");
    return clone;
  }
  // 把 clone 暂存到屏幕外（left:-12000px），**并且在这里完成谱面布局与连线绘制**。
  //
  // 为什么布局必须在这里做：曲谱要按导出纸张的宽度重新折行，而延音线 / 连奏线是
  // renderConnections 用 getBoundingClientRect() 量出符头与唱名的真实像素位置后，
  // 再画的一层绝对定位 svg。cloneNode 出来的节点游离在文档之外，getBoundingClientRect
  // 一律返回 0，量出来的每一行都是「宽 0 高 0」，renderConnections 内部
  // `if (!width || !height) continue` 直接跳过 —— **一条线都不画，而且不报错**。
  //
  // 这就是「屏幕上有延音线、打印也有，唯独 PNG / PDF 导出没有」的原因：打印路径
  // 操作的是页面上真实的 #scoreView（一直连着文档），导出路径操作的是这个克隆体。
  // 修法是把顺序钉死：先 append 进文档 → 再布局 → 再画线。
  function staging(clone, score) {
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-12000px;top:0;width:${EXPORT_PAGE_WIDTH}px;z-index:-1;background:white`;
    host.append(clone); document.body.append(host);
    const view = clone.querySelector("#scoreView");
    if (view && score && typeof layoutScoreInto === "function") {
      const contentWidth = Number(clone.dataset.contentWidth) || EXPORT_CONTENT_WIDTH;
      // 节点此刻已连上文档，layoutScoreInto 会在重建之后把连线画好，返回值是曲线条数。
      const drawn = layoutScoreInto(view, contentWidth, score, { stretch: true });
      // 兜底再补一次。不做静默容忍 —— 位图里少几条线比导出失败更隐蔽，宁可多画一遍。
      if (!drawn) renderConnections(view, score.events);
    }
    return host;
  }
  function requireVisibleLayer(paper) {
    const selectors = [".staff-layer", ".numbers-layer", ".lyrics-layer", ".holes-layer"];
    if (!selectors.some((selector) => [...paper.querySelectorAll(selector)].some((node) => !node.classList.contains("hidden")))) {
      throw new Error(tr("请先在右侧开启至少一个谱面图层，再导出。"));
    }
  }
  function drawInlineSvg(ctx, svg, rootRect, scale) {
    const alpha = (value, fallback = 1) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const elements = [svg, ...svg.querySelectorAll("*")];
    for (const node of elements) {
      const tag = node.localName;
      if (!["path", "line", "circle", "ellipse", "rect", "polygon", "polyline", "text", "tspan"].includes(tag)) continue;
      const style = getComputedStyle(node), matrix = node.getScreenCTM();
      if (!matrix || style.display === "none" || style.visibility === "hidden") continue;
      ctx.save();
      ctx.setTransform(scale * matrix.a, scale * matrix.b, scale * matrix.c, scale * matrix.d,
        scale * (matrix.e - rootRect.left), scale * (matrix.f - rootRect.top));
      ctx.globalAlpha = alpha(style.opacity);
      ctx.lineWidth = Number.parseFloat(style.strokeWidth) || 1;
      ctx.lineCap = style.strokeLinecap || "butt";
      ctx.lineJoin = style.strokeLinejoin || "miter";
      ctx.miterLimit = Number.parseFloat(style.strokeMiterlimit) || 4;
      ctx.setLineDash(style.strokeDasharray === "none" ? [] : style.strokeDasharray.split(/[ ,]+/).map(Number).filter(Number.isFinite));
      const fill = style.fill !== "none";
      const stroke = style.stroke !== "none";
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      const paint = (path) => {
        if (fill) { ctx.globalAlpha = alpha(style.opacity) * alpha(style.fillOpacity); ctx.fill(path, style.fillRule === "evenodd" ? "evenodd" : "nonzero"); }
        if (stroke && ctx.lineWidth > 0) { ctx.globalAlpha = alpha(style.opacity) * alpha(style.strokeOpacity); ctx.stroke(path); }
      };
      if (tag === "path") {
        const d = node.getAttribute("d"); if (d) paint(new Path2D(d));
      } else if (tag === "line") {
        const path = new Path2D(); path.moveTo(Number(node.getAttribute("x1")) || 0, Number(node.getAttribute("y1")) || 0); path.lineTo(Number(node.getAttribute("x2")) || 0, Number(node.getAttribute("y2")) || 0); paint(path);
      } else if (tag === "circle" || tag === "ellipse") {
        const path = new Path2D(), x = Number(node.getAttribute("cx")) || 0, y = Number(node.getAttribute("cy")) || 0;
        path.ellipse(x, y, tag === "circle" ? Number(node.getAttribute("r")) || 0 : Number(node.getAttribute("rx")) || 0,
          tag === "circle" ? Number(node.getAttribute("r")) || 0 : Number(node.getAttribute("ry")) || 0, 0, 0, Math.PI * 2); paint(path);
      } else if (tag === "rect") {
        const path = new Path2D(); path.rect(Number(node.getAttribute("x")) || 0, Number(node.getAttribute("y")) || 0, Number(node.getAttribute("width")) || 0, Number(node.getAttribute("height")) || 0); paint(path);
      } else if (tag === "polygon" || tag === "polyline") {
        const pairs = (node.getAttribute("points") || "").trim().split(/[ ,]+/).map(Number), path = new Path2D();
        for (let i = 0; i + 1 < pairs.length; i += 2) i ? path.lineTo(pairs[i], pairs[i + 1]) : path.moveTo(pairs[i], pairs[i + 1]);
        if (tag === "polygon") path.closePath(); paint(path);
      } else {
        const text = node.textContent || "";
        ctx.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.textAlign = style.textAnchor === "middle" ? "center" : style.textAnchor === "end" ? "right" : "left";
        ctx.textBaseline = style.dominantBaseline === "middle" ? "middle" : "alphabetic";
        if (fill) { ctx.globalAlpha = alpha(style.opacity) * alpha(style.fillOpacity); ctx.fillText(text, Number(node.getAttribute("x")) || 0, Number(node.getAttribute("y")) || 0); }
        if (stroke) { ctx.globalAlpha = alpha(style.opacity) * alpha(style.strokeOpacity); ctx.strokeText(text, Number(node.getAttribute("x")) || 0, Number(node.getAttribute("y")) || 0); }
      }
      ctx.restore();
    }
  }
  function drawTextNodes(ctx, root, rootRect) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      const parent = node.parentElement;
      if (!text?.trim() || !parent || parent.closest("svg, .sr-only")) continue;
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNode(node);
      const textRects = [...range.getClientRects()];
      if (!textRects.length) {
        const rect = parent.getBoundingClientRect();
        if (rect.width && rect.height) textRects.push(rect);
      }
      for (const rect of textRects) {
        if (!rect.width || !rect.height) continue;
        const fontSize = Number.parseFloat(style.fontSize) || 14;
        ctx.save();
        ctx.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle = style.color;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = style.textAlign === "center" ? "center" : style.textAlign === "right" ? "right" : "left";
        ctx.direction = style.direction;
        const metrics = ctx.measureText(text.trim());
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78;
        const glyphHeight = ascent + (metrics.actualBoundingBoxDescent || fontSize * 0.22);
        const y = rect.top - rootRect.top + Math.max(ascent, (rect.height - glyphHeight) / 2 + ascent);
        const x = style.textAlign === "center" ? rect.left - rootRect.left + rect.width / 2 : style.textAlign === "right" ? rect.right - rootRect.left : rect.left - rootRect.left;
        ctx.fillText(text.trim(), x, y);
        ctx.restore();
      }
    }
  }
  function drawHorizontalRule(ctx, rect, rootRect, color, y) {
    if (!rect.width) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.moveTo(rect.left - rootRect.left, y - rootRect.top);
    ctx.lineTo(rect.right - rootRect.left, y - rootRect.top);
    ctx.stroke();
  }
  function drawExportDecorations(ctx, root, rootRect) {
    for (const dot of root.querySelectorAll(".duration-dot")) {
      const rect = dot.getBoundingClientRect(), style = getComputedStyle(dot);
      if (!rect.width || !rect.height || style.display === "none") continue;
      ctx.beginPath();
      ctx.fillStyle = style.backgroundColor;
      ctx.arc(rect.left - rootRect.left + rect.width / 2, rect.top - rootRect.top + rect.height / 2,
        Math.max(1, Math.min(rect.width, rect.height) / 2), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const mark of root.querySelectorAll(".duration-mark")) {
      const rect = mark.getBoundingClientRect(), style = getComputedStyle(mark);
      if (!rect.width || !rect.height || style.display === "none") continue;
      const border = Number.parseFloat(style.borderBottomWidth) || 0;
      if (border) drawHorizontalRule(ctx, rect, rootRect, style.borderBottomColor, rect.bottom - border / 2);
    }
    for (const measure of root.querySelectorAll(".measure")) {
      const rect = measure.getBoundingClientRect(), rule = getComputedStyle(measure, "::after");
      const width = Number.parseFloat(rule.borderRightWidth) || 0;
      if (!width || rule.content === "none") continue;
      const top = Number.parseFloat(rule.top) || 0, bottom = Number.parseFloat(rule.bottom) || 0;
      const x = rect.right - rootRect.left - width / 2;
      ctx.beginPath(); ctx.strokeStyle = rule.borderRightColor; ctx.lineWidth = width;
      ctx.moveTo(x, rect.top - rootRect.top + top);
      ctx.lineTo(x, rect.bottom - rootRect.top - bottom);
      ctx.stroke();
    }
    for (const system of root.querySelectorAll(".score-system")) {
      const rect = system.getBoundingClientRect(), style = getComputedStyle(system);
      const border = Number.parseFloat(style.borderBottomWidth) || 0;
      if (border) drawHorizontalRule(ctx, rect, rootRect, style.borderBottomColor, rect.bottom - border / 2);
    }
    const heading = root.querySelector(".paper-heading");
    if (heading) {
      const rect = heading.getBoundingClientRect(), style = getComputedStyle(heading);
      const border = Number.parseFloat(style.borderBottomWidth) || 0;
      if (border) drawHorizontalRule(ctx, rect, rootRect, style.borderBottomColor, rect.bottom - border / 2);
    }
    for (const lyric of root.querySelectorAll(".lyric-value")) {
      const rect = lyric.getBoundingClientRect(), style = getComputedStyle(lyric);
      const border = Number.parseFloat(style.outlineWidth) || 0;
      if (!rect.width || !rect.height || !border || style.outlineStyle === "none") continue;
      ctx.save(); ctx.strokeStyle = style.outlineColor; ctx.lineWidth = border;
      ctx.strokeRect(rect.left - rootRect.left - border / 2, rect.top - rootRect.top - border / 2,
        rect.width + border, rect.height + border);
      ctx.restore();
    }
    const labels = [[".numbers-layer", tr("简谱")], [".lyrics-layer", tr("歌词")], [".holes-layer", tr("指法")]];
    for (const [selector, text] of labels) for (const layer of root.querySelectorAll(selector)) {
      const rect = layer.getBoundingClientRect(), pseudo = getComputedStyle(layer, "::before");
      if (pseudo.display === "none" || pseudo.visibility === "hidden") continue;
      const size = Number.parseFloat(pseudo.fontSize) || 9;
      ctx.save();
      ctx.font = pseudo.font || `${pseudo.fontWeight} ${pseudo.fontSize} ${pseudo.fontFamily}`;
      ctx.fillStyle = pseudo.color; ctx.textBaseline = "alphabetic";
      ctx.fillText(text, rect.left - rootRect.left + (Number.parseFloat(pseudo.left) || 0),
        rect.top - rootRect.top + (Number.parseFloat(pseudo.top) || 0) + size * 0.85);
      ctx.restore();
    }
  }
  async function rasterize(element, scale = 2) {
    const width = Math.ceil(element.scrollWidth || element.getBoundingClientRect().width);
    const height = Math.ceil(element.scrollHeight || element.getBoundingClientRect().height);
    if (!width || !height || width * height * scale * scale > 120_000_000) throw new Error(tr("曲谱太长，超出浏览器单张画布的安全尺寸；请改用可逆 PDF 导出。"));
    const canvas = document.createElement("canvas");
    canvas.width = width * scale; canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(tr("浏览器无法创建导出画布，导出失败。"));
    ctx.fillStyle = "#fffefa"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rootRect = element.getBoundingClientRect();
    // 基准变换只做「乘比例」。谱面是暂存在屏幕外（left:-12000px）再光栅化的，
    // 所以下面三个绘制函数都先把屏幕坐标减掉 rootRect 换算成元素内坐标再交进来，
    // 这里绝不能再减一次 rootRect —— 否则所有 HTML 文字（标题 / 简谱数字 / 歌词）
    // 和小节线、减时线都会被画到画布外面，导出的图里只剩 SVG 那几层。
    // （drawInlineSvg 不受影响：它按 getScreenCTM 自己重设整套变换。）
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const svgs = [...element.querySelectorAll("svg")].filter((svg) => !svg.parentElement.closest("svg"));
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect(), style = getComputedStyle(svg);
      if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden") continue;
      drawInlineSvg(ctx, svg, rootRect, scale);
    }
    drawTextNodes(ctx, element, rootRect);
    drawExportDecorations(ctx, element, rootRect);
    return canvas;
  }
  function toBlob(canvas, type, quality) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(tr("生成图像失败"))), type, quality)); }
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  async function exportPng(paper, score) {
    requireVisibleLayer(paper);
    const clone = cleanClone(paper, score), host = staging(clone, score);
    try { const canvas = await rasterize(clone, 2); download(`${safeName(score.title)}.png`, await pngWithScore(await toBlob(canvas, "image/png"), score)); }
    finally { host.remove(); }
  }
  function safeName(name) { return String(name || tr("曲谱")).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80); }
  function pdfTextHex(value) {
    const text = `\uFEFF${String(value || "")}`;
    return Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16).padStart(4, "0")).join("").toUpperCase();
  }
  // 谱面是线条画，JPEG 会在符头、减时线边缘留下振铃噪点。优先无损内嵌
  // （浏览器的 CompressionStream 产出 zlib 流，正好对上 PDF 的 /FlateDecode），
  // 浏览器不支持时才退回 JPEG。
  async function encodePdfImage(canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx && typeof CompressionStream === "function") {
      const { width, height } = canvas;
      const rgba = ctx.getImageData(0, 0, width, height).data;
      // PDF 的 DeviceRGB 不接受每行 4 字节的 RGBA，先去掉 alpha 通道。
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream("deflate"));
      return {
        width,
        height,
        filter: "/FlateDecode",
        data: new Uint8Array(await new Response(stream).arrayBuffer()),
      };
    }
    const blob = await toBlob(canvas, "image/jpeg", 0.95);
    return {
      width: canvas.width,
      height: canvas.height,
      filter: "/DCTDecode",
      data: new Uint8Array(await blob.arrayBuffer()),
    };
  }
  // 把整张位图铺满一页「长页」。页宽固定（842pt，等同 A4 横向），页高由位图长宽比
  // 决定，所以谱子多长页面就多长，不会在小节中间断开。
  function pdfBytes(image, score, pageWidth, pageHeight) {
    const objects = [];
    const add = (value) => { objects.push(value); return objects.length; };
    // 产品标识写进 PDF 的 /Creator，整串在语言表里是一条键。
    const creator = tr("WhistleLoom · 谱间");
    const embedded = encoder.encode(JSON.stringify({ app: MARKER, score }));
    const embedId = add(concat(bytes(`<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length ${embedded.length} >>\nstream\n`), embedded, bytes("\nendstream")));
    const fileId = add(bytes(`<< /Type /Filespec /F (score.json) /UF (score.json) /EF << /F ${embedId} 0 R >> /AFRelationship /Data >>`));
    const imageId = add(concat(
      bytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${image.filter} /Length ${image.data.length} >>\nstream\n`),
      image.data,
      bytes("\nendstream"),
    ));
    // 位图 1:1 铺满整页：变换矩阵直接把画布像素映射到页面尺寸，不做留白居中。
    const content = bytes(`q\n${pageWidth.toFixed(3)} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`);
    const contentId = add(concat(bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes("endstream")));
    // 先占号再回填：/Pages 的 Kids 要指向 /Page，而 /Page 的 Parent 要指向 /Pages，
    // 两个对象互相引用，所以先按顺序占住编号，加完 /Page 再把 /Pages 补全。
    const pagesId = add(bytes(""));
    const pageId = add(bytes(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects[pagesId - 1] = bytes(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
    const catalogId = add(bytes(`<< /Type /Catalog /Pages ${pagesId} 0 R /Names << /EmbeddedFiles << /Names [(score.json) ${fileId} 0 R] >> >> /AF [${fileId} 0 R] >>`));
    const infoId = add(bytes(`<< /Title <${pdfTextHex(score.title)}> /Creator <${pdfTextHex(creator)}> >>`));
    const parts = [bytes("%PDF-1.7\n%âãÏÓ\n")], offsets = [0]; let offset = parts[0].length;
    objects.forEach((obj, i) => { offsets.push(offset); const head = bytes(`${i + 1} 0 obj\n`), tail = bytes("\nendobj\n"); parts.push(head, obj, tail); offset += head.length + obj.length + tail.length; });
    const xref = offset; let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    parts.push(bytes(table + `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`));
    return new Blob(parts, { type: "application/pdf" });
  }
  async function exportPdf(paper, score) {
    requireVisibleLayer(paper);
    const source = cleanClone(paper, score), host = staging(source, score);
    try {
      if (!source.querySelector(".score-system")) throw new Error(tr("曲谱还没有音符，无法导出。"));
      // 整份曲谱（谱头 + 全部谱行）就是这一页，不再拆成多张 A4。
      const canvas = await rasterize(source, EXPORT_PIXEL_RATIO);
      const image = await encodePdfImage(canvas);
      const pageWidth = PDF_LONG_PAGE_WIDTH,
        pageHeight = pageWidth * (image.height / image.width);
      if (pageHeight > PDF_MAX_PAGE_HEIGHT)
        throw new Error(tr("曲谱太长，超出 PDF 单页尺寸上限；请改用 PNG 导出。"));
      download(`${safeName(score.title)}.pdf`, pdfBytes(image, score, pageWidth, pageHeight));
    } finally { host.remove(); }
  }
  // cleanClone + staging 也一并挂出去：导出的前两步（重建谱面 → 暂存到屏幕外）
  // 是「PNG 导出丢延音线」这个 bug 的所在，而它们是 IIFE 私有的，浏览器探针够不着。
  // 挂出来之后探针能直接跑真实导出路径并断言连线条数，不必在探针里复刻一遍逻辑
  // —— 复刻出来的逻辑一旦和真代码漂移，测试就会「因为错误的原因通过」。
  window.ScoreExport = {
    exportPdf,
    exportPng,
    scoreFromPdf,
    scoreFromPng,
    embedScoreInPng: pngWithScore,
    cleanClone,
    staging,
  };
})();

/* Export page geometry and deterministic score pagination. */
(() => {
  const SIZES = {
    A4: { width: 210, height: 297 },
    Letter: { width: 215.9, height: 279.4 },
  };
  function normalize(options = {}) {
    const size = SIZES[options.paperSize] ? options.paperSize : "A4";
    const orientation = options.orientation === "landscape" ? "landscape" : "portrait";
    const marginMm = Math.min(30, Math.max(5, Number(options.marginMm) || 12));
    const measuresPerRow = Math.min(8, Math.max(1, Math.round(Number(options.measuresPerRow) || 2)));
    const base = SIZES[size];
    const widthMm = orientation === "landscape" ? base.height : base.width;
    const heightMm = orientation === "landscape" ? base.width : base.height;
    return { paperSize: size, orientation, marginMm, measuresPerRow, widthMm, heightMm };
  }
  function layout(bars, options = {}, rowHeightPx = 100, headingHeightPx = 160) {
    const settings = normalize(options);
    const ptPerMm = 72 / 25.4;
    const scale = 1004 / (settings.widthMm * ptPerMm);
    const allRows = [];
    for (let i = 0; i < bars.length; i += settings.measuresPerRow) {
      allRows.push(bars.slice(i, i + settings.measuresPerRow));
    }
    const availableHeight = (settings.heightMm - settings.marginMm * 2) * 96 / 25.4;
    const pages = [];
    let page = [], used = headingHeightPx;
    for (const row of allRows) {
      if (page.length && used + rowHeightPx > availableHeight) {
        pages.push(page);
        page = [];
        used = 0;
      }
      page.push(row);
      used += rowHeightPx;
    }
    if (page.length || !pages.length) pages.push(page);
    return { settings, pages, contentWidth: (settings.widthMm - settings.marginMm * 2) * 96 / 25.4, scale, availableHeight };
  }
  window.ScoreLayout = { normalize, layout, sizes: SIZES };
})();

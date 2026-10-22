/* Minimal STORE-only ZIP reader/writer for offline score packages. */
(() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  function crc32(data) {
    let crc = -1;
    for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
  }
  const cat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
  function pack(files) {
    const locals = [], centrals = []; let offset = 0;
    for (const file of files) {
      const name = enc.encode(file.name), data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data), crc = crc32(data);
      const local = cat([Uint8Array.from([0x50,0x4b,3,4,...u16(20),...u16(0x800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)]), name, data]);
      locals.push(local);
      centrals.push(cat([Uint8Array.from([0x50,0x4b,1,2,...u16(20),...u16(20),...u16(0x800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]), name]));
      offset += local.length;
    }
    const central = cat(centrals), end = Uint8Array.from([0x50,0x4b,5,6,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(central.length),...u32(offset),...u16(0)]);
    return cat([...locals, central, end]);
  }
  async function unpack(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), view = new DataView(data.buffer, data.byteOffset, data.byteLength), files = [];
    let eocd = -1;
    for (let i = Math.max(0, data.length - 65557); i <= data.length - 22; i++) if (view.getUint32(i, true) === 0x06054b50) eocd = i;
    if (eocd < 0) throw new Error(tr("ZIP 压缩包结构无效。"));
    const count = view.getUint16(eocd + 10, true); let at = view.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw new Error(tr("ZIP 压缩包结构无效。"));
      const method = view.getUint16(at + 10, true), nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true), localAt = view.getUint32(at + 42, true);
      if (localAt + 30 > data.length || at + 46 + nameLen + extraLen + commentLen > data.length) throw new Error(tr("ZIP 压缩包结构无效。"));
      const name = dec.decode(data.subarray(at + 46, at + 46 + nameLen)), localName = view.getUint16(localAt + 26, true), localExtra = view.getUint16(localAt + 28, true), compressedSize = view.getUint32(at + 20, true), uncompressedSize = view.getUint32(at + 24, true), start = localAt + 30 + localName + localExtra;
      if (compressedSize > 512_000_000 || uncompressedSize > 512_000_000) throw new Error(tr("ZIP 中的文件过大，无法安全读取。"));
      if (start + compressedSize > data.length) throw new Error(tr("ZIP 压缩包结构无效。"));
      const expectedCrc = view.getUint32(at + 16, true);
      let content = data.slice(start, start + compressedSize);
      if (method === 8) {
        if (typeof DecompressionStream !== "function") throw new Error(tr("当前浏览器不支持读取压缩 ZIP。"));
        try { content = new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); }
        catch (_) { throw new Error(tr("读取 ZIP 中的压缩数据失败。")); }
      } else if (method !== 0) throw new Error(tr("ZIP 中包含不支持的压缩方式。"));
      if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) throw new Error(tr("ZIP 压缩包校验失败。"));
      files.push({ name, data: content }); at += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }
  window.ScoreZip = { pack, unpack, crc32 };
})();

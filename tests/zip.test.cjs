const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { deflateRawSync } = require("node:zlib");
const source = fs.readFileSync("js/zip.js", "utf8");
const window = {};
vm.runInNewContext(source, { window, TextEncoder, TextDecoder, Uint8Array, DataView, Blob, Response, DecompressionStream });

test("STORE ZIP writer and reader round-trip filenames and binary files", async () => {
  const files = [{ name: "页-01.png", data: Uint8Array.from([137, 80, 78, 71, 0, 255]) }, { name: "score.json", data: new TextEncoder().encode('{"ok":true}') }];
  const archive = window.ScoreZip.pack(files);
  const unpacked = await window.ScoreZip.unpack(archive);
  assert.equal(unpacked.length, 2);
  assert.equal(unpacked[0].name, files[0].name);
  assert.deepEqual(Array.from(unpacked[0].data), Array.from(files[0].data));
  assert.equal(new TextDecoder().decode(unpacked[1].data), '{"ok":true}');
});

test("ZIP reader handles deflated archives with distinct compressed and expanded sizes", async () => {
  const name = Buffer.from("score.json");
  const payload = Buffer.from(JSON.stringify({ events: Array.from({ length: 100 }, (_, i) => i) }));
  const compressed = deflateRawSync(payload);
  const crc = window.ScoreZip.crc32(payload);
  const local = Buffer.alloc(30 + name.length + compressed.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30); compressed.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(payload.length, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  const files = await window.ScoreZip.unpack(Buffer.concat([local, central, end]));
  assert.equal(files[0].data.length, payload.length);
  assert.equal(Buffer.from(files[0].data).toString(), payload.toString());
});

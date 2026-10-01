// Generates the macOS menu-bar "template" icon (black + alpha; macOS recolours it
// for light/dark menu bars). Three candlesticks, drawn at 44x44 (22pt @2x).
import fs from "node:fs";
import zlib from "node:zlib";

const S = 44;
const px = new Uint8Array(S * S * 4); // RGBA, all transparent

function rect(x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[(y * S + x) * 4 + 3] = 255;
}
// [centre x, wick top, body top, body bottom, wick bottom]
for (const [cx, wt, bt, bb, wb] of [
  [9, 14, 20, 32, 36],
  [22, 6, 10, 26, 32],
  [35, 12, 16, 28, 38],
]) {
  rect(cx - 1, wt, cx + 1, wb); // wick
  rect(cx - 5, bt, cx + 5, bb); // body
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) Buffer.from(px.subarray(y * S * 4, (y + 1) * S * 4)).copy(raw, y * (S * 4 + 1) + 1);

const out = new URL("../src-tauri/icons/tray-template.png", import.meta.url);
fs.writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log("wrote", out.pathname);

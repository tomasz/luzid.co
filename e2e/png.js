/**
 * The smallest PNG decoder that can read what Playwright hands back.
 *
 * `page.screenshot()` returns an encoded PNG, and the fit proof needs pixels, so something
 * has to decode it. There are no image dependencies in this repo and there will not be
 * one: `node:zlib` already ships the only hard part.
 *
 * Scope is deliberately narrow: non-interlaced 8-bit RGB or RGBA, which is what the three
 * engines emit (`shoot()` in `fit-lib.js` logs the type once per engine). Anything else
 * throws rather than being guessed at, because an encoder is free to change its mind between
 * versions and a silent mis-decode would look like a fit bug.
 */

import { inflateSync } from "node:zlib";

/** Bytes per pixel, by the two PNG colour types this decoder accepts: RGB and RGBA. */
const CHANNELS = { 2: 3, 6: 4 };

/** @param {number} a left @param {number} b up @param {number} c up-left */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Reverse the per-scanline filters. Each row is one filter byte followed by `stride`
 * bytes; `bpp` is the filter's idea of a pixel, in whole bytes.
 *
 * @param {Buffer} raw
 * @param {number} h
 * @param {number} stride
 * @param {number} bpp
 */
function unfilter(raw, h, stride, bpp) {
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const c = y > 0 && i >= bpp ? out[up + i - bpp] : 0;
      // Buffer writes truncate to uint8, which is exactly the modulo the spec asks for.
      out[dst + i] =
        ft === 0
          ? x
          : ft === 1
            ? x + a
            : ft === 2
              ? x + b
              : ft === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c);
    }
  }
  return out;
}

/**
 * Decode a PNG buffer to straight (non-premultiplied) 8-bit RGBA.
 *
 * @param {Buffer} buf
 * @returns {{width: number, height: number, data: Uint8Array, ctype: number, depth: number}}
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let width = 0;
  let height = 0;
  let depth = 0;
  let ctype = 0;
  /** @type {Buffer[]} */
  const idat = [];

  for (let pos = 8; pos + 8 <= buf.length;) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }

  const ch = CHANNELS[ctype];
  if (ch === undefined || depth !== 8) {
    throw new Error(
      `unsupported PNG: colour type ${ctype}, bit depth ${depth} (want 8-bit 2 or 6)`,
    );
  }

  const stride = width * ch;
  const rows = unfilter(inflateSync(Buffer.concat(idat)), height, stride, ch);

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * ch;
      const o = (y * width + x) * 4;
      data[o] = rows[i];
      data[o + 1] = rows[i + 1];
      data[o + 2] = rows[i + 2];
      data[o + 3] = ch === 4 ? rows[i + 3] : 255;
    }
  }
  return { width, height, data, ctype, depth };
}

/**
 * Composite a decoded image over an opaque white ground and return it unchanged when it is
 * already opaque. Screenshots are opaque in practice; this only removes a class of
 * "transparent is not white" surprise from the scans below.
 *
 * @param {{width: number, height: number, data: Uint8Array}} img
 */
export function flatten(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    d[i] = Math.round((d[i] * a + 255 * (255 - a)) / 255);
    d[i + 1] = Math.round((d[i + 1] * a + 255 * (255 - a)) / 255);
    d[i + 2] = Math.round((d[i + 2] * a + 255 * (255 - a)) / 255);
    d[i + 3] = 255;
  }
  return img;
}

/**
 * Bounding box of every pixel `hit()` accepts, in device pixels. Bounds are inclusive, so
 * `w`/`h` count pixels: ink covering exactly [10, 110) gives x0 = 10, x1 = 109, w = 100.
 *
 * @param {{width: number, height: number, data: Uint8Array}} img
 * @param {(r: number, g: number, b: number) => boolean} hit
 */
export function bbox(img, hit) {
  const { width, height, data } = img;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (!hit(data[o], data[o + 1], data[o + 2])) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (n === 0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n };
}

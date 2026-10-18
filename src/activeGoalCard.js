'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CARD_VERSION = 2;
const REFERENCE_CARD = fs.readFileSync(path.join(__dirname, 'assets', 'active-goal-reference-v2.png'));
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FONT = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'], '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'], '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'], '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'], '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'], '9': ['01110','10001','10001','01111','00001','00001','01110'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'], 'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'], 'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'], 'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'], 'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'], 'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'], 'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'], 'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'], 'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'], 'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'], 'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'], 'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'], 'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'], 'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'], '-': ['00000','00000','00000','11111','00000','00000','00000'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000']
};

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeRgbPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Active goal card source is not a PNG.');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (buffer[24] !== 8 || buffer[25] !== 2 || buffer[28] !== 0) throw new Error('Active goal card must be a non-interlaced 8-bit RGB PNG.');
  const compressed = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') compressed.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * 3, pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceOffset++], rowOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[sourceOffset++], left = x >= 3 ? pixels[rowOffset + x - 3] : 0;
      const above = y ? pixels[rowOffset - stride + x] : 0, upperLeft = y && x >= 3 ? pixels[rowOffset - stride + x - 3] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : null;
      if (predictor === null) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[rowOffset + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); name.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  return chunk;
}

function encodeRgbPng({ width, height, pixels }) {
  const stride = width * 3, raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function paintRect(image, x, y, width, height, color, alpha = 1) {
  const xStart = Math.max(0, Math.floor(x)), yStart = Math.max(0, Math.floor(y));
  const xEnd = Math.min(image.width, Math.ceil(x + width)), yEnd = Math.min(image.height, Math.ceil(y + height));
  for (let py = yStart; py < yEnd; py++) for (let px = xStart; px < xEnd; px++) {
    const offset = (py * image.width + px) * 3;
    for (let channel = 0; channel < 3; channel++) image.pixels[offset + channel] = Math.round(image.pixels[offset + channel] * (1 - alpha) + color[channel] * alpha);
  }
}

function drawText(image, value, x, y, scale, color) {
  let cursorX = x;
  for (const character of String(value).toUpperCase()) {
    const glyph = FONT[character] || FONT[' '];
    for (let row = 0; row < 7; row++) for (let column = 0; column < 5; column++) {
      if (glyph[row][column] === '1') paintRect(image, cursorX + column * scale, y + row * scale, scale, scale, color);
    }
    cursorX += 6 * scale;
  }
}

function createActiveGoalCard(goal) {
  const image = decodeRgbPng(REFERENCE_CARD);
  const target = Math.max(1, Number(goal.targetPlayers) || 1);
  const count = goal.sampleFresh ? Math.max(0, Number(goal.onlinePlayers) || 0) : null;
  const label = count === null ? 'WAITING' : `${count} / ${target}`;

  // Keep all artwork fixed; only replace the player-count readout and meter.
  // The larger purple bitmap text stays legible when Discord scales the image down.
  paintRect(image, 235, 482, 365, 62, [23, 14, 33]);
  const scale = Math.min(8, Math.max(4, Math.floor(350 / (label.length * 6))));
  drawText(image, label, 250, 486, scale, [216, 166, 255]);

  // Fill the tile's 15-cell meter only as the tab-list count changes.
  if (count !== null) {
    const filled = Math.min(15, Math.floor((count / target) * 15));
    for (let index = 0; index < filled; index++) {
      const shade = index === 14 ? [218, 166, 255] : [164, 74, 222];
      paintRect(image, 131 + index * 31.9, 554, 25, 33, shade, 0.9);
    }
  }
  return encodeRgbPng(image);
}

module.exports = { createActiveGoalCard, decodeRgbPng, CARD_VERSION };

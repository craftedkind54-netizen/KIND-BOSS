'use strict';

const zlib = require('node:zlib');

const WIDTH = 1600;
const HEIGHT = 900;
const FONT = {
  A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
  0:'01110/10001/10011/10101/11001/10001/01110',1:'00100/01100/00100/00100/00100/00100/01110',2:'01110/10001/00001/00010/00100/01000/11111',3:'11110/00001/00001/01110/00001/00001/11110',4:'00010/00110/01010/10010/11111/00010/00010',5:'11111/10000/10000/11110/00001/00001/11110',6:'01110/10000/10000/11110/10001/10001/01110',7:'11111/00001/00010/00100/01000/01000/01000',8:'01110/10001/10001/01110/10001/10001/01110',9:'01110/10001/10001/01111/00001/00001/01110',
  ' ':'00000/00000/00000/00000/00000/00000/00000','-':'00000/00000/00000/11111/00000/00000/00000',':':'00000/00100/00100/00000/00100/00100/00000','/':'00001/00010/00010/00100/01000/01000/10000','.':'00000/00000/00000/00000/00000/00100/00100','!':'00100/00100/00100/00100/00100/00000/00100','?':'01110/10001/00001/00010/00100/00000/00100','+':'00000/00100/00100/11111/00100/00100/00000','·':'00000/00000/00100/00000/00100/00000/00000'
};

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function makePng(rgba) {
  const rowSize = WIDTH * 4 + 1;
  const scanlines = Buffer.alloc(rowSize * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const start = y * rowSize;
    scanlines[start] = 0;
    rgba.copy(scanlines, start + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
}

function createActiveGoalCard(goal) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const color = (r, g, b, a = 255) => [r, g, b, a];
  const pixel = (x, y, c) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
    pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = c[3];
  };
  const rect = (x, y, w, h, c) => {
    const left = Math.max(0, Math.floor(x)); const right = Math.min(WIDTH, Math.ceil(x + w));
    const top = Math.max(0, Math.floor(y)); const bottom = Math.min(HEIGHT, Math.ceil(y + h));
    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) pixel(px, py, c);
  };
  const roundRect = (x, y, w, h, r, c) => {
    rect(x + r, y, w - r * 2, h, c); rect(x, y + r, r, h - r * 2, c); rect(x + w - r, y + r, r, h - r * 2, c);
    for (let py = 0; py < r; py++) for (let px = 0; px < r; px++) {
      if ((px - r) ** 2 + (py - r) ** 2 <= r ** 2) pixel(x + px, y + py, c);
      if ((px - (r - 1)) ** 2 + (py - r) ** 2 <= r ** 2) pixel(x + w - 1 - px, y + py, c);
      if ((px - r) ** 2 + (py - (r - 1)) ** 2 <= r ** 2) pixel(x + px, y + h - 1 - py, c);
      if ((px - (r - 1)) ** 2 + (py - (r - 1)) ** 2 <= r ** 2) pixel(x + w - 1 - px, y + h - 1 - py, c);
    }
  };
  const outline = (x, y, w, h, r, thickness, c) => {
    roundRect(x, y, w, h, r, c);
    roundRect(x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, Math.max(1, r - thickness), color(18, 28, 40));
  };
  const clean = value => String(value).toUpperCase().replace(/[^A-Z0-9 :./!?+\-·]/g, ' ');
  const textWidth = (value, scale, spacing = Math.ceil(scale * 0.4)) => Math.max(0, clean(value).length * (5 * scale + spacing) - spacing);
  const text = (value, x, y, scale, c, spacing = Math.ceil(scale * 0.4)) => {
    const str = clean(value);
    for (let n = 0; n < str.length; n++) {
      const glyph = (FONT[str[n]] || FONT[' ']).split('/');
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (glyph[gy][gx] === '1') rect(x + n * (5 * scale + spacing) + gx * scale, y + gy * scale, scale, scale, c);
    }
    return textWidth(str, scale, spacing);
  };
  const wrap = (value, maxChars) => {
    const words = clean(value).split(/\s+/); const lines = []; let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const cyan = color(56, 229, 236); const white = color(239, 245, 255); const muted = color(160, 180, 200);
  const gold = color(255, 198, 67); const dark = color(13, 22, 34); const border = color(43, 65, 84);

  for (let y = 0; y < HEIGHT; y++) {
    const t = y / HEIGHT; rect(0, y, WIDTH, 1, color(Math.round(13 - 4 * t), Math.round(22 - 5 * t), Math.round(35 - 7 * t)));
  }
  roundRect(38, 48, 1524, 804, 24, border);
  roundRect(44, 54, 1512, 792, 18, dark);
  roundRect(44, 54, 12, 792, 8, cyan);

  // Pixel trophy icon and title.
  rect(102, 100, 44, 15, gold); rect(94, 115, 60, 32, gold); rect(104, 147, 40, 15, gold); rect(116, 162, 16, 32, gold); rect(97, 194, 54, 10, gold);
  rect(80, 115, 14, 10, gold); rect(154, 115, 14, 10, gold); rect(81, 125, 9, 18, gold); rect(158, 125, 9, 18, gold);
  text('KIND SMP', 220, 98, 7, white, 5);
  const titleX = 220 + textWidth('KIND SMP', 7, 5) + 28;
  text('WEEKLY PLAYER GOAL', titleX, 98, 7, gold, 5);
  text('GET EVERYONE ONLINE AND HELP THE SERVER REACH ITS COMMUNITY GOAL!', 220, 174, 3, muted, 3);
  rect(82, 245, 1436, 3, border);

  // Cyan goal requirement banner.
  roundRect(82, 270, 1436, 112, 18, color(13, 65, 79));
  roundRect(88, 276, 1424, 100, 14, color(13, 35, 48));
  // Three small player silhouettes.
  rect(120, 309, 25, 25, cyan); rect(115, 342, 35, 25, cyan); rect(157, 296, 35, 34, cyan); rect(150, 336, 49, 31, cyan); rect(207, 309, 25, 25, cyan); rect(202, 342, 35, 25, cyan);
  const requirement = `${goal.targetPlayers} PLAYERS ON THE TAB LIST - ${formatDuration(goal.requiredSeconds)} DAILY - 7 DAYS IN A ROW`;
    text(requirement, 270, 313, 3, cyan, 3);

  const panels = [
    { x: 82, w: 470, title: 'PLAYERS ONLINE', icon: 'people', value: goal.sampleFresh ? `${goal.onlinePlayers} / ${goal.targetPlayers}` : 'WAITING FOR DATA', amount: goal.sampleFresh ? goal.onlinePlayers : 0, max: goal.targetPlayers, tint: color(17, 49, 73) },
    { x: 575, w: 470, title: 'TODAY', icon: 'clock', value: `${formatDuration(goal.secondsToday)} / ${formatDuration(goal.requiredSeconds)}`, amount: goal.secondsToday, max: goal.requiredSeconds, tint: color(16, 46, 68) },
    { x: 1068, w: 450, title: 'WEEKLY STREAK', icon: 'flame', value: `${goal.streak} / 7 DAYS`, amount: goal.streak, max: 7, tint: color(48, 39, 38) }
  ];
  for (const p of panels) {
    roundRect(p.x, 402, p.w, 250, 18, border); roundRect(p.x + 5, 407, p.w - 10, 240, 14, p.tint);
    // Pixel badges echo the icon silhouettes in the reference.
    if (p.icon === 'people') { rect(p.x + 30, 445, 34, 32, cyan); rect(p.x + 23, 483, 48, 38, cyan); rect(p.x + 78, 432, 42, 38, cyan); rect(p.x + 72, 478, 56, 43, cyan); }
    if (p.icon === 'clock') { roundRect(p.x + 34, 438, 68, 68, 22, color(194, 215, 238)); roundRect(p.x + 43, 447, 50, 50, 16, color(35, 56, 77)); rect(p.x + 66, 457, 6, 24, gold); rect(p.x + 67, 477, 19, 6, gold); }
    if (p.icon === 'flame') { rect(p.x + 46, 462, 22, 48, color(247, 111, 42)); rect(p.x + 68, 438, 28, 70, color(247, 111, 42)); rect(p.x + 92, 456, 20, 54, color(247, 111, 42)); rect(p.x + 62, 475, 28, 32, gold); rect(p.x + 70, 490, 18, 19, color(255, 234, 139)); }
    text(p.title, p.x + 142, 440, 3, white, 3);
    text(p.value, p.x + 142, 493, p.value.length > 12 ? 3 : p.value.length > 9 ? 4 : 5, white, 3);
    const bx = p.x + 35; const by = 554; const bw = p.w - 70; const segments = 12; const gap = 7; const cellW = (bw - (segments - 1) * gap) / segments;
    roundRect(bx - 10, by - 10, bw + 20, 62, 11, color(155, 176, 204)); roundRect(bx - 5, by - 5, bw + 10, 52, 8, color(24, 37, 54));
    const filled = Math.max(0, Math.min(segments, Math.floor((p.amount / Math.max(1, p.max)) * segments)));
    for (let i = 0; i < segments; i++) roundRect(bx + i * (cellW + gap), by, cellW, 42, 4, i < filled ? cyan : color(52, 68, 91));
    const status = p.icon === 'clock' ? (goal.dayQualified ? 'GOAL COMPLETE TODAY' : goal.sampleFresh && goal.onlinePlayers >= goal.targetPlayers ? 'COUNTDOWN IS RUNNING' : `NEED ${goal.targetPlayers} PLAYERS TO START`) : p.icon === 'people' ? (goal.sampleFresh ? 'PLAYERS ON THE TAB LIST' : 'MINECRAFT DATA NOT RECEIVED') : 'CONSECUTIVE QUALIFIED DAYS';
    text(status, p.x + 35, 615, 2, muted, 2);
  }

  // Gold prize banner.
  roundRect(82, 660, 1436, 155, 18, gold); roundRect(88, 666, 1424, 143, 14, color(23, 27, 32));
  rect(137, 710, 92, 75, color(235, 163, 35)); rect(149, 700, 68, 19, color(255, 220, 106)); rect(130, 724, 106, 12, color(255, 220, 106)); rect(174, 710, 20, 75, color(255, 80, 76)); rect(166, 691, 19, 15, color(255, 80, 76)); rect(190, 691, 19, 15, color(255, 80, 76));
  text('PRIZE', 285, 680, 5, gold, 4);
  const prizeLines = wrap(goal.prize || 'THE OWNER HAS NOT CHOSEN A PRIZE YET', 52).slice(0, 4);
  prizeLines.forEach((line, index) => text(line, 285, 720 + index * 24, 3, white, 3));
  const footer = `TIMER COUNTS ONLY WHILE THE PLAYER TARGET IS MET - ${goal.timezone || 'PACIFIC/HONOLULU'} - GOAL TRACKED 24/7`;
  text(footer, 260, 824, 2, muted, 2);
  return makePng(pixels);
}

function formatDuration(seconds) {
  const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}H ${minutes % 60}M` : `${minutes}M`;
}

module.exports = { createActiveGoalCard };

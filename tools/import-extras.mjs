// 추가에셋(낚시/러너/리액션/도감)을 assets/extras/로 임포트 + 매니페스트 생성
// 사용법: node tools/import-extras.mjs [추가에셋 경로]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? path.join(root, '추가에셋');
const DEST = path.join(root, 'assets', 'extras');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

fs.mkdirSync(path.join(DEST, 'fish'), { recursive: true });
fs.mkdirSync(path.join(DEST, 'tools'), { recursive: true });
fs.mkdirSync(path.join(DEST, 'rungame'), { recursive: true });

// 물고기: 64x16(16x16 4프레임) 표준 시트만 채택
const fish = [];
for (const file of walk(path.join(SRC, 'Fish'))) {
  if (!file.endsWith('.png')) continue;
  const { w, h } = pngSize(file);
  if (w !== 64 || h !== 16) continue;
  const name = path.basename(file, '.png').trim();
  fs.copyFileSync(file, path.join(DEST, 'fish', `${name}.png`));
  fish.push(name);
}
fish.sort();

// 새 물고기 (NewFish/ — 단일 이미지, 크기 자유) → fish2/
// 구 도감(fish)과 이름이 겹치면 접미사 '2', "(1)" 같은 중복 표기는 정리
const SKIP_NEW = new Set(['box_turtle_spawn_egg']); // 물고기가 아닌 아이콘 제외
fs.mkdirSync(path.join(DEST, 'fish2'), { recursive: true });
const fish2 = [];
const newDir = path.join(SRC, 'NewFish');
if (fs.existsSync(newDir)) {
  for (const file of walk(newDir)) {
    if (!file.endsWith('.png')) continue;
    let name = path
      .basename(file, '.png')
      .trim()
      .replace(/\s*\(\d+\)$/, '2');
    if (SKIP_NEW.has(name)) continue;
    while (fish.includes(name) || fish2.includes(name)) name += '2';
    fs.copyFileSync(file, path.join(DEST, 'fish2', `${name}.png`));
    fish2.push(name);
  }
  fish2.sort();
}

// 낚싯대 애니메이션 스트립 (96x64 프레임)
const TOOL_STRIPS = {
  casting: 'tools_casting_strip15.png',
  waiting: 'tools_waiting_strip9.png',
  reeling: 'tools_reeling_strip13.png',
  caught: 'tools_caught_strip10.png',
};
for (const file of Object.values(TOOL_STRIPS)) {
  fs.copyFileSync(path.join(SRC, 'tools', file), path.join(DEST, 'tools', file));
}

// 땅파기 삽질 스트립 (96x64, 13프레임: 0~6 파는 루프 / 7~12 획득 연출)
const DIG_STRIP = 'tools_dig_strip13.png';
fs.copyFileSync(path.join(SRC, 'tools', DIG_STRIP), path.join(DEST, 'tools', DIG_STRIP));

// 광물/보석 아이콘 (추가에셋/gems 전체를 훑어 basename → id 매핑, 64x64만 채택)
// id 규칙: Materials<N>=m<N>, Crystal Cluster_<N>=c<N>, Gemstones_<N>=g<N>, Diamonds_<N>=d<N>,
//          Gold Piles & Tresure<N>=t<N> (t*는 도감 밖 — 코인주머니/상자 연출용)
fs.mkdirSync(path.join(DEST, 'minerals'), { recursive: true });
const MINERAL_PATTERNS = [
  [/^Materials(\d+)$/, 'm'],
  [/^Crystal Cluster_(\d+)$/, 'c'],
  [/^Gemstones_(\d+)$/, 'g'],
  [/^Diamonds_(\d+)$/, 'd'],
  [/^Gold Piles & Tresure(\d+)$/, 't'],
];
const minerals = [];
const gemsDir = path.join(SRC, 'gems');
if (fs.existsSync(gemsDir)) {
  for (const file of walk(gemsDir)) {
    if (!file.endsWith('.png')) continue;
    const base = path.basename(file, '.png').trim();
    for (const [re, prefix] of MINERAL_PATTERNS) {
      const m = re.exec(base);
      if (!m) continue;
      const { w, h } = pngSize(file);
      if (w !== 64 || h !== 64) continue;
      const id = `${prefix}${m[1]}`;
      if (!minerals.includes(id)) {
        fs.copyFileSync(file, path.join(DEST, 'minerals', `${id}.png`));
        minerals.push(id);
      }
      break;
    }
  }
  minerals.sort();
}

// 몬스터 팩은 배경이 투명이 아니라 불투명 검정(0,0,0)으로 채워져 있다 → 테두리에서 이어진 검정 영역만 투명 처리.
// (눈 등 스프라이트 내부의 검정 픽셀은 보존) RGBA 8비트·비인터레이스 PNG만 처리, 그 외는 원본 그대로.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngDecodeRgba(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) return null;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 6 || ihdr[12] !== 0) return null; // RGBA8, 비인터레이스만
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= 4 ? px[dst + i - 4] : 0;
      const b = y > 0 ? px[dst - stride + i] : 0;
      const c = y > 0 && i >= 4 ? px[dst - stride + i - 4] : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      px[dst + i] = v & 0xff;
    }
  }
  return { w, h, px };
}
function pngEncodeRgba(w, h, px) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** 테두리와 이어진 불투명 검정 픽셀을 투명으로 (BFS). 처리 못 하는 형식이면 원본 반환 */
function keyOutBlackBackground(buf) {
  const img = pngDecodeRgba(buf);
  if (!img) return buf;
  const { w, h, px } = img;
  const isBg = (i) => px[i * 4] === 0 && px[i * 4 + 1] === 0 && px[i * 4 + 2] === 0 && px[i * 4 + 3] === 255;
  const seen = new Uint8Array(w * h);
  const queue = [];
  for (let x = 0; x < w; x++) queue.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1);
  let cleared = 0;
  while (queue.length) {
    const i = queue.pop();
    if (seen[i] || !isBg(i)) continue;
    seen[i] = 1;
    px[i * 4 + 3] = 0;
    cleared++;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) queue.push(i - 1);
    if (x < w - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - w);
    if (y < h - 1) queue.push(i + w);
  }
  return cleared > 0 ? pngEncodeRgba(w, h, px) : buf;
}

// 원정 몬스터 (추가에셋/Monsters 전체, 32x32 단일 프레임만) — id = basename 슬러그 (소문자, 영숫자 외 → '-')
// 예: "Three headed troll" → three-headed-troll, "Mushroom man_001" → mushroom-man-001, "GoblinKing" → goblinking
fs.mkdirSync(path.join(DEST, 'monsters'), { recursive: true });
const monsters = [];
const monstersDir = path.join(SRC, 'Monsters');
if (fs.existsSync(monstersDir)) {
  for (const file of walk(monstersDir)) {
    if (!file.endsWith('.png')) continue;
    const { w, h } = pngSize(file);
    if (w !== 32 || h !== 32) continue;
    const id = path
      .basename(file, '.png')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!id || monsters.includes(id)) continue;
    fs.writeFileSync(path.join(DEST, 'monsters', `${id}.png`), keyOutBlackBackground(fs.readFileSync(file)));
    monsters.push(id);
  }
  monsters.sort();
}

// 러너 장애물
fs.copyFileSync(path.join(SRC, 'rungame', 'Arrow.png'), path.join(DEST, 'rungame', 'Arrow.png'));
fs.copyFileSync(path.join(SRC, 'rungame', 'Trap3.png'), path.join(DEST, 'rungame', 'Trap3.png'));

// 리액션 이모지 시트 + 도감 책 배경
fs.copyFileSync(path.join(SRC, 'speech bubble, emojis, reaction.png'), path.join(DEST, 'reaction.png'));
fs.copyFileSync(path.join(SRC, 'Book.png'), path.join(DEST, 'book.png'));

// 이펙트 오오라 (상점 판매용) — 프레임 크기는 파일별 정의
// scale: 표시 배율, dy: 중심 하향(px, 배율 전), mode: 'scroll'은 단일 텍스처 상승 스크롤
const EFFECT_DEFS = [
  { id: 'ChargeUp', file: 'ChargeUp.png', fw: 48, fh: 48, scale: 1, dy: 2 },
  { id: 'HeartBeat', file: 'HeartBeat.png', fw: 32, fh: 16, scale: 1, dy: 2 },
  { id: 'Poison', file: 'Poison.png', fw: 256, fh: 256, scale: 1, dy: 3, mode: 'scroll' },
  { id: 'pipo021', file: 'pipo-mapeffect021_192.png', fw: 192, fh: 192, scale: 1.5, dy: 5 },
  { id: 'pipo022', file: 'pipo-mapeffect022_192.png', fw: 192, fh: 192, scale: 1.5, dy: 5 },
  { id: 'pipo023', file: 'pipo-mapeffect023_192.png', fw: 192, fh: 192, scale: 1.5, dy: 5 },
  { id: 'pipo024', file: 'pipo-mapeffect024_192.png', fw: 192, fh: 192, scale: 1.5, dy: 5 },
  { id: 'pipo025', file: 'pipo-mapeffect025_192.png', fw: 192, fh: 192, scale: 1.5, dy: 5 },
];
fs.mkdirSync(path.join(DEST, 'effects'), { recursive: true });
const effects = [];
for (const def of EFFECT_DEFS) {
  const src = path.join(SRC, 'effects', def.file);
  const { w, h } = pngSize(src);
  fs.copyFileSync(src, path.join(DEST, 'effects', def.file));
  const cols = Math.floor(w / def.fw);
  const count = cols * Math.floor(h / def.fh);
  effects.push({ ...def, cols, count });
}


// 🐾 펫 (추가에셋/Pets) — 정규화 시트 pets/<id>.png: 0행 idle, 1행 이동, 셀 cellW×cellH (RGBA8 코덱으로 원본에서 잘라냄)
// 4성 Cubic 84×16(21×16 ×4): idle = 0번 프레임, 이동 = 0·1번 프레임 교차 (사용자 지정 — 3·4번은 미사용)
// 5성: 원본 시트의 idle 행/이동 행 (행 안의 비어있지 않은 셀 수만큼 프레임, idleFrames로 고정 가능). faceLeft = 시트가 왼쪽을 봄 (오버레이가 오른쪽 이동 시 미러)
// walkLeft = 왼쪽 걷기 전용 행 (정규화 시트 2행, 미러 대신 사용 — 고양이 7행 오른쪽/8행 왼쪽)
const PET_SOURCES = {
  wildfire: { idle: ['5성/WildfireIdle.png', 0], walk: ['5성/WildfireFly.png', 0], cell: 32, float: true },
  moonwolf: { idle: ['5성/Wolf.png', 0], walk: ['5성/Wolf.png', 1], cell: 16 },
  fireskull: { idle: ['5성/fire_skull.png', 0], walk: ['5성/fire_skull.png', 1], cell: 16, float: true, faceLeft: true },
  slime: { idle: ['5성/slime.png', 0], walk: ['5성/slime.png', 1], cell: 16 },
  'cat-gray': { idle: ['5성/cat 1.png', 0], idleFrames: 1, walk: ['5성/cat 1.png', 6], walkLeft: ['5성/cat 1.png', 7], cell: 32, scale: 0.75 },
  'cat-orange': { idle: ['5성/cat 1.6.png', 0], idleFrames: 1, walk: ['5성/cat 1.6.png', 6], walkLeft: ['5성/cat 1.6.png', 7], cell: 32, scale: 0.75 },
  'cat-white': { idle: ['5성/cat 1.9.png', 0], idleFrames: 1, walk: ['5성/cat 1.9.png', 6], walkLeft: ['5성/cat 1.9.png', 7], cell: 32, scale: 0.75 },
};
const petsDir = path.join(SRC, 'Pets');
const pets = {};
let petUi = null;
if (fs.existsSync(petsDir)) {
  fs.mkdirSync(path.join(DEST, 'pets', 'ui'), { recursive: true });
  const decodeCache = new Map();
  const decodeFile = (rel) => {
    if (!decodeCache.has(rel)) {
      const img = pngDecodeRgba(fs.readFileSync(path.join(petsDir, rel)));
      if (!img) throw new Error(`RGBA8 PNG만 지원: ${rel}`);
      decodeCache.set(rel, img);
    }
    return decodeCache.get(rel);
  };
  const cellEmpty = (img, cx, cy, cw, ch) => {
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) if (img.px[(y * img.w + x) * 4 + 3] > 0) return false;
    return true;
  };
  /** 행의 왼쪽부터 연속된 비어있지 않은 셀 수 */
  const rowFrames = (img, cell, row) => {
    let n = 0;
    for (let c = 0; c * cell < img.w; c++) {
      if (cellEmpty(img, c * cell, row * cell, cell, cell)) break;
      n++;
    }
    return n;
  };
  /** 정규화 시트의 모든 프레임 중 가장 아래 불투명 픽셀 기준 바닥 여백(px) — 오버레이가 발을 바닥선에 맞추는 데 사용 */
  const footPad = (px, w, h, cell) => {
    let pad = cell;
    for (let cy = 0; cy < h; cy += cell) {
      for (let cx = 0; cx < w; cx += cell) {
        let empty = true;
        for (let y = cy + cell - 1; y >= cy; y--) {
          let hit = false;
          for (let x = cx; x < cx + cell; x++) if (px[(y * w + x) * 4 + 3] > 0) { hit = true; break; }
          if (hit) { pad = Math.min(pad, cy + cell - 1 - y); empty = false; break; }
        }
        if (empty) continue;
      }
    }
    return pad === cell ? 0 : pad;
  };
  const blit = (dst, dw, sx, sy, dx, dy, w, h, src) => {
    for (let y = 0; y < h; y++) {
      src.px.copy(dst, ((dy + y) * dw + dx) * 4, ((sy + y) * src.w + sx) * 4, ((sy + y) * src.w + sx + w) * 4);
    }
  };
  // 4성
  for (const file of walk(path.join(petsDir, '4성'))) {
    if (!file.endsWith('.png')) continue;
    const id = path.basename(file, '.png').trim();
    const img = pngDecodeRgba(fs.readFileSync(file));
    if (!img || img.w !== 84 || img.h !== 16) continue;
    const cw = 21, ch = 16;
    const out = Buffer.alloc(2 * cw * 2 * ch * 4);
    blit(out, 2 * cw, 0, 0, 0, 0, cw, ch, img); // idle: 0번
    blit(out, 2 * cw, 0, 0, 0, ch, cw, ch, img); // walk: 0번
    blit(out, 2 * cw, cw, 0, cw, ch, cw, ch, img); // walk: 1번
    fs.writeFileSync(path.join(DEST, 'pets', `${id}.png`), pngEncodeRgba(2 * cw, 2 * ch, out));
    const foot = footPad(out, 2 * cw, 2 * ch, ch);
    pets[id] = { cellW: cw, cellH: ch, idle: 1, walk: 2, faceLeft: true, ...(foot ? { foot } : {}) };
  }
  // 5성
  for (const [id, s] of Object.entries(PET_SOURCES)) {
    const idleImg = decodeFile(s.idle[0]);
    const walkImg = decodeFile(s.walk[0]);
    const cell = s.cell;
    const idleN = s.idleFrames ?? Math.max(1, rowFrames(idleImg, cell, s.idle[1]));
    const walkN = Math.max(1, rowFrames(walkImg, cell, s.walk[1]));
    const leftImg = s.walkLeft ? decodeFile(s.walkLeft[0]) : null;
    const leftN = leftImg ? Math.max(1, rowFrames(leftImg, cell, s.walkLeft[1])) : 0;
    const rows = leftImg ? 3 : 2;
    const cols = Math.max(idleN, walkN, leftN);
    const out = Buffer.alloc(cols * cell * rows * cell * 4);
    for (let i = 0; i < idleN; i++) blit(out, cols * cell, i * cell, s.idle[1] * cell, i * cell, 0, cell, cell, idleImg);
    for (let i = 0; i < walkN; i++) blit(out, cols * cell, i * cell, s.walk[1] * cell, i * cell, cell, cell, cell, walkImg);
    for (let i = 0; i < leftN; i++) blit(out, cols * cell, i * cell, s.walkLeft[1] * cell, i * cell, 2 * cell, cell, cell, leftImg);
    fs.writeFileSync(path.join(DEST, 'pets', `${id}.png`), pngEncodeRgba(cols * cell, rows * cell, out));
    const foot = footPad(out, cols * cell, rows * cell, cell);
    pets[id] = { cellW: cell, cellH: cell, idle: idleN, walk: walkN, ...(leftN ? { walkLeft: leftN } : {}), ...(s.float ? { float: true } : {}), ...(s.scale ? { scale: s.scale } : {}), ...(s.faceLeft ? { faceLeft: true } : {}), ...(foot ? { foot } : {}) };
  }
  // 아이콘/두루마리 + 등급 이펙트(2400×2880 480px 30프레임 → 1/2 다운스케일 1200×1440, 용량 1/4)
  fs.copyFileSync(path.join(petsDir, '3성', '펫먹이.png'), path.join(DEST, 'pets', 'ui', 'food.png'));
  fs.copyFileSync(path.join(petsDir, '3성', '펫경험치카드.png'), path.join(DEST, 'pets', 'ui', 'card.png'));
  fs.copyFileSync(path.join(petsDir, 'Magic Scroll14.png'), path.join(DEST, 'pets', 'ui', 'scroll.png'));
  const downscale2 = (img) => {
    const w = img.w >> 1, h = img.h >> 1;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = ((y * 2 + dy) * img.w + (x * 2 + dx)) * 4;
            const pa = img.px[i + 3];
            r += img.px[i] * pa;
            g += img.px[i + 1] * pa;
            b += img.px[i + 2] * pa;
            a += pa;
          }
        }
        const o = (y * w + x) * 4;
        if (a > 0) {
          out[o] = Math.round(r / a);
          out[o + 1] = Math.round(g / a);
          out[o + 2] = Math.round(b / a);
        }
        out[o + 3] = Math.round(a / 4);
      }
    }
    return { w, h, px: out };
  };
  const FX_FILES = { 3: 'pipo-nazoobj01b_480.png', 4: 'pipo-nazoobj01a_480.png', 5: 'pipo-nazoobj01c_480.png' }; // b=파랑, a=보라, c=노랑
  const fx = {};
  for (const [star, file] of Object.entries(FX_FILES)) {
    const src = path.join(petsDir, file);
    const outPath = path.join(DEST, 'pets', 'ui', `fx-${star}.png`);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).mtimeMs < fs.statSync(src).mtimeMs) {
      const small = downscale2(pngDecodeRgba(fs.readFileSync(src)));
      fs.writeFileSync(outPath, pngEncodeRgba(small.w, small.h, small.px));
    }
    fx[star] = `pets/ui/fx-${star}.png`;
  }
  petUi = { food: 'pets/ui/food.png', card: 'pets/ui/card.png', scroll: 'pets/ui/scroll.png', fx, fxCell: 240, fxCols: 5, fxCount: 30 };
}

const manifest = {
  fish,
  fish2,
  tools: {
    frameW: 96,
    frameH: 64,
    strips: { casting: 15, waiting: 9, reeling: 13, caught: 10 },
    files: TOOL_STRIPS,
  },
  dig: { file: `tools/${DIG_STRIP}`, frames: 13 },
  minerals,
  monsters,
  reaction: { cell: 16, cols: 9, rows: 7 },
  effects,
  pets,
  petUi,
};
fs.writeFileSync(path.join(DEST, 'manifest-extras.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  `물고기 ${fish.length}종 + 새 물고기 ${fish2.length}종 + 광물 ${minerals.length}종 + 도구/러너/리액션 임포트 완료 → ${DEST}`,
);
console.log('fish2 =', JSON.stringify(fish2));
console.log('minerals =', JSON.stringify(minerals));
console.log(`monsters = ${monsters.length}종`);
console.log(`pets = ${Object.keys(pets).length}종${petUi ? ' + ui/fx' : ''}`);

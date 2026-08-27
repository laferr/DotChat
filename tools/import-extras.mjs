// 추가에셋(낚시/러너/리액션/도감)을 assets/extras/로 임포트 + 매니페스트 생성
// 사용법: node tools/import-extras.mjs [추가에셋 경로]
import fs from 'node:fs';
import path from 'node:path';
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
  reaction: { cell: 16, cols: 9, rows: 7 },
  effects,
};
fs.writeFileSync(path.join(DEST, 'manifest-extras.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  `물고기 ${fish.length}종 + 새 물고기 ${fish2.length}종 + 광물 ${minerals.length}종 + 도구/러너/리액션 임포트 완료 → ${DEST}`,
);
console.log('fish2 =', JSON.stringify(fish2));
console.log('minerals =', JSON.stringify(minerals));

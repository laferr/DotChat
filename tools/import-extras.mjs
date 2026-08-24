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

// 러너 장애물
fs.copyFileSync(path.join(SRC, 'rungame', 'Arrow.png'), path.join(DEST, 'rungame', 'Arrow.png'));
fs.copyFileSync(path.join(SRC, 'rungame', 'Trap3.png'), path.join(DEST, 'rungame', 'Trap3.png'));

// 리액션 이모지 시트 + 도감 책 배경
fs.copyFileSync(path.join(SRC, 'speech bubble, emojis, reaction.png'), path.join(DEST, 'reaction.png'));
fs.copyFileSync(path.join(SRC, 'Book.png'), path.join(DEST, 'book.png'));

const manifest = {
  fish,
  tools: {
    frameW: 96,
    frameH: 64,
    strips: { casting: 15, waiting: 9, reeling: 13, caught: 10 },
    files: TOOL_STRIPS,
  },
  reaction: { cell: 16, cols: 9, rows: 7 },
};
fs.writeFileSync(path.join(DEST, 'manifest-extras.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`물고기 ${fish.length}종 + 도구/러너/리액션 임포트 완료 → ${DEST}`);
console.log(JSON.stringify(fish));

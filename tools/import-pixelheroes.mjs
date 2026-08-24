// PixelFantasy(PixelHeroes) 유니티 에셋에서 필요한 시트만 프로젝트로 복사 + manifest 생성
// 사용법: node tools/import-pixelheroes.mjs [에셋 루트]
// 에셋 루트 기본값: D:/assetsPuller/Assets/PixelFantasy/PixelHeroes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? process.env.PIXELHEROES_SRC ?? 'D:/assetsPuller/Assets/PixelFantasy/PixelHeroes';
const DEST = path.join(root, 'assets', 'pixelheroes');

// Firearm은 합성 로직이 복잡해 제외. Arms/Bracers는 종족/갑옷명으로 자동 선택되는 동반 레이어.
const LAYER_DIRS = {
  Armor: 'FantasyHeroes/Sprites/Armor',
  Arms: 'FantasyHeroes/Sprites/Arms',
  Back: 'FantasyHeroes/Sprites/Back',
  Body: 'FantasyHeroes/Sprites/Body',
  Bracers: 'FantasyHeroes/Sprites/Bracers',
  Cape: 'FantasyHeroes/Sprites/Cape',
  Ears: 'FantasyHeroes/Sprites/Ears',
  Eyes: 'FantasyHeroes/Sprites/Eyes',
  Head: 'FantasyHeroes/Sprites/Head',
  Helmet: 'FantasyHeroes/Sprites/Helmet',
  Horns: 'FantasyHeroes/Sprites/Horns',
  Mask: 'FantasyHeroes/Sprites/Mask',
  Shield: 'FantasyHeroes/Sprites/Shield',
  Weapon: 'FantasyHeroes/Sprites/Weapon',
  Hair: 'Common/Sprites/Hair',
};

const layers = {};
let total = 0;

for (const [layer, rel] of Object.entries(LAYER_DIRS)) {
  const srcDir = path.join(SRC, rel);
  if (!fs.existsSync(srcDir)) {
    console.error(`누락된 폴더: ${srcDir}`);
    process.exit(1);
  }
  const destDir = path.join(DEST, layer);
  fs.mkdirSync(destDir, { recursive: true });
  const names = [];
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.png')) continue;
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    names.push(file.replace(/\.png$/, ''));
    total++;
  }
  names.sort();
  layers[layer] = names;
}

// 종족 = Body/Head/Eyes 모두에 존재하는 이름. ears = Ears 시트 보유 여부
const races = layers.Body.filter((n) => layers.Head.includes(n) && layers.Eyes.includes(n)).map(
  (name) => ({ name, ears: layers.Ears.includes(name) }),
);

const manifest = {
  cell: 64,
  sheetW: 576,
  sheetH: 928,
  layers,
  races,
};

fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`${total}개 시트 복사 완료 → ${DEST}`);
console.log(`종족 ${races.length}종, 레이어: ${Object.entries(layers).map(([k, v]) => `${k}:${v.length}`).join(', ')}`);

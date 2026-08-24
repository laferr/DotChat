// 릴리스 버전 일괄 갱신: 클라이언트 package.json + shared APP_VERSION + 락파일
// 사용법: node tools/bump-version.mjs 0.2.4
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('사용법: node tools/bump-version.mjs <x.y.z>');
  process.exit(1);
}

// 클라이언트 package.json
const clientPkgPath = path.join(root, 'packages', 'client', 'package.json');
const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, 'utf8'));
clientPkg.version = version;
fs.writeFileSync(clientPkgPath, JSON.stringify(clientPkg, null, 2) + '\n', 'utf8');

// shared APP_VERSION
const versionTsPath = path.join(root, 'packages', 'shared', 'src', 'version.ts');
fs.writeFileSync(
  versionTsPath,
  `// 서버/클라이언트 공용 앱 버전 — tools/bump-version.mjs로 클라이언트 package.json과 함께 갱신\nexport const APP_VERSION = '${version}';\n`,
  'utf8',
);

// 락파일 동기화 (Railway npm ci 실패 방지)
execSync('npm install', { cwd: root, stdio: 'inherit' });

console.log(`버전 ${version} 반영 완료 (client package.json, shared APP_VERSION, package-lock)`);

// 낚싯대 강화 검증 — 비용 차감/상태 전이/천장/쿨타임/잔액 부족 + 낚시 보너스 + 테이블 동기화
// 사용법: node tools/verify-enhance.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { io } = require(path.join(root, 'node_modules', 'socket.io-client'));
const shared = require(path.join(root, 'packages', 'shared', 'dist', 'protocol.js'));

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };

const fail = (msg) => {
  console.log(`ENHANCE_FAIL ${msg}`);
  process.exit(1);
};

// 0) 렌더러 복사본(composer.ts FORGE_TABLE)이 shared ENHANCE_TABLE과 동일한지
{
  const code = fs.readFileSync(path.join(root, 'packages', 'client', 'dist', 'renderer', 'composer.js'), 'utf8');
  const dup = new Function(`${code}; return { FORGE_TABLE, FORGE_MAX, FORGE_PITY };`)();
  if (dup.FORGE_MAX !== shared.ENHANCE_MAX || dup.FORGE_PITY !== shared.ENHANCE_PITY) fail('MAX/PITY 불일치');
  if (JSON.stringify(dup.FORGE_TABLE) !== JSON.stringify(shared.ENHANCE_TABLE)) fail('FORGE_TABLE ≠ ENHANCE_TABLE');
  console.log('  테이블 동기화 OK (shared ↔ composer)');
}

const connect = (nickname, tag) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => reject(new Error(`${nickname} 연결 시간 초과`)), 10000);
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('connect', () => socket.emit('hello', { nickname, tag, appearance: APPEARANCE }));
    socket.on('wallet', (w) => { clearTimeout(timer); resolve({ socket, wallet: w }); });
  });

const emitAck = (socket, event, ...args) =>
  new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, ...args, (err, res) => (err ? reject(err) : resolve(res)));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 강화 전이 검증 — 시드 지갑(코인 넉넉)으로 25회
const a = await connect('강화검증', '0031');
let stars = a.wallet.rodStars ?? 0;
let fails = a.wallet.rodFails ?? 0;
let coins = a.wallet.coins;
let sawSuccess = false;
let sawKeep = false;
for (let i = 0; i < 25; i++) {
  const stage = shared.ENHANCE_TABLE[stars];
  const res = await emitAck(a.socket, 'enhance');
  if (!res.ok) fail(`강화 거부: ${JSON.stringify(res)} (stars=${stars}, coins=${coins})`);
  if (res.coins !== coins - stage.cost) fail(`비용 차감 이상: ${coins} - ${stage.cost} ≠ ${res.coins}`);
  if (res.result === 'success') {
    if (fails >= shared.ENHANCE_PITY && !res.guaranteed) fail('천장인데 guaranteed 아님');
    if (res.stars !== stars + 1 || res.fails !== 0) fail(`성공 전이 이상: ${JSON.stringify(res)}`);
    sawSuccess = true;
  } else if (res.result === 'keep') {
    if (res.stars !== stars || res.fails !== fails + 1) fail(`유지 전이 이상: ${JSON.stringify(res)}`);
    sawKeep = true;
  } else if (res.result === 'drop') {
    const floor = shared.enhanceFloor(stars);
    if (res.stars !== Math.max(floor, stars - 1) || res.fails !== 0) fail(`하락 전이 이상: ${JSON.stringify(res)}`);
  } else {
    fail(`알 수 없는 결과: ${JSON.stringify(res)}`);
  }
  stars = res.stars;
  fails = res.fails;
  coins = res.coins;
  await sleep(550);
}
console.log(`  강화 전이 OK (25회 → 현재 ${stars}성, 잔액 ${coins}, 성공/유지 관측: ${sawSuccess}/${sawKeep})`);

// 2) 쿨타임 (500ms 내 재시도 거부)
await emitAck(a.socket, 'enhance');
const fast = await emitAck(a.socket, 'enhance');
if (fast.ok) fail('쿨타임 무시됨');
console.log('  쿨타임 OK');

// 3) 낚시 보너스 — 시드 지갑 rodStars=12: 반복 어획 +1 (delta 2)
const b = await connect('강화검증B', '0032');
let res = await emitAck(b.socket, 'fish', 'carp'); // 첫 획득 +5
if (!res.ok || res.delta !== 5) fail(`첫 획득 이상: ${JSON.stringify(res)}`);
await sleep(8200);
res = await emitAck(b.socket, 'fish', 'carp'); // 반복 1 + 강화 보너스 1
if (!res.ok || res.delta !== 2) fail(`10성+ 반복 보너스 이상: ${JSON.stringify(res)} (expected delta 2)`);
console.log('  10성+ 반복 어획 보너스 OK (+2)');

// 4) 잔액 부족 — 신규 유저 (스타터 10코인, 0성 비용 5)
const c = await connect('강화검증C', '0033');
let cc = c.wallet.coins;
for (let i = 0; i < 5 && cc >= shared.ENHANCE_TABLE[0].cost; i++) {
  const r = await emitAck(c.socket, 'enhance');
  if (!r.ok) break;
  cc = r.coins;
  await sleep(550);
}
const broke = await emitAck(c.socket, 'enhance');
if (broke.ok && cc < shared.ENHANCE_TABLE[broke.stars ?? 0]?.cost) fail('잔액 부족인데 강화됨');
if (!broke.ok && !String(broke.error).includes('부족') && !String(broke.error).includes('빨라')) {
  fail(`예상 밖 거부 사유: ${broke.error}`);
}
console.log(`  잔액 부족 처리 OK (잔액 ${cc})`);

a.socket.disconnect();
b.socket.disconnect();
c.socket.disconnect();
console.log('ENHANCE_OK');
process.exit(0);

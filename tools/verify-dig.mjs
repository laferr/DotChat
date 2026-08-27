// 땅파기 프로토콜 검증 — 정산(코인/젬/도감), 레이트리밋, 잘못된 id 거부, 특수 슬롯(젬조각/황금상자),
// 다이아 전체 알림, 그리고 shared MINERALS ↔ composer.ts MINERAL_DEFS 동기화 검사
// 사용법: node tools/verify-dig.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  MINERALS,
  DIG_FIRST_COIN,
  DIG_GOLDBAR_COIN,
  DIG_CHEST_GOLD_COIN,
  DIG_MIN_INTERVAL_MS,
} from '../packages/shared/dist/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = '발굴검증';
const TAG = String(1000 + Math.floor(Math.random() * 9000));

const fail = (msg) => {
  console.log(`DIG_FAIL ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0) shared MINERALS ↔ composer.ts MINERAL_DEFS 동기화 검사 (렌더러 중복 테이블)
{
  const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/composer.ts'), 'utf8');
  const m = /const MINERAL_DEFS[^=]*= (\[[\s\S]*?\n\]);/.exec(src);
  if (!m) fail('composer.ts에서 MINERAL_DEFS를 찾을 수 없음');
  const defs = new Function(`return ${m[1]}`)();
  if (defs.length !== MINERALS.length) fail(`MINERAL_DEFS ${defs.length}종 ≠ shared ${MINERALS.length}종`);
  for (let i = 0; i < MINERALS.length; i++) {
    const a = MINERALS[i];
    const b = defs.find((d) => d.id === a.id);
    if (!b || b.name !== a.name || b.cat !== a.cat) {
      fail(`MINERAL_DEFS 불일치: ${a.id} shared=${JSON.stringify(a)} composer=${JSON.stringify(b)}`);
    }
  }
  console.log(`  동기화 OK: MINERAL_DEFS ${defs.length}종 = shared MINERALS`);
}

const socket = io(url, { reconnection: false, timeout: 8000 });
let gems = 0;
let selfId = null;
const digNews = [];
socket.on('gems', (g) => (gems = g));
socket.on('dig-news', (d) => digNews.push(d));

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('연결 시간 초과')), 10000);
  socket.on('connect_error', reject);
  socket.on('welcome', (data) => {
    clearTimeout(timer);
    selfId = data.selfId;
    resolve();
  });
  socket.on('connect', () =>
    socket.emit('hello', { nickname: NICK, tag: TAG, appearance: { race: { name: 'Human' } } }),
  );
}).catch((e) => fail(e.message));
await sleep(600);

const dig = (payload) =>
  new Promise((r) => socket.timeout(5000).emit('dig', payload, (err, v) => r(err ? null : v)));
const achState = () =>
  new Promise((r) => socket.timeout(5000).emit('ach-state', (err, v) => r(err ? null : v)));

// 1) 광물 첫 발굴 (돌멩이 m14): isNew + 첫 발견 코인
let res = await dig({ kind: 'mineral', itemId: 'm14' });
if (!res?.ok) fail(`m14 발굴 실패: ${res?.error}`);
if (!res.isNew) fail('m14 첫 발굴인데 isNew=false');
if (res.delta !== DIG_FIRST_COIN.stone) fail(`돌 첫 발견 코인 ${res.delta} (기대 ${DIG_FIRST_COIN.stone})`);
if (!res.minerals?.includes('m14')) fail('도감에 m14 미등재');
console.log(`  발굴 OK: m14 NEW +${res.delta}🪙 (도감 ${res.minerals.length}종)`);

// 2) 레이트리밋: 즉시 재시도는 거부
res = await dig({ kind: 'mineral', itemId: 'm49' });
if (res?.ok) fail('레이트리밋 미작동 (즉시 재발굴 허용됨)');
console.log(`  레이트리밋 OK: "${res?.error}"`);

// 3) 잘못된 광물 id 거부
await sleep(DIG_MIN_INTERVAL_MS + 200);
res = await dig({ kind: 'mineral', itemId: 'zzz999' });
if (res?.ok) fail('잘못된 광물 id가 허용됨');
res = await dig({ kind: 'hack' });
if (res?.ok) fail('잘못된 kind가 허용됨');
console.log('  검증 OK: 잘못된 id/kind 거부');

// 4) 중복 발굴: 반복 코인 (검증 3에서 거부된 시도는 쿨타임을 소모하지 않음)
res = await dig({ kind: 'mineral', itemId: 'm14' });
if (!res?.ok) fail(`m14 재발굴 실패: ${res?.error}`);
if (res.isNew) fail('중복 발굴인데 isNew=true');
if (res.delta !== 1) fail(`돌 중복 코인 ${res.delta} (기대 1)`);
console.log(`  중복 발굴 OK: m14 +${res.delta}🪙`);

// 5) 젬 조각 (잔액 비교는 생략 — 일퀘 '땅파기 3회'/업적 보상 젬이 겹칠 수 있음)
await sleep(DIG_MIN_INTERVAL_MS + 200);
res = await dig({ kind: 'gem' });
if (!res?.ok) fail(`젬 조각 실패: ${res?.error}`);
if (res.gemsDelta !== 1) fail(`젬 조각 gemsDelta=${res.gemsDelta} (기대 1)`);
console.log(`  젬 조각 OK: +1💎 (잔액 ${res.gems})`);

// 6) 황금 보물상자: +50🪙 +1💎
await sleep(DIG_MIN_INTERVAL_MS + 200);
res = await dig({ kind: 'chest-gold' });
if (!res?.ok) fail(`황금상자 실패: ${res?.error}`);
if (res.delta !== DIG_CHEST_GOLD_COIN || res.gemsDelta !== 1) {
  fail(`황금상자 보상 +${res.delta}🪙 +${res.gemsDelta}💎 (기대 +${DIG_CHEST_GOLD_COIN}/+1)`);
}
console.log(`  황금상자 OK: +${res.delta}🪙 +1💎`);

// 7) 금괴: 고정 코인 + 도감 등재
await sleep(DIG_MIN_INTERVAL_MS + 200);
res = await dig({ kind: 'mineral', itemId: 'm48' });
if (!res?.ok) fail(`금괴 실패: ${res?.error}`);
if (res.delta !== DIG_GOLDBAR_COIN) fail(`금괴 코인 ${res.delta} (기대 ${DIG_GOLDBAR_COIN})`);
console.log(`  금괴 OK: +${res.delta}🪙`);

// 8) 다이아 발굴: 첫 발견 젬 + 전체 알림
await sleep(DIG_MIN_INTERVAL_MS + 200);
res = await dig({ kind: 'mineral', itemId: 'd1' });
if (!res?.ok) fail(`다이아 실패: ${res?.error}`);
if (res.delta !== DIG_FIRST_COIN.diamond || res.gemsDelta !== 5) {
  fail(`다이아 보상 +${res.delta}🪙 +${res.gemsDelta}💎 (기대 +${DIG_FIRST_COIN.diamond}/+5)`);
}
await sleep(500);
if (!digNews.some((d) => d.id === selfId && d.name === '다이아몬드')) {
  fail(`dig-news 미수신: ${JSON.stringify(digNews)}`);
}
console.log('  다이아 OK: +5💎 + 전체 알림(dig-news)');

// 9) 꽝 + 업적 metric (digTotal/digMiss/digDex/goldbar/diamondDex)
await sleep(DIG_MIN_INTERVAL_MS + 200);
res = await dig({ kind: 'miss' });
if (!res?.ok) fail(`꽝 실패: ${res?.error}`);
const ach = await achState();
if (!ach) fail('ach-state 응답 없음');
if ((ach.metrics.digTotal ?? 0) < 7) fail(`digTotal=${ach.metrics.digTotal} (기대 7+)`);
if ((ach.metrics.digMiss ?? 0) !== 1) fail(`digMiss=${ach.metrics.digMiss} (기대 1)`);
if ((ach.metrics.digDex ?? 0) !== 3) fail(`digDex=${ach.metrics.digDex} (기대 3: m14/m48/d1)`);
if (ach.metrics.goldbar !== 1) fail(`goldbar=${ach.metrics.goldbar} (기대 1)`);
if (ach.metrics.diamondDex !== 1) fail(`diamondDex=${ach.metrics.diamondDex} (기대 1)`);
if (!ach.ach.includes('x-first')) fail('x-first(첫 삽) 미달성');
if (!ach.ach.includes('x-goldbar')) fail('x-goldbar(노다지) 미달성');
if (!ach.ach.includes('x-diamond')) fail('x-diamond(심봤다) 미달성');
console.log(
  `  업적 OK: digTotal ${ach.metrics.digTotal} · digDex ${ach.metrics.digDex} · x-first/x-goldbar/x-diamond 달성`,
);

console.log('DIG_OK');
socket.close();
process.exit(0);

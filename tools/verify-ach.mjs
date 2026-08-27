// 도전과제/칭호 프로토콜 검증 — 신규 지갑 소급 정산(첫 출석), metric 카운터, 이벤트성 업적(빈털터리),
// 젬 지급, 칭호 착용 검증(미달성 거부/해제), shared ACHIEVEMENTS ↔ composer.ts ACH_DEFS 동기화 검사
// 사용법: node tools/verify-ach.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { ACHIEVEMENTS } from '../packages/shared/dist/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = '업적검증';
const TAG = String(1000 + Math.floor(Math.random() * 9000));

const fail = (msg) => {
  console.log(`ACH_FAIL ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0) shared ACHIEVEMENTS ↔ composer.ts ACH_DEFS 동기화 검사 (렌더러 중복 테이블)
{
  const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/composer.ts'), 'utf8');
  const m = /const ACH_DEFS[\s\S]*?\}\[\] = (\[[\s\S]*?\n\]);/.exec(src);
  if (!m) fail('composer.ts에서 ACH_DEFS를 찾을 수 없음');
  const defs = new Function(`return ${m[1]}`)();
  if (defs.length !== ACHIEVEMENTS.length) fail(`ACH_DEFS ${defs.length}개 ≠ shared ${ACHIEVEMENTS.length}개`);
  for (const a of ACHIEVEMENTS) {
    const b = defs.find((d) => d.id === a.id);
    if (
      !b ||
      b.cat !== a.cat ||
      b.name !== a.name ||
      b.desc !== a.desc ||
      b.gems !== a.gems ||
      (b.title ?? null) !== (a.title ?? null) ||
      (b.hidden ?? false) !== (a.hidden ?? false) ||
      (b.stat ?? null) !== (a.stat ?? null) ||
      (b.goal ?? null) !== (a.goal ?? null)
    ) {
      fail(`ACH_DEFS 불일치: ${a.id} shared=${JSON.stringify(a)} composer=${JSON.stringify(b)}`);
    }
  }
  console.log(`  동기화 OK: ACH_DEFS ${defs.length}개 = shared ACHIEVEMENTS`);
}

const socket = io(url, { reconnection: false, timeout: 8000 });
let gems = 0;
let selfId = null;
const achieved = []; // achievement 이벤트로 받은 달성 목록
socket.on('gems', (g) => (gems = g));
socket.on('achievement', (list) => {
  for (const a of list ?? []) achieved.push(a);
});

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
await sleep(700);

const achState = () =>
  new Promise((r) => socket.timeout(5000).emit('ach-state', (err, v) => r(err ? null : v)));
const setTitle = (t) =>
  new Promise((r) => socket.timeout(5000).emit('set-title', t, (err, v) => r(err ? null : v)));

// 1) 신규 지갑 접속 → 첫 출석(d-first) 소급 지급 + 젬 반영
if (!achieved.some((a) => a.id === 'd-first')) {
  fail(`접속 시 d-first 미지급 (수신: ${achieved.map((a) => a.id).join(', ') || '없음'})`);
}
let state = await achState();
if (!state) fail('ach-state 응답 없음');
if (!state.ach.includes('d-first')) fail('ach-state에 d-first 없음');
if ((state.metrics.attendTotal ?? 0) !== 1) fail(`attendTotal=${state.metrics.attendTotal} (기대 1)`);
const expectGems = achieved.reduce((s, a) => s + a.gems, 0);
if (gems !== expectGems) fail(`젬 잔액 ${gems} (기대 ${expectGems} = 달성 업적 합)`);
console.log(`  소급 정산 OK: ${achieved.map((a) => a.id).join(', ')} (+${expectGems}💎)`);

// 2) metric 카운터: 채팅 → chats 증가, 첫 어획 → f-first 지급
socket.emit('chat', '업적 검증 채팅');
await sleep(500);
const fishRes = await new Promise((r) =>
  socket.timeout(5000).emit('fish', 'Carp', (err, v) => r(err ? null : v)),
);
if (!fishRes?.ok) fail(`낚시 실패: ${fishRes?.error}`);
await sleep(500);
state = await achState();
if ((state.metrics.chats ?? 0) !== 1) fail(`chats=${state.metrics.chats} (기대 1)`);
if ((state.metrics.fishDex ?? 0) !== 1) fail(`fishDex=${state.metrics.fishDex} (기대 1)`);
if (!state.ach.includes('f-first')) fail('첫 어획 후 f-first 미달성');
if (!achieved.some((a) => a.id === 'f-first')) fail('f-first achievement 이벤트 미수신');
console.log(`  metric OK: chats 1 · fishDex 1 → f-first 달성 (+2💎)`);

// 3) 이벤트성 업적: 주식 첫 매수(s-first) + 잔액 0 슬롯 시도(히든 h-broke)
{
  let bal = (await achState()).metrics.coinsNow;
  const buy = (id, qty) =>
    new Promise((r) => socket.timeout(5000).emit('stock-buy', id, qty, (err, v) => r(err ? null : v)));
  const spin = () => new Promise((r) => socket.timeout(5000).emit('slot', (err, v) => r(err ? null : v)));
  let boughtAny = false;
  // 최저가 종목 매수 + 슬롯으로 잔액을 0까지 소진 (시세/당첨 사정으로 실패하면 스킵)
  for (let i = 0; i < 80 && bal > 0; i++) {
    if (bal >= 5) {
      const res = await buy('botsoon', 1);
      if (res?.ok) {
        boughtAny = true;
        bal = res.coins;
        continue;
      }
    }
    if (bal >= 3) {
      const res = await spin();
      if (res?.ok) bal = res.coins;
      await sleep(1100); // 슬롯 최소 간격
      continue;
    }
    break; // 1~2코인 잔돈은 소진 불가
  }
  if (boughtAny) {
    state = await achState();
    if (!state.ach.includes('s-first')) fail('주식 매수 후 s-first 미달성');
    console.log('  주식 OK: 첫 매수 → s-first 달성');
  }
  if (bal === 0) {
    const slotRes = await spin();
    if (slotRes?.ok) fail('잔액 0인데 슬롯이 돌아감');
    await sleep(400);
    state = await achState();
    if (!state.ach.includes('h-broke')) fail('빈털터리(h-broke) 미달성');
    console.log('  히든 OK: 잔액 0 슬롯 시도 → h-broke 달성');
  } else {
    console.log(`  히든 스킵: 잔액을 0으로 못 맞춤 (잔액 ${bal} — 시세/당첨 사정)`);
  }
}

// 4) 칭호: 미달성 칭호 거부, 해제 허용
const badTitle = await setTitle('어류학자');
if (badTitle?.ok) fail('미달성 칭호 착용이 허용됨');
const clearTitle = await setTitle('');
if (!clearTitle?.ok) fail(`칭호 해제 실패: ${clearTitle?.error}`);
state = await achState();
if (state.title !== '') fail(`해제 후 title="${state.title}"`);
console.log('  칭호 OK: 미달성 거부 + 해제 정상');

console.log('ACH_OK');
socket.close();
process.exit(0);

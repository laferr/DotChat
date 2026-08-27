// 일일퀘스트/출석/젬 프로토콜 검증 — 출석(골드), 퀘스트 보상(젬), 전체 보너스(젬),
// 액션 잠금(미구매 시 서버 차단) + buy-action 구매 후 사용 가능까지 확인
// 사용법: node tools/verify-daily.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
// 매 실행마다 새 지갑(랜덤 태그)을 만들어 하루 1회 제약 없이 검증한다.
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };
const NICK = '일퀘검증';
const TAG = String(1000 + Math.floor(Math.random() * 9000));

const fail = (msg) => {
  console.log(`DAILY_FAIL ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const socket = io(url, { reconnection: false, timeout: 8000 });
let daily = null;
let coins = 0;
let gems = 0;
let selfId = null;
const newsLog = [];
const myActionMsgs = [];
socket.on('daily', (state) => {
  daily = state;
  if (state?.news) newsLog.push(state.news);
});
socket.on('coins', (c) => (coins = c));
socket.on('gems', (g) => (gems = g));
socket.on('chat', (msg) => {
  if (msg.id === selfId && msg.action) myActionMsgs.push(msg.action);
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('연결 시간 초과')), 10000);
  socket.on('connect_error', reject);
  socket.on('welcome', (data) => {
    clearTimeout(timer);
    selfId = data.selfId;
    resolve();
  });
  socket.on('connect', () => socket.emit('hello', { nickname: NICK, tag: TAG, appearance: APPEARANCE }));
}).catch((e) => fail(e.message));

await sleep(500);

// 1) 출석: 골드 지급 (스타터 10 + 출석 3 = 13), 젬 0
if (!daily) fail('접속 직후 daily push 없음');
if (daily.streak !== 1) fail(`신규 지갑 streak=${daily.streak} (기대 1)`);
if (!newsLog.some((n) => n.includes('출석 1일차'))) fail(`출석 안내 없음: ${JSON.stringify(newsLog)}`);
if (daily.quests?.length !== 3) fail(`활성 퀘스트 ${daily.quests?.length}개 (기대 3)`);
if (coins !== 13) fail(`출석 후 코인 ${coins} (기대 13)`);
console.log(`  출석 OK: streak 1, 골드 +3 (잔액 ${coins} 🪙), 오늘 퀘스트: ${daily.quests.map((q) => q.id).join(', ')}`);

// 2) 미구매 액션은 서버가 차단
socket.emit('action', { action: 'jump', text: '검증' });
await sleep(600);
if (myActionMsgs.length !== 0) fail(`미구매 액션이 브로드캐스트됨: ${myActionMsgs}`);
console.log('  액션 잠금 OK: 미구매 jump 차단됨');

// 3) 오늘의 퀘스트 수행 → 보상은 젬
for (const q of daily.quests) {
  switch (q.id) {
    case 'chat':
      for (let i = 0; i < q.goal; i++) {
        socket.emit('chat', `일퀘 검증 채팅 ${i + 1}`);
        await sleep(400);
      }
      break;
    case 'reaction':
      for (let i = 0; i < q.goal; i++) {
        socket.emit('reaction', i);
        await sleep(400);
      }
      break;
    case 'slot':
      for (let i = 0; i < q.goal; i++) {
        const res = await new Promise((r) => socket.timeout(5000).emit('slot', (err, v) => r(err ? null : v)));
        if (!res?.ok) fail(`슬롯 실패: ${res?.error}`);
        await sleep(1100);
      }
      break;
    case 'runner':
      await new Promise((r) => socket.timeout(5000).emit('runner-score', q.goal + 2, (err, v) => r(v)));
      break;
    case 'fish':
      for (let i = 0; i < q.goal; i++) {
        if (i > 0) await sleep(8200);
        const res = await new Promise((r) => socket.timeout(5000).emit('fish', 'Carp', (err, v) => r(err ? null : v)));
        if (!res?.ok) fail(`낚시 실패: ${res?.error}`);
      }
      break;
    default:
      fail(`알 수 없는 퀘스트 id: ${q.id}`);
  }
  await sleep(400);
  const st = daily.quests.find((x) => x.id === q.id);
  if (!st?.claimed) fail(`퀘스트 미완료 처리: ${q.id} (${JSON.stringify(st)})`);
  console.log(`  퀘스트 OK: ${q.id} 완료 (+${q.reward} 💎)`);
}

// 4) 젬 정산: 퀘스트 보상 합 + 전체 보너스 5
await sleep(300);
if (!daily.allBonusClaimed) fail('전체 완료 보너스 미지급');
const expectedGems = daily.quests.reduce((s, q) => s + q.reward, 0) + 5;
if (gems !== expectedGems) fail(`젬 잔액 ${gems} (기대 ${expectedGems})`);
console.log(`  젬 정산 OK: ${gems} 💎 (퀘스트 합 + 보너스 5)`);

// 5) 액션 구매 → 사용 가능
const buy = await new Promise((r) => socket.timeout(5000).emit('buy-action', 'jump', (err, v) => r(err ? null : v)));
if (!buy?.ok) fail(`buy-action 실패: ${buy?.error}`);
if (!buy.actions?.includes('jump')) fail(`구매 후 actions에 jump 없음: ${JSON.stringify(buy.actions)}`);
if (buy.gems !== expectedGems - 6) fail(`구매 후 젬 ${buy.gems} (기대 ${expectedGems - 6})`);
await sleep(400); // 도배 방지 간격
socket.emit('action', { action: 'jump', text: '검증' });
await sleep(600);
if (!myActionMsgs.includes('jump')) fail('구매 후에도 액션이 차단됨');
console.log(`  액션 구매 OK: jump 6 💎 구매 후 사용 가능 (잔여 ${buy.gems} 💎)`);

console.log('DAILY_OK');
socket.close();
process.exit(0);

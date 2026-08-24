// 파츠 서버 동기화 + box/보물상자 낚시 보상 검증
// 사용법: node tools/verify-parts.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };

const fail = (msg) => {
  console.log(`PARTS_FAIL ${msg}`);
  process.exit(1);
};

const connect = (nickname, tag) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => reject(new Error(`${nickname} 연결 시간 초과`)), 10000);
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('welcome', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect', () => socket.emit('hello', { nickname, tag, appearance: APPEARANCE }));
  });

const emitAck = (socket, event, ...args) =>
  new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, ...args, (err, res) => (err ? reject(err) : resolve(res)));
  });

// 1) PC A: 파츠 등록 → ack에 그대로 포함
const a = await connect('파츠검증', '0021');
let res = await emitAck(a, 'parts-sync', ['race:Human', 'Hair/Hair1', 'Armor/TravelerTunic']);
if (!res.ok || !res.parts.includes('Hair/Hair1')) fail(`A 등록 실패: ${JSON.stringify(res)}`);
console.log(`  A 등록 OK (${res.parts.length}개)`);

// 2) 잘못된 형식/중복은 거부·무시
res = await emitAck(a, 'parts-sync', ['../etc/passwd', 'Hair/Hair1', 123, 'x'.repeat(99), 'Weapon/Sword1']);
if (!res.ok) fail('2차 등록 실패');
if (res.parts.includes('../etc/passwd')) fail('경로 침입 문자열이 통과됨');
if (res.parts.filter((p) => p === 'Hair/Hair1').length !== 1) fail('중복 제거 안 됨');
if (!res.parts.includes('Weapon/Sword1')) fail('정상 항목 누락');
console.log(`  형식 검증 OK (${res.parts.length}개)`);
a.disconnect();

// 3) PC B(같은 닉#태그, 빈 인벤토리): 서버 목록이 내려옴 + B 것도 합쳐짐
const b = await connect('파츠검증', '0021');
res = await emitAck(b, 'parts-sync', ['race:Goblin']);
for (const need of ['race:Human', 'Hair/Hair1', 'Armor/TravelerTunic', 'Weapon/Sword1', 'race:Goblin']) {
  if (!res.parts.includes(need)) fail(`PC 간 병합 누락: ${need}`);
}
console.log(`  PC 간 병합 OK (${res.parts.length}개)`);

// 4) box 낚시: 2~10코인, 도감 기록
res = await emitAck(b, 'fish', 'box');
if (!res.ok) fail(`box 정산 실패: ${JSON.stringify(res)}`);
if (res.delta < 2 || res.delta > 10) fail(`box 보상 범위 밖: ${res.delta}`);
if (!res.isNew) fail('box 도감 신규 기록 안 됨');
console.log(`  box OK (+${res.delta}코인)`);

// 5) 보물상자: 8초 쿨타임 후 — 20~50코인 또는 상점 아이템
await new Promise((r) => setTimeout(r, 8200));
res = await emitAck(b, 'fish', 'treasure_chest');
if (!res.ok) fail(`보물상자 정산 실패: ${JSON.stringify(res)}`);
if (res.item) {
  if (!res.item.id || !Array.isArray(res.items) || !res.items.includes(res.item.id)) {
    fail(`아이템 지급 불일치: ${JSON.stringify(res)}`);
  }
  console.log(`  보물상자 OK (아이템 '${res.item.name}')`);
} else {
  if (res.delta < 20 || res.delta > 50) fail(`보물상자 보상 범위 밖: ${res.delta}`);
  console.log(`  보물상자 OK (+${res.delta}코인)`);
}

// 6) 새 물고기 id 정상 인정 + 모르는 id 거부
await new Promise((r) => setTimeout(r, 8200));
res = await emitAck(b, 'fish', 'Amanita_Fungifin');
if (!res.ok || !res.isNew || res.delta !== 5) fail(`새 물고기 정산 이상: ${JSON.stringify(res)}`);
res = await emitAck(b, 'fish', 'NotARealFish');
if (res.ok) fail('알 수 없는 물고기가 통과됨');
console.log('  새 물고기/유효성 OK');

// 7) 월척: (fishId, true, ack) 3인자 — 반복어(1) + 보너스(5) = 6, trophies 기록
await new Promise((r) => setTimeout(r, 8200));
res = await emitAck(b, 'fish', 'Amanita_Fungifin', true);
if (!res.ok || res.trophy !== true || res.delta !== 6) fail(`월척 정산 이상: ${JSON.stringify(res)}`);
console.log(`  월척 OK (+${res.delta}코인, trophy=${res.trophy})`);
// 상자에는 월척 미적용
await new Promise((r) => setTimeout(r, 8200));
res = await emitAck(b, 'fish', 'box', true);
if (!res.ok || res.trophy === true) fail(`상자에 월척이 적용됨: ${JSON.stringify(res)}`);
console.log('  상자 월척 제외 OK');

// 8) 랜덤 뽑기 결제: 잔액에 따라 정확히 차감 or 부족 거부, 없는 상품 거부
const before = res.coins;
res = await emitAck(b, 'buy-random', 'rand-any'); // 200코인
if (before >= 200) {
  if (!res.ok || res.coins !== before - 200) fail(`랜덤 뽑기 차감 이상: ${before} → ${JSON.stringify(res)}`);
  console.log(`  랜덤 뽑기 차감 OK (${before} → ${res.coins})`);
} else {
  if (res.ok) fail(`잔액 부족(${before})인데 결제됨`);
  console.log(`  랜덤 뽑기 잔액 부족 거부 OK (잔액 ${before})`);
}
res = await emitAck(b, 'buy-random', 'rand-nope');
if (res.ok) fail('없는 랜덤 상품이 결제됨');
console.log('  랜덤 뽑기 유효성 OK');

// 9) 구버전 인자 (fishId, ack) 2인자도 여전히 동작
await new Promise((r) => setTimeout(r, 8200));
res = await emitAck(b, 'fish', 'carp');
if (!res.ok || res.trophy === true) fail(`구버전 인자 호환 실패: ${JSON.stringify(res)}`);
console.log('  구버전 fish 인자 호환 OK');

b.disconnect();
console.log('PARTS_OK');
process.exit(0);

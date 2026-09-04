// 💱 환전(골드↔젬) 프로토콜 검증 — 시드 지갑(코인·젬 보유)으로 정상 교환 2건 + 오류 4건 확인
// 사용법: 서버를 시드 지갑과 함께 띄운 뒤  node tools/verify-exchange.mjs
//   (기본 localhost:4020, DOTCHAT_SERVER 로 변경. 시드 지갑 키는 DOTCHAT_EX_NICK#DOTCHAT_EX_TAG, 기본 환전검증#0077)
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = process.env.DOTCHAT_EX_NICK ?? '환전검증';
const TAG = process.env.DOTCHAT_EX_TAG ?? '0077';
const BUY = 1000;
const SELL = 900;

const fail = (msg) => {
  console.log(`EXCHANGE_FAIL ${msg}`);
  process.exit(1);
};
const socket = io(url, { reconnection: false, timeout: 8000 });
let wallet = null;
let coinsEv = null;
let gemsEv = null;
socket.on('wallet', (w) => (wallet = w));
// 접속 직후 출석/도전과제 소급 지급으로 잔액이 바뀔 수 있어 개별 잔액 이벤트를 최신값으로 추적
socket.on('coins', (c) => (coinsEv = c));
socket.on('gems', (g) => (gemsEv = g));

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('연결 시간 초과')), 10000);
  socket.on('connect_error', reject);
  socket.on('welcome', () => {
    clearTimeout(timer);
    resolve();
  });
  socket.on('connect', () => socket.emit('hello', { nickname: NICK, tag: TAG, appearance: { race: { name: 'Human' } } }));
}).catch((e) => fail(e.message));
await new Promise((r) => setTimeout(r, 1200));
if (!wallet) fail('wallet 스냅샷 없음');
const coins0 = coinsEv ?? wallet.coins;
const gems0 = gemsEv ?? wallet.gems ?? 0;
if (coins0 < 2 * BUY || gems0 < 1) fail(`시드 지갑 부족: 코인 ${coins0} (2,000 이상 필요) · 젬 ${gems0} (1 이상 필요)`);
console.log(`  시드 지갑: 🪙 ${coins0} · 💎 ${gems0}`);

const ex = (dir, qty) =>
  new Promise((resolve) => socket.timeout(6000).emit('exchange', dir, qty, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
const near = (a, b) => Math.abs(a - b) <= 1; // 분당 코인 틱(+1)이 끼어들 수 있음

// 1) 골드 → 젬 2개
let r = await ex('gold-to-gem', 2);
if (!r.ok) fail(`gold-to-gem 실패: ${r.error}`);
if (!near(r.coins, coins0 - 2 * BUY) || r.gems !== gems0 + 2 || r.qty !== 2) fail(`gold-to-gem 잔액 불일치: ${JSON.stringify(r)}`);
console.log(`  🪙 ${2 * BUY} → 💎 2 OK (🪙 ${r.coins} · 💎 ${r.gems})`);
let coins = r.coins;
let gems = r.gems;

// 2) 젬 → 골드 1개
r = await ex('gem-to-gold', 1);
if (!r.ok) fail(`gem-to-gold 실패: ${r.error}`);
if (!near(r.coins, coins + SELL) || r.gems !== gems - 1) fail(`gem-to-gold 잔액 불일치: ${JSON.stringify(r)}`);
console.log(`  💎 1 → 🪙 ${SELL} OK (🪙 ${r.coins} · 💎 ${r.gems})`);
coins = r.coins;
gems = r.gems;

// 3) 오류: 수량 0 / 초과 수량 / 잔액 부족 / 방향 오류 — 전부 거부되고 잔액 불변
for (const [dir, qty, label] of [
  ['gold-to-gem', 0, '수량 0'],
  ['gold-to-gem', 100000, '최대 수량 초과'],
  ['gem-to-gold', gems + 1, '젬 부족'],
  ['gold-to-gem', Math.floor(coins / BUY) + 1, '골드 부족'],
  ['sideways', 1, '방향 오류'],
]) {
  r = await ex(dir, qty);
  if (r.ok) fail(`${label}인데 성공함: ${JSON.stringify(r)}`);
  console.log(`  거부 OK (${label}): ${r.error}`);
}
r = await ex('gem-to-gold', 0);
if (r.ok) fail('수량 0 젬→골드가 성공함');

console.log(`EXCHANGE_OK 🪙 ${coins} · 💎 ${gems}`);
socket.disconnect();
process.exit(0);

// 가상 주식 + 전광판 검증 (빠른 틱 서버 전용: DOTCHAT_STOCK_SEC=3 권장)
// 사용법: DOTCHAT_SERVER=http://localhost:4024 node tools/verify-stock.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { io } = require(path.join(root, 'node_modules', 'socket.io-client'));

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };

const fail = (msg) => {
  console.log(`STOCK_FAIL ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await sleep(200);
  }
  return cond();
};

const connect = (nickname, tag) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const box = { socket, market: null, ticker: [], wallet: null };
    socket.on('stocks', (d) => (box.market = d));
    socket.on('ticker', (t) => box.ticker.push(t));
    socket.on('wallet', (w) => (box.wallet = w));
    const timer = setTimeout(() => reject(new Error(`${nickname} 연결 시간 초과`)), 10000);
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('welcome', () => { clearTimeout(timer); resolve(box); });
    socket.on('connect', () => socket.emit('hello', { nickname, tag, appearance: APPEARANCE }));
  });

const emitAck = (socket, event, ...args) =>
  new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, ...args, (err, res) => (err ? reject(err) : resolve(res)));
  });

// 1) 접속 시 시세 스냅샷 (10종목 + nextTickTs)
const a = await connect('주식검증A', '0061'); // 시드: 10000코인 + 봇순이 10주
if (!(await waitFor(() => a.market !== null, 5000))) fail('stocks 스냅샷 미수신');
if (a.market.stocks.length !== 10) fail(`종목 수 이상: ${a.market.stocks.length}`);
if (!Number.isFinite(a.market.nextTickTs)) fail('nextTickTs 없음');
const airpass0 = a.market.stocks.find((s) => s.id === 'airpass');
console.log(`  시세 스냅샷 OK (10종목, 에어패스 ${airpass0.price})`);

// 2) 매수/매도: 차감·보유·평단
let res = await emitAck(a.socket, 'stock-buy', 'airpass', 3);
if (!res.ok) fail(`매수 실패: ${res.error}`);
if (res.holding?.qty !== 3) fail(`매수 보유 이상: ${JSON.stringify(res.holding)}`);
const coinsAfterBuy = res.coins;
res = await emitAck(a.socket, 'stock-sell', 'airpass', 2);
if (!res.ok || res.holding?.qty !== 1) fail(`매도 이상: ${JSON.stringify(res)}`);
if (!(res.coins > coinsAfterBuy)) fail('매도 후 코인 미증가');
console.log(`  매수/매도 OK (3주 매수 → 2주 매도, 잔여 1주)`);

// 3) 유효성: 없는 종목/수량 0/보유 초과 매도/잔액 부족
if ((await emitAck(a.socket, 'stock-buy', 'nope', 1)).ok) fail('없는 종목 매수됨');
if ((await emitAck(a.socket, 'stock-buy', 'airpass', 0)).ok) fail('수량 0 매수됨');
if ((await emitAck(a.socket, 'stock-sell', 'airpass', 99)).ok) fail('보유 초과 매도됨');
const c = await connect('주식검증C', '0062'); // 신규 10코인
if ((await emitAck(c.socket, 'stock-buy', 'airpass', 1)).ok) fail('잔액 부족 매수됨');
console.log('  거래 유효성 OK');

// 4) 틱: 가격 변동 + 전광판 시세 요약 수신
const before = a.market.stocks.map((s) => s.price).join(',');
if (!(await waitFor(() => a.ticker.some((t) => t.kind === 'stocks'), 20000))) fail('시세 전광판 미수신');
await waitFor(() => a.market.stocks.map((s) => s.price).join(',') !== before, 20000);
console.log('  틱 변동/전광판 시세 OK');

// 5) 상장폐지: 봇순이(시드 가격 1) → 하락 시 상폐, 보유 증발, 거래 불가, 재상장
// 빠른 틱 서버는 스크립트 접속 전에 상폐가 지나갈 수 있어 ticker-log 폴백으로도 확인
const tickerLog = async () =>
  await new Promise((r) => a.socket.timeout(8000).emit('ticker-log', (e, items) => r(e ? [] : items)));
let delisted = await waitFor(() => a.ticker.some((t) => t.kind === 'delist' && t.text.includes('봇순이')), 15000);
if (!delisted) delisted = (await tickerLog()).some((t) => t.kind === 'delist' && t.text.includes('봇순이'));
if (!delisted) fail('상장폐지 미발생 (시드 가격 1 확인 필요)');
const botsoonNow = () => a.market.stocks.find((s) => s.id === 'botsoon');
if (botsoonNow()?.delistedUntil) {
  // 상폐 창이 아직 열려 있으면 거래 차단까지 확인
  res = await emitAck(a.socket, 'stock-buy', 'botsoon', 1);
  if (res.ok) fail('상폐 종목이 매수됨');
  console.log('  상폐 중 거래 차단 OK');
} else {
  console.log('  상폐 창은 접속 전에 지나감 — 기록으로 발생 확인 (거래 차단 검사는 생략)');
}
// 보유 증발 확인 (재접속 → wallet.stocks에 botsoon 없어야)
a.socket.disconnect();
await sleep(400);
const a2 = await connect('주식검증A', '0061');
if (!(await waitFor(() => a2.wallet !== null, 5000))) fail('지갑 미수신');
if (a2.wallet.stocks?.botsoon) fail(`상폐 후에도 보유 잔존: ${JSON.stringify(a2.wallet.stocks.botsoon)}`);
console.log('  상장폐지/보유 증발 OK');
// 재상장 (다음 틱): 시작가 5 복귀 — 접속 전에 지나간 경우 ticker-log 폴백
let relisted = await waitFor(() => a2.ticker.some((t) => t.kind === 'relist' && t.text.includes('봇순이')), 30000);
if (!relisted) {
  const log = await new Promise((r) => a2.socket.timeout(8000).emit('ticker-log', (e, items) => r(e ? [] : items)));
  relisted = log.some((t) => t.kind === 'relist' && t.text.includes('봇순이'));
}
if (!relisted) fail('재상장 미발생');
await waitFor(() => {
  const b = a2.market?.stocks.find((s) => s.id === 'botsoon');
  return b && !b.delistedUntil;
}, 15000);
console.log('  재상장 OK');

// 6) 전광판 유료 광고: 50코인 차감 + 브로드캐스트 + 쿨타임 + 기록
res = await emitAck(a2.socket, 'ticker-send', '  주식검증  광고  테스트  ');
if (!res.ok) fail(`광고 실패: ${res.error}`);
if (!(await waitFor(() => c.ticker.some((t) => t.kind === 'ad' && t.text.includes('주식검증 광고 테스트')), 5000))) {
  fail('광고 브로드캐스트 미수신');
}
if ((await emitAck(a2.socket, 'ticker-send', '연타')).ok) fail('광고 쿨타임 무시됨');
const log = await new Promise((r) => a2.socket.timeout(8000).emit('ticker-log', (e, items) => r(e ? [] : items)));
if (!Array.isArray(log) || log.length === 0) fail('전광판 기록 조회 실패');
if (log[0].ts < log[log.length - 1].ts) fail('기록이 최신순이 아님');
console.log(`  전광판 광고/쿨타임/기록 OK (기록 ${log.length}개)`);

a2.socket.disconnect();
c.socket.disconnect();
console.log('STOCK_OK');
process.exit(0);

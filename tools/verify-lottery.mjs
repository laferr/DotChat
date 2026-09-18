// 🎟️ 즉석복권 검증
// ① 테이블 동기화 — shared LOTTO_PRICE ↔ composer.ts 복사본, 등수 표(당첨금·확률 분모)
// ② 판정 시뮬레이션 — rollLotto 환급률(≈60%)·등수 빈도 범위
// ③ 프로토콜 — 잔액 부족(신규 지갑), 상태 조회(미공개 없음), 구매(판돈 차감·판정 보관·잭팟 적립), 상태 조회(미공개 티켓 유지),
//    잘못된 id claim 거부, claim(당첨금 지급·티켓 제거), 미공개 상태에서 재구매 시 이전 티켓 자동 정산, 연타 제한,
//    강제 등수(DOTCHAT_SLOT_RIG=1 서버)로 1등 당첨 → lottery-news/전광판/업적(c-lotto-big) 통지, 꽝 강제
// 사용법: 시드 지갑(코인 1억, 기본 슬롯검증#0077)으로 DOTCHAT_SLOT_RIG=1 서버를 띄운 뒤  node tools/verify-lottery.mjs
//        (기본 localhost:4020, DOTCHAT_SERVER / DOTCHAT_SLOT_NICK / DOTCHAT_SLOT_TAG 로 변경)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  LOTTO_PRICE,
  LOTTO_POOL,
  LOTTO_TIERS,
  LOTTO_NEWS_RANK,
  LOTTO_MIN_INTERVAL_MS,
  SLOT_JACKPOT_FEED_PCT,
  rollLotto,
} from '../packages/shared/dist/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = process.env.DOTCHAT_SLOT_NICK ?? '슬롯검증';
const TAG = process.env.DOTCHAT_SLOT_TAG ?? '0077';
const APPEARANCE = { race: { name: 'Human' } };

const fail = (msg) => {
  console.log(`LOTTO_FAIL ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`  ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b, label) => {
  if (a !== b) fail(`${label}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
};

// ---- ① 테이블 동기화 ----
{
  const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/composer.ts'), 'utf8');
  const m = src.match(/const LOTTO_PRICE = (\d+);/);
  if (!m) fail('composer.ts에 LOTTO_PRICE 없음');
  eq(Number(m[1]), LOTTO_PRICE, 'LOTTO_PRICE 복사본');
  const expected = [
    [1, 1_000_000_000, 5_000_000],
    [2, 100_000_000, 1_666_666.7],
    [3, 10_000_000, 200_000],
    [4, 20_000, 363.6],
    [5, 4_000, 14.3],
    [6, 2_000, 3.6],
  ];
  for (const [rank, prize, denom] of expected) {
    const t = LOTTO_TIERS.find((x) => x.rank === rank);
    if (!t || t.prize !== prize) fail(`${rank}등 당첨금 불일치: ${JSON.stringify(t)}`);
    const d = LOTTO_POOL / t.weight;
    if (Math.abs(d - denom) / denom > 0.01) fail(`${rank}등 확률 분모 불일치: 1/${d.toFixed(1)} (기대 1/${denom})`);
  }
  const totalWeight = LOTTO_TIERS.reduce((s, t) => s + t.weight, 0);
  if (totalWeight >= LOTTO_POOL) fail('당첨 가중치 합이 분모 이상 (꽝이 없음)');
  ok(`테이블 OK: 가격 ${LOTTO_PRICE.toLocaleString()} · 6등급 · 꽝 ${(((LOTTO_POOL - totalWeight) / LOTTO_POOL) * 100).toFixed(1)}%`);
}

// ---- ② 판정 시뮬레이션 ----
{
  const N = 2_000_000;
  const counts = new Array(7).fill(0);
  let pay = 0;
  for (let i = 0; i < N; i++) {
    const r = rollLotto();
    counts[r.rank]++;
    pay += r.prize;
  }
  const rtp = pay / (N * LOTTO_PRICE);
  const exp = LOTTO_TIERS.reduce((s, t) => s + (t.prize * t.weight) / LOTTO_POOL, 0) / LOTTO_PRICE;
  ok(`시뮬 ${N.toLocaleString()}장: 환급 ${(rtp * 100).toFixed(1)}% (이론 ${(exp * 100).toFixed(1)}%) · 6등 ${((100 * counts[6]) / N).toFixed(1)}% · 5등 ${((100 * counts[5]) / N).toFixed(2)}% · 4등 ${((100 * counts[4]) / N).toFixed(3)}%`);
  if (exp < 0.55 || exp > 0.65) fail(`이론 환급률 범위 밖 ${exp}`);
  const r6 = counts[6] / N;
  const r5 = counts[5] / N;
  const r4 = counts[4] / N;
  if (Math.abs(r6 - 0.28) > 0.01 || Math.abs(r5 - 0.07) > 0.005 || Math.abs(r4 - 0.00275) > 0.0005) fail('등수 빈도 범위 밖');
}

// ---- ③ 프로토콜 ----
const connect = (nickname, tag, setup = () => {}) =>
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
    setup(socket);
    socket.on('connect', () => socket.emit('hello', { nickname, tag, appearance: APPEARANCE }));
  });

const state = { coins: null, pool: null, ach: [], news: [], tickers: [] };
const main = await connect(NICK, TAG, (s) => {
  s.on('wallet', (w) => (state.coins = w.coins));
  s.on('coins', (c) => (state.coins = c));
  s.on('slot-pool', (p) => (state.pool = p));
  s.on('achievement', (list) => state.ach.push(...list.map((a) => a.id)));
}).catch((e) => fail(e.message));
const observer = await connect('복권관전', '0080', (s) => {
  s.on('lottery-news', (d) => state.news.push(d));
  s.on('ticker', (t) => state.tickers.push(t));
}).catch((e) => fail(e.message));
await sleep(600);
if (typeof state.coins !== 'number' || state.coins < 1_000_000) fail(`시드 부족: 🪙 ${state.coins} (100만 이상 필요)`);
const achOwned = await new Promise((resolve) => main.timeout(5000).emit('ach-state', (err, st) => resolve(err ? [] : st?.ach ?? [])));
ok(`접속 OK: 🪙 ${state.coins.toLocaleString()} · 잭팟 ${state.pool?.toLocaleString()}`);

const call = (sock, ev, ...args) =>
  new Promise((resolve) => sock.timeout(8000).emit(ev, ...args, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
const gap = () => sleep(LOTTO_MIN_INTERVAL_MS + 150);
const tierOf = (rank) => LOTTO_TIERS.find((t) => t.rank === rank);

// 잔액 부족 — 신규 지갑(시작 코인 + 출석 보상 < 2,000)
{
  const poor = await connect('복권빈털', '0081').catch((e) => fail(e.message));
  await sleep(300);
  const r = await call(poor, 'lottery-buy', {});
  if (r.ok || !/코인이 부족/.test(r.error)) fail(`잔액 부족 검증 실패: ${JSON.stringify(r)}`);
  poor.close();
  ok(`잔액 부족 OK: "${r.error}"`);
}

// 미공개 티켓 정리 (이전 실행 잔여) — 있으면 정산
{
  const st = await call(main, 'lottery-state');
  if (st.ticket) {
    await call(main, 'lottery-claim', st.ticket.id);
    await sleep(200);
  }
  const st2 = await call(main, 'lottery-state');
  eq(st2.ticket, null, '초기 미공개 티켓');
  state.coins = st2.coins;
}

// 구매 → 판정 보관 · 판돈 차감 · 잭팟 적립
let ticket;
{
  const coinsBefore = state.coins;
  const poolBefore = state.pool;
  const r = await call(main, 'lottery-buy', {});
  if (!r.ok || !r.ticket) fail(`구매 실패: ${JSON.stringify(r)}`);
  ticket = r.ticket;
  if (typeof ticket.id !== 'string' || ticket.id.length < 8) fail(`티켓 id 형식 오류: ${ticket.id}`);
  if (!Number.isInteger(ticket.rank) || ticket.rank < 0 || ticket.rank > 6) fail(`등수 범위 오류: ${ticket.rank}`);
  eq(ticket.prize, ticket.rank === 0 ? 0 : tierOf(ticket.rank).prize, '등수-당첨금 일치');
  eq(r.coins, coinsBefore - LOTTO_PRICE, '판돈 차감');
  state.coins = r.coins;
  await sleep(800);
  const feed = Math.floor((LOTTO_PRICE * SLOT_JACKPOT_FEED_PCT) / 100);
  if (state.pool - poolBefore < feed - 1 || state.pool - poolBefore > feed + 1) fail(`잭팟 적립 오류: ${poolBefore} → ${state.pool} (기대 +${feed})`);
  const st = await call(main, 'lottery-state');
  eq(st.ticket?.id, ticket.id, '미공개 티켓 유지');
  ok(`구매 OK: ${ticket.rank > 0 ? `${ticket.rank}등 ${ticket.prize.toLocaleString()}` : '꽝'} (미공개) · -${LOTTO_PRICE} · 잭팟 +${feed.toLocaleString()}`);
}

// 잘못된 id → 거부, 올바른 id → 지급·제거
{
  const bad = await call(main, 'lottery-claim', 'nope');
  if (bad.ok || !/복권이 없어요/.test(bad.error)) fail(`잘못된 id claim 거부 실패: ${JSON.stringify(bad)}`);
  const coinsBefore = state.coins;
  const r = await call(main, 'lottery-claim', ticket.id);
  if (!r.ok) fail(`claim 실패: ${r.error}`);
  eq(r.rank, ticket.rank, 'claim 등수');
  eq(r.prize, ticket.prize, 'claim 당첨금');
  const drift = r.coins - (coinsBefore + ticket.prize);
  if (drift < 0 || drift > 2) fail(`claim 잔액 정산: ${r.coins} ≠ ${coinsBefore + ticket.prize}`);
  state.coins = r.coins;
  const st = await call(main, 'lottery-state');
  eq(st.ticket, null, 'claim 후 티켓 제거');
  const again = await call(main, 'lottery-claim', ticket.id);
  if (again.ok) fail('같은 티켓 중복 claim 허용됨');
  ok('claim OK (잘못된 id 거부 · 지급 · 제거 · 중복 거부)');
}

// 연타 제한 + 미공개 상태에서 재구매 → 이전 티켓 자동 정산
{
  await gap();
  const [a, b] = await Promise.all([call(main, 'lottery-buy', {}), call(main, 'lottery-buy', {})]);
  if (!a.ok || b.ok || !/빨라요/.test(b.error)) fail(`연타 제한 실패: ${JSON.stringify([a.ok, b])}`);
  state.coins = a.coins;
  await gap();
  const first = a.ticket;
  const r = await call(main, 'lottery-buy', {});
  if (!r.ok) fail(`재구매 실패: ${r.error}`);
  const drift = r.coins - (state.coins + first.prize - LOTTO_PRICE);
  if (drift < 0 || drift > 2) fail(`재구매 시 이전 티켓 자동 정산 오류: ${r.coins} ≠ ${state.coins + first.prize - LOTTO_PRICE}`);
  state.coins = r.coins;
  await call(main, 'lottery-claim', r.ticket.id);
  await sleep(200);
  const st = await call(main, 'lottery-state');
  state.coins = st.coins;
  ok('연타 제한 OK · 미공개 상태 재구매 시 이전 티켓 자동 정산 OK');
}

// 강제 등수 (DOTCHAT_SLOT_RIG=1) — 1등 → 통지/전광판/업적, 0 → 꽝
{
  await gap();
  const r = await call(main, 'lottery-buy', { rig: 1 });
  if (!r.ok) fail(`강제 1등 구매 실패: ${r.error}`);
  if (r.ticket.rank !== 1) fail('강제 등수 미적용 — 서버를 DOTCHAT_SLOT_RIG=1 로 띄워 주세요');
  eq(r.ticket.prize, 1_000_000_000, '1등 당첨금');
  const coinsBefore = r.coins;
  const newsBefore = state.news.length;
  const c = await call(main, 'lottery-claim', r.ticket.id);
  if (!c.ok) fail(`1등 claim 실패: ${c.error}`);
  const drift = c.coins - (coinsBefore + 1_000_000_000);
  if (drift < 0 || drift > 2) fail(`1등 지급 오류: ${c.coins}`);
  state.coins = c.coins;
  await sleep(800);
  const news = state.news.slice(newsBefore).find((d) => d.rank === 1);
  if (!news || news.prize !== 1_000_000_000 || news.nickname !== NICK) fail(`lottery-news 누락: ${JSON.stringify(state.news.slice(newsBefore))}`);
  if (!state.tickers.some((t) => t.kind === 'news' && /즉석복권 1등/.test(t.text))) fail('1등 전광판 뉴스 없음');
  if (!achOwned.includes('c-lotto-big') && !state.ach.includes('c-lotto-big')) fail(`c-lotto-big 업적 미지급 (받은 업적: ${state.ach.join(', ') || '없음'})`);
  if (LOTTO_NEWS_RANK < 3) fail('LOTTO_NEWS_RANK는 3 이상이어야 4등 이하 스팸이 없음');
  await gap();
  const miss = await call(main, 'lottery-buy', { rig: 0 });
  if (!miss.ok || miss.ticket.rank !== 0 || miss.ticket.prize !== 0) fail(`강제 꽝 실패: ${JSON.stringify(miss)}`);
  const mc = await call(main, 'lottery-claim', miss.ticket.id);
  if (!mc.ok || mc.prize !== 0) fail(`꽝 claim 오류: ${JSON.stringify(mc)}`);
  state.coins = mc.coins;
  ok('강제 등수 OK: 1등 10억 지급 · lottery-news/전광판/업적(c-lotto-big) 통지 · 꽝 정산');
}

console.log(`LOTTO_OK 🪙 ${state.coins.toLocaleString()} · 잭팟 ${state.pool?.toLocaleString()}`);
main.close();
observer.close();
process.exit(0);

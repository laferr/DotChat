// 🎰 슬롯머신(5×3, 20 페이라인, 누적 잭팟) 검증
// ① 테이블 동기화 — shared(SLOT_BET_TIERS/SLOT_LINES_MAX/SLOT_PAYLINES) ↔ composer.ts 렌더러 복사본
// ② 규칙 시뮬레이션 — 환급률·적중률·🎁 스캐터 빈도·7️⃣×5 잭팟 확률이 설계 범위 안인지
// ③ 프로토콜 — 구버전(ack 1인자) 호출 안내, 입력 검증, 연타 제한, 잔액 부족, 무작위 스핀의 정산 일치(evalSlotLines 재계산),
//    잭팟 적립(판돈의 SLOT_JACKPOT_FEED_PCT %), 강제 그리드(DOTCHAT_SLOT_RIG=1 서버)로 와일드·7️⃣ 비대체·5개 일치(c-jackpot)·
//    💎 라인 환산·🎁 파츠/💎 환산·누적 잭팟 전액/비례 지급(c-mega)·기본 적립금 복귀·slot-pool/slot-win/ticker 통지
// 사용법: 시드 지갑(코인 1억, 기본 슬롯검증#0077)으로 DOTCHAT_SLOT_RIG=1 서버를 띄운 뒤  node tools/verify-slot.mjs
//        (기본 localhost:4020, DOTCHAT_SERVER / DOTCHAT_SLOT_NICK / DOTCHAT_SLOT_TAG 로 변경)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  SLOT_BET_TIERS,
  SLOT_LINES_MAX,
  SLOT_PAYLINES,
  SLOT_SYMBOLS,
  SLOT_PAYTABLE,
  SLOT_REEL_WEIGHTS,
  SLOT_SEVEN,
  SLOT_GEM,
  SLOT_WILD,
  SLOT_SCATTER,
  SLOT_SCATTER_PARTS,
  SLOT_SCATTER_PAY,
  SLOT_JACKPOT_BASE,
  SLOT_JACKPOT_FEED_PCT,
  SLOT_JACKPOT_PET_PULL_GOLD,
  SLOT_JACKPOT_BATTLE_GEM_GOLD,
  SLOT_JACKPOT_FULL_BET,
  SLOT_BIG_WIN_MULT,
  SLOT_MIN_INTERVAL_MS,
  evalSlotLines,
  rollSlotGrid,
  splitGemValue,
} from '../packages/shared/dist/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = process.env.DOTCHAT_SLOT_NICK ?? '슬롯검증';
const TAG = process.env.DOTCHAT_SLOT_TAG ?? '0077';
const APPEARANCE = { race: { name: 'Human' } };

const fail = (msg) => {
  console.log(`SLOT_FAIL ${msg}`);
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
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name}(?::[^=]+)? = ([^;]+);`));
    if (!m) fail(`composer.ts에 ${name} 없음`);
    return JSON.parse(m[1].replace(/\s+/g, '').replace(/,\]/g, ']'));
  };
  eq(JSON.stringify(grab('SLOT_BET_TIERS')), JSON.stringify(SLOT_BET_TIERS), 'SLOT_BET_TIERS 복사본');
  eq(grab('SLOT_LINES_MAX'), SLOT_LINES_MAX, 'SLOT_LINES_MAX 복사본');
  eq(JSON.stringify(grab('SLOT_PAYLINES')), JSON.stringify(SLOT_PAYLINES), 'SLOT_PAYLINES 복사본');
  if (SLOT_PAYLINES.length !== SLOT_LINES_MAX) fail('페이라인 수 ≠ SLOT_LINES_MAX');
  for (const p of SLOT_PAYLINES) if (p.length !== 5 || p.some((r) => r < 0 || r > 2)) fail(`페이라인 형식 오류 ${p}`);
  if (new Set(SLOT_PAYLINES.map((p) => p.join(''))).size !== SLOT_PAYLINES.length) fail('페이라인 중복');
  ok(`테이블 동기화 OK (베팅 ${SLOT_BET_TIERS.length}단계 · 라인 ${SLOT_LINES_MAX})`);
}

// ---- ② 규칙 시뮬레이션 ----
{
  const N = 300_000;
  let pay = 0;
  let hits = 0;
  let scatter3 = 0;
  for (let i = 0; i < N; i++) {
    const g = rollSlotGrid();
    const { wins, scatter } = evalSlotLines(g, SLOT_LINES_MAX, 1);
    for (const w of wins) pay += w.pay;
    if (wins.length > 0 || scatter >= 3) hits++;
    if (scatter >= 3) scatter3++;
  }
  const rtp = pay / (N * SLOT_LINES_MAX);
  const hit = hits / N;
  const sc = scatter3 / N;
  const totals = [0, 1, 2, 3, 4].map((r) => SLOT_SYMBOLS.reduce((s, sym) => s + SLOT_REEL_WEIGHTS[sym][r], 0));
  let pLine = 1;
  for (let r = 0; r < 5; r++) pLine *= SLOT_REEL_WEIGHTS[SLOT_SEVEN][r] / totals[r];
  ok(
    `시뮬 ${N.toLocaleString()}스핀: 라인 환급 ${(rtp * 100).toFixed(1)}% · 적중 ${(hit * 100).toFixed(1)}% · 🎁3+ ${(sc * 100).toFixed(2)}% · 7️⃣×5 라인당 1/${Math.round(1 / pLine).toLocaleString()} (20라인 1/${Math.round(1 / (pLine * 20)).toLocaleString()})`,
  );
  if (rtp < 0.7 || rtp > 0.95) fail(`라인 환급률 범위 밖 ${rtp}`);
  if (hit < 0.35 || hit > 0.6) fail(`적중률 범위 밖 ${hit}`);
  if (sc < 0.02 || sc > 0.06) fail(`스캐터 빈도 범위 밖 ${sc}`);
  if (pLine > 1 / 400_000 || pLine < 1 / 2_000_000) fail(`잭팟 확률 범위 밖 ${pLine}`);
  if (SLOT_REEL_WEIGHTS[SLOT_WILD][0] !== 0 || SLOT_REEL_WEIGHTS[SLOT_WILD][4] !== 0) fail('와일드는 2~4릴에만');
  if (SLOT_PAYTABLE[SLOT_SEVEN][2] !== 0) fail('7️⃣×5는 배당 0 (잭팟)');
}

// ---- ③ 프로토콜 ----
// setup(socket)으로 hello 전에 리스너를 걸어야 접속 직후 일괄 전송(welcome→wallet→stocks→slot-pool)을 놓치지 않는다
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

// achGems: 스핀 중 달성한 업적 보상 💎 누적 (업적 이벤트는 ack보다 먼저 도착) — 💎 잔액 대조에 반영
const state = { coins: null, gems: 0, pool: null, ach: [], achGems: 0, gemsEvents: 0, poolEvents: [], slotWins: [], tickers: [] };
const main = await connect(NICK, TAG, (s) => {
  s.on('wallet', (w) => {
    state.coins = w.coins;
    state.gems = w.gems ?? 0;
  });
  s.on('coins', (c) => (state.coins = c));
  s.on('gems', (g) => {
    state.gems = g;
    state.gemsEvents++;
  });
  s.on('slot-pool', (p) => {
    state.pool = p;
    state.poolEvents.push(p);
  });
  s.on('achievement', (list) => {
    state.ach.push(...list.map((a) => a.id));
    for (const a of list) state.achGems += a.gems ?? 0;
  });
}).catch((e) => fail(e.message));
const observer = await connect('슬롯관전', '0079', (s) => {
  s.on('slot-win', (d) => state.slotWins.push(d));
  s.on('ticker', (t) => state.tickers.push(t));
}).catch((e) => fail(e.message));
await sleep(600);
// 이미 달성한 업적은 재지급되지 않으므로(같은 시드로 재실행) 보유 목록을 미리 받아 둔다
const achOwned = await new Promise((resolve) => main.timeout(5000).emit('ach-state', (err, st) => resolve(err ? [] : st?.ach ?? [])));
const expectAch = (id, label) => {
  if (!achOwned.includes(id) && !state.ach.includes(id)) fail(`${label} 업적 미지급 (받은 업적: ${state.ach.join(', ') || '없음'})`);
};
if (typeof state.pool !== 'number' || state.pool < SLOT_JACKPOT_BASE) fail(`접속 시 slot-pool 누락/기본 미만: ${state.pool}`);
if (typeof state.coins !== 'number' || state.coins < 10_000_000) fail(`시드 부족: 🪙 ${state.coins} (1천만 이상 필요)`);
ok(`접속 OK: 🪙 ${state.coins.toLocaleString()} · 💎 ${state.gems} · 누적 잭팟 ${state.pool.toLocaleString()}`);

const spin = (opts, sock = main) =>
  new Promise((resolve) => sock.timeout(8000).emit('slot', opts, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
const gap = () => sleep(SLOT_MIN_INTERVAL_MS + 150);

// 구버전 클라(ack 1인자) → 업데이트 안내
{
  const res = await new Promise((resolve) => main.timeout(5000).emit('slot', (err, r) => resolve(err ? null : r)));
  if (!res || res.ok || !/업데이트/.test(res.error ?? '')) fail(`구버전 호출 안내 실패: ${JSON.stringify(res)}`);
  ok(`구버전 호출 안내 OK: "${res.error}"`);
}
// 입력 검증
{
  const r1 = await spin({ bet: 7, lines: 5, partsLeft: 0 });
  if (r1.ok || !/라인 베팅/.test(r1.error)) fail(`베팅 단위 검증 실패: ${JSON.stringify(r1)}`);
  const r2 = await spin({ bet: 10, lines: 0, partsLeft: 0 });
  const r3 = await spin({ bet: 10, lines: SLOT_LINES_MAX + 1, partsLeft: 0 });
  if (r2.ok || r3.ok || !/라인 수/.test(r2.error) || !/라인 수/.test(r3.error)) fail('라인 수 검증 실패');
  ok('입력 검증 OK (베팅 단위·라인 수)');
}
// 잔액 부족 (신규 지갑 = 시작 코인 + 출석 보상 < 200)
{
  const poor = await connect('슬롯빈털', '0078').catch((e) => fail(e.message));
  await sleep(300);
  const r = await spin({ bet: 10, lines: 20, partsLeft: 0 }, poor);
  if (r.ok || !/코인이 부족/.test(r.error)) fail(`잔액 부족 검증 실패: ${JSON.stringify(r)}`);
  poor.close();
  ok(`잔액 부족 OK: "${r.error}"`);
}

/** 서버 응답을 shared 규칙으로 재계산해 대조 */
function checkSettlement(res, opts, before) {
  const { bet, lines, partsLeft } = opts;
  if (!res.ok) fail(`스핀 실패: ${res.error}`);
  if (!Array.isArray(res.grid) || res.grid.length !== 5 || res.grid.some((c) => c.length !== 3 || c.some((s) => !SLOT_SYMBOLS.includes(s))))
    fail(`그리드 형식 오류: ${JSON.stringify(res.grid)}`);
  const ev = evalSlotLines(res.grid, lines, bet);
  const key = (w) => `${w.line}:${w.symbol}:${w.count}`;
  eq(res.wins.map(key).join(','), ev.wins.map(key).join(','), '당첨 라인 재계산');
  let coins = 0;
  let gems = 0;
  let jackpot = 0;
  for (const w of res.wins) {
    const isJp = w.symbol === SLOT_SEVEN && w.count === 5;
    if (isJp) {
      jackpot += w.pay;
      continue;
    }
    eq(w.pay, SLOT_PAYTABLE[w.symbol][w.count - 3] * bet, `라인 배당 ${key(w)}`);
    if (w.symbol === SLOT_GEM) {
      const s = splitGemValue(w.pay);
      gems += s.gems;
      coins += s.coins;
    } else coins += w.pay;
  }
  eq(res.jackpot, jackpot, '잭팟 합계');
  coins += jackpot;
  eq(res.scatter, res.grid.flat().filter((s) => s === SLOT_SCATTER).length, '스캐터 개수');
  let parts = 0;
  if (res.scatter >= 3) {
    const idx = Math.min(res.scatter, 5) - 3;
    if (partsLeft > 0) parts = Math.min(SLOT_SCATTER_PARTS[idx], partsLeft);
    else {
      const s = splitGemValue(bet * lines * SLOT_SCATTER_PAY[idx]);
      gems += s.gems;
      coins += s.coins;
    }
  }
  eq(res.parts, parts, '파츠 개수');
  eq(res.coinsWon, coins, '🪙 당첨 합계');
  eq(res.gemsWon, gems, '💎 당첨 합계');
  eq(res.cost, bet * lines, '판돈');
  // 접속 1분당 🪙 적립 틱이 스핀 사이에 끼어들 수 있어 0~2🪙 오차만 허용
  const coinDrift = res.coins - (before.coins - res.cost + res.coinsWon);
  if (coinDrift < 0 || coinDrift > 2) fail(`🪙 잔액 정산: ${res.coins} ≠ ${before.coins - res.cost + res.coinsWon}`);
  eq(res.gems, before.gems + res.gemsWon + (state.achGems - before.achGems), '💎 잔액 정산 (업적 보상 포함)');
  const miss = coins === 0 && gems === 0 && parts === 0;
  const kind = jackpot > 0 ? 'jackpot' : coins >= bet * lines * SLOT_BIG_WIN_MULT ? 'big' : gems > 0 ? 'gem' : parts > 0 ? 'part' : miss ? 'miss' : 'win';
  eq(res.kind, kind, '결과 종류');
  if (jackpot === 0) {
    const feed = Math.floor((res.cost * SLOT_JACKPOT_FEED_PCT) / 100);
    if (res.pool - before.pool < feed - 1 || res.pool - before.pool > feed + 1) fail(`잭팟 적립 오류: ${before.pool} → ${res.pool} (판돈 ${res.cost})`);
  }
  return { coins: res.coins, gems: res.gems, pool: res.pool, achGems: state.achGems };
}

// 연타 제한
{
  const a = spin({ bet: 1, lines: 1, partsLeft: 0 });
  const b = spin({ bet: 1, lines: 1, partsLeft: 0 });
  const [ra, rb] = await Promise.all([a, b]);
  if (!ra.ok || rb.ok || !/빨라요/.test(rb.error)) fail(`연타 제한 실패: ${JSON.stringify([ra.ok, rb])}`);
  state.coins = ra.coins;
  state.gems = ra.gems;
  state.pool = ra.pool;
  ok('연타 제한 OK');
  await gap();
}

// 무작위 스핀 정산 대조
{
  let before = { coins: state.coins, gems: state.gems, pool: state.pool, achGems: state.achGems };
  const bets = [1, 10, 100, 1000];
  const lineOpts = [1, 7, 20];
  let kinds = {};
  for (let i = 0; i < 24; i++) {
    const opts = { bet: bets[i % bets.length], lines: lineOpts[i % lineOpts.length], partsLeft: i % 2 ? 5 : 0 };
    const res = await spin(opts);
    before = checkSettlement(res, opts, before);
    kinds[res.kind] = (kinds[res.kind] ?? 0) + 1;
    await gap();
  }
  state.coins = before.coins;
  state.gems = before.gems;
  state.pool = before.pool;
  ok(`무작위 24스핀 정산 대조 OK: ${JSON.stringify(kinds)} · 잭팟 ${state.pool.toLocaleString()}`);
}

// 💎 소비 적립 — 펫 뽑기 1회(5,000🪙 환산), 원정 강화(💎당 500🪙 환산) → 잭팟에 비율만큼
{
  const call = (ev, ...args) => new Promise((resolve) => main.timeout(8000).emit(ev, ...args, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
  const feedOf = (gold) => Math.floor((gold * SLOT_JACKPOT_FEED_PCT) / 100);
  let poolBefore = state.pool;
  const pull = await call('pet-gacha', 1);
  if (!pull.ok) fail(`펫 뽑기 실패: ${pull.error}`);
  await sleep(800);
  let delta = state.pool - poolBefore;
  if (delta < feedOf(SLOT_JACKPOT_PET_PULL_GOLD) - 1 || delta > feedOf(SLOT_JACKPOT_PET_PULL_GOLD) + 1) fail(`펫 뽑기 잭팟 적립 오류: +${delta} (기대 ${feedOf(SLOT_JACKPOT_PET_PULL_GOLD)})`);
  state.gems = pull.state?.gems ?? state.gems;
  poolBefore = state.pool;
  const gemsBefore = state.gems;
  const up = await call('battle-upgrade', 'atk');
  if (!up.ok) fail(`원정 강화 실패: ${up.error}`);
  await sleep(800);
  const spent = gemsBefore - up.gemsNow;
  delta = state.pool - poolBefore;
  if (spent < 1) fail(`원정 강화 💎 차감 확인 실패 (${gemsBefore} → ${up.gemsNow})`);
  if (delta < feedOf(spent * SLOT_JACKPOT_BATTLE_GEM_GOLD) - 1 || delta > feedOf(spent * SLOT_JACKPOT_BATTLE_GEM_GOLD) + 1)
    fail(`원정 강화 잭팟 적립 오류: +${delta} (💎 ${spent} → 기대 ${feedOf(spent * SLOT_JACKPOT_BATTLE_GEM_GOLD)})`);
  state.gems = up.gemsNow;
  state.coins = up.coinsNow ?? state.coins;
  ok(`💎 소비 적립 OK: 펫 뽑기 1회 +${feedOf(SLOT_JACKPOT_PET_PULL_GOLD).toLocaleString()} · 원정 강화 💎${spent} +${feedOf(spent * SLOT_JACKPOT_BATTLE_GEM_GOLD).toLocaleString()}`);
}

// ---- 강제 그리드 (DOTCHAT_SLOT_RIG=1 서버) ----
const rows = (r0, r1, r2) => [0, 1, 2, 3, 4].map((reel) => [r0[reel], r1[reel], r2[reel]]);
const FILL0 = ['🍋', '🍇', '🔔', '⭐', '🍒'];
const FILL2 = ['🍇', '🔔', '⭐', '🍒', '🍋'];
const rigSpin = async (r0, r1, r2, opts) => {
  const rig = rows(r0, r1, r2);
  const before = { coins: state.coins, gems: state.gems, pool: state.pool, achGems: state.achGems };
  const res = await spin({ ...opts, rig });
  if (!res.ok) fail(`강제 스핀 실패: ${res.error}`);
  if (JSON.stringify(res.grid) !== JSON.stringify(rig)) fail('강제 그리드 미적용 — 서버를 DOTCHAT_SLOT_RIG=1 로 띄워 주세요');
  const after = checkSettlement(res, opts, before);
  Object.assign(state, after);
  await gap();
  return res;
};
{
  // 와일드 대체 (🍒 🃏 🃏 → 3개)
  let r = await rigSpin(FILL0, ['🍒', SLOT_WILD, SLOT_WILD, '🍋', '🍇'], FILL2, { bet: 10, lines: 1, partsLeft: 0 });
  eq(JSON.stringify(r.wins.map((w) => [w.symbol, w.count, w.pay])), JSON.stringify([['🍒', 3, 50]]), '와일드 대체');
  // 7️⃣는 와일드로 대체되지 않음
  r = await rigSpin(FILL0, [SLOT_SEVEN, SLOT_WILD, SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN], FILL2, { bet: 10, lines: 1, partsLeft: 0 });
  eq(r.wins.length, 0, '7️⃣ 와일드 비대체');
  eq(r.kind, 'miss', '7️⃣ 비대체 결과');
  // 5개 일치 → 대박 + c-jackpot
  r = await rigSpin(FILL0, ['🍒', SLOT_WILD, SLOT_WILD, '🍒', '🍒'], FILL2, { bet: 10, lines: 1, partsLeft: 0 });
  eq(r.coinsWon, 1000, '🍒×5 배당');
  eq(r.kind, 'big', '대박 판정');
  eq(r.five, true, '5개 일치 플래그');
  ok('와일드·7️⃣ 비대체·5개 일치 OK');
  // 💎 라인 → 💎 환산 (3,000× 1,000 = 300만 🪙 → 3,000 💎)
  const gemsEv = state.gemsEvents;
  r = await rigSpin(FILL0, [SLOT_GEM, SLOT_GEM, SLOT_GEM, SLOT_GEM, SLOT_GEM], FILL2, { bet: 1000, lines: 1, partsLeft: 0 });
  eq(r.gemsWon, 3000, '💎×5 환산');
  eq(r.coinsWon, 0, '💎×5 🪙 나머지');
  eq(r.kind, 'gem', '💎 결과 종류');
  if (state.gemsEvents <= gemsEv) fail('💎 당첨 시 gems 이벤트 없음');
  r = await rigSpin(FILL0, [SLOT_GEM, SLOT_GEM, SLOT_GEM, '🍒', '🍋'], FILL2, { bet: 1, lines: 1, partsLeft: 0 });
  eq(r.gemsWon, 0, '💎×3 소액은 🪙');
  eq(r.coinsWon, 50, '💎×3 🪙 환산');
  ok('💎 라인 환산 OK (1,000🪙당 💎1, 나머지 🪙)');
  // 🎁 스캐터 — 파츠 / 다 모았으면 💎 환산 / 남은 파츠보다 많으면 남은 만큼
  const S0 = [SLOT_SCATTER, '🍋', SLOT_SCATTER, '🍋', SLOT_SCATTER];
  const S1 = ['🍒', '🍇', '🔔', '⭐', '🍒'];
  const S2 = ['🍋', '🍒', '🍋', '🍒', '🍋'];
  r = await rigSpin(S0, S1, S2, { bet: 100, lines: 1, partsLeft: 5 });
  eq(r.parts, 1, '🎁×3 파츠 1개');
  eq(r.kind, 'part', '파츠 결과 종류');
  r = await rigSpin(S0, S1, S2, { bet: 100, lines: 10, partsLeft: 0 });
  eq(r.parts, 0, '파츠 없음');
  eq(r.gemsWon, 1, '🎁×3 💎 환산 (총 베팅 1,000 × 1)');
  eq(r.kind, 'gem', '💎 환산 결과 종류');
  r = await rigSpin([SLOT_SCATTER, SLOT_SCATTER, SLOT_SCATTER, SLOT_SCATTER, SLOT_SCATTER], S1, S2, { bet: 10, lines: 1, partsLeft: 2 });
  eq(r.parts, 2, '🎁×5 남은 파츠 2개만');
  ok('🎁 스캐터 OK (파츠 / 💎 환산 / 남은 파츠 한도)');
  // 누적 잭팟 — 전액 (라인 베팅 100), 기본 적립금 복귀, 통지
  const poolBefore = state.pool;
  const winsBefore = state.slotWins.length;
  r = await rigSpin(['🍒', '🍋', '🍇', '🔔', '⭐'], [SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN], ['🍋', '🍇', '🔔', '⭐', '🍒'], {
    bet: SLOT_JACKPOT_FULL_BET,
    lines: 20,
    partsLeft: 0,
  });
  eq(r.kind, 'jackpot', '잭팟 결과 종류');
  eq(r.jackpot, poolBefore, '잭팟 전액 지급');
  eq(r.pool, SLOT_JACKPOT_BASE + Math.floor((r.cost * SLOT_JACKPOT_FEED_PCT) / 100), '잭팟 후 기본 적립금 + 판돈 적립');
  await sleep(800);
  if (state.poolEvents[state.poolEvents.length - 1] !== r.pool) fail(`slot-pool 통지 불일치: ${state.poolEvents.slice(-3)} vs ${r.pool}`);
  const news = state.slotWins.slice(winsBefore).find((d) => d.kind === 'jackpot');
  if (!news || news.delta !== r.coinsWon || news.nickname !== NICK) fail(`slot-win 잭팟 통지 누락: ${JSON.stringify(state.slotWins.slice(winsBefore))}`);
  if (!state.tickers.some((t) => t.kind === 'news' && /잭팟/.test(t.text))) fail('잭팟 전광판 뉴스 없음');
  expectAch('c-mega', 'c-mega');
  expectAch('c-jackpot', 'c-jackpot');
  ok(`누적 잭팟 전액 OK: +${r.jackpot.toLocaleString()} 🪙 → 적립 ${r.pool.toLocaleString()} · slot-win/ticker/업적(c-jackpot·c-mega) 통지 OK`);
  // 비례 지급 (라인 베팅 10 → 10%)
  const poolNow = state.pool;
  r = await rigSpin(['🍒', '🍋', '🍇', '🔔', '⭐'], [SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN, SLOT_SEVEN], ['🍋', '🍇', '🔔', '⭐', '🍒'], {
    bet: 10,
    lines: 1,
    partsLeft: 0,
  });
  eq(r.jackpot, Math.floor(poolNow * (10 / SLOT_JACKPOT_FULL_BET)), '잭팟 비례 지급 (10%)');
  eq(r.pool, Math.max(SLOT_JACKPOT_BASE, poolNow - r.jackpot) + Math.floor((r.cost * SLOT_JACKPOT_FEED_PCT) / 100), '비례 지급 후 적립금');
  ok(`누적 잭팟 비례 OK: 라인 베팅 10 → +${r.jackpot.toLocaleString()} 🪙 (적립 ${r.pool.toLocaleString()})`);
}

console.log(`SLOT_OK 🪙 ${state.coins.toLocaleString()} · 💎 ${state.gems.toLocaleString()} · 잭팟 ${state.pool.toLocaleString()}`);
main.close();
observer.close();
process.exit(0);

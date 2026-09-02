// 원정(방치형 전투) 프로토콜 검증 — 상태 자동 시작, 시간 기반 정산(코인/처치/드랍), 강화(젬 차감·부족 거부),
// 층 이동 검증, 수문장 도전(승리 → 다음 층·첫 처치 보상 / 쿨타임), 도전과제·일퀘 연동, ACH_DEFS 동기화
// 사용법: DOTCHAT_BATTLE_SPEED=600 node packages/server/dist/index.js 로 서버를 띄운 뒤
//        node tools/verify-battle.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
// 서버가 배속 없이 떠 있으면 정산 단계는 시간이 걸리므로 스킵된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  ACHIEVEMENTS,
  BATTLE_UPGRADE_KEYS,
  battleUpgradeCost,
  battleClearReward,
  battleGuardianFor,
  battleStats,
  battleSimulate,
} from '../packages/shared/dist/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = '원정검증';
const TAG = String(1000 + Math.floor(Math.random() * 9000));

const fail = (msg) => {
  console.log(`BATTLE_FAIL ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0) shared ACHIEVEMENTS 원정 항목 ↔ composer.ts ACH_DEFS 동기화 (verify-ach와 같은 규칙, 원정 카테고리만)
{
  const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/composer.ts'), 'utf8');
  const m = /const ACH_DEFS[\s\S]*?\}\[\] = (\[[\s\S]*?\n\]);/.exec(src);
  if (!m) fail('composer.ts에서 ACH_DEFS를 찾을 수 없음');
  const defs = new Function(`return ${m[1]}`)();
  const mine = ACHIEVEMENTS.filter((a) => a.cat === '원정');
  if (mine.length === 0) fail('shared에 원정 도전과제가 없음');
  for (const a of mine) {
    const b = defs.find((d) => d.id === a.id);
    if (!b || JSON.stringify(b) !== JSON.stringify(a)) fail(`ACH_DEFS 불일치: ${a.id}`);
  }
  if (defs.length !== ACHIEVEMENTS.length) fail(`ACH_DEFS ${defs.length}개 ≠ shared ${ACHIEVEMENTS.length}개`);
  console.log(`  동기화 OK: 원정 도전과제 ${mine.length}개 = composer ACH_DEFS (총 ${defs.length}개)`);
}

// 0-1) 밸런스 자체 검증 — 기본 능력치로 1층 수문장은 이기고 10층 대보스는 진다
{
  const st = battleStats({ lv: { atk: 0, hp: 0, crit: 0, luck: 0, time: 0 }, rodStars: 0, mineralDex: 0, fishDex: 0, achCount: 0 });
  if (!battleSimulate(st, battleGuardianFor(1), () => 0.99).win) fail('기본 능력치로 1층 수문장을 못 이김');
  if (battleSimulate(st, battleGuardianFor(10), () => 0).win) fail('기본 능력치로 10층 대보스를 이김 (너무 쉬움)');
  console.log('  밸런스 OK: Lv0 → 1층 수문장 승리 / 10층 대보스 패배');
}

const socket = io(url, { reconnection: false, timeout: 8000 });
let coins = 0;
let gems = 0;
let selfId = null;
let daily = null;
const achieved = [];
const news = [];
socket.on('coins', (c) => (coins = c));
socket.on('gems', (g) => (gems = g));
socket.on('daily', (d) => (daily = d));
socket.on('achievement', (list) => achieved.push(...(list ?? [])));
socket.on('battle-news', (d) => news.push(d));
const battleFlags = [];
socket.on('player-battle', (d) => battleFlags.push(d));

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

const ack = (event, ...args) =>
  new Promise((r) => socket.timeout(8000).emit(event, ...args, (err, v) => r(err ? null : v)));

// 1) 상태 — 접속 시 자동 시작 (1층, 최고 0층, Lv0, 수문장 = 1층 멧돼지 대장)
let st = await ack('battle-state');
let res = null;
if (!st) fail('battle-state 응답 없음');
if (st.stage !== 1 || st.maxStage !== 0) fail(`초기 상태 stage=${st.stage} max=${st.maxStage} (기대 1/0)`);
if (BATTLE_UPGRADE_KEYS.some((k) => st.lv[k] !== 0)) fail('초기 강화 레벨이 0이 아님');
if (st.stats.atk !== 10 || st.stats.hp !== 100) fail(`기본 능력치 atk=${st.stats.atk} hp=${st.stats.hp}`);
if (!st.guardian || st.guardian.stage !== 1) fail('1층 수문장 정보 없음');
if (st.costs.atk !== battleUpgradeCost('atk', 0)) fail(`atk 비용 ${st.costs.atk} ≠ ${battleUpgradeCost('atk', 0)}`);
if (st.active !== false) fail('초기 상태가 원정 중(active)임 — 출발 전에는 쉬어야 함');
const speedy = st.killMs < 1000; // 서버 배속이면 killMs가 짧게 내려온다

// 1-1) 출발 전에는 가방이 차지 않는다 → 출발(battle-active true) → player-battle 브로드캐스트(본인 포함)
await sleep(800);
st = await ack('battle-state');
if (st.pending.kills !== 0) fail(`출발 전인데 pending.kills=${st.pending.kills}`);
res = await ack('battle-active', true);
if (!res?.ok || res.state?.active !== true) fail(`원정 출발 실패: ${JSON.stringify(res)}`);
await sleep(300);
if (!battleFlags.some((f) => f.id === selfId && f.active === true)) fail('player-battle(active) 브로드캐스트 미수신');
console.log('  출발 OK: 출발 전 pending 0 · battle-active → player-battle 브로드캐스트');
console.log(`  상태 OK: ${st.stage}층 ${st.mob.emoji}${st.mob.name} · 처치 ${st.killMs}ms · 수문장 ${st.guardian.emoji}${st.guardian.name}${speedy ? ' · 서버 배속 감지' : ''}`);

// 2) 층 이동 검증 — 열리지 않은 2층은 거부, 1층은 OK
res = await ack('battle-stage', 2);
if (res?.ok) fail('아직 안 열린 2층으로 이동됨');
res = await ack('battle-stage', 1);
if (!res?.ok) fail(`1층 이동 실패: ${res?.error}`);
console.log('  층 이동 OK: 미개방 2층 거부 / 1층 허용');

// 3) 강화 — 젬 부족 거부 (신규 지갑은 출석 업적 1💎 뿐이라 crit(2💎)은 부족)
res = await ack('battle-upgrade', 'crit');
if (res?.ok) fail('젬 부족인데 치명타 강화 성공');
res = await ack('battle-upgrade', 'nope');
if (res?.ok) fail('잘못된 능력치 키가 허용됨');
console.log(`  강화 거부 OK: 젬 ${gems}개로 치명타(2💎) 불가 · 잘못된 키 거부`);

// 4) 수문장 도전 — Lv0으로 1층 승리 → maxStage 1, 첫 처치 보상, 2층 자동 전진, 쿨타임
const coinsBefore = coins;
res = await ack('battle-challenge');
if (!res?.ok) fail(`도전 실패: ${res?.error}`);
if (!res.win) fail('1층 수문장에게 패배 (기본 능력치로 이겨야 함)');
if (!Array.isArray(res.log) || res.log.length === 0) fail('전투 로그 없음');
if (res.state.maxStage !== 1) fail(`승리 후 maxStage=${res.state.maxStage}`);
if (res.state.stage !== 2) fail(`승리 후 자동 전진 stage=${res.state.stage} (기대 2)`);
const reward1 = battleClearReward(1);
if (res.reward?.coins !== reward1.coins) fail(`첫 처치 코인 ${res.reward?.coins} ≠ ${reward1.coins}`);
await sleep(300);
const settledCoins = res.settled?.coins ?? 0; // 최전선 자동 전진 시 먼저 정산된 전리품
if (coins !== coinsBefore + reward1.coins + settledCoins) fail(`잔액 ${coins} ≠ ${coinsBefore + reward1.coins + settledCoins}`);
res = await ack('battle-challenge');
if (res?.ok) fail('도전 쿨타임 미작동 (즉시 재도전 허용)');
console.log(`  도전 OK: 1층 승리 (+${reward1.coins}🪙${settledCoins ? `, 자동 수령 +${settledCoins}🪙` : ''}, 2층 자동 전진, 쿨타임 거부)`);

// 5) 정산 — 서버 배속일 때만 (처치 ≥ 1 필요). 코인/처치/일퀘/도전과제(b-first)
if (speedy) {
  await sleep(1500);
  st = await ack('battle-state');
  if (st.pending.kills < 1) fail(`배속인데 pending.kills=${st.pending.kills}`);
  const before = coins;
  res = await ack('battle-claim');
  if (!res?.ok) fail(`수령 실패: ${res?.error}`);
  if (res.kills < 1) fail('수령 처치 수 0');
  await sleep(400);
  if (coins !== res.coinsNow) fail(`coins 이벤트 ${coins} ≠ ack ${res.coinsNow}`);
  if (res.coinsNow < before + res.coins) fail('코인 미반영');
  const state = await ack('ach-state');
  if ((state?.metrics?.battleKills ?? 0) < res.kills) fail('battleKills 카운터 미반영');
  if (!state.ach.includes('b-first')) fail('첫 수령 후 b-first 미달성');
  const q = daily?.quests?.find((x) => x.id === 'battle');
  if (q && !q.claimed) fail('오늘 원정 일퀘가 활성인데 완료 처리 안 됨');
  console.log(
    `  정산 OK: ${res.kills}마리 → +${res.coins}🪙${res.gems ? ` +${res.gems}💎` : ''}${res.minerals?.length ? ` 광물 ${res.minerals.reduce((s, m) => s + m.count, 0)}개` : ''} · b-first 달성${q ? ' · 일퀘 완료' : ''}`,
  );
  // 5-1) 즉시 재수령은 처치 0 → 거부
  res = await ack('battle-claim');
  if (res?.ok && res.kills > 0 && st.killMs > 200) fail('직후 재수령에 처치가 생김');
  // 5-2) 강화 — 젬이 생겼으면 atk 1레벨 (자동 수령 포함) → battleLv metric
  if (gems >= battleUpgradeCost('atk', 0)) {
    const g0 = gems;
    res = await ack('battle-upgrade', 'atk');
    if (!res?.ok) fail(`atk 강화 실패: ${res?.error}`);
    if (res.state.lv.atk !== 1) fail(`강화 후 atk Lv=${res.state.lv.atk}`);
    if (res.gemsNow !== g0 - battleUpgradeCost('atk', 0)) fail(`젬 차감 오류 ${res.gemsNow} (전 ${g0})`);
    if (res.state.stats.atk <= 10) fail('공격력이 오르지 않음');
    const m = (await ack('ach-state')).metrics;
    if ((m.battleLv ?? 0) !== 1) fail(`battleLv metric=${m.battleLv}`);
    console.log(`  강화 OK: 공격력 Lv1 (-${battleUpgradeCost('atk', 0)}💎, atk ${res.state.stats.atk})`);
  } else {
    console.log('  강화 스킵: 젬 부족');
  }
} else {
  console.log('  정산 스킵: 서버 배속(DOTCHAT_BATTLE_SPEED) 없음 — 처치가 쌓이려면 실시간 4초 이상 필요');
  await sleep(4500);
  res = await ack('battle-claim');
  if (!res?.ok) fail(`실시간 수령 실패: ${res?.error}`);
  console.log(`  실시간 수령 OK: ${res.kills}마리 +${res.coins}🪙`);
}

// 6) 귀환 — 쌓인 전리품 자동 수령 + active false + 이후 수령은 거부
await sleep(speedy ? 600 : 0);
res = await ack('battle-active', false);
if (!res?.ok || res.state?.active !== false) fail(`귀환 실패: ${JSON.stringify(res)}`);
if (!battleFlags.some((f) => f.id === selfId && f.active === false)) fail('player-battle(inactive) 브로드캐스트 미수신');
const afterReturn = await ack('battle-claim');
if (afterReturn?.ok) fail('귀환 후인데 수령이 됨 (가방이 차면 안 됨)');
console.log(`  귀환 OK: 자동 수령 ${res.kills ?? 0}마리 · 이후 수령 거부`);

// 7) 랭킹 TOP에 내가 있음 (maxStage 1)
st = await ack('battle-state');
if (!st.top.some((r) => r.name === `${NICK}#${TAG}`)) fail('원정 랭킹에 내 항목 없음');
console.log(`  랭킹 OK: TOP ${st.top.length}명 중 포함 (최고 ${st.maxStage}층)`);

socket.close();
console.log('BATTLE_OK');
process.exit(0);

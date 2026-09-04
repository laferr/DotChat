// 🐾 펫/펫 가챠 검증 — ① 테이블 동기화(shared PET_DEFS/PET_FX ↔ composer.ts 복사본 ↔ docs/pet-defs.json ↔ 에셋 매니페스트)
// ② 프로토콜: 상태 조회, 용품 구매, 10연(4성 이상 보장·비용·금요일 할인 1회), 5성 천장(90회 안에), 돌파/환급, 장착(슬롯), 먹이/레벨/자동먹이,
//    포만도 감소(DOTCHAT_PET_SPEED 배속 서버), 지갑 스냅샷 petFx
// 사용법: 시드 지갑(코인 10만·젬 5천, 기본 펫검증#0088)으로 DOTCHAT_PET_SPEED=600 서버를 띄운 뒤  node tools/verify-pet.mjs
//        (기본 localhost:4020, DOTCHAT_SERVER / DOTCHAT_PET_NICK / DOTCHAT_PET_TAG 로 변경)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  PET_DEFS,
  PET_FX,
  PET_GACHA,
  PET_MAX_DUP,
  PET_FOOD_PRICE,
  PET_CARD_PRICE_GEM,
  PET_LEVEL_CARDS,
  petEffectsAt,
  petRate5,
  petRate4,
  isPetFriday,
} from '../packages/shared/dist/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const NICK = process.env.DOTCHAT_PET_NICK ?? '펫검증';
const TAG = process.env.DOTCHAT_PET_TAG ?? '0088';
const fail = (msg) => {
  console.log(`PET_FAIL ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ① 동기화 ----
{
  const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/composer.ts'), 'utf8');
  const mDefs = /const PET_DEFS: PetDef\[\] = (\[[\s\S]*?\n\]);/.exec(src);
  const mFx = /const PET_FX: Record<PetFxKey, PetFxDef> = (\{[\s\S]*?\n\});/.exec(src);
  if (!mDefs || !mFx) fail('composer.ts에서 PET_DEFS / PET_FX를 찾을 수 없음');
  const cDefs = new Function(`return ${mDefs[1]}`)();
  const cFx = new Function(`return ${mFx[1]}`)();
  if (cDefs.length !== PET_DEFS.length) fail(`composer PET_DEFS ${cDefs.length}개 ≠ shared ${PET_DEFS.length}개`);
  for (const d of PET_DEFS) {
    const c = cDefs.find((x) => x.id === d.id);
    if (!c || JSON.stringify(c) !== JSON.stringify(d)) fail(`PET_DEFS 불일치: ${d.id}`);
  }
  if (JSON.stringify(cFx) !== JSON.stringify(PET_FX)) fail('PET_FX 불일치 (composer ↔ shared)');
  // docs/pet-defs.json (기획서 수치 원본) — 돌파별 누적값이 petEffectsAt와 같은지
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'docs/pet-defs.json'), 'utf8'));
  for (const d of PET_DEFS) {
    const j = doc.pets.find((x) => x.id === d.id);
    if (!j) fail(`docs/pet-defs.json에 ${d.id} 없음`);
    for (let n = 0; n <= PET_MAX_DUP; n++) {
      if (JSON.stringify(petEffectsAt(d, n)) !== JSON.stringify(j.levels[n])) fail(`${d.id} ${n}돌 효과가 기획서와 다름`);
    }
  }
  for (const [k, v] of Object.entries(doc.fx)) {
    if (!PET_FX[k] || PET_FX[k].label !== v[0] || PET_FX[k].cap !== v[2]) fail(`PET_FX ${k} 라벨/상한이 기획서와 다름`);
  }
  // 에셋 매니페스트
  const manifestPath = path.join(root, 'assets/extras/manifest-extras.json');
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const d of PET_DEFS) if (!m.pets?.[d.id]) fail(`매니페스트에 펫 스프라이트 없음: ${d.id}`);
    for (const star of ['3', '4', '5']) if (!m.petUi?.fx?.[star]) fail(`매니페스트에 ${star}성 이펙트 없음`);
    console.log(`  에셋 OK: 펫 시트 ${Object.keys(m.pets).length}종 + 이펙트 3종`);
  } else console.log('  (매니페스트 없음 — 에셋 검사 생략)');
  // 확률 함수 sanity
  if (petRate5(1) !== 0.6 || petRate5(70) !== 5.6 || petRate5(89) !== 100 || petRate5(90) !== 100) fail('petRate5 곡선 이상');
  if (petRate4(1) !== 10 || petRate4(7) !== 30 || petRate4(9) !== 50 || petRate4(10) !== 100) fail('petRate4 보정 이상');
  console.log(`  동기화 OK: PET_DEFS ${PET_DEFS.length}종 · PET_FX ${Object.keys(PET_FX).length}키 = composer = 기획서`);
}

// ---- ② 프로토콜 ----
const socket = io(url, { reconnection: false, timeout: 8000 });
let wallet = null;
let coinsEv = null;
let gemsEv = null;
let petPush = 0;
socket.on('wallet', (w) => (wallet = w));
socket.on('coins', (c) => (coinsEv = c));
socket.on('gems', (g) => (gemsEv = g));
socket.on('pet', () => petPush++);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('연결 시간 초과')), 10000);
  socket.on('connect_error', reject);
  socket.on('welcome', () => {
    clearTimeout(timer);
    resolve();
  });
  socket.on('connect', () => socket.emit('hello', { nickname: NICK, tag: TAG, appearance: { race: { name: 'Human' } } }));
}).catch((e) => fail(e.message));
await sleep(1200);
if (!wallet) fail('wallet 스냅샷 없음');
if (!('petFx' in wallet)) fail('지갑 스냅샷에 petFx 없음');
const call = (ev, ...args) => new Promise((resolve) => socket.timeout(8000).emit(ev, ...args, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));

let st = await call('pet-state');
if (!st || typeof st.pity5 !== 'number') fail(`pet-state 응답 이상: ${JSON.stringify(st)}`);
const coins0 = coinsEv ?? wallet.coins;
const gems0 = gemsEv ?? wallet.gems ?? 0;
if (coins0 < 10000 || gems0 < 1000) fail(`시드 부족: 🪙 ${coins0} (1만 이상) · 💎 ${gems0} (1천 이상)`);
console.log(`  시드: 🪙 ${coins0} · 💎 ${gems0} · 보유 ${Object.keys(st.owned).length}종 · 천장 ${st.pity5}/90 · 슬롯 ${st.slots} · 금요일 할인 ${st.fridayDiscount}`);

// 용품 구매
let r = await call('buy-pet-item', 'food', 3);
if (!r.ok || r.state.food !== st.food + 3 || r.state.coins !== coins0 - PET_FOOD_PRICE * 3) fail(`먹이 구매 이상: ${JSON.stringify(r).slice(0, 200)}`);
r = await call('buy-pet-item', 'card', 2);
if (!r.ok || r.state.cards !== st.cards + 2 || r.state.gems !== gems0 - PET_CARD_PRICE_GEM * 2) fail(`카드 구매 이상: ${JSON.stringify(r).slice(0, 200)}`);
r = await call('buy-pet-item', 'food', 0);
if (r.ok) fail('수량 0 구매가 성공함');
st = (await call('pet-state'));
console.log(`  용품 구매 OK: 먹이 ${st.food} · 카드 ${st.cards}`);

// 10연 — 4성 이상 보장, 비용(금요일 첫 10연 40 → 이후 50)
const friday = isPetFriday();
const expectedFirst = friday && st.fridayDiscount ? PET_GACHA.fridayTen : PET_GACHA.ten;
let gemsBefore = st.gems;
r = await call('pet-gacha', 10);
if (!r.ok || r.results.length !== 10) fail(`10연 실패: ${JSON.stringify(r).slice(0, 200)}`);
if (r.cost !== expectedFirst || r.state.gems !== gemsBefore - expectedFirst) fail(`10연 비용 이상: cost ${r.cost} (기대 ${expectedFirst}), 젬 ${gemsBefore}→${r.state.gems}`);
if (!r.results.some((x) => x.star >= 4)) fail('10연에 4성 이상이 없음');
const items3 = r.results.filter((x) => x.star === 3);
const foodGain = items3.filter((x) => x.item === 'food').reduce((s, x) => s + x.n, 0);
const cardGain = items3.filter((x) => x.item === 'card').reduce((s, x) => s + x.n, 0);
if (r.state.food !== st.food + foodGain || r.state.cards < st.cards + cardGain) fail('3성 아이템 지급 불일치');
if (friday && st.fridayDiscount && r.state.fridayDiscount) fail('금요일 할인이 사용 후에도 남아 있음');
console.log(`  10연 OK: 💎${r.cost} → ${r.results.map((x) => (x.star === 3 ? `3(${x.item}×${x.n})` : `${x.star}${x.isNew ? 'N' : ''}`)).join(' ')} · 천장 ${r.state.pity5}/90`);
st = r.state;

// 도배 방지(500ms) 확인 후 두 번째 10연은 정가
r = await call('pet-gacha', 10);
if (r.ok) fail('500ms 안의 연속 뽑기가 거부되지 않음');
await sleep(600);
gemsBefore = st.gems;
r = await call('pet-gacha', 10);
if (!r.ok || r.cost !== PET_GACHA.ten) fail(`두 번째 10연 비용 이상: ${r.cost ?? r.error}`);
await sleep(600);
st = r.state;

// 4성 보정: pity4는 항상 0~9
if (st.pity4 < 0 || st.pity4 > 9) fail(`pity4 범위 이상: ${st.pity4}`);

// 5성 천장 — 최대 90뽑 안에 반드시 1개 (1회씩 뽑으며 pity5 추적)
let pulls = 0;
let got5 = false;
let maxPity = st.pity5;
let dupSeen = false;
while (pulls < 100) {
  r = await call('pet-gacha', 1);
  if (!r.ok) fail(`1회 뽑기 실패: ${r.error}`);
  pulls++;
  const x = r.results[0];
  if (x.star === 5) {
    if (r.state.pity5 !== 0) fail(`5성 획득 후 pity5=${r.state.pity5} (기대 0)`);
    got5 = true;
    st = r.state;
    break;
  }
  if (x.star >= 4 && !x.isNew && typeof x.dup === 'number') dupSeen = true;
  if (r.state.pity5 !== st.pity5 + 1) fail(`pity5 증가 이상: ${st.pity5}→${r.state.pity5}`);
  if (r.state.pity5 > PET_GACHA.hardPity5) fail(`천장 초과: ${r.state.pity5}`);
  maxPity = Math.max(maxPity, r.state.pity5);
  st = r.state;
  if (r.state.gems < PET_GACHA.single) fail('젬 소진 — 시드를 늘려 주세요');
  await sleep(520); // 서버 도배 방지 500ms
}
if (!got5) fail(`${pulls}회 1뽑 동안 5성 없음 (천장 ${maxPity})`);
console.log(`  5성 천장 OK: ${pulls}회 1뽑 만에 5성 (최대 스택 ${maxPity}) · 잔여 💎 ${st.gems}${dupSeen ? ' · 돌파 확인' : ''}`);

// 돌파/환급: 같은 펫이 여러 번 나왔으면 dup 증가, 10돌 초과는 refund
const ownedIds = Object.keys(st.owned);
if (ownedIds.length === 0) fail('뽑기 후 보유 펫이 없음');
for (const [id, o] of Object.entries(st.owned)) if (o.dup > PET_MAX_DUP) fail(`${id} 돌파 ${o.dup} > ${PET_MAX_DUP}`);

// 장착 — 슬롯 수 검증
const fiveId = ownedIds.find((id) => PET_DEFS.find((d) => d.id === id)?.star === 5) ?? ownedIds[0];
const petDef = PET_DEFS.find((d) => d.id === fiveId);
r = await call('pet-equip', [fiveId]);
if (!r.ok || r.state.equip[0] !== fiveId) fail(`장착 실패: ${JSON.stringify(r).slice(0, 200)}`);
st = r.state;
const fx0 = petEffectsAt(petDef, st.owned[fiveId].dup);
for (const [k, v] of Object.entries(fx0)) if (Math.abs((st.fx[k] ?? 0) - v) > 0.011 && v <= PET_FX[k].cap) fail(`장착 효과 ${k} 불일치: ${st.fx[k]} vs ${v}`);
const tooMany = ownedIds.slice(0, st.slots + 1);
if (tooMany.length > st.slots) {
  r = await call('pet-equip', tooMany);
  if (r.ok) fail('슬롯 초과 장착이 성공함');
}
r = await call('pet-equip', ['nope-pet']);
if (r.ok) fail('미보유 펫 장착이 성공함');
console.log(`  장착 OK: ${petDef.name}(${fiveId}) ${st.owned[fiveId].dup}돌 → 효과 ${Object.entries(st.fx).map(([k, v]) => `${k}=${v}`).join(', ')}`);

// 포만도 감소 (배속 서버) → 먹이 → 100
await sleep(2500);
st = await call('pet-state');
const sat1 = st.owned[fiveId].satiety;
if (sat1 >= 100) fail(`포만도가 줄지 않음 (${sat1}) — DOTCHAT_PET_SPEED=600 서버인지 확인`);
r = await call('pet-feed', fiveId);
if (!r.ok || r.state.owned[fiveId].satiety !== 100 || r.state.food !== st.food - 1) fail(`먹이 이상: ${JSON.stringify(r).slice(0, 200)}`);
st = r.state;
console.log(`  포만도 OK: ${sat1}% → 먹이 → 100% (먹이 ${st.food})`);

// 레벨업
const need = PET_LEVEL_CARDS[st.owned[fiveId].lv - 1];
if (st.cards >= need) {
  r = await call('pet-level', fiveId);
  if (!r.ok || r.state.owned[fiveId].lv !== st.owned[fiveId].lv + 1 || r.state.cards !== st.cards - need) fail(`레벨업 이상: ${JSON.stringify(r).slice(0, 200)}`);
  st = r.state;
  console.log(`  레벨업 OK: Lv${st.owned[fiveId].lv} (카드 ${st.cards})`);
} else console.log('  (카드 부족 — 레벨업 생략)');

// 자동 먹이: 임계 90% → 배속으로 곧 떨어지면 자동 급여
r = await call('pet-autofeed', { on: true, pct: 90 });
if (!r.ok || !r.state.autoFeed.on || r.state.autoFeed.pct !== 90) fail('자동 먹이 설정 실패');
const foodBefore = r.state.food;
if (foodBefore < 1) fail('자동 먹이 검증에 먹이가 없음');
await sleep(4000);
st = await call('pet-state');
if (st.food !== foodBefore - 1 || st.owned[fiveId].satiety < 90) fail(`자동 먹이 미동작: 먹이 ${foodBefore}→${st.food}, 포만도 ${st.owned[fiveId].satiety}`);
await call('pet-autofeed', { on: false, pct: 70 });
console.log(`  자동 먹이 OK: 먹이 ${foodBefore}→${st.food}, 포만도 ${st.owned[fiveId].satiety}%`);

// 지갑 스냅샷 petFx (재접속 없이 최근 wallet 이벤트는 없으므로 pet-state.fx로 갈음) + 해제
r = await call('pet-equip', []);
if (!r.ok || r.state.equip.length !== 0 || Object.keys(r.state.fx).length !== 0) fail('해제 실패');
console.log(`PET_OK 보유 ${Object.keys(r.state.owned).length}종 · 누적 ${r.state.total}회 · 🪙 ${r.state.coins} · 💎 ${r.state.gems}`);
socket.disconnect();
process.exit(0);

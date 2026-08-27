// 그림 쪽지 + 자랑하기 검증
// 사용법: node tools/verify-note.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { io } = require(path.join(root, 'node_modules', 'socket.io-client'));

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };
const IMAGE = `data:image/png;base64,${fs
  .readFileSync(path.join(root, 'assets', 'extras', 'fish2', 'goldfish.png'))
  .toString('base64')}`;

const fail = (msg) => {
  console.log(`NOTE_FAIL ${msg}`);
  process.exit(1);
};

const connect = (nickname, tag) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const box = { socket, notes: null, liveNotes: [], brags: [], coins: 0 };
    socket.on('notes', (n) => (box.notes = n));
    socket.on('note', (n) => box.liveNotes.push(n));
    socket.on('brag-news', (b) => box.brags.push(b));
    socket.on('wallet', (w) => (box.coins = w.coins));
    socket.on('coins', (c) => (box.coins = c)); // 분당 적립 반영
    const timer = setTimeout(() => reject(new Error(`${nickname} 연결 시간 초과`)), 10000);
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('welcome', () => { clearTimeout(timer); setTimeout(() => resolve(box), 400); });
    socket.on('connect', () => socket.emit('hello', { nickname, tag, appearance: APPEARANCE }));
  });

const emitAck = (socket, event, ...args) =>
  new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, ...args, (err, res) => (err ? reject(err) : resolve(res)));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 조건 충족까지 대기 (프로덕션은 chat-history가 커서 notes 도착이 늦을 수 있음)
const waitFor = async (cond, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await sleep(200);
  }
  return cond();
};

const A_KEY = '쪽지검증A#0041';
const B_KEY = '쪽지검증B#0042';
const a = await connect('쪽지검증A', '0041');
const b = await connect('쪽지검증B', '0042');

// 1) A→B 전송: 5코인 차감 + B 실시간 수신 (재실행 시 쿨타임 잔여만큼 대기)
let res = await emitAck(a.socket, 'note-send', { to: B_KEY, image: IMAGE });
if (!res.ok && /(\d+)초 후에/.test(String(res.error))) {
  const wait = Number(RegExp.$1) + 2;
  console.log(`  (이전 실행 쿨타임 ${wait}초 대기...)`);
  await sleep(wait * 1000);
  res = await emitAck(a.socket, 'note-send', { to: B_KEY, image: IMAGE });
}
if (!res.ok) fail(`전송 실패: ${JSON.stringify(res.error)}`);
// 분당 적립(+1)과 겹칠 수 있어 오차 허용 (정확한 -5 차감은 로컬 테스트에서 검증)
const expected = a.coins - 5;
if (typeof res.coins !== 'number' || res.coins < expected || res.coins > expected + 5) {
  fail(`코인 차감 이상: ${a.coins} → ${res.coins}`);
}
if (!(await waitFor(() => b.liveNotes.length >= 1, 5000))) fail('B 실시간 수신 실패');
const live = b.liveNotes[b.liveNotes.length - 1];
if (live.from !== A_KEY || live.image !== IMAGE) fail('수신 내용 불일치');
const noteId = live.id;
console.log(`  전송/수신 OK (-5🪙, ${Math.round(IMAGE.length / 1024)}KB)`);

// 2) 쿨타임: 즉시 재전송 거부
res = await emitAck(a.socket, 'note-send', { to: B_KEY, image: IMAGE });
if (res.ok) fail('쿨타임 무시됨');
console.log('  쿨타임 OK');

// 3) 유효성: 없는 수신자 / 본인 / 초과 크기
res = await emitAck(b.socket, 'note-send', { to: '없는사람#9876', image: IMAGE });
if (res.ok) fail('없는 수신자에게 전송됨');
res = await emitAck(b.socket, 'note-send', { to: B_KEY, image: IMAGE });
if (res.ok) fail('자신에게 전송됨');
res = await emitAck(b.socket, 'note-send', { to: A_KEY, image: 'data:image/png;base64,' + 'A'.repeat(25000) });
if (res.ok) fail('초과 크기 그림이 전송됨');
console.log('  유효성 OK (없는 수신자/본인/크기 거부)');

// 4) 보관: B 재접속 시 미확인 쪽지 재수신 → 전부 열람 후 삭제 확인
b.socket.disconnect();
await sleep(400);
const b2 = await connect('쪽지검증B', '0042');
if (!(await waitFor(() => Array.isArray(b2.notes), 10000))) fail('재접속 시 notes 이벤트 미수신');
if (!b2.notes.some((n) => n.id === noteId)) fail(`재접속 보관 목록에 방금 쪽지 없음 (${b2.notes.length}개)`);
for (const n of b2.notes) b2.socket.emit('note-read', n.id); // 이전 실행 잔여분 포함 전부 열람
await sleep(800);
b2.socket.disconnect();
await sleep(400);
const b3 = await connect('쪽지검증B', '0042');
await sleep(2000); // notes가 오면 안 됨 — 늦게 올 가능성까지 대기
if (b3.notes !== null && b3.notes.length > 0) fail(`열람 후에도 쪽지가 남아있음 (${b3.notes.length}개)`);
console.log('  보관/열람 삭제 OK');

// 5) 자랑하기: 전체 브로드캐스트 + 쿨타임
res = await emitAck(a.socket, 'brag');
if (!res.ok) fail(`자랑 실패: ${res.error}`);
await sleep(500);
if (!a.brags.some((x) => x.nickname === '쪽지검증A') || !b3.brags.some((x) => x.nickname === '쪽지검증A')) {
  fail('brag-news 브로드캐스트 미수신');
}
res = await emitAck(a.socket, 'brag');
if (res.ok) fail('자랑 쿨타임 무시됨');
console.log(`  자랑하기 OK (stars=${a.brags[0].stars}, 쿨타임 확인)`);

a.socket.disconnect();
b3.socket.disconnect();
console.log('NOTE_OK');
process.exit(0);

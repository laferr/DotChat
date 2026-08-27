// 랭킹 프로토콜 검증 — 접속 직후 ranking-update push(rows+me) + ranking ack 일치 + 정렬/최대 5행
// 사용법: node tools/verify-ranking.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };
const NICK = '랭킹검증';
const TAG = '9901';

const fail = (msg) => {
  console.log(`RANKING_FAIL ${msg}`);
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
    const pushed = new Promise((res) => socket.once('ranking-update', res));
    socket.on('welcome', () => {
      clearTimeout(timer);
      resolve({ socket, pushed });
    });
    socket.on('connect', () => {
      socket.emit('hello', { nickname, tag, appearance: APPEARANCE });
    });
  });

const checkRows = (rows, label) => {
  if (!Array.isArray(rows)) fail(`${label}: 배열이 아님`);
  if (rows.length > 5) fail(`${label}: ${rows.length}행 (최대 5)`);
  for (const r of rows) {
    if (typeof r.name !== 'string' || typeof r.coins !== 'number') fail(`${label}: 행 형식 오류 ${JSON.stringify(r)}`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].coins < rows[i].coins) fail(`${label}: 정렬 오류 (${i - 1}행 < ${i}행)`);
  }
  console.log(`  ${label} OK: ${rows.map((r) => `${r.name}(${r.coins})`).join(', ') || '(빈 랭킹)'}`);
};

const { socket, pushed } = await connect(NICK, TAG);

// 1) 접속 직후 push — { rows, me } 페이로드
const payload = await Promise.race([
  pushed,
  new Promise((_, rej) => setTimeout(() => rej(new Error('ranking-update push 없음')), 5000)),
]).catch((e) => fail(e.message));
if (!payload || !Array.isArray(payload.rows)) fail(`push 페이로드 형식 오류: ${JSON.stringify(payload).slice(0, 120)}`);
checkRows(payload.rows, '접속 직후 push rows');

// 2) 내 순위 — 내 지갑이 반드시 존재하므로 me가 있어야 함
const me = payload.me;
if (!me || typeof me.rank !== 'number' || typeof me.coins !== 'number') fail(`me 누락/형식 오류: ${JSON.stringify(me)}`);
if (me.rank < 1) fail(`me.rank 이상값: ${me.rank}`);
const myRow = payload.rows.find((r) => r.name === `${NICK}#${TAG}`);
if (myRow && me.rank > 5) fail(`rows에 내가 있는데 rank=${me.rank}`);
console.log(`  내 순위 OK: ${me.rank}위 (${me.coins} 🪙)`);

// 3) ranking ack (기존 프로토콜, rows 배열)와 일치
const ackRows = await new Promise((resolve) => socket.timeout(5000).emit('ranking', (err, rows) => resolve(err ? null : rows)));
if (!ackRows) fail('ranking ack 응답 없음');
checkRows(ackRows, 'ranking ack');
if (JSON.stringify(ackRows) !== JSON.stringify(payload.rows)) fail('push rows와 ack 결과 불일치');

console.log('RANKING_OK');
socket.close();
process.exit(0);

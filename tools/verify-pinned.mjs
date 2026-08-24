// 고정메시지 프로토콜 검증 — hello의 pinned 저장 + player-pinned 브로드캐스트 + 정제(길이/공백)
// 사용법: node tools/verify-pinned.mjs   (기본 localhost:4020, DOTCHAT_SERVER로 변경 가능)
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const APPEARANCE = { race: { name: 'Human' } };
const MAX_PINNED_LEN = 40;

const HELLO_PINNED = '  처음   고정메시지  ';
const HELLO_EXPECT = '처음 고정메시지'; // 공백 정리 후
const UPDATED = '바뀐 고정메시지';
const TOO_LONG = '가'.repeat(60);

const fail = (msg) => {
  console.log(`PINNED_FAIL ${msg}`);
  process.exit(1);
};

const connect = (nickname, tag, extra = {}) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => reject(new Error(`${nickname} 연결 시간 초과`)), 10000);
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('welcome', (data) => {
      clearTimeout(timer);
      resolve({ socket, welcome: data });
    });
    socket.on('connect', () => socket.emit('hello', { nickname, tag, appearance: APPEARANCE, ...extra }));
  });

const nextEvent = (socket, event, ms = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 이벤트 미수신`)), ms);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

// A = 고정메시지를 가진 유저, B = 나중에 접속해서 A를 관찰하는 유저
const a = await connect('고정검증A', '0011', { pinned: HELLO_PINNED });
const b = await connect('고정검증B', '0012');

// 1) B의 welcome 목록에 A의 고정메시지가 (정제된 상태로) 실려 온다
const seenA = b.welcome.players.find((p) => p.id === a.socket.id);
if (!seenA) fail('B의 welcome 목록에 A가 없음');
if (seenA.pinned !== HELLO_EXPECT) fail(`hello pinned 정제 실패: ${JSON.stringify(seenA.pinned)}`);
console.log(`  hello pinned OK: ${JSON.stringify(seenA.pinned)}`);

// 2) A가 고정메시지를 바꾸면 B가 player-pinned를 받는다
let evt = nextEvent(b.socket, 'player-pinned');
a.socket.emit('pinned', UPDATED);
let got = await evt;
if (got.id !== a.socket.id || got.text !== UPDATED) fail(`갱신 브로드캐스트 불일치: ${JSON.stringify(got)}`);
console.log(`  player-pinned OK: ${JSON.stringify(got.text)}`);

// 3) 길이 제한 — 40자로 잘린다 (도배 방지 쿨타임 500ms 대기 후)
await new Promise((r) => setTimeout(r, 700));
evt = nextEvent(b.socket, 'player-pinned');
a.socket.emit('pinned', TOO_LONG);
got = await evt;
if (got.text.length !== MAX_PINNED_LEN) fail(`길이 제한 실패: ${got.text.length}자`);
console.log(`  길이 제한 OK: ${got.text.length}자`);

// 4) 빈 문자열로 해제된다
await new Promise((r) => setTimeout(r, 700));
evt = nextEvent(b.socket, 'player-pinned');
a.socket.emit('pinned', '   ');
got = await evt;
if (got.text !== '') fail(`해제 실패: ${JSON.stringify(got.text)}`);
console.log('  해제 OK');

a.socket.disconnect();
b.socket.disconnect();
console.log('PINNED_OK');
process.exit(0);

// 테스트용 봇 — 두 번째 유저를 시뮬레이션 (node packages/server/bot.mjs)
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'http://localhost:4020';
const nickname = process.env.BOT_NICK ?? '봇순이';
const appearance = {
  race: { name: process.env.BOT_RACE ?? 'Goblin' },
  hair: { name: 'Hair7', h: -40 },
  armor: { name: 'BanditTunic' },
};

const LINES = [
  '안녕하세요~',
  '오늘 날씨 좋네요',
  'ㅋㅋㅋㅋㅋ',
  '작업표시줄 산책 중입니다',
  '선물상자는 M3에서 나온대요',
  '말풍선 테스트도 해볼게요. 조금 긴 문장을 쓰면 말풍선이 여러 줄로 나뉘어서 표시되는지 확인!',
];

const socket = io(url);

// 실제 클라이언트와 같은 이동 로직: 걷기/멈춤 반복, 걸을 때마다 속도 랜덤
const TICK_MS = 150;
const REF_WIDTH = 1920; // 정규화 속도 환산 기준 해상도
let x = Math.random();
let dir = 1;
let walking = true;
let modeTime = 2;
let speed = 55 / REF_WIDTH;

function pickNextMode() {
  if (Math.random() < 0.35) {
    walking = false;
    modeTime = 1 + Math.random() * 2;
  } else {
    walking = true;
    modeTime = 1.5 + Math.random() * 3;
    speed = (30 + Math.random() * 55) / REF_WIDTH; // 30~85px/s 상당
    if (Math.random() < 0.4) dir = dir === 1 ? -1 : 1;
  }
}

socket.on('connect', () => {
  console.log(`bot connected as ${nickname} (${socket.id})`);
  socket.emit('hello', { nickname, tag: '9999', appearance });
});
socket.on('disconnect', () => console.log('bot disconnected'));

setInterval(() => {
  const dt = TICK_MS / 1000;
  modeTime -= dt;
  if (modeTime <= 0) pickNextMode();
  if (walking) {
    x += dir * speed * dt;
    if (x > 0.95) {
      x = 0.95;
      dir = -1;
    }
    if (x < 0.05) {
      x = 0.05;
      dir = 1;
    }
  }
  socket.emit('move', { x, dir, walking });
}, TICK_MS);

let lineIdx = 0;
setInterval(() => {
  socket.emit('chat', LINES[lineIdx % LINES.length]);
  lineIdx++;
}, 7000);

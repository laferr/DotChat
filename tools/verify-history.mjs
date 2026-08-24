// 프로덕션 서버에 chat-history(v0.2.2 서버)가 배포됐는지 폴링 검증
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'https://dotchat-production-e868.up.railway.app';
const DEADLINE = Date.now() + 15 * 60 * 1000;

function tryOnce() {
  return new Promise((resolve) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve(false);
    }, 12000);
    socket.on('connect', () => {
      socket.emit('hello', {
        nickname: '배포검증',
        tag: '0002',
        appearance: { race: { name: 'Human' } },
      });
    });
    socket.on('chat-history', (msgs) => {
      clearTimeout(timer);
      console.log(`HISTORY_OK count=${Array.isArray(msgs) ? msgs.length : '?'}`);
      socket.disconnect();
      resolve(true);
    });
    socket.on('connect_error', () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(false);
    });
  });
}

while (Date.now() < DEADLINE) {
  if (await tryOnce()) process.exit(0);
  console.log('waiting for history deploy...');
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('TIMEOUT');
process.exit(1);

// 프로덕션 서버에 action 이벤트(v0.2.1 서버)가 배포됐는지 폴링 검증
import { io } from 'socket.io-client';

const url = process.env.DOTCHAT_SERVER ?? 'https://dotchat-production-e868.up.railway.app';
const DEADLINE = Date.now() + 10 * 60 * 1000;

function tryOnce() {
  return new Promise((resolve) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve(false);
    }, 12000);
    let myId = null;
    socket.on('connect', () => {
      socket.emit('hello', {
        nickname: '배포검증',
        tag: '0002',
        appearance: { race: { name: 'Human' } },
      });
    });
    socket.on('welcome', (d) => {
      myId = d.selfId;
      socket.emit('action', { action: 'jump', text: '배포 확인' });
    });
    socket.on('chat', (msg) => {
      if (msg.id === myId && msg.action === 'jump') {
        clearTimeout(timer);
        console.log('ACTION_OK');
        socket.disconnect();
        resolve(true);
      }
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
  console.log('waiting for action deploy...');
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('TIMEOUT');
process.exit(1);

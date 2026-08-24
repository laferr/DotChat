// 프로덕션 서버가 v2(Appearance) 프로토콜로 재배포됐는지 폴링 검증
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
    socket.on('connect', () => {
      socket.emit('hello', {
        nickname: '배포검증',
        tag: '0002',
        appearance: { race: { name: 'Human' }, hair: { name: 'Hair1' } },
      });
    });
    socket.on('welcome', (d) => {
      clearTimeout(timer);
      const self = d.players.find((p) => p.nickname === '배포검증');
      const ok = !!self?.appearance?.race?.name;
      console.log(ok ? `V2_OK race=${self.appearance.race.name}, online=${d.players.length}` : 'V1_STILL');
      socket.disconnect();
      resolve(ok);
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
  console.log('waiting for redeploy...');
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('TIMEOUT');
process.exit(1);

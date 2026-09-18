// 프로덕션 서버가 v0.2.17(slot-pool 이벤트)로 재배포됐는지 폴링
import { io } from 'socket.io-client';
const url = process.env.DOTCHAT_SERVER ?? 'https://dotchat-production-e868.up.railway.app';
const WANT = '0.2.17';
const DEADLINE = Date.now() + 12 * 60 * 1000;
function tryOnce() {
  return new Promise((resolve) => {
    const socket = io(url, { reconnection: false, timeout: 8000 });
    let version = null, pool = null;
    const timer = setTimeout(() => { socket.disconnect(); resolve({ version, pool }); }, 12000);
    socket.on('slot-pool', (p) => { pool = p; });
    socket.on('welcome', (d) => { version = d.serverVersion; setTimeout(() => { clearTimeout(timer); socket.disconnect(); resolve({ version, pool }); }, 1500); });
    socket.on('connect', () => socket.emit('hello', { nickname: '배포검증', tag: '0002', appearance: { race: { name: 'Human' } } }));
    socket.on('connect_error', () => { clearTimeout(timer); socket.disconnect(); resolve({ version, pool }); });
  });
}
while (Date.now() < DEADLINE) {
  const r = await tryOnce();
  if (r.version === WANT && typeof r.pool === 'number') { console.log(`DEPLOY_OK v${r.version} jackpot=${r.pool}`); process.exit(0); }
  console.log(`waiting... server=${r.version ?? 'n/a'} pool=${r.pool ?? 'n/a'}`);
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('DEPLOY_TIMEOUT'); process.exit(1);

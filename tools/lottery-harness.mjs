// 🎟️ 즉석복권 패널 UI 하네스 — chat.html을 ?panel=lottery 팝아웃 모드로 브라우저에서 띄우기 위해
// CSP 제거 + window.overlay 스텁(가짜 지갑, 시나리오 순환 티켓) 주입본을 tools/lottery-harness.html로 생성한다.
// 사용법: node tools/lottery-harness.mjs && node tools/serve.mjs  →  http://localhost:5317/tools/lottery-harness.html?panel=lottery
//   구매마다 시나리오 순환: 4등(20,000) → 꽝 → 1등(10억) → 잔액 부족 오류
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/chat.html'), 'utf8');

const stub = `
<script>
(() => {
  let coins = 123456, n = 0, pending = null;
  const SCENARIOS = [[4, 20000], [0, 0], [1, 1000000000], null];
  const api = {
    on: () => {},
    getSelf: async () => ({ nickname: '테스터', tag: '0001', appearance: { race: { name: 'Human' } }, giftIntervalSec: 180 }),
    getSettings: async () => ({ opacity: 100, scale: 2, chatColor: '#d94f63', pinnedMsg: '', pinnedOn: false, tickerOn: true }),
    getNetState: async () => ({ selfId: 'me', connected: true, online: 1, players: [] }),
    getChatHistory: async () => [],
    getInventory: async () => ({ version: 2, owned: [], equipped: { race: { name: 'Human' } } }),
    getWallet: async () => ({ coins, items: [], fish: [], gems: 3, actions: [], minerals: [], slotPool: 5000000 }),
    getCoins: async () => coins,
    getDailyState: async () => null,
    getRankingCached: async () => null,
    getUpdateState: async () => null,
    getAchState: async () => null,
    getExtras: async () => null,
    getManifest: async () => null,
    loadPart: async () => null,
    loadExtra: async () => null,
    lotteryState: async () => ({ ticket: pending, coins }),
    lotteryBuy: async () => {
      await new Promise((r) => setTimeout(r, 300));
      const sc = SCENARIOS[n++ % SCENARIOS.length];
      if (!sc) return { ok: false, error: '코인이 부족해요. (' + coins + '/2000)', coins };
      coins -= 2000;
      pending = { id: 'tk' + n, rank: sc[0], prize: sc[1], ts: Date.now() };
      return { ok: true, ticket: { ...pending }, coins };
    },
    lotteryClaim: async (id) => {
      if (!pending || pending.id !== id) return { ok: false, error: '공개할 복권이 없어요.', coins };
      const t = pending; pending = null; coins += t.prize;
      return { ok: true, rank: t.rank, prize: t.prize, coins };
    },
  };
  window.overlay = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
})();
</script>`;

const out = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script src="../../dist/renderer/composer.js"></script>', `${stub}\n    <script src="../packages/client/dist/renderer/composer.js"></script>`)
  .replace('<script src="../../dist/renderer/chat.js"></script>', '<script src="../packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync(path.join(root, 'tools/lottery-harness.html'), out, 'utf8');
console.log('tools/lottery-harness.html 생성 — node tools/serve.mjs 후 http://localhost:5317/tools/lottery-harness.html?panel=lottery');

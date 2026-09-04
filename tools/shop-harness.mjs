// 상점 패널 UI 하네스 — chat.html을 ?panel=shop 팝아웃 모드로 브라우저에서 띄우기 위해
// CSP 제거 + window.overlay 스텁(가짜 지갑, 환전 즉시 반영) 주입본을 tools/shop-harness.html로 생성한다.
// 사용법: node tools/shop-harness.mjs && node tools/serve.mjs  →  http://localhost:5317/tools/shop-harness.html?panel=shop
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/chat.html'), 'utf8');

const stub = `
<script>
(() => {
  let coins = 5230, gems = 7;
  const api = {
    on: () => {},
    getSelf: async () => ({ nickname: '테스터', tag: '0001', appearance: { race: { name: 'Human' } }, giftIntervalSec: 180 }),
    getSettings: async () => ({ opacity: 100, scale: 2, chatColor: '#d94f63', pinnedMsg: '', pinnedOn: false, tickerOn: true }),
    getNetState: async () => ({ selfId: 'me', connected: true, online: 1, players: [] }),
    getChatHistory: async () => [],
    getInventory: async () => ({ version: 2, owned: [], equipped: { race: { name: 'Human' } } }),
    getWallet: async () => ({ coins, items: ['aura-1'], fish: [], gems, actions: ['jump'], minerals: [] }),
    getCoins: async () => coins,
    getDailyState: async () => null,
    getRankingCached: async () => null,
    getUpdateState: async () => null,
    getAchState: async () => null,
    getExtras: async () => null,
    getManifest: async () => null,
    loadPart: async () => null,
    exchange: async (dir, n) => {
      if (dir === 'gold-to-gem') { if (coins < n * 1000) return { ok: false, error: '골드가 부족해요. (' + coins + '/' + n * 1000 + ' 🪙)' }; coins -= n * 1000; gems += n; }
      else { if (gems < n) return { ok: false, error: '젬이 부족해요. (' + gems + '/' + n + ' 💎)' }; gems -= n; coins += n * 900; }
      return { ok: true, coins, gems, qty: n };
    },
    buyItem: async () => ({ ok: false, error: '하네스' }),
    buyAction: async () => ({ ok: false, error: '하네스' }),
    buyRandom: async () => ({ ok: false, error: '하네스' }),
  };
  window.overlay = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
})();
</script>`;

const out = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script src="../../dist/renderer/composer.js"></script>', `${stub}\n    <script src="../packages/client/dist/renderer/composer.js"></script>`)
  .replace('<script src="../../dist/renderer/chat.js"></script>', '<script src="../packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync(path.join(root, 'tools/shop-harness.html'), out, 'utf8');
console.log('tools/shop-harness.html 생성 — node tools/serve.mjs 후 http://localhost:5317/tools/shop-harness.html?panel=shop');

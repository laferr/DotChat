// 주식 패널 UI 하네스 — chat.html을 ?panel=stock 팝아웃 모드로 브라우저에서 띄우기 위해
// CSP 제거 + window.overlay 스텁(가짜 시세·지갑, 매수/매도 즉시 반영) 주입본을 tools/stock-harness.html로 생성한다.
// 사용법: node tools/stock-harness.mjs && node tools/serve.mjs  →  http://localhost:5317/tools/stock-harness.html?panel=stock
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/chat.html'), 'utf8');

const stub = `
<script>
(() => {
  const QTY_MAX = 999_999_999;
  let coins = 2_500_000;
  // 보유: 슥하이닉스(수익) / 삼별전자(손실) / 봇순이(보유만, 평단=현재가)
  const holdings = {
    hynix: { qty: 12, avg: 9200 },
    sambyeol: { qty: 40, avg: 5400 },
    botsoon: { qty: 999_999_999, avg: 5 },
  };
  const defs = [
    ['hynix', 10000, 10350], ['sambyeol', 5000, 4890], ['airpass', 1000, 1120], ['wolchuk', 500, 470],
    ['forge', 350, 350], ['spark', 200, 233], ['chest', 120, 99], ['note', 80, 88],
    ['slot', 50, 41], ['runner', 20, 27], ['minnow', 10, 9], ['botsoon', 5, 5],
  ];
  const hist = (p) => Array.from({ length: 48 }, (_, i) => Math.max(1, Math.round(p * (0.85 + 0.3 * Math.abs(Math.sin(i / 5))))));
  const market = {
    nextTickTs: Date.now() + 4 * 60_000,
    stocks: defs.map(([id, init, price]) => ({ id, price, prev: Math.round(price * 0.97), history: [...hist(init), price] })),
  };
  market.stocks.find((s) => s.id === 'minnow').delistedUntil = Date.now() + 300_000;
  const priceOf = (id) => market.stocks.find((s) => s.id === id).price;
  const api = {
    on: () => {},
    getSelf: async () => ({ nickname: '테스터', tag: '0001', appearance: { race: { name: 'Human' } }, giftIntervalSec: 180 }),
    getSettings: async () => ({ opacity: 100, scale: 2, chatColor: '#d94f63', pinnedMsg: '', pinnedOn: false, tickerOn: true }),
    getNetState: async () => ({ selfId: 'me', connected: true, online: 1, players: [] }),
    getChatHistory: async () => [],
    getInventory: async () => ({ version: 2, owned: [], equipped: { race: { name: 'Human' } } }),
    getWallet: async () => ({ coins, items: [], fish: [], gems: 7, actions: [], minerals: [], stocks: holdings }),
    getCoins: async () => coins,
    getStocks: async () => market,
    stockBuy: async (id, qty) => {
      const cost = priceOf(id) * qty;
      if (qty < 1 || qty > QTY_MAX) return { ok: false, error: '수량이 올바르지 않아요.' };
      if (coins < cost) return { ok: false, error: '코인이 부족해요. (' + coins + '/' + cost + ')', coins };
      const h = holdings[id] ?? { qty: 0, avg: 0 };
      if (h.qty + qty > QTY_MAX) return { ok: false, error: '종목당 최대 ' + QTY_MAX + '주까지 보유할 수 있어요.' };
      coins -= cost;
      h.avg = Math.round(((h.avg * h.qty + cost) / (h.qty + qty)) * 100) / 100;
      h.qty += qty;
      holdings[id] = h;
      return { ok: true, coins, holding: { ...h } };
    },
    stockSell: async (id, qty) => {
      const h = holdings[id];
      if (!h || h.qty < qty) return { ok: false, error: '보유 수량이 부족해요. (' + (h?.qty ?? 0) + '주)' };
      coins += priceOf(id) * qty;
      h.qty -= qty;
      if (h.qty <= 0) delete holdings[id];
      return { ok: true, coins, holding: { qty: h.qty, avg: h.avg } };
    },
    getDailyState: async () => null,
    getRankingCached: async () => null,
    getUpdateState: async () => null,
    getAchState: async () => null,
    getExtras: async () => null,
    getManifest: async () => null,
    loadPart: async () => null,
  };
  window.overlay = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
})();
</script>`;

const out = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script src="../../dist/renderer/composer.js"></script>', `${stub}\n    <script src="../packages/client/dist/renderer/composer.js"></script>`)
  .replace('<script src="../../dist/renderer/chat.js"></script>', '<script src="../packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync(path.join(root, 'tools/stock-harness.html'), out, 'utf8');
console.log('tools/stock-harness.html 생성 — node tools/serve.mjs 후 http://localhost:5317/tools/stock-harness.html?panel=stock');

// 🎰 슬롯 패널 UI 하네스 — chat.html을 ?panel=slot 팝아웃 모드로 브라우저에서 띄우기 위해
// CSP 제거 + window.overlay 스텁(가짜 지갑·잭팟, 시나리오 순환 스핀 결과) 주입본을 tools/slot-harness.html로 생성한다.
// 사용법: node tools/slot-harness.mjs && node tools/serve.mjs  →  http://localhost:5317/tools/slot-harness.html?panel=slot
//   스핀마다 시나리오 순환: 다중 라인 당첨+🎁 파츠 → 꽝 → 💎×5 환산 → 7️⃣×5 누적 잭팟 → 잔액 부족 오류
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/chat.html'), 'utf8');

const stub = `
<script>
(() => {
  let coins = 123456, gems = 12, pool = 100000 + 23456, n = 0;
  const PAY = { '🍒': [5, 20, 100], '🍋': [5, 20, 100], '🍇': [8, 40, 200], '🔔': [15, 75, 400], '⭐': [30, 200, 1000], '💎': [50, 500, 3000], '7️⃣': [80, 800, 0] };
  // grid[릴][행] — 각 시나리오는 행 단위로 적는다
  const rows = (r0, r1, r2) => [0, 1, 2, 3, 4].map((reel) => [r0[reel], r1[reel], r2[reel]]);
  const evalLines = (grid, lines, bet) => {
    const wins = []; let jackpot = false;
    for (let li = 0; li < Math.min(lines, SLOT_PAYLINES.length); li++) {
      const p = SLOT_PAYLINES[li]; const first = grid[0][p[0]];
      if (first === '🎁' || first === '🃏') continue;
      let count = 1;
      for (let r = 1; r < 5; r++) { const s = grid[r][p[r]]; if (s === first || (s === '🃏' && first !== '7️⃣')) count++; else break; }
      if (count < 3) continue;
      if (first === '7️⃣' && count === 5) { jackpot = true; wins.push({ line: li, symbol: first, count, pay: 0 }); continue; }
      wins.push({ line: li, symbol: first, count, pay: PAY[first][count - 3] * bet });
    }
    return { wins, jackpot, scatter: grid.flat().filter((s) => s === '🎁').length };
  };
  const SCENARIOS = [
    () => rows(['🍒', '🍒', '🎁', '🔔', '🎁'], ['🍒', '🍒', '🍒', '⭐', '7️⃣'], ['🎁', '🍒', '🍒', '🍒', '🍋']),
    () => rows(['🍋', '🍇', '🔔', '⭐', '🍒'], ['🍒', '🍋', '🍇', '🔔', '⭐'], ['🍇', '🔔', '⭐', '🍒', '🍋']),
    () => rows(['🍋', '🍇', '🔔', '⭐', '🍒'], ['💎', '💎', '💎', '💎', '💎'], ['🍇', '🔔', '⭐', '🍒', '🍋']),
    () => rows(['🍒', '🍋', '🍇', '🔔', '⭐'], ['7️⃣', '7️⃣', '7️⃣', '7️⃣', '7️⃣'], ['🍋', '🍇', '🔔', '⭐', '🍒']),
    null, // 잔액 부족 오류
  ];
  const api = {
    on: () => {},
    getSelf: async () => ({ nickname: '테스터', tag: '0001', appearance: { race: { name: 'Human' } }, giftIntervalSec: 180 }),
    getSettings: async () => ({ opacity: 100, scale: 2, chatColor: '#d94f63', pinnedMsg: '', pinnedOn: false, tickerOn: true }),
    getNetState: async () => ({ selfId: 'me', connected: true, online: 1, players: [] }),
    getChatHistory: async () => [],
    getInventory: async () => ({ version: 2, owned: [], equipped: { race: { name: 'Human' } } }),
    getWallet: async () => ({ coins, items: [], fish: [], gems, actions: [], minerals: [], slotPool: pool }),
    getCoins: async () => coins,
    getDailyState: async () => null,
    getRankingCached: async () => null,
    getUpdateState: async () => null,
    getAchState: async () => null,
    getExtras: async () => null,
    getManifest: async () => null,
    loadPart: async () => null,
    loadExtra: async () => null,
    playSlot: async ({ bet, lines }) => {
      await new Promise((r) => setTimeout(r, 600));
      const sc = SCENARIOS[n++ % SCENARIOS.length];
      const cost = bet * lines;
      if (!sc) return { ok: false, error: '코인이 부족해요. (' + coins + '/' + cost + ')', coins };
      const grid = sc();
      const ev = evalLines(grid, lines, bet);
      let coinsWon = 0, gemsWon = 0, jackpot = 0, parts = 0;
      for (const w of ev.wins) {
        if (w.symbol === '7️⃣' && w.count === 5) { jackpot = Math.floor(pool * Math.min(1, bet / 100)); w.pay = jackpot; pool = Math.max(100000, pool - jackpot); continue; }
        if (w.symbol === '💎') { gemsWon += Math.floor(w.pay / 1000); coinsWon += w.pay % 1000; } else coinsWon += w.pay;
      }
      coinsWon += jackpot;
      if (ev.scatter >= 3) parts = [1, 2, 3][Math.min(ev.scatter, 5) - 3];
      coins = coins - cost + coinsWon; gems += gemsWon; pool += cost * 0.1;
      const miss = coinsWon === 0 && gemsWon === 0 && parts === 0;
      const kind = jackpot ? 'jackpot' : coinsWon >= cost * 30 ? 'big' : gemsWon ? 'gem' : parts ? 'part' : miss ? 'miss' : 'win';
      const labels = ['Hair12', 'IronHelmet', 'Elf 종족 세트'].slice(0, parts);
      return { ok: true, kind, grid, bet, lines, cost, wins: ev.wins, scatter: ev.scatter, parts, coinsWon, gemsWon, jackpot, five: ev.wins.some((w) => w.count === 5), coins, gems, pool: Math.floor(pool), partLabels: labels, free: n % 4 === 0 };
    },
  };
  window.overlay = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
})();
</script>`;

const out = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script src="../../dist/renderer/composer.js"></script>', `${stub}\n    <script src="../packages/client/dist/renderer/composer.js"></script>`)
  .replace('<script src="../../dist/renderer/chat.js"></script>', '<script src="../packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync(path.join(root, 'tools/slot-harness.html'), out, 'utf8');
console.log('tools/slot-harness.html 생성 — node tools/serve.mjs 후 http://localhost:5317/tools/slot-harness.html?panel=slot');

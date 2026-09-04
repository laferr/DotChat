// 🐾 펫 패널 UI 하네스 — chat.html을 ?panel=pet 팝아웃 모드로 브라우저에서 띄우기 위해
// CSP 제거 + window.overlay 스텁(가짜 펫 상태·뽑기 결과, 실제 에셋은 정적 서버에서) 주입본을 tools/pet-harness.html로 생성한다.
// 사용법: node tools/pet-harness.mjs && node tools/serve.mjs  →  http://localhost:5317/tools/pet-harness.html?panel=pet
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/chat.html'), 'utf8');

const stub = `
<script>
(() => {
  const now = Date.now();
  let coins = 5230, gems = 137, food = 4, cards = 3;
  const owned = {
    wildfire: { dup: 1, lv: 2, satiety: 82, tick: now },
    CubicCow: { dup: 5, lv: 1, satiety: 55, tick: now },
    CubicFox: { dup: 0, lv: 1, satiety: 100, tick: now },
    CubicDolphin: { dup: 10, lv: 4, satiety: 20, tick: now },
    'cat-orange': { dup: 0, lv: 1, satiety: 100, tick: now },
  };
  let equip = ['wildfire'];
  let pity4 = 3, pity5 = 47, total = 63;
  let autoFeed = { on: true, pct: 70 };
  const state = () => ({ owned, equip, slots: 1, food, cards, autoFeed, pity4, pity5, total, fridayDiscount: true, fx: { gemHour: 0.6, giftCd: 5 }, coins, gems, now: Date.now() });
  const fetchData = async (rel) => {
    try {
      const r = await fetch('/assets/extras/' + rel);
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    } catch { return null; }
  };
  const api = {
    on: () => {},
    getSelf: async () => ({ nickname: '테스터', tag: '0001', appearance: { race: { name: 'Human' } }, giftIntervalSec: 180 }),
    getSettings: async () => ({ opacity: 100, scale: 2, chatColor: '#d94f63', pinnedMsg: '', pinnedOn: false, tickerOn: true }),
    getNetState: async () => ({ selfId: 'me', connected: true, online: 1, players: [] }),
    getChatHistory: async () => [],
    getInventory: async () => ({ version: 2, owned: [], equipped: { race: { name: 'Human' } } }),
    getWallet: async () => ({ coins, items: [], fish: [], gems, actions: [], minerals: [], petFx: { gemHour: 0.6 }, pet: equip[0] ?? null }),
    getCoins: async () => coins,
    getDailyState: async () => null,
    getRankingCached: async () => null,
    getUpdateState: async () => null,
    getAchState: async () => null,
    getManifest: async () => null,
    loadPart: async () => null,
    getExtras: async () => { try { return await (await fetch('/assets/extras/manifest-extras.json')).json(); } catch { return null; } },
    loadExtra: fetchData,
    petState: async () => state(),
    petGacha: async (n) => {
      const cost = n === 10 ? 40 : 5;
      if (gems < cost) return { ok: false, error: '젬이 부족해요. (' + gems + '/' + cost + ' 💎)' };
      gems -= cost;
      const pool4 = ['CubicBat', 'CubicBull', 'CubicBunny', 'CubicCat', 'CubicCow', 'CubicPanda', 'CubicOwl', 'CubicUnicorn'];
      const results = [];
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        if (r < 0.08 || (n === 10 && i === 9 && !results.some((x) => x.star >= 4))) {
          const id = r < 0.02 ? 'moonwolf' : pool4[Math.floor(Math.random() * pool4.length)];
          const star = id === 'moonwolf' ? 5 : 4;
          const o = owned[id];
          if (!o) { owned[id] = { dup: 0, lv: 1, satiety: 100, tick: Date.now() }; results.push({ star, id, isNew: true, dup: 0 }); }
          else if (o.dup < 10) { o.dup++; results.push({ star, id, dup: o.dup }); }
          else { gems += 3; cards += 1; results.push({ star, id, dup: 10, refund: { gems: 3, cards: 1 } }); }
        } else {
          const item = Math.random() < 0.85 ? 'food' : 'card';
          const cnt = item === 'food' && Math.random() < 0.3 ? 3 : 1;
          if (item === 'food') food += cnt; else cards += cnt;
          results.push({ star: 3, item, n: cnt });
        }
        total++; pity5++; pity4 = results[results.length - 1].star >= 4 ? 0 : pity4 + 1;
      }
      await new Promise((r) => setTimeout(r, 300));
      return { ok: true, count: n, cost, results, state: state() };
    },
    petEquip: async (ids) => { equip = ids.slice(0, 1); return { ok: true, state: state() }; },
    petFeed: async (id) => { if (food < 1) return { ok: false, error: '펫 먹이가 없어요.' }; food--; owned[id].satiety = 100; return { ok: true, state: state() }; },
    petLevel: async (id) => { const need = [1, 2, 4, 8, 16, 32, 64, 128, 256][owned[id].lv - 1]; if (cards < need) return { ok: false, error: '경험치카드가 부족해요.' }; cards -= need; owned[id].lv++; return { ok: true, state: state() }; },
    petAutofeed: async (cfg) => { autoFeed = cfg; return { ok: true, state: state() }; },
    buyPetItem: async (kind, n) => { if (kind === 'food') { coins -= 200 * n; food += n; } else { gems -= n; cards += n; } return { ok: true, state: state() }; },
    exchange: async () => ({ ok: false, error: '하네스' }),
    buyItem: async () => ({ ok: false, error: '하네스' }),
    buyAction: async () => ({ ok: false, error: '하네스' }),
    buyRandom: async () => ({ ok: false, error: '하네스' }),
    togglePopout: () => {},
  };
  window.overlay = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
})();
</script>`;

const out = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script src="../../dist/renderer/composer.js"></script>', `${stub}\n    <script src="../packages/client/dist/renderer/composer.js"></script>`)
  .replace('<script src="../../dist/renderer/chat.js"></script>', '<script src="../packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync(path.join(root, 'tools/pet-harness.html'), out, 'utf8');
console.log('tools/pet-harness.html 생성 — node tools/serve.mjs 후 http://localhost:5317/tools/pet-harness.html?panel=pet');

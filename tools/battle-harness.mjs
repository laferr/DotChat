// 원정 패널 UI 하네스 — chat.html을 ?panel=battle 팝아웃 모드로 브라우저에서 띄우기 위해
// CSP 제거 + window.overlay 스텁(가짜 원정 상태) 주입본을 tools/battle-harness.html로 생성한다.
// 사용법: node tools/battle-harness.mjs && node tools/serve.mjs  →  http://localhost:5317/tools/battle-harness.html?panel=battle
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'packages/client/src/renderer/chat.html'), 'utf8');

const stub = `
<script>
(() => {
  const now = Date.now();
  const lv = { atk: 6, hp: 4, crit: 1, luck: 0, time: 0 };
  const stats = { atk: 24, hp: 168, crit: 6.5, luck: 3.5, dps: 24.78, capMs: 4 * 3600000, bonus: { rodAtkPct: 20, mineralHpPct: 12, fishLuckPct: 3.5, achPct: 7 } };
  let stage = 7, maxStage = 6, gems = 9, coins = 1234, active = true;
  let since = now - 2 * 3600000 - 137000;
  const mobs = { 6: ['🐜', '일개미', 70, 6.4, 'ant-001'], 7: ['🟢', '슬라임', 79, 7.1, 'slime-001'], 8: ['🐀', '들쥐', 88, 7.8, 'rat'] };
  const state = () => {
    const [emoji, name, hp, atk, sprite] = mobs[stage] ?? mobs[7];
    const killMs = Math.max(2000, Math.ceil((hp / stats.dps) * 1000));
    const elapsed = Math.min(Date.now() - since, stats.capMs);
    const kills = Math.floor(elapsed / killMs);
    const next = maxStage + 1;
    return {
      active, stage, effStage: stage, maxStage, lv, costs: { atk: 2, hp: 2, crit: 2, luck: 2, time: 10 }, stats,
      tier: '뒷마당 풀숲', mob: { emoji, name, sprite, hp, atk },
      guardian: { stage: next, emoji: '🐗', name: '멧돼지 대장', sprite: 'pig', hp: 249, atk: 9.9, kind: 'guardian', reward: { coins: next * 5, gems: 0 } },
      killMs, coinPerKill: 0.134, since, now: Date.now(),
      pending: { kills, coins: Math.floor(kills * 0.134), elapsedMs: elapsed, capped: elapsed >= stats.capMs },
      kills: 3120, challengeAt: 0,
      top: [{ name: '봇순이#9999', maxStage: 23 }, { name: '테스터#0001', maxStage: 6 }, { name: '낚시왕#1234', maxStage: 4 }],
      coins, gems,
    };
  };
  const api = {
    on: () => {},
    getSelf: async () => ({ nickname: '테스터', tag: '0001', appearance: { race: { name: 'Human' }, hair: { name: 'Hair1' }, armor: { name: 'TravelerTunic' }, weapon: { name: 'AssaultSword' } }, giftIntervalSec: 180 }),
    getSettings: async () => ({ opacity: 100, scale: 2, chatColor: '#d94f63', pinnedMsg: '', pinnedOn: false, tickerOn: true }),
    getNetState: async () => ({ selfId: 'me', connected: true, online: 1, players: [] }),
    getChatHistory: async () => [],
    getInventory: async () => ({ version: 2, owned: [], equipped: { race: { name: 'Human' } } }),
    getWallet: async () => ({ coins, items: [], fish: [], gems, actions: [], minerals: [] }),
    getCoins: async () => coins,
    getDailyState: async () => null,
    getRankingCached: async () => null,
    getUpdateState: async () => null,
    getAchState: async () => null,
    getExtras: async () => null,
    getManifest: async () => null,
    // 실제 파츠 시트를 정적 서버에서 받아 data URL로 (assets/pixelheroes — gitignore, 로컬에만 있음)
    loadPart: async (layer, name) => {
      try {
        const r = await fetch('/assets/pixelheroes/' + layer + '/' + name + '.png');
        if (!r.ok) return null;
        const blob = await r.blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      } catch { return null; }
    },
    loadExtra: async (rel) => {
      try {
        const r = await fetch('/assets/extras/' + rel);
        if (!r.ok) return null;
        const blob = await r.blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      } catch { return null; }
    },
    battleState: async () => state(),
    battleActive: async (a) => { active = a; if (a) since = Date.now(); return { ok: true, state: state() }; },
    battleClaim: async () => {
      const st = state();
      coins += st.pending.coins; gems += 1; since = Date.now();
      return { ok: true, kills: st.pending.kills, coins: st.pending.coins, gems: 1, elapsedMs: st.pending.elapsedMs, capped: st.pending.capped,
        minerals: [{ id: 'm14', name: '매끈한 돌', count: 5, isNew: false }, { id: 'c12', name: '홍옥 원석', count: 1, isNew: true }], newMinerals: 1, coinsNow: coins, gemsNow: gems, state: state() };
    },
    battleUpgrade: async (key) => { if (gems < 2) return { ok: false, error: '젬이 부족해요. (' + gems + '/2 💎)' }; gems -= 2; lv[key]++; if (key === 'atk') stats.atk += 3; return { ok: true, gemsNow: gems, coinsNow: coins, state: state() }; },
    battleStage: async (s) => { if (s < 1 || s > maxStage + 1) return { ok: false, error: '1층 ~ ' + (maxStage + 1) + '층까지만 갈 수 있어요.' }; stage = s; return { ok: true, state: state() }; },
    battleChallenge: async () => {
      const log = []; let me = stats.hp, foe = 249;
      while (foe > 0 && me > 0) { const crit = Math.random() < 0.065; const dmg = Math.round(stats.atk * (crit ? 1.5 : 1)); foe = Math.max(0, foe - dmg); if (foe <= 0) { log.push([me, 0, dmg, crit ? 1 : 0]); break; } me = Math.max(0, Math.round((me - 9.9) * 10) / 10); log.push([me, foe, dmg, crit ? 1 : 0]); }
      const win = foe <= 0; if (win) { maxStage++; coins += maxStage * 5; if (stage === maxStage) stage = maxStage + 1; }
      return { ok: true, win, stage: maxStage + (win ? 0 : 1), foe: { emoji: '🐗', name: '멧돼지 대장', sprite: 'pig', hp: 249, atk: 9.9 }, log, reward: win ? { coins: maxStage * 5, gems: 0 } : undefined, coinsNow: coins, gemsNow: gems, state: state() };
    },
  };
  window.overlay = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
})();
</script>`;

const out = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<script src="../../dist/renderer/composer.js"></script>', `${stub}\n    <script src="../packages/client/dist/renderer/composer.js"></script>`)
  .replace('<script src="../../dist/renderer/chat.js"></script>', '<script src="../packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync(path.join(root, 'tools/battle-harness.html'), out, 'utf8');
console.log('tools/battle-harness.html 생성 — node tools/serve.mjs 후 http://localhost:5317/tools/battle-harness.html?panel=battle');

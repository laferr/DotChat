import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Server } from 'socket.io';
import {
  ACTION_IDS,
  APP_VERSION,
  Appearance,
  CHAT_HISTORY_MAX,
  CHAT_RETENTION_DAYS,
  ChatMessage,
  COIN_PER_MINUTE,
  COIN_STARTER,
  ENHANCE_MAX,
  ENHANCE_PITY,
  ENHANCE_TABLE,
  ENHANCE_WEEKEND_DROP_MULT,
  enhanceFloor,
  isEnhanceWeekend,
  FISH_BOX_COIN_MAX,
  FISH_BOX_COIN_MIN,
  FISH_BOX_ID,
  FISH_CHEST_COIN_MAX,
  FISH_CHEST_COIN_MIN,
  FISH_CHEST_ID,
  FISH_FIRST_COIN,
  FISH_IDS,
  FISH_IDS_EXTRA,
  FISH_MIN_INTERVAL_MS,
  FISH_REPEAT_COIN,
  FISH_TROPHY_COIN,
  FISHING_PHASES,
  PART_ID_RE,
  PARTS_SYNC_MAX,
  REACTION_COLS,
  REACTION_ROWS,
  RUNNER_COIN_MAX,
  RUNNER_COIN_PER_SEC,
  RUNNER_COOLDOWN_SEC,
  RANDOM_SHOP,
  ROD_DOUBLE_RATE,
  ROD_DOUBLE_STARS,
  ROD_REPEAT_BONUS_STARS,
  SHOP_ITEMS,
  SLOT_COST,
  SlotKind,
  ClientToServerEvents,
  DEFAULT_PORT,
  IMAGE_MAX_BYTES,
  IMAGE_PER_MINUTE,
  IMAGE_RETENTION_DAYS,
  MAX_CHAT_LEN,
  MAX_NICKNAME_LEN,
  PlayerState,
  sanitizeAppearance,
  sanitizePinned,
  ServerToClientEvents,
} from '@dotchat/shared';

const port = Number(process.env.PORT ?? DEFAULT_PORT);

// ---- 이미지 저장소 ----

// 배포 시 볼륨 마운트 경로를 UPLOAD_DIR env로 지정 (예: /data/uploads)
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// ---- 채팅 내역 보관 (이미지와 동일하게 3일, 볼륨에 저장) ----

const HISTORY_PATH = path.join(UPLOAD_DIR, 'chat-history.json');
let chatHistory: ChatMessage[] = [];

function pruneHistory(): void {
  const cutoff = Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  chatHistory = chatHistory.filter((m) => m.ts >= cutoff).slice(-CHAT_HISTORY_MAX);
}

function loadHistory(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (Array.isArray(raw)) chatHistory = raw.filter((m) => m && typeof m.ts === 'number');
    pruneHistory();
    console.log(`[history] ${chatHistory.length}개 채팅 내역 로드`);
  } catch {
    chatHistory = [];
  }
}

function recordChat(msg: ChatMessage): void {
  chatHistory.push(msg);
  pruneHistory();
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(chatHistory), 'utf8');
  } catch (err) {
    console.log('[history] 저장 실패:', String(err));
  }
}

loadHistory();

// ---- 코인 지갑 (닉네임#태그 키, 볼륨 저장, 서버 권위) ----

const COINS_PATH = path.join(UPLOAD_DIR, 'coins.json');

interface Wallet {
  coins: number;
  items: string[];
  /** 낚시 도감 (잡아본 물고기) */
  fish: string[];
  /** 보유 외형 파츠 — 클라이언트가 parts-sync로 등록 (합집합, 클라 기준) */
  parts: string[];
  /** 월척으로 잡아본 물고기 (도감 별표) */
  trophies: string[];
  /** 낚싯대 강화 단계 (0~30성) */
  rodStars?: number;
  /** 현재 성에서의 연속 실패 (천장 카운터) */
  rodFails?: number;
}

let wallets: Record<string, Wallet> = {};

function loadWallets(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(COINS_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          wallets[k] = { coins: Math.max(0, Math.floor(v)), items: [], fish: [], parts: [], trophies: [] }; // 구버전 마이그레이션
        } else if (v && typeof v === 'object') {
          const w = v as { coins?: unknown; items?: unknown; fish?: unknown; parts?: unknown; trophies?: unknown };
          wallets[k] = {
            coins: Math.max(0, Math.floor(Number(w.coins) || 0)),
            items: Array.isArray(w.items) ? w.items.filter((i) => typeof i === 'string') : [],
            fish: Array.isArray(w.fish) ? w.fish.filter((i) => typeof i === 'string') : [],
            parts: Array.isArray(w.parts) ? w.parts.filter((i) => typeof i === 'string') : [],
            trophies: Array.isArray(w.trophies) ? w.trophies.filter((i) => typeof i === 'string') : [],
            rodStars: Math.max(0, Math.min(ENHANCE_MAX, Math.floor(Number((w as any).rodStars) || 0))),
            rodFails: Math.max(0, Math.floor(Number((w as any).rodFails) || 0)),
          };
        }
      }
    }
    console.log(`[coins] ${Object.keys(wallets).length}개 지갑 로드`);
  } catch {
    wallets = {};
  }
}

// 미구매 상점 치장은 외형에서 제거 (조작 방지)
function stripUnownedCosmetics(appearance: Appearance, key: string): Appearance {
  const items = wallets[key]?.items ?? [];
  if (appearance.aura && !items.includes(appearance.aura)) delete appearance.aura;
  if (appearance.bubbleSkin && !items.includes(appearance.bubbleSkin)) delete appearance.bubbleSkin;
  if (
    appearance.nameColor &&
    !SHOP_ITEMS.some((i) => i.kind === 'namecolor' && i.value === appearance.nameColor && items.includes(i.id))
  ) {
    delete appearance.nameColor;
  }
  return appearance;
}

function saveWallets(): void {
  try {
    fs.writeFileSync(COINS_PATH, JSON.stringify(wallets), 'utf8');
  } catch (err) {
    console.log('[coins] 저장 실패:', String(err));
  }
}

function walletKey(p: PlayerState): string {
  return `${p.nickname}#${p.tag}`;
}

loadWallets();

// 접속 1분당 코인 적립 (같은 지갑 다중 접속은 1회만)
setInterval(() => {
  if (players.size === 0) return;
  const credited = new Set<string>();
  for (const [socketId, player] of players) {
    const key = walletKey(player);
    if (!credited.has(key)) {
      credited.add(key);
      wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] };
      wallets[key].coins += COIN_PER_MINUTE;
    }
    io.sockets.sockets.get(socketId)?.emit('coins', wallets[key].coins);
  }
  saveWallets();
}, 60 * 1000);

// 슬롯 확률 테이블 (누적 %) — 기대환급 ~2.9코인 + 6% 파츠
const SLOT_TABLE: { upto: number; kind: SlotKind; delta: number; reels: string[] | null }[] = [
  { upto: 41, kind: 'miss', delta: 0, reels: null },
  { upto: 61, kind: 'small', delta: 1, reels: null },
  { upto: 76, kind: 'back', delta: 3, reels: ['🍒', '🍒', '🍒'] },
  { upto: 86, kind: 'double', delta: 6, reels: ['🍋', '🍋', '🍋'] },
  { upto: 91, kind: 'triple', delta: 9, reels: ['⭐', '⭐', '⭐'] },
  { upto: 96, kind: 'part', delta: 0, reels: ['🎁', '🎁', '🎁'] },
  { upto: 99, kind: 'jackpot', delta: 20, reels: ['💎', '💎', '💎'] },
  { upto: 100, kind: 'mega', delta: 60, reels: ['7️⃣', '7️⃣', '7️⃣'] },
];
const SLOT_SYMBOLS = ['🍒', '🍋', '⭐', '🎁', '💎', '7️⃣'];
const lastSlotAt = new Map<string, number>();

function slotReels(kind: SlotKind): string[] {
  const fixed = SLOT_TABLE.find((r) => r.kind === kind)?.reels;
  if (fixed) return fixed;
  if (kind === 'small') {
    // 체리 2개 + 다른 심볼
    const other = SLOT_SYMBOLS[1 + Math.floor(Math.random() * (SLOT_SYMBOLS.length - 1))];
    return ['🍒', '🍒', other];
  }
  // 꽝: 트리플/체리2가 안 나오게 셔플
  for (;;) {
    const reels = Array.from({ length: 3 }, () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
    const triple = reels[0] === reels[1] && reels[1] === reels[2];
    const cherryPair = reels.filter((s) => s === '🍒').length >= 2;
    if (!triple && !cherryPair) return reels;
  }
}

function cleanupUploads(): void {
  const cutoff = Date.now() - IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    const filePath = path.join(UPLOAD_DIR, file);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    } catch {
      /* 이미 삭제됨 */
    }
  }
  if (removed > 0) console.log(`[cleanup] 보존기간(${IMAGE_RETENTION_DAYS}일) 지난 이미지 ${removed}개 삭제`);
}
cleanupUploads();
setInterval(cleanupUploads, 60 * 60 * 1000);

// GET /i/<파일명> 으로 원본 이미지 서빙
const httpServer = http.createServer((req, res) => {
  const match = /^\/i\/([a-f0-9]{16}\.(?:jpg|png|webp))$/.exec(req.url ?? '');
  if (req.method === 'GET' && match) {
    fs.readFile(path.join(UPLOAD_DIR, match[1]), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': EXT_MIME[match[1].split('.')[1]],
        'Cache-Control': 'public, max-age=259200',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2_000_000, // 이미지 페이로드(≤1.5MB) 허용
});
httpServer.listen(port);

// 유효 어획물 전체 (구 스트립 + 새 단일 이미지)
const ALL_FISH_IDS = new Set<string>([...FISH_IDS, ...FISH_IDS_EXTRA]);

const players = new Map<string, PlayerState>();
const lastChatAt = new Map<string, number>();
const imageTimes = new Map<string, number[]>();
const lastFishAt = new Map<string, number>();
const lastRunnerAt = new Map<string, number>(); // 지갑 키 기준 (러너 쿨타임)
const lastPinnedAt = new Map<string, number>();
const lastRandomBuyAt = new Map<string, number>();
const lastEnhanceAt = new Map<string, number>();

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

io.on('connection', (socket) => {
  socket.on('hello', (data) => {
    if (players.has(socket.id)) return;
    const nickname =
      String(data?.nickname ?? '')
        .trim()
        .slice(0, MAX_NICKNAME_LEN) || `user-${socket.id.slice(0, 4)}`;
    const tag = /^\d{4}$/.test(String(data?.tag ?? '')) ? String(data.tag) : '0000';
    const appearance = sanitizeAppearance(data?.appearance) ?? { race: { name: 'Human' } };
    const player: PlayerState = {
      id: socket.id,
      nickname,
      tag,
      appearance,
      x: clamp01(0.1 + Math.random() * 0.8),
      dir: 1,
      walking: true,
      lastReadTs: 0, // 채팅창을 열어 읽기 전까지는 안읽음으로 집계
      pinned: sanitizePinned(data?.pinned),
    };
    // 신규 지갑(기존 유저의 첫 업데이트 접속 포함)에 기본 코인 지급
    const key = walletKey(player);
    if (!(key in wallets)) {
      wallets[key] = { coins: COIN_STARTER, items: [], fish: [], parts: [], trophies: [] };
      saveWallets();
      console.log(`[coins] ${key} 신규 지갑 +${COIN_STARTER}`);
    }
    stripUnownedCosmetics(player.appearance, key);
    players.set(socket.id, player);
    socket.emit('welcome', {
      selfId: socket.id,
      players: [...players.values()],
      serverVersion: APP_VERSION,
    });
    socket.emit('wallet', {
      coins: wallets[key].coins,
      items: [...wallets[key].items],
      fish: [...wallets[key].fish],
      trophies: [...(wallets[key].trophies ?? [])],
      rodStars: wallets[key].rodStars ?? 0,
      rodFails: wallets[key].rodFails ?? 0,
    });
    socket.emit('chat-history', chatHistory.slice(-100));
    socket.broadcast.emit('player-joined', player);
    console.log(`+ ${nickname}#${tag} [${appearance.race.name}] — ${players.size}명 접속중`);
  });

  socket.on('move', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    player.x = clamp01(Number(data?.x));
    player.dir = data?.dir === -1 ? -1 : 1;
    player.walking = Boolean(data?.walking);
    socket.broadcast.volatile.emit('player-moved', {
      id: socket.id,
      x: player.x,
      dir: player.dir,
      walking: player.walking,
    });
  });

  socket.on('action', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    const action = String(data?.action ?? '');
    if (!(ACTION_IDS as readonly string[]).includes(action)) return;
    const now = Date.now();
    if (now - (lastChatAt.get(socket.id) ?? 0) < 300) return; // 도배 방지 공유
    lastChatAt.set(socket.id, now);
    const text = String(data?.text ?? '')
      .trim()
      .slice(0, MAX_CHAT_LEN);
    const msg: ChatMessage = {
      id: socket.id,
      nickname: player.nickname,
      tag: player.tag,
      text,
      ts: now,
      action: action as (typeof ACTION_IDS)[number],
      senderAppearance: player.appearance,
    };
    io.emit('chat', msg);
    recordChat(msg);
    console.log(`[action] ${player.nickname}#${player.tag}: ${action} "${text}"`);
  });

  socket.on('slot', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastSlotAt.get(socket.id) ?? 0) < 1000) {
      reply({ ok: false, error: '너무 빨라요!' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.coins < SLOT_COST) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${SLOT_COST})` });
      return;
    }
    lastSlotAt.set(socket.id, now);
    const roll = Math.random() * 100;
    const row = SLOT_TABLE.find((r) => roll < r.upto)!;
    wallet.coins = wallet.coins - SLOT_COST + row.delta;
    saveWallets();
    reply({
      ok: true,
      kind: row.kind,
      delta: row.delta,
      reels: slotReels(row.kind),
      coins: wallet.coins,
    });
    if (row.kind === 'part' || row.kind === 'jackpot' || row.kind === 'mega') {
      io.emit('slot-win', {
        id: socket.id,
        nickname: player.nickname,
        tag: player.tag,
        kind: row.kind,
        delta: row.delta,
      });
      console.log(`[slot] ${key}: ${row.kind} (+${row.delta}) 잔액 ${wallet.coins}`);
    }
  });

  socket.on('buy', (itemId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const item = SHOP_ITEMS.find((i) => i.id === String(itemId));
    if (!item) {
      reply({ ok: false, error: '없는 상품이에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.items.includes(item.id)) {
      reply({ ok: false, error: '이미 보유한 상품이에요.', coins: wallet.coins, items: [...wallet.items] });
      return;
    }
    if (wallet.coins < item.price) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${item.price})`, coins: wallet.coins });
      return;
    }
    wallet.coins -= item.price;
    wallet.items.push(item.id);
    saveWallets();
    reply({ ok: true, coins: wallet.coins, items: [...wallet.items] });
    console.log(`[shop] ${key}: ${item.id} 구매 (-${item.price}) 잔액 ${wallet.coins}`);
  });

  // ---- 낚시 ----

  socket.on('fishing-state', (data) => {
    const player = players.get(socket.id);
    const phase = String(data?.phase ?? '');
    if (!player || !(FISHING_PHASES as readonly string[]).includes(phase)) return;
    const fishId = typeof data?.fishId === 'string' ? data.fishId.slice(0, 32) : undefined;
    // 낚싯대 강화 글로우는 서버 지갑 기준 (클라 신고값 무시 — 과시 연출 조작 방지)
    const rodStars = wallets[walletKey(player)]?.rodStars ?? 0;
    socket.broadcast.emit('player-fishing', {
      id: socket.id,
      phase: phase as (typeof FISHING_PHASES)[number],
      fishId,
      trophy: data?.trophy === true || undefined,
      rod: rodStars > 0 ? rodStars : undefined,
    });
  });

  // (fishId, ack) 구버전과 (fishId, trophy, ack) 신버전 인자를 모두 수용
  socket.on('fish', (fishId, trophyOrAck, maybeAck) => {
    const trophyArg = trophyOrAck === true;
    const ack = typeof trophyOrAck === 'function' ? trophyOrAck : maybeAck;
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const id = String(fishId);
    if (!ALL_FISH_IDS.has(id)) {
      reply({ ok: false, error: '알 수 없는 물고기예요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastFishAt.get(socket.id) ?? 0) < FISH_MIN_INTERVAL_MS) {
      reply({ ok: false, error: '낚시가 너무 빨라요.' });
      return;
    }
    lastFishAt.set(socket.id, now);
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    const isNew = !wallet.fish.includes(id);
    if (isNew) wallet.fish.push(id);

    // 특수 어획물: 상자(코인), 보물상자(코인 or 미보유 상점 아이템)
    let delta: number;
    let itemGrant: { id: string; name: string } | null = null;
    let doubled = false;
    const isTrophy = trophyArg && id !== FISH_BOX_ID && id !== FISH_CHEST_ID;
    if (id === FISH_BOX_ID) {
      delta = FISH_BOX_COIN_MIN + Math.floor(Math.random() * (FISH_BOX_COIN_MAX - FISH_BOX_COIN_MIN + 1));
    } else if (id === FISH_CHEST_ID) {
      const unowned = SHOP_ITEMS.filter((i) => !wallet.items.includes(i.id));
      if (unowned.length > 0 && Math.random() < 0.5) {
        const won = unowned[Math.floor(Math.random() * unowned.length)];
        wallet.items.push(won.id);
        itemGrant = { id: won.id, name: won.name };
        delta = 0;
      } else {
        delta = FISH_CHEST_COIN_MIN + Math.floor(Math.random() * (FISH_CHEST_COIN_MAX - FISH_CHEST_COIN_MIN + 1));
      }
    } else {
      delta = isNew ? FISH_FIRST_COIN : FISH_REPEAT_COIN;
      // 낚싯대 강화 보너스: 10성+ 반복 어획 +1, 20성+ 더블 캐치(코인 2배)
      const rod = wallet.rodStars ?? 0;
      if (!isNew && rod >= ROD_REPEAT_BONUS_STARS) delta += 1;
      if (isTrophy) delta += FISH_TROPHY_COIN; // 월척 보너스
      if (rod >= ROD_DOUBLE_STARS && Math.random() * 100 < ROD_DOUBLE_RATE) {
        delta *= 2;
        doubled = true;
      }
    }
    wallet.trophies = wallet.trophies ?? [];
    if (isTrophy && !wallet.trophies.includes(id)) wallet.trophies.push(id);
    wallet.coins += delta;
    saveWallets();
    reply({
      ok: true,
      isNew,
      delta,
      coins: wallet.coins,
      ...(isTrophy ? { trophy: true } : {}),
      ...(doubled ? { doubled: true } : {}),
      ...(itemGrant ? { item: itemGrant, items: [...wallet.items] } : {}),
    });
    if (id === FISH_BOX_ID || id === FISH_CHEST_ID) {
      console.log(`[fish] ${key}: ${id} 개봉 → ${itemGrant ? `아이템 '${itemGrant.name}'` : `+${delta}코인`}`);
    } else if (isTrophy) {
      console.log(`[fish] ${key}: ${id} 🌟월척! (+${delta}) 별 ${wallet.trophies.length}종`);
    } else if (isNew) {
      console.log(`[fish] ${key}: ${id} 최초 획득 (+${delta}) 도감 ${wallet.fish.length}/${ALL_FISH_IDS.size}`);
    }
  });

  // ---- 낚싯대 강화 (스타포스식 — 판정·저장 서버 권위) ----

  socket.on('enhance', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastEnhanceAt.get(socket.id) ?? 0) < 500) {
      reply({ ok: false, error: '너무 빨라요!' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    const stars = wallet.rodStars ?? 0;
    if (stars >= ENHANCE_MAX) {
      reply({ ok: false, error: '이미 최대 강화(30성)예요!' });
      return;
    }
    const stage = ENHANCE_TABLE[stars];
    if (wallet.coins < stage.cost) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${stage.cost})`, coins: wallet.coins });
      return;
    }
    lastEnhanceAt.set(socket.id, now);
    wallet.coins -= stage.cost;

    let result: 'success' | 'keep' | 'drop';
    let guaranteed = false;
    if ((wallet.rodFails ?? 0) >= ENHANCE_PITY) {
      result = 'success'; // 천장: 연속 실패 누적 → 보장 성공
      guaranteed = true;
    } else {
      const dropPct = stage.drop * (isEnhanceWeekend(now) ? ENHANCE_WEEKEND_DROP_MULT : 1);
      const roll = Math.random() * 100;
      result = roll < stage.succ ? 'success' : roll < stage.succ + dropPct ? 'drop' : 'keep';
    }
    if (result === 'success') {
      wallet.rodStars = stars + 1;
      wallet.rodFails = 0;
    } else if (result === 'drop') {
      wallet.rodStars = Math.max(enhanceFloor(stars), stars - 1);
      wallet.rodFails = 0; // 성이 바뀌었으니 천장 카운터 리셋
    } else {
      wallet.rodFails = (wallet.rodFails ?? 0) + 1;
    }
    saveWallets();
    reply({
      ok: true,
      result,
      stars: wallet.rodStars,
      fails: wallet.rodFails,
      guaranteed,
      coins: wallet.coins,
    });
    // 20성 이상 도달 성공 / 20성 이상에서 하락 → 전체 알림
    if ((result === 'success' && (wallet.rodStars ?? 0) >= 20) || (result === 'drop' && stars >= 20)) {
      io.emit('enhance-news', {
        id: socket.id,
        nickname: player.nickname,
        tag: player.tag,
        stars: wallet.rodStars ?? 0,
        result: result === 'success' ? 'success' : 'drop',
      });
    }
    console.log(
      `[enhance] ${key}: ${stars}성 → ${result}${guaranteed ? '(천장)' : ''} (현재 ${wallet.rodStars}성, -${stage.cost}) 잔액 ${wallet.coins}`,
    );
  });

  // ---- 미보유 랜덤 파츠 뽑기 (결제만 서버, 지급은 클라이언트 로컬 풀) ----

  socket.on('buy-random', (itemId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const def = RANDOM_SHOP.find((i) => i.id === String(itemId));
    if (!def) {
      reply({ ok: false, error: '없는 상품이에요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastRandomBuyAt.get(socket.id) ?? 0) < 500) {
      reply({ ok: false, error: '너무 빨라요!' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.coins < def.price) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${def.price})`, coins: wallet.coins });
      return;
    }
    lastRandomBuyAt.set(socket.id, now);
    wallet.coins -= def.price;
    saveWallets();
    reply({ ok: true, coins: wallet.coins });
    console.log(`[shop] ${key}: ${def.id} 뽑기 (-${def.price}) 잔액 ${wallet.coins}`);
  });

  // ---- 보유 파츠 동기화 (클라 기준 합집합 — 다른 PC에서도 수집품 이어받기) ----

  socket.on('parts-sync', (parts, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    wallet.parts = wallet.parts ?? [];
    if (Array.isArray(parts)) {
      let added = 0;
      const have = new Set(wallet.parts);
      for (const raw of parts) {
        if (wallet.parts.length >= PARTS_SYNC_MAX) break;
        if (typeof raw !== 'string' || raw.length > 64 || !PART_ID_RE.test(raw) || have.has(raw)) continue;
        have.add(raw);
        wallet.parts.push(raw);
        added++;
      }
      if (added > 0) {
        saveWallets();
        console.log(`[parts] ${key}: ${added}개 등록 (총 ${wallet.parts.length})`);
      }
    }
    reply({ ok: true, parts: [...wallet.parts] });
  });

  // ---- 러너 ----

  socket.on('runner-score', (seconds, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const now = Date.now();
    if (now - (lastRunnerAt.get(key) ?? 0) < (RUNNER_COOLDOWN_SEC - 30) * 1000) {
      reply({ ok: false, error: '아직 쿨타임이에요.' });
      return;
    }
    lastRunnerAt.set(key, now);
    const secs = Math.max(0, Math.min(600, Number(seconds) || 0));
    const delta = Math.min(RUNNER_COIN_MAX, Math.floor(secs * RUNNER_COIN_PER_SEC));
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    wallet.coins += delta;
    saveWallets();
    reply({ ok: true, delta, coins: wallet.coins });
    console.log(`[runner] ${key}: ${secs.toFixed(1)}초 (+${delta})`);
  });

  // ---- 리액션 이모지 ----

  socket.on('reaction', (index) => {
    const player = players.get(socket.id);
    const idx = Math.floor(Number(index));
    if (!player || !Number.isFinite(idx) || idx < 0 || idx >= REACTION_COLS * REACTION_ROWS) return;
    const now = Date.now();
    if (now - (lastChatAt.get(socket.id) ?? 0) < 300) return;
    lastChatAt.set(socket.id, now);
    const msg: ChatMessage = {
      id: socket.id,
      nickname: player.nickname,
      tag: player.tag,
      text: '',
      ts: now,
      reaction: idx,
      senderAppearance: player.appearance,
    };
    io.emit('chat', msg);
    recordChat(msg);
  });

  socket.on('ranking', (ack) => {
    if (typeof ack !== 'function') return;
    const rows = Object.entries(wallets)
      .map(([name, w]) => ({ name, coins: w.coins }))
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 5);
    ack(rows);
  });

  socket.on('read', (ts) => {
    const player = players.get(socket.id);
    if (!player) return;
    const clamped = Math.min(Number(ts) || 0, Date.now());
    if (clamped <= player.lastReadTs) return;
    player.lastReadTs = clamped;
    io.emit('player-read', { id: socket.id, ts: clamped });
  });

  socket.on('appearance', (raw) => {
    const player = players.get(socket.id);
    const appearance = sanitizeAppearance(raw);
    if (!player || !appearance) return;
    stripUnownedCosmetics(appearance, walletKey(player));
    player.appearance = appearance;
    socket.broadcast.emit('player-appearance', { id: socket.id, appearance });
    console.log(`[appearance] ${player.nickname} → ${appearance.race.name}`);
  });

  socket.on('pinned', (raw) => {
    const player = players.get(socket.id);
    if (!player) return;
    const now = Date.now();
    if (now - (lastPinnedAt.get(socket.id) ?? 0) < 500) return; // 도배 방지
    const text = sanitizePinned(raw);
    if (text === (player.pinned ?? '')) return;
    lastPinnedAt.set(socket.id, now);
    player.pinned = text;
    socket.broadcast.emit('player-pinned', { id: socket.id, text });
    console.log(`[pinned] ${player.nickname}#${player.tag}: ${text || '(해제)'}`);
  });

  socket.on('chat', (text) => {
    const player = players.get(socket.id);
    if (!player || typeof text !== 'string') return;
    const now = Date.now();
    if (now - (lastChatAt.get(socket.id) ?? 0) < 300) return; // 도배 방지 최소 간격
    const clean = text.trim().slice(0, MAX_CHAT_LEN);
    if (!clean) return;
    lastChatAt.set(socket.id, now);
    const msg: ChatMessage = {
      id: socket.id,
      nickname: player.nickname,
      tag: player.tag,
      text: clean,
      ts: now,
      senderAppearance: player.appearance,
    };
    io.emit('chat', msg);
    recordChat(msg);
    console.log(`[chat] ${player.nickname}#${player.tag}: ${clean}`);
  });

  socket.on('image', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const now = Date.now();
    const times = (imageTimes.get(socket.id) ?? []).filter((t) => now - t < 60_000);
    imageTimes.set(socket.id, times);
    if (times.length >= IMAGE_PER_MINUTE) {
      reply({ ok: false, error: `이미지는 분당 ${IMAGE_PER_MINUTE}개까지만 보낼 수 있어요.` });
      return;
    }
    const rawData = payload?.data as unknown;
    const buf = Buffer.isBuffer(rawData)
      ? rawData
      : rawData instanceof ArrayBuffer
        ? Buffer.from(rawData)
        : null;
    if (!buf || buf.length === 0 || buf.length > IMAGE_MAX_BYTES) {
      reply({ ok: false, error: '이미지 용량이 허용치를 넘었어요.' });
      return;
    }
    const ext = MIME_EXT[String(payload?.mime)];
    if (!ext) {
      reply({ ok: false, error: '지원하지 않는 이미지 형식이에요.' });
      return;
    }
    const thumb = String(payload?.thumb ?? '');
    if (!thumb.startsWith('data:image/') || thumb.length > 60_000) {
      reply({ ok: false, error: '썸네일이 올바르지 않아요.' });
      return;
    }
    const w = Math.max(0, Math.floor(Number(payload?.w)) || 0);
    const h = Math.max(0, Math.floor(Number(payload?.h)) || 0);
    const name = `${randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    times.push(now);
    const msg: ChatMessage = {
      id: socket.id,
      nickname: player.nickname,
      tag: player.tag,
      text: '',
      ts: now,
      image: { url: `/i/${name}`, thumb, w, h },
      senderAppearance: player.appearance,
    };
    io.emit('chat', msg);
    recordChat(msg);
    console.log(`[image] ${player.nickname}#${player.tag} → ${name} (${Math.round(buf.length / 1024)}KB)`);
    reply({ ok: true });
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      players.delete(socket.id);
      lastChatAt.delete(socket.id);
      imageTimes.delete(socket.id);
      lastSlotAt.delete(socket.id);
      lastFishAt.delete(socket.id);
      lastPinnedAt.delete(socket.id);
      lastRandomBuyAt.delete(socket.id);
      lastEnhanceAt.delete(socket.id);
      socket.broadcast.emit('player-fishing', { id: socket.id, phase: 'stop' });
      io.emit('player-left', socket.id);
      console.log(`- ${player.nickname} — ${players.size}명 접속중`);
    }
  });
});

console.log(`DotChat server v${APP_VERSION} listening on :${port}`);

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Server } from 'socket.io';
import {
  ACTION_IDS,
  CHAT_HISTORY_MAX,
  CHAT_RETENTION_DAYS,
  ChatMessage,
  COIN_PER_MINUTE,
  COIN_STARTER,
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
let wallets: Record<string, number> = {};

function loadWallets(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(COINS_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number' && Number.isFinite(v)) wallets[k] = Math.max(0, Math.floor(v));
      }
    }
    console.log(`[coins] ${Object.keys(wallets).length}개 지갑 로드`);
  } catch {
    wallets = {};
  }
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
      wallets[key] = (wallets[key] ?? 0) + COIN_PER_MINUTE;
    }
    io.sockets.sockets.get(socketId)?.emit('coins', wallets[key]);
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

const players = new Map<string, PlayerState>();
const lastChatAt = new Map<string, number>();
const imageTimes = new Map<string, number[]>();

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
    };
    players.set(socket.id, player);
    // 신규 지갑(기존 유저의 첫 업데이트 접속 포함)에 기본 코인 지급
    const key = walletKey(player);
    if (!(key in wallets)) {
      wallets[key] = COIN_STARTER;
      saveWallets();
      console.log(`[coins] ${key} 신규 지갑 +${COIN_STARTER}`);
    }
    socket.emit('welcome', { selfId: socket.id, players: [...players.values()] });
    socket.emit('coins', wallets[key]);
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
    const balance = wallets[key] ?? 0;
    if (balance < SLOT_COST) {
      reply({ ok: false, error: `코인이 부족해요. (${balance}/${SLOT_COST})` });
      return;
    }
    lastSlotAt.set(socket.id, now);
    const roll = Math.random() * 100;
    const row = SLOT_TABLE.find((r) => roll < r.upto)!;
    wallets[key] = balance - SLOT_COST + row.delta;
    saveWallets();
    reply({
      ok: true,
      kind: row.kind,
      delta: row.delta,
      reels: slotReels(row.kind),
      coins: wallets[key],
    });
    if (row.kind === 'part' || row.kind === 'jackpot' || row.kind === 'mega') {
      io.emit('slot-win', {
        id: socket.id,
        nickname: player.nickname,
        tag: player.tag,
        kind: row.kind,
        delta: row.delta,
      });
      console.log(`[slot] ${key}: ${row.kind} (+${row.delta}) 잔액 ${wallets[key]}`);
    }
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
    player.appearance = appearance;
    socket.broadcast.emit('player-appearance', { id: socket.id, appearance });
    console.log(`[appearance] ${player.nickname} → ${appearance.race.name}`);
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
      io.emit('player-left', socket.id);
      console.log(`- ${player.nickname} — ${players.size}명 접속중`);
    }
  });
});

console.log(`DotChat server listening on :${port}`);

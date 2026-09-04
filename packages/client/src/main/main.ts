import { app, BrowserWindow, globalShortcut, Menu, Tray, ipcMain, nativeImage, screen, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';
import {
  ActionId,
  Appearance,
  AppearanceSlot,
  APPEARANCE_SLOTS,
  ChatMessage,
  ClientToServerEvents,
  DEFAULT_PORT,
  MAX_NICKNAME_LEN,
  MovePayload,
  PartChoice,
  PlayerState,
  RANDOM_SHOP,
  sanitizeAppearance,
  sanitizePinned,
  ServerToClientEvents,
  SHOP_ITEMS,
} from '@dotchat/shared';

// 개발 모드는 설치판과 싱글 인스턴스 락이 충돌하지 않도록 별도 userData 사용
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'DotChatDev'));
}

// 오버레이 창 높이 — 캐릭터 + 말풍선이 들어갈 공간
const OVERLAY_HEIGHT = 260;
const CHAT_SIZE = { width: 340, height: 480 };
// 선물상자 스폰 주기 (기본 3분, 테스트용으로 env 오버라이드 가능)
const GIFT_INTERVAL_SEC = Math.max(5, Number(process.env.DOTCHAT_GIFT_SEC ?? 180));

// PixelHeroes 파츠 에셋 (tools/import-pixelheroes.mjs로 임포트, 패키징 시 리소스 동봉)
const ASSETS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'pixelheroes')
  : path.join(__dirname, '..', '..', '..', '..', 'assets', 'pixelheroes');

// 미니게임/리액션 에셋 (tools/import-extras.mjs)
const EXTRAS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'extras')
  : path.join(__dirname, '..', '..', '..', '..', 'assets', 'extras');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const RENDERER_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');

let overlayWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
let tickerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ---- 에셋 매니페스트 ----

interface Manifest {
  cell: number;
  layers: Record<string, string[]>;
  races: { name: string; ears: boolean }[];
}

function loadManifest(): Manifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

const manifest = loadManifest();
if (!manifest) {
  console.error(`[main] 파츠 에셋 없음: ${ASSETS_DIR} — tools/import-pixelheroes.mjs 실행 필요`);
}

// 슬롯 → 시트 레이어 매핑 (eyes/ears는 종족명 시트 사용)
const SLOT_LAYER: Record<AppearanceSlot, string> = {
  eyes: 'Eyes',
  ears: 'Ears',
  hair: 'Hair',
  armor: 'Armor',
  helmet: 'Helmet',
  weapon: 'Weapon',
  shield: 'Shield',
  mask: 'Mask',
  back: 'Back',
  cape: 'Cape',
  horns: 'Horns',
};
// 선물상자에서 개별 드랍되는 레이어 (종족 관련 시트는 세트로만)
const GIFT_LAYERS = ['Hair', 'Armor', 'Helmet', 'Weapon', 'Shield', 'Mask', 'Back', 'Cape', 'Horns'];

// ---- 인벤토리 v2 (종족 세트 = "race:이름", 개별 파츠 = "레이어/이름") ----

interface Inventory {
  version: 2;
  owned: string[];
  equipped: Appearance;
}

const DATA_DIR = path.join(app.getPath('appData'), 'DotChat');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory.json');

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function starterInventory(): Inventory {
  // 첫 로그인: Human 종족 세트 + 랜덤 머리카락 + 기본 갑옷(TravelerTunic)
  const hair = manifest ? randomOf(manifest.layers.Hair) : 'Hair1';
  return {
    version: 2,
    owned: ['race:Human', `Hair/${hair}`, 'Armor/TravelerTunic'],
    equipped: {
      race: { name: 'Human' },
      hair: { name: hair },
      armor: { name: 'TravelerTunic' },
    },
  };
}

function loadInventory(): Inventory | null {
  try {
    const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
    if (raw.version !== 2) return null; // 구버전(sprite_split 시절)은 새로 시작
    const owned = Array.isArray(raw.owned)
      ? raw.owned.filter((n: unknown) => typeof n === 'string')
      : [];
    const equipped = sanitizeAppearance(raw.equipped);
    if (owned.length === 0 || !equipped) return null;
    return { version: 2, owned, equipped };
  } catch {
    return null;
  }
}

function saveInventory(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2), 'utf8');
}

const loadedInventory = loadInventory();
const inventory: Inventory = loadedInventory ?? starterInventory();
if (!loadedInventory) saveInventory();

function ownsRace(name: string): boolean {
  return inventory.owned.includes(`race:${name}`);
}

// ---- 프로필 (닉네임#고유번호 — 사용자 구분 키) ----

interface Profile {
  nickname: string;
  tag: string;
}

const PROFILE_PATH = path.join(DATA_DIR, 'profile.json');

function loadProfile(): Profile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    const nickname = String(raw.nickname ?? '')
      .trim()
      .slice(0, MAX_NICKNAME_LEN);
    const tag = String(raw.tag ?? '');
    if (!nickname || !/^\d{4}$/.test(tag)) return null;
    return { nickname, tag };
  } catch {
    return null;
  }
}

let profile = loadProfile();

// ---- 설정 (투명도 / 표시 배율 / 고정메시지 / 서버 주소) ----

interface Settings {
  /** 오버레이 콘텐츠 투명도 0.1~1.0 */
  opacity: number;
  /** 표시 배율 1|2|3 */
  scale: number;
  /** 채팅창 테마 색상 (#rrggbb) */
  chatColor: string;
  /** 머리 위 고정메시지 내용 */
  pinnedMsg: string;
  /** 고정메시지 표시 여부 */
  pinnedOn: boolean;
  /** 상단 전광판 표시 여부 (기본 켜짐) */
  tickerOn: boolean;
  /** 오버레이를 띄울 디스플레이 (Electron display id, 없거나 분리되면 주 모니터) */
  displayId?: number;
  serverUrl?: string;
}

const DEFAULT_CHAT_COLOR = '#d94f63';

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const opacity = Number(raw.opacity);
    const scale = Number(raw.scale);
    return {
      opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.1, opacity)) : 1,
      scale: [1, 2, 3].includes(scale) ? scale : 2, // 기본 2배
      chatColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.chatColor)) ? raw.chatColor : DEFAULT_CHAT_COLOR,
      pinnedMsg: sanitizePinned(raw.pinnedMsg),
      pinnedOn: raw.pinnedOn === true,
      tickerOn: raw.tickerOn !== false, // 기본 켜짐
      displayId: Number.isFinite(Number(raw.displayId)) ? Number(raw.displayId) : undefined,
      serverUrl: typeof raw.serverUrl === 'string' && raw.serverUrl ? raw.serverUrl : undefined,
    };
  } catch {
    return { opacity: 1, scale: 2, chatColor: DEFAULT_CHAT_COLOR, pinnedMsg: '', pinnedOn: false, tickerOn: true };
  }
}

const settings = loadSettings();

function saveSettings(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

/** 실제로 남에게 보이는 고정메시지 (표시 꺼져 있으면 해제와 동일) */
function effectivePinned(): string {
  return settings.pinnedOn ? settings.pinnedMsg : '';
}

// 패키징 앱은 공식 서버, 개발 모드는 로컬 서버가 기본
const PUBLIC_SERVER = 'https://dotchat-production-e868.up.railway.app';
const SERVER_URL =
  process.env.DOTCHAT_SERVER ??
  settings.serverUrl ??
  (app.isPackaged ? PUBLIC_SERVER : `http://localhost:${DEFAULT_PORT}`);

// ---- 네트워크 (소켓은 메인 프로세스가 소유, 렌더러에는 IPC로 중계) ----

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let selfId: string | null = null;
let unreadCount = 0;
let lastRanking: unknown = null;
let lastDaily: unknown = null;
const players = new Map<string, PlayerState>();
const chatLog: ChatMessage[] = [];

function broadcast(channel: string, payload?: unknown): void {
  for (const win of [overlayWindow, chatWindow, fishdexWindow, tickerWindow, ...popoutWindows.values()]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function sendStatus(): void {
  broadcast('net:status', { connected: socket?.connected ?? false, online: players.size });
}

function connect(): void {
  socket = io(SERVER_URL, { reconnectionDelayMax: 5000 });

  socket.on('connect', () => {
    console.log('[net] connected to', SERVER_URL);
    if (profile) {
      socket!.emit('hello', {
        nickname: profile.nickname,
        tag: profile.tag,
        appearance: inventory.equipped,
        pinned: effectivePinned(),
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('[net] disconnected');
    selfId = null;
    players.clear();
    broadcast('net:reset');
    sendStatus();
  });

  socket.on('welcome', (data) => {
    selfId = data.selfId;
    players.clear();
    for (const p of data.players) players.set(p.id, p);
    myBattleActive = data.players.find((p) => p.id === selfId)?.battle === true;
    broadcast('net:welcome', { selfId, players: [...players.values()] });
    sendStatus();
    console.log(`[net] welcome as ${selfId}, ${players.size}명 접속중`);
    // 서버-클라이언트 버전 불일치 → 즉시 업데이트 확인 + 벨 힌트
    if (data.serverVersion && data.serverVersion !== app.getVersion()) {
      console.log(`[update] 버전 불일치: client ${app.getVersion()} vs server ${data.serverVersion}`);
      versionHint = data.serverVersion;
      broadcast('self:update-hint', { version: data.serverVersion });
      updateCheckNow?.();
    }
    // 보유 파츠를 서버 지갑과 동기화 (클라 목록 등록 + 서버 목록 내려받기)
    syncParts();
  });

  socket.on('player-joined', (player) => {
    players.set(player.id, player);
    broadcast('net:player-joined', player);
    sendStatus();
    console.log(`[net] joined: ${player.nickname}`);
  });

  socket.on('player-moved', (data) => {
    const p = players.get(data.id);
    if (p) {
      p.x = data.x;
      p.dir = data.dir;
      p.walking = data.walking;
    }
    broadcast('net:player-moved', data);
  });

  socket.on('player-left', (id) => {
    players.delete(id);
    broadcast('net:player-left', id);
    sendStatus();
  });

  socket.on('player-appearance', (data) => {
    const p = players.get(data.id);
    if (p) p.appearance = data.appearance;
    broadcast('net:player-appearance', data);
  });

  // 🐾 펫: 내 상태(분당 포만도 틱·자동 먹이) / 누군가의 장착 변경 / 5성 획득 알림
  socket.on('pet', (state) => applyPetState(state));
  socket.on('player-pet', (data) => {
    const p = players.get(data.id);
    if (p) {
      if (data.pet) p.pet = data.pet;
      else delete p.pet;
    }
    broadcast('net:player-pet', data);
  });
  socket.on('pet-news', (data) => broadcast('net:pet-news', data));

  socket.on('player-pinned', (data) => {
    const p = players.get(data.id);
    if (p) p.pinned = data.text;
    broadcast('net:player-pinned', data);
  });

  socket.on('player-read', (data) => {
    const p = players.get(data.id);
    if (p) p.lastReadTs = data.ts;
    broadcast('net:player-read', data);
  });

  socket.on('coins', (coins) => {
    myCoins = coins;
    broadcast('self:coins', coins);
  });

  socket.on('wallet', (data) => {
    myCoins = data.coins;
    myItems = data.items;
    myFish = data.fish ?? [];
    myTrophies = data.trophies ?? [];
    myRodStars = data.rodStars ?? 0;
    myRodFails = data.rodFails ?? 0;
    myStocks = data.stocks ?? {};
    myGems = data.gems ?? 0;
    myActions = data.actions ?? [];
    myMinerals = data.minerals ?? [];
    myTitle = data.title ?? '';
    myPetFx = (data.petFx as Record<string, number> | undefined) ?? {};
    myPet = data.pet ?? null;
    broadcast('self:coins', myCoins);
    broadcast('self:gems', myGems);
    broadcast('self:wallet', walletSnapshot());
  });

  socket.on('achievement', (list) => {
    broadcast('self:achievement', list);
  });

  socket.on('ach-news', (data) => {
    broadcast('net:ach-news', data);
  });

  socket.on('dig-news', (data) => {
    broadcast('net:dig-news', data);
  });

  socket.on('player-digging', (data) => {
    broadcast('net:player-digging', data);
  });

  socket.on('player-battle', (data) => {
    const p = players.get(data.id);
    if (p) p.battle = data.active;
    if (data.id === selfId) {
      myBattleActive = data.active;
      broadcast('self:battle', { active: data.active });
    }
    broadcast('net:player-battle', data);
  });

  socket.on('player-title', (data) => {
    const p = players.get(data.id);
    if (p) p.title = data.title || undefined;
    if (data.id === selfId) {
      myTitle = data.title;
      broadcast('self:wallet', walletSnapshot());
    }
    broadcast('net:player-title', data);
  });

  socket.on('enhance-news', (data) => {
    broadcast('net:enhance-news', data);
  });

  socket.on('brag-news', (data) => {
    broadcast('net:brag-news', data);
  });

  socket.on('battle-news', (data) => {
    broadcast('net:battle-news', data);
  });

  // 주식 시세 (접속 시 + 매 틱) / 전광판 항목
  socket.on('stocks', (data) => {
    myStocksMarket = data;
    broadcast('net:stocks', data);
  });

  socket.on('ticker', (item) => {
    broadcast('net:ticker', item);
  });

  // 그림 쪽지 — 접속 시 일괄 / 실시간 수신
  socket.on('notes', (notes) => {
    myNotes = Array.isArray(notes) ? notes : [];
    broadcast('self:notes', myNotes);
  });

  socket.on('note', (note) => {
    if (!note || myNotes.some((n) => n.id === note.id)) return;
    myNotes.push(note);
    broadcast('self:note', note);
  });

  socket.on('player-fishing', (data) => {
    broadcast('net:player-fishing', data);
  });

  socket.on('slot-win', (data) => {
    broadcast('net:slot-win', data);
  });

  socket.on('ranking-update', (data) => {
    lastRanking = data;
    broadcast('net:ranking', data);
  });

  socket.on('daily', (state) => {
    lastDaily = state;
    broadcast('self:daily', state);
  });

  socket.on('gems', (g) => {
    myGems = Number(g) || 0;
    broadcast('self:gems', myGems);
  });

  socket.on('chat', (msg) => {
    if (msg.image) msg.image = { ...msg.image, url: `${SERVER_URL}${msg.image.url}` };
    // 서버가 외형 스냅샷을 못 붙였으면(구버전 서버) 접속자 정보로 보강
    msg.senderAppearance ??= players.get(msg.id)?.appearance;
    chatLog.push(msg);
    if (chatLog.length > 150) chatLog.shift();
    broadcast('net:chat', msg);
    // 채팅창이 닫혀 있는 동안 도착한 남의 메시지 → 안읽음 배지
    if (msg.id !== selfId && (!chatWindow || chatWindow.isDestroyed() || !chatWindow.isVisible())) {
      unreadCount++;
      broadcast('self:unread', unreadCount);
    }
  });

  socket.on('chat-history', (msgs) => {
    chatLog.length = 0;
    for (const msg of msgs) {
      if (msg.image) msg.image = { ...msg.image, url: `${SERVER_URL}${msg.image.url}` };
      chatLog.push(msg);
    }
    broadcast('net:history', chatLog);
  });
}

// ---- 오버레이 창 ----

// 설정된 디스플레이 — 모니터가 분리됐으면 주 모니터로 폴백
// DOTCHAT_DISPLAY env가 있으면 설정보다 우선 ('primary' 또는 디스플레이 id) — 개발용 앱을 설치본과 다른 모니터에 띄울 때 사용
function targetDisplay(): Electron.Display {
  const displays = screen.getAllDisplays();
  const env = process.env.DOTCHAT_DISPLAY;
  if (env === 'primary') return screen.getPrimaryDisplay();
  if (env) return displays.find((d) => d.id === Number(env)) ?? screen.getPrimaryDisplay();
  return displays.find((d) => d.id === settings.displayId) ?? screen.getPrimaryDisplay();
}

function overlayBounds() {
  const wa = targetDisplay().workArea;
  return {
    x: wa.x,
    y: wa.y + wa.height - OVERLAY_HEIGHT,
    width: wa.width,
    height: OVERLAY_HEIGHT,
  };
}

function pipeConsole(win: BrowserWindow, tag: string): void {
  win.webContents.on('console-message', (event: any, _level?: unknown, message?: unknown) => {
    const text = event && typeof event === 'object' && 'message' in event ? event.message : message;
    console.log(`[${tag}]`, text);
  });
}

function createOverlay(): void {
  overlayWindow = new BrowserWindow({
    ...overlayBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  // 기본은 클릭 통과. 렌더러가 캐릭터/버튼 호버를 감지하면 IPC로 잠깐 해제한다.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  pipeConsole(overlayWindow, 'overlay');

  overlayWindow.loadFile(path.join(RENDERER_DIR, 'overlay.html'));
  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow) return;
    overlayWindow.setBounds(overlayBounds());
    overlayWindow.show();
    console.log('[main] overlay shown:', JSON.stringify(overlayWindow.getBounds()));
  });

  const reposition = () => {
    overlayWindow?.setBounds(overlayBounds());
    tickerWindow?.setBounds(tickerBounds());
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  // 다른 앱 실행 등으로 최상단(z-order)이 풀리는 경우 대비 — 주기적으로 재고정
  setInterval(() => {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 5000);
}

// ---- 전광판 창 (모니터 상단 얇은 띠, 클릭 통과) ----

const TICKER_HEIGHT = 36;

function tickerBounds() {
  const wa = targetDisplay().workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: TICKER_HEIGHT };
}

function createTicker(): void {
  if (tickerWindow && !tickerWindow.isDestroyed()) return;
  tickerWindow = new BrowserWindow({
    ...tickerBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  tickerWindow.setAlwaysOnTop(true, 'screen-saver');
  tickerWindow.setIgnoreMouseEvents(true); // 읽기 전용 — 항상 클릭 통과
  pipeConsole(tickerWindow, 'ticker');
  tickerWindow.loadFile(path.join(RENDERER_DIR, 'ticker.html'));
  tickerWindow.once('ready-to-show', () => tickerWindow?.show());
  tickerWindow.on('closed', () => {
    tickerWindow = null;
  });
}

function applyTickerVisibility(): void {
  if (settings.tickerOn) {
    createTicker();
  } else if (tickerWindow && !tickerWindow.isDestroyed()) {
    tickerWindow.destroy();
    tickerWindow = null;
  }
}

// ---- 채팅 창 ----

function chatBounds() {
  // 채팅창도 오버레이와 같은 디스플레이에
  const wa = targetDisplay().workArea;
  return {
    x: wa.x + wa.width - CHAT_SIZE.width - 12,
    y: wa.y + wa.height - CHAT_SIZE.height - 12,
    width: CHAT_SIZE.width,
    height: CHAT_SIZE.height,
  };
}

function clearUnread(): void {
  if (unreadCount !== 0) {
    unreadCount = 0;
    broadcast('self:unread', 0);
  }
}

function toggleChat(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isVisible()) {
      chatWindow.hide();
    } else {
      chatWindow.show();
      chatWindow.focus();
      clearUnread();
    }
    return;
  }

  chatWindow = new BrowserWindow({
    ...chatBounds(),
    show: false,
    frame: false,
    resizable: true,
    minWidth: 300,
    minHeight: 340,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD,
    },
  });

  pipeConsole(chatWindow, 'chat');
  chatWindow.loadFile(path.join(RENDERER_DIR, 'chat.html'));
  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
    chatWindow?.focus();
    clearUnread();
  });
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

// ---- 낚시도감 창 (픽셀 고정 크기 팝업) ----

let fishdexWindow: BrowserWindow | null = null;

function toggleFishdex(): void {
  if (fishdexWindow && !fishdexWindow.isDestroyed()) {
    if (fishdexWindow.isVisible()) fishdexWindow.hide();
    else fishdexWindow.show();
    return;
  }
  fishdexWindow = new BrowserWindow({
    width: 532,
    height: 316,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true, // 책 그림만 보이도록
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: PRELOAD },
  });
  pipeConsole(fishdexWindow, 'fishdex');
  fishdexWindow.loadFile(path.join(RENDERER_DIR, 'fishdex.html'));
  fishdexWindow.once('ready-to-show', () => fishdexWindow?.show());
  fishdexWindow.on('closed', () => {
    fishdexWindow = null;
  });
}

ipcMain.on('toggle-fishdex', () => toggleFishdex());
ipcMain.on('close-fishdex', () => fishdexWindow?.hide());

// ---- 패널 팝아웃 창 (chat.html을 ?panel= 모드로 로드 — 채팅창과 로직 공유) ----
const POPOUT_PANELS: Record<string, { w: number; h: number }> = {
  forge: { w: 340, h: 470 },
  shop: { w: 360, h: 520 },
  slot: { w: 320, h: 420 },
  stock: { w: 380, h: 520 },
  note: { w: 340, h: 480 },
  battle: { w: 380, h: 640 },
  pet: { w: 380, h: 640 },
};
const popoutWindows = new Map<string, BrowserWindow>();

function togglePopout(panel: string): void {
  const size = POPOUT_PANELS[panel];
  if (!size) return;
  const existing = popoutWindows.get(panel);
  if (existing && !existing.isDestroyed()) {
    existing.close();
    return;
  }
  const win = new BrowserWindow({
    width: size.w,
    height: size.h,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: true,
    minWidth: 260,
    minHeight: 300,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: PRELOAD },
  });
  popoutWindows.set(panel, win);
  pipeConsole(win, `popout:${panel}`);
  win.loadFile(path.join(RENDERER_DIR, 'chat.html'), { query: { panel } });
  // 렌더러의 첫 resize-popout(내용 실측) 후에 표시 — 크기 조정이 화면에 안 보이게
  const showFallback = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 800);
  win.on('closed', () => {
    clearTimeout(showFallback);
    if (popoutWindows.get(panel) === win) popoutWindows.delete(panel);
  });
}

ipcMain.on('toggle-popout', (_e, panel: string) => togglePopout(String(panel)));
ipcMain.on('close-popout', (_e, panel: string) => popoutWindows.get(String(panel))?.close());
ipcMain.on('resize-popout', (_e, panel: string, height: number) => {
  const win = popoutWindows.get(String(panel));
  if (!win || win.isDestroyed()) return;
  const h = Math.max(200, Math.min(700, Math.round(Number(height) || 0)));
  if (h > 0) win.setContentSize(win.getContentSize()[0], h);
  if (!win.isVisible()) win.show();
});

// ---- IPC: 오버레이/공통 ----

ipcMain.on('set-interactive', (_e, interactive: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('set-tray-icon', (_e, dataUrl: string) => {
  const icon = nativeImage.createFromDataURL(dataUrl);
  if (tray) {
    tray.setImage(icon); // 외모 변경 시 아이콘 갱신
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip('DotChat');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'DotChat', enabled: false },
      { type: 'separator' },
      { label: '채팅창 열기/닫기', click: () => toggleChat() },
      { label: '종료', click: () => app.quit() },
    ]),
  );
});

// ---- IPC: 에셋 ----

ipcMain.handle('get-manifest', () => manifest);

// 파츠 시트 1장을 data URL로 (렌더러에서 캔버스 합성용 — file:// 오염 회피)
const partCache = new Map<string, string | null>();
ipcMain.handle('load-part', (_e, layer: string, name: string) => {
  const key = `${layer}/${name}`;
  if (partCache.has(key)) return partCache.get(key);
  let result: string | null = null;
  if (
    manifest &&
    typeof layer === 'string' &&
    typeof name === 'string' &&
    manifest.layers[layer]?.includes(name)
  ) {
    try {
      const file = path.join(ASSETS_DIR, layer, `${name}.png`);
      result = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      result = null;
    }
  }
  partCache.set(key, result);
  return result;
});

// ---- IPC: 미니게임 에셋 ----

interface ExtrasManifest {
  /** 🐾 펫 스프라이트/연출 (import-extras.mjs) */
  pets?: Record<string, unknown>;
  petUi?: unknown;
  fish: string[];
  /** 새 물고기 (단일 이미지, fish2/ 디렉토리) */
  fish2?: string[];
  tools: { frameW: number; frameH: number; strips: Record<string, number>; files: Record<string, string> };
  /** 땅파기 삽질 스트립 */
  dig?: { file: string; frames: number };
  /** 광물/보석 아이콘 id 목록 (minerals/ 디렉토리) */
  minerals?: string[];
  /** 원정 몬스터 스프라이트 id 목록 (monsters/ 디렉토리, 32x32) */
  monsters?: string[];
  reaction: { cell: number; cols: number; rows: number };
}

function loadExtrasManifest(): ExtrasManifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(EXTRAS_DIR, 'manifest-extras.json'), 'utf8'));
  } catch {
    return null;
  }
}

const extrasManifest = loadExtrasManifest();
if (!extrasManifest) {
  console.error(`[main] 미니게임 에셋 없음: ${EXTRAS_DIR} — tools/import-extras.mjs 실행 필요`);
}

ipcMain.handle('get-extras', () => extrasManifest);

// 엑스트라 파일을 data URL로 (허용 경로만)
const extraCache = new Map<string, string | null>();
ipcMain.handle('load-extra', (_e, relPath: string) => {
  const rel = String(relPath);
  if (extraCache.has(rel)) return extraCache.get(rel);
  let result: string | null = null;
  const allowed =
    rel === 'reaction.png' ||
    rel === 'book.png' ||
    /^tools\/tools_\w+_strip\d+\.png$/.test(rel) ||
    /^rungame\/(Arrow|Trap3)\.png$/.test(rel) ||
    /^effects\/[\w\-]+\.png$/.test(rel) ||
    /^pets\/ui\/[\w\-]+\.png$/.test(rel) ||
    (/^pets\/[\w\-]+\.png$/.test(rel) && extrasManifest?.pets?.[rel.slice(5, -4)] !== undefined) ||
    (/^minerals\/[a-z]\d+\.png$/.test(rel) &&
      extrasManifest?.minerals?.includes(rel.slice(9, -4)) === true) ||
    (/^monsters\/[a-z0-9\-]+\.png$/.test(rel) &&
      extrasManifest?.monsters?.includes(rel.slice(9, -4)) === true) ||
    (/^fish\/[\w\- ]+\.png$/.test(rel) &&
      extrasManifest?.fish.includes(rel.slice(5, -4)) === true) ||
    (/^fish2\/[\w\- ]+\.png$/.test(rel) &&
      extrasManifest?.fish2?.includes(rel.slice(6, -4)) === true);
  if (allowed && extrasManifest) {
    try {
      result = `data:image/png;base64,${fs.readFileSync(path.join(EXTRAS_DIR, rel)).toString('base64')}`;
    } catch {
      result = null;
    }
  }
  extraCache.set(rel, result);
  return result;
});

// ---- IPC: 프로필/설정/네트워크 ----

ipcMain.handle('get-self', () => ({
  nickname: profile?.nickname ?? '',
  tag: profile?.tag ?? '',
  appearance: inventory.equipped,
  giftIntervalSec: GIFT_INTERVAL_SEC,
}));

ipcMain.handle('get-inventory', () => inventory);

ipcMain.handle('get-settings', () => settings);

ipcMain.on('set-opacity', (_e, value: number) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  settings.opacity = Math.min(1, Math.max(0.1, v)); // 최소 10%
  saveSettings();
  broadcast('self:settings', settings);
});

ipcMain.on('set-scale', (_e, value: number) => {
  const v = Number(value);
  if (![1, 2, 3].includes(v)) return;
  settings.scale = v;
  saveSettings();
  broadcast('self:settings', settings);
});

ipcMain.on('set-chat-color', (_e, value: string) => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return;
  settings.chatColor = value;
  saveSettings();
  broadcast('self:settings', settings);
});

ipcMain.on('set-pinned', (_e, data: { text?: unknown; enabled?: unknown }) => {
  settings.pinnedMsg = sanitizePinned(data?.text);
  settings.pinnedOn = data?.enabled === true;
  saveSettings();
  broadcast('self:settings', settings);
  if (socket?.connected) socket.emit('pinned', effectivePinned());
});

// ---- 디스플레이 선택 (오버레이/채팅창을 띄울 모니터) ----

ipcMain.handle('get-displays', () => {
  const primaryId = screen.getPrimaryDisplay().id;
  const currentId = targetDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    index: i + 1,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId,
    current: d.id === currentId,
  }));
});

ipcMain.on('set-display', (_e, id: unknown) => {
  const display = screen.getAllDisplays().find((d) => d.id === Number(id));
  if (!display) return;
  settings.displayId = display.id;
  saveSettings();
  overlayWindow?.setBounds(overlayBounds());
  tickerWindow?.setBounds(tickerBounds());
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.setBounds(chatBounds());
  broadcast('self:settings', settings);
  console.log(`[display] 오버레이 → 디스플레이 ${display.id} (${display.size.width}x${display.size.height})`);
});

ipcMain.handle('net-state', () => ({
  selfId,
  connected: socket?.connected ?? false,
  online: players.size,
  players: [...players.values()],
}));

ipcMain.handle('chat-history', () => chatLog);

ipcMain.on('move', (_e, data: MovePayload) => {
  if (socket?.connected) socket.emit('move', data);
});

ipcMain.on('chat-send', (_e, text: string) => {
  if (typeof text === 'string' && socket?.connected) socket.emit('chat', text);
});

// 채팅창이 보이는 상태에서 읽음 위치 보고
ipcMain.on('read-mark', (_e, ts: number) => {
  if (socket?.connected && Number.isFinite(Number(ts))) socket.emit('read', Number(ts));
  clearUnread();
});

// 액션 명령어 — 대사는 메인이 랜덤 선택, /공격은 장착 무기에 따라 베기/활쏘기 자동
const ACTION_QUIPS: Record<string, string[]> = {
  slash: ['이얍~!', '받아라!', '공격!', '하앗!'],
  jab: ['푹!', '찌른다!', '급소 노리기!'],
  shot: ['슝~!', '받아라 화살!', '명중이다!'],
  block: ['막는다!', '철벽 방어!', '어림없지!'],
  roll: ['데굴데굴~', '회피 기동!', '구른다!'],
  jump: ['폴짝!', '점프~!', '히얍!'],
  death: ['으윽... 쓰러졌다...', '여기까지인가...', '죽은 척...'],
  crawl: ['살금살금...', '포복 전진!', '들키면 안 돼...'],
  ready: ['덤벼라!', '전투 준비 완료!', '언제든지 와라!'],
};

ipcMain.on('action-send', (_e, command: string) => {
  if (!socket?.connected || typeof command !== 'string') return;
  let action = command;
  if (command === 'attack') {
    // 활 계열 무기 장착 시 활쏘기, 아니면 베기
    const weapon = inventory.equipped.weapon?.name ?? '';
    action = /bow/i.test(weapon) ? 'shot' : 'slash';
  }
  const quips = ACTION_QUIPS[action];
  if (!quips) return;
  socket.emit('action', {
    action: action as ActionId,
    text: randomOf(quips),
  });
});

ipcMain.handle(
  'send-image',
  (_e, payload: { buffer: ArrayBuffer; mime: string; thumb: string; w: number; h: number }) => {
    return new Promise((resolve) => {
      if (!socket?.connected) {
        resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
        return;
      }
      const data = Buffer.from(new Uint8Array(payload.buffer));
      // socket.timeout()의 콜백 시그니처(err, res)는 타입드 소켓과 궁합이 안 맞아 any 캐스팅
      (socket as any)
        .timeout(15000)
        .emit(
          'image',
          { data, mime: payload.mime, thumb: payload.thumb, w: payload.w, h: payload.h },
          (err: unknown, res: unknown) => {
            resolve(err ? { ok: false, error: '전송 시간이 초과됐어요.' } : res);
          },
        );
    });
  },
);

// 채팅 목록에서 이미지 클릭 → 기본 브라우저로 원본 열기 (우리 서버 URL만 허용)
ipcMain.on('open-image', (_e, url: string) => {
  if (typeof url === 'string' && url.startsWith(SERVER_URL)) void shell.openExternal(url);
});

ipcMain.on('toggle-chat', () => toggleChat());
ipcMain.on('close-chat', () => chatWindow?.hide());

// ---- IPC: 선물상자 / 장착 ----

interface GiftResult {
  isNew: boolean;
  kind: 'race' | 'part' | null;
  id: string | null;
  label: string | null;
  ownedCount: number;
  total: number;
}

function giftPool(): string[] {
  if (!manifest) return [];
  return [
    ...manifest.races.map((r) => `race:${r.name}`),
    ...GIFT_LAYERS.flatMap((layer) => (manifest.layers[layer] ?? []).map((n) => `${layer}/${n}`)),
  ];
}

// 보유 파츠를 서버 지갑에 동기화 (클라 기준 합집합)
// 서버에만 있던 파츠는 로컬로 내려받아 다른 PC에서도 수집품을 이어받는다
function syncParts(): void {
  if (!socket?.connected) return;
  (socket as any).timeout(10000).emit('parts-sync', inventory.owned, (err: unknown, res: any) => {
    if (err || !res?.ok || !Array.isArray(res.parts)) return;
    const before = inventory.owned.length;
    const merged = new Set(inventory.owned);
    for (const p of res.parts) if (typeof p === 'string') merged.add(p);
    if (merged.size !== before) {
      inventory.owned = [...merged];
      saveInventory();
      broadcast('self:inventory');
      console.log(`[parts] 서버 지갑에서 파츠 ${merged.size - before}개 내려받음 (총 ${merged.size})`);
    }
  });
}

// 미보유 파츠(종족 세트 포함) 1개 랜덤 지급 — 선물상자/슬롯 공용
function grantRandomPart(): { id: string; label: string } | null {
  const pool = giftPool();
  const unowned = pool.filter((id) => !inventory.owned.includes(id));
  if (unowned.length === 0) return null;
  const id = randomOf(unowned);
  inventory.owned.push(id);
  saveInventory();
  broadcast('self:inventory');
  syncParts(); // 새 파츠 즉시 서버 등록
  const label = id.startsWith('race:') ? `${id.slice(5)} 종족 세트` : id.split('/')[1];
  console.log(`[part] ${id} 획득 (${inventory.owned.length}/${pool.length})`);
  return { id, label };
}

ipcMain.handle('claim-gift', (): GiftResult => {
  const pool = giftPool();
  const base = { ownedCount: inventory.owned.length, total: pool.length };
  const grant = grantRandomPart();
  if (!grant) {
    return { isNew: false, kind: null, id: null, label: null, ...base };
  }
  return {
    isNew: true,
    kind: grant.id.startsWith('race:') ? 'race' : 'part',
    id: grant.id,
    label: grant.label,
    ownedCount: inventory.owned.length,
    total: pool.length,
  };
});

// ---- 슬롯머신 (판정은 서버, 파츠 당첨 시 로컬 지급) ----

let myCoins = 0;
let myItems: string[] = [];
let myFish: string[] = [];
let myTrophies: string[] = [];
let myRodStars = 0;
let myRodFails = 0;
let myStocks: Record<string, { qty: number; avg: number }> = {};
let myGems = 0;
let myActions: string[] = [];
let myMinerals: string[] = [];
let myTitle = '';
let myBattleActive = false; // 원정 중 (welcome 플레이어 목록 + player-battle + battle ack로 갱신)
let myPetFx: Record<string, number> = {}; // 🐾 장착 펫 효과 (클라 로컬 롤/쿨타임용 키만)
let myPet: string | null = null; // 🐾 장착 펫 id (첫 슬롯)
let myStocksMarket: unknown = null; // 최신 시세 스냅샷 (stocks 이벤트)

ipcMain.handle('get-coins', () => myCoins);

ipcMain.handle('get-wallet', () => walletSnapshot());

ipcMain.handle('buy-action', (_e, actionId: string) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('buy-action', String(actionId), (err: unknown, res: unknown) => {
      const r = res as { ok?: boolean; gems?: number; actions?: string[] } | undefined;
      if (!err && r?.ok) {
        if (typeof r.gems === 'number') myGems = r.gems;
        if (Array.isArray(r.actions)) myActions = r.actions;
        broadcast('self:gems', myGems);
        broadcast('self:wallet', walletSnapshot());
      }
      resolve(err ? { ok: false, error: '응답이 없어요.' } : res);
    });
  });
});

// ---- 🐾 펫 (판정·보유·효과 서버 권위 — ack의 state로 로컬 갱신, 모든 창에 self:pet 전파) ----

function applyPetState(state: unknown): void {
  const s = state as { fx?: Record<string, number>; equip?: string[]; coins?: number; gems?: number } | null;
  if (!s || typeof s !== 'object') return;
  myPetFx = s.fx ?? {};
  myPet = Array.isArray(s.equip) ? (s.equip[0] ?? null) : null;
  if (typeof s.coins === 'number') {
    myCoins = s.coins;
    broadcast('self:coins', myCoins);
  }
  if (typeof s.gems === 'number') {
    myGems = s.gems;
    broadcast('self:gems', myGems);
  }
  broadcast('self:pet', s);
  broadcast('self:wallet', walletSnapshot());
}

function petIpc(event: string, mapArgs: (...args: unknown[]) => unknown[] = () => []) {
  return (_e: unknown, ...args: unknown[]) =>
    new Promise((resolve) => {
      if (!socket?.connected) {
        resolve(event === 'pet-state' ? null : { ok: false, error: '서버에 연결되어 있지 않아요.' });
        return;
      }
      (socket as any).timeout(15000).emit(event, ...mapArgs(...args), (err: unknown, res: any) => {
        if (err || !res) {
          resolve(event === 'pet-state' ? null : { ok: false, error: '응답 시간이 초과됐어요.' });
          return;
        }
        applyPetState(event === 'pet-state' ? res : res.state);
        resolve(res);
      });
    });
}
ipcMain.handle('pet-state', petIpc('pet-state'));
ipcMain.handle('pet-gacha', petIpc('pet-gacha', (count) => [Number(count) === 10 ? 10 : 1]));
ipcMain.handle('pet-equip', petIpc('pet-equip', (ids) => [Array.isArray(ids) ? ids.map(String) : []]));
ipcMain.handle('pet-feed', petIpc('pet-feed', (id) => [String(id ?? '')]));
ipcMain.handle('pet-level', petIpc('pet-level', (id) => [String(id ?? '')]));
ipcMain.handle('pet-autofeed', petIpc('pet-autofeed', (cfg) => [{ on: (cfg as any)?.on === true, pct: Number((cfg as any)?.pct) || 70 }]));
ipcMain.handle('buy-pet-item', petIpc('buy-pet-item', (kind, qty) => [String(kind ?? ''), Math.floor(Number(qty) || 0)]));

/** 러너 쿨타임 — 🐾 펫 runCd 효과 반영 */
const runnerCooldownMs = (): number => Math.round(RUNNER_COOLDOWN_MS * Math.max(0, 1 - (myPetFx.runCd ?? 0) / 100));

// 💱 환전 (골드↔젬) — 판정 서버, 성공 시 잔액 갱신 브로드캐스트
ipcMain.handle('exchange', (_e, dir: string, qty: number) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any)
      .timeout(10000)
      .emit('exchange', String(dir), Math.floor(Number(qty) || 0), (err: unknown, res: unknown) => {
        const r = res as { ok?: boolean; coins?: number; gems?: number } | undefined;
        if (!err && r) {
          if (typeof r.coins === 'number') myCoins = r.coins;
          if (typeof r.gems === 'number') myGems = r.gems;
          broadcast('self:coins', myCoins);
          broadcast('self:gems', myGems);
          broadcast('self:wallet', walletSnapshot());
        }
        resolve(err ? { ok: false, error: '응답이 없어요.' } : res);
      });
  });
});

// ---- 가상 주식 / 전광판 ----

ipcMain.handle('get-stocks', () => myStocksMarket);

function tradeIpc(event: 'stock-buy' | 'stock-sell') {
  return (_e: unknown, stockId: string, qty: number) =>
    new Promise((resolve) => {
      if (!socket?.connected) {
        resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
        return;
      }
      (socket as any).timeout(10000).emit(event, String(stockId), Number(qty), (err: unknown, res: any) => {
        if (err || !res) {
          resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
          return;
        }
        if (typeof res.coins === 'number') {
          myCoins = res.coins;
          broadcast('self:coins', myCoins);
        }
        if (res.ok && res.holding) {
          if (res.holding.qty > 0) myStocks[String(stockId)] = { qty: res.holding.qty, avg: res.holding.avg };
          else delete myStocks[String(stockId)];
          broadcast('self:wallet', walletSnapshot());
        }
        resolve(res);
      });
    });
}

ipcMain.handle('stock-buy', tradeIpc('stock-buy'));
ipcMain.handle('stock-sell', tradeIpc('stock-sell'));

ipcMain.handle('ticker-ad', (_e, text: string) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('ticker-send', String(text ?? ''), (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      resolve(res);
    });
  });
});

ipcMain.handle('ticker-log', () => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve([]);
      return;
    }
    (socket as any).timeout(10000).emit('ticker-log', (err: unknown, items: unknown) => {
      resolve(err || !Array.isArray(items) ? [] : items);
    });
  });
});

ipcMain.on('set-ticker', (_e, on: unknown) => {
  settings.tickerOn = on === true;
  saveSettings();
  applyTickerVisibility();
  broadcast('self:settings', settings);
});

function walletSnapshot() {
  return {
    coins: myCoins,
    items: myItems,
    fish: myFish,
    trophies: myTrophies,
    rodStars: myRodStars,
    rodFails: myRodFails,
    stocks: myStocks,
    gems: myGems,
    actions: myActions,
    minerals: myMinerals,
    title: myTitle,
    petFx: myPetFx,
    pet: myPet,
  };
}

// 낚싯대 강화 (판정 서버)
ipcMain.handle('enhance', () => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('enhance', (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      if (res.ok) {
        myRodStars = Number(res.stars) || 0;
        myRodFails = Number(res.fails) || 0;
        broadcast('self:wallet', walletSnapshot());
      }
      resolve(res);
    });
  });
});

ipcMain.handle('shop-buy', (_e, itemId: string) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('buy', String(itemId), (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') myCoins = res.coins;
      if (Array.isArray(res.items)) myItems = res.items;
      broadcast('self:coins', myCoins);
      broadcast('self:wallet', { coins: myCoins, items: myItems });
      resolve(res);
    });
  });
});

ipcMain.handle('ranking-cached', () => lastRanking);
ipcMain.handle('daily-state', () => lastDaily);

ipcMain.handle('ranking', () => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve([]);
      return;
    }
    (socket as any).timeout(10000).emit('ranking', (err: unknown, rows: unknown) => {
      resolve(err || !Array.isArray(rows) ? [] : rows);
    });
  });
});

ipcMain.handle('slot-play', () => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('slot', (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (res.ok && (res.kind === 'part' || res.kind === 'mega')) {
        const grant = grantRandomPart();
        res.partLabel = grant?.label ?? null;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      resolve(res);
    });
  });
});

function pushAppearance(): void {
  saveInventory();
  if (socket?.connected) socket.emit('appearance', inventory.equipped);
  broadcast('self:appearance', { appearance: inventory.equipped });
}

// 슬롯 장착/해제/색상 변경: {slot, name, h, s, v} (name=null → 해제)
ipcMain.on('equip', (_e, payload: { slot?: unknown; name?: unknown; h?: unknown; s?: unknown; v?: unknown }) => {
  if (!manifest) return;
  const slot = String(payload?.slot ?? '');
  const name = payload?.name == null ? null : String(payload.name);
  const choice: PartChoice | null = name
    ? {
        name,
        h: Number(payload?.h) || 0,
        s: Number(payload?.s) || 0,
        v: Number(payload?.v) || 0,
      }
    : null;

  if (slot === 'race') {
    if (!choice || !ownsRace(choice.name)) return;
    const race = manifest.races.find((r) => r.name === choice.name);
    if (!race) return;
    const changed = inventory.equipped.race.name !== choice.name;
    inventory.equipped.race = choice;
    if (changed) {
      // 종족 변경 시 눈/귀는 새 종족 기본값으로
      delete inventory.equipped.eyes;
      if (race.ears) inventory.equipped.ears = { name: race.name };
      else delete inventory.equipped.ears;
    }
    pushAppearance();
    return;
  }

  // 코인 상점 치장 슬롯
  if (slot === 'aura' || slot === 'bubble' || slot === 'namecolor') {
    const field = slot === 'aura' ? 'aura' : slot === 'bubble' ? 'bubbleSkin' : 'nameColor';
    if (!choice) {
      delete inventory.equipped[field];
      pushAppearance();
      return;
    }
    const item = SHOP_ITEMS.find((i) => i.id === choice.name);
    if (!item || !myItems.includes(item.id)) return;
    inventory.equipped[field] = slot === 'namecolor' ? item.value : item.id;
    pushAppearance();
    return;
  }

  if (!(APPEARANCE_SLOTS as readonly string[]).includes(slot)) return;
  const typedSlot = slot as AppearanceSlot;
  if (!choice) {
    delete inventory.equipped[typedSlot];
    pushAppearance();
    return;
  }
  // 소유 검증: eyes/ears는 종족 세트, 나머지는 개별 파츠
  if (typedSlot === 'eyes' || typedSlot === 'ears') {
    if (!ownsRace(choice.name)) return;
    if (typedSlot === 'ears' && !manifest.races.find((r) => r.name === choice.name)?.ears) return;
  } else {
    const layer = SLOT_LAYER[typedSlot];
    if (!inventory.owned.includes(`${layer}/${choice.name}`)) return;
  }
  inventory.equipped[typedSlot] = choice;
  pushAppearance();
});

// ---- 미니게임: 낚시 / 러너 / 리액션 ----

const RUNNER_COOLDOWN_MS = 300 * 1000; // 5분에 1회
let lastRunnerStart = 0;
let runnerKeysActive = false;

function registerRunnerKeys(): void {
  if (runnerKeysActive) return;
  runnerKeysActive = true;
  globalShortcut.register('Up', () => broadcast('self:runner-key', 'up'));
  globalShortcut.register('Down', () => broadcast('self:runner-key', 'down'));
}

function unregisterRunnerKeys(): void {
  if (!runnerKeysActive) return;
  runnerKeysActive = false;
  globalShortcut.unregister('Up');
  globalShortcut.unregister('Down');
}

/** overlay가 fishing-send/digging-send로 보고하는 현재 진행 여부 */
let fishingActive = false;
let diggingActive = false;

ipcMain.handle('minigame-state', () => ({
  runnerRemainSec: Math.max(0, Math.ceil((lastRunnerStart + runnerCooldownMs() - Date.now()) / 1000)),
  fishingActive,
  diggingActive,
  battleActive: myBattleActive,
}));

ipcMain.handle('minigame-start', (_e, game: string) => {
  // 원정 카드: 출발/귀환 토글 (서버 권위 — ack의 state로 확정, player-battle로 오버레이 동기화)
  if (game === 'battle') return battleIpc('battle-active')(_e, !myBattleActive);
  if (!extrasManifest) {
    return { ok: false, error: '미니게임 에셋이 없어요. tools/import-extras.mjs를 먼저 실행해 주세요.' };
  }
  if (game === 'fishing') {
    broadcast('self:minigame', { game: 'fishing' });
    return { ok: true };
  }
  if (game === 'dig') {
    if (!extrasManifest.dig || !extrasManifest.minerals?.length) {
      return { ok: false, error: '땅파기 에셋이 없어요. tools/import-extras.mjs를 다시 실행해 주세요.' };
    }
    broadcast('self:minigame', { game: 'dig' });
    return { ok: true };
  }
  if (game === 'runner') {
    const remain = lastRunnerStart + runnerCooldownMs() - Date.now();
    if (remain > 0) {
      return { ok: false, error: `달리기는 ${Math.ceil(remain / 1000)}초 후에 다시 할 수 있어요.` };
    }
    lastRunnerStart = Date.now();
    registerRunnerKeys();
    broadcast('self:minigame', { game: 'runner' });
    return { ok: true };
  }
  return { ok: false, error: '알 수 없는 게임이에요.' };
});

// 낚시 상태 변화를 서버에 중계 (다른 접속자 화면 동기화)
ipcMain.on('fishing-send', (_e, data: { phase?: unknown; fishId?: unknown; trophy?: unknown }) => {
  fishingActive = String(data?.phase ?? 'stop') !== 'stop';
  if (!socket?.connected) return;
  socket.emit('fishing-state', {
    phase: String(data?.phase ?? 'stop') as any,
    fishId: typeof data?.fishId === 'string' ? data.fishId : undefined,
    trophy: data?.trophy === true || undefined,
  });
});

// 물고기 획득 정산 (서버가 도감 기록 + 코인, trophy = 월척)
ipcMain.handle('fish-caught', (_e, fishId: string, trophy?: boolean) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('fish', String(fishId), trophy === true, (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      // 보물상자에서 상점 아이템 당첨 시 서버가 지갑에 넣어 보내줌
      if (res.ok && Array.isArray(res.items)) myItems = res.items;
      if (res.ok && res.isNew) myFish.push(String(fishId));
      if (res.ok && res.trophy && !myTrophies.includes(String(fishId))) myTrophies.push(String(fishId));
      if (res.ok && (res.isNew || res.item || res.trophy)) {
        broadcast('self:wallet', walletSnapshot());
      }
      resolve(res);
    });
  });
});

// ---- 땅파기 ----

// 땅파기 상태 변화를 서버에 중계 (다른 접속자 화면 동기화)
ipcMain.on('digging-send', (_e, data: { phase?: unknown; itemId?: unknown }) => {
  diggingActive = String(data?.phase ?? 'stop') !== 'stop';
  if (!socket?.connected) return;
  socket.emit('digging-state', {
    phase: String(data?.phase ?? 'stop') as any,
    itemId: typeof data?.itemId === 'string' ? data.itemId : undefined,
  });
});

// 발굴 정산 (서버가 도감 기록 + 코인/젬)
ipcMain.handle('dig-report', (_e, result: { kind?: unknown; itemId?: unknown }) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    const payload = {
      kind: String(result?.kind ?? '') as any,
      itemId: typeof result?.itemId === 'string' ? result.itemId : undefined,
    };
    (socket as any).timeout(10000).emit('dig', payload, (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      if (typeof res.gems === 'number') {
        myGems = res.gems;
        broadcast('self:gems', myGems);
      }
      if (res.ok && Array.isArray(res.items)) myItems = res.items;
      if (res.ok && Array.isArray(res.minerals)) myMinerals = res.minerals;
      if (res.ok && (res.isNew || res.item)) broadcast('self:wallet', walletSnapshot());
      resolve(res);
    });
  });
});

// ---- 원정 (방치형 전투) — 판정·정산은 서버, 여기서는 ack의 잔액/도감/아이템을 로컬 스냅샷에 반영 ----

function applyBattleAck(res: any): void {
  if (!res || typeof res !== 'object') return;
  let walletChanged = false;
  if (typeof res.coinsNow === 'number') {
    myCoins = res.coinsNow;
    broadcast('self:coins', myCoins);
  }
  if (typeof res.gemsNow === 'number') {
    myGems = res.gemsNow;
    broadcast('self:gems', myGems);
  }
  if (Array.isArray(res.mineralsAll)) {
    myMinerals = res.mineralsAll;
    walletChanged = true;
  }
  if (Array.isArray(res.items)) {
    myItems = res.items;
    walletChanged = true;
  }
  if (walletChanged) broadcast('self:wallet', walletSnapshot());
  if (res.state && typeof res.state.active === 'boolean' && res.state.active !== myBattleActive) {
    myBattleActive = res.state.active;
    broadcast('self:battle', { active: myBattleActive });
  }
}

function battleIpc(event: string, mapArgs: (...args: unknown[]) => unknown[] = () => []) {
  return (_e: unknown, ...args: unknown[]) =>
    new Promise((resolve) => {
      if (!socket?.connected) {
        resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
        return;
      }
      (socket as any).timeout(15000).emit(event, ...mapArgs(...args), (err: unknown, res: any) => {
        if (err || !res) {
          resolve(event === 'battle-state' ? null : { ok: false, error: '응답 시간이 초과됐어요.' });
          return;
        }
        applyBattleAck(res);
        resolve(res);
      });
    });
}

ipcMain.handle('battle-state', battleIpc('battle-state'));
ipcMain.handle('battle-claim', battleIpc('battle-claim'));
ipcMain.handle('battle-upgrade', battleIpc('battle-upgrade', (key) => [String(key ?? '')]));
ipcMain.handle('battle-stage', battleIpc('battle-stage', (stage) => [Math.floor(Number(stage) || 0)]));
ipcMain.handle('battle-challenge', battleIpc('battle-challenge'));
ipcMain.handle('battle-active', battleIpc('battle-active', (active) => [active === true]));

// ---- 도전과제 / 칭호 ----

ipcMain.handle('ach-state', () => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve(null);
      return;
    }
    (socket as any).timeout(10000).emit('ach-state', (err: unknown, res: unknown) => {
      resolve(err ? null : res);
    });
  });
});

ipcMain.handle('set-title', (_e, title: string) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('set-title', String(title ?? ''), (err: unknown, res: any) => {
      if (!err && res?.ok) {
        myTitle = String(res.title ?? '');
        broadcast('self:wallet', walletSnapshot());
      }
      resolve(err ? { ok: false, error: '응답이 없어요.' } : res);
    });
  });
});

// ---- 그림 쪽지 / 자랑하기 ----

let myNotes: { id: string; from: string; ts: number; image: string }[] = [];

ipcMain.handle('get-notes', () => myNotes);

ipcMain.handle('note-send', (_e, data: { to?: unknown; image?: unknown }) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    const payload = { to: String(data?.to ?? ''), image: String(data?.image ?? '') };
    (socket as any).timeout(10000).emit('note-send', payload, (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      resolve(res);
    });
  });
});

ipcMain.on('note-read', (_e, noteId: string) => {
  const id = String(noteId);
  myNotes = myNotes.filter((n) => n.id !== id);
  if (socket?.connected) socket.emit('note-read', id);
});

ipcMain.handle('brag', () => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('brag', (err: unknown, res: any) => {
      resolve(err || !res ? { ok: false, error: '응답 시간이 초과됐어요.' } : res);
    });
  });
});

// ---- 미보유 랜덤 파츠 뽑기 (결제는 서버, 지급은 로컬 풀에서) ----

function randomPoolFor(layer: string): string[] {
  const pool = giftPool().filter((id) => !inventory.owned.includes(id));
  if (layer === 'any') return pool;
  if (layer === 'race') return pool.filter((id) => id.startsWith('race:'));
  return pool.filter((id) => id.startsWith(`${layer}/`));
}

ipcMain.handle('shop-buy-random', (_e, itemId: string) => {
  return new Promise((resolve) => {
    const def = RANDOM_SHOP.find((i) => i.id === String(itemId));
    if (!def) {
      resolve({ ok: false, error: '없는 상품이에요.' });
      return;
    }
    if (randomPoolFor(def.layer).length === 0) {
      resolve({ ok: false, error: '이 카테고리 파츠를 이미 모두 보유하고 있어요!' });
      return;
    }
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('buy-random', def.id, (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      if (!res.ok) {
        resolve(res);
        return;
      }
      // 결제 완료 → 해당 카테고리 미보유 풀에서 랜덤 지급
      const pool = randomPoolFor(def.layer);
      const id = randomOf(pool);
      inventory.owned.push(id);
      saveInventory();
      broadcast('self:inventory');
      syncParts();
      const label = id.startsWith('race:') ? `${id.slice(5)} 종족 세트` : id.split('/')[1];
      console.log(`[shop] ${def.id} 뽑기 → ${id}`);
      resolve({ ok: true, label, coins: myCoins });
    });
  });
});

// 러너 종료 → 생존 시간 정산
ipcMain.handle('runner-end', (_e, seconds: number) => {
  unregisterRunnerKeys();
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('runner-score', Number(seconds) || 0, (err: unknown, res: any) => {
      if (err || !res) {
        resolve({ ok: false, error: '응답 시간이 초과됐어요.' });
        return;
      }
      if (typeof res.coins === 'number') {
        myCoins = res.coins;
        broadcast('self:coins', myCoins);
      }
      resolve(res);
    });
  });
});

ipcMain.on('reaction-send', (_e, index: number) => {
  if (socket?.connected && Number.isFinite(Number(index))) socket.emit('reaction', Number(index));
});

// ---- 프로필 설정 창 (첫 실행) ----

let started = false;

function startMain(): void {
  if (started) return;
  started = true;
  createOverlay();
  applyTickerVisibility();
  connect();
  // 개발 편의: 시작 시 채팅창 자동 열기 (UI 테스트용)
  if (process.env.DOTCHAT_OPEN_CHAT) setTimeout(() => toggleChat(), 1500);
}

function openSetup(): void {
  setupWindow = new BrowserWindow({
    width: 340,
    height: 330,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { preload: PRELOAD },
  });
  pipeConsole(setupWindow, 'setup');
  setupWindow.loadFile(path.join(RENDERER_DIR, 'setup.html'));
  setupWindow.once('ready-to-show', () => setupWindow?.show());
  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!profile) app.quit(); // 프로필 없이 창을 닫으면 종료
  });
}

ipcMain.handle('profile-submit', (_e, data: { nickname?: unknown; tag?: unknown }) => {
  const nickname = String(data?.nickname ?? '')
    .trim()
    .slice(0, MAX_NICKNAME_LEN);
  const tag = String(data?.tag ?? '');
  if (!nickname) return { ok: false, error: '닉네임을 입력해주세요.' };
  if (!/^\d{4}$/.test(tag)) return { ok: false, error: '고유번호는 숫자 4자리여야 합니다.' };
  profile = { nickname, tag };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
  console.log(`[profile] ${nickname}#${tag}`);
  startMain(); // 오버레이를 먼저 만들어야 setup 닫힐 때 window-all-closed로 종료되지 않음
  setupWindow?.close();
  return { ok: true };
});

ipcMain.on('setup-cancel', () => setupWindow?.close());

// ---- 자동 업데이트 ----

// 패키징 + publish 설정(GitHub Releases 등)이 있을 때만 실제로 동작 — 없으면 조용히 스킵
let updateReady: { version: string } | null = null;
let updaterRef: { quitAndInstall: () => void } | null = null;
let updateCheckNow: (() => void) | null = null;
let versionHint: string | null = null;

function setupAutoUpdate(): void {
  // 개발 모드 UI 테스트용: DOTCHAT_FAKE_UPDATE=1 이면 5초 뒤 가짜 업데이트 알림
  if (!app.isPackaged) {
    if (process.env.DOTCHAT_FAKE_UPDATE) {
      setTimeout(() => {
        updateReady = { version: '9.9.9' };
        broadcast('self:update', updateReady);
      }, 5000);
    }
    return;
  }
  try {
    const { autoUpdater } = require('electron-updater');
    updaterRef = autoUpdater;
    autoUpdater.on('update-downloaded', (info: { version?: string }) => {
      updateReady = { version: String(info?.version ?? '') };
      broadcast('self:update', updateReady);
      console.log('[update] downloaded:', updateReady.version);
    });
    const check = () =>
      autoUpdater
        .checkForUpdatesAndNotify()
        .catch((err: unknown) => console.log('[update] check skipped:', String(err)));
    updateCheckNow = check;
    check();
    // 실행 중에도 30분마다 확인 (다운로드 후 알림, 설치는 종료 시 적용)
    setInterval(check, 30 * 60 * 1000);
  } catch {
    console.log('[update] electron-updater unavailable');
  }
}

ipcMain.handle('update-state', () => {
  if (updateReady) return { version: updateReady.version, ready: true };
  if (versionHint) return { version: versionHint, ready: false };
  return null;
});

ipcMain.on('install-update', () => {
  if (updateReady && updaterRef) updaterRef.quitAndInstall();
});

// ---- 앱 라이프사이클 ----

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (profile) startMain();
    else openSetup();
    setupAutoUpdate();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

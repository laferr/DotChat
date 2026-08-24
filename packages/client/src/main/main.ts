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
      serverUrl: typeof raw.serverUrl === 'string' && raw.serverUrl ? raw.serverUrl : undefined,
    };
  } catch {
    return { opacity: 1, scale: 2, chatColor: DEFAULT_CHAT_COLOR, pinnedMsg: '', pinnedOn: false };
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
const players = new Map<string, PlayerState>();
const chatLog: ChatMessage[] = [];

function broadcast(channel: string, payload?: unknown): void {
  for (const win of [overlayWindow, chatWindow, fishdexWindow]) {
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
    broadcast('self:coins', myCoins);
    broadcast('self:wallet', data);
  });

  socket.on('player-fishing', (data) => {
    broadcast('net:player-fishing', data);
  });

  socket.on('slot-win', (data) => {
    broadcast('net:slot-win', data);
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

function overlayBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
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

  const reposition = () => overlayWindow?.setBounds(overlayBounds());
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

// ---- 채팅 창 ----

function chatBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
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
  fish: string[];
  /** 새 물고기 (단일 이미지, fish2/ 디렉토리) */
  fish2?: string[];
  tools: { frameW: number; frameH: number; strips: Record<string, number>; files: Record<string, string> };
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

ipcMain.handle('get-coins', () => myCoins);

ipcMain.handle('get-wallet', () => ({ coins: myCoins, items: myItems, fish: myFish }));

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

ipcMain.handle('minigame-state', () => ({
  runnerRemainSec: Math.max(0, Math.ceil((lastRunnerStart + RUNNER_COOLDOWN_MS - Date.now()) / 1000)),
}));

ipcMain.handle('minigame-start', (_e, game: string) => {
  if (game === 'fishing') {
    broadcast('self:minigame', { game: 'fishing' });
    return { ok: true };
  }
  if (game === 'runner') {
    const remain = lastRunnerStart + RUNNER_COOLDOWN_MS - Date.now();
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
ipcMain.on('fishing-send', (_e, data: { phase?: unknown; fishId?: unknown }) => {
  if (!socket?.connected) return;
  socket.emit('fishing-state', {
    phase: String(data?.phase ?? 'stop') as any,
    fishId: typeof data?.fishId === 'string' ? data.fishId : undefined,
  });
});

// 물고기 획득 정산 (서버가 도감 기록 + 코인)
ipcMain.handle('fish-caught', (_e, fishId: string) => {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: '서버에 연결되어 있지 않아요.' });
      return;
    }
    (socket as any).timeout(10000).emit('fish', String(fishId), (err: unknown, res: any) => {
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
      if (res.ok && (res.isNew || res.item)) {
        broadcast('self:wallet', { coins: myCoins, items: myItems, fish: myFish });
      }
      resolve(res);
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
  connect();
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

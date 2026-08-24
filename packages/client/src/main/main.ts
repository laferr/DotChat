import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';
import {
  ChatMessage,
  ClientToServerEvents,
  DEFAULT_PORT,
  MAX_NICKNAME_LEN,
  MovePayload,
  PlayerState,
  ServerToClientEvents,
} from '@dotchat/shared';

// 오버레이 창 높이 — 캐릭터 + 말풍선이 들어갈 공간
const OVERLAY_HEIGHT = 200;
const CHAT_SIZE = { width: 330, height: 460 };
// 패키징된 앱은 리소스 폴더에 동봉된 시트를 사용
const SPRITE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'sprite_split')
  : path.join(__dirname, '..', '..', '..', '..', 'sprite_split');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const RENDERER_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');

let overlayWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ---- 스프라이트 ----

function listSheetNames(): string[] {
  if (!fs.existsSync(SPRITE_DIR)) return [];
  return fs
    .readdirSync(SPRITE_DIR)
    .filter((sub) => fs.existsSync(path.join(SPRITE_DIR, sub, `${sub}_frame16x20.png`)));
}

// ---- 내 정보 / 인벤토리 (로컬 파일 영속화 — 획득 판정은 클라이언트 로컬) ----

// 선물상자 스폰 주기 (기본 5분, 테스트용으로 env 오버라이드 가능)
const GIFT_INTERVAL_SEC = Math.max(5, Number(process.env.DOTCHAT_GIFT_SEC ?? 300));

const sheetNames = listSheetNames();

interface Inventory {
  owned: string[];
  current: string;
}

const DATA_DIR = path.join(app.getPath('appData'), 'DotChat');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory.json');

function loadInventory(): Inventory | null {
  try {
    const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
    const owned = Array.isArray(raw.owned)
      ? raw.owned.filter((n: unknown) => typeof n === 'string' && sheetNames.includes(n))
      : [];
    if (owned.length === 0) return null;
    const current = owned.includes(raw.current) ? raw.current : owned[0];
    return { owned, current };
  } catch {
    return null;
  }
}

function saveInventory(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2), 'utf8');
}

let inventory = loadInventory();
if (!inventory) {
  // 최초 실행: 32종 중 랜덤 1개로 시작. 이후엔 마지막 장착 캐릭터로 접속.
  const start =
    sheetNames.length > 0 ? sheetNames[Math.floor(Math.random() * sheetNames.length)] : 'fallback';
  inventory = { owned: [start], current: start };
  saveInventory();
}
let myCharacter = inventory.current;

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

// ---- 설정 (투명도 / 서버 주소) ----

interface Settings {
  /** 오버레이 콘텐츠 투명도 0.1~1.0 */
  opacity: number;
  serverUrl?: string;
}

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const opacity = Number(raw.opacity);
    return {
      opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.1, opacity)) : 1,
      serverUrl: typeof raw.serverUrl === 'string' && raw.serverUrl ? raw.serverUrl : undefined,
    };
  } catch {
    return { opacity: 1 };
  }
}

const settings = loadSettings();

function saveSettings(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
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
const players = new Map<string, PlayerState>();
const chatLog: ChatMessage[] = [];

function broadcast(channel: string, payload?: unknown): void {
  for (const win of [overlayWindow, chatWindow]) {
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
      socket!.emit('hello', { nickname: profile.nickname, tag: profile.tag, character: myCharacter });
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
    if (p) p.character = data.character;
    broadcast('net:player-appearance', data);
  });

  socket.on('chat', (msg) => {
    if (msg.image) msg.image = { ...msg.image, url: `${SERVER_URL}${msg.image.url}` };
    chatLog.push(msg);
    if (chatLog.length > 100) chatLog.shift();
    broadcast('net:chat', msg);
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

function toggleChat(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isVisible()) {
      chatWindow.hide();
    } else {
      chatWindow.show();
      chatWindow.focus();
    }
    return;
  }

  chatWindow = new BrowserWindow({
    ...chatBounds(),
    show: false,
    frame: false,
    resizable: true,
    minWidth: 280,
    minHeight: 320,
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
  });
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

// ---- IPC ----

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

// sprite_split/<캐릭터>/<캐릭터>_frame16x20.png 시트들을 data URL로 로드
// (file:// 이미지를 캔버스에 그리면 toDataURL이 오염 에러를 내므로 data URL로 전달)
ipcMain.handle('load-sprites', () => {
  const sheets: { name: string; dataUrl: string }[] = [];
  for (const name of listSheetNames()) {
    const file = path.join(SPRITE_DIR, name, `${name}_frame16x20.png`);
    sheets.push({
      name,
      dataUrl: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`,
    });
  }
  console.log(`[main] loaded ${sheets.length} sprite sheets`);
  return sheets;
});

ipcMain.handle('get-self', () => ({
  nickname: profile?.nickname ?? '',
  tag: profile?.tag ?? '',
  character: myCharacter,
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

// 선물상자 획득 — 미보유 캐릭터 중 랜덤 지급 (전부 보유 시 isNew: false)
ipcMain.handle('claim-gift', () => {
  const unowned = sheetNames.filter((name) => !inventory.owned.includes(name));
  if (unowned.length === 0) {
    return { isNew: false, character: null, ownedCount: inventory.owned.length, total: sheetNames.length };
  }
  const character = unowned[Math.floor(Math.random() * unowned.length)];
  inventory.owned.push(character);
  saveInventory();
  broadcast('self:inventory'); // 외모 패널이 열려 있으면 즉시 갱신
  console.log(`[gift] ${character} 획득 (${inventory.owned.length}/${sheetNames.length})`);
  return {
    isNew: true,
    character,
    ownedCount: inventory.owned.length,
    total: sheetNames.length,
  };
});

ipcMain.on('equip', (_e, character: string) => {
  if (typeof character !== 'string' || !inventory.owned.includes(character)) return;
  inventory.current = character;
  myCharacter = character;
  saveInventory();
  if (socket?.connected) socket.emit('appearance', character);
  broadcast('self:appearance', { character });
  console.log(`[equip] ${character}`);
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

// ---- 앱 라이프사이클 ----

// 패키징 + publish 설정(GitHub Releases 등)이 있을 때만 실제로 동작 — 없으면 조용히 스킵
function setupAutoUpdate(): void {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((err: unknown) => console.log('[update] check skipped:', String(err)));
  } catch {
    console.log('[update] electron-updater unavailable');
  }
}

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

app.on('window-all-closed', () => app.quit());

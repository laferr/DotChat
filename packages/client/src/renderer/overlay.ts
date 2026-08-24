// 오버레이 렌더러 — 작업표시줄 위를 걸어다니는 파츠 조합 캐릭터들 (본인 + 접속자)

interface NetPlayer {
  id: string;
  nickname: string;
  tag: string;
  appearance: Appearance;
  x: number; // 0~1 정규화
  dir: -1 | 1;
  walking: boolean;
}

interface NetChatMessage {
  id: string;
  nickname: string;
  tag: string;
  text: string;
  ts: number;
  image?: { url: string; thumb: string; w: number; h: number };
  action?: string;
  /** 메인 프로세스가 붙여주는 보낸 사람 외형 스냅샷 (채팅창 아바타용) */
  senderAppearance?: Appearance;
}

interface GiftClaimResult {
  isNew: boolean;
  kind: 'race' | 'part' | null;
  id: string | null;
  label: string | null;
  ownedCount: number;
  total: number;
}

interface OverlayApi {
  setInteractive(interactive: boolean): void;
  setTrayIcon(dataUrl: string): void;
  getManifest(): Promise<{
    cell: number;
    layers: Record<string, string[]>;
    races: { name: string; ears: boolean }[];
  } | null>;
  loadPart(layer: string, name: string): Promise<string | null>;
  getSelf(): Promise<{
    nickname: string;
    tag: string;
    appearance: Appearance;
    giftIntervalSec: number;
  }>;
  submitProfile(data: { nickname: string; tag: string }): Promise<{ ok: boolean; error?: string }>;
  cancelSetup(): void;
  getInventory(): Promise<{ version: number; owned: string[]; equipped: Appearance }>;
  getSettings(): Promise<{ opacity: number; scale: number; chatColor: string; serverUrl?: string }>;
  setOpacity(value: number): void;
  setScale(value: number): void;
  setChatColor(value: string): void;
  getNetState(): Promise<{
    selfId: string | null;
    connected: boolean;
    online: number;
    players: NetPlayer[];
  }>;
  getChatHistory(): Promise<NetChatMessage[]>;
  getUpdateState(): Promise<{ version: string } | null>;
  installUpdate(): void;
  sendMove(data: { x: number; dir: -1 | 1; walking: boolean }): void;
  sendChat(text: string): void;
  sendAction(command: string): void;
  sendImage(payload: {
    buffer: ArrayBuffer;
    mime: string;
    thumb: string;
    w: number;
    h: number;
  }): Promise<{ ok: boolean; error?: string }>;
  openImage(url: string): void;
  claimGift(): Promise<GiftClaimResult>;
  equip(payload: { slot: string; name: string | null; h?: number; s?: number; v?: number }): void;
  toggleChat(): void;
  closeChat(): void;
  on(channel: string, callback: (data: unknown) => void): void;
}
interface Window {
  overlay: OverlayApi;
}

let viewScale = 2; // 표시 배율 (옵션에서 1|2|3)
const WALK_SPEED_MIN = 30; // px/s — 걸을 때마다 이 범위에서 랜덤
const WALK_SPEED_MAX = 85;
const EDGE_MARGIN = 40;
const RUN_FPS = 10;
const IDLE_FPS = 1.6;
const HOVER_PAD = 8;
const MOVE_SEND_INTERVAL = 0.15; // 초
const REMOTE_LERP = 8;

// 캐릭터가 64px 셀 안에서 실제로 차지하는 대략적 영역 (히트박스/말풍선·닉네임 기준)
const ART_W = 26;
const ART_H = 33;

const BUBBLE_FONT = '12px "Segoe UI", "Malgun Gothic", sans-serif';
const NAME_FONT = '10px "Segoe UI", "Malgun Gothic", sans-serif';
const BUBBLE_MAX_WIDTH = 180;
const BUBBLE_MAX_LINES = 4;

// shared/protocol.ts의 bubbleDurationMs와 동일 (렌더러는 모듈을 못 쓰므로 중복 유지)
function bubbleMs(text: string): number {
  return Math.min(10, 5 + text.length * 0.05) * 1000;
}

const stage = document.getElementById('stage') as HTMLCanvasElement;
const stageCtx = stage.getContext('2d')!;

let viewW = 0;
let viewH = 0;

function resizeStage(): void {
  const dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  stage.width = Math.round(viewW * dpr);
  stage.height = Math.round(viewH * dpr);
  stage.style.width = `${viewW}px`;
  stage.style.height = `${viewH}px`;
  stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stageCtx.imageSmoothingEnabled = false;
}

// ---- 파츠 합성기 (composer.ts) ----

const partProvider: PartImageProvider = (layer, name) =>
  window.overlay.loadPart(layer, name).then((dataUrl) => {
    if (!dataUrl) return null;
    return new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  });

const composer = new PartComposer(partProvider);

// ---- 액터 (본인 + 원격 유저 공용) ----

interface Bubble {
  lines: string[];
  img: HTMLImageElement | null;
  imgW: number;
  imgH: number;
  until: number;
}

interface Actor {
  nickname: string;
  appearance: Appearance;
  appearanceKey: string;
  frames: ComposedFrames | null; // 합성 전 null
  x: number; // 중심 px
  targetX: number | null;
  dir: -1 | 1;
  walking: boolean;
  animClock: number;
  hopVy: number;
  hopY: number;
  bubble: Bubble | null;
  /** 재생 중인 액션 (/공격 등) */
  action: string | null;
  actionStart: number;
  actionUntil: number;
}

// 액션 재생 정의: loop = 반복, hold = 마지막 프레임 유지
const ACTION_MS = 3000;
const ACTION_PLAY: Record<string, { fps: number; mode: 'loop' | 'hold' }> = {
  slash: { fps: 10, mode: 'loop' },
  jab: { fps: 10, mode: 'loop' },
  shot: { fps: 8, mode: 'loop' },
  block: { fps: 6, mode: 'hold' },
  roll: { fps: 14, mode: 'loop' },
  jump: { fps: 8, mode: 'loop' },
  death: { fps: 6, mode: 'hold' },
  crawl: { fps: 8, mode: 'loop' },
  ready: { fps: 4, mode: 'loop' },
};

function actionActive(actor: Actor): boolean {
  return actor.action !== null && performance.now() < actor.actionUntil;
}

function playAction(actor: Actor, action: string): void {
  if (!ACTION_PLAY[action]) return;
  actor.action = action;
  actor.actionStart = performance.now();
  actor.actionUntil = actor.actionStart + ACTION_MS;
}

// 점프 액션 중엔 실제로 폴짝폴짝 (모든 액터 공통 훅)
function updateHop(actor: Actor, dt: number): void {
  if (actor.hopVy !== 0 || actor.hopY !== 0) {
    actor.hopVy += 700 * dt;
    actor.hopY += actor.hopVy * dt;
    if (actor.hopY >= 0) {
      actor.hopY = 0;
      actor.hopVy = 0;
    }
  }
  if (actionActive(actor) && actor.action === 'jump' && actor.hopY === 0 && actor.hopVy === 0) {
    actor.hopVy = -160;
  }
}

function setAppearance(actor: Actor, appearance: Appearance): void {
  const key = JSON.stringify(appearance);
  if (actor.appearanceKey === key && actor.frames) return;
  actor.appearance = appearance;
  actor.appearanceKey = key;
  composer.compose(appearance).then((frames) => {
    if (actor.appearanceKey === key) actor.frames = frames;
  });
}

function makeActor(nickname: string, appearance: Appearance, x: number): Actor {
  const actor: Actor = {
    nickname,
    appearance,
    appearanceKey: '',
    frames: null,
    x,
    targetX: null,
    dir: 1,
    walking: false,
    animClock: 0,
    hopVy: 0,
    hopY: 0,
    bubble: null,
    action: null,
    actionStart: 0,
    actionUntil: 0,
  };
  setAppearance(actor, appearance);
  return actor;
}

let me: Actor;
let selfId: string | null = null;
const remotes = new Map<string, Actor>();

// 발 위치: 셀 바닥에서 8px 위 → 셀 상단 y
function cellTop(actor: Actor): number {
  return viewH - (PH_CELL - PH_FOOT_OFFSET) * viewScale + actor.hopY;
}

function actorBox(actor: Actor): { x: number; y: number; w: number; h: number } {
  const w = ART_W * viewScale;
  const h = ART_H * viewScale;
  return { x: actor.x - w / 2, y: viewH - h + actor.hopY, w, h };
}

// ---- 본인 캐릭터 자율 이동 ----

type CharMode = 'walk' | 'idle';
let selfMode: CharMode = 'walk';
let selfModeTime = 2;
let selfSpeed = 55;

function randomWalkSpeed(): number {
  return WALK_SPEED_MIN + Math.random() * (WALK_SPEED_MAX - WALK_SPEED_MIN);
}

function pickNextMode(): void {
  if (Math.random() < 0.35) {
    selfMode = 'idle';
    selfModeTime = 1 + Math.random() * 2;
  } else {
    selfMode = 'walk';
    selfModeTime = 1.5 + Math.random() * 3;
    selfSpeed = randomWalkSpeed(); // 걷기 시작할 때마다 속도 랜덤
    if (Math.random() < 0.4) me.dir = me.dir === 1 ? -1 : 1;
  }
}

function updateSelf(dt: number): void {
  selfModeTime -= dt;
  if (selfModeTime <= 0) pickNextMode();

  me.animClock += dt;
  // 액션 재생 중엔 이동 정지
  if (actionActive(me)) {
    me.walking = false;
  } else {
    me.walking = selfMode === 'walk';
    if (me.walking) {
      me.x += me.dir * selfSpeed * dt;
      const minX = EDGE_MARGIN + (ART_W * viewScale) / 2;
      const maxX = viewW - EDGE_MARGIN - (ART_W * viewScale) / 2;
      if (me.x <= minX) {
        me.x = minX;
        me.dir = 1;
      } else if (me.x >= maxX) {
        me.x = maxX;
        me.dir = -1;
      }
    }
  }

  updateHop(me, dt);
}

// 서버로 내 위치 전송 (변화 있을 때만, 150ms 간격)
let moveSendTimer = 0;
let lastSent = { x: -1, dir: 0 as number, walking: false };

function sendMoveIfNeeded(dt: number): void {
  moveSendTimer += dt;
  if (moveSendTimer < MOVE_SEND_INTERVAL) return;
  moveSendTimer = 0;
  const norm = viewW > 0 ? me.x / viewW : 0.5;
  if (
    Math.abs(norm - lastSent.x) > 0.0005 ||
    me.dir !== lastSent.dir ||
    me.walking !== lastSent.walking
  ) {
    lastSent = { x: norm, dir: me.dir, walking: me.walking };
    window.overlay.sendMove({ x: norm, dir: me.dir, walking: me.walking });
  }
}

// ---- 원격 캐릭터 ----

function updateRemotes(dt: number): void {
  for (const actor of remotes.values()) {
    actor.animClock += dt;
    if (actor.targetX !== null && !actionActive(actor)) {
      const diff = actor.targetX - actor.x;
      if (Math.abs(diff) < 0.5) {
        actor.x = actor.targetX;
      } else {
        actor.x += diff * Math.min(1, dt * REMOTE_LERP);
      }
    }
    updateHop(actor, dt);
  }
}

function addRemote(p: NetPlayer): void {
  if (p.id === selfId || remotes.has(p.id)) return;
  const actor = makeActor(p.nickname, p.appearance, p.x * viewW);
  actor.dir = p.dir;
  actor.walking = p.walking;
  actor.targetX = p.x * viewW;
  remotes.set(p.id, actor);
}

// ---- 그리기 ----

function currentFrame(actor: Actor): HTMLCanvasElement | null {
  if (!actor.frames) return null;
  if (actionActive(actor)) {
    const anim = actor.frames.anims[actor.action!];
    const play = ACTION_PLAY[actor.action!];
    if (anim && play) {
      const t = (performance.now() - actor.actionStart) / 1000;
      const raw = Math.floor(t * play.fps);
      const idx = play.mode === 'loop' ? raw % anim.length : Math.min(raw, anim.length - 1);
      return anim[idx];
    }
  }
  if (actor.walking) {
    const idx = Math.floor(actor.animClock * RUN_FPS) % actor.frames.run.length;
    return actor.frames.run[idx];
  }
  const idx = Math.floor(actor.animClock * IDLE_FPS) % actor.frames.idle.length;
  return actor.frames.idle[idx];
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  stageCtx.beginPath();
  stageCtx.moveTo(x + r, y);
  stageCtx.arcTo(x + w, y, x + w, y + h, r);
  stageCtx.arcTo(x + w, y + h, x, y + h, r);
  stageCtx.arcTo(x, y + h, x, y, r);
  stageCtx.arcTo(x, y, x + w, y, r);
  stageCtx.closePath();
}

function drawBubble(actor: Actor, now: number): void {
  const bubble = actor.bubble;
  if (!bubble) return;
  if (now >= bubble.until) {
    actor.bubble = null;
    return;
  }

  stageCtx.font = BUBBLE_FONT;
  const lineHeight = 15;
  const padX = 8;
  const padY = 6;
  let w: number;
  let h: number;
  if (bubble.img) {
    w = bubble.imgW + padX * 2;
    h = bubble.imgH + padY * 2;
  } else {
    let textW = 0;
    for (const line of bubble.lines) {
      textW = Math.max(textW, stageCtx.measureText(line).width);
    }
    w = Math.ceil(textW) + padX * 2;
    h = bubble.lines.length * lineHeight + padY * 2;
  }
  const box = actorBox(actor);
  let bx = actor.x - w / 2;
  bx = Math.max(4, Math.min(viewW - w - 4, bx));
  const by = box.y - h - 9;

  // 남은 0.3초 동안 페이드아웃
  const remain = (bubble.until - now) / 1000;
  stageCtx.globalAlpha = Math.min(1, remain / 0.3);

  stageCtx.fillStyle = '#fffdf7';
  stageCtx.strokeStyle = '#4a2837';
  stageCtx.lineWidth = 1.5;
  roundRect(bx, by, w, h, 6);
  stageCtx.fill();
  stageCtx.stroke();

  // 꼬리
  stageCtx.beginPath();
  stageCtx.moveTo(actor.x - 4, by + h);
  stageCtx.lineTo(actor.x + 4, by + h);
  stageCtx.lineTo(actor.x, by + h + 6);
  stageCtx.closePath();
  stageCtx.fill();
  stageCtx.stroke();
  // 꼬리와 본체 사이 경계선 지우기
  stageCtx.fillRect(actor.x - 3.5, by + h - 2, 7, 3);

  if (bubble.img) {
    if (bubble.img.complete && bubble.img.naturalWidth > 0) {
      stageCtx.imageSmoothingEnabled = true; // 사진 썸네일은 부드럽게
      stageCtx.drawImage(bubble.img, bx + padX, by + padY, bubble.imgW, bubble.imgH);
      stageCtx.imageSmoothingEnabled = false;
    }
  } else {
    stageCtx.fillStyle = '#3a2430';
    bubble.lines.forEach((line, i) => {
      stageCtx.fillText(line, bx + padX, by + padY + (i + 1) * lineHeight - 4);
    });
  }
  stageCtx.globalAlpha = 1;
}

function drawName(actor: Actor): void {
  if (actor.bubble) return;
  stageCtx.font = NAME_FONT;
  const box = actorBox(actor);
  const w = stageCtx.measureText(actor.nickname).width;
  const x = actor.x - w / 2;
  const y = box.y - 5;
  stageCtx.globalAlpha = 0.9;
  stageCtx.strokeStyle = 'rgba(0,0,0,0.7)';
  stageCtx.lineWidth = 3;
  stageCtx.strokeText(actor.nickname, x, y);
  stageCtx.fillStyle = '#fffdf7';
  stageCtx.fillText(actor.nickname, x, y);
  stageCtx.globalAlpha = 1;
}

function drawActor(actor: Actor, now: number): void {
  const frame = currentFrame(actor);
  if (!frame) return;
  const size = PH_CELL * viewScale;
  const top = cellTop(actor);
  const left = Math.round(actor.x - size / 2);

  // 발밑 그림자
  stageCtx.save();
  stageCtx.globalAlpha = 0.18;
  stageCtx.fillStyle = '#000';
  stageCtx.beginPath();
  stageCtx.ellipse(actor.x, viewH - 2, ART_W * viewScale * 0.45, 2.5, 0, 0, Math.PI * 2);
  stageCtx.fill();
  stageCtx.restore();

  if (actor.dir === -1) {
    // 기본 시트는 오른쪽 보기 → 왼쪽 이동 시 미러
    stageCtx.save();
    stageCtx.translate(left + size, Math.round(top));
    stageCtx.scale(-1, 1);
    stageCtx.drawImage(frame, 0, 0, size, size);
    stageCtx.restore();
  } else {
    stageCtx.drawImage(frame, left, Math.round(top), size, size);
  }
  drawName(actor);
  drawBubble(actor, now);
}

function wrapText(text: string): string[] {
  stageCtx.font = BUBBLE_FONT;
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    if (ch === '\n' || stageCtx.measureText(current + ch).width > BUBBLE_MAX_WIDTH) {
      lines.push(current);
      current = ch === '\n' ? '' : ch;
      if (lines.length === BUBBLE_MAX_LINES) {
        lines[BUBBLE_MAX_LINES - 1] = lines[BUBBLE_MAX_LINES - 1].slice(0, -1) + '…';
        return lines;
      }
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function showBubble(actor: Actor, text: string): void {
  actor.bubble = {
    lines: wrapText(text),
    img: null,
    imgW: 0,
    imgH: 0,
    until: performance.now() + bubbleMs(text),
  };
}

const IMAGE_BUBBLE_MS = 7000;
const IMAGE_BUBBLE_MAX_W = 110;
const IMAGE_BUBBLE_MAX_H = 90;

function showImageBubble(actor: Actor, image: { thumb: string; w: number; h: number }): void {
  const img = new Image();
  img.src = image.thumb;
  const srcW = image.w || IMAGE_BUBBLE_MAX_W;
  const srcH = image.h || IMAGE_BUBBLE_MAX_H;
  const scale = Math.min(IMAGE_BUBBLE_MAX_W / srcW, IMAGE_BUBBLE_MAX_H / srcH, 1);
  actor.bubble = {
    lines: [],
    img,
    imgW: Math.max(24, Math.round(srcW * scale)),
    imgH: Math.max(24, Math.round(srcH * scale)),
    until: performance.now() + IMAGE_BUBBLE_MS,
  };
}

// ---- 하트 파티클 (클릭 리액션) ----

interface Heart {
  x: number;
  y: number;
  vy: number;
  wobblePhase: number;
  life: number;
}

const HEART_GRID = ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'];
let heartCanvas: HTMLCanvasElement;
const hearts: Heart[] = [];

function buildHeartCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 7;
  canvas.height = 6;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ff5a76';
  HEART_GRID.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'r') ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

function spawnHearts(cx: number, topY: number): void {
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    hearts.push({
      x: cx + (Math.random() - 0.5) * 44,
      y: topY + Math.random() * 8,
      vy: -(28 + Math.random() * 20),
      wobblePhase: Math.random() * Math.PI * 2,
      life: 1,
    });
  }
}

function updateHearts(dt: number): void {
  for (let i = hearts.length - 1; i >= 0; i--) {
    const heart = hearts[i];
    heart.y += heart.vy * dt;
    heart.life -= dt * 0.9;
    if (heart.life <= 0) hearts.splice(i, 1);
  }
}

function drawHearts(time: number): void {
  for (const heart of hearts) {
    const wobble = Math.sin(time / 180 + heart.wobblePhase) * 3;
    stageCtx.globalAlpha = Math.max(0, Math.min(1, heart.life));
    stageCtx.drawImage(heartCanvas, Math.round(heart.x + wobble), Math.round(heart.y), 7, 6);
  }
  stageCtx.globalAlpha = 1;
}

// ---- 선물상자 (클라이언트 로컬 스폰, 각자 독립 획득) ----

const GIFT_SCALE = 2;
const GIFT_PALETTE: Record<string, string> = {
  k: '#4a2837',
  r: '#d94f63',
  R: '#a23352',
  y: '#ffd66e',
  Y: '#d9a63e',
};
const GIFT_GRID = [
  '..yyy..yyy..',
  '..yyyYYyyy..',
  'kkkkkYYkkkkk',
  'krrrrYYrrrrk',
  'kkkkkYYkkkkk',
  'krrrrYYrrrrk',
  'krrrrYYrrrrk',
  'kRrrrYYrrrRk',
  'kRRrrYYrrRRk',
  'kkkkkkkkkkkk',
];

let giftCanvas: HTMLCanvasElement;
let giftIntervalSec = 180;
let giftTimer = 0;
const gift = { present: false, x: 0, altitude: 0, vel: 0, landed: false };

function buildGiftCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = GIFT_GRID[0].length;
  canvas.height = GIFT_GRID.length;
  const ctx = canvas.getContext('2d')!;
  GIFT_GRID.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = GIFT_PALETTE[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

function spawnGift(): void {
  const margin = 60;
  gift.present = true;
  gift.x = margin + Math.random() * Math.max(50, viewW - margin * 2);
  gift.altitude = 160; // 위에서 떨어지며 등장
  gift.vel = 0;
  gift.landed = false;
  console.log('[overlay] gift spawned');
}

function updateGift(dt: number): void {
  if (!gift.present) {
    giftTimer += dt;
    if (giftTimer >= giftIntervalSec) {
      giftTimer = 0;
      spawnGift();
    }
    return;
  }
  if (!gift.landed) {
    gift.vel += 600 * dt;
    gift.altitude -= gift.vel * dt;
    if (gift.altitude <= 0) {
      gift.altitude = 0;
      if (gift.vel > 90) {
        gift.vel = -gift.vel * 0.35; // 한 번 통통 튀고 착지
      } else {
        gift.vel = 0;
        gift.landed = true;
      }
    }
  }
}

function giftRect(): { x: number; y: number; w: number; h: number } {
  const w = GIFT_GRID[0].length * GIFT_SCALE;
  const h = GIFT_GRID.length * GIFT_SCALE;
  return { x: gift.x - w / 2, y: viewH - h - 2 - gift.altitude, w, h };
}

function drawGift(time: number): void {
  if (!gift.present) return;
  const r = giftRect();
  stageCtx.globalAlpha = gift.landed ? 0.88 + 0.12 * Math.sin(time / 250) : 1;
  stageCtx.drawImage(giftCanvas, Math.round(r.x), Math.round(r.y), r.w, r.h);
  stageCtx.globalAlpha = 1;
}

async function claimGift(): Promise<void> {
  const r = giftRect();
  gift.present = false;
  giftTimer = 0;
  spawnHearts(gift.x, r.y);
  const result = await window.overlay.claimGift();
  if (result.isNew && result.label) {
    showBubble(me, `🎁 '${result.label}' 획득! (${result.ownedCount}/${result.total})`);
  } else {
    showBubble(me, '이미 모든 파츠를 다 모았어요!');
  }
}

// ---- 채팅 버튼 (우측 하단) ----

const CHAT_BTN = { w: 38, h: 30, marginX: 10, marginY: 6 };
let chatBtnHover = false;

function chatBtnRect(): { x: number; y: number; w: number; h: number } {
  return {
    x: viewW - CHAT_BTN.w - CHAT_BTN.marginX,
    y: viewH - CHAT_BTN.h - CHAT_BTN.marginY,
    w: CHAT_BTN.w,
    h: CHAT_BTN.h,
  };
}

function drawChatButton(): void {
  const r = chatBtnRect();
  stageCtx.globalAlpha = chatBtnHover ? 1 : 0.85;
  stageCtx.fillStyle = chatBtnHover ? '#6b3b52' : '#4a2837';
  stageCtx.strokeStyle = '#fffdf7';
  stageCtx.lineWidth = 1.5;
  roundRect(r.x, r.y, r.w, r.h, 7);
  stageCtx.fill();
  stageCtx.stroke();
  // 말풍선 점 3개
  stageCtx.fillStyle = '#fffdf7';
  const cy = r.y + r.h / 2;
  for (const dx of [-8, 0, 8]) {
    stageCtx.beginPath();
    stageCtx.arc(r.x + r.w / 2 + dx, cy, 2, 0, Math.PI * 2);
    stageCtx.fill();
  }
  stageCtx.globalAlpha = 1;
}

// ---- 마우스: 캐릭터/버튼/선물 위에서만 클릭 받기 ----

let mouseX = -1;
let mouseY = -1;
let interactive = false;
let selfHover = false;
let giftHover = false;

function pointIn(r: { x: number; y: number; w: number; h: number }, pad: number): boolean {
  return (
    mouseX >= r.x - pad && mouseX <= r.x + r.w + pad && mouseY >= r.y - pad && mouseY <= r.y + r.h + pad
  );
}

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

function updateInteractive(): void {
  selfHover = pointIn(actorBox(me), HOVER_PAD);
  chatBtnHover = pointIn(chatBtnRect(), 2);
  giftHover = gift.present && pointIn(giftRect(), 4);
  const over = selfHover || chatBtnHover || giftHover;
  if (over !== interactive) {
    interactive = over;
    window.overlay.setInteractive(over);
    document.body.style.cursor = over ? 'pointer' : 'default';
  }
}

window.addEventListener('mousedown', () => {
  if (chatBtnHover) {
    window.overlay.toggleChat();
    return;
  }
  if (giftHover) {
    void claimGift();
    return;
  }
  if (selfHover) {
    if (me.hopY === 0) me.hopVy = -130;
    spawnHearts(me.x, actorBox(me).y);
  }
});

// ---- 트레이 아이콘: 합성된 idle 프레임의 상반신 크롭 ----

function sendTrayIcon(): void {
  if (!me.frames) return;
  const icon = phMakeFace(me.frames.idle[0]);
  window.overlay.setTrayIcon(icon.toDataURL('image/png'));
}

// ---- 설정 ----

function applySettings(s: { opacity: number; scale: number }): void {
  stage.style.opacity = String(Math.min(1, Math.max(0.1, s.opacity)));
  if ([1, 2, 3].includes(s.scale)) viewScale = s.scale;
}

// ---- 네트워크 이벤트 ----

function wireNet(): void {
  window.overlay.on('net:welcome', (data) => {
    const d = data as { selfId: string; players: NetPlayer[] };
    selfId = d.selfId;
    remotes.clear();
    d.players.forEach(addRemote);
    console.log(`[overlay] welcome: ${d.players.length}명`);
  });

  window.overlay.on('net:player-joined', (data) => {
    addRemote(data as NetPlayer);
  });

  window.overlay.on('net:player-moved', (data) => {
    const d = data as { id: string } & NetPlayer;
    const actor = remotes.get(d.id);
    if (!actor) return;
    actor.targetX = d.x * viewW;
    actor.dir = d.dir;
    actor.walking = d.walking;
  });

  window.overlay.on('net:player-left', (data) => {
    remotes.delete(data as string);
  });

  window.overlay.on('net:reset', () => {
    remotes.clear();
  });

  window.overlay.on('net:chat', (data) => {
    const msg = data as NetChatMessage;
    const actor = msg.id === selfId ? me : remotes.get(msg.id);
    if (!actor) return;
    if (msg.action) playAction(actor, msg.action);
    if (msg.image) showImageBubble(actor, msg.image);
    else if (msg.text) showBubble(actor, msg.text);
  });

  window.overlay.on('net:player-appearance', (data) => {
    const d = data as { id: string; appearance: Appearance };
    const actor = remotes.get(d.id);
    if (actor) setAppearance(actor, d.appearance);
  });

  window.overlay.on('self:appearance', (data) => {
    const d = data as { appearance: Appearance };
    setAppearance(me, d.appearance);
    // 합성 완료 후 트레이 아이콘 갱신
    composer.compose(d.appearance).then(() => sendTrayIcon());
  });

  window.overlay.on('self:settings', (data) => {
    applySettings(data as { opacity: number; scale: number });
  });
}

// ---- 메인 루프 ----

let lastTime = 0;

function tick(time: number): void {
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  updateSelf(dt);
  updateRemotes(dt);
  updateGift(dt);
  updateHearts(dt);
  updateInteractive();
  sendMoveIfNeeded(dt);

  stageCtx.clearRect(0, 0, viewW, viewH);
  const now = performance.now();
  drawGift(time);
  for (const actor of remotes.values()) drawActor(actor, now);
  drawActor(me, now);
  drawHearts(time);
  drawChatButton();

  requestAnimationFrame(tick);
}

window.addEventListener('error', (e) => {
  console.log(`[overlay-error] ${e.message}`);
});

async function init(): Promise<void> {
  resizeStage();
  window.addEventListener('resize', resizeStage);

  applySettings(await window.overlay.getSettings());

  const myInfo = await window.overlay.getSelf();
  giftIntervalSec = myInfo.giftIntervalSec;
  me = makeActor(myInfo.nickname, myInfo.appearance, 150 + Math.random() * Math.max(200, viewW - 300));
  await composer.compose(myInfo.appearance).then((frames) => {
    me.frames = frames;
  });
  sendTrayIcon();
  console.log(
    `[overlay] self '${myInfo.nickname}' race=${myInfo.appearance.race.name}, gift every ${giftIntervalSec}s, scale x${viewScale}`,
  );

  wireNet();
  const state = await window.overlay.getNetState();
  selfId = state.selfId;
  state.players.forEach(addRemote);

  heartCanvas = buildHeartCanvas();
  giftCanvas = buildGiftCanvas();
  console.log(`[overlay] ready, viewport ${viewW}x${viewH}`);
  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(tick);
  });
}

init().catch((err) => {
  console.log(`[overlay-error] ${err instanceof Error ? err.message : String(err)}`);
});

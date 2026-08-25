// 오버레이 렌더러 — 작업표시줄 위를 걸어다니는 파츠 조합 캐릭터들 (본인 + 접속자)

interface NetPlayer {
  id: string;
  nickname: string;
  tag: string;
  appearance: Appearance;
  x: number; // 0~1 정규화
  dir: -1 | 1;
  walking: boolean;
  lastReadTs: number;
  pinned?: string;
}

interface NetChatMessage {
  id: string;
  nickname: string;
  tag: string;
  text: string;
  ts: number;
  image?: { url: string; thumb: string; w: number; h: number };
  action?: string;
  reaction?: number;
  /** 메인 프로세스가 붙여주는 보낸 사람 외형 스냅샷 (채팅창 아바타용) */
  senderAppearance?: Appearance;
}

interface EffectDef {
  id: string;
  file: string;
  fw: number;
  fh: number;
  cols: number;
  count: number;
  scale?: number;
  dy?: number;
  mode?: string;
}

interface ExtrasManifest {
  fish: string[];
  /** 새 물고기 (단일 이미지, fish2/) — box/treasure_chest 특수 어획물 포함 */
  fish2?: string[];
  tools: { frameW: number; frameH: number; strips: Record<string, number>; files: Record<string, string> };
  reaction: { cell: number; cols: number; rows: number };
  effects?: EffectDef[];
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
  getSettings(): Promise<{
    opacity: number;
    scale: number;
    chatColor: string;
    pinnedMsg: string;
    pinnedOn: boolean;
    serverUrl?: string;
  }>;
  setOpacity(value: number): void;
  setScale(value: number): void;
  setChatColor(value: string): void;
  setPinned(data: { text: string; enabled: boolean }): void;
  getDisplays(): Promise<
    { id: number; index: number; width: number; height: number; primary: boolean; current: boolean }[]
  >;
  setDisplay(id: number): void;
  getNetState(): Promise<{
    selfId: string | null;
    connected: boolean;
    online: number;
    players: NetPlayer[];
  }>;
  getChatHistory(): Promise<NetChatMessage[]>;
  getUpdateState(): Promise<{ version: string; ready: boolean } | null>;
  installUpdate(): void;
  sendMove(data: { x: number; dir: -1 | 1; walking: boolean }): void;
  sendChat(text: string): void;
  sendAction(command: string): void;
  markRead(ts: number): void;
  sendImage(payload: {
    buffer: ArrayBuffer;
    mime: string;
    thumb: string;
    w: number;
    h: number;
  }): Promise<{ ok: boolean; error?: string }>;
  openImage(url: string): void;
  claimGift(): Promise<GiftClaimResult>;
  getCoins(): Promise<number>;
  playSlot(): Promise<unknown>;
  getWallet(): Promise<{ coins: number; items: string[] }>;
  buyItem(itemId: string): Promise<unknown>;
  getRanking(): Promise<unknown[]>;
  getExtras(): Promise<ExtrasManifest | null>;
  loadExtra(relPath: string): Promise<string | null>;
  getMinigameState(): Promise<{ runnerRemainSec: number }>;
  startMinigame(game: string): Promise<{ ok: boolean; error?: string }>;
  sendFishing(data: { phase: string; fishId?: string; trophy?: boolean }): void;
  reportFish(fishId: string, trophy?: boolean): Promise<{
    ok: boolean;
    error?: string;
    isNew?: boolean;
    delta?: number;
    trophy?: boolean;
    item?: { id: string; name: string };
  }>;
  buyRandom(itemId: string): Promise<{ ok: boolean; error?: string; label?: string; coins?: number }>;
  endRunner(seconds: number): Promise<{ ok: boolean; error?: string; delta?: number }>;
  sendReaction(index: number): void;
  equip(payload: { slot: string; name: string | null; h?: number; s?: number; v?: number }): void;
  toggleChat(): void;
  closeChat(): void;
  toggleFishdex(): void;
  closeFishdex(): void;
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

// 머리 위 고정메시지 (꼬리 없는 말풍선)
const PINNED_FONT = '11px "Segoe UI", "Malgun Gothic", sans-serif';
const PINNED_MAX_WIDTH = 140;
const PINNED_MAX_LINES = 2;

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
  // 디스플레이 전환 등으로 뷰포트가 좁아졌을 때 캐릭터가 화면 밖에 남지 않도록
  if (me) {
    const minX = EDGE_MARGIN + (ART_W * viewScale) / 2;
    const maxX = viewW - EDGE_MARGIN - (ART_W * viewScale) / 2;
    me.x = Math.max(minX, Math.min(maxX, me.x));
  }
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
  /** 머리 위 고정메시지 (빈 문자열 = 없음) */
  pinned: string;
  /** 재생 중인 액션 (/공격 등) */
  action: string | null;
  actionStart: number;
  actionUntil: number;
  /** 낚시 상태 (본인/원격 공용, 원격은 이벤트로 위상 전환) */
  fishing: {
    phase: string;
    phaseStart: number;
    fishId: string | null;
    dir: -1 | 1;
    waitDur?: number;
    reelDur?: number;
    /** 월척 — 낚아올리는 스프라이트 3배 */
    trophy?: boolean;
  } | null;
  /** 리액션 이모지 표시 */
  reaction: { index: number; until: number } | null;
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
    pinned: '',
    action: null,
    actionStart: 0,
    actionUntil: 0,
    fishing: null,
    reaction: null,
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
  // 러너 모드: 제자리 달리기 (이동/배회 억제)
  if (runnerState.active) {
    me.walking = !runnerState.dead;
    me.dir = 1;
    updateHop(me, dt);
    return;
  }
  // 낚시/액션 중엔 이동 정지
  if (me.fishing) {
    me.walking = false;
  } else if (actionActive(me)) {
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
  actor.pinned = p.pinned ?? '';
  remotes.set(p.id, actor);
}

// ---- 그리기 ----

function currentFrame(actor: Actor): HTMLCanvasElement | null {
  if (!actor.frames) return null;
  // 러너 모드 (본인 전용): 점프/엎드리기 포즈
  if (actor === me && runnerState.active && !runnerState.dead) {
    if (me.hopY !== 0) {
      const jump = actor.frames.anims.jump;
      if (jump) return jump[Math.min(1, jump.length - 1)];
    }
    if (runnerDucking(performance.now())) {
      const crawl = actor.frames.anims.crawl;
      if (crawl) return crawl[Math.floor(actor.animClock * 8) % crawl.length];
    }
  }
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

  const bubbleStyle = BUBBLE_STYLES[actor.appearance.bubbleSkin ?? ''] ?? BUBBLE_STYLES.default;
  stageCtx.fillStyle = bubbleStyle.fill;
  stageCtx.strokeStyle = bubbleStyle.stroke;
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
    stageCtx.fillStyle = bubbleStyle.text;
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
  stageCtx.fillStyle = actor.appearance.nameColor ?? '#fffdf7';
  stageCtx.fillText(actor.nickname, x, y);
  stageCtx.globalAlpha = 1;
}

// 머리 위 고정메시지 — 꼬리 없는 말풍선, 닉네임 위에 상시 표시.
// 채팅 말풍선/리액션이 떠 있는 동안엔 숨고, 사라지면 다시 나타난다.
function drawPinned(actor: Actor, now: number): void {
  if (!actor.pinned || actor.bubble) return;
  if (actor.reaction && now < actor.reaction.until) return;
  if (actor === me && runnerState.active) return;

  const lines = wrapText(actor.pinned, PINNED_MAX_WIDTH, PINNED_MAX_LINES, PINNED_FONT);
  if (lines.length === 0) return;
  stageCtx.font = PINNED_FONT;
  const lineHeight = 14;
  const padX = 7;
  const padY = 4;
  let textW = 0;
  for (const line of lines) textW = Math.max(textW, stageCtx.measureText(line).width);
  const w = Math.ceil(textW) + padX * 2;
  const h = lines.length * lineHeight + padY * 2;
  const box = actorBox(actor);
  // 닉네임(원격은 그 위의 '낚시중' 표시까지) 위로 띄운다
  const above = box.y - 15 - (actor.fishing && actor !== me ? 13 : 0);
  const bx = Math.max(4, Math.min(viewW - w - 4, actor.x - w / 2));
  const by = above - h - 2;

  const style = BUBBLE_STYLES[actor.appearance.bubbleSkin ?? ''] ?? BUBBLE_STYLES.default;
  stageCtx.globalAlpha = 0.92;
  stageCtx.fillStyle = style.fill;
  stageCtx.strokeStyle = style.stroke;
  stageCtx.lineWidth = 1.5;
  roundRect(bx, by, w, h, 7);
  stageCtx.fill();
  stageCtx.stroke();
  stageCtx.fillStyle = style.text;
  lines.forEach((line, i) => {
    stageCtx.fillText(line, bx + padX, by + padY + (i + 1) * lineHeight - 3.5);
  });
  stageCtx.globalAlpha = 1;
}

// 이펙트 시트 오오라 (상점 프리미엄) — 캐릭터 중심에 애니메이션 시트 재생
const effectSheets = new Map<string, HTMLImageElement | null>();

function drawFxAura(actor: Actor, time: number, effectId: string): void {
  if (!extras?.effects) return;
  const def = extras.effects.find((e) => e.id === effectId);
  if (!def) return;
  if (!effectSheets.has(effectId)) {
    effectSheets.set(effectId, null);
    void loadExtraImage(`effects/${def.file}`).then((img) => effectSheets.set(effectId, img));
  }
  const sheet = effectSheets.get(effectId);
  if (!sheet) return;
  const vs = viewScale;
  const size = 46 * (def.scale ?? 1) * vs; // 캐릭터를 감싸는 크기
  const cx = actor.x;
  const cy = viewH - (ART_H / 2) * vs + (def.dy ?? 0) * vs + actor.hopY;
  stageCtx.save();
  stageCtx.globalAlpha = 0.85;
  if (def.mode === 'scroll') {
    // 단일 텍스처를 원형 마스크 안에서 위로 스크롤 (독기포 상승 연출)
    stageCtx.beginPath();
    stageCtx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    stageCtx.clip();
    const t = size / 150; // 텍스처의 ~150px 창을 표시
    const dw = def.fw * t;
    const dh = def.fh * t;
    const scroll = ((time * 0.025) % def.fh) * t;
    const dx = cx - dw / 2;
    const baseY = cy - dh / 2 - scroll;
    stageCtx.drawImage(sheet, dx, baseY, dw, dh);
    stageCtx.drawImage(sheet, dx, baseY + dh, dw, dh);
  } else {
    const frame = Math.floor(time / 85) % def.count;
    const sx = (frame % def.cols) * def.fw;
    const sy = Math.floor(frame / def.cols) * def.fh;
    stageCtx.drawImage(
      sheet,
      sx,
      sy,
      def.fw,
      def.fh,
      Math.round(cx - size / 2),
      Math.round(cy - size / 2),
      size,
      size,
    );
  }
  stageCtx.restore();
}

// 오오라: 발밑 글로우 + 떠오르는 반짝이 (상태 없이 시간 기반)
function drawAura(actor: Actor, time: number): void {
  const auraId = actor.appearance.aura;
  if (!auraId) return;
  if (auraId.startsWith('aura-fx-')) {
    drawFxAura(actor, time, auraId.slice(8));
    return;
  }
  if (!(auraId in AURA_COLORS)) return;
  const colors = AURA_COLORS[auraId];
  const main = colors ? colors[0] : `hsl(${(time / 15) % 360} 85% 60%)`;
  const glow = colors ? colors[1] : `hsl(${(time / 15 + 90) % 360} 85% 75%)`;
  const box = actorBox(actor);

  stageCtx.save();
  stageCtx.globalAlpha = 0.22 + 0.08 * Math.sin(time / 320);
  stageCtx.fillStyle = main;
  stageCtx.beginPath();
  stageCtx.ellipse(actor.x, viewH - 3, box.w * 0.85, 4 * viewScale, 0, 0, Math.PI * 2);
  stageCtx.fill();

  const size = Math.max(2, Math.round(viewScale * 1.5));
  for (let i = 0; i < 6; i++) {
    const rise = ((time / 16 + i * 41) % 110) / 110; // 0→1 상승 후 리셋
    const px = actor.x + Math.cos(time / 600 + i * 2.1) * box.w * 0.6;
    const py = viewH - 6 - rise * box.h * 1.15;
    stageCtx.globalAlpha = 0.85 * (1 - rise);
    stageCtx.fillStyle = i % 2 ? main : glow;
    stageCtx.fillRect(Math.round(px), Math.round(py), size, size);
  }
  stageCtx.restore();
}

function drawActor(actor: Actor, now: number): void {
  const frame = currentFrame(actor);
  if (!frame) return;
  drawAura(actor, now);
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
  drawFishing(actor, now);
  drawName(actor);
  drawPinned(actor, now);
  // 원격 낚시꾼 머리 위 '낚시중 ...' 표시
  if (actor.fishing && actor !== me && !actor.bubble) {
    const dots = '.'.repeat(1 + (Math.floor(now / 500) % 3));
    stageCtx.font = NAME_FONT;
    const label = `낚시중 ${dots}`;
    const w = stageCtx.measureText(label).width;
    const box = actorBox(actor);
    stageCtx.strokeStyle = 'rgba(0,0,0,0.7)';
    stageCtx.lineWidth = 3;
    stageCtx.strokeText(label, actor.x - w / 2, box.y - 18);
    stageCtx.fillStyle = '#9fdcff';
    stageCtx.fillText(label, actor.x - w / 2, box.y - 18);
  }
  drawBubble(actor, now);
  drawReaction(actor, now);
}

function wrapText(
  text: string,
  maxWidth = BUBBLE_MAX_WIDTH,
  maxLines = BUBBLE_MAX_LINES,
  font = BUBBLE_FONT,
): string[] {
  stageCtx.font = font;
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    if (ch === '\n' || stageCtx.measureText(current + ch).width > maxWidth) {
      lines.push(current);
      current = ch === '\n' ? '' : ch;
      if (lines.length === maxLines) {
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
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

// ---- 미니게임 에셋 ----

let extras: ExtrasManifest | null = null;
const rodStrips: Record<string, HTMLImageElement | null> = {};
const fishReady = new Map<string, HTMLImageElement | null>();
let reactionSheet: HTMLImageElement | null = null;
let arrowSprite: HTMLCanvasElement | null = null; // 하단 좌측 가로 화살 (bbox 트림)
let trapImg: HTMLImageElement | null = null;

// 화살 시트(16px 셀 12x3)의 하단 좌측 셀에서 실제 픽셀 영역만 잘라냄
function buildArrowSprite(img: HTMLImageElement): HTMLCanvasElement | null {
  const cell = document.createElement('canvas');
  cell.width = 16;
  cell.height = 16;
  const cctx = cell.getContext('2d')!;
  cctx.drawImage(img, 0, 32, 16, 16, 0, 0, 16, 16);
  const data = cctx.getImageData(0, 0, 16, 16).data;
  let minX = 16;
  let minY = 16;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (data[(y * 16 + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const sprite = document.createElement('canvas');
  sprite.width = maxX - minX + 1;
  sprite.height = maxY - minY + 1;
  sprite.getContext('2d')!.drawImage(cell, minX, minY, sprite.width, sprite.height, 0, 0, sprite.width, sprite.height);
  return sprite;
}

function loadExtraImage(rel: string): Promise<HTMLImageElement | null> {
  return window.overlay.loadExtra(rel).then((dataUrl) => {
    if (!dataUrl) return null;
    return new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  });
}

// 새 물고기(fish2)는 단일 이미지, 구 물고기(fish)는 64x16 4프레임 스트립
function isFish2(id: string): boolean {
  return extras?.fish2?.includes(id) === true;
}

function loadFishImage(id: string): void {
  if (fishReady.has(id)) return;
  fishReady.set(id, null);
  const rel = isFish2(id) ? `fish2/${id}.png` : `fish/${id}.png`;
  void loadExtraImage(rel).then((img) => fishReady.set(id, img));
}

// 어획물 롤 — 상자 0.5% / 보물상자 0.2% 고정, 나머지는 전체 물고기 균등
function rollFishCatch(): string {
  const fish2 = extras?.fish2 ?? [];
  const roll = Math.random() * 100;
  if (roll < 0.2 && fish2.includes('treasure_chest')) return 'treasure_chest';
  if (roll < 0.7 && fish2.includes('box')) return 'box';
  const pool = [...(extras?.fish ?? []), ...fish2.filter((f) => f !== 'box' && f !== 'treasure_chest')];
  return pool[Math.floor(Math.random() * pool.length)];
}

async function initExtras(): Promise<void> {
  extras = await window.overlay.getExtras();
  if (!extras) return;
  const jobs: Promise<unknown>[] = [
    loadExtraImage('reaction.png').then((img) => (reactionSheet = img)),
    loadExtraImage('rungame/Arrow.png').then((img) => (arrowSprite = img ? buildArrowSprite(img) : null)),
    loadExtraImage('rungame/Trap3.png').then((img) => (trapImg = img)),
  ];
  for (const [phase, file] of Object.entries(extras.tools.files)) {
    jobs.push(loadExtraImage(`tools/${file}`).then((img) => (rodStrips[phase] = img)));
  }
  await Promise.all(jobs);
}

// ---- 낚시 ----

const FISHING_PLAY: Record<string, { fps: number; once: boolean }> = {
  casting: { fps: 12, once: true },
  waiting: { fps: 6, once: false },
  reeling: { fps: 12, once: false },
  caught: { fps: 10, once: true },
};
const CAUGHT_DURATION = 1.7;

function setSelfFishingPhase(phase: string, fishId?: string, trophy?: boolean): void {
  if (!me.fishing) return;
  me.fishing.phase = phase;
  me.fishing.phaseStart = performance.now();
  me.fishing.fishId = fishId ?? null;
  me.fishing.trophy = trophy === true;
  if (phase === 'waiting') me.fishing.waitDur = 10 + Math.random() * 5;
  if (phase === 'reeling') me.fishing.reelDur = 1 + Math.random();
  window.overlay.sendFishing({ phase, fishId, trophy });
}

function startFishing(): void {
  if (runnerState.active || !extras) return;
  me.fishing = { phase: 'casting', phaseStart: performance.now(), fishId: null, dir: me.dir };
  window.overlay.sendFishing({ phase: 'casting' });
}

function stopFishing(): void {
  if (!me.fishing) return;
  me.fishing = null;
  window.overlay.sendFishing({ phase: 'stop' });
}

function updateSelfFishing(now: number): void {
  const f = me.fishing;
  if (!f || !extras) return;
  const t = (now - f.phaseStart) / 1000;
  switch (f.phase) {
    case 'casting':
      if (t >= extras.tools.strips.casting / FISHING_PLAY.casting.fps) setSelfFishingPhase('waiting');
      break;
    case 'waiting':
      if (t >= (f.waitDur ?? 12)) setSelfFishingPhase('reeling');
      break;
    case 'reeling':
      if (t >= (f.reelDur ?? 1.5)) {
        const fishId = rollFishCatch();
        // 월척 0.2% — 일반 물고기만 (상자/보물상자 제외), 3배 스프라이트 + 보너스 코인
        const trophy =
          fishId !== 'box' && fishId !== 'treasure_chest' && Math.random() * 100 < 0.2;
        loadFishImage(fishId);
        setSelfFishingPhase('caught', fishId, trophy);
        void window.overlay.reportFish(fishId, trophy).then((res) => {
          if (!res.ok) return;
          if (fishId === 'box') {
            showBubble(me, `📦 상자 발견! +${res.delta}🪙`);
          } else if (fishId === 'treasure_chest') {
            showBubble(me, res.item ? `💰 보물상자!! '${res.item.name}' 획득!` : `💰 보물상자!! +${res.delta}🪙`);
          } else if (res.trophy) {
            showBubble(me, `🌟 월척이다!! ${fishId.replace(/_/g, ' ')}! +${res.delta}🪙`);
          } else {
            showBubble(me, `🎣 ${fishId.replace(/_/g, ' ')}! ${res.isNew ? 'NEW! ' : ''}+${res.delta}🪙`);
          }
        });
      }
      break;
    case 'caught':
      if (t >= CAUGHT_DURATION) setSelfFishingPhase('casting');
      break;
  }
}

// 낚싯대 + 낚인 물고기 그리기 (본인/원격 공용)
function drawFishing(actor: Actor, time: number): void {
  const f = actor.fishing;
  if (!f || f.phase === 'stop' || !extras) return;
  const strip = rodStrips[f.phase];
  const count = extras.tools.strips[f.phase];
  const play = FISHING_PLAY[f.phase];
  if (!strip || !count || !play) return;
  const t = (time - f.phaseStart) / 1000;
  const raw = Math.floor(t * play.fps);
  const idx = play.once ? Math.min(raw, count - 1) : raw % count;
  const vs = viewScale;
  const fw = extras.tools.frameW;
  const fh = extras.tools.frameH;
  const y0 = viewH + 2 * vs - fh * vs;

  stageCtx.save();
  if (f.dir === -1) {
    // 왼쪽 보기: 캐릭터 중심 기준 미러
    stageCtx.translate(2 * actor.x, 0);
    stageCtx.scale(-1, 1);
  }
  stageCtx.drawImage(
    strip,
    idx * fw,
    0,
    fw,
    fh,
    Math.round(actor.x - 16 * vs),
    Math.round(y0),
    fw * vs,
    fh * vs,
  );
  if (f.phase === 'caught' && f.fishId) {
    const fishImg = fishReady.get(f.fishId);
    if (fishImg) {
      const p = Math.min(1, t / 1.4);
      const fx = actor.x + (62 - 30 * p) * vs;
      const fy = viewH - 4 * vs - 44 * vs * p - Math.sin(p * Math.PI) * 6 * vs;
      const fs = 16 * 1.5 * vs * (f.trophy ? 3 : 1); // 월척은 3배
      if (isFish2(f.fishId)) {
        // 단일 이미지: 전체를 비율 유지로 축소
        const nw = fishImg.naturalWidth || 16;
        const nh = fishImg.naturalHeight || 16;
        const s = fs / Math.max(nw, nh);
        const dw = nw * s;
        const dh = nh * s;
        stageCtx.drawImage(fishImg, 0, 0, nw, nh, Math.round(fx - dw / 2), Math.round(fy - dh / 2), dw, dh);
      } else {
        stageCtx.drawImage(fishImg, 0, 0, 16, 16, Math.round(fx - fs / 2), Math.round(fy - fs / 2), fs, fs);
      }
    }
  }
  stageCtx.restore();
}

// 낚시 중 머리 위 그만하기 버튼 (본인 전용)
let fishStopRect = { x: 0, y: 0, w: 0, h: 0 };
let fishStopHover = false;

function drawFishingStop(): void {
  if (!me.fishing) return;
  const box = actorBox(me);
  const w = 56;
  const h = 18;
  // 닉네임 바로 아래
  fishStopRect = { x: me.x - w / 2, y: box.y - 2, w, h };
  stageCtx.globalAlpha = fishStopHover ? 1 : 0.85;
  stageCtx.fillStyle = fishStopHover ? '#a23352' : '#4a2837';
  stageCtx.strokeStyle = '#fffdf7';
  stageCtx.lineWidth = 1;
  roundRect(fishStopRect.x, fishStopRect.y, w, h, 5);
  stageCtx.fill();
  stageCtx.stroke();
  stageCtx.fillStyle = '#fffdf7';
  stageCtx.font = '10px "Segoe UI", "Malgun Gothic", sans-serif';
  stageCtx.fillText('그만하기', fishStopRect.x + 8, fishStopRect.y + 13);
  stageCtx.globalAlpha = 1;
}

// ---- 장애물 러너 ----

interface RunnerObstacle {
  type: 'arrow' | 'trap';
  x: number;
}

const runnerState = {
  active: false,
  t: 0,
  spawnIn: 0,
  obstacles: [] as RunnerObstacle[],
  duckUntil: 0,
  dead: false,
};

function runnerDucking(now: number): boolean {
  return runnerState.active && now < runnerState.duckUntil && me.hopY === 0;
}

function startRunner(): void {
  stopFishing();
  runnerState.active = true;
  runnerState.t = 0;
  runnerState.spawnIn = 1.8;
  runnerState.obstacles = [];
  runnerState.duckUntil = 0;
  runnerState.dead = false;
  me.dir = 1;
  me.x = Math.max(120, viewW * 0.22);
}

function runnerDie(): void {
  runnerState.dead = true;
  playAction(me, 'death');
  const secs = runnerState.t;
  void window.overlay.endRunner(secs).then((res) => {
    showBubble(
      me,
      res.ok ? `💀 ${secs.toFixed(1)}초 생존! +${res.delta}🪙` : (res.error ?? '기록 정산 실패'),
    );
  });
}

function updateRunner(dt: number, now: number): void {
  if (!runnerState.active) return;
  if (runnerState.dead) {
    if (!actionActive(me)) {
      runnerState.active = false;
      pickNextMode();
    }
    return;
  }
  runnerState.t += dt;
  const speed = Math.min(520, 240 + runnerState.t * 9);
  runnerState.spawnIn -= dt;
  if (runnerState.spawnIn <= 0) {
    runnerState.obstacles.push({ type: Math.random() < 0.55 ? 'arrow' : 'trap', x: viewW + 60 });
    runnerState.spawnIn = Math.max(0.55, 1.7 - runnerState.t * 0.02) + Math.random() * 0.8;
  }
  const vs = viewScale;
  const ducking = runnerDucking(now);
  const charL = me.x - 7 * vs;
  const charR = me.x + 7 * vs;
  const charTop = (ducking ? viewH - 14 * vs : viewH - 30 * vs) + me.hopY;
  const charBottom = viewH + me.hopY;
  for (let i = runnerState.obstacles.length - 1; i >= 0; i--) {
    const obs = runnerState.obstacles[i];
    obs.x -= speed * (obs.type === 'arrow' ? 1.25 : 1) * dt;
    if (obs.x < -80) {
      runnerState.obstacles.splice(i, 1);
      continue;
    }
    let oL: number;
    let oR: number;
    let oT: number;
    let oB: number;
    if (obs.type === 'arrow') {
      const cy = viewH - 24 * vs;
      const halfW = (arrowSprite ? arrowSprite.width : 14) * 0.8 * vs;
      const halfH = Math.max(2.5 * vs, (arrowSprite ? arrowSprite.height : 6) * 0.7 * vs);
      oL = obs.x - halfW;
      oR = obs.x + halfW;
      oT = cy - halfH;
      oB = cy + halfH;
    } else {
      oL = obs.x - 12 * vs;
      oR = obs.x + 12 * vs;
      oT = viewH - 13 * vs;
      oB = viewH;
    }
    if (charR > oL && charL < oR && charBottom > oT && charTop < oB) {
      runnerDie();
      return;
    }
  }
}

function drawRunner(time: number): void {
  if (!runnerState.active) return;
  const vs = viewScale;
  for (const obs of runnerState.obstacles) {
    if (obs.type === 'arrow' && arrowSprite) {
      // 하단 좌측 가로 화살(오른쪽 향함)을 좌우반전 → 왼쪽으로 날아옴
      const s = 1.6 * vs;
      const cy = viewH - 24 * vs;
      const w = arrowSprite.width * s;
      const h = arrowSprite.height * s;
      stageCtx.save();
      stageCtx.translate(obs.x, cy);
      stageCtx.scale(-1, 1);
      stageCtx.drawImage(arrowSprite, Math.round(-w / 2), Math.round(-h / 2), w, h);
      stageCtx.restore();
    } else if (obs.type === 'trap' && trapImg) {
      // Trap3: 32x16 2프레임
      const frame = Math.floor(time / 280) % 2;
      const s = 1.2 * vs;
      stageCtx.drawImage(
        trapImg,
        frame * 32,
        0,
        32,
        16,
        Math.round(obs.x - 16 * s),
        Math.round(viewH - 16 * s + 2 * vs),
        32 * s,
        16 * s,
      );
    }
  }
  // HUD
  const label = runnerState.dead ? '기록 정산 중...' : `⏱ ${runnerState.t.toFixed(1)}s`;
  stageCtx.font = 'bold 13px "Segoe UI", sans-serif';
  stageCtx.strokeStyle = 'rgba(0,0,0,0.75)';
  stageCtx.lineWidth = 3;
  stageCtx.strokeText(label, viewW / 2 - 30, 20);
  stageCtx.fillStyle = '#fffdf7';
  stageCtx.fillText(label, viewW / 2 - 30, 20);
  if (runnerState.t < 4 && !runnerState.dead) {
    const hint = '↑ 점프 (Trap 회피)   ↓ 엎드리기 (화살 회피)';
    stageCtx.font = '11px "Segoe UI", sans-serif';
    stageCtx.strokeText(hint, viewW / 2 - 110, 38);
    stageCtx.fillText(hint, viewW / 2 - 110, 38);
  }
}

// ---- 리액션 이모지 (캐릭터 위 말풍선 세트) ----

function drawReaction(actor: Actor, time: number): void {
  const r = actor.reaction;
  if (!r || !reactionSheet || !extras) return;
  if (time >= r.until) {
    actor.reaction = null;
    return;
  }
  if (actor.bubble) return; // 텍스트 말풍선 우선
  const cell = extras.reaction.cell;
  const cols = extras.reaction.cols;
  const sx = (r.index % cols) * cell;
  const sy = (extras.reaction.rows + Math.floor(r.index / cols)) * cell; // 두 번째 세트(말풍선 포함)
  const vs = viewScale;
  const size = cell * 2 * vs;
  const box = actorBox(actor);
  // 등장 애니메이션: 살짝 위로 떠오르며 페이드인
  const age = (time - (r.until - 3000)) / 1000;
  stageCtx.globalAlpha = Math.min(1, age * 4) * (r.until - time < 300 ? (r.until - time) / 300 : 1);
  stageCtx.drawImage(
    reactionSheet,
    sx,
    sy,
    cell,
    cell,
    Math.round(actor.x - size / 2),
    Math.round(box.y - size - 4),
    size,
    size,
  );
  stageCtx.globalAlpha = 1;
}

// ---- 채팅 버튼 (우측 하단) ----

const CHAT_BTN = { w: 38, h: 30, marginX: 10, marginY: 6 };
let chatBtnHover = false;
let unreadCount = 0;

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

  // 안읽은 채팅 수 배지 (빨간 원 + 흰 숫자, 99 초과 시 99+)
  if (unreadCount > 0) {
    const label = unreadCount > 99 ? '99+' : String(unreadCount);
    stageCtx.font = 'bold 9px "Segoe UI", sans-serif';
    const textW = stageCtx.measureText(label).width;
    const bw = Math.max(14, textW + 8);
    const bx = r.x + r.w - bw / 2 - 2;
    const by = r.y - 5;
    stageCtx.fillStyle = '#ff3b30';
    stageCtx.strokeStyle = '#fffdf7';
    stageCtx.lineWidth = 1.5;
    roundRect(bx - bw / 2, by - 7, bw, 14, 7);
    stageCtx.fill();
    stageCtx.stroke();
    stageCtx.fillStyle = '#ffffff';
    stageCtx.fillText(label, bx - textW / 2, by + 3.5);
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
  fishStopHover = !!me.fishing && pointIn(fishStopRect, 4);
  const over = selfHover || chatBtnHover || giftHover || fishStopHover;
  if (over !== interactive) {
    interactive = over;
    window.overlay.setInteractive(over);
    document.body.style.cursor = over ? 'pointer' : 'default';
  }
}

window.addEventListener('mousedown', () => {
  if (fishStopHover) {
    stopFishing();
    return;
  }
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

// 내 고정메시지 — me가 만들어지기 전에 설정이 도착할 수 있어 별도 보관
let selfPinned = '';

function applySettings(s: { opacity: number; scale: number; pinnedMsg?: string; pinnedOn?: boolean }): void {
  stage.style.opacity = String(Math.min(1, Math.max(0.1, s.opacity)));
  if ([1, 2, 3].includes(s.scale)) viewScale = s.scale;
  selfPinned = s.pinnedOn ? (s.pinnedMsg ?? '') : '';
  if (me) me.pinned = selfPinned;
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
    if (msg.reaction != null) {
      actor.reaction = { index: msg.reaction, until: performance.now() + 3000 };
      return;
    }
    if (msg.image) showImageBubble(actor, msg.image);
    else if (msg.text) showBubble(actor, msg.text);
  });

  window.overlay.on('net:player-fishing', (data) => {
    const d = data as { id: string; phase: string; fishId?: string; trophy?: boolean };
    const actor = remotes.get(d.id);
    if (!actor) return;
    if (d.phase === 'stop') {
      actor.fishing = null;
      return;
    }
    if (d.fishId) loadFishImage(d.fishId);
    actor.fishing = {
      phase: d.phase,
      phaseStart: performance.now(),
      fishId: d.fishId ?? null,
      dir: actor.fishing?.dir ?? actor.dir,
      trophy: d.trophy === true,
    };
    actor.walking = false;
  });

  window.overlay.on('self:minigame', (data) => {
    const d = data as { game: string };
    if (d.game === 'fishing') {
      if (me.fishing) stopFishing();
      else startFishing();
    } else if (d.game === 'runner' && !runnerState.active) {
      startRunner();
    }
  });

  window.overlay.on('self:runner-key', (data) => {
    if (!runnerState.active || runnerState.dead) return;
    const now = performance.now();
    if (data === 'up' && me.hopY === 0 && now >= runnerState.duckUntil) {
      me.hopVy = -270;
    } else if (data === 'down' && me.hopY === 0) {
      runnerState.duckUntil = now + 560;
    }
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

  window.overlay.on('net:player-pinned', (data) => {
    const d = data as { id: string; text: string };
    const actor = d.id === selfId ? me : remotes.get(d.id);
    if (actor) actor.pinned = d.text;
  });

  window.overlay.on('self:settings', (data) => {
    applySettings(data as { opacity: number; scale: number; pinnedMsg: string; pinnedOn: boolean });
  });

  window.overlay.on('self:unread', (data) => {
    unreadCount = Number(data) || 0;
  });

  window.overlay.on('net:slot-win', (data) => {
    const d = data as { id: string; kind: string };
    const actor = d.id === selfId ? me : remotes.get(d.id);
    if (!actor) return;
    const text = d.kind === 'mega' ? '7️⃣ 메가 잭팟!!!' : d.kind === 'jackpot' ? '💎 잭팟!!' : '🎰 파츠 당첨!';
    showBubble(actor, text);
    spawnHearts(actor.x, actorBox(actor).y);
  });
}

// ---- 메인 루프 ----

let lastTime = 0;

function tick(time: number): void {
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  const nowMs = performance.now();
  updateSelf(dt);
  updateSelfFishing(nowMs);
  updateRunner(dt, nowMs);
  updateRemotes(dt);
  updateGift(dt);
  updateHearts(dt);
  updateInteractive();
  sendMoveIfNeeded(dt);

  stageCtx.clearRect(0, 0, viewW, viewH);
  const now = performance.now();
  drawGift(time);
  drawRunner(time);
  for (const actor of remotes.values()) drawActor(actor, now);
  drawActor(me, now);
  drawFishingStop();
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
  me.pinned = selfPinned;
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
  void initExtras();
  console.log(`[overlay] ready, viewport ${viewW}x${viewH}`);
  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(tick);
  });
}

init().catch((err) => {
  console.log(`[overlay-error] ${err instanceof Error ? err.message : String(err)}`);
});

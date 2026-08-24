// 클라이언트-서버 공유 프로토콜

export { APP_VERSION } from './version';

export const DEFAULT_PORT = 4020;
export const MAX_CHAT_LEN = 200;
export const MAX_NICKNAME_LEN = 16;

// 이미지 전송 정책
export const IMAGE_MAX_BYTES = 1_500_000; // 리사이즈 후 업로드 허용 최대치
export const IMAGE_PER_MINUTE = 2;
export const IMAGE_RETENTION_DAYS = 3;

/** 파츠 선택 + HSV 색상 (h: -180~180, s/v: -100~100) */
export interface PartChoice {
  name: string;
  h?: number;
  s?: number;
  v?: number;
}

/** PixelHeroes 파츠 조합 외형 (+ 코인 상점 치장) */
export interface Appearance {
  /** 종족 — Body/Head/Arms 세트, hsv는 피부톤 */
  race: PartChoice;
  /** 코인 상점: 오오라 아이템 id */
  aura?: string;
  /** 코인 상점: 말풍선 스킨 id */
  bubbleSkin?: string;
  /** 코인 상점: 닉네임 색 (#rrggbb) */
  nameColor?: string;
  eyes?: PartChoice | null;
  ears?: PartChoice | null;
  hair?: PartChoice | null;
  armor?: PartChoice | null;
  helmet?: PartChoice | null;
  weapon?: PartChoice | null;
  shield?: PartChoice | null;
  mask?: PartChoice | null;
  back?: PartChoice | null;
  cape?: PartChoice | null;
  horns?: PartChoice | null;
}

/** 장착 가능한 슬롯 (Appearance의 옵션 키) */
export const APPEARANCE_SLOTS = [
  'eyes',
  'ears',
  'hair',
  'armor',
  'helmet',
  'weapon',
  'shield',
  'mask',
  'back',
  'cape',
  'horns',
] as const;
export type AppearanceSlot = (typeof APPEARANCE_SLOTS)[number];

export interface PlayerState {
  id: string;
  nickname: string;
  /** 4자리 고유번호 — 닉네임#태그 조합이 사용자 구분 키 */
  tag: string;
  appearance: Appearance;
  /** 화면 가로 위치 (0~1 정규화 — 해상도가 달라도 상대 위치 유지) */
  x: number;
  dir: -1 | 1;
  walking: boolean;
  /** 이 시각(ts)까지의 채팅을 읽음 — 읽음 확인 카운트용 */
  lastReadTs: number;
}

export interface MovePayload {
  x: number;
  dir: -1 | 1;
  walking: boolean;
}

export interface ChatImage {
  /** 서버 상대 경로 (/i/xxx.webp) — 클라이언트 메인 프로세스가 절대 URL로 변환 */
  url: string;
  /** 말풍선/채팅 목록용 소형 썸네일 (data URL, 브로드캐스트에 포함) */
  thumb: string;
  /** 원본(리사이즈 후) 크기 — 말풍선 비율 계산용 */
  w: number;
  h: number;
}

/** 채팅 명령어로 재생 가능한 액션 애니메이션 */
export const ACTION_IDS = [
  'slash',
  'jab',
  'shot',
  'block',
  'roll',
  'jump',
  'death',
  'crawl',
  'ready',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export interface ChatMessage {
  id: string;
  nickname: string;
  tag: string;
  text: string;
  ts: number;
  image?: ChatImage;
  /** 액션 명령어 — 수신 클라이언트가 해당 캐릭터의 애니메이션 재생 */
  action?: ActionId;
  /** 리액션 이모지 인덱스 (0~62) — 캐릭터 위 말풍선 이모지로 표시 */
  reaction?: number;
  /** 보낸 시점의 외형 스냅샷 (채팅창 아바타용, 서버가 첨부) */
  senderAppearance?: Appearance;
}

/** 채팅 내역 서버 보관 기간/최대 개수 */
export const CHAT_RETENTION_DAYS = 3;
export const CHAT_HISTORY_MAX = 300;

// ---- 코인 경제 / 슬롯머신 ----
export const COIN_STARTER = 10; // 첫 로그인(신규 지갑) 지급
export const COIN_PER_MINUTE = 1; // 접속 1분당 적립
export const SLOT_COST = 3;

export type SlotKind = 'miss' | 'small' | 'back' | 'double' | 'triple' | 'part' | 'jackpot' | 'mega';

export interface SlotResult {
  ok: boolean;
  error?: string;
  kind?: SlotKind;
  /** 코인 증감(비용 제외한 당첨금) */
  delta?: number;
  reels?: string[];
  /** 정산 후 잔액 */
  coins?: number;
}

export interface ClientToServerEvents {
  hello: (data: { nickname: string; tag: string; appearance: Appearance }) => void;
  move: (data: MovePayload) => void;
  chat: (text: string) => void;
  /** 외형 교체 알림 — 획득 판정은 클라이언트 로컬 */
  appearance: (appearance: Appearance) => void;
  /** 액션 명령어 (대사 포함) — 서버가 chat 메시지로 브로드캐스트 */
  action: (data: { action: ActionId; text: string }) => void;
  /** 이 시각까지 읽었음을 보고 (채팅창이 보이는 동안) */
  read: (ts: number) => void;
  /** 슬롯머신 1회 (비용 SLOT_COST, 판정은 서버) */
  slot: (ack: (res: SlotResult) => void) => void;
  /** 상점 구매 */
  buy: (itemId: string, ack: (res: { ok: boolean; error?: string; coins?: number; items?: string[] }) => void) => void;
  /** 코인 랭킹 톱5 */
  ranking: (ack: (rows: { name: string; coins: number }[]) => void) => void;
  /** 낚시 상태 브로드캐스트용 (다른 접속자에게 애니메이션 동기화) */
  'fishing-state': (data: { phase: FishingPhase; fishId?: string }) => void;
  /** 물고기 획득 정산 (도감 기록 + 코인) */
  fish: (
    fishId: string,
    ack: (res: { ok: boolean; error?: string; isNew?: boolean; delta?: number; coins?: number }) => void,
  ) => void;
  /** 러너 생존 시간 보고 → 코인 정산 */
  'runner-score': (
    seconds: number,
    ack: (res: { ok: boolean; error?: string; delta?: number; coins?: number }) => void,
  ) => void;
  /** 리액션 이모지 전송 */
  reaction: (index: number) => void;
  /** 이미지 업로드 (리사이즈된 바이너리 + 썸네일). 서버가 저장 후 chat으로 브로드캐스트 */
  image: (
    payload: { data: ArrayBuffer; mime: string; thumb: string; w: number; h: number },
    ack: (res: { ok: boolean; error?: string }) => void,
  ) => void;
}

export interface ServerToClientEvents {
  welcome: (data: { selfId: string; players: PlayerState[]; serverVersion?: string }) => void;
  'player-joined': (player: PlayerState) => void;
  'player-moved': (data: { id: string } & MovePayload) => void;
  'player-left': (id: string) => void;
  'player-appearance': (data: { id: string; appearance: Appearance }) => void;
  chat: (msg: ChatMessage) => void;
  /** 접속 직후 최근 채팅 내역 (서버 보관분) */
  'chat-history': (msgs: ChatMessage[]) => void;
  /** 누군가의 읽음 위치 갱신 */
  'player-read': (data: { id: string; ts: number }) => void;
  /** 내 코인 잔액 (접속/적립/슬롯 정산 시) */
  coins: (coins: number) => void;
  /** 내 지갑 전체 (잔액 + 보유 상점 아이템 + 낚시 도감) */
  wallet: (data: { coins: number; items: string[]; fish: string[] }) => void;
  /** 누군가의 낚시 상태 (애니메이션 동기화) */
  'player-fishing': (data: { id: string; phase: FishingPhase; fishId?: string }) => void;
  /** 슬롯 대박 전체 알림 */
  'slot-win': (data: { id: string; nickname: string; tag: string; kind: SlotKind; delta: number }) => void;
}

/** 서버측 외형 검증/정제 — 알 수 없는 키 제거, 문자열 길이 제한, 수치 클램프 */
export function sanitizeAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const clampNum = (v: unknown, limit: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(-limit, Math.min(limit, Math.round(n))) : 0;
  };
  const part = (v: unknown): PartChoice | null => {
    if (!v || typeof v !== 'object') return null;
    const p = v as Record<string, unknown>;
    const name = String(p.name ?? '').slice(0, 48);
    if (!name || !/^[\w\- \[\]]+$/.test(name)) return null;
    const out: PartChoice = { name };
    if (p.h) out.h = clampNum(p.h, 180);
    if (p.s) out.s = clampNum(p.s, 100);
    if (p.v) out.v = clampNum(p.v, 100);
    return out;
  };
  const race = part(source.race);
  if (!race) return null;
  const result: Appearance = { race };
  for (const slot of APPEARANCE_SLOTS) {
    const choice = part(source[slot]);
    if (choice) result[slot] = choice;
  }
  const aura = String(source.aura ?? '');
  if (SHOP_ITEMS.some((i) => i.kind === 'aura' && i.id === aura)) result.aura = aura;
  const bubbleSkin = String(source.bubbleSkin ?? '');
  if (SHOP_ITEMS.some((i) => i.kind === 'bubble' && i.id === bubbleSkin)) result.bubbleSkin = bubbleSkin;
  const nameColor = String(source.nameColor ?? '');
  if (/^#[0-9a-fA-F]{6}$/.test(nameColor)) result.nameColor = nameColor;
  return result;
}

// ---- 미니게임: 낚시 / 러너 / 리액션 ----

export const FISH_IDS = [
  'Albacore', 'Anchovy', 'Anglerfish', 'BlobFish', 'Bone Fish', 'Bream', 'Bullhead Catfish',
  'Carp', 'Chub', 'Clownfish', 'Crayfish', 'Crimson Snapper', 'Devil Fish', 'Dorado',
  'Dynamite Fish', 'Faeries Fish', 'Flounder', 'Ghost Catfish', 'Glacier Fish', 'Goby',
  'Golden Fish', 'Halibut', 'Herring', 'Large Mouth Bass', 'Lingcod', 'LionFish', 'Lobster',
  'Perch', 'Pike Fish', 'Red Mullet', 'Red Snapper', 'Regal Blue Tang', 'Salmon', 'Sardine',
  'Sea Cucumber', 'Sea bullhead', 'Shad', 'Smallmouth Bass', 'Sturgeon', 'Sunfish',
  'Tiger Trout', 'Tuna', 'Walleye', 'Zombie Fish',
] as const;

export const FISH_FIRST_COIN = 5; // 처음 잡은 물고기
export const FISH_REPEAT_COIN = 1; // 이미 잡은 물고기
export const FISH_MIN_INTERVAL_MS = 8000; // 서버측 최소 낚시 간격 (사이클 ~12초)

export const FISHING_PHASES = ['casting', 'waiting', 'reeling', 'caught', 'stop'] as const;
export type FishingPhase = (typeof FISHING_PHASES)[number];

export const RUNNER_COOLDOWN_SEC = 300; // 5분에 1회
export const RUNNER_COIN_PER_SEC = 0.2; // 5초당 1코인
export const RUNNER_COIN_MAX = 20;

/** 리액션 이모지: 16px 셀 9x7 (표시는 아래 세트의 말풍선 버전) */
export const REACTION_COLS = 9;
export const REACTION_ROWS = 7;

// ---- 코인 상점 ----

export interface ShopItem {
  id: string;
  kind: 'aura' | 'bubble' | 'namecolor';
  name: string;
  price: number;
  /** namecolor의 실제 색상값 */
  value?: string;
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'aura-spark', kind: 'aura', name: '골드 스파크', price: 40 },
  { id: 'aura-ember', kind: 'aura', name: '불꽃 오오라', price: 40 },
  { id: 'aura-frost', kind: 'aura', name: '서리 오오라', price: 40 },
  { id: 'aura-shadow', kind: 'aura', name: '섀도 오오라', price: 60 },
  { id: 'aura-rainbow', kind: 'aura', name: '무지개 오오라', price: 120 },
  { id: 'bubble-dark', kind: 'bubble', name: '다크 말풍선', price: 30 },
  { id: 'bubble-mint', kind: 'bubble', name: '민트 말풍선', price: 30 },
  { id: 'bubble-pink', kind: 'bubble', name: '핑크 말풍선', price: 30 },
  { id: 'bubble-gold', kind: 'bubble', name: '금테 말풍선', price: 50 },
  { id: 'bubble-royal', kind: 'bubble', name: '로열 말풍선', price: 50 },
  { id: 'name-gold', kind: 'namecolor', name: '골드 닉네임', price: 20, value: '#ffd66e' },
  { id: 'name-sky', kind: 'namecolor', name: '하늘 닉네임', price: 20, value: '#6ec3ff' },
  { id: 'name-lime', kind: 'namecolor', name: '라임 닉네임', price: 20, value: '#8be06a' },
  { id: 'name-pink', kind: 'namecolor', name: '핑크 닉네임', price: 20, value: '#ff8dc7' },
  { id: 'name-red', kind: 'namecolor', name: '레드 닉네임', price: 20, value: '#ff6b6b' },
];

/** 말풍선 표시 시간(ms): 기본 5초 + 글자당 0.05초, 최대 10초 */
export function bubbleDurationMs(text: string): number {
  return Math.min(10, 5 + text.length * 0.05) * 1000;
}

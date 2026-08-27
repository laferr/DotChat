// 클라이언트-서버 공유 프로토콜

export { APP_VERSION } from './version';

export const DEFAULT_PORT = 4020;
export const MAX_CHAT_LEN = 200;
export const MAX_NICKNAME_LEN = 16;
/** 머리 위 고정메시지 최대 길이 */
export const MAX_PINNED_LEN = 40;

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
  /** 머리 위 고정메시지 (빈 문자열 = 없음) */
  pinned?: string;
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

/** fish 이벤트 정산 응답 */
export type FishAck = (res: {
  ok: boolean;
  error?: string;
  isNew?: boolean;
  delta?: number;
  coins?: number;
  /** 월척 인정 여부 */
  trophy?: boolean;
  /** 더블 캐치 (20성 낚싯대, 코인 2배 적용됨) */
  doubled?: boolean;
  item?: { id: string; name: string };
  items?: string[];
}) => void;

export interface ClientToServerEvents {
  hello: (data: { nickname: string; tag: string; appearance: Appearance; pinned?: string }) => void;
  move: (data: MovePayload) => void;
  chat: (text: string) => void;
  /** 외형 교체 알림 — 획득 판정은 클라이언트 로컬 */
  appearance: (appearance: Appearance) => void;
  /** 머리 위 고정메시지 갱신 (빈 문자열 = 해제) */
  pinned: (text: string) => void;
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
  /** 낚시 상태 브로드캐스트용 (다른 접속자에게 애니메이션 동기화, trophy = 월척 3배, rod = 강화 성 — 글로우 연출) */
  'fishing-state': (data: { phase: FishingPhase; fishId?: string; trophy?: boolean; rod?: number }) => void;
  /**
   * 물고기 획득 정산 (도감 기록 + 코인, box/보물상자는 특수 보상 — item은 상점 아이템 당첨)
   * 월척이면 (fishId, true, ack) 3인자로 호출 — 구버전 (fishId, ack) 2인자와 서버가 모두 수용
   */
  fish: (fishId: string, trophyOrAck: boolean | FishAck, maybeAck?: FishAck) => void;
  /** 미보유 랜덤 파츠 뽑기 결제 (RANDOM_SHOP 가격, 지급은 클라이언트 로컬) */
  'buy-random': (
    itemId: string,
    ack: (res: { ok: boolean; error?: string; coins?: number }) => void,
  ) => void;
  /** 낚싯대 강화 1회 (비용·판정 서버, ENHANCE_TABLE) */
  enhance: (
    ack: (res: {
      ok: boolean;
      error?: string;
      result?: 'success' | 'keep' | 'drop';
      stars?: number;
      fails?: number;
      /** 천장 보장 성공이었는지 */
      guaranteed?: boolean;
      coins?: number;
    }) => void,
  ) => void;
  /** 보유 파츠 목록 동기화 — 클라 목록을 서버 지갑에 합집합 등록, ack로 병합 결과 반환 */
  'parts-sync': (parts: string[], ack: (res: { ok: boolean; parts?: string[] }) => void) => void;
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
  /** 누군가의 고정메시지 갱신 */
  'player-pinned': (data: { id: string; text: string }) => void;
  chat: (msg: ChatMessage) => void;
  /** 접속 직후 최근 채팅 내역 (서버 보관분) */
  'chat-history': (msgs: ChatMessage[]) => void;
  /** 누군가의 읽음 위치 갱신 */
  'player-read': (data: { id: string; ts: number }) => void;
  /** 내 코인 잔액 (접속/적립/슬롯 정산 시) */
  coins: (coins: number) => void;
  /** 내 지갑 전체 (잔액 + 보유 상점 아이템 + 낚시 도감 + 월척 기록 + 낚싯대 강화) */
  wallet: (data: {
    coins: number;
    items: string[];
    fish: string[];
    trophies?: string[];
    rodStars?: number;
    rodFails?: number;
  }) => void;
  /** 강화 대박/하락 전체 알림 (20성 이상) */
  'enhance-news': (data: {
    id: string;
    nickname: string;
    tag: string;
    stars: number;
    result: 'success' | 'drop';
  }) => void;
  /** 누군가의 낚시 상태 (애니메이션 동기화, trophy = 월척 3배, rod = 강화 성) */
  'player-fishing': (data: {
    id: string;
    phase: FishingPhase;
    fishId?: string;
    trophy?: boolean;
    rod?: number;
  }) => void;
  /** 슬롯 대박 전체 알림 */
  'slot-win': (data: { id: string; nickname: string; tag: string; kind: SlotKind; delta: number }) => void;
}

/** 고정메시지 정제 — 줄바꿈 제거 + 길이 제한 (빈 문자열 = 해제) */
export function sanitizePinned(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PINNED_LEN);
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

/** 새 물고기 (assets/extras/fish2/ 단일 이미지 — tools/import-extras.mjs가 생성하는 fish2 목록과 동일해야 함) */
export const FISH_IDS_EXTRA = [
  'AldebaranAlewife', 'Amanita_Fungifin', 'Angelfish', 'ArcturusAstroidean', 'Batfish', 'Bloodfin',
  'Bomb_Fish', 'Brimlish', 'Bumblebee_Tuna', 'Bunnyfish', 'Catfish2', 'Chaos_Fish', 'Cloudfish',
  'Clownfish2', 'CoastalDemonfish', 'CoralskinFoolfish', 'CragBullhead', 'Crimson_Tigerfish',
  'Cursedfish', 'Dirtfish', 'DragoonDrizzlefish', 'Dynamite_Fish', 'EnchantedStarfish',
  'EutrophicSandfish', 'FishofEleum', 'FishofFlight', 'Flarefin_Koi', 'GleamingCucumber',
  'GlimmeringGemfish', 'Gorecodile', 'GreenwaveLoach', 'Havocfish', 'Jewelfish', 'MoltenFishron',
  'Pengfish', 'Pixiefish', 'PrismaticGuppy', 'Prismite', 'ProcyonidPrawn', 'Rock_Lobster',
  'Rockfish', 'Serpentuna', 'Shadowfish', 'Slimefish', 'Spadefish', 'SparklingEmpress',
  'SpecularSturgeon', 'Squidoom', 'StuffedFish', 'SunbeamFish', 'SunkenSailfish',
  'The_Fish_of_Cthulhu', 'TwinklingPollox', 'Zombie_Fish', 'arapaima', 'arrau_turtle',
  'atlantic_cod', 'atlantic_halibut', 'atlantic_herring', 'bayad', 'blackfish', 'bluegill',
  'boulti', 'box', 'box_turtle', 'brown_shrooma', 'brown_trout', 'capitaine', 'carp', 'catfish',
  'fish_bones', 'gar', 'goldfish', 'jellyfish', 'largemouth_bass', 'leech', 'message_in_a_bottle',
  'minnow', 'muskellunge', 'pacific_halibut', 'perch', 'pink_salmon', 'piranha', 'pollock',
  'rainbow_trout', 'raw_aero_mono', 'raw_amber_goby', 'raw_bark_angel', 'raw_beaked_herring',
  'raw_blind_sailfin', 'raw_circus_fish', 'raw_copperflame_anthias', 'raw_demon_herring',
  'raw_drooping_gourami', 'raw_duality_damselfish', 'raw_eyelash_fish', 'raw_forkfish',
  'raw_frosty_fin_fish', 'raw_hatchetfish', 'raw_lobster', 'raw_mono_stick', 'raw_mossthorn',
  'raw_picklefish', 'raw_rhino_tetra', 'raw_sailor_barb', 'raw_sneep_snorp', 'raw_spindlefish',
  'raw_triple_twirl_pleco', 'red_grouper', 'red_shrooma', 'smallmouth_bass', 'starshell_turtle',
  'synodontis', 'tambaqui', 'tin_can', 'treasure_chest', 'tuna',
] as const;

export const FISH_FIRST_COIN = 5; // 처음 잡은 물고기
export const FISH_REPEAT_COIN = 1; // 이미 잡은 물고기
export const FISH_MIN_INTERVAL_MS = 8000; // 서버측 최소 낚시 간격 (사이클 ~12초)

// 특수 어획물 — 확률은 클라이언트 롤(overlay.ts에 중복 하드코딩), 보상 정산은 서버
export const FISH_BOX_ID = 'box'; // 0.5%
export const FISH_CHEST_ID = 'treasure_chest'; // 0.2%
export const FISH_BOX_COIN_MIN = 2;
export const FISH_BOX_COIN_MAX = 10;
export const FISH_CHEST_COIN_MIN = 20;
export const FISH_CHEST_COIN_MAX = 50;

// 월척 — 일반 물고기 낚을 때 0.2% (클라 롤), 스프라이트 3배 + 보너스 코인, 도감에 별표
export const FISH_TROPHY_COIN = 5;

// ---- 낚싯대 강화 (0성→30성, 스타포스식 — 판정·저장은 서버) ----
// composer.ts에 UI용 복사본(FORGE_TABLE) 있음 — 수치 변경 시 동기화 유지

export interface EnhanceStage {
  /** 성공 확률 % */
  succ: number;
  /** 실패 중 하락 확률 % (전체 시도 대비) */
  drop: number;
  /** 시도 비용 (코인) */
  cost: number;
}

/** index = 현재 성 (0성에서 시도 = [0]) — 15/20/25성은 체크포인트(하락 없음) */
export const ENHANCE_TABLE: EnhanceStage[] = [
  { succ: 95, drop: 0, cost: 5 },
  { succ: 90, drop: 0, cost: 5 },
  { succ: 85, drop: 0, cost: 8 },
  { succ: 85, drop: 0, cost: 8 },
  { succ: 80, drop: 0, cost: 10 },
  { succ: 75, drop: 0, cost: 12 },
  { succ: 70, drop: 0, cost: 15 },
  { succ: 65, drop: 0, cost: 18 },
  { succ: 60, drop: 0, cost: 22 },
  { succ: 55, drop: 0, cost: 26 },
  { succ: 50, drop: 0, cost: 30 },
  { succ: 45, drop: 0, cost: 36 },
  { succ: 40, drop: 0, cost: 42 },
  { succ: 35, drop: 0, cost: 50 },
  { succ: 30, drop: 0, cost: 60 },
  { succ: 30, drop: 0, cost: 80 }, // 15성 ✦
  { succ: 30, drop: 2, cost: 100 },
  { succ: 15, drop: 7, cost: 130 },
  { succ: 15, drop: 7, cost: 160 },
  { succ: 15, drop: 8, cost: 200 },
  { succ: 30, drop: 0, cost: 250 }, // 20성 ✦
  { succ: 15, drop: 13, cost: 300 },
  { succ: 15, drop: 17, cost: 380 },
  { succ: 10, drop: 18, cost: 460 },
  { succ: 10, drop: 18, cost: 550 },
  { succ: 10, drop: 0, cost: 700 }, // 25성 ✦
  { succ: 7, drop: 15, cost: 850 },
  { succ: 5, drop: 15, cost: 1000 },
  { succ: 3, drop: 15, cost: 1200 },
  { succ: 1, drop: 15, cost: 1500 },
];

export const ENHANCE_MAX = 30;
/** 같은 성에서 연속 실패 누적 시 다음 시도 성공 보장 (천장) */
export const ENHANCE_PITY = 10;
/** 주말(KST 토·일) 하락 확률 감소 배율 */
export const ENHANCE_WEEKEND_DROP_MULT = 0.7;

/** 하락 시 바닥 (체크포인트 15/20/25성 밑으로는 안 떨어짐) */
export function enhanceFloor(stage: number): number {
  return stage >= 26 ? 25 : stage >= 21 ? 20 : 15;
}

export function isEnhanceWeekend(ts = Date.now()): boolean {
  const day = new Date(ts + 9 * 3600_000).getUTCDay(); // KST
  return day === 0 || day === 6;
}

// 강화 단계별 낚시 보너스
export const ROD_WAIT_REDUCE = 0.15; // 입질 대기 -초/성
export const ROD_TROPHY_BONUS = 0.02; // 월척 +%p/성
export const ROD_REPEAT_BONUS_STARS = 10; // 이상: 반복 어획 +1코인
export const ROD_DOUBLE_STARS = 20; // 이상: 더블 캐치(코인 2배)
export const ROD_DOUBLE_RATE = 5; // %
export const ROD_LUCK_STARS = 25; // 이상: 상자/보물상자 확률 2배

/** 보유 파츠 서버 동기화 한도 */
export const PARTS_SYNC_MAX = 3000;
/** 파츠 id 형식: "race:이름" 또는 "레이어/이름" */
export const PART_ID_RE = /^(race:[\w\- \[\]]+|[A-Za-z]+\/[\w\- \[\]]+)$/;

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

/** 미보유 랜덤 파츠 뽑기 — 결제는 서버, 지급은 클라이언트(파츠 풀 로컬 보유) */
export interface RandomShopItem {
  id: string;
  name: string;
  price: number;
  /** 'any' = 전체, 'race' = 종족 세트, 그 외 = 파츠 레이어명 (눈/귀는 종족 포함이라 제외) */
  layer: 'any' | 'race' | 'Weapon' | 'Hair' | 'Armor' | 'Helmet' | 'Shield' | 'Mask' | 'Back' | 'Cape' | 'Horns';
}

export const RANDOM_SHOP: RandomShopItem[] = [
  { id: 'rand-any', name: '전체 랜덤', price: 200, layer: 'any' },
  { id: 'rand-race', name: '종족 랜덤', price: 1000, layer: 'race' },
  { id: 'rand-weapon', name: '무기 랜덤', price: 300, layer: 'Weapon' },
  { id: 'rand-hair', name: '머리 랜덤', price: 500, layer: 'Hair' },
  { id: 'rand-armor', name: '갑옷 랜덤', price: 500, layer: 'Armor' },
  { id: 'rand-helmet', name: '헬멧 랜덤', price: 500, layer: 'Helmet' },
  { id: 'rand-shield', name: '방패 랜덤', price: 500, layer: 'Shield' },
  { id: 'rand-mask', name: '마스크 랜덤', price: 500, layer: 'Mask' },
  { id: 'rand-back', name: '등 랜덤', price: 500, layer: 'Back' },
  { id: 'rand-cape', name: '망토 랜덤', price: 500, layer: 'Cape' },
  { id: 'rand-horns', name: '뿔 랜덤', price: 500, layer: 'Horns' },
];

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'aura-spark', kind: 'aura', name: '골드 스파크', price: 40 },
  { id: 'aura-ember', kind: 'aura', name: '불꽃 오오라', price: 40 },
  { id: 'aura-frost', kind: 'aura', name: '서리 오오라', price: 40 },
  { id: 'aura-shadow', kind: 'aura', name: '섀도 오오라', price: 60 },
  { id: 'aura-rainbow', kind: 'aura', name: '무지개 오오라', price: 120 },
  { id: 'aura-fx-ChargeUp', kind: 'aura', name: '차지 오오라', price: 500 },
  { id: 'aura-fx-HeartBeat', kind: 'aura', name: '하트비트 오오라', price: 500 },
  { id: 'aura-fx-Poison', kind: 'aura', name: '포이즌 오오라', price: 500 },
  { id: 'aura-fx-pipo021', kind: 'aura', name: '크림슨 플레임', price: 999 },
  { id: 'aura-fx-pipo022', kind: 'aura', name: '에메랄드 플레임', price: 999 },
  { id: 'aura-fx-pipo023', kind: 'aura', name: '바이올렛 플레임', price: 999 },
  { id: 'aura-fx-pipo024', kind: 'aura', name: '어비스 플레임', price: 999 },
  { id: 'aura-fx-pipo025', kind: 'aura', name: '골드 플레임', price: 999 },
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

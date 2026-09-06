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
  /** 착용 중인 도전과제 칭호 (서버 권위 — 지갑에서 첨부) */
  title?: string;
  /** 원정 중 (서버 권위 — 지갑 battle.active). 오버레이는 공격 모션 반복 + '원정중' 라벨 */
  battle?: boolean;
  /** 장착 펫 id (첫 슬롯 — 오버레이가 캐릭터 뒤에 표시) */
  pet?: string;
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
  /** 보낸 시점의 착용 칭호 (서버가 지갑에서 첨부) */
  senderTitle?: string;
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
  /** 🐾 펫 효과로 무료 스핀이었는지 */
  free?: boolean;
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

// ---- 일일퀘스트 / 출석보상 ----
export interface DailyQuestDef {
  id: string;
  name: string;
  goal: number;
  reward: number;
}
export const DAILY_QUESTS: DailyQuestDef[] = [
  { id: 'chat', name: '채팅 10회 보내기', goal: 10, reward: 3 },
  { id: 'fish', name: '물고기 3마리 낚기', goal: 3, reward: 5 },
  { id: 'slot', name: '슬롯머신 1회 돌리기', goal: 1, reward: 2 },
  { id: 'runner', name: '달리기 10초 생존', goal: 10, reward: 3 },
  { id: 'reaction', name: '리액션 이모지 3회 보내기', goal: 3, reward: 2 },
  { id: 'dig', name: '땅파기 3회', goal: 3, reward: 3 },
  { id: 'battle', name: '원정 전리품 1회 수령', goal: 1, reward: 3 },
];
export const DAILY_QUEST_COUNT = 3; // 하루에 활성화되는 퀘스트 수
export const DAILY_ALL_BONUS = 5; // 활성 퀘스트 전부 완료 보너스
export const ATTEND_BASE_COIN = 3; // 출석 1일차 보상
export const ATTEND_MAX_COIN = 10; // 연속 출석 보상 상한 (1일차 3 → +1/일)
export const ATTEND_WEEKLY_BONUS = 5; // 연속 7일마다 추가 보너스

/** KST 기준 날짜 키 (YYYY-MM-DD) — 자정에 퀘스트/출석 리셋 */
export function dailyDateKey(now = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** KST 토·일 — 주식 휴장 / 출석 연속 유지 판정 */
export function isKstWeekend(ts = Date.now()): boolean {
  const day = new Date(ts + 9 * 3600_000).getUTCDay();
  return day === 0 || day === 6;
}

/** 마지막 출석일 이후 빠진 날이 전부 주말(토·일)이면 연속 출석 유지 (금 출석 → 월 접속 = 연속) */
export function attendStreakKeeps(lastDateKey: string, todayKey: string): boolean {
  const dayMs = 24 * 3600_000;
  const last = Date.parse(`${lastDateKey}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (!Number.isFinite(last) || !Number.isFinite(today) || today <= last) return false;
  for (let t = last + dayMs; t < today; t += dayMs) {
    const day = new Date(t).getUTCDay(); // 날짜 라벨의 요일 (타임존 무관)
    if (day !== 0 && day !== 6) return false; // 평일 결석 → 스트릭 리셋
  }
  return true;
}

/** 날짜 키로 결정되는 오늘의 퀘스트 id — 모든 유저가 같은 세트 */
export function dailyQuestIdsFor(dateKey: string): string[] {
  let seed = 0;
  for (const ch of dateKey) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const ids = DAILY_QUESTS.map((q) => q.id);
  for (let i = ids.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, DAILY_QUEST_COUNT);
}

export interface DailyState {
  date: string;
  /** 연속 출석 일수 */
  streak: number;
  quests: { id: string; name: string; goal: number; reward: number; count: number; claimed: boolean }[];
  allBonusClaimed: boolean;
  /** 방금 발생한 안내 (출석/퀘스트 완료) — 있을 때만 */
  news?: string;
}

// ---- 젬(💎) — 일퀘/출석 보너스로 얻는 프리미엄 재화. 액션 구매 전용 (골드로 구매 불가) ----
export interface ActionShopItem {
  id: ActionId;
  name: string;
  /** 💎 가격 */
  price: number;
}
export const ACTION_SHOP: ActionShopItem[] = [
  { id: 'slash', name: '베기', price: 8 },
  { id: 'jab', name: '찌르기', price: 8 },
  { id: 'shot', name: '쏘기', price: 8 },
  { id: 'block', name: '막기', price: 6 },
  { id: 'roll', name: '구르기', price: 6 },
  { id: 'jump', name: '점프', price: 6 },
  { id: 'death', name: '죽은척', price: 10 },
  { id: 'crawl', name: '엎드려', price: 6 },
  { id: 'ready', name: '전투준비', price: 6 },
];

// ---- 💱 환전 (상점) — 골드↔젬. 🪙 1,000 → 💎 1, 💎 1 → 🪙 900 (스프레드 10%는 소각) ----
// 판정·잔액은 서버(exchange 이벤트). 젬→골드는 코인 획득 누적(coinsEarned)에 넣지 않는다 (환전 반복이 업적 카운터를 부풀리지 않도록).
export const EXCHANGE_GOLD_PER_GEM_BUY = 1000; // 🪙 → 💎 1개당 골드
export const EXCHANGE_GOLD_PER_GEM_SELL = 900; // 💎 1개 → 🪙
export const EXCHANGE_MAX_QTY = 1000; // 1회 최대 💎 수량
export type ExchangeDir = 'gold-to-gem' | 'gem-to-gold';
export interface ExchangeResult {
  ok: boolean;
  error?: string;
  coins?: number;
  gems?: number;
  /** 이번에 교환된 💎 수량 */
  qty?: number;
  /** 적용된 환율 (펫 효과 반영) */
  buyRate?: number;
  sellRate?: number;
}

// ---- 🐾 펫 / 펫 가챠 (기획: docs/pet-gacha-design.md, 수치 원본 docs/pet-defs.json) ----
// 뽑기 판정·보유·돌파·레벨·포만도·효과 합산은 서버 권위. 클라 로컬 롤(낚시/발굴/선물상자/러너)은 지갑 petFx 배율만 적용.
// composer.ts에 UI용 복사본(PET_FX / PET_DEFS) — 수치 변경 시 동기화 유지 (verify-pet가 검사)

export type PetStar = 4 | 5;
export type PetItemKind = 'food' | 'card';
export type PetFxKey =
  | 'coinMin'
  | 'gemHour'
  | 'nightCoin'
  | 'nightFish'
  | 'nightGem'
  | 'morningCoin'
  | 'stockProfit'
  | 'stockDelist'
  | 'stockBonus'
  | 'fishCoin'
  | 'fishNew'
  | 'fishRepeat'
  | 'fishCd'
  | 'fishTrophy'
  | 'fishTrophyCoin'
  | 'fishChest'
  | 'fishDouble'
  | 'digCoin'
  | 'digCd'
  | 'digGem'
  | 'digChest'
  | 'digMiss'
  | 'runCoin'
  | 'runCap'
  | 'runCd'
  | 'runShield'
  | 'slotWin'
  | 'slotFree'
  | 'slotRetry'
  | 'dailyGemChance'
  | 'dailyAll'
  | 'attendCoin'
  | 'attendCap'
  | 'attendWeek'
  | 'enhCost'
  | 'enhDrop'
  | 'enhPity'
  | 'batAtk'
  | 'batHp'
  | 'batCrit'
  | 'batCritMult'
  | 'batLuck'
  | 'batCap'
  | 'batCoin'
  | 'batGem'
  | 'batMineral'
  | 'batSpeed'
  | 'batBoss'
  | 'batBossCoin'
  | 'batBossGem'
  | 'batTicks'
  | 'batLoseCd'
  | 'tierFrost'
  | 'giftCd'
  | 'giftDouble'
  | 'exSell'
  | 'exBuy'
  | 'noteCd'
  | 'noteCost'
  | 'adCost'
  | 'adCd'
  | 'bragCd'
  | 'randCost'
  | 'satiety'
  | 'foodPrice';
export interface PetFxDef {
  /** 표시 템플릿 ({v} = 값) */
  label: string;
  /** 장착 펫 합산 상한 */
  cap: number;
  /** 클라 로컬 롤/타이머/표시에 필요한 키 — 지갑 스냅샷 petFx로 내려줌 */
  client?: boolean;
}
export const PET_FX: Record<PetFxKey, PetFxDef> = {
  coinMin: { label: '분당 골드 +{v}', cap: 3 },
  gemHour: { label: '시간당 💎 +{v}', cap: 2 },
  nightCoin: { label: '밤(KST 22~06시) 분당 골드 +{v}', cap: 2 },
  nightFish: { label: '밤(KST 22~06시) 낚시 골드 +{v}%', cap: 40 },
  nightGem: { label: '밤(KST 22~06시) 시간당 💎 +{v}', cap: 1 },
  morningCoin: { label: '아침(KST 06~10시) 분당 골드 +{v}', cap: 2 },
  stockProfit: { label: '주식 매도 실현수익 +{v}%', cap: 40 },
  stockDelist: { label: '상장폐지 시 보유가치의 {v}% 보상', cap: 50 },
  stockBonus: { label: '주식 매수 시 {v}% 확률로 1주 덤', cap: 15 },
  fishCoin: { label: '낚시 골드 +{v}%', cap: 50 },
  fishNew: { label: '첫 어획 골드 +{v}%', cap: 150 },
  fishRepeat: { label: '반복 어획 골드 +{v}', cap: 2 },
  fishCd: { label: '입질 대기 시간 −{v}%', cap: 40, client: true },
  fishTrophy: { label: '월척 확률 +{v}%p', cap: 1, client: true },
  fishTrophyCoin: { label: '월척 보너스 골드 +{v}', cap: 15 },
  fishChest: { label: '낚시 상자류 확률 +{v}% (상대)', cap: 100, client: true },
  fishDouble: { label: '더블캐치 확률 +{v}%p', cap: 20 },
  digCoin: { label: '발굴 골드 +{v}%', cap: 50 },
  digCd: { label: '발굴 쿨타임 −{v}%', cap: 40, client: true },
  digGem: { label: '젬조각·보석·다이아 확률 +{v}% (상대)', cap: 100, client: true },
  digChest: { label: '발굴 상자 확률 +{v}% (상대)', cap: 100, client: true },
  digMiss: { label: '꽝이어도 골드 +{v} 보장', cap: 2 },
  runCoin: { label: '달리기 골드 +{v}%', cap: 60 },
  runCap: { label: '달리기 최대 골드 +{v}', cap: 20 },
  runCd: { label: '러너 쿨타임 −{v}%', cap: 60, client: true },
  runShield: { label: '러너 트랩 보호막 {v}회', cap: 3, client: true },
  slotWin: { label: '슬롯 당첨금 +{v}%', cap: 30 },
  slotFree: { label: '슬롯 무료 스핀 확률 {v}%', cap: 20 },
  slotRetry: { label: '슬롯 꽝 시 {v}% 확률로 1회 재굴림', cap: 30 },
  dailyGemChance: { label: '일일퀘스트 완료 시 {v}% 확률로 💎 +1', cap: 100 },
  dailyAll: { label: '일퀘 올클리어 보너스 💎 +{v}', cap: 5 },
  attendCoin: { label: '출석 골드 +{v}%', cap: 150 },
  attendCap: { label: '연속 출석 골드 상한 +{v}', cap: 10 },
  attendWeek: { label: '연속 7일 보너스 💎 +{v}', cap: 8 },
  enhCost: { label: '강화 비용 −{v}%', cap: 30 },
  enhDrop: { label: '강화 하락 확률 −{v}% (상대)', cap: 40 },
  enhPity: { label: '강화 천장 −{v}회', cap: 3 },
  batAtk: { label: '원정 공격력 +{v}%', cap: 50 },
  batHp: { label: '원정 체력 +{v}%', cap: 50 },
  batCrit: { label: '원정 치명타 +{v}%p', cap: 15 },
  batCritMult: { label: '원정 치명타 배율 +{v}', cap: 0.3 },
  batLuck: { label: '원정 행운(드랍률) +{v}%', cap: 60 },
  batCap: { label: '원정 가방 상한 +{v}시간', cap: 6 },
  batCoin: { label: '원정 전리품 골드 +{v}%', cap: 40 },
  batGem: { label: '원정 💎 드랍률 +{v}%', cap: 100 },
  batMineral: { label: '원정 광물 드랍률 +{v}%', cap: 60 },
  batSpeed: { label: '원정 처치 속도 +{v}%', cap: 30 },
  batBoss: { label: '수문장·보스전 공격 +{v}%', cap: 50 },
  batBossCoin: { label: '수문장 첫 처치 골드 +{v}%', cap: 50 },
  batBossGem: { label: '5·10층 보스 첫 처치 💎 +{v}', cap: 3 },
  batTicks: { label: '수문장전 제한 시간 +{v}틱', cap: 60 },
  batLoseCd: { label: '도전 실패 쿨타임 −{v}%', cap: 75 },
  tierFrost: { label: '서리 산맥(51~60층) 공격 +{v}%', cap: 40 },
  giftCd: { label: '선물상자 등장 주기 −{v}%', cap: 40, client: true },
  giftDouble: { label: '선물상자 파츠 2개 확률 {v}%', cap: 40, client: true },
  exSell: { label: '젬→골드 환전 +{v}골드/💎', cap: 40 },
  exBuy: { label: '골드→젬 환전 −{v}골드/💎', cap: 40 },
  noteCd: { label: '쪽지 쿨타임 −{v}%', cap: 60 },
  noteCost: { label: '쪽지 비용 −{v}골드', cap: 4 },
  adCost: { label: '전광판 광고비 −{v}%', cap: 50 },
  adCd: { label: '광고 쿨타임 −{v}%', cap: 60 },
  bragCd: { label: '자랑하기 쿨타임 −{v}%', cap: 75 },
  randCost: { label: '랜덤 파츠 뽑기 비용 −{v}%', cap: 30 },
  satiety: { label: '장착 펫 포만도 감소 속도 −{v}%', cap: 50 },
  foodPrice: { label: '상점 펫 먹이 가격 −{v}%', cap: 50 },
};
export const PET_FX_KEYS = Object.keys(PET_FX) as PetFxKey[];
/** [효과 키, 돌파 단계별 누적값] — s1: 0/1/3/6/9/10돌, minor: 2/4/8돌, s2: 5/7/10돌 */
export type PetProg = [PetFxKey, number[]];
export interface PetDef {
  id: string;
  name: string;
  star: PetStar;
  theme: string;
  flavor: string;
  /** 부유형 (공중에 떠서 따라다님) */
  float?: boolean;
  /** 0돌 주효과 (1·3·6·9돌 수치 상승, 10돌 대폭) */
  s1: PetProg[];
  /** 2돌 소소한 능력 (4·8돌 상승) */
  minor: PetProg[];
  /** 5돌 특수효과 Ⅱ (7·10돌 상승) */
  s2: PetProg[];
  /** 10돌 특수효과 Ⅲ */
  s3: [PetFxKey, number][];
}
export const PET_DEFS: PetDef[] = [
  { id: 'wildfire', name: '도깨비불', star: 5, theme: '젬 정령', flavor: '푸른 불꽃의 정령. 곁에 두면 젬이 조금씩 모인다. 10돌이면 환전소가 우대 창구가 된다.', float: true, s1: [['gemHour', [0.5, 0.6, 0.7, 0.8, 0.9, 1.5]]], minor: [['giftCd', [5, 8, 11]]], s2: [['exSell', [20, 30, 40]]], s3: [['exBuy', 40]] },
  { id: 'moonwolf', name: '달그림자 늑대', star: 5, theme: '원정 전투', flavor: '보랏빛 털의 전투형 늑대. 원정 공격력의 최상위 카드.', s1: [['batAtk', [10, 13, 16, 19, 22, 30]]], minor: [['batCrit', [1, 2, 3]]], s2: [['batCap', [2, 3, 4]]], s3: [['batCoin', 25], ['batGem', 50]] },
  { id: 'fireskull', name: '불꽃 해골', star: 5, theme: '슬롯·도박', flavor: '도박에 미친 해골. 슬롯 당첨금과 무료 스핀, 강화 하락 방어까지.', float: true, s1: [['slotWin', [10, 13, 16, 19, 22, 25]]], minor: [['slotFree', [2, 3.5, 5]]], s2: [['enhDrop', [10, 15, 20]]], s3: [['slotRetry', 20]] },
  { id: 'slime', name: '에메랄드 슬라임', star: 5, theme: '낚시·발굴 속도', flavor: '찐득한 슬라임이 입질을 앞당기고 삽질을 빠르게 한다. 10돌 더블캐치 10%.', s1: [['fishCd', [10, 13, 16, 19, 22, 25]]], minor: [['digCd', [3, 6, 9]]], s2: [['digCoin', [10, 15, 20]]], s3: [['fishDouble', 10]] },
  { id: 'cat-gray', name: '잿빛 고양이', star: 5, theme: '주식·자산', flavor: '냉정한 투자 고양이. 실현수익을 불리고 상폐 손실을 메워준다.', s1: [['stockProfit', [10, 14, 18, 22, 26, 30]]], minor: [['adCost', [5, 10, 15]]], s2: [['attendCoin', [50, 75, 100]]], s3: [['coinMin', 1], ['stockDelist', 30]] },
  { id: 'cat-orange', name: '호박 고양이', star: 5, theme: '일퀘·출석', flavor: '부지런한 주황 고양이. 일일퀘스트마다 젬을 덤으로 챙긴다. 10돌은 퀘스트당 +1 확정.', s1: [['dailyGemChance', [30, 40, 50, 60, 70, 100]]], minor: [['attendCoin', [20, 30, 40]]], s2: [['dailyAll', [1, 2, 3]]], s3: [['attendWeek', 3]] },
  { id: 'cat-white', name: '백설 고양이', star: 5, theme: '달리기·전천후', flavor: '눈처럼 빠른 흰 고양이. 러너 보상과 쿨타임 전문.', s1: [['runCoin', [20, 25, 30, 35, 40, 60]]], minor: [['coinMin', [0.2, 0.3, 0.4]]], s2: [['runCd', [20, 30, 50]]], s3: [['runCap', 10], ['fishCoin', 10]] },
  { id: 'CubicAraraAzul', name: '파랑앵무', star: 4, theme: '소셜(쪽지·광고)', flavor: '수다스러운 앵무새. 쪽지를 자주 보낼 수 있게 해준다.', s1: [['noteCd', [20, 25, 30, 35, 40, 60]]], minor: [['coinMin', [0.1, 0.15, 0.2]]], s2: [['adCost', [10, 15, 25]]], s3: [['noteCost', 3]] },
  { id: 'CubicBat', name: '박쥐', star: 4, theme: '야행성 골드', flavor: '밤(22~06시)에만 힘을 내는 박쥐. 야간 접속 유저용.', s1: [['nightCoin', [0.5, 0.6, 0.7, 0.8, 0.9, 1.5]]], minor: [['batCrit', [0.5, 1, 1.5]]], s2: [['nightFish', [10, 15, 25]]], s3: [['nightGem', 0.5]] },
  { id: 'CubicBull', name: '황소', star: 4, theme: '주식(불장)', flavor: '상승장의 상징. 매도 실현수익을 불려준다.', s1: [['stockProfit', [5, 6, 7, 8, 9, 15]]], minor: [['coinMin', [0.1, 0.15, 0.2]]], s2: [['adCost', [10, 15, 25]]], s3: [['stockDelist', 15]] },
  { id: 'CubicBunny', name: '토끼', star: 4, theme: '달리기', flavor: '깡충깡충. 러너 보상과 쿨타임, 10돌엔 트랩 보호막.', s1: [['runCoin', [10, 12, 14, 16, 18, 30]]], minor: [['runCap', [2, 3, 4]]], s2: [['runCd', [20, 25, 35]]], s3: [['runShield', 1]] },
  { id: 'CubicCat', name: '고양이', star: 4, theme: '선물상자·호기심', flavor: '호기심 많은 고양이. 선물상자가 더 자주 오고 낚시에서 상자를 잘 건진다.', s1: [['giftCd', [10, 12, 14, 16, 18, 25]]], minor: [['coinMin', [0.1, 0.15, 0.2]]], s2: [['fishChest', [30, 40, 60]]], s3: [['fishTrophy', 0.2]] },
  { id: 'CubicChameleon', name: '카멜레온', star: 4, theme: '변신·뽑기 할인', flavor: '외형 놀이 전문. 랜덤 파츠 뽑기와 강화 비용을 깎는다.', s1: [['randCost', [10, 12, 14, 16, 18, 25]]], minor: [['adCost', [5, 8, 10]]], s2: [['enhCost', [5, 7, 10]]], s3: [['giftDouble', 15]] },
  { id: 'CubicChicken', name: '닭', star: 4, theme: '출석·아침', flavor: '아침을 깨우는 닭. 출석 골드와 아침 접속 보너스.', s1: [['attendCoin', [30, 35, 40, 45, 50, 80]]], minor: [['coinMin', [0.1, 0.15, 0.2]]], s2: [['morningCoin', [0.5, 0.75, 1]]], s3: [['attendWeek', 2]] },
  { id: 'CubicCow', name: '젖소', star: 4, theme: '골드 패시브', flavor: '느긋하게 골드를 짜내는 젖소. 10돌이면 분당 +1 골드.', s1: [['coinMin', [0.3, 0.35, 0.4, 0.45, 0.5, 1]]], minor: [['fishCoin', [3, 4, 5]]], s2: [['attendCoin', [20, 30, 40]]], s3: [['satiety', 20]] },
  { id: 'CubicDolphin', name: '돌고래', star: 4, theme: '낚시 골드', flavor: '낚시꾼의 친구. 낚시 골드와 월척 확률.', s1: [['fishCoin', [8, 10, 12, 14, 16, 25]]], minor: [['fishCd', [2, 3, 4]]], s2: [['fishTrophy', [0.1, 0.15, 0.2]]], s3: [['fishDouble', 3]] },
  { id: 'CubicDuck', name: '오리', star: 4, theme: '낚시 속도', flavor: '물 위의 오리가 입질을 재촉한다.', s1: [['fishCd', [6, 8, 10, 12, 14, 20]]], minor: [['fishCoin', [2, 3, 4]]], s2: [['fishChest', [25, 35, 50]]], s3: [['fishRepeat', 1]] },
  { id: 'CubicElephant', name: '코끼리', star: 4, theme: '원정 체력', flavor: '든든한 체력 탱커. 가방도 조금 커진다.', s1: [['batHp', [8, 10, 12, 14, 16, 25]]], minor: [['batCap', [0.5, 0.75, 1]]], s2: [['batCoin', [5, 8, 12]]], s3: [['batTicks', 30]] },
  { id: 'CubicFish', name: '물고기', star: 4, theme: '낚시 도감', flavor: '도감 채우기 전문. 첫 어획 보상이 커진다.', s1: [['fishNew', [50, 60, 70, 80, 90, 150]]], minor: [['fishCoin', [2, 3, 4]]], s2: [['fishTrophyCoin', [5, 8, 12]]], s3: [['fishRepeat', 1]] },
  { id: 'CubicFlamingo', name: '플라밍고', star: 4, theme: '전광판 광고', flavor: '화려한 것을 좋아한다. 전광판 광고비·쿨타임 할인.', s1: [['adCost', [20, 25, 30, 35, 40, 50]]], minor: [['noteCd', [10, 15, 20]]], s2: [['adCd', [30, 40, 50]]], s3: [['coinMin', 0.5]] },
  { id: 'CubicFox', name: '여우', star: 4, theme: '슬롯(교활)', flavor: '교활한 여우. 슬롯 무료 스핀과 꽝 재굴림.', s1: [['slotFree', [3, 4, 5, 6, 7, 10]]], minor: [['slotWin', [2, 3, 4]]], s2: [['slotRetry', [10, 12, 15]]], s3: [['slotWin', 8]] },
  { id: 'CubicFrog', name: '개구리', star: 4, theme: '발굴 골드', flavor: '땅속 사정에 밝은 개구리. 발굴 골드와 보석 확률.', s1: [['digCoin', [8, 10, 12, 14, 16, 25]]], minor: [['digCd', [2, 3, 4]]], s2: [['digGem', [20, 30, 40]]], s3: [['digMiss', 1]] },
  { id: 'CubicGiraffe', name: '기린', star: 4, theme: '원정 행운', flavor: '높은 곳에서 전리품을 먼저 본다. 원정 드랍률 특화.', s1: [['batLuck', [10, 12, 14, 16, 18, 30]]], minor: [['batAtk', [1, 2, 3]]], s2: [['batMineral', [20, 30, 40]]], s3: [['batGem', 30]] },
  { id: 'CubicGrizzly', name: '회색곰', star: 4, theme: '원정 공격', flavor: '묵직한 한 방. 원정 공격력과 치명타.', s1: [['batAtk', [6, 7, 8, 9, 10, 16]]], minor: [['batHp', [1, 2, 3]]], s2: [['batCrit', [3, 4, 5]]], s3: [['batCritMult', 0.1]] },
  { id: 'CubicHorse', name: '말', star: 4, theme: '달리기 상한', flavor: '오래 달리는 말. 러너 최대 골드를 올린다.', s1: [['runCap', [5, 6, 7, 8, 9, 15]]], minor: [['runCoin', [5, 8, 10]]], s2: [['runCd', [25, 30, 40]]], s3: [['giftCd', 10]] },
  { id: 'CubicJaguatirica', name: '오셀롯', star: 4, theme: '원정 치명타', flavor: '야행성 사냥꾼. 치명타와 처치 속도.', s1: [['batCrit', [2, 2.5, 3, 3.5, 4, 6]]], minor: [['batAtk', [1, 2, 3]]], s2: [['batSpeed', [10, 15, 20]]], s3: [['nightCoin', 0.5]] },
  { id: 'CubicLion', name: '사자', star: 4, theme: '원정 보스전', flavor: '수문장 앞에서 포효한다. 보스전 전용 공격력.', s1: [['batBoss', [10, 12, 14, 16, 18, 30]]], minor: [['batHp', [1, 2, 3]]], s2: [['batBossCoin', [25, 35, 50]]], s3: [['batLoseCd', 50]] },
  { id: 'CubicLoboGuara', name: '갈기늑대', star: 4, theme: '원정 젬 드랍', flavor: '반짝이는 것을 물어오는 늑대. 원정 젬 드랍 특화.', s1: [['batGem', [20, 25, 30, 35, 40, 60]]], minor: [['batLuck', [2, 4, 6]]], s2: [['batMineral', [15, 25, 35]]], s3: [['batBossGem', 1]] },
  { id: 'CubicMicoLeaoDourado', name: '황금타마린', star: 4, theme: '골드·환전', flavor: '황금빛 원숭이. 분당 골드와 환전 우대.', s1: [['coinMin', [0.4, 0.45, 0.5, 0.55, 0.6, 1.2]]], minor: [['slotWin', [2, 3, 4]]], s2: [['exSell', [10, 20, 30]]], s3: [['exBuy', 20]] },
  { id: 'CubicMonkey', name: '원숭이', star: 4, theme: '선물상자', flavor: '장난꾸러기. 선물상자를 더 자주, 가끔 두 개씩.', s1: [['giftCd', [8, 10, 12, 14, 16, 22]]], minor: [['runCoin', [3, 5, 7]]], s2: [['giftDouble', [10, 15, 25]]], s3: [['randCost', 15]] },
  { id: 'CubicMoose', name: '무스', star: 4, theme: '원정 가방', flavor: '큰 뿔에 전리품을 잔뜩 건다. 가방 상한 특화 (방치 유저용).', s1: [['batCap', [1, 1.25, 1.5, 1.75, 2, 3]]], minor: [['batHp', [2, 3, 4]]], s2: [['batCoin', [8, 12, 15]]], s3: [['batTicks', 20]] },
  { id: 'CubicOwl', name: '부엉이', star: 4, theme: '일퀘 젬', flavor: '지혜로운 부엉이. 일일퀘스트 젬 보너스.', s1: [['dailyGemChance', [15, 20, 25, 30, 35, 50]]], minor: [['nightCoin', [0.2, 0.3, 0.4]]], s2: [['dailyAll', [1, 2, 3]]], s3: [['attendWeek', 2]] },
  { id: 'CubicPanda', name: '판다', star: 4, theme: '강화 비용', flavor: '느긋한 판다. 대장간 비용과 하락 확률을 낮춘다. 배도 덜 고프다.', s1: [['enhCost', [8, 10, 12, 14, 16, 25]]], minor: [['coinMin', [0.1, 0.15, 0.2]]], s2: [['enhDrop', [10, 15, 20]]], s3: [['satiety', 25]] },
  { id: 'CubicPenguin', name: '펭귄', star: 4, theme: '얼음낚시', flavor: '얼음 구멍 낚시의 달인.', s1: [['fishCoin', [6, 8, 10, 12, 14, 20]]], minor: [['fishCd', [2, 3, 4]]], s2: [['fishChest', [20, 30, 45]]], s3: [['fishRepeat', 1]] },
  { id: 'CubicPig', name: '돼지', star: 4, theme: '저금통·출석', flavor: '저금통 돼지. 출석 골드가 크게 늘고 먹이도 싸게 산다.', s1: [['attendCoin', [50, 60, 70, 80, 90, 120]]], minor: [['coinMin', [0.1, 0.15, 0.2]]], s2: [['slotWin', [5, 8, 12]]], s3: [['foodPrice', 25]] },
  { id: 'CubicPolar', name: '북극곰', star: 4, theme: '원정 체력(서리)', flavor: '서리 산맥의 주인. 51~60층에서 특히 강하다.', s1: [['batHp', [10, 12, 14, 16, 18, 28]]], minor: [['batAtk', [1, 2, 3]]], s2: [['tierFrost', [20, 30, 40]]], s3: [['batTicks', 30]] },
  { id: 'CubicRacoon', name: '너구리', star: 4, theme: '발굴 속도', flavor: '뒤지기 전문가. 삽질이 빨라지고 상자를 잘 찾는다.', s1: [['digCd', [8, 10, 12, 14, 16, 22]]], minor: [['digCoin', [3, 5, 7]]], s2: [['digChest', [30, 45, 60]]], s3: [['digGem', 30]] },
  { id: 'CubicRat', name: '쥐', star: 4, theme: '발굴 젬조각', flavor: '작은 틈의 반짝임을 놓치지 않는다. 젬조각·보석·다이아 확률.', s1: [['digGem', [30, 40, 50, 60, 70, 100]]], minor: [['digCoin', [2, 3, 4]]], s2: [['digCd', [5, 8, 10]]], s3: [['digMiss', 2]] },
  { id: 'CubicRhino', name: '코뿔소', star: 4, theme: '원정 돌진', flavor: '실패해도 바로 다시 들이받는다. 도전 쿨타임 감소.', s1: [['batAtk', [8, 9, 10, 11, 12, 20]]], minor: [['batHp', [2, 3, 4]]], s2: [['batLoseCd', [50, 60, 75]]], s3: [['batSpeed', 15]] },
  { id: 'CubicSheep', name: '양', star: 4, theme: '골드·포만도', flavor: '온순한 양. 분당 골드와 먹이 절약.', s1: [['coinMin', [0.25, 0.3, 0.35, 0.4, 0.45, 0.8]]], minor: [['noteCd', [10, 15, 20]]], s2: [['satiety', [10, 15, 20]]], s3: [['foodPrice', 20]] },
  { id: 'CubicShiba', name: '시바견', star: 4, theme: '충성·출석', flavor: '매일 문 앞에서 기다린다. 연속 출석 보상 특화.', s1: [['attendCoin', [40, 45, 50, 55, 60, 90]]], minor: [['attendCap', [1, 2, 3]]], s2: [['attendWeek', [1, 2, 3]]], s3: [['dailyAll', 2]] },
  { id: 'CubicSnake', name: '뱀', star: 4, theme: '주식(변동성)', flavor: '변동성을 즐기는 뱀. 상폐 보상과 매수 덤.', s1: [['stockProfit', [4, 5, 6, 7, 8, 12]]], minor: [['adCost', [5, 8, 10]]], s2: [['stockDelist', [10, 15, 25]]], s3: [['stockBonus', 5]] },
  { id: 'CubicToucan', name: '투칸', star: 4, theme: '광고·자랑', flavor: '큰 부리로 떠든다. 광고와 자랑하기 쿨타임.', s1: [['adCost', [15, 20, 25, 30, 35, 45]]], minor: [['noteCd', [10, 15, 20]]], s2: [['bragCd', [50, 60, 75]]], s3: [['adCd', 50]] },
  { id: 'CubicTurtle', name: '거북', star: 4, theme: '강화 안정', flavor: '느리지만 확실하게. 강화 하락 방어와 천장 단축.', s1: [['enhDrop', [8, 10, 12, 14, 16, 25]]], minor: [['enhCost', [2, 3, 4]]], s2: [['satiety', [10, 15, 20]]], s3: [['enhPity', 1]] },
  { id: 'CubicUnicorn', name: '유니콘', star: 4, theme: '젬 패시브', flavor: '4성 유일의 젬 패시브. 도깨비불의 축소판.', s1: [['gemHour', [0.2, 0.25, 0.3, 0.35, 0.4, 0.6]]], minor: [['giftCd', [5, 8, 10]]], s2: [['exSell', [20, 30, 40]]], s3: [['exBuy', 30]] },
  { id: 'CubicWolf', name: '늑대', star: 4, theme: '원정 균형', flavor: '무리 사냥꾼. 공격·체력을 고르게 올린다.', s1: [['batAtk', [5, 6, 7, 8, 9, 12]], ['batHp', [5, 6, 7, 8, 9, 12]]], minor: [['batLuck', [2, 4, 6]]], s2: [['batSpeed', [10, 15, 20]]], s3: [['batCrit', 3]] },
  { id: 'CubicZebra', name: '얼룩말', star: 4, theme: '달리기 골드', flavor: '줄무늬 스프린터. 러너 골드와 보호막 2회.', s1: [['runCoin', [15, 17, 19, 21, 23, 35]]], minor: [['runCap', [2, 3, 4]]], s2: [['runCd', [15, 25, 35]]], s3: [['runShield', 2]] },
];
export const PET_BY_ID: ReadonlyMap<string, PetDef> = new Map(PET_DEFS.map((p) => [p.id, p]));
export const PET_MAX_DUP = 10;
export type PetFx = Partial<Record<PetFxKey, number>>;

const PET_S1_STEPS = [0, 1, 3, 6, 9, 10];
const PET_MINOR_STEPS = [2, 4, 8];
const PET_S2_STEPS = [5, 7, 10];
function petProgPick(out: PetFx, entries: PetProg[], steps: number[], dup: number): void {
  let idx = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i] <= dup) idx = i;
  if (idx < 0) return;
  for (const [k, arr] of entries) out[k] = (out[k] ?? 0) + arr[idx];
}
/** 돌파 dup(0~10)에서 활성화된 효과 누적값 */
export function petEffectsAt(def: PetDef, dup: number): PetFx {
  const out: PetFx = {};
  petProgPick(out, def.s1, PET_S1_STEPS, dup);
  petProgPick(out, def.minor, PET_MINOR_STEPS, dup);
  petProgPick(out, def.s2, PET_S2_STEPS, dup);
  if (dup >= PET_MAX_DUP) for (const [k, v] of def.s3) out[k] = (out[k] ?? 0) + v;
  return out;
}
export function petFxLabel(key: PetFxKey, v: number): string {
  const s = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return PET_FX[key].label.replace('{v}', s);
}

// 뽑기 — 확률/천장 (판정 순서: 5성 → 4성 → 3성)
export const PET_GACHA = {
  single: 5, // 💎 1회
  ten: 50, // 💎 10회
  fridayTen: 40, // KST 금요일 첫 10연 할인가
  rate5: 0.6, // %
  rate4: 10, // %
  softPity5From: 70, // 이 회차부터 5성 확률 +softPity5Step %p/회
  softPity5Step: 5,
  hardPity5: 90,
  /** 4성 보정 — 이번 뽑기 순번(pity4+1)별 % (10번째 100%) */
  pity4: [10, 10, 10, 10, 10, 10, 30, 40, 50, 100],
} as const;
/** k = 이번 뽑기가 마지막 5성 이후 몇 번째인가 (pity5 + 1) */
export function petRate5(k: number): number {
  if (k >= PET_GACHA.hardPity5) return 100;
  return Math.min(100, PET_GACHA.rate5 + PET_GACHA.softPity5Step * Math.max(0, k - (PET_GACHA.softPity5From - 1)));
}
/** k = 마지막 4성 이상 이후 몇 번째인가 (pity4 + 1) */
export function petRate4(k: number): number {
  return PET_GACHA.pity4[Math.min(PET_GACHA.pity4.length, Math.max(1, k)) - 1];
}
/** 3성 결과 풀 (가중치) */
export const PET_3STAR_POOL: { item: PetItemKind; n: number; w: number }[] = [
  { item: 'food', n: 1, w: 60 },
  { item: 'food', n: 3, w: 25 },
  { item: 'card', n: 1, w: 15 },
];
/** 만돌(10돌) 이후 중복 환급 */
export const PET_REFUND: Record<PetStar, { gems: number; cards: number }> = {
  4: { gems: 3, cards: 1 },
  5: { gems: 20, cards: 5 },
};
/** KST 금요일 — 첫 10연 할인 */
export function isPetFriday(ts = Date.now()): boolean {
  return new Date(ts + 9 * 3600_000).getUTCDay() === 5;
}

// 레벨 (경험치카드) — 포만도 감소 완화만
export const PET_LEVEL_CARDS = [1, 2, 4, 8, 16, 32, 64, 128, 256]; // Lv n→n+1 필요 장수 (index n-1), 누적 511
export const PET_MAX_LEVEL = 10;
/** 포만도 1% 감소에 걸리는 분 (Lv1 3분 → Lv10 15분) */
export const PET_SATIETY_MIN_PER_PCT = [3, 4, 5, 6, 7.5, 9, 10.5, 12, 13.5, 15];
export function petSatietyMinPerPct(lv: number): number {
  return PET_SATIETY_MIN_PER_PCT[Math.min(PET_MAX_LEVEL, Math.max(1, lv)) - 1];
}
export const PET_SATIETY_LOW = 70; // 이하: 효과 ×0.7
export const PET_SATIETY_CRIT = 30; // 이하: 효과 ×0.1
export const PET_SATIETY_LOW_MULT = 0.7;
export const PET_SATIETY_CRIT_MULT = 0.1;
export function petSatietyMult(satiety: number): number {
  return satiety <= PET_SATIETY_CRIT ? PET_SATIETY_CRIT_MULT : satiety <= PET_SATIETY_LOW ? PET_SATIETY_LOW_MULT : 1;
}
export const PET_AUTOFEED_DEFAULT_PCT = 70;
export const PET_FOOD_PRICE = 200; // 🪙 (상점, foodPrice 효과로 할인)
export const PET_CARD_PRICE_GEM = 1; // 💎 (상점)
export const PET_ITEM_BUY_MAX = 999;
/** 장착 슬롯 — 보유 펫 종 수 기준 (0종: 1칸, 15종: 2칸, 35종: 3칸) */
export const PET_SLOT_THRESHOLDS = [0, 15, 35];
export function petSlotsFor(ownedKinds: number): number {
  let n = 0;
  for (const t of PET_SLOT_THRESHOLDS) if (ownedKinds >= t) n++;
  return Math.max(1, n);
}

export interface PetOwned {
  /** 돌파 0~10 */
  dup: number;
  /** 레벨 1~10 */
  lv: number;
  /** 포만도 0~100 (소수) */
  satiety: number;
  /** 마지막 포만도 계산 시각 */
  tick: number;
}
export interface PetStatePayload {
  owned: Record<string, PetOwned>;
  equip: string[];
  slots: number;
  food: number;
  cards: number;
  autoFeed: { on: boolean; pct: number };
  pity4: number;
  pity5: number;
  total: number;
  /** 오늘(KST 금) 10연 할인 사용 가능 */
  fridayDiscount: boolean;
  /** 장착 펫 효과 합산 (포만도 배율·상한 적용) */
  fx: PetFx;
  coins: number;
  gems: number;
  now: number;
}
export interface PetPull {
  star: 3 | 4 | 5;
  /** 4·5성: 펫 id */
  id?: string;
  /** 3성: 아이템 */
  item?: PetItemKind;
  n?: number;
  isNew?: boolean;
  /** 획득 후 돌파 */
  dup?: number;
  /** 만돌 초과 환급 */
  refund?: { gems: number; cards: number };
}
export interface PetGachaResult {
  ok: boolean;
  error?: string;
  count?: number;
  cost?: number;
  results?: PetPull[];
  state?: PetStatePayload;
}
export interface PetActionResult {
  ok: boolean;
  error?: string;
  state?: PetStatePayload;
}

// ---- 도전과제 / 칭호 ----
// 판정은 서버 (지갑 파생 metric + 누적 카운터 + 이벤트성 직접 지급).
// metric 키는 서버 achMetrics()가 계산 — stat이 있는 업적은 metric >= goal 도달 시 자동 달성.
// stat이 없는 업적(이벤트성)은 해당 이벤트 코드에서 grantAch()로 직접 지급.
// composer.ts에 패널 UI용 복사본(ACH_DEFS) 있음 — 수치 변경 시 동기화 유지 (verify-ach가 검사)

export interface AchievementDef {
  id: string;
  /** 표시 카테고리 */
  cat: string;
  name: string;
  /** 달성 조건 설명 */
  desc: string;
  /** 보상 젬 */
  gems: number;
  /** 착용 가능 칭호 (달성 시 전체 알림) */
  title?: string;
  /** 달성 전 목록에서 ??? 표시 */
  hidden?: boolean;
  /** 진행도 metric 키 (이벤트성 업적은 없음) */
  stat?: string;
  goal?: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // 낚시
  { id: 'f-first', cat: '낚시', name: '첫 입질', desc: '물고기 첫 어획', gems: 2, stat: 'fishDex', goal: 1 },
  { id: 'f-dex20', cat: '낚시', name: '견습 낚시꾼', desc: '낚시도감 20종', gems: 3, stat: 'fishDex', goal: 20 },
  { id: 'f-dex50', cat: '낚시', name: '낚시 좀 치는 사람', desc: '낚시도감 50종', gems: 5, stat: 'fishDex', goal: 50 },
  { id: 'f-dex100', cat: '낚시', name: '프로 낚시꾼', desc: '낚시도감 100종', gems: 10, title: '프로 낚시꾼', stat: 'fishDex', goal: 100 },
  { id: 'f-dex161', cat: '낚시', name: '어류대백과', desc: '낚시도감 161종 완성', gems: 30, title: '어류학자', stat: 'fishDex', goal: 161 },
  { id: 'f-total100', cat: '낚시', name: '손맛 중독', desc: '누적 어획 100마리', gems: 3, stat: 'fishTotal', goal: 100 },
  { id: 'f-total1000', cat: '낚시', name: '물 반 고기 반', desc: '누적 어획 1,000마리', gems: 10, stat: 'fishTotal', goal: 1000 },
  { id: 'f-trophy1', cat: '낚시', name: '월척이야!', desc: '월척 1종 달성', gems: 3, stat: 'trophyDex', goal: 1 },
  { id: 'f-trophy10', cat: '낚시', name: '월척 수집가', desc: '월척 10종 달성', gems: 10, title: '월척 헌터', stat: 'trophyDex', goal: 10 },
  { id: 'f-trophy30', cat: '낚시', name: '전설의 조사', desc: '월척 30종 달성', gems: 20, title: '전설의 낚시꾼', stat: 'trophyDex', goal: 30 },
  { id: 'f-box', cat: '낚시', name: '웬 상자?', desc: '낚시로 상자 첫 획득', gems: 1, stat: 'boxes', goal: 1 },
  { id: 'f-chest', cat: '낚시', name: '보물찾기', desc: '낚시로 보물상자 첫 획득', gems: 3, stat: 'chests', goal: 1 },
  { id: 'f-chest10', cat: '낚시', name: '인양 전문가', desc: '보물상자 누적 10개', gems: 10, title: '트레저 헌터', stat: 'chests', goal: 10 },
  // 강화
  { id: 'e-try', cat: '강화', name: '망치를 들다', desc: '첫 강화 시도', gems: 1, stat: 'enhanceTries', goal: 1 },
  { id: 'e-10', cat: '강화', name: '옛 기본기', desc: '낚싯대 10성 달성', gems: 3, stat: 'rodStars', goal: 10 },
  { id: 'e-15', cat: '강화', name: '첫 고비 돌파', desc: '낚싯대 15성 달성', gems: 5, stat: 'rodStars', goal: 15 },
  { id: 'e-20', cat: '강화', name: '불꽃의 경지', desc: '낚싯대 20성 달성', gems: 10, title: '장인', stat: 'rodStars', goal: 20 },
  { id: 'e-25', cat: '강화', name: '황금의 경지', desc: '낚싯대 25성 달성', gems: 15, title: '명장', stat: 'rodStars', goal: 25 },
  { id: 'e-30', cat: '강화', name: '무지개 너머', desc: '낚싯대 30성 달성', gems: 30, title: '대장장이의 신', stat: 'rodStars', goal: 30 },
  { id: 'e-pity', cat: '강화', name: '불사조', desc: '천장 보정(10연속 실패)으로 성공', gems: 5 },
  { id: 'e-drop', cat: '강화', name: '추락의 맛', desc: '강화 하락 경험', gems: 2, stat: 'enhanceDrops', goal: 1 },
  { id: 'e-bigdrop', cat: '강화', name: '그날의 기억', desc: '20성 이상에서 하락', gems: 5, hidden: true },
  { id: 'e-try100', cat: '강화', name: '망치질 백 번', desc: '누적 강화 100회', gems: 5, stat: 'enhanceTries', goal: 100 },
  // 경제
  { id: 'c-coin100', cat: '경제', name: '티끌 모아', desc: '보유 코인 100 달성', gems: 2, stat: 'coinsNow', goal: 100 },
  { id: 'c-coin1000', cat: '경제', name: '자산가', desc: '보유 코인 1,000 달성', gems: 10, title: '부자', stat: 'coinsNow', goal: 1000 },
  { id: 'c-earn5000', cat: '경제', name: '돈이 도는 삶', desc: '누적 획득 코인 5,000', gems: 10, stat: 'coinsEarned', goal: 5000 },
  { id: 'c-jackpot', cat: '경제', name: '잭팟!', desc: '슬롯 잭팟 당첨', gems: 5 },
  { id: 'c-mega', cat: '경제', name: '머신을 이기다', desc: '슬롯 메가 잭팟 당첨', gems: 15, title: '도박왕' },
  { id: 'c-slot100', cat: '경제', name: '단골손님', desc: '슬롯 누적 100회', gems: 5, stat: 'slotSpins', goal: 100 },
  { id: 'c-missrun', cat: '경제', name: '오늘은 아닌가 봐', desc: '슬롯 10연속 꽝', gems: 3, hidden: true, stat: 'slotMissRun', goal: 10 },
  { id: 'c-shopall', cat: '경제', name: '쇼핑 마스터', desc: '상점 코스메틱 전부 구매', gems: 20, title: '컬렉터', stat: 'cosmetics', goal: 23 },
  { id: 'c-random10', cat: '경제', name: '뽑기의 맛', desc: '랜덤뽑기 10회', gems: 3, stat: 'randomPulls', goal: 10 },
  { id: 'c-actions', cat: '경제', name: '만능 연기자', desc: '액션 9종 전부 구매', gems: 10, title: '액션 스타', stat: 'actionsOwned', goal: 9 },
  // 주식
  { id: 's-first', cat: '주식', name: '주식 입문', desc: '주식 첫 매수', gems: 2, stat: 'stockBuys', goal: 1 },
  { id: 's-profit', cat: '주식', name: '떡상의 증인', desc: '실현 수익 누적 +100', gems: 10, title: '투자의 귀재', stat: 'stockProfit', goal: 100 },
  { id: 's-loss', cat: '주식', name: '한강은 차갑다', desc: '실현 손실 누적 -100', gems: 5, hidden: true, stat: 'stockLoss', goal: 100 },
  { id: 's-delist', cat: '주식', name: '상폐의 추억', desc: '보유 종목 상장폐지 경험', gems: 3 },
  { id: 's-100shares', cat: '주식', name: '몰빵의 미학', desc: '한 종목 100주 보유', gems: 10, title: '큰손', stat: 'stockQtyMax', goal: 100 },
  { id: 's-all', cat: '주식', name: '분산투자 교과서', desc: '10종목 동시 보유', gems: 5, stat: 'stockKinds', goal: 10 },
  // 소셜
  { id: 'm-chat100', cat: '소셜', name: '말문이 트이다', desc: '누적 채팅 100회', gems: 2, stat: 'chats', goal: 100 },
  { id: 'm-chat1000', cat: '소셜', name: '수다쟁이', desc: '누적 채팅 1,000회', gems: 5, stat: 'chats', goal: 1000 },
  { id: 'm-chat10000', cat: '소셜', name: '떠들썩한 인생', desc: '누적 채팅 10,000회', gems: 10, title: '수다왕', stat: 'chats', goal: 10000 },
  { id: 'm-image', cat: '소셜', name: '짤의 시작', desc: '이미지 첫 전송', gems: 2, stat: 'images', goal: 1 },
  { id: 'm-react100', cat: '소셜', name: '리액션 부자', desc: '리액션 누적 100회', gems: 3, stat: 'reactions', goal: 100 },
  { id: 'm-note', cat: '소셜', name: '그림 편지', desc: '그림 쪽지 첫 발송', gems: 2, stat: 'notesSent', goal: 1 },
  { id: 'm-note30', cat: '소셜', name: '동네 집배원', desc: '쪽지 30장 발송', gems: 10, title: '우체부', stat: 'notesSent', goal: 30 },
  { id: 'm-notes-got', cat: '소셜', name: '인기쟁이', desc: '쪽지 10장 수신', gems: 3, stat: 'notesGot', goal: 10 },
  { id: 'm-ad', cat: '소셜', name: '광고주', desc: '전광판 광고 첫 게재', gems: 3, stat: 'ads', goal: 1 },
  { id: 'm-ad10', cat: '소셜', name: '전광판 큰손', desc: '광고 누적 10회', gems: 10, title: '미디어 재벌', stat: 'ads', goal: 10 },
  { id: 'm-brag10', cat: '소셜', name: '자랑이 넘쳐', desc: '자랑하기 10회', gems: 3, stat: 'brags', goal: 10 },
  { id: 'm-pinned', cat: '소셜', name: '내 한마디', desc: '고정메시지 첫 설정', gems: 1, stat: 'pinnedSet', goal: 1 },
  // 미니게임
  { id: 'g-perfect', cat: '미니게임', name: '마라토너', desc: '러너 한 판 만점(20코인)', gems: 5 },
  { id: 'g-run100', cat: '미니게임', name: '달리는 게 좋아', desc: '러너 누적 100코인', gems: 5, stat: 'runnerCoins', goal: 100 },
  // 출석
  { id: 'd-first', cat: '출석', name: '첫 발도장', desc: '첫 출석', gems: 1, stat: 'attendTotal', goal: 1 },
  { id: 'd-week', cat: '출석', name: '일주일 개근', desc: '연속 출석 7일', gems: 5, stat: 'attendStreak', goal: 7 },
  { id: 'd-month', cat: '출석', name: '한 달 개근', desc: '연속 출석 30일', gems: 20, title: '개근왕', stat: 'attendStreak', goal: 30 },
  { id: 'd-100', cat: '출석', name: '백일잔치', desc: '누적 출석 100일', gems: 15, stat: 'attendTotal', goal: 100 },
  { id: 'd-clear', cat: '출석', name: '성실한 하루', desc: '일일퀘스트 올클리어', gems: 2, stat: 'allClear', goal: 1 },
  { id: 'd-clear30', cat: '출석', name: '갓생 인증', desc: '일일퀘스트 올클리어 30회', gems: 10, title: '갓생러', stat: 'allClear', goal: 30 },
  // 수집
  { id: 'p-parts50', cat: '수집', name: '옷장이 가득', desc: '파츠 50종 수집', gems: 3, stat: 'partsOwned', goal: 50 },
  { id: 'p-parts150', cat: '수집', name: '수집가의 길', desc: '파츠 150종 수집', gems: 10, stat: 'partsOwned', goal: 150 },
  { id: 'p-parts300', cat: '수집', name: '걸어다니는 옷가게', desc: '파츠 300종 수집', gems: 20, title: '패션왕', stat: 'partsOwned', goal: 300 },
  { id: 'p-races', cat: '수집', name: '만종족 통일', desc: '종족 19종 전부 수집', gems: 15, title: '변신의 귀재', stat: 'racesOwned', goal: 19 },
  { id: 'p-look', cat: '수집', name: '새 단장', desc: '외모 첫 변경', gems: 1, stat: 'looks', goal: 1 },
  // 발굴
  { id: 'x-first', cat: '발굴', name: '첫 삽', desc: '광물 첫 발굴', gems: 2, stat: 'digDex', goal: 1 },
  { id: 'x-dex20', cat: '발굴', name: '자갈밭 졸업', desc: '광물도감 20종', gems: 3, stat: 'digDex', goal: 20 },
  { id: 'x-dex40', cat: '발굴', name: '지질 연구가', desc: '광물도감 40종', gems: 5, stat: 'digDex', goal: 40 },
  { id: 'x-dex74', cat: '발굴', name: '대지의 모든 것', desc: '광물도감 74종 완성', gems: 30, title: '광물학자', stat: 'digDex', goal: 74 },
  { id: 'x-dig100', cat: '발굴', name: '삽질 백 번', desc: '누적 발굴 100회', gems: 3, stat: 'digTotal', goal: 100 },
  { id: 'x-dig1000', cat: '발굴', name: '프로 삽러', desc: '누적 발굴 1,000회', gems: 10, stat: 'digTotal', goal: 1000 },
  { id: 'x-gems', cat: '발굴', name: '반짝임의 끝', desc: '세공 보석 8종 수집', gems: 15, title: '보석상', stat: 'gemstoneDex', goal: 8 },
  { id: 'x-relics', cat: '발굴', name: '과거를 캐는 자', desc: '유물 8종 수집', gems: 10, title: '고고학자', stat: 'relicDex', goal: 8 },
  { id: 'x-diamond', cat: '발굴', name: '심봤다!', desc: '다이아몬드 첫 발굴', gems: 10, stat: 'diamondDex', goal: 1 },
  { id: 'x-goldbar', cat: '발굴', name: '노다지', desc: '금괴 첫 발굴', gems: 3, stat: 'goldbar', goal: 1 },
  // 원정
  { id: 'b-first', cat: '원정', name: '첫 원정', desc: '원정 전리품 첫 수령', gems: 2, stat: 'battleClaims', goal: 1 },
  { id: 'b-stage5', cat: '원정', name: '풀숲 너머', desc: '원정 5층 돌파', gems: 2, stat: 'battleMax', goal: 5 },
  { id: 'b-stage10', cat: '원정', name: '슬라임 킹 격파', desc: '원정 10층 돌파', gems: 5, stat: 'battleMax', goal: 10 },
  { id: 'b-stage25', cat: '원정', name: '늪을 건너', desc: '원정 25층 돌파', gems: 5, title: '던전 탐험가', stat: 'battleMax', goal: 25 },
  { id: 'b-stage50', cat: '원정', name: '화룡 사냥꾼', desc: '원정 50층 돌파', gems: 10, title: '용 사냥꾼', stat: 'battleMax', goal: 50 },
  { id: 'b-stage100', cat: '원정', name: '탑의 정상', desc: '원정 100층 돌파 (봇순이 격파)', gems: 30, title: '탑의 지배자', stat: 'battleMax', goal: 100 },
  { id: 'b-kills1000', cat: '원정', name: '천 마리째', desc: '몬스터 누적 처치 1,000', gems: 3, stat: 'battleKills', goal: 1000 },
  { id: 'b-kills10000', cat: '원정', name: '만 마리째', desc: '몬스터 누적 처치 10,000', gems: 10, title: '몬스터 헌터', stat: 'battleKills', goal: 10000 },
  { id: 'b-lv10', cat: '원정', name: '보석 세공 입문', desc: '보석 강화 합계 10레벨', gems: 3, stat: 'battleLv', goal: 10 },
  { id: 'b-lv50', cat: '원정', name: '보석 세공 장인', desc: '보석 강화 합계 50레벨', gems: 10, title: '보석 세공사', stat: 'battleLv', goal: 50 },
  { id: 'b-loot', cat: '원정', name: '전리품 감정', desc: '원정 드랍으로 광물 첫 획득', gems: 2, stat: 'battleMinerals', goal: 1 },
  { id: 'b-lose', cat: '원정', name: '패배의 교훈', desc: '수문장에게 첫 패배', gems: 2, hidden: true },
  { id: 'b-afk', cat: '원정', name: '진정한 방치', desc: '전리품 가방이 가득 찬 채로 수령', gems: 3, hidden: true },
  // 히든
  { id: 'h-owl', cat: '히든', name: '올빼미', desc: '새벽 3~5시에 채팅', gems: 3, hidden: true },
  { id: 'h-broke', cat: '히든', name: '빈털터리', desc: '코인 0으로 슬롯 시도', gems: 3, hidden: true },
  { id: 'h-shoelace', cat: '히든', name: '신발끈부터', desc: '러너 시작 1초 내 탈락', gems: 2, hidden: true },
  { id: 'h-midnight', cat: '히든', name: '자정의 방문자', desc: '자정 직후(00:00~00:15) 접속', gems: 3, hidden: true },
  { id: 'h-monday', cat: '히든', name: '월요병', desc: '월요일 오전 9시에 접속', gems: 3, hidden: true },
  { id: 'h-mole', cat: '히든', name: '두더지의 장난', desc: '땅파기 꽝 누적 10회', gems: 3, hidden: true, stat: 'digMiss', goal: 10 },
];

/** 칭호 → 업적 매핑 (착용 검증용) */
export function achForTitle(title: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.title === title);
}

// ---- 땅파기 (미니게임 — 롤은 클라이언트 overlay.ts에 중복 하드코딩, 정산·도감은 서버) ----
// composer.ts에 UI용 복사본(MINERAL_DEFS) 있음 — 변경 시 동기화 유지 (verify-dig가 검사)

export type MineralCat =
  | 'stone' // 돌멩이 (커먼)
  | 'ore' // 광석
  | 'fossil' // 화석·뼈
  | 'crystal' // 크리스털 조각
  | 'relic' // 유물
  | 'cluster' // 원석 클러스터
  | 'pearl' // 진주
  | 'gemstone' // 세공 보석
  | 'diamond'; // 다이아몬드

export interface MineralDef {
  id: string;
  name: string;
  cat: MineralCat;
}

export const MINERALS: MineralDef[] = [
  // 돌멩이 10종 (균등)
  { id: 'm14', name: '매끈한 돌', cat: 'stone' },
  { id: 'm49', name: '넓적돌', cat: 'stone' },
  { id: 'm60', name: '잿빛 돌', cat: 'stone' },
  { id: 'm61', name: '모난 돌', cat: 'stone' },
  { id: 'm62', name: '부싯돌', cat: 'stone' },
  { id: 'm63', name: '차돌', cat: 'stone' },
  { id: 'm64', name: '은빛 차돌', cat: 'stone' },
  { id: 'm5', name: '조약돌', cat: 'stone' },
  { id: 'm51', name: '자줏빛 바위', cat: 'stone' },
  { id: 'm54', name: '얼룩 바위', cat: 'stone' },
  // 광석 8종 (가중치 — overlay.ts DIG_ORE_POOL)
  { id: 'm24', name: '석탄 덩어리', cat: 'ore' },
  { id: 'm50', name: '철광석', cat: 'ore' },
  { id: 'm55', name: '구리 광석', cat: 'ore' },
  { id: 'm58', name: '빛나는 구리 광석', cat: 'ore' },
  { id: 'm52', name: '사금석', cat: 'ore' },
  { id: 'm65', name: '금광석', cat: 'ore' },
  { id: 'm68', name: '왕금광석', cat: 'ore' },
  { id: 'm48', name: '금괴', cat: 'ore' },
  // 화석·뼈 10종 (균등)
  { id: 'm85', name: '뿔 달린 해골', cat: 'fossil' },
  { id: 'm86', name: '염소 해골', cat: 'fossil' },
  { id: 'm89', name: '들소 해골', cat: 'fossil' },
  { id: 'm92', name: '교차된 뼈', cat: 'fossil' },
  { id: 'm95', name: '넙다리뼈', cat: 'fossil' },
  { id: 'm96', name: '턱뼈 화석', cat: 'fossil' },
  { id: 'm98', name: '어금니 화석', cat: 'fossil' },
  { id: 'm99', name: '굽은 뿔', cat: 'fossil' },
  { id: 'm103', name: '맹수 발톱', cat: 'fossil' },
  { id: 'm114', name: '낡은 깃털', cat: 'fossil' },
  // 크리스털 조각 14종 (균등)
  { id: 'm20', name: '민트 수정 조각', cat: 'crystal' },
  { id: 'm22', name: '서리 수정', cat: 'crystal' },
  { id: 'm23', name: '얼음 수정 기둥', cat: 'crystal' },
  { id: 'm30', name: '호박 수정', cat: 'crystal' },
  { id: 'm31', name: '황금 수정', cat: 'crystal' },
  { id: 'm32', name: '창백한 수정', cat: 'crystal' },
  { id: 'm33', name: '바다 수정', cat: 'crystal' },
  { id: 'm34', name: '핏빛 수정', cat: 'crystal' },
  { id: 'm36', name: '초록 수정', cat: 'crystal' },
  { id: 'm38', name: '보라 수정', cat: 'crystal' },
  { id: 'm41', name: '불꽃 수정', cat: 'crystal' },
  { id: 'm43', name: '은빛 수정', cat: 'crystal' },
  { id: 'm44', name: '흑요 수정', cat: 'crystal' },
  { id: 'm46', name: '눈꽃 수정', cat: 'crystal' },
  // 유물 8종 (가중치)
  { id: 'm9', name: '여명의 룬돌', cat: 'relic' },
  { id: 'm11', name: '바람의 룬돌', cat: 'relic' },
  { id: 'm15', name: '대지의 룬돌', cat: 'relic' },
  { id: 'm13', name: '얼굴 조각석', cat: 'relic' },
  { id: 'm18', name: '고대 점토판', cat: 'relic' },
  { id: 'm19', name: '인장 점토판', cat: 'relic' },
  { id: 'm121', name: '낡은 두루마리', cat: 'relic' },
  { id: 'm127', name: '녹슨 톱니뭉치', cat: 'relic' },
  // 원석 클러스터 7종 (균등)
  { id: 'c104', name: '자수정 원석', cat: 'cluster' },
  { id: 'c12', name: '홍옥 원석', cat: 'cluster' },
  { id: 'c125', name: '장미수정 원석', cat: 'cluster' },
  { id: 'c135', name: '오로라 원석', cat: 'cluster' },
  { id: 'c24', name: '황옥 원석', cat: 'cluster' },
  { id: 'c54', name: '비취 원석', cat: 'cluster' },
  { id: 'c64', name: '청옥 원석', cat: 'cluster' },
  // 진주 4종 (가중치)
  { id: 'm4', name: '진주', cat: 'pearl' },
  { id: 'm1', name: '은빛 진주', cat: 'pearl' },
  { id: 'm2', name: '황금 진주', cat: 'pearl' },
  { id: 'm3', name: '흑진주', cat: 'pearl' },
  // 세공 보석 8종 (균등)
  { id: 'g12', name: '문스톤', cat: 'gemstone' },
  { id: 'g116', name: '오팔', cat: 'gemstone' },
  { id: 'g135', name: '사파이어', cat: 'gemstone' },
  { id: 'g159', name: '아메지스트', cat: 'gemstone' },
  { id: 'g218', name: '토파즈', cat: 'gemstone' },
  { id: 'g58', name: '루비', cat: 'gemstone' },
  { id: 'g80', name: '시트린', cat: 'gemstone' },
  { id: 'g83', name: '에메랄드', cat: 'gemstone' },
  // 다이아몬드 5종 (가중치)
  { id: 'd1', name: '다이아몬드', cat: 'diamond' },
  { id: 'd36', name: '실버 다이아몬드', cat: 'diamond' },
  { id: 'd27', name: '블랙 다이아몬드', cat: 'diamond' },
  { id: 'd196', name: '레드 다이아몬드', cat: 'diamond' },
  { id: 'd193', name: '프리즘 다이아몬드', cat: 'diamond' },
];

/** 발굴 정산 — 카테고리별 첫 발견/중복 코인 */
export const DIG_FIRST_COIN: Record<MineralCat, number> = {
  stone: 2, ore: 3, fossil: 3, crystal: 4, relic: 5, cluster: 6, pearl: 6, gemstone: 8, diamond: 15,
};
export const DIG_REPEAT_COIN: Record<MineralCat, number> = {
  stone: 1, ore: 1, fossil: 1, crystal: 1, relic: 2, cluster: 2, pearl: 2, gemstone: 3, diamond: 5,
};
/** 첫 발견 시 젬 보너스 (세공 보석 +2, 다이아 +5) */
export const DIG_GEM_FIRST: Partial<Record<MineralCat, number>> = { gemstone: 2, diamond: 5 };
/** 금괴 — 도감 등재 + 고정 코인 (첫/중복 무관) */
export const DIG_GOLDBAR_ID = 'm48';
export const DIG_GOLDBAR_COIN = 15;
// 특수 슬롯 보상 (확률은 클라 롤: 꽝5 / 돌38 / 광석23 / 화석14 / 크리스털7 / 코인5 /
// 유물2.5 / 원석2 / 진주1.2 / 상자1.2(나무0.8·붉은0.35·황금0.05) / 보석0.7 / 젬조각0.35 / 다이아0.05 %)
export const DIG_COIN_MIN = 2;
export const DIG_COIN_MAX = 6;
export const DIG_CHEST_WOOD_MIN = 5;
export const DIG_CHEST_WOOD_MAX = 10;
export const DIG_CHEST_RED_MIN = 15;
export const DIG_CHEST_RED_MAX = 30;
export const DIG_CHEST_GOLD_COIN = 50;
export const DIG_CHEST_GOLD_GEM = 1;
export const DIG_GEMSHARD_GEM = 1;
/** 서버측 최소 발굴 간격 (사이클 = 파기 5~9초 + 획득 연출) */
export const DIG_MIN_INTERVAL_MS = 4000;

export const DIG_KINDS = ['miss', 'mineral', 'coin', 'gem', 'chest-wood', 'chest-red', 'chest-gold'] as const;
export type DigKind = (typeof DIG_KINDS)[number];
export const DIG_PHASES = ['digging', 'found', 'stop'] as const;
export type DigPhase = (typeof DIG_PHASES)[number];

/** dig 이벤트 정산 응답 */
export type DigAck = (res: {
  ok: boolean;
  error?: string;
  kind?: DigKind;
  isNew?: boolean;
  /** 코인 증감 */
  delta?: number;
  /** 젬 증감 */
  gemsDelta?: number;
  coins?: number;
  gems?: number;
  /** 붉은 보물상자 상점 아이템 당첨 */
  item?: { id: string; name: string };
  items?: string[];
  minerals?: string[];
}) => void;

// ---- 원정 (방치형 전투 — 서버 권위, 시간 기반 정산) ----
// 캐릭터가 고른 층에서 몬스터를 계속 사냥한다(접속 여부 무관, 가방 상한까지). 전리품은 수령 시 정산.
// 층마다 수문장이 있고, 처치하면 다음 층이 열린다. 💎로 5가지 능력을 강화하고,
// 낚싯대 강화·광물도감·낚시도감·도전과제가 보너스로 연계된다.

export type BattleUpgradeKey = 'atk' | 'hp' | 'crit' | 'luck' | 'time';
export const BATTLE_UPGRADE_KEYS: BattleUpgradeKey[] = ['atk', 'hp', 'crit', 'luck', 'time'];
export const BATTLE_LV_MAX: Record<BattleUpgradeKey, number> = { atk: 100, hp: 100, crit: 30, luck: 30, time: 3 };

export const BATTLE_MAX_STAGE = 100;
export const BATTLE_MIN_KILL_MS = 2000; // 아무리 강해도 1마리당 최소 2초
export const BATTLE_FIGHT_MAX_TICKS = 120; // 수문장전 최대 틱(1틱=1초) — 초과 시 패배

// 내 능력치
export const BATTLE_BASE_ATK = 10;
export const BATTLE_ATK_GROWTH = 1.1; // 공격력 Lv당 ×1.10
export const BATTLE_BASE_HP = 100;
export const BATTLE_HP_GROWTH = 1.08; // 체력 Lv당 ×1.08
export const BATTLE_BASE_CRIT = 5; // %
export const BATTLE_CRIT_PER_LV = 1.5; // %p (Lv30 = 50%)
export const BATTLE_CRIT_MULT = 1.5;
export const BATTLE_LUCK_PER_LV = 5; // 드랍률 +% (Lv30 = +150%)
export const BATTLE_BASE_CAP_HOURS = 4; // 전리품 가방 상한 (원정 시간)
export const BATTLE_CAP_PER_LV_HOURS = 2; // Lv3 = 10시간

// 다른 콘텐츠 연계 보너스
export const BATTLE_ROD_ATK_PCT = 2; // 낚싯대 성당 공격 +2% (30성 = +60%)
export const BATTLE_MINERAL_HP_PCT = 1; // 광물도감 종당 체력 +1% (74종 = +74%)
export const BATTLE_FISH_LUCK_PCT = 0.25; // 낚시도감 종당 행운 +0.25% (161종 = +40%)
export const BATTLE_ACH_PCT = 0.5; // 도전과제당 공격·체력 +0.5%

// 몬스터 / 수문장
export const BATTLE_MONSTER_BASE_HP = 40;
export const BATTLE_MONSTER_HP_GROWTH = 1.12;
export const BATTLE_MONSTER_BASE_ATK = 4;
export const BATTLE_MONSTER_ATK_GROWTH = 1.1;

// 전리품
export const BATTLE_COIN_BASE = 0.1; // 1층 1마리당 기대 코인
export const BATTLE_COIN_GROWTH = 1.05; // 층당 ×1.05
export const BATTLE_GEM_DROP_RATE = 0.0004; // 마리당 💎 조각 (행운 배율 적용)
export const BATTLE_MINERAL_DROP_RATE = 0.01; // 마리당 광물 (행운 배율 적용) — 광물도감 등재
export const BATTLE_MINERAL_WEIGHTS: Record<MineralCat, number> = {
  stone: 45, ore: 25, fossil: 15, crystal: 8, relic: 3, cluster: 2, pearl: 1, gemstone: 0.7, diamond: 0.05,
};
export const BATTLE_CLEAR_COIN_PER_STAGE = 5; // 수문장 첫 처치 코인 = 층 × 5
export const BATTLE_BOSS_GEMS = 3; // 5층 단위 보스 첫 처치 💎
export const BATTLE_BIG_BOSS_GEMS = 6; // 10층 단위 보스 첫 처치 💎
export const BATTLE_BIG_BOSS_ITEM_RATE = 0.3; // 10층 단위 보스: 미보유 상점 아이템 확률
export const BATTLE_CHALLENGE_COOLDOWN_MS = 3000;
export const BATTLE_LOSE_COOLDOWN_MS = 20_000;
export const BATTLE_CLAIM_MIN_KILLS = 1;

/** 강화 비용(💎) — lv = 현재 레벨 (lv → lv+1) */
export function battleUpgradeCost(key: BattleUpgradeKey, lv: number): number {
  if (key === 'atk' || key === 'hp') return 1 + Math.floor(lv / 4);
  if (key === 'crit' || key === 'luck') return 2 + Math.floor(lv / 2);
  return 10 * (lv + 1); // time: 10 / 20 / 30
}

export function battleMonsterHp(stage: number): number {
  return Math.round(BATTLE_MONSTER_BASE_HP * Math.pow(BATTLE_MONSTER_HP_GROWTH, stage - 1));
}
export function battleMonsterAtk(stage: number): number {
  return Math.round(BATTLE_MONSTER_BASE_ATK * Math.pow(BATTLE_MONSTER_ATK_GROWTH, stage - 1) * 10) / 10;
}
/** 수문장 배율 — 10층 단위 대보스 > 5층 단위 보스 > 일반 수문장 */
export function battleGuardianMult(stage: number): { hp: number; atk: number } {
  if (stage % 10 === 0) return { hp: 5, atk: 1.6 };
  if (stage % 5 === 0) return { hp: 4, atk: 1.5 };
  return { hp: 3, atk: 1.3 };
}
export function battleCoinPerKill(stage: number): number {
  return BATTLE_COIN_BASE * Math.pow(BATTLE_COIN_GROWTH, stage - 1);
}

/** [이모지(폴백), 이름, 스프라이트 id(assets/extras/monsters/<id>.png — tools/import-extras.mjs)] */
export type BattleMobDef = [string, string, string];

export interface BattleTierDef {
  /** 시작 층 (10층 단위) */
  from: number;
  name: string;
  /** 일반 몬스터 3종 */
  mobs: BattleMobDef[];
  /** 일반 수문장 */
  guardian: BattleMobDef;
  /** 5층 보스 */
  boss: BattleMobDef;
  /** 10층 대보스 */
  bigBoss: BattleMobDef;
}

export const BATTLE_TIERS: BattleTierDef[] = [
  { from: 1, name: '뒷마당 풀숲', mobs: [['🟢', '슬라임', 'slime-001'], ['🐀', '들쥐', 'rat'], ['🐜', '일개미', 'ant-001']], guardian: ['🐗', '멧돼지 대장', 'pig'], boss: ['🐕', '들개 두목', 'dog'], bigBoss: ['👑', '슬라임 킹', 'slimeking'] },
  { from: 11, name: '버려진 갱도', mobs: [['🦇', '동굴박쥐', 'bat-001'], ['👺', '고블린 광부', 'goblin'], ['🕷️', '갱도거미', 'spider-001']], guardian: ['🪨', '돌 골렘', 'stone-man'], boss: ['⛏️', '고블린 십장', 'goblin-warrior'], bigBoss: ['🧌', '고블린 킹', 'goblinking'] },
  { from: 21, name: '안개 늪지', mobs: [['🦎', '늪 도마뱀', 'lizard'], ['🐍', '물뱀', 'snake'], ['🐛', '늪 지네', 'centipede']], guardian: ['🟢', '오오즈 하운드', 'ooze-dog'], boss: ['🐘', '오오즈 코끼리', 'ooze-elephant'], bigBoss: ['🐉', '늪의 용', 'ooze-dragon'] },
  { from: 31, name: '폐허 도시', mobs: [['👻', '꼬마 유령', 'little-ghost'], ['👻', '유령', 'ghost'], ['🧟', '미라', 'mummy']], guardian: ['🏮', '등불 유령', 'lantern-ghost'], boss: ['👤', '여인 유령', 'female-ghost'], bigBoss: ['💀', '머리 셋 유령', 'three-headed-ghost'] },
  { from: 41, name: '용암 동굴', mobs: [['🦎', '새끼 드레이크', 'drake-001'], ['🔥', '마그마 슬라임', 'slime-003'], ['🦂', '화염 전갈', 'scorpion']], guardian: ['🌋', '용암 드레이크', 'drake-005'], boss: ['👹', '불타는 자', 'burning-man'], bigBoss: ['🐲', '화룡', 'dragon-005'] },
  { from: 51, name: '서리 산맥', mobs: [['🐺', '설원 늑대', 'wolf'], ['🐐', '설산 염소', 'goat'], ['🐇', '눈 토끼', 'rabbit']], guardian: ['🦍', '설산 고릴라', 'gorilla'], boss: ['🐯', '백호', 'tiger'], bigBoss: ['🐉', '빙룡', 'dragon-004'] },
  { from: 61, name: '어둠의 숲', mobs: [['🍄', '독버섯', 'mushroom-man-001'], ['🕷️', '그림자 거미', 'spider-002'], ['🐒', '숲 원숭이', 'monkey']], guardian: ['🌳', '트렌트', 'tree-man'], boss: ['🏹', '켄타우로스', 'centaur'], bigBoss: ['🧙', '숲의 드루이드', 'druid'] },
  { from: 71, name: '하늘 성채', mobs: [['✨', '도깨비불', 'will-o-the-wisp'], ['🦄', '유니콘', 'unicorn'], ['🪽', '페가수스', 'pegasus']], guardian: ['🦁', '성채 사자', 'lion'], boss: ['🗡️', '기사단장', 'warrior'], bigBoss: ['⚡', '천공의 용', 'energy-dragon'] },
  { from: 81, name: '저주받은 신전', mobs: [['👺', '고블린 유령', 'goblin-ghost'], ['🔮', '마법 유령', 'magic-ghost'], ['🕯️', '신전 수녀', 'nun']], guardian: ['🐕', '케르베로스', 'three-headed-dog'], boss: ['🐍', '히드라', 'hydra'], bigBoss: ['💀', '해골룡', 'skeleton-dragon'] },
  { from: 91, name: '봇순이의 탑', mobs: [['🤡', '광대', 'clown'], ['🗡️', '도둑', 'thief'], ['💰', '상인', 'merchant']], guardian: ['🔨', '대장장이', 'blacksmith'], boss: ['🪓', '광전사', 'berserker'], bigBoss: ['👑', '봇순이', 'magician'] },
];

export function battleTierFor(stage: number): BattleTierDef {
  const idx = Math.max(0, Math.min(BATTLE_TIERS.length - 1, Math.floor((stage - 1) / 10)));
  return BATTLE_TIERS[idx];
}
/** 층의 대표 일반 몬스터 (층 번호로 결정) */
export function battleMobFor(stage: number): { emoji: string; name: string; sprite: string } {
  const tier = battleTierFor(stage);
  const [emoji, name, sprite] = tier.mobs[(stage - 1) % tier.mobs.length];
  return { emoji, name, sprite };
}
export function battleGuardianFor(stage: number): { emoji: string; name: string; sprite: string; hp: number; atk: number; kind: 'guardian' | 'boss' | 'big' } {
  const tier = battleTierFor(stage);
  const kind = stage % 10 === 0 ? 'big' : stage % 5 === 0 ? 'boss' : 'guardian';
  const [emoji, name, sprite] = kind === 'big' ? tier.bigBoss : kind === 'boss' ? tier.boss : tier.guardian;
  const mult = battleGuardianMult(stage);
  return {
    emoji,
    name,
    sprite,
    hp: Math.round(battleMonsterHp(stage) * mult.hp),
    atk: Math.round(battleMonsterAtk(stage) * mult.atk * 10) / 10,
    kind,
  };
}
/** 수문장 첫 처치 보상 */
export function battleClearReward(stage: number): { coins: number; gems: number } {
  return {
    coins: stage * BATTLE_CLEAR_COIN_PER_STAGE,
    gems: stage % 10 === 0 ? BATTLE_BIG_BOSS_GEMS : stage % 5 === 0 ? BATTLE_BOSS_GEMS : 0,
  };
}

export interface BattleStatsInput {
  lv: Record<BattleUpgradeKey, number>;
  rodStars: number;
  mineralDex: number;
  fishDex: number;
  achCount: number;
}
export interface BattleStats {
  atk: number;
  hp: number;
  /** 치명타 % */
  crit: number;
  /** 드랍률 보너스 % */
  luck: number;
  /** 기대 DPS (치명타 반영) */
  dps: number;
  /** 가방 상한 (ms) */
  capMs: number;
  bonus: { rodAtkPct: number; mineralHpPct: number; fishLuckPct: number; achPct: number };
  /** 치명타 배율 (기본 BATTLE_CRIT_MULT — 🐾 펫 효과로 상승) */
  critMult?: number;
}
export function battleStats(input: BattleStatsInput): BattleStats {
  const rodAtkPct = input.rodStars * BATTLE_ROD_ATK_PCT;
  const mineralHpPct = input.mineralDex * BATTLE_MINERAL_HP_PCT;
  const fishLuckPct = input.fishDex * BATTLE_FISH_LUCK_PCT;
  const achPct = input.achCount * BATTLE_ACH_PCT;
  const atk = Math.round(
    BATTLE_BASE_ATK * Math.pow(BATTLE_ATK_GROWTH, input.lv.atk) * (1 + rodAtkPct / 100) * (1 + achPct / 100),
  );
  const hp = Math.round(
    BATTLE_BASE_HP * Math.pow(BATTLE_HP_GROWTH, input.lv.hp) * (1 + mineralHpPct / 100) * (1 + achPct / 100),
  );
  const crit = Math.min(75, BATTLE_BASE_CRIT + input.lv.crit * BATTLE_CRIT_PER_LV);
  const luck = Math.round((input.lv.luck * BATTLE_LUCK_PER_LV + fishLuckPct) * 100) / 100;
  const dps = atk * (1 + (crit / 100) * (BATTLE_CRIT_MULT - 1));
  const capMs = (BATTLE_BASE_CAP_HOURS + input.lv.time * BATTLE_CAP_PER_LV_HOURS) * 3600_000;
  return { atk, hp, crit, luck, dps, capMs, bonus: { rodAtkPct, mineralHpPct, fishLuckPct, achPct } };
}

/** 층의 1마리 처치 시간(ms) */
export function battleKillMs(stage: number, dps: number): number {
  return Math.max(BATTLE_MIN_KILL_MS, Math.ceil((battleMonsterHp(stage) / dps) * 1000));
}
/** 그 층에서 버틸 수 있는가 — 1마리 잡는 동안 받는 피해 < 체력 (사냥 사이 완전 회복) */
export function battleCanFarm(stage: number, stats: BattleStats): boolean {
  const killSec = battleKillMs(stage, stats.dps) / 1000;
  return battleMonsterAtk(stage) * killSec < stats.hp;
}

/** 수문장전 시뮬레이션 (1틱=1초, 내가 먼저 공격) — log: [내 HP, 상대 HP, 준 피해, 치명타 1/0] */
export function battleSimulate(
  stats: BattleStats,
  foe: { hp: number; atk: number },
  rand: () => number = Math.random,
  maxTicks = BATTLE_FIGHT_MAX_TICKS,
): { win: boolean; log: [number, number, number, number][] } {
  let me = stats.hp;
  let foeHp = foe.hp;
  const log: [number, number, number, number][] = [];
  const critMult = stats.critMult ?? BATTLE_CRIT_MULT;
  for (let t = 0; t < maxTicks; t++) {
    const crit = rand() * 100 < stats.crit ? 1 : 0;
    const dmg = Math.round(stats.atk * (crit ? critMult : 1));
    foeHp = Math.max(0, foeHp - dmg);
    if (foeHp <= 0) {
      log.push([me, 0, dmg, crit]);
      return { win: true, log };
    }
    me = Math.max(0, Math.round((me - foe.atk) * 10) / 10);
    log.push([me, foeHp, dmg, crit]);
    if (me <= 0) return { win: false, log };
  }
  return { win: false, log };
}

/** 클라이언트에 보내는 원정 상태 */
export interface BattleStatePayload {
  /** 원정 진행 중 (출발~귀환). 꺼져 있으면 가방이 차지 않는다 — 앱을 꺼도 귀환 전까지는 계속 */
  active: boolean;
  /** 선택한 원정 층 */
  stage: number;
  /** 실제 사냥 층 (체력 부족 시 버틸 수 있는 층으로 후퇴) */
  effStage: number;
  /** 최고 돌파 층 (수문장 처치) — 다음 도전 = maxStage + 1 */
  maxStage: number;
  lv: Record<BattleUpgradeKey, number>;
  /** 다음 강화 비용 (MAX면 null) */
  costs: Record<BattleUpgradeKey, number | null>;
  stats: BattleStats;
  tier: string;
  mob: { emoji: string; name: string; sprite: string; hp: number; atk: number };
  guardian: { stage: number; emoji: string; name: string; sprite: string; hp: number; atk: number; kind: 'guardian' | 'boss' | 'big'; reward: { coins: number; gems: number } } | null;
  killMs: number;
  coinPerKill: number;
  since: number;
  now: number;
  /** 지금까지 쌓인 예상 전리품 (드랍 제외) */
  pending: { kills: number; coins: number; elapsedMs: number; capped: boolean };
  /** 누적 처치 */
  kills: number;
  challengeAt: number;
  top: { name: string; maxStage: number }[];
  coins: number;
  gems: number;
}

export interface BattleClaimResult {
  ok: boolean;
  error?: string;
  kills?: number;
  coins?: number;
  gems?: number;
  /** 드랍 광물 (id별 개수, 첫 발견 여부) */
  minerals?: { id: string; name: string; count: number; isNew: boolean }[];
  /** 첫 발견 광물 보너스 (코인/젬은 coins/gems에 포함됨) */
  newMinerals?: number;
  elapsedMs?: number;
  capped?: boolean;
  coinsNow?: number;
  gemsNow?: number;
  mineralsAll?: string[];
  state?: BattleStatePayload;
}

export interface BattleChallengeResult {
  ok: boolean;
  error?: string;
  win?: boolean;
  stage?: number;
  foe?: { emoji: string; name: string; sprite: string; hp: number; atk: number };
  log?: [number, number, number, number][];
  reward?: { coins: number; gems: number; item?: { id: string; name: string } };
  /** 최전선 자동 전진 시 먼저 정산된 전리품 */
  settled?: { kills: number; coins: number; gems: number };
  items?: string[];
  coinsNow?: number;
  gemsNow?: number;
  state?: BattleStatePayload;
}

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
  /** 액션 구매 (💎 전용) */
  'buy-action': (
    actionId: string,
    ack: (res: { ok: boolean; error?: string; gems?: number; actions?: string[] }) => void,
  ) => void;
  /** 💱 환전 — 골드↔젬 (EXCHANGE_* 환율, qty = 💎 수량) */
  exchange: (dir: ExchangeDir, qty: number, ack: (res: ExchangeResult) => void) => void;
  /** 🐾 펫 상태 (포만도 지연 계산 포함) */
  'pet-state': (ack: (res: PetStatePayload | null) => void) => void;
  /** 🐾 펫 뽑기 (1 또는 10회 — 💎 차감·판정·지급 서버) */
  'pet-gacha': (count: number, ack: (res: PetGachaResult) => void) => void;
  /** 🐾 펫 장착 (슬롯 순서대로 id 배열, 빈 배열 = 전부 해제) */
  'pet-equip': (ids: string[], ack: (res: PetActionResult) => void) => void;
  /** 🐾 먹이 주기 (먹이 1개 → 포만도 100) */
  'pet-feed': (petId: string, ack: (res: PetActionResult) => void) => void;
  /** 🐾 경험치카드로 레벨업 (PET_LEVEL_CARDS 장) */
  'pet-level': (petId: string, ack: (res: PetActionResult) => void) => void;
  /** 🐾 자동 먹이 설정 (pct 10~90) */
  'pet-autofeed': (cfg: { on: boolean; pct: number }, ack: (res: PetActionResult) => void) => void;
  /** 🐾 펫 용품 구매 (먹이 🪙 PET_FOOD_PRICE / 경험치카드 💎 PET_CARD_PRICE_GEM) */
  'buy-pet-item': (kind: PetItemKind, qty: number, ack: (res: PetActionResult) => void) => void;
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
  /** 강화도 자랑 (쿨타임 1분) — 전체에게 brag-news 브로드캐스트 */
  brag: (ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 그림 쪽지 보내기 (NOTE_COST 코인, 쿨타임 NOTE_COOLDOWN_MS) */
  'note-send': (
    data: { to: string; image: string },
    ack: (res: { ok: boolean; error?: string; coins?: number }) => void,
  ) => void;
  /** 쪽지 열람 → 서버 보관함에서 삭제 */
  'note-read': (noteId: string) => void;
  /** 주식 매수 (현재가 × 수량, 무수수료) */
  'stock-buy': (
    stockId: string,
    qty: number,
    ack: (res: {
      ok: boolean;
      error?: string;
      coins?: number;
      holding?: { qty: number; avg: number };
    }) => void,
  ) => void;
  /** 주식 매도 (현재가 × 수량, 무수수료) */
  'stock-sell': (
    stockId: string,
    qty: number,
    ack: (res: {
      ok: boolean;
      error?: string;
      coins?: number;
      holding?: { qty: number; avg: number };
    }) => void,
  ) => void;
  /** 전광판 유료 광고 (TICKER_AD_COST 코인, 쿨타임) */
  'ticker-send': (
    text: string,
    ack: (res: { ok: boolean; error?: string; coins?: number }) => void,
  ) => void;
  /** 전광판 기록 조회 (최신순) */
  'ticker-log': (ack: (items: TickerItem[]) => void) => void;
  /** 보유 파츠 목록 동기화 — 클라 목록을 서버 지갑에 합집합 등록, ack로 병합 결과 반환 */
  'parts-sync': (parts: string[], ack: (res: { ok: boolean; parts?: string[] }) => void) => void;
  /** 러너 생존 시간 보고 → 코인 정산 */
  'runner-score': (
    seconds: number,
    ack: (res: { ok: boolean; error?: string; delta?: number; coins?: number }) => void,
  ) => void;
  /** 땅파기 상태 브로드캐스트용 (다른 접속자에게 애니메이션 동기화) */
  'digging-state': (data: { phase: DigPhase; itemId?: string }) => void;
  /** 발굴 정산 (롤은 클라, 보상·도감은 서버) — mineral이면 itemId 필수 */
  dig: (result: { kind: DigKind; itemId?: string }, ack: DigAck) => void;
  /** 도전과제 상태 조회 (달성 목록 + 착용 칭호 + 진행도 metric) */
  'ach-state': (
    ack: (res: { ach: string[]; title: string; metrics: Record<string, number> }) => void,
  ) => void;
  /** 칭호 착용 (빈 문자열 = 해제) — 달성한 업적의 칭호만 허용 */
  'set-title': (title: string, ack: (res: { ok: boolean; error?: string; title?: string }) => void) => void;
  /** 리액션 이모지 전송 */
  reaction: (index: number) => void;
  /** 원정 상태 조회 (첫 조회 시 자동 시작) */
  'battle-state': (ack: (res: BattleStatePayload | null) => void) => void;
  /** 원정 전리품 수령 — 경과 시간 기반 정산 (코인/💎/광물 드랍) */
  'battle-claim': (ack: (res: BattleClaimResult) => void) => void;
  /** 💎 강화 1레벨 (쌓인 전리품은 자동 수령 후 적용) */
  'battle-upgrade': (key: BattleUpgradeKey, ack: (res: BattleClaimResult) => void) => void;
  /** 원정 층 변경 (1 ~ maxStage+1, 쌓인 전리품은 자동 수령) */
  'battle-stage': (stage: number, ack: (res: BattleClaimResult) => void) => void;
  /** 다음 층 수문장 도전 (판정 서버, 승리 시 maxStage+1 · 첫 처치 보상) */
  'battle-challenge': (ack: (res: BattleChallengeResult) => void) => void;
  /** 원정 출발(true)/귀환(false) — 귀환 시 쌓인 전리품 자동 수령. 전체에 player-battle 브로드캐스트 */
  'battle-active': (active: boolean, ack: (res: BattleClaimResult) => void) => void;
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
  /** 내 젬 잔액 (일퀘 보상/액션 구매 시) */
  gems: (gems: number) => void;
  /** 내 지갑 전체 (잔액 + 보유 상점 아이템 + 낚시 도감 + 월척 기록 + 낚싯대 강화 + 주식) */
  wallet: (data: {
    coins: number;
    items: string[];
    fish: string[];
    trophies?: string[];
    rodStars?: number;
    rodFails?: number;
    stocks?: Record<string, { qty: number; avg: number }>;
    /** 💎 잔액 */
    gems?: number;
    /** 구매한 액션 id 목록 */
    actions?: string[];
    /** 광물도감 (발굴한 광물) */
    minerals?: string[];
    /** 착용 중인 칭호 */
    title?: string;
    /** 🐾 장착 펫 효과 중 클라 로컬 롤/표시용 키 (PET_FX client) */
    petFx?: PetFx;
    /** 🐾 장착 펫 id (첫 슬롯) */
    pet?: string | null;
  }) => void;
  /** 강화 대박/하락 전체 알림 (20성 이상) */
  'enhance-news': (data: {
    id: string;
    nickname: string;
    tag: string;
    stars: number;
    result: 'success' | 'drop';
  }) => void;
  /** 강화도 자랑 전체 알림 */
  'brag-news': (data: { id: string; nickname: string; tag: string; stars: number }) => void;
  /** 접속 시 미확인 쪽지 일괄 전달 */
  notes: (notes: NotePayload[]) => void;
  /** 실시간 쪽지 수신 */
  note: (note: NotePayload) => void;
  /** 주식 시세 전체 (접속 시 + 매 틱) — nextTickTs = 다음 변동 시각 */
  stocks: (data: { stocks: StockState[]; nextTickTs: number }) => void;
  /** 전광판 항목 (주가 요약/뉴스/상폐/재상장/광고) */
  ticker: (item: TickerItem) => void;
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
  /** 코인 랭킹 TOP5 + 내 순위 (접속 직후 1회 + 분당 코인 틱마다 개인화 전송) */
  'ranking-update': (data: {
    rows: { name: string; coins: number }[];
    me?: { rank: number; coins: number };
  }) => void;
  /** 일일퀘스트/출석 상태 (접속 직후 + 진행/완료 시 개인 전송) */
  daily: (state: DailyState) => void;
  /** 도전과제 달성 (본인 — 여러 개 한꺼번에 소급 정산될 수 있어 배열) */
  achievement: (list: { id: string; name: string; gems: number; title?: string }[]) => void;
  /** 칭호 업적 달성 전체 알림 */
  'ach-news': (data: { id: string; nickname: string; tag: string; name: string; title: string }) => void;
  /** 다이아몬드 발굴 전체 알림 */
  'dig-news': (data: { id: string; nickname: string; tag: string; name: string }) => void;
  /** 누군가의 땅파기 상태 (애니메이션 동기화) */
  'player-digging': (data: { id: string; phase: DigPhase; itemId?: string }) => void;
  /** 원정 소식 전체 알림 (5층 단위 보스 격파, 원정 다이아 드랍) */
  'battle-news': (data: { id: string; nickname: string; tag: string; text: string }) => void;
  /** 누군가의 원정 출발/귀환 (오버레이 모션·라벨 동기화) */
  'player-battle': (data: { id: string; active: boolean }) => void;
  /** 누군가의 칭호 변경 */
  'player-title': (data: { id: string; title: string }) => void;
  /** 🐾 내 펫 상태 (분당 포만도 틱·자동 먹이 후) */
  pet: (state: PetStatePayload) => void;
  /** 누군가의 장착 펫 변경 (오버레이 동기화, null = 해제) */
  'player-pet': (data: { id: string; pet: string | null }) => void;
  /** 5성 펫 획득 전체 알림 */
  'pet-news': (data: { id: string; nickname: string; tag: string; text: string }) => void;
}

// ---- 그림 쪽지 (64x64 픽셀 그림을 특정 유저에게 전달) ----

export interface NotePayload {
  id: string;
  /** 보낸 사람 (닉네임#태그) */
  from: string;
  ts: number;
  /** 64x64 PNG data URL */
  image: string;
}

export const NOTE_COST = 5;
export const NOTE_COOLDOWN_MS = 3 * 60 * 1000;
export const NOTE_IMAGE_MAX = 20_000; // data URL 최대 길이
export const NOTE_PENDING_MAX = 10; // 수신자별 미확인 쪽지 보관 한도
export const NOTE_RETENTION_DAYS = 7;
/** 그림판 논리 해상도 (표시는 4배 = 256px) */
export const NOTE_SIZE = 64;

// ---- 가상 주식 (5분 틱, 서버 권위) ----

export interface StockDef {
  id: string;
  name: string;
  /** 시작가(상장가) — 상폐 기준(5%)과 재상장 가격의 앵커 */
  initial: number;
  /** 변동성 배율 (비쌀수록 안정, 쌀수록 도박) */
  vol: number;
}

export const STOCKS: StockDef[] = [
  { id: 'airpass', name: '(주)에어패스', initial: 1000, vol: 0.6 },
  { id: 'wolchuk', name: '월척수산', initial: 500, vol: 0.6 },
  { id: 'forge', name: '대장간중공업', initial: 350, vol: 1.0 },
  { id: 'spark', name: '골드스파크전자', initial: 200, vol: 1.0 },
  { id: 'chest', name: '보물상자해운', initial: 120, vol: 1.0 },
  { id: 'note', name: '딱지우편', initial: 80, vol: 1.0 },
  { id: 'slot', name: '세븐슬롯게임즈', initial: 50, vol: 1.5 },
  { id: 'runner', name: '러너스포츠', initial: 20, vol: 1.5 },
  { id: 'minnow', name: '피라미식품', initial: 10, vol: 1.6 },
  { id: 'botsoon', name: '봇순이엔터', initial: 5, vol: 2.2 },
];

export const STOCK_TICK_SEC = 300; // 5분 (서버 env DOTCHAT_STOCK_SEC로 단축 가능)
export const STOCK_DELIST_RATIO = 0.03; // 시작가 3% 이하 → 상장폐지 (보유주 즉시 증발, 5%→3% 완화)
export const STOCK_MAX_RATIO = 10; // 시작가 10배부터 평균회귀 압력
/** 시작가 10% 이하로 추락하면 회복 압력(+%p) — 상폐 확률 완화 */
export const STOCK_MIN_RATIO = 0.1;
export const STOCK_REBOUND_PCT = 6;
export const STOCK_QTY_MAX = 9999; // 종목당 보유 한도
export const STOCK_HISTORY_SEND = 48; // 클라 차트 (4시간)

/** 상폐 기준가 — 정수 가격이라 최소 1 (싼 종목도 상폐 가능하게) */
export function stockDelistAt(initial: number): number {
  return Math.max(1, Math.floor(initial * STOCK_DELIST_RATIO));
}

/** 클라이언트에 보내는 종목 상태 */
export interface StockState {
  id: string;
  price: number;
  /** 직전 틱 가격 (등락 표시용) */
  prev: number;
  /** 상폐 중이면 재상장 예정 시각 (ms) */
  delistedUntil?: number;
  /** 최근 가격 히스토리 (오래된 것 → 최신) */
  history: number[];
}

// ---- 전광판 (모니터 상단 흐르는 뉴스바) ----

export type TickerKind = 'stocks' | 'news' | 'delist' | 'relist' | 'ad';

export interface TickerItem {
  id: string;
  ts: number;
  kind: TickerKind;
  text: string;
  /** 광고(ad)의 보낸 사람 닉네임#태그 */
  from?: string;
}

export const TICKER_AD_COST = 50;
export const TICKER_AD_MAX_LEN = 60;
export const TICKER_AD_COOLDOWN_MS = 60_000;
export const TICKER_LOG_MAX = 200;
export const TICKER_RETENTION_DAYS = 3;

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
/** 샤이닝 스타포스 — 금요일(KST) 하락 확률 감소 배율 (주말 → 금요일로 이전) */
export const ENHANCE_FRIDAY_DROP_MULT = 0.7;

/** 하락 시 바닥 (체크포인트 15/20/25성 밑으로는 안 떨어짐) */
export function enhanceFloor(stage: number): number {
  return stage >= 26 ? 25 : stage >= 21 ? 20 : 15;
}

/** 샤이닝 스타포스 요일 (KST 금요일) */
export function isEnhanceFriday(ts = Date.now()): boolean {
  return new Date(ts + 9 * 3600_000).getUTCDay() === 5; // KST
}

// 강화 단계별 낚시 성능 — 10성 = 종전 기본 낚싯대 성능, 그 밑은 페널티 (클라 적용, overlay.ts)
export const ROD_BASELINE_STARS = 10; // 기준점: 입질 10~15초, 월척 0.2%
export const ROD_WAIT_PENALTY = 0.5; // 10성 미만: 입질 대기 +초/부족 성 (0성 = +5초)
export const ROD_WAIT_REDUCE = 0.15; // 10성 초과: 입질 대기 -초/성 (최소 3초)
export const ROD_TROPHY_PER_STAR = 0.02; // 월척 확률 %p/성 (0성 0% → 10성 0.2% → 30성 0.6%)
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

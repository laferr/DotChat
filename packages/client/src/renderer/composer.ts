// PixelHeroes 파츠 합성기 — 유니티 CharacterBuilder.cs / Layer.cs 규칙의 캔버스 포팅
// (전역 스크립트 모드: overlay.ts / 프리뷰 페이지에서 공용)

interface PartChoice {
  name: string;
  /** 색조 -180~180 */
  h?: number;
  /** 채도 -100~100 */
  s?: number;
  /** 명도 -100~100 */
  v?: number;
}

interface Appearance {
  /** 종족 — Body/Head/Arms(+기본 Eyes/Ears) 세트. hsv는 피부톤 */
  race: PartChoice;
  /** 코인 상점 치장 */
  aura?: string;
  bubbleSkin?: string;
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

interface ComposedFrames {
  idle: HTMLCanvasElement[];
  run: HTMLCanvasElement[];
  /** 액션 애니메이션 (slash/jab/shot/block/roll/jump/death/crawl/ready) */
  anims: Record<string, HTMLCanvasElement[]>;
}

// 액션 행 좌표 (캔버스 top 기준: top = 928 - unityY - 64)
const PH_ACTION_ROWS: Record<string, { y: number; count: number }> = {
  ready: { y: 96, count: 2 },
  crawl: { y: 224, count: 4 },
  jump: { y: 352, count: 3 },
  jab: { y: 480, count: 3 },
  slash: { y: 544, count: 4 },
  shot: { y: 608, count: 4 },
  block: { y: 736, count: 2 },
  death: { y: 800, count: 3 },
  roll: { y: 864, count: 9 },
};

const PH_CELL = 64;
// 캔버스 좌상단 기준 프레임 좌표 (유니티 meta의 y를 상하 반전: top = 928 - y - 64)
const PH_FRAMES: { idle: { x: number; y: number }[]; run: { x: number; y: number }[] } = {
  idle: [
    { x: 0, y: 32 },
    { x: 64, y: 32 },
  ],
  run: [
    { x: 0, y: 160 },
    { x: 64, y: 160 },
    { x: 128, y: 160 },
    { x: 192, y: 160 },
  ],
};
// 시트 좌상단 32x32 = 아이콘
const PH_ICON_SIZE = 32;
// 발 위치: 셀 바닥에서 8px 위 (유니티 피벗 32,8)
const PH_FOOT_OFFSET = 8;

type PartImageProvider = (layer: string, name: string) => Promise<HTMLImageElement | null>;

// ---- 코인 상점 치장 정의 (shared/protocol.ts SHOP_ITEMS와 동일하게 유지) ----

interface CosmeticItem {
  id: string;
  kind: 'aura' | 'bubble' | 'namecolor';
  name: string;
  price: number;
  value?: string;
}

const COSMETIC_ITEMS: CosmeticItem[] = [
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

// 미보유 랜덤 파츠 뽑기 — shared/protocol.ts의 RANDOM_SHOP과 동기화 유지 필요
const RANDOM_ITEMS: { id: string; name: string; price: number; emoji: string }[] = [
  { id: 'rand-any', name: '전체 랜덤', price: 200, emoji: '🎲' },
  { id: 'rand-race', name: '종족 랜덤', price: 1000, emoji: '🧬' },
  { id: 'rand-weapon', name: '무기 랜덤', price: 300, emoji: '⚔️' },
  { id: 'rand-hair', name: '머리 랜덤', price: 500, emoji: '💇' },
  { id: 'rand-armor', name: '갑옷 랜덤', price: 500, emoji: '🛡️' },
  { id: 'rand-helmet', name: '헬멧 랜덤', price: 500, emoji: '⛑️' },
  { id: 'rand-shield', name: '방패 랜덤', price: 500, emoji: '🔰' },
  { id: 'rand-mask', name: '마스크 랜덤', price: 500, emoji: '🎭' },
  { id: 'rand-back', name: '등 랜덤', price: 500, emoji: '🎒' },
  { id: 'rand-cape', name: '망토 랜덤', price: 500, emoji: '🧣' },
  { id: 'rand-horns', name: '뿔 랜덤', price: 500, emoji: '🦌' },
];

// 낚싯대 강화 — shared/protocol.ts의 ENHANCE_TABLE과 동기화 유지 필요 (판정은 서버)
const FORGE_TABLE: { succ: number; drop: number; cost: number }[] = [
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
const FORGE_MAX = 30;
const FORGE_PITY = 10;

// 샤이닝 스타포스 — shared isEnhanceFriday와 동일 (KST 금요일 하락 30% 감소)
function forgeFriday(): boolean {
  return new Date(Date.now() + 9 * 3600_000).getUTCDay() === 5; // KST
}

// 강화 단계 → 이펙트 티어 (0=없음, 1=흰반짝 2=파랑 3=보라 4=불꽃 5=금빛 6=무지개)
function rodTier(stars: number): number {
  return stars >= 30 ? 6 : stars >= 25 ? 5 : stars >= 20 ? 4 : stars >= 15 ? 3 : stars >= 10 ? 2 : stars >= 5 ? 1 : 0;
}

// 티어별 [주색, 밝은색] (6=무지개는 시간 기반이라 null)
const ROD_TIER_COLORS: ([string, string] | null)[] = [
  null,
  ['#ffffff', '#fff8d8'],
  ['#6ec3ff', '#d8efff'],
  ['#b48aff', '#e6d8ff'],
  ['#ff7b3f', '#ffd23f'],
  ['#ffd66e', '#fff3c4'],
  null,
];

// 가상 주식 종목 — shared/protocol.ts의 STOCKS와 동기화 유지 필요 (시세·판정은 서버)
const STOCK_DEFS: { id: string; name: string; initial: number }[] = [
  { id: 'airpass', name: '(주)에어패스', initial: 1000 },
  { id: 'wolchuk', name: '월척수산', initial: 500 },
  { id: 'forge', name: '대장간중공업', initial: 350 },
  { id: 'spark', name: '골드스파크전자', initial: 200 },
  { id: 'chest', name: '보물상자해운', initial: 120 },
  { id: 'note', name: '딱지우편', initial: 80 },
  { id: 'slot', name: '세븐슬롯게임즈', initial: 50 },
  { id: 'runner', name: '러너스포츠', initial: 20 },
  { id: 'minnow', name: '피라미식품', initial: 10 },
  { id: 'botsoon', name: '봇순이엔터', initial: 5 },
];

// 광물도감 — shared/protocol.ts의 MINERALS와 동기화 유지 필요 (정산·도감은 서버, 롤은 overlay.ts)
const MINERAL_CATS: { cat: string; label: string; emoji: string }[] = [
  { cat: 'stone', label: '돌멩이', emoji: '🪨' },
  { cat: 'ore', label: '광석', emoji: '⛏️' },
  { cat: 'fossil', label: '화석·뼈', emoji: '🦴' },
  { cat: 'crystal', label: '크리스털', emoji: '🔮' },
  { cat: 'relic', label: '유물', emoji: '🏺' },
  { cat: 'cluster', label: '원석', emoji: '💠' },
  { cat: 'pearl', label: '진주', emoji: '🫧' },
  { cat: 'gemstone', label: '보석', emoji: '💍' },
  { cat: 'diamond', label: '다이아', emoji: '💎' },
];

const MINERAL_DEFS: { id: string; name: string; cat: string }[] = [
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
  { id: 'm24', name: '석탄 덩어리', cat: 'ore' },
  { id: 'm50', name: '철광석', cat: 'ore' },
  { id: 'm55', name: '구리 광석', cat: 'ore' },
  { id: 'm58', name: '빛나는 구리 광석', cat: 'ore' },
  { id: 'm52', name: '사금석', cat: 'ore' },
  { id: 'm65', name: '금광석', cat: 'ore' },
  { id: 'm68', name: '왕금광석', cat: 'ore' },
  { id: 'm48', name: '금괴', cat: 'ore' },
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
  { id: 'm9', name: '여명의 룬돌', cat: 'relic' },
  { id: 'm11', name: '바람의 룬돌', cat: 'relic' },
  { id: 'm15', name: '대지의 룬돌', cat: 'relic' },
  { id: 'm13', name: '얼굴 조각석', cat: 'relic' },
  { id: 'm18', name: '고대 점토판', cat: 'relic' },
  { id: 'm19', name: '인장 점토판', cat: 'relic' },
  { id: 'm121', name: '낡은 두루마리', cat: 'relic' },
  { id: 'm127', name: '녹슨 톱니뭉치', cat: 'relic' },
  { id: 'c104', name: '자수정 원석', cat: 'cluster' },
  { id: 'c12', name: '홍옥 원석', cat: 'cluster' },
  { id: 'c125', name: '장미수정 원석', cat: 'cluster' },
  { id: 'c135', name: '오로라 원석', cat: 'cluster' },
  { id: 'c24', name: '황옥 원석', cat: 'cluster' },
  { id: 'c54', name: '비취 원석', cat: 'cluster' },
  { id: 'c64', name: '청옥 원석', cat: 'cluster' },
  { id: 'm4', name: '진주', cat: 'pearl' },
  { id: 'm1', name: '은빛 진주', cat: 'pearl' },
  { id: 'm2', name: '황금 진주', cat: 'pearl' },
  { id: 'm3', name: '흑진주', cat: 'pearl' },
  { id: 'g12', name: '문스톤', cat: 'gemstone' },
  { id: 'g116', name: '오팔', cat: 'gemstone' },
  { id: 'g135', name: '사파이어', cat: 'gemstone' },
  { id: 'g159', name: '아메지스트', cat: 'gemstone' },
  { id: 'g218', name: '토파즈', cat: 'gemstone' },
  { id: 'g58', name: '루비', cat: 'gemstone' },
  { id: 'g80', name: '시트린', cat: 'gemstone' },
  { id: 'g83', name: '에메랄드', cat: 'gemstone' },
  { id: 'd1', name: '다이아몬드', cat: 'diamond' },
  { id: 'd36', name: '실버 다이아몬드', cat: 'diamond' },
  { id: 'd27', name: '블랙 다이아몬드', cat: 'diamond' },
  { id: 'd196', name: '레드 다이아몬드', cat: 'diamond' },
  { id: 'd193', name: '프리즘 다이아몬드', cat: 'diamond' },
];

// 도전과제 — shared/protocol.ts의 ACHIEVEMENTS와 동기화 유지 필요 (판정·지급은 서버)
const ACH_DEFS: {
  id: string;
  cat: string;
  name: string;
  desc: string;
  gems: number;
  title?: string;
  hidden?: boolean;
  stat?: string;
  goal?: number;
}[] = [
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
  { id: 's-first', cat: '주식', name: '주식 입문', desc: '주식 첫 매수', gems: 2, stat: 'stockBuys', goal: 1 },
  { id: 's-profit', cat: '주식', name: '떡상의 증인', desc: '실현 수익 누적 +100', gems: 10, title: '투자의 귀재', stat: 'stockProfit', goal: 100 },
  { id: 's-loss', cat: '주식', name: '한강은 차갑다', desc: '실현 손실 누적 -100', gems: 5, hidden: true, stat: 'stockLoss', goal: 100 },
  { id: 's-delist', cat: '주식', name: '상폐의 추억', desc: '보유 종목 상장폐지 경험', gems: 3 },
  { id: 's-100shares', cat: '주식', name: '몰빵의 미학', desc: '한 종목 100주 보유', gems: 10, title: '큰손', stat: 'stockQtyMax', goal: 100 },
  { id: 's-all', cat: '주식', name: '분산투자 교과서', desc: '10종목 동시 보유', gems: 5, stat: 'stockKinds', goal: 10 },
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
  { id: 'g-perfect', cat: '미니게임', name: '마라토너', desc: '러너 한 판 만점(20코인)', gems: 5 },
  { id: 'g-run100', cat: '미니게임', name: '달리는 게 좋아', desc: '러너 누적 100코인', gems: 5, stat: 'runnerCoins', goal: 100 },
  { id: 'd-first', cat: '출석', name: '첫 발도장', desc: '첫 출석', gems: 1, stat: 'attendTotal', goal: 1 },
  { id: 'd-week', cat: '출석', name: '일주일 개근', desc: '연속 출석 7일', gems: 5, stat: 'attendStreak', goal: 7 },
  { id: 'd-month', cat: '출석', name: '한 달 개근', desc: '연속 출석 30일', gems: 20, title: '개근왕', stat: 'attendStreak', goal: 30 },
  { id: 'd-100', cat: '출석', name: '백일잔치', desc: '누적 출석 100일', gems: 15, stat: 'attendTotal', goal: 100 },
  { id: 'd-clear', cat: '출석', name: '성실한 하루', desc: '일일퀘스트 올클리어', gems: 2, stat: 'allClear', goal: 1 },
  { id: 'd-clear30', cat: '출석', name: '갓생 인증', desc: '일일퀘스트 올클리어 30회', gems: 10, title: '갓생러', stat: 'allClear', goal: 30 },
  { id: 'p-parts50', cat: '수집', name: '옷장이 가득', desc: '파츠 50종 수집', gems: 3, stat: 'partsOwned', goal: 50 },
  { id: 'p-parts150', cat: '수집', name: '수집가의 길', desc: '파츠 150종 수집', gems: 10, stat: 'partsOwned', goal: 150 },
  { id: 'p-parts300', cat: '수집', name: '걸어다니는 옷가게', desc: '파츠 300종 수집', gems: 20, title: '패션왕', stat: 'partsOwned', goal: 300 },
  { id: 'p-races', cat: '수집', name: '만종족 통일', desc: '종족 19종 전부 수집', gems: 15, title: '변신의 귀재', stat: 'racesOwned', goal: 19 },
  { id: 'p-look', cat: '수집', name: '새 단장', desc: '외모 첫 변경', gems: 1, stat: 'looks', goal: 1 },
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
  { id: 'b-first', cat: '원정', name: '첫 원정', desc: '원정 전리품 첫 수령', gems: 2, stat: 'battleClaims', goal: 1 },
  { id: 'b-stage5', cat: '원정', name: '풀숲 너머', desc: '원정 5층 돌파', gems: 2, stat: 'battleMax', goal: 5 },
  { id: 'b-stage10', cat: '원정', name: '슬라임 킹 격파', desc: '원정 10층 돌파', gems: 5, stat: 'battleMax', goal: 10 },
  { id: 'b-stage25', cat: '원정', name: '호수를 건너', desc: '원정 25층 돌파', gems: 5, title: '던전 탐험가', stat: 'battleMax', goal: 25 },
  { id: 'b-stage50', cat: '원정', name: '화룡 사냥꾼', desc: '원정 50층 돌파', gems: 10, title: '용 사냥꾼', stat: 'battleMax', goal: 50 },
  { id: 'b-stage100', cat: '원정', name: '탑의 정상', desc: '원정 100층 돌파 (봇순이 격파)', gems: 30, title: '탑의 지배자', stat: 'battleMax', goal: 100 },
  { id: 'b-kills1000', cat: '원정', name: '천 마리째', desc: '몬스터 누적 처치 1,000', gems: 3, stat: 'battleKills', goal: 1000 },
  { id: 'b-kills10000', cat: '원정', name: '만 마리째', desc: '몬스터 누적 처치 10,000', gems: 10, title: '몬스터 헌터', stat: 'battleKills', goal: 10000 },
  { id: 'b-lv10', cat: '원정', name: '보석 세공 입문', desc: '보석 강화 합계 10레벨', gems: 3, stat: 'battleLv', goal: 10 },
  { id: 'b-lv50', cat: '원정', name: '보석 세공 장인', desc: '보석 강화 합계 50레벨', gems: 10, title: '보석 세공사', stat: 'battleLv', goal: 50 },
  { id: 'b-loot', cat: '원정', name: '전리품 감정', desc: '원정 드랍으로 광물 첫 획득', gems: 2, stat: 'battleMinerals', goal: 1 },
  { id: 'b-lose', cat: '원정', name: '패배의 교훈', desc: '수문장에게 첫 패배', gems: 2, hidden: true },
  { id: 'b-afk', cat: '원정', name: '진정한 방치', desc: '전리품 가방이 가득 찬 채로 수령', gems: 3, hidden: true },
  { id: 'h-owl', cat: '히든', name: '올빼미', desc: '새벽 3~5시에 채팅', gems: 3, hidden: true },
  { id: 'h-broke', cat: '히든', name: '빈털터리', desc: '코인 0으로 슬롯 시도', gems: 3, hidden: true },
  { id: 'h-shoelace', cat: '히든', name: '신발끈부터', desc: '러너 시작 1초 내 탈락', gems: 2, hidden: true },
  { id: 'h-midnight', cat: '히든', name: '자정의 방문자', desc: '자정 직후(00:00~00:15) 접속', gems: 3, hidden: true },
  { id: 'h-monday', cat: '히든', name: '월요병', desc: '월요일 오전 9시에 접속', gems: 3, hidden: true },
  { id: 'h-mole', cat: '히든', name: '두더지의 장난', desc: '땅파기 꽝 누적 10회', gems: 3, hidden: true, stat: 'digMiss', goal: 10 },
];

// 전광판 시세 텍스트 색입히기 — 업체명 노랑(기본색), 주가 흰색, ▲빨강 ▼파랑 —흰색, 구분선 흰색
function formatStocksTickerHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/▲[\d.,]+%/g, (m) => `<span style="color:#ff5a5a">${m}</span>`)
    .replace(/▼[\d.,]+%/g, (m) => `<span style="color:#5aa0ff">${m}</span>`)
    .replace(/💀상폐중/g, '<span style="color:#ff5a5a">💀상폐중</span>')
    .replace(/(?<=\s)[\d,]+(?=\s|$)/g, (m) => `<span style="color:#f5f5f5">${m}</span>`)
    .replace(/(?<=\s)—(?=\s|$)/g, '<span style="color:#f5f5f5">—</span>')
    .replace(/\|/g, '<span style="color:#f5f5f5">|</span>');
}

const BUBBLE_STYLES: Record<string, { fill: string; stroke: string; text: string }> = {
  default: { fill: '#fffdf7', stroke: '#4a2837', text: '#3a2430' },
  'bubble-dark': { fill: '#2b2230', stroke: '#8d7d88', text: '#f0e8ec' },
  'bubble-mint': { fill: '#e2f7ef', stroke: '#3fa66a', text: '#1d4a33' },
  'bubble-pink': { fill: '#ffe7f1', stroke: '#e06fa8', text: '#7a2c52' },
  'bubble-gold': { fill: '#fff8e1', stroke: '#d9a63e', text: '#6b4a00' },
  'bubble-royal': { fill: '#efe4ff', stroke: '#8a5fd9', text: '#3d2373' },
};

// null = 무지개(시간 기반 색상 순환)
const AURA_COLORS: Record<string, [string, string] | null> = {
  'aura-spark': ['#ffd66e', '#fff3c4'],
  'aura-ember': ['#ff7b3f', '#ffd23f'],
  'aura-frost': ['#9fdcff', '#e8f7ff'],
  'aura-shadow': ['#8a5fd9', '#c9aef5'],
  'aura-rainbow': null,
};

// 유니티 TextureHelper.AdjustColor 포팅 (검정/투명 픽셀 보존)
function phAdjustPixels(data: Uint8ClampedArray, hue: number, sat: number, val: number): void {
  const hueShift = hue / 360;
  const satF = sat / 100 + 1;
  const valF = val / 100;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    if (r === 0 && g === 0 && b === 0) continue; // 아웃라인 보존

    // RGB -> HSV
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;

    // 색조 회전
    h += hueShift;
    if (h > 1) h -= 1;
    else if (h < 0) h += 1;

    // HSV -> RGB
    const c = v * s;
    const hp = h * 6;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hp < 1) [r1, g1, b1] = [c, x, 0];
    else if (hp < 2) [r1, g1, b1] = [x, c, 0];
    else if (hp < 3) [r1, g1, b1] = [0, c, x];
    else if (hp < 4) [r1, g1, b1] = [0, x, c];
    else if (hp < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const m = v - c;
    r = r1 + m;
    g = g1 + m;
    b = b1 + m;

    // 채도(회색 기준 보간) + 명도 스케일
    const grey = 0.3 * r + 0.59 * g + 0.11 * b;
    r = Math.max(0, grey + (r - grey) * satF);
    g = Math.max(0, grey + (g - grey) * satF);
    b = Math.max(0, grey + (b - grey) * satF);
    r += valF * r;
    g += valF * g;
    b += valF * b;

    data[i] = Math.min(255, Math.round(r * 255));
    data[i + 1] = Math.min(255, Math.round(g * 255));
    data[i + 2] = Math.min(255, Math.round(b * 255));
  }
}

// 프레임에서 캐릭터가 실제로 시작되는 최상단을 찾아 얼굴 32x32 크롭 (아바타/트레이 공용)
function phMakeFace(frame: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = frame.getContext('2d')!;
  const data = ctx.getImageData(0, 0, frame.width, frame.height).data;
  let top = 0;
  outer: for (let y = 0; y < frame.height; y++) {
    for (let x = 8; x < frame.width - 8; x++) {
      if (data[(y * frame.width + x) * 4 + 3] > 0) {
        top = y;
        break outer;
      }
    }
  }
  const cropY = Math.min(Math.max(0, top - 1), frame.height - 32);
  const face = document.createElement('canvas');
  face.width = 32;
  face.height = 32;
  const fctx = face.getContext('2d')!;
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(frame, 16, cropY, 32, 32, 0, 0, 32, 32);
  return face;
}

class PartComposer {
  private tintCache = new Map<string, Promise<HTMLCanvasElement | null>>();
  private frameCache = new Map<string, Promise<ComposedFrames | null>>();

  constructor(private provider: PartImageProvider) {}

  /** 파츠 시트에 HSV를 적용한 전체 시트 캔버스 (캐시) */
  private tintedSheet(layer: string, choice: PartChoice): Promise<HTMLCanvasElement | null> {
    const h = choice.h ?? 0;
    const s = choice.s ?? 0;
    const v = choice.v ?? 0;
    const key = `${layer}/${choice.name}/${h}/${s}/${v}`;
    let cached = this.tintCache.get(key);
    if (!cached) {
      cached = this.provider(layer, choice.name).then((img) => {
        if (!img) return null;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        if (h !== 0 || s !== 0 || v !== 0) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          phAdjustPixels(imageData.data, h, s, v);
          ctx.putImageData(imageData, 0, 0);
        }
        return canvas;
      });
      this.tintCache.set(key, cached);
    }
    return cached;
  }

  /** 외형 → Idle 2 + Run 4 프레임 합성 (캐시) */
  compose(appearance: Appearance): Promise<ComposedFrames | null> {
    const key = JSON.stringify(appearance);
    let cached = this.frameCache.get(key);
    if (!cached) {
      cached = this.composeUncached(appearance);
      this.frameCache.set(key, cached);
    }
    return cached;
  }

  private async composeUncached(appearance: Appearance): Promise<ComposedFrames | null> {
    const race = appearance.race;
    if (!race?.name) return null;
    const helmetName = appearance.helmet?.name ?? '';
    // 유니티: Head.Contains("Lizard") → 머리카락/헬멧/마스크 불가
    const isLizard = race.name.includes('Lizard');
    const showEars = helmetName === '' || helmetName.includes('[ShowEars]');

    // [레이어, 선택, 머리클리핑 여부] — SpriteCollection 순서
    const plan: [string, PartChoice | null | undefined, boolean?][] = [
      ['Cape', appearance.cape],
      ['Back', appearance.back],
      ['Shield', appearance.shield],
      ['Body', { ...race }],
      ['Armor', appearance.armor],
      ['Head', { ...race }],
      ['Horns', helmetName === '' ? appearance.horns : null],
      ['Eyes', appearance.eyes ?? { name: race.name }],
      ['Mask', isLizard ? null : appearance.mask],
      ['Hair', isLizard ? null : appearance.hair, helmetName !== ''],
      ['Ears', showEars ? appearance.ears : null],
      ['Helmet', isLizard ? null : appearance.helmet],
      ['Arms', { ...race }],
      ['Bracers', appearance.armor ? { ...appearance.armor } : null],
      ['Weapon', appearance.weapon],
    ];

    const headSheet = await this.tintedSheet('Head', { ...race });
    const sheets: HTMLCanvasElement[] = [];
    for (const [layer, choice, clipToHead] of plan) {
      if (!choice?.name) continue;
      let sheet = await this.tintedSheet(layer, choice);
      if (!sheet) continue; // Bracers/Ears 등 파일 없는 조합은 생략
      if (clipToHead && headSheet) {
        // 헬멧 착용 시 머리카락을 머리 영역으로 클리핑 (삐져나옴 방지)
        const clipped = document.createElement('canvas');
        clipped.width = sheet.width;
        clipped.height = sheet.height;
        const cctx = clipped.getContext('2d')!;
        cctx.drawImage(sheet, 0, 0);
        cctx.globalCompositeOperation = 'destination-in';
        cctx.drawImage(headSheet, 0, 0);
        sheet = clipped;
      }
      sheets.push(sheet);
    }
    if (sheets.length === 0) return null;

    const buildFrame = (fx: number, fy: number): HTMLCanvasElement => {
      const frame = document.createElement('canvas');
      frame.width = PH_CELL;
      frame.height = PH_CELL;
      const fctx = frame.getContext('2d')!;
      for (const sheet of sheets) {
        fctx.drawImage(sheet, fx, fy, PH_CELL, PH_CELL, 0, 0, PH_CELL, PH_CELL);
      }
      return frame;
    };

    const anims: Record<string, HTMLCanvasElement[]> = {};
    for (const [id, row] of Object.entries(PH_ACTION_ROWS)) {
      anims[id] = Array.from({ length: row.count }, (_v, i) => buildFrame(i * PH_CELL, row.y));
    }

    return {
      idle: PH_FRAMES.idle.map((f) => buildFrame(f.x, f.y)),
      run: PH_FRAMES.run.map((f) => buildFrame(f.x, f.y)),
      anims,
    };
  }
}

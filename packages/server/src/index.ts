import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Server } from 'socket.io';
import {
  ACTION_IDS,
  APP_VERSION,
  Appearance,
  CHAT_HISTORY_MAX,
  CHAT_RETENTION_DAYS,
  ChatMessage,
  COIN_PER_MINUTE,
  COIN_STARTER,
  ENHANCE_MAX,
  ENHANCE_PITY,
  ENHANCE_TABLE,
  ENHANCE_FRIDAY_DROP_MULT,
  enhanceFloor,
  isEnhanceFriday,
  isKstWeekend,
  attendStreakKeeps,
  FISH_BOX_COIN_MAX,
  FISH_BOX_COIN_MIN,
  FISH_BOX_ID,
  FISH_CHEST_COIN_MAX,
  FISH_CHEST_COIN_MIN,
  FISH_CHEST_ID,
  FISH_FIRST_COIN,
  FISH_IDS,
  FISH_IDS_EXTRA,
  FISH_MIN_INTERVAL_MS,
  FISH_REPEAT_COIN,
  FISH_TROPHY_COIN,
  FISHING_PHASES,
  PART_ID_RE,
  PARTS_SYNC_MAX,
  REACTION_COLS,
  REACTION_ROWS,
  RUNNER_COIN_MAX,
  RUNNER_COIN_PER_SEC,
  RUNNER_COOLDOWN_SEC,
  RANDOM_SHOP,
  ROD_DOUBLE_RATE,
  ROD_DOUBLE_STARS,
  ROD_REPEAT_BONUS_STARS,
  SHOP_ITEMS,
  STOCK_HISTORY_SEND,
  STOCK_MAX_RATIO,
  STOCK_MIN_RATIO,
  STOCK_REBOUND_PCT,
  STOCK_QTY_MAX,
  STOCK_TICK_SEC,
  STOCKS,
  StockState,
  stockDelistAt,
  TICKER_AD_COOLDOWN_MS,
  TICKER_AD_COST,
  TICKER_AD_MAX_LEN,
  TICKER_LOG_MAX,
  TICKER_RETENTION_DAYS,
  TickerItem,
  TickerKind,
  SLOT_COST,
  SlotKind,
  ClientToServerEvents,
  DEFAULT_PORT,
  IMAGE_MAX_BYTES,
  IMAGE_PER_MINUTE,
  IMAGE_RETENTION_DAYS,
  MAX_CHAT_LEN,
  MAX_NICKNAME_LEN,
  NOTE_COOLDOWN_MS,
  NOTE_COST,
  NOTE_IMAGE_MAX,
  NOTE_PENDING_MAX,
  NOTE_RETENTION_DAYS,
  NotePayload,
  PlayerState,
  sanitizeAppearance,
  sanitizePinned,
  ServerToClientEvents,
  DAILY_QUESTS,
  DAILY_ALL_BONUS,
  ATTEND_BASE_COIN,
  ATTEND_MAX_COIN,
  ATTEND_WEEKLY_BONUS,
  dailyDateKey,
  dailyQuestIdsFor,
  DailyState,
  ACTION_SHOP,
  ACHIEVEMENTS,
  AchievementDef,
  achForTitle,
  MINERALS,
  MineralDef,
  DIG_FIRST_COIN,
  DIG_REPEAT_COIN,
  DIG_GEM_FIRST,
  DIG_GOLDBAR_ID,
  DIG_GOLDBAR_COIN,
  DIG_COIN_MIN,
  DIG_COIN_MAX,
  DIG_CHEST_WOOD_MIN,
  DIG_CHEST_WOOD_MAX,
  DIG_CHEST_RED_MIN,
  DIG_CHEST_RED_MAX,
  DIG_CHEST_GOLD_COIN,
  DIG_CHEST_GOLD_GEM,
  DIG_GEMSHARD_GEM,
  DIG_MIN_INTERVAL_MS,
  DIG_KINDS,
  DigKind,
  DIG_PHASES,
  DigPhase,
  MineralCat,
  BATTLE_MAX_STAGE,
  BATTLE_UPGRADE_KEYS,
  BATTLE_LV_MAX,
  BATTLE_MINERAL_WEIGHTS,
  BATTLE_GEM_DROP_RATE,
  BATTLE_MINERAL_DROP_RATE,
  BATTLE_BIG_BOSS_ITEM_RATE,
  BATTLE_CHALLENGE_COOLDOWN_MS,
  BATTLE_LOSE_COOLDOWN_MS,
  BATTLE_CLAIM_MIN_KILLS,
  BattleUpgradeKey,
  BattleStats,
  BattleStatePayload,
  BattleClaimResult,
  battleUpgradeCost,
  battleStats,
  battleKillMs,
  battleCanFarm,
  battleCoinPerKill,
  battleMonsterHp,
  battleMonsterAtk,
  battleTierFor,
  battleMobFor,
  battleGuardianFor,
  battleClearReward,
  battleSimulate,
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

interface Wallet {
  coins: number;
  items: string[];
  /** 낚시 도감 (잡아본 물고기) */
  fish: string[];
  /** 보유 외형 파츠 — 클라이언트가 parts-sync로 등록 (합집합, 클라 기준) */
  parts: string[];
  /** 월척으로 잡아본 물고기 (도감 별표) */
  trophies: string[];
  /** 낚싯대 강화 단계 (0~30성) */
  rodStars?: number;
  /** 현재 성에서의 연속 실패 (천장 카운터) */
  rodFails?: number;
  /** 주식 보유 { 종목id: { 수량, 평단가 } } */
  stocks?: Record<string, { qty: number; avg: number }>;
  /** 일일퀘스트/출석 상태 */
  daily?: { date: string; streak: number; counts: Record<string, number>; claimed: string[]; allBonus: boolean };
  /** 💎 잔액 (일퀘 보상/출석 7일 보너스로 획득) */
  gems?: number;
  /** 구매한 액션 id 목록 */
  actions?: string[];
  /** 광물도감 (발굴한 광물 id) */
  minerals?: string[];
  /** 달성한 도전과제 id */
  ach?: string[];
  /** 도전과제 누적 카운터 (chats/fishTotal/slotSpins 등) */
  stats?: Record<string, number>;
  /** 착용 중인 칭호 (달성 업적의 title만 허용) */
  title?: string;
  /** 원정 (방치형 전투) — 층/최고층/💎 강화/정산 기준 시각/도전 쿨타임 */
  battle?: {
    /** 출발~귀환 사이 true — 이때만 가방이 찬다 */
    active: boolean;
    stage: number;
    maxStage: number;
    lv: Record<BattleUpgradeKey, number>;
    since: number;
    challengeAt: number;
  };
}

let wallets: Record<string, Wallet> = {};

function loadWallets(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(COINS_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          wallets[k] = { coins: Math.max(0, Math.floor(v)), items: [], fish: [], parts: [], trophies: [] }; // 구버전 마이그레이션
        } else if (v && typeof v === 'object') {
          const w = v as { coins?: unknown; items?: unknown; fish?: unknown; parts?: unknown; trophies?: unknown };
          wallets[k] = {
            coins: Math.max(0, Math.floor(Number(w.coins) || 0)),
            items: Array.isArray(w.items) ? w.items.filter((i) => typeof i === 'string') : [],
            fish: Array.isArray(w.fish) ? w.fish.filter((i) => typeof i === 'string') : [],
            parts: Array.isArray(w.parts) ? w.parts.filter((i) => typeof i === 'string') : [],
            trophies: Array.isArray(w.trophies) ? w.trophies.filter((i) => typeof i === 'string') : [],
            rodStars: Math.max(0, Math.min(ENHANCE_MAX, Math.floor(Number((w as any).rodStars) || 0))),
            rodFails: Math.max(0, Math.floor(Number((w as any).rodFails) || 0)),
            stocks:
              (w as any).stocks && typeof (w as any).stocks === 'object' ? (w as any).stocks : undefined,
            daily:
              (w as any).daily && typeof (w as any).daily === 'object' ? (w as any).daily : undefined,
            gems: Math.max(0, Math.floor(Number((w as any).gems) || 0)),
            actions: Array.isArray((w as any).actions)
              ? ((w as any).actions as unknown[]).filter((i): i is string => typeof i === 'string')
              : [],
            minerals: Array.isArray((w as any).minerals)
              ? ((w as any).minerals as unknown[]).filter((i): i is string => typeof i === 'string')
              : [],
            ach: Array.isArray((w as any).ach)
              ? ((w as any).ach as unknown[]).filter((i): i is string => typeof i === 'string')
              : [],
            stats:
              (w as any).stats && typeof (w as any).stats === 'object'
                ? Object.fromEntries(
                    Object.entries((w as any).stats as Record<string, unknown>)
                      .map(([sk, sv]) => [sk, Math.max(0, Math.floor(Number(sv) || 0))])
                      .filter(([, sv]) => Number(sv) > 0),
                  )
                : undefined,
            title: typeof (w as any).title === 'string' && (w as any).title ? (w as any).title : undefined,
            battle: (() => {
              const b = (w as any).battle;
              if (!b || typeof b !== 'object') return undefined;
              const lv = {} as Record<BattleUpgradeKey, number>;
              for (const lk of BATTLE_UPGRADE_KEYS) {
                lv[lk] = Math.max(0, Math.min(BATTLE_LV_MAX[lk], Math.floor(Number(b.lv?.[lk]) || 0)));
              }
              const maxStage = Math.max(0, Math.min(BATTLE_MAX_STAGE, Math.floor(Number(b.maxStage) || 0)));
              return {
                active: b.active === true,
                stage: Math.max(1, Math.min(maxStage + 1, BATTLE_MAX_STAGE, Math.floor(Number(b.stage) || 1))),
                maxStage,
                lv,
                since: Math.max(0, Math.floor(Number(b.since) || Date.now())),
                challengeAt: Math.max(0, Math.floor(Number(b.challengeAt) || 0)),
              };
            })(),
          };
        }
      }
    }
    console.log(`[coins] ${Object.keys(wallets).length}개 지갑 로드`);
  } catch {
    wallets = {};
  }
}

// ---- 그림 쪽지 보관함 (수신자 지갑 키별, 열람 전까지 보관) ----

const NOTES_PATH = path.join(UPLOAD_DIR, 'notes.json');
let notesStore: Record<string, NotePayload[]> = {};

function loadNotes(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      const cutoff = Date.now() - NOTE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const [k, v] of Object.entries(raw)) {
        if (!Array.isArray(v)) continue;
        const list = v.filter(
          (n) => n && typeof n.id === 'string' && typeof n.image === 'string' && Number(n.ts) >= cutoff,
        );
        if (list.length > 0) notesStore[k] = list;
      }
    }
    const total = Object.values(notesStore).reduce((a, l) => a + l.length, 0);
    if (total > 0) console.log(`[note] 미확인 쪽지 ${total}개 로드`);
  } catch {
    notesStore = {};
  }
}

function saveNotes(): void {
  try {
    fs.writeFileSync(NOTES_PATH, JSON.stringify(notesStore), 'utf8');
  } catch (err) {
    console.log('[note] 저장 실패:', String(err));
  }
}

loadNotes();

// ---- 가상 주식 엔진 (5분 틱, 트렌드 상태 머신 + 뉴스 이벤트) ----

const STOCK_TICK_MS = Math.max(2, Number(process.env.DOTCHAT_STOCK_SEC ?? STOCK_TICK_SEC)) * 1000;
const STOCKS_PATH = path.join(UPLOAD_DIR, 'stocks.json');
const TICKER_PATH = path.join(UPLOAD_DIR, 'ticker.json');

type StockTrend = 'surge' | 'up' | 'flat' | 'down' | 'crash';

interface StockInternal {
  price: number;
  prev: number;
  trend: StockTrend;
  trendLeft: number;
  delistedUntil?: number;
  history: number[];
}

let stocksState: Record<string, StockInternal> = {};
let nextTickTs = Date.now() + STOCK_TICK_MS;
let tickerLog: TickerItem[] = [];

function pickTrend(): StockTrend {
  const r = Math.random() * 100;
  return r < 8 ? 'surge' : r < 34 ? 'up' : r < 66 ? 'flat' : r < 92 ? 'down' : 'crash';
}

function loadStocks(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(STOCKS_PATH, 'utf8'));
    if (raw && typeof raw === 'object') stocksState = raw;
  } catch {
    stocksState = {};
  }
  // 신규 종목 초기화 (기존 상태는 유지)
  for (const def of STOCKS) {
    const s = stocksState[def.id];
    if (!s || !Number.isFinite(Number(s.price))) {
      stocksState[def.id] = {
        price: def.initial,
        prev: def.initial,
        trend: 'flat',
        trendLeft: 3,
        history: [def.initial],
      };
    }
  }
}

function saveStocks(): void {
  try {
    fs.writeFileSync(STOCKS_PATH, JSON.stringify(stocksState), 'utf8');
  } catch (err) {
    console.log('[stock] 저장 실패:', String(err));
  }
}

function loadTicker(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(TICKER_PATH, 'utf8'));
    const cutoff = Date.now() - TICKER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (Array.isArray(raw)) tickerLog = raw.filter((t) => t && typeof t.text === 'string' && t.ts >= cutoff);
  } catch {
    tickerLog = [];
  }
}

function saveTicker(): void {
  try {
    fs.writeFileSync(TICKER_PATH, JSON.stringify(tickerLog.slice(-TICKER_LOG_MAX)), 'utf8');
  } catch (err) {
    console.log('[ticker] 저장 실패:', String(err));
  }
}

// 전광판 항목 발행: 로그 보관 + 전체 브로드캐스트
function publishTicker(kind: TickerKind, text: string, from?: string): void {
  const item: TickerItem = { id: randomBytes(6).toString('hex'), ts: Date.now(), kind, text, ...(from ? { from } : {}) };
  tickerLog.push(item);
  if (tickerLog.length > TICKER_LOG_MAX) tickerLog = tickerLog.slice(-TICKER_LOG_MAX);
  saveTicker();
  io.emit('ticker', item);
}

function stocksSnapshot(): { stocks: StockState[]; nextTickTs: number } {
  return {
    stocks: STOCKS.map((def) => {
      const s = stocksState[def.id];
      return {
        id: def.id,
        price: s.price,
        prev: s.prev,
        ...(s.delistedUntil ? { delistedUntil: s.delistedUntil } : {}),
        history: s.history.slice(-STOCK_HISTORY_SEND),
      };
    }),
    nextTickTs,
  };
}

// 뉴스 템플릿 (호재/악재) — {name} 치환
const STOCK_NEWS_UP = [
  '{name}, 어닝 서프라이즈 발표!',
  '{name}, 대박 신제품 공개!',
  '{name}, 해외 진출 확정!',
  '{name}에 큰손 투자자 매수세 포착!',
];
const STOCK_NEWS_DOWN = [
  '{name}, 실적 부진 쇼크...',
  '{name} 대표, 구설수 논란...',
  '{name} 공장에 문어 출몰, 가동 중단...',
  '{name}, 대규모 리콜 사태...',
];

// 주말(KST 토·일) 휴장 — 테스트용 env DOTCHAT_FAKE_WEEKEND=1
const marketWeekend = (ts = Date.now()) => process.env.DOTCHAT_FAKE_WEEKEND === '1' || isKstWeekend(ts);
let marketClosedNotice = false;

function runStockTick(): void {
  const now = Date.now();
  nextTickTs = now + STOCK_TICK_MS;
  // 주말 휴장: 시세 동결 (뉴스/상폐/재상장 없음) — 휴장/개장 전환 시 전광판 안내 1회
  if (marketWeekend(now)) {
    if (!marketClosedNotice) {
      marketClosedNotice = true;
      publishTicker('news', '💤 주말 휴장 — 주식장은 월요일 아침에 다시 열립니다');
    }
    io.emit('stocks', stocksSnapshot());
    return;
  }
  if (marketClosedNotice) {
    marketClosedNotice = false;
    publishTicker('news', '🔔 휴장 종료 — 주식장이 다시 열렸습니다!');
  }
  const newsItems: string[] = [];

  for (const def of STOCKS) {
    const s = stocksState[def.id];
    // 상폐 중 → 시간이 되면 시작가로 재상장
    if (s.delistedUntil) {
      if (now >= s.delistedUntil) {
        delete s.delistedUntil;
        s.price = def.initial;
        s.prev = def.initial;
        s.trend = 'flat';
        s.trendLeft = 3;
        s.history.push(def.initial);
        publishTicker('relist', `🔔 ${def.name} 재상장! 시작가 ${def.initial}코인`);
      }
      continue;
    }
    // 트렌드 상태 머신
    s.trendLeft--;
    if (s.trendLeft <= 0) {
      s.trend = pickTrend();
      s.trendLeft = 3 + Math.floor(Math.random() * 6);
    }
    const ranges: Record<StockTrend, [number, number]> = {
      surge: [5, 15],
      up: [1, 6],
      flat: [-3, 3],
      down: [-6, -1],
      crash: [-15, -5],
    };
    const [lo, hi] = ranges[s.trend];
    let pct = (lo + Math.random() * (hi - lo)) * def.vol;
    // 뉴스 이벤트 (4%) — 급변 + 전광판
    if (Math.random() < 0.04) {
      const good = Math.random() < 0.5;
      const mag = 10 + Math.random() * 20;
      pct += good ? mag : -mag;
      const pool = good ? STOCK_NEWS_UP : STOCK_NEWS_DOWN;
      newsItems.push(
        `📰 ${pool[Math.floor(Math.random() * pool.length)].replace('{name}', def.name)} (${good ? '+' : '-'}${Math.round(mag)}%)`,
      );
    }
    // 시작가 10배 초과 시 평균회귀 압력
    if (s.price > def.initial * STOCK_MAX_RATIO) pct -= 8;
    // 시작가 10% 이하로 추락하면 회복 압력 (상폐 확률 완화)
    if (s.price <= def.initial * STOCK_MIN_RATIO) pct += STOCK_REBOUND_PCT;
    s.prev = s.price;
    // 확률적 반올림 — 저가주(변동이 ±0.5코인 미만)도 기대값 그대로 움직이게 (정수 고착 방지)
    const raw = s.price * (1 + pct / 100);
    s.price = Math.max(1, Math.floor(raw) + (Math.random() < raw - Math.floor(raw) ? 1 : 0));
    s.history.push(s.price);
    if (s.history.length > 288) s.history = s.history.slice(-288);

    // 상장폐지: 시작가 5% 이하 → 전 주주 보유분 즉시 증발, 다음 틱에 재상장
    if (s.price <= stockDelistAt(def.initial)) {
      s.delistedUntil = now + STOCK_TICK_MS;
      let victims = 0;
      let sharesLost = 0;
      const victimKeys: string[] = [];
      for (const [wk, w] of Object.entries(wallets)) {
        const h = w.stocks?.[def.id];
        if (h && h.qty > 0) {
          victims++;
          sharesLost += h.qty;
          delete w.stocks![def.id];
          victimKeys.push(wk);
        }
      }
      if (victims > 0) saveWallets();
      for (const wk of victimKeys) grantAch(wk, 's-delist');
      publishTicker(
        'delist',
        `💥 ${def.name} 상장폐지!! ${victims > 0 ? `주주 ${victims}명의 ${sharesLost}주가 휴지조각이 되었습니다...` : '가까스로 피해자는 없었습니다.'} (5분 뒤 재상장)`,
      );
      console.log(`[stock] ${def.name} 상폐 (피해 ${victims}명/${sharesLost}주)`);
    }
  }

  // 전광판: 5분 시세 요약 + 뉴스
  const summary = STOCKS.map((def) => {
    const s = stocksState[def.id];
    if (s.delistedUntil) return `${def.name} 💀상폐중`;
    const diff = s.prev > 0 ? ((s.price - s.prev) / s.prev) * 100 : 0;
    const arrow = diff > 0.05 ? `▲${diff.toFixed(1)}%` : diff < -0.05 ? `▼${Math.abs(diff).toFixed(1)}%` : '—';
    return `${def.name} ${s.price.toLocaleString()} ${arrow}`;
  }).join('  |  ');
  publishTicker('stocks', `📈 시세  |  ${summary}`);
  for (const n of newsItems) publishTicker('news', n);

  saveStocks();
  io.emit('stocks', stocksSnapshot());
}

loadStocks();
loadTicker();
setInterval(runStockTick, STOCK_TICK_MS);

// 미구매 상점 치장은 외형에서 제거 (조작 방지)
function stripUnownedCosmetics(appearance: Appearance, key: string): Appearance {
  const items = wallets[key]?.items ?? [];
  if (appearance.aura && !items.includes(appearance.aura)) delete appearance.aura;
  if (appearance.bubbleSkin && !items.includes(appearance.bubbleSkin)) delete appearance.bubbleSkin;
  if (
    appearance.nameColor &&
    !SHOP_ITEMS.some((i) => i.kind === 'namecolor' && i.value === appearance.nameColor && items.includes(i.id))
  ) {
    delete appearance.nameColor;
  }
  return appearance;
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

// ---- 코인 랭킹 TOP5 + 내 순위 — 분당 코인 틱에 얹어 개인화 전송 ----
function rankingSorted(): { name: string; coins: number }[] {
  return Object.entries(wallets)
    .map(([name, w]) => ({ name, coins: w.coins }))
    .sort((a, b) => b.coins - a.coins);
}
function rankingRows(): { name: string; coins: number }[] {
  return rankingSorted().slice(0, 5);
}
function rankingPayloadFor(key: string, sorted = rankingSorted()) {
  const idx = sorted.findIndex((r) => r.name === key);
  return {
    rows: sorted.slice(0, 5),
    me: idx >= 0 ? { rank: idx + 1, coins: sorted[idx].coins } : undefined,
  };
}

// ---- 도전과제 / 칭호 (판정 서버 권위 — metric 파생 + 누적 카운터 + 이벤트성 직접 지급) ----

const MINERAL_BY_ID = new Map<string, MineralDef>(MINERALS.map((m) => [m.id, m]));

/** 지갑 → 업적 metric 값 (누적 카운터 stats와 지갑 파생값 병합) */
function achMetrics(w: Wallet): Record<string, number> {
  const s = w.stats ?? {};
  const stocks = Object.values(w.stocks ?? {});
  const minerals = (w.minerals ?? [])
    .map((id) => MINERAL_BY_ID.get(id))
    .filter((m): m is MineralDef => m !== undefined);
  return {
    ...s,
    fishDex: w.fish.filter((f) => ALL_FISH_IDS.has(f)).length,
    trophyDex: (w.trophies ?? []).length,
    rodStars: w.rodStars ?? 0,
    coinsNow: w.coins,
    cosmetics: w.items.filter((i) => SHOP_ITEMS.some((si) => si.id === i)).length,
    actionsOwned: (w.actions ?? []).length,
    stockQtyMax: stocks.reduce((m, h) => Math.max(m, h.qty), 0),
    stockKinds: stocks.filter((h) => h.qty > 0).length,
    attendStreak: w.daily?.streak ?? 0,
    partsOwned: (w.parts ?? []).length,
    racesOwned: (w.parts ?? []).filter((p) => p.startsWith('race:')).length,
    digDex: minerals.length,
    gemstoneDex: minerals.filter((m) => m.cat === 'gemstone').length,
    relicDex: minerals.filter((m) => m.cat === 'relic').length,
    diamondDex: minerals.filter((m) => m.cat === 'diamond').length,
    goldbar: (w.minerals ?? []).includes(DIG_GOLDBAR_ID) ? 1 : 0,
    battleMax: w.battle?.maxStage ?? 0,
    battleLv: w.battle ? BATTLE_UPGRADE_KEYS.reduce((sum, k) => sum + (w.battle!.lv[k] ?? 0), 0) : 0,
  };
}

function socketIdFor(key: string): string | null {
  for (const [sid, p] of players) if (walletKey(p) === key) return sid;
  return null;
}

/** 지급 마무리 — 저장 + 본인 알림 + (칭호 업적) 전체 알림. quiet = 전체 알림 억제 */
function finishAchGrant(key: string, defs: AchievementDef[], quiet: boolean): void {
  if (defs.length === 0) return;
  saveWallets();
  const sid = socketIdFor(key);
  const sock = sid ? io.sockets.sockets.get(sid) : undefined;
  if (sock) {
    sock.emit('gems', wallets[key]?.gems ?? 0);
    sock.emit(
      'achievement',
      defs.map((d) => ({ id: d.id, name: d.name, gems: d.gems, ...(d.title ? { title: d.title } : {}) })),
    );
  }
  if (!quiet) {
    const p = sid ? players.get(sid) : undefined;
    for (const d of defs) {
      if (!d.title || !p || !sid) continue;
      io.emit('ach-news', { id: sid, nickname: p.nickname, tag: p.tag, name: d.name, title: d.title });
      publishTicker('news', `🏆 ${p.nickname}#${p.tag}님이 도전과제 '${d.name}' 달성! 칭호 「${d.title}」 획득`);
    }
  }
  console.log(
    `[ach] ${key}: ${defs.map((d) => d.id).join(', ')} 달성 (+${defs.reduce((a, d) => a + d.gems, 0)}💎)`,
  );
}

/** 업적 1개 지급 (이미 달성이면 무시). batch를 주면 마무리는 호출부의 finishAchGrant에서 */
function grantAch(key: string, achId: string, batch?: AchievementDef[]): void {
  const wallet = wallets[key];
  const def = ACHIEVEMENTS.find((a) => a.id === achId);
  if (!wallet || !def) return;
  wallet.ach = wallet.ach ?? [];
  if (wallet.ach.includes(def.id)) return;
  wallet.ach.push(def.id);
  wallet.gems = (wallet.gems ?? 0) + def.gems;
  if (batch) batch.push(def);
  else finishAchGrant(key, [def], false);
}

/** metric 기반 업적 일괄 판정 — 접속 시 소급 정산(quiet)은 전체 알림을 억제해 스팸 방지 */
function checkAch(key: string, quiet = false): void {
  const wallet = wallets[key];
  if (!wallet) return;
  const m = achMetrics(wallet);
  wallet.ach = wallet.ach ?? [];
  const batch: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (!def.stat || def.goal == null || wallet.ach.includes(def.id)) continue;
    if ((m[def.stat] ?? 0) >= def.goal) grantAch(key, def.id, batch);
  }
  finishAchGrant(key, batch, quiet || batch.length > 3);
}

function bumpStat(key: string, stat: string, n = 1): void {
  const wallet = wallets[key];
  if (!wallet) return;
  wallet.stats = wallet.stats ?? {};
  wallet.stats[stat] = (wallet.stats[stat] ?? 0) + n;
}

function setStat(key: string, stat: string, n: number): void {
  const wallet = wallets[key];
  if (!wallet) return;
  wallet.stats = wallet.stats ?? {};
  wallet.stats[stat] = n;
}

/** 코인 수입 기록 (누적 획득 업적용) — 잔액 반영은 호출부 몫 */
function earnCoins(key: string, n: number): void {
  if (n > 0) bumpStat(key, 'coinsEarned', n);
}

// ---- 일일퀘스트 / 출석보상 ----

/** 날짜가 바뀌었으면 출석 보상 지급 + 퀘스트 리셋. 지급 시 안내 문구 반환 */
function ensureDaily(key: string): string | null {
  const wallet = wallets[key];
  if (!wallet) return null;
  const today = dailyDateKey();
  if (wallet.daily?.date === today) return null;
  // 주말(토·일)만 건너뛴 결석은 연속 출석 유지 — 금요일 출석 후 월요일 접속도 연속
  const streak = wallet.daily && attendStreakKeeps(wallet.daily.date, today) ? wallet.daily.streak + 1 : 1;
  wallet.daily = { date: today, streak, counts: {}, claimed: [], allBonus: false };
  const coin = Math.min(ATTEND_BASE_COIN + (streak - 1), ATTEND_MAX_COIN);
  let news = `📅 출석 ${streak}일차! +${coin} 🪙`;
  if (streak % 7 === 0) {
    wallet.gems = (wallet.gems ?? 0) + ATTEND_WEEKLY_BONUS;
    news = `📅 출석 ${streak}일차! +${coin} 🪙 · 7일 연속 보너스 +${ATTEND_WEEKLY_BONUS} 💎`;
  }
  wallet.coins += coin;
  bumpStat(key, 'attendTotal');
  earnCoins(key, coin);
  saveWallets();
  console.log(`[daily] ${key} 출석 ${streak}일차 (+${coin})`);
  return news;
}

function dailyStateFor(key: string, news?: string | null): DailyState {
  const d = wallets[key]?.daily;
  const date = d?.date ?? dailyDateKey();
  return {
    date,
    streak: d?.streak ?? 0,
    quests: dailyQuestIdsFor(date).map((id) => {
      const def = DAILY_QUESTS.find((q) => q.id === id)!;
      return {
        ...def,
        count: Math.min(d?.counts[id] ?? 0, def.goal),
        claimed: d?.claimed.includes(id) ?? false,
      };
    }),
    allBonusClaimed: d?.allBonus ?? false,
    news: news ?? undefined,
  };
}

/** 퀘스트 진행 보고 — 목표 달성 시 즉시 보상 지급, 해당 소켓에 daily push */
function questProgress(socketId: string, questId: string, amount = 1, absolute = false): void {
  const player = players.get(socketId);
  if (!player) return;
  const key = walletKey(player);
  const wallet = wallets[key];
  if (!wallet) return;
  const attendNews = ensureDaily(key); // 접속 중 자정을 넘긴 경우 대비
  const d = wallet.daily!;
  const active = dailyQuestIdsFor(d.date);
  const def = DAILY_QUESTS.find((q) => q.id === questId);
  if (!def || !active.includes(questId) || d.claimed.includes(questId)) {
    if (attendNews) io.sockets.sockets.get(socketId)?.emit('daily', dailyStateFor(key, attendNews));
    return;
  }
  const prev = d.counts[questId] ?? 0;
  d.counts[questId] = absolute ? Math.max(prev, amount) : prev + amount;
  let news: string | null = attendNews;
  if (d.counts[questId] >= def.goal) {
    d.claimed.push(questId);
    wallet.gems = (wallet.gems ?? 0) + def.reward;
    news = `📋 일일퀘스트 완료: ${def.name} (+${def.reward} 💎)`;
    if (!d.allBonus && active.every((id) => d.claimed.includes(id))) {
      d.allBonus = true;
      wallet.gems += DAILY_ALL_BONUS;
      bumpStat(key, 'allClear');
      news += ` · 🎉 오늘 퀘스트 전부 완료! (+${DAILY_ALL_BONUS} 💎)`;
    }
    saveWallets();
    io.sockets.sockets.get(socketId)?.emit('gems', wallet.gems ?? 0);
    console.log(`[daily] ${key} 퀘스트 완료: ${questId}`);
  }
  io.sockets.sockets.get(socketId)?.emit('daily', dailyStateFor(key, news));
}

// 접속 1분당 코인 적립 (같은 지갑 다중 접속은 1회만)
setInterval(() => {
  if (players.size === 0) return;
  const credited = new Set<string>();
  for (const [socketId, player] of players) {
    const key = walletKey(player);
    if (!credited.has(key)) {
      credited.add(key);
      wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] };
      wallets[key].coins += COIN_PER_MINUTE;
      earnCoins(key, COIN_PER_MINUTE);
    }
    io.sockets.sockets.get(socketId)?.emit('coins', wallets[key].coins);
  }
  const sorted = rankingSorted();
  for (const [socketId, player] of players) {
    io.sockets.sockets.get(socketId)?.emit('ranking-update', rankingPayloadFor(walletKey(player), sorted));
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

// 유효 어획물 전체 (구 스트립 + 새 단일 이미지)
const ALL_FISH_IDS = new Set<string>([...FISH_IDS, ...FISH_IDS_EXTRA]);

const players = new Map<string, PlayerState>();
const lastChatAt = new Map<string, number>();
const imageTimes = new Map<string, number[]>();
const lastFishAt = new Map<string, number>();
const lastRunnerAt = new Map<string, number>(); // 지갑 키 기준 (러너 쿨타임)
const lastPinnedAt = new Map<string, number>();
const lastRandomBuyAt = new Map<string, number>();
const lastEnhanceAt = new Map<string, number>();
const lastNoteAt = new Map<string, number>(); // 지갑 키 기준
const lastBragAt = new Map<string, number>(); // 지갑 키 기준
const lastTickerAdAt = new Map<string, number>(); // 지갑 키 기준
const lastDigAt = new Map<string, number>();

// ---- 원정 (방치형 전투 — 시간 기반 정산, 서버 권위) ----
// 캐릭터는 고른 층에서 계속 사냥한다(접속 여부 무관). 전리품은 수령 시 경과 시간으로 정산 (가방 상한까지).
// 테스트용 env DOTCHAT_BATTLE_SPEED=N — 경과 시간 N배속 (기본 1)

const BATTLE_SPEED = Math.max(1, Number(process.env.DOTCHAT_BATTLE_SPEED ?? 1) || 1);
const MINERALS_BY_CAT = new Map<MineralCat, MineralDef[]>();
for (const m of MINERALS) MINERALS_BY_CAT.set(m.cat, [...(MINERALS_BY_CAT.get(m.cat) ?? []), m]);

/** 확률적 반올림 — 소수부만큼의 확률로 올림 (기대값 보존) */
function probRound(x: number): number {
  const f = Math.floor(x);
  return f + (Math.random() < x - f ? 1 : 0);
}

type BattleData = NonNullable<Wallet['battle']>;

/** 지갑의 원정 상태 (없으면 1층에서 지금 시작) */
function battleOf(wallet: Wallet, now = Date.now()): BattleData {
  if (!wallet.battle) {
    wallet.battle = {
      active: false,
      stage: 1,
      maxStage: 0,
      lv: { atk: 0, hp: 0, crit: 0, luck: 0, time: 0 },
      since: now,
      challengeAt: 0,
    };
  }
  return wallet.battle;
}

/** 내 능력치 — 💎 강화 + 낚싯대/광물도감/낚시도감/도전과제 연계 보너스 */
function battleStatsOf(wallet: Wallet): BattleStats {
  const b = battleOf(wallet);
  return battleStats({
    lv: b.lv,
    rodStars: wallet.rodStars ?? 0,
    mineralDex: (wallet.minerals ?? []).length,
    fishDex: wallet.fish.filter((f) => ALL_FISH_IDS.has(f)).length,
    achCount: (wallet.ach ?? []).length,
  });
}

/** 선택 층에서 못 버티면 버틸 수 있는 가장 높은 층으로 후퇴 */
function battleEffStage(stage: number, stats: BattleStats): number {
  for (let s = stage; s >= 1; s--) if (battleCanFarm(s, stats)) return s;
  return 1;
}

interface BattlePending {
  stats: BattleStats;
  effStage: number;
  killMs: number;
  elapsedMs: number;
  capped: boolean;
  kills: number;
  /** 다음 마리 진행분 (수령 후 since에 반영) */
  remainderMs: number;
}

function battlePending(wallet: Wallet, now: number): BattlePending {
  const b = battleOf(wallet, now);
  const stats = battleStatsOf(wallet);
  const effStage = battleEffStage(b.stage, stats);
  const killMs = battleKillMs(effStage, stats.dps);
  const rawMs = b.active ? Math.max(0, now - b.since) * BATTLE_SPEED : 0;
  const capped = rawMs >= stats.capMs;
  const elapsedMs = Math.min(rawMs, stats.capMs);
  const kills = Math.floor(elapsedMs / killMs);
  return { stats, effStage, killMs, elapsedMs, capped, kills, remainderMs: capped ? 0 : elapsedMs - kills * killMs };
}

function battleTop(): { name: string; maxStage: number }[] {
  return Object.entries(wallets)
    .filter(([, w]) => (w.battle?.maxStage ?? 0) > 0)
    .map(([name, w]) => ({ name, maxStage: w.battle!.maxStage }))
    .sort((a, b) => b.maxStage - a.maxStage)
    .slice(0, 5);
}

function battleStateFor(key: string, now = Date.now()): BattleStatePayload {
  const wallet = wallets[key];
  const b = battleOf(wallet, now);
  const pend = battlePending(wallet, now);
  const next = b.maxStage + 1;
  const guardian =
    next <= BATTLE_MAX_STAGE ? { stage: next, ...battleGuardianFor(next), reward: battleClearReward(next) } : null;
  const costs = {} as Record<BattleUpgradeKey, number | null>;
  for (const k of BATTLE_UPGRADE_KEYS) costs[k] = b.lv[k] >= BATTLE_LV_MAX[k] ? null : battleUpgradeCost(k, b.lv[k]);
  const cpk = battleCoinPerKill(pend.effStage);
  return {
    active: b.active,
    stage: b.stage,
    effStage: pend.effStage,
    maxStage: b.maxStage,
    lv: { ...b.lv },
    costs,
    stats: pend.stats,
    tier: battleTierFor(pend.effStage).name,
    mob: { ...battleMobFor(pend.effStage), hp: battleMonsterHp(pend.effStage), atk: battleMonsterAtk(pend.effStage) },
    guardian,
    killMs: pend.killMs / BATTLE_SPEED,
    coinPerKill: cpk,
    since: b.since,
    now,
    pending: { kills: pend.kills, coins: Math.floor(pend.kills * cpk), elapsedMs: pend.elapsedMs, capped: pend.capped },
    kills: wallet.stats?.battleKills ?? 0,
    challengeAt: b.challengeAt ?? 0,
    top: battleTop(),
    coins: wallet.coins,
    gems: wallet.gems ?? 0,
  };
}

/** 원정 드랍 광물 — 카테고리 가중치 → 카테고리 내 균등 */
function rollBattleMineral(): MineralDef {
  const cats = Object.entries(BATTLE_MINERAL_WEIGHTS) as [MineralCat, number][];
  const total = cats.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let cat: MineralCat = 'stone';
  for (const [c, w] of cats) {
    r -= w;
    if (r < 0) {
      cat = c;
      break;
    }
  }
  const pool = MINERALS_BY_CAT.get(cat) ?? MINERALS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 전리품 정산 — 쌓인 처치 수만큼 코인/💎/광물 지급, since 갱신.
 * 처치가 없으면 null (강화/층 변경 전 자동 수령에서는 조용히 넘어감)
 */
function battleSettle(socketId: string, key: string, now: number): BattleClaimResult | null {
  const wallet = wallets[key];
  const player = players.get(socketId);
  if (!wallet || !player) return null;
  const b = battleOf(wallet, now);
  const pend = battlePending(wallet, now);
  if (pend.kills < BATTLE_CLAIM_MIN_KILLS) return null;
  const cpk = battleCoinPerKill(pend.effStage);
  let coins = probRound(pend.kills * cpk);
  let gems = 0;
  const luckMult = 1 + pend.stats.luck / 100;
  const gemRate = BATTLE_GEM_DROP_RATE * luckMult;
  const mineralRate = BATTLE_MINERAL_DROP_RATE * luckMult;
  const drops = new Map<string, number>();
  for (let i = 0; i < pend.kills; i++) {
    const r = Math.random();
    if (r < gemRate) gems++;
    else if (r < gemRate + mineralRate) {
      const m = rollBattleMineral();
      drops.set(m.id, (drops.get(m.id) ?? 0) + 1);
    }
  }
  // 광물 → 광물도감 등재 (첫 발견은 땅파기와 같은 보너스 코인/젬)
  wallet.minerals = wallet.minerals ?? [];
  const minerals: { id: string; name: string; count: number; isNew: boolean }[] = [];
  let newMinerals = 0;
  let dropTotal = 0;
  for (const [id, count] of drops) {
    const m = MINERAL_BY_ID.get(id)!;
    const isNew = !wallet.minerals.includes(id);
    dropTotal += count;
    if (isNew) {
      wallet.minerals.push(id);
      newMinerals++;
      coins += DIG_FIRST_COIN[m.cat];
      gems += DIG_GEM_FIRST[m.cat] ?? 0;
      if (m.cat === 'diamond') {
        const text = `💎 ${player.nickname}#${player.tag}님이 원정 전리품에서 ${m.name}을(를) 발견했습니다!`;
        io.emit('battle-news', { id: socketId, nickname: player.nickname, tag: player.tag, text });
        publishTicker('news', text);
      }
    }
    minerals.push({ id, name: m.name, count, isNew });
  }
  minerals.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.count - a.count);
  wallet.coins += coins;
  wallet.gems = (wallet.gems ?? 0) + gems;
  earnCoins(key, coins);
  bumpStat(key, 'battleKills', pend.kills);
  bumpStat(key, 'battleClaims');
  if (dropTotal > 0) bumpStat(key, 'battleMinerals', dropTotal);
  b.since = now - pend.remainderMs / BATTLE_SPEED;
  saveWallets();
  const sock = io.sockets.sockets.get(socketId);
  sock?.emit('coins', wallet.coins);
  if (gems > 0) sock?.emit('gems', wallet.gems);
  questProgress(socketId, 'battle');
  if (pend.capped) grantAch(key, 'b-afk');
  checkAch(key);
  console.log(
    `[battle] ${key}: ${pend.effStage}층 ${pend.kills}마리 (${Math.round(pend.elapsedMs / 60000)}분${pend.capped ? ', 가방 가득' : ''}) → +${coins}🪙${gems ? ` +${gems}💎` : ''}${dropTotal ? ` 광물 ${dropTotal}개(신규 ${newMinerals})` : ''}`,
  );
  return {
    ok: true,
    kills: pend.kills,
    coins,
    gems,
    minerals,
    newMinerals,
    elapsedMs: pend.elapsedMs,
    capped: pend.capped,
    coinsNow: wallet.coins,
    gemsNow: wallet.gems,
    mineralsAll: [...wallet.minerals],
  };
}

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
      pinned: sanitizePinned(data?.pinned),
    };
    // 신규 지갑(기존 유저의 첫 업데이트 접속 포함)에 기본 코인 지급
    const key = walletKey(player);
    if (!(key in wallets)) {
      wallets[key] = { coins: COIN_STARTER, items: [], fish: [], parts: [], trophies: [] };
      saveWallets();
      console.log(`[coins] ${key} 신규 지갑 +${COIN_STARTER}`);
    }
    stripUnownedCosmetics(player.appearance, key);
    if (wallets[key].title) player.title = wallets[key].title;
    if (!wallets[key].battle) {
      battleOf(wallets[key]); // 원정 상태 초기화 (출발은 사용자가 — 출발 뒤엔 앱을 꺼도 귀환 전까지 진행)
      saveWallets();
    }
    if (wallets[key].battle?.active) player.battle = true;
    players.set(socket.id, player);
    socket.emit('welcome', {
      selfId: socket.id,
      players: [...players.values()],
      serverVersion: APP_VERSION,
    });
    // 출석 정산을 먼저 — 지갑 스냅샷이 출석 보상(코인/젬)까지 반영한 값이 되도록
    const attendNews = ensureDaily(key);
    socket.emit('wallet', {
      coins: wallets[key].coins,
      items: [...wallets[key].items],
      fish: [...wallets[key].fish],
      trophies: [...(wallets[key].trophies ?? [])],
      rodStars: wallets[key].rodStars ?? 0,
      rodFails: wallets[key].rodFails ?? 0,
      stocks: { ...(wallets[key].stocks ?? {}) },
      gems: wallets[key].gems ?? 0,
      actions: [...(wallets[key].actions ?? [])],
      minerals: [...(wallets[key].minerals ?? [])],
      title: wallets[key].title ?? '',
    });
    socket.emit('stocks', stocksSnapshot());
    if (attendNews) {
      // 출석 정산 직후 잔액 개별 통지 (지갑 스냅샷과 중복이지만 기존 계약 유지 — verify-daily 등)
      socket.emit('coins', wallets[key].coins);
      socket.emit('gems', wallets[key].gems ?? 0);
    }
    socket.emit('daily', dailyStateFor(key, attendNews));
    // 접속 시각 히든 업적 (KST) + 기존 스탯 소급 정산 (전체 알림은 억제)
    {
      const kst = new Date(Date.now() + 9 * 3600_000);
      const batch: AchievementDef[] = [];
      if (kst.getUTCHours() === 0 && kst.getUTCMinutes() <= 15) grantAch(key, 'h-midnight', batch);
      if (kst.getUTCDay() === 1 && kst.getUTCHours() === 9) grantAch(key, 'h-monday', batch);
      finishAchGrant(key, batch, false);
      checkAch(key, true);
    }
    socket.emit('ranking-update', rankingPayloadFor(key));
    socket.emit('chat-history', chatHistory.slice(-100));
    // 미확인 그림 쪽지 배달
    if (notesStore[key]?.length) socket.emit('notes', [...notesStore[key]]);
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
    // 미구매 액션 차단 (봇순이 tag 9999는 시연용 예외)
    if (player.tag !== '9999' && !wallets[walletKey(player)]?.actions?.includes(action)) return;
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
      ...(player.title ? { senderTitle: player.title } : {}),
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
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.coins < SLOT_COST) {
      if (wallet.coins === 0) grantAch(key, 'h-broke'); // 히든: 빈털터리
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${SLOT_COST})` });
      return;
    }
    lastSlotAt.set(socket.id, now);
    const roll = Math.random() * 100;
    const row = SLOT_TABLE.find((r) => roll < r.upto)!;
    wallet.coins = wallet.coins - SLOT_COST + row.delta;
    bumpStat(key, 'slotSpins');
    if (row.kind === 'miss') bumpStat(key, 'slotMissRun');
    else setStat(key, 'slotMissRun', 0);
    earnCoins(key, row.delta);
    if (row.kind === 'jackpot') grantAch(key, 'c-jackpot');
    if (row.kind === 'mega') grantAch(key, 'c-mega');
    questProgress(socket.id, 'slot');
    checkAch(key);
    saveWallets();
    reply({
      ok: true,
      kind: row.kind,
      delta: row.delta,
      reels: slotReels(row.kind),
      coins: wallet.coins,
    });
    if (row.kind === 'part' || row.kind === 'jackpot' || row.kind === 'mega') {
      io.emit('slot-win', {
        id: socket.id,
        nickname: player.nickname,
        tag: player.tag,
        kind: row.kind,
        delta: row.delta,
      });
      console.log(`[slot] ${key}: ${row.kind} (+${row.delta}) 잔액 ${wallet.coins}`);
    }
  });

  socket.on('buy', (itemId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const item = SHOP_ITEMS.find((i) => i.id === String(itemId));
    if (!item) {
      reply({ ok: false, error: '없는 상품이에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.items.includes(item.id)) {
      reply({ ok: false, error: '이미 보유한 상품이에요.', coins: wallet.coins, items: [...wallet.items] });
      return;
    }
    if (wallet.coins < item.price) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${item.price})`, coins: wallet.coins });
      return;
    }
    wallet.coins -= item.price;
    wallet.items.push(item.id);
    saveWallets();
    checkAch(key);
    reply({ ok: true, coins: wallet.coins, items: [...wallet.items] });
    console.log(`[shop] ${key}: ${item.id} 구매 (-${item.price}) 잔액 ${wallet.coins}`);
  });

  // ---- 낚시 ----

  socket.on('fishing-state', (data) => {
    const player = players.get(socket.id);
    const phase = String(data?.phase ?? '');
    if (!player || !(FISHING_PHASES as readonly string[]).includes(phase)) return;
    const fishId = typeof data?.fishId === 'string' ? data.fishId.slice(0, 32) : undefined;
    // 낚싯대 강화 글로우는 서버 지갑 기준 (클라 신고값 무시 — 과시 연출 조작 방지)
    const rodStars = wallets[walletKey(player)]?.rodStars ?? 0;
    socket.broadcast.emit('player-fishing', {
      id: socket.id,
      phase: phase as (typeof FISHING_PHASES)[number],
      fishId,
      trophy: data?.trophy === true || undefined,
      rod: rodStars > 0 ? rodStars : undefined,
    });
  });

  // (fishId, ack) 구버전과 (fishId, trophy, ack) 신버전 인자를 모두 수용
  socket.on('fish', (fishId, trophyOrAck, maybeAck) => {
    const trophyArg = trophyOrAck === true;
    const ack = typeof trophyOrAck === 'function' ? trophyOrAck : maybeAck;
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const id = String(fishId);
    if (!ALL_FISH_IDS.has(id)) {
      reply({ ok: false, error: '알 수 없는 물고기예요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastFishAt.get(socket.id) ?? 0) < FISH_MIN_INTERVAL_MS) {
      reply({ ok: false, error: '낚시가 너무 빨라요.' });
      return;
    }
    lastFishAt.set(socket.id, now);
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    const isNew = !wallet.fish.includes(id);
    questProgress(socket.id, 'fish');
    bumpStat(key, 'fishTotal');
    if (id === FISH_BOX_ID) bumpStat(key, 'boxes');
    if (id === FISH_CHEST_ID) bumpStat(key, 'chests');
    if (isNew) wallet.fish.push(id);

    // 특수 어획물: 상자(코인), 보물상자(코인 or 미보유 상점 아이템)
    let delta: number;
    let itemGrant: { id: string; name: string } | null = null;
    let doubled = false;
    const isTrophy = trophyArg && id !== FISH_BOX_ID && id !== FISH_CHEST_ID;
    if (id === FISH_BOX_ID) {
      delta = FISH_BOX_COIN_MIN + Math.floor(Math.random() * (FISH_BOX_COIN_MAX - FISH_BOX_COIN_MIN + 1));
    } else if (id === FISH_CHEST_ID) {
      const unowned = SHOP_ITEMS.filter((i) => !wallet.items.includes(i.id));
      if (unowned.length > 0 && Math.random() < 0.5) {
        const won = unowned[Math.floor(Math.random() * unowned.length)];
        wallet.items.push(won.id);
        itemGrant = { id: won.id, name: won.name };
        delta = 0;
      } else {
        delta = FISH_CHEST_COIN_MIN + Math.floor(Math.random() * (FISH_CHEST_COIN_MAX - FISH_CHEST_COIN_MIN + 1));
      }
    } else {
      delta = isNew ? FISH_FIRST_COIN : FISH_REPEAT_COIN;
      // 낚싯대 강화 보너스: 10성+ 반복 어획 +1, 20성+ 더블 캐치(코인 2배)
      const rod = wallet.rodStars ?? 0;
      if (!isNew && rod >= ROD_REPEAT_BONUS_STARS) delta += 1;
      if (isTrophy) delta += FISH_TROPHY_COIN; // 월척 보너스
      if (rod >= ROD_DOUBLE_STARS && Math.random() * 100 < ROD_DOUBLE_RATE) {
        delta *= 2;
        doubled = true;
      }
    }
    wallet.trophies = wallet.trophies ?? [];
    if (isTrophy && !wallet.trophies.includes(id)) wallet.trophies.push(id);
    wallet.coins += delta;
    earnCoins(key, delta);
    checkAch(key);
    saveWallets();
    reply({
      ok: true,
      isNew,
      delta,
      coins: wallet.coins,
      ...(isTrophy ? { trophy: true } : {}),
      ...(doubled ? { doubled: true } : {}),
      ...(itemGrant ? { item: itemGrant, items: [...wallet.items] } : {}),
    });
    if (id === FISH_BOX_ID || id === FISH_CHEST_ID) {
      console.log(`[fish] ${key}: ${id} 개봉 → ${itemGrant ? `아이템 '${itemGrant.name}'` : `+${delta}코인`}`);
    } else if (isTrophy) {
      console.log(`[fish] ${key}: ${id} 🌟월척! (+${delta}) 별 ${wallet.trophies.length}종`);
    } else if (isNew) {
      console.log(`[fish] ${key}: ${id} 최초 획득 (+${delta}) 도감 ${wallet.fish.length}/${ALL_FISH_IDS.size}`);
    }
  });

  // ---- 낚싯대 강화 (스타포스식 — 판정·저장 서버 권위) ----

  socket.on('enhance', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastEnhanceAt.get(socket.id) ?? 0) < 500) {
      reply({ ok: false, error: '너무 빨라요!' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    const stars = wallet.rodStars ?? 0;
    if (stars >= ENHANCE_MAX) {
      reply({ ok: false, error: '이미 최대 강화(30성)예요!' });
      return;
    }
    const stage = ENHANCE_TABLE[stars];
    if (wallet.coins < stage.cost) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${stage.cost})`, coins: wallet.coins });
      return;
    }
    lastEnhanceAt.set(socket.id, now);
    wallet.coins -= stage.cost;

    let result: 'success' | 'keep' | 'drop';
    let guaranteed = false;
    if ((wallet.rodFails ?? 0) >= ENHANCE_PITY) {
      result = 'success'; // 천장: 연속 실패 누적 → 보장 성공
      guaranteed = true;
    } else {
      const dropPct = stage.drop * (isEnhanceFriday(now) ? ENHANCE_FRIDAY_DROP_MULT : 1);
      const roll = Math.random() * 100;
      result = roll < stage.succ ? 'success' : roll < stage.succ + dropPct ? 'drop' : 'keep';
    }
    if (result === 'success') {
      wallet.rodStars = stars + 1;
      wallet.rodFails = 0;
    } else if (result === 'drop') {
      wallet.rodStars = Math.max(enhanceFloor(stars), stars - 1);
      wallet.rodFails = 0; // 성이 바뀌었으니 천장 카운터 리셋
    } else {
      wallet.rodFails = (wallet.rodFails ?? 0) + 1;
    }
    bumpStat(key, 'enhanceTries');
    if (result === 'drop') {
      bumpStat(key, 'enhanceDrops');
      if (stars >= 20) grantAch(key, 'e-bigdrop'); // 히든: 그날의 기억
    }
    if (guaranteed) grantAch(key, 'e-pity');
    checkAch(key);
    saveWallets();
    reply({
      ok: true,
      result,
      stars: wallet.rodStars,
      fails: wallet.rodFails,
      guaranteed,
      coins: wallet.coins,
    });
    // 20성 이상 도달 성공 / 20성 이상에서 하락 → 전체 알림
    if ((result === 'success' && (wallet.rodStars ?? 0) >= 20) || (result === 'drop' && stars >= 20)) {
      io.emit('enhance-news', {
        id: socket.id,
        nickname: player.nickname,
        tag: player.tag,
        stars: wallet.rodStars ?? 0,
        result: result === 'success' ? 'success' : 'drop',
      });
    }
    console.log(
      `[enhance] ${key}: ${stars}성 → ${result}${guaranteed ? '(천장)' : ''} (현재 ${wallet.rodStars}성, -${stage.cost}) 잔액 ${wallet.coins}`,
    );
  });

  // ---- 강화도 자랑 (쿨타임 1분, 전체 브로드캐스트) ----

  socket.on('brag', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const now = Date.now();
    const last = lastBragAt.get(key) ?? 0;
    if (now - last < 60_000) {
      reply({ ok: false, error: `자랑은 ${Math.ceil((60_000 - (now - last)) / 1000)}초 후에 다시 할 수 있어요.` });
      return;
    }
    lastBragAt.set(key, now);
    const stars = wallets[key]?.rodStars ?? 0;
    io.emit('brag-news', { id: socket.id, nickname: player.nickname, tag: player.tag, stars });
    bumpStat(key, 'brags');
    checkAch(key);
    reply({ ok: true });
    console.log(`[brag] ${key}: ${stars}성 자랑`);
  });

  // ---- 그림 쪽지 ----

  socket.on('note-send', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const to = String(data?.to ?? '');
    if (!/^.{1,16}#\d{4}$/.test(to)) {
      reply({ ok: false, error: '받는 사람이 올바르지 않아요.' });
      return;
    }
    if (to === key) {
      reply({ ok: false, error: '자신에게는 보낼 수 없어요.' });
      return;
    }
    const image = String(data?.image ?? '');
    if (!image.startsWith('data:image/png;base64,') || image.length > NOTE_IMAGE_MAX) {
      reply({ ok: false, error: '그림이 올바르지 않아요.' });
      return;
    }
    const now = Date.now();
    const last = lastNoteAt.get(key) ?? 0;
    if (now - last < NOTE_COOLDOWN_MS) {
      reply({ ok: false, error: `쪽지는 ${Math.ceil((NOTE_COOLDOWN_MS - (now - last)) / 1000)}초 후에 보낼 수 있어요.` });
      return;
    }
    const recipientOnline = [...players.values()].some((p) => walletKey(p) === to);
    if (!recipientOnline && !(to in wallets)) {
      reply({ ok: false, error: '그런 사람을 찾을 수 없어요.' });
      return;
    }
    const queue = (notesStore[to] = notesStore[to] ?? []);
    if (queue.length >= NOTE_PENDING_MAX) {
      reply({ ok: false, error: '받는 사람의 쪽지함이 가득 찼어요.' });
      return;
    }
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.coins < NOTE_COST) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${NOTE_COST})`, coins: wallet.coins });
      return;
    }
    wallet.coins -= NOTE_COST;
    bumpStat(key, 'notesSent');
    if (wallets[to]) bumpStat(to, 'notesGot');
    saveWallets();
    lastNoteAt.set(key, now);
    const note: NotePayload = { id: randomBytes(8).toString('hex'), from: key, ts: now, image };
    queue.push(note);
    saveNotes();
    checkAch(key);
    if (wallets[to]) checkAch(to);
    // 접속 중인 수신자에게 즉시 배달
    for (const [sid, p] of players) {
      if (walletKey(p) === to) io.sockets.sockets.get(sid)?.emit('note', note);
    }
    reply({ ok: true, coins: wallet.coins });
    console.log(`[note] ${key} → ${to} (${Math.round(image.length / 1024)}KB, 대기 ${queue.length}개)`);
  });

  socket.on('note-read', (noteId) => {
    const player = players.get(socket.id);
    if (!player) return;
    const key = walletKey(player);
    const queue = notesStore[key];
    if (!queue) return;
    const idx = queue.findIndex((n) => n.id === String(noteId));
    if (idx < 0) return;
    queue.splice(idx, 1);
    if (queue.length === 0) delete notesStore[key];
    saveNotes();
  });

  // ---- 가상 주식 매매 (현재가 기준, 무수수료) ----

  function tradeGuard(
    stockId: unknown,
    qty: unknown,
    reply: (res: { ok: boolean; error?: string }) => void,
  ): { def: (typeof STOCKS)[number]; state: StockInternal; wallet: Wallet; key: string; n: number } | null {
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return null;
    }
    if (marketWeekend()) {
      reply({ ok: false, error: '주말엔 주식장이 쉬어요. 월요일에 다시 만나요!' });
      return null;
    }
    const def = STOCKS.find((d) => d.id === String(stockId));
    if (!def) {
      reply({ ok: false, error: '없는 종목이에요.' });
      return null;
    }
    const state = stocksState[def.id];
    if (state.delistedUntil) {
      reply({ ok: false, error: '상장폐지 중인 종목이에요. 재상장을 기다려주세요.' });
      return null;
    }
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n < 1 || n > STOCK_QTY_MAX) {
      reply({ ok: false, error: '수량이 올바르지 않아요.' });
      return null;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    return { def, state, wallet, key, n };
  }

  socket.on('stock-buy', (stockId, qty, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const t = tradeGuard(stockId, qty, reply);
    if (!t) return;
    const cost = t.state.price * t.n;
    if (t.wallet.coins < cost) {
      reply({ ok: false, error: `코인이 부족해요. (${t.wallet.coins}/${cost})`, coins: t.wallet.coins });
      return;
    }
    t.wallet.stocks = t.wallet.stocks ?? {};
    const h = t.wallet.stocks[t.def.id] ?? { qty: 0, avg: 0 };
    if (h.qty + t.n > STOCK_QTY_MAX) {
      reply({ ok: false, error: `종목당 최대 ${STOCK_QTY_MAX}주까지 보유할 수 있어요.` });
      return;
    }
    t.wallet.coins -= cost;
    h.avg = Math.round(((h.avg * h.qty + cost) / (h.qty + t.n)) * 100) / 100;
    h.qty += t.n;
    t.wallet.stocks[t.def.id] = h;
    bumpStat(t.key, 'stockBuys');
    saveWallets();
    checkAch(t.key);
    reply({ ok: true, coins: t.wallet.coins, holding: { ...h } });
    console.log(`[stock] ${t.key}: ${t.def.name} ${t.n}주 매수 @${t.state.price} (-${cost})`);
  });

  socket.on('stock-sell', (stockId, qty, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const t = tradeGuard(stockId, qty, reply);
    if (!t) return;
    const h = t.wallet.stocks?.[t.def.id];
    if (!h || h.qty < t.n) {
      reply({ ok: false, error: `보유 수량이 부족해요. (${h?.qty ?? 0}주)` });
      return;
    }
    const gain = t.state.price * t.n;
    t.wallet.coins += gain;
    // 실현 손익 (평단가 대비) — 수익/손실 누적 업적용
    const pl = Math.round((t.state.price - h.avg) * t.n);
    if (pl > 0) {
      bumpStat(t.key, 'stockProfit', pl);
      earnCoins(t.key, pl);
    } else if (pl < 0) {
      bumpStat(t.key, 'stockLoss', -pl);
    }
    h.qty -= t.n;
    if (h.qty <= 0) delete t.wallet.stocks![t.def.id];
    saveWallets();
    checkAch(t.key);
    reply({ ok: true, coins: t.wallet.coins, holding: { qty: h.qty, avg: h.avg } });
    console.log(`[stock] ${t.key}: ${t.def.name} ${t.n}주 매도 @${t.state.price} (+${gain})`);
  });

  // ---- 전광판 유료 광고 ----

  socket.on('ticker-send', (text, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const clean = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, TICKER_AD_MAX_LEN);
    if (!clean) {
      reply({ ok: false, error: '내용을 입력해주세요.' });
      return;
    }
    const now = Date.now();
    const last = lastTickerAdAt.get(key) ?? 0;
    if (now - last < TICKER_AD_COOLDOWN_MS) {
      reply({ ok: false, error: `광고는 ${Math.ceil((TICKER_AD_COOLDOWN_MS - (now - last)) / 1000)}초 후에 보낼 수 있어요.` });
      return;
    }
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.coins < TICKER_AD_COST) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${TICKER_AD_COST})`, coins: wallet.coins });
      return;
    }
    wallet.coins -= TICKER_AD_COST;
    bumpStat(key, 'ads');
    saveWallets();
    lastTickerAdAt.set(key, now);
    publishTicker('ad', `📢 ${clean}`, key);
    checkAch(key);
    reply({ ok: true, coins: wallet.coins });
    console.log(`[ticker] ${key} 광고 (-${TICKER_AD_COST}): ${clean}`);
  });

  socket.on('ticker-log', (ack) => {
    if (typeof ack !== 'function') return;
    ack([...tickerLog].reverse().slice(0, 100)); // 최신순
  });

  // ---- 미보유 랜덤 파츠 뽑기 (결제만 서버, 지급은 클라이언트 로컬 풀) ----

  socket.on('buy-random', (itemId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const def = RANDOM_SHOP.find((i) => i.id === String(itemId));
    if (!def) {
      reply({ ok: false, error: '없는 상품이에요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastRandomBuyAt.get(socket.id) ?? 0) < 500) {
      reply({ ok: false, error: '너무 빨라요!' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    if (wallet.coins < def.price) {
      reply({ ok: false, error: `코인이 부족해요. (${wallet.coins}/${def.price})`, coins: wallet.coins });
      return;
    }
    lastRandomBuyAt.set(socket.id, now);
    wallet.coins -= def.price;
    bumpStat(key, 'randomPulls');
    saveWallets();
    checkAch(key);
    reply({ ok: true, coins: wallet.coins });
    console.log(`[shop] ${key}: ${def.id} 뽑기 (-${def.price}) 잔액 ${wallet.coins}`);
  });

  // ---- 보유 파츠 동기화 (클라 기준 합집합 — 다른 PC에서도 수집품 이어받기) ----

  socket.on('parts-sync', (parts, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    wallet.parts = wallet.parts ?? [];
    if (Array.isArray(parts)) {
      let added = 0;
      const have = new Set(wallet.parts);
      for (const raw of parts) {
        if (wallet.parts.length >= PARTS_SYNC_MAX) break;
        if (typeof raw !== 'string' || raw.length > 64 || !PART_ID_RE.test(raw) || have.has(raw)) continue;
        have.add(raw);
        wallet.parts.push(raw);
        added++;
      }
      if (added > 0) {
        saveWallets();
        checkAch(key);
        console.log(`[parts] ${key}: ${added}개 등록 (총 ${wallet.parts.length})`);
      }
    }
    reply({ ok: true, parts: [...wallet.parts] });
  });

  // ---- 러너 ----

  socket.on('runner-score', (seconds, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const now = Date.now();
    if (now - (lastRunnerAt.get(key) ?? 0) < (RUNNER_COOLDOWN_SEC - 30) * 1000) {
      reply({ ok: false, error: '아직 쿨타임이에요.' });
      return;
    }
    lastRunnerAt.set(key, now);
    const secs = Math.max(0, Math.min(600, Number(seconds) || 0));
    const delta = Math.min(RUNNER_COIN_MAX, Math.floor(secs * RUNNER_COIN_PER_SEC));
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    wallet.coins += delta;
    bumpStat(key, 'runnerCoins', delta);
    earnCoins(key, delta);
    if (secs < 1) grantAch(key, 'h-shoelace'); // 히든: 신발끈부터
    if (delta >= RUNNER_COIN_MAX) grantAch(key, 'g-perfect');
    questProgress(socket.id, 'runner', Math.floor(secs), true);
    checkAch(key);
    saveWallets();
    reply({ ok: true, delta, coins: wallet.coins });
    console.log(`[runner] ${key}: ${secs.toFixed(1)}초 (+${delta})`);
  });

  // ---- 땅파기 (롤은 클라이언트 overlay.ts, 정산·도감·업적은 서버) ----

  socket.on('digging-state', (data) => {
    const player = players.get(socket.id);
    const phase = String(data?.phase ?? '');
    if (!player || !(DIG_PHASES as readonly string[]).includes(phase)) return;
    const itemId = typeof data?.itemId === 'string' ? data.itemId.slice(0, 16) : undefined;
    socket.broadcast.emit('player-digging', { id: socket.id, phase: phase as DigPhase, itemId });
  });

  socket.on('dig', (result, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const kind = String(result?.kind ?? '') as DigKind;
    if (!(DIG_KINDS as readonly string[]).includes(kind)) {
      reply({ ok: false, error: '알 수 없는 발굴 결과예요.' });
      return;
    }
    const mineral = kind === 'mineral' ? MINERAL_BY_ID.get(String(result?.itemId ?? '')) : undefined;
    if (kind === 'mineral' && !mineral) {
      reply({ ok: false, error: '알 수 없는 광물이에요.' });
      return;
    }
    const now = Date.now();
    if (now - (lastDigAt.get(socket.id) ?? 0) < DIG_MIN_INTERVAL_MS) {
      reply({ ok: false, error: '땅파기가 너무 빨라요.' });
      return;
    }
    lastDigAt.set(socket.id, now);
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    wallet.minerals = wallet.minerals ?? [];
    bumpStat(key, 'digTotal');
    questProgress(socket.id, 'dig');

    let delta = 0;
    let gemsDelta = 0;
    let isNew = false;
    let itemGrant: { id: string; name: string } | null = null;
    if (kind === 'miss') {
      bumpStat(key, 'digMiss');
    } else if (mineral) {
      isNew = !wallet.minerals.includes(mineral.id);
      if (isNew) wallet.minerals.push(mineral.id);
      if (mineral.id === DIG_GOLDBAR_ID) {
        delta = DIG_GOLDBAR_COIN;
      } else {
        delta = isNew ? DIG_FIRST_COIN[mineral.cat] : DIG_REPEAT_COIN[mineral.cat];
        if (isNew) gemsDelta = DIG_GEM_FIRST[mineral.cat] ?? 0;
      }
      if (isNew && mineral.cat === 'diamond') {
        io.emit('dig-news', { id: socket.id, nickname: player.nickname, tag: player.tag, name: mineral.name });
        publishTicker('news', `💎 ${player.nickname}#${player.tag}님이 땅에서 ${mineral.name}을(를) 발굴했습니다!`);
      }
    } else if (kind === 'coin') {
      delta = DIG_COIN_MIN + Math.floor(Math.random() * (DIG_COIN_MAX - DIG_COIN_MIN + 1));
    } else if (kind === 'gem') {
      gemsDelta = DIG_GEMSHARD_GEM;
    } else if (kind === 'chest-wood') {
      delta = DIG_CHEST_WOOD_MIN + Math.floor(Math.random() * (DIG_CHEST_WOOD_MAX - DIG_CHEST_WOOD_MIN + 1));
    } else if (kind === 'chest-red') {
      // 붉은 보물상자: 미보유 상점 아이템 반반 (낚시 보물상자와 동일 규칙)
      const unowned = SHOP_ITEMS.filter((i) => !wallet.items.includes(i.id));
      if (unowned.length > 0 && Math.random() < 0.5) {
        const won = unowned[Math.floor(Math.random() * unowned.length)];
        wallet.items.push(won.id);
        itemGrant = { id: won.id, name: won.name };
      } else {
        delta = DIG_CHEST_RED_MIN + Math.floor(Math.random() * (DIG_CHEST_RED_MAX - DIG_CHEST_RED_MIN + 1));
      }
    } else if (kind === 'chest-gold') {
      delta = DIG_CHEST_GOLD_COIN;
      gemsDelta = DIG_CHEST_GOLD_GEM;
    }
    wallet.coins += delta;
    wallet.gems = (wallet.gems ?? 0) + gemsDelta;
    earnCoins(key, delta);
    saveWallets();
    if (gemsDelta > 0) socket.emit('gems', wallet.gems);
    reply({
      ok: true,
      kind,
      delta,
      coins: wallet.coins,
      gems: wallet.gems ?? 0,
      ...(kind === 'mineral' ? { isNew, minerals: [...wallet.minerals] } : {}),
      ...(gemsDelta ? { gemsDelta } : {}),
      ...(itemGrant ? { item: itemGrant, items: [...wallet.items] } : {}),
    });
    checkAch(key);
    if (mineral && isNew) {
      console.log(`[dig] ${key}: ${mineral.id} 최초 발굴 (+${delta}) 도감 ${wallet.minerals.length}/${MINERALS.length}`);
    } else if (kind !== 'mineral' && kind !== 'miss') {
      console.log(
        `[dig] ${key}: ${kind} → ${itemGrant ? `아이템 '${itemGrant.name}'` : `+${delta}코인${gemsDelta ? ` +${gemsDelta}젬` : ''}`}`,
      );
    }
  });

  // ---- 원정 (방치형 전투) ----

  socket.on('battle-state', (ack) => {
    if (typeof ack !== 'function') return;
    const player = players.get(socket.id);
    if (!player || !wallets[walletKey(player)]) {
      ack(null);
      return;
    }
    ack(battleStateFor(walletKey(player)));
  });

  socket.on('battle-claim', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const res = battleSettle(socket.id, key, Date.now());
    if (!res) {
      reply({ ok: false, error: '아직 처치한 몬스터가 없어요. 조금만 기다려 주세요!' });
      return;
    }
    reply({ ...res, state: battleStateFor(key) });
  });

  socket.on('battle-upgrade', (keyRaw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const stat = String(keyRaw) as BattleUpgradeKey;
    if (!BATTLE_UPGRADE_KEYS.includes(stat)) {
      reply({ ok: false, error: '알 수 없는 능력치예요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = wallets[key];
    const b = battleOf(wallet);
    if (b.lv[stat] >= BATTLE_LV_MAX[stat]) {
      reply({ ok: false, error: '이미 최대 레벨이에요.' });
      return;
    }
    const cost = battleUpgradeCost(stat, b.lv[stat]);
    if ((wallet.gems ?? 0) < cost) {
      reply({ ok: false, error: `젬이 부족해요. (${wallet.gems ?? 0}/${cost} 💎)` });
      return;
    }
    // 능력치가 바뀌면 처치 속도가 달라지므로 쌓인 전리품은 먼저 정산
    const settled = battleSettle(socket.id, key, Date.now());
    wallet.gems = (wallet.gems ?? 0) - cost;
    b.lv[stat] += 1;
    saveWallets();
    socket.emit('gems', wallet.gems);
    checkAch(key);
    reply({ ...(settled ?? { ok: true }), gemsNow: wallet.gems, coinsNow: wallet.coins, state: battleStateFor(key) });
    console.log(`[battle] ${key}: ${stat} Lv${b.lv[stat]} 강화 (-${cost}💎, 잔여 ${wallet.gems})`);
  });

  socket.on('battle-stage', (stageRaw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = wallets[key];
    const b = battleOf(wallet);
    const stage = Math.floor(Number(stageRaw));
    const top = Math.min(BATTLE_MAX_STAGE, b.maxStage + 1);
    if (!Number.isFinite(stage) || stage < 1 || stage > top) {
      reply({ ok: false, error: `1층 ~ ${top}층까지만 갈 수 있어요. (수문장을 처치하면 다음 층이 열려요)` });
      return;
    }
    if (stage === b.stage) {
      reply({ ok: true, state: battleStateFor(key) });
      return;
    }
    const settled = battleSettle(socket.id, key, Date.now());
    b.stage = stage;
    saveWallets();
    reply({ ...(settled ?? { ok: true }), state: battleStateFor(key) });
  });

  socket.on('battle-active', (activeRaw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = wallets[key];
    const b = battleOf(wallet);
    const active = activeRaw === true;
    if (active === b.active) {
      reply({ ok: true, state: battleStateFor(key) });
      return;
    }
    const now = Date.now();
    let settled: BattleClaimResult | null = null;
    if (active) {
      b.active = true;
      b.since = now;
    } else {
      settled = battleSettle(socket.id, key, now); // 귀환: 쌓인 전리품 자동 수령
      b.active = false;
    }
    player.battle = active;
    saveWallets();
    io.emit('player-battle', { id: socket.id, active });
    reply({ ...(settled ?? { ok: true }), state: battleStateFor(key) });
    console.log(`[battle] ${key}: ${active ? `${b.stage}층 원정 출발` : '귀환'}`);
  });

  socket.on('battle-challenge', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = wallets[key];
    const b = battleOf(wallet);
    const now = Date.now();
    const next = b.maxStage + 1;
    if (next > BATTLE_MAX_STAGE) {
      reply({ ok: false, error: '모든 층을 정복했어요! 🏆' });
      return;
    }
    if (now < (b.challengeAt ?? 0)) {
      reply({ ok: false, error: `아직 회복 중이에요. (${Math.ceil((b.challengeAt - now) / 1000)}초)` });
      return;
    }
    const stats = battleStatsOf(wallet);
    const foe = battleGuardianFor(next);
    const sim = battleSimulate(stats, foe);
    let reward: { coins: number; gems: number; item?: { id: string; name: string } } | undefined;
    let settled: BattleClaimResult | null = null;
    if (sim.win) {
      // 최전선(next)에서 사냥 중이었으면 새로 열린 층으로 자동 전진 — 처치 속도가 바뀌므로 먼저 정산
      if (b.stage === next && next < BATTLE_MAX_STAGE) {
        settled = battleSettle(socket.id, key, now);
        b.stage = next + 1;
      }
      b.maxStage = next;
      b.challengeAt = now + BATTLE_CHALLENGE_COOLDOWN_MS;
      reward = battleClearReward(next);
      if (foe.kind === 'big' && Math.random() < BATTLE_BIG_BOSS_ITEM_RATE) {
        const unowned = SHOP_ITEMS.filter((i) => !wallet.items.includes(i.id));
        if (unowned.length > 0) {
          const won = unowned[Math.floor(Math.random() * unowned.length)];
          wallet.items.push(won.id);
          reward.item = { id: won.id, name: won.name };
        }
      }
      wallet.coins += reward.coins;
      wallet.gems = (wallet.gems ?? 0) + reward.gems;
      earnCoins(key, reward.coins);
      saveWallets();
      socket.emit('coins', wallet.coins);
      if (reward.gems > 0) socket.emit('gems', wallet.gems);
      if (foe.kind !== 'guardian') {
        const label = foe.kind === 'big' ? '대보스' : '보스';
        const text = `⚔️ ${player.nickname}#${player.tag}님이 원정 ${next}층 ${label} '${foe.name}'을(를) 격파했습니다!`;
        io.emit('battle-news', { id: socket.id, nickname: player.nickname, tag: player.tag, text });
        if (foe.kind === 'big') publishTicker('news', text);
      }
      checkAch(key);
      console.log(`[battle] ${key}: ${next}층 수문장 '${foe.name}' 격파 (+${reward.coins}🪙${reward.gems ? ` +${reward.gems}💎` : ''}${reward.item ? ` 아이템 '${reward.item.name}'` : ''})`);
    } else {
      b.challengeAt = now + BATTLE_LOSE_COOLDOWN_MS;
      saveWallets();
      grantAch(key, 'b-lose');
      console.log(`[battle] ${key}: ${next}층 수문장 '${foe.name}'에게 패배 (${sim.log.length}틱)`);
    }
    reply({
      ok: true,
      win: sim.win,
      stage: next,
      foe: { emoji: foe.emoji, name: foe.name, hp: foe.hp, atk: foe.atk },
      log: sim.log,
      ...(reward ? { reward } : {}),
      ...(settled ? { settled: { kills: settled.kills ?? 0, coins: settled.coins ?? 0, gems: settled.gems ?? 0 } } : {}),
      ...(reward?.item ? { items: [...wallet.items] } : {}),
      coinsNow: wallet.coins,
      gemsNow: wallet.gems ?? 0,
      state: battleStateFor(key),
    });
  });

  // ---- 도전과제 상태 / 칭호 착용 ----

  socket.on('ach-state', (ack) => {
    if (typeof ack !== 'function') return;
    const player = players.get(socket.id);
    const wallet = player ? wallets[walletKey(player)] : undefined;
    ack({
      ach: [...(wallet?.ach ?? [])],
      title: wallet?.title ?? '',
      metrics: wallet ? achMetrics(wallet) : {},
    });
  });

  socket.on('set-title', (title, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = wallets[key];
    const clean = String(title ?? '').slice(0, 24);
    if (clean) {
      const def = achForTitle(clean);
      if (!def || !wallet?.ach?.includes(def.id)) {
        reply({ ok: false, error: '아직 달성하지 않은 칭호예요.' });
        return;
      }
      wallet.title = clean;
    } else if (wallet) {
      delete wallet.title;
    }
    saveWallets();
    player.title = clean || undefined;
    io.emit('player-title', { id: socket.id, title: clean });
    reply({ ok: true, title: clean });
    console.log(`[ach] ${key} 칭호: ${clean || '(해제)'}`);
  });

  // ---- 리액션 이모지 ----

  socket.on('reaction', (index) => {
    const player = players.get(socket.id);
    const idx = Math.floor(Number(index));
    if (!player || !Number.isFinite(idx) || idx < 0 || idx >= REACTION_COLS * REACTION_ROWS) return;
    const now = Date.now();
    if (now - (lastChatAt.get(socket.id) ?? 0) < 300) return;
    lastChatAt.set(socket.id, now);
    const msg: ChatMessage = {
      id: socket.id,
      nickname: player.nickname,
      tag: player.tag,
      text: '',
      ts: now,
      reaction: idx,
      senderAppearance: player.appearance,
      ...(player.title ? { senderTitle: player.title } : {}),
    };
    io.emit('chat', msg);
    recordChat(msg);
    const rKey = walletKey(player);
    bumpStat(rKey, 'reactions');
    questProgress(socket.id, 'reaction');
    checkAch(rKey);
  });

  socket.on('buy-action', (actionId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    const player = players.get(socket.id);
    if (!player) {
      reply({ ok: false, error: '접속 상태가 아니에요.' });
      return;
    }
    const item = ACTION_SHOP.find((a) => a.id === String(actionId));
    if (!item) {
      reply({ ok: false, error: '없는 액션이에요.' });
      return;
    }
    const key = walletKey(player);
    const wallet = (wallets[key] = wallets[key] ?? { coins: 0, items: [], fish: [], parts: [], trophies: [] });
    wallet.actions = wallet.actions ?? [];
    if (wallet.actions.includes(item.id)) {
      reply({ ok: false, error: '이미 보유한 액션이에요.' });
      return;
    }
    if ((wallet.gems ?? 0) < item.price) {
      reply({ ok: false, error: `젬이 부족해요. (${wallet.gems ?? 0}/${item.price} 💎)` });
      return;
    }
    wallet.gems = (wallet.gems ?? 0) - item.price;
    wallet.actions.push(item.id);
    saveWallets();
    checkAch(key);
    reply({ ok: true, gems: wallet.gems, actions: [...wallet.actions] });
    console.log(`[action-shop] ${key}: ${item.id} 구매 (잔여 ${wallet.gems} 💎)`);
  });

  socket.on('ranking', (ack) => {
    if (typeof ack !== 'function') return;
    ack(rankingRows());
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
    stripUnownedCosmetics(appearance, walletKey(player));
    player.appearance = appearance;
    socket.broadcast.emit('player-appearance', { id: socket.id, appearance });
    const aKey = walletKey(player);
    bumpStat(aKey, 'looks');
    checkAch(aKey);
    console.log(`[appearance] ${player.nickname} → ${appearance.race.name}`);
  });

  socket.on('pinned', (raw) => {
    const player = players.get(socket.id);
    if (!player) return;
    const now = Date.now();
    if (now - (lastPinnedAt.get(socket.id) ?? 0) < 500) return; // 도배 방지
    const text = sanitizePinned(raw);
    if (text === (player.pinned ?? '')) return;
    lastPinnedAt.set(socket.id, now);
    player.pinned = text;
    socket.broadcast.emit('player-pinned', { id: socket.id, text });
    if (text) {
      const pKey = walletKey(player);
      bumpStat(pKey, 'pinnedSet');
      checkAch(pKey);
    }
    console.log(`[pinned] ${player.nickname}#${player.tag}: ${text || '(해제)'}`);
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
      ...(player.title ? { senderTitle: player.title } : {}),
    };
    io.emit('chat', msg);
    recordChat(msg);
    const cKey = walletKey(player);
    bumpStat(cKey, 'chats');
    const kstHour = new Date(now + 9 * 3600_000).getUTCHours();
    if (kstHour >= 3 && kstHour < 5) grantAch(cKey, 'h-owl'); // 히든: 올빼미
    questProgress(socket.id, 'chat');
    checkAch(cKey);
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
      ...(player.title ? { senderTitle: player.title } : {}),
    };
    io.emit('chat', msg);
    recordChat(msg);
    const iKey = walletKey(player);
    bumpStat(iKey, 'images');
    checkAch(iKey);
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
      lastFishAt.delete(socket.id);
      lastPinnedAt.delete(socket.id);
      lastRandomBuyAt.delete(socket.id);
      lastEnhanceAt.delete(socket.id);
      lastDigAt.delete(socket.id);
      socket.broadcast.emit('player-fishing', { id: socket.id, phase: 'stop' });
      socket.broadcast.emit('player-digging', { id: socket.id, phase: 'stop' });
      io.emit('player-left', socket.id);
      console.log(`- ${player.nickname} — ${players.size}명 접속중`);
    }
  });
});

console.log(`DotChat server v${APP_VERSION} listening on :${port}`);

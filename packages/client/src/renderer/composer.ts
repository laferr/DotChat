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

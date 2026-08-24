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
